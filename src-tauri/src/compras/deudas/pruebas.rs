//! Pruebas de lo que se le debe a los proveedores.
//!
//! El riesgo es el mismo que con los fiados, al reves: un pago en
//! efectivo que no sale del cajon deja el arqueo con plata de mas, y una
//! compra a credito que no se marca hace creer que ya se pago.

use super::*;
use crate::compras::{self, CompraEntrante, ItemCompra};
use crate::db::abrir_en_memoria;

fn base() -> Connection {
    let db = abrir_en_memoria().unwrap();
    db.execute(
        "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
         VALUES ('admin', 'Camilo', 'h', 'ADMINISTRADOR')",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO productos
           (codigo, nombre, categoria_id, presentacion, unidad_base,
            existencia, precio_venta, stock_minimo)
         SELECT 'C1', 'POKER', id, '330 ml', 'UNIDAD', 100, 3900, 12
         FROM categorias WHERE nombre = 'Cervezas'",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO producto_empaques
           (producto_id, nombre, factor, precio_venta, para_venta, para_compra,
            predeterminado, orden)
         SELECT id, 'Six', 6, 25000, 1, 1, 1, 1 FROM productos WHERE codigo = 'C1'",
        [],
    )
    .unwrap();
    caja::abrir(&db, 1, 500_000, None).unwrap();
    db
}

fn id_metodo(db: &Connection, codigo: &str) -> i64 {
    db.query_row(
        "SELECT id FROM metodos_pago WHERE codigo = ?1",
        [codigo],
        |f| f.get(0),
    )
    .unwrap()
}

/// Registra una compra de 10 six a 18.000, o sea 180.000.
fn una_compra(db: &mut Connection, a_credito: bool, vence: Option<&str>) -> i64 {
    compras::registrar(
        db,
        &CompraEntrante {
            proveedor_id: 1,
            documento: Some("F-8891".to_owned()),
            fecha: "2026-08-18".to_owned(),
            items: vec![ItemCompra {
                producto_id: 1,
                empaque_id: Some(1),
                cantidad: 10,
                costo_empaque: 18_000,
            }],
            descuento: 0,
            usuario_id: 1,
            notas: None,
            a_credito,
            vence: vence.map(str::to_owned),
        },
    )
    .unwrap()
    .id
}

fn esperado_en_caja(db: &Connection) -> i64 {
    caja::resumen(db, 1).unwrap().efectivo_esperado
}

#[test]
fn una_compra_de_contado_no_queda_debiendo() {
    let mut db = base();
    una_compra(&mut db, false, None);

    assert!(pendientes(&db).unwrap().is_empty());
    assert!(por_proveedor(&db).unwrap().is_empty());
}

#[test]
fn una_compra_a_credito_queda_con_su_saldo_y_su_vencimiento() {
    let mut db = base();
    una_compra(&mut db, true, Some("2026-08-25"));

    let deudas = pendientes(&db).unwrap();
    assert_eq!(deudas.len(), 1);
    assert_eq!(deudas[0].total, 180_000);
    assert_eq!(deudas[0].pagado, 0);
    assert_eq!(deudas[0].saldo, 180_000);
    assert_eq!(deudas[0].vence.as_deref(), Some("2026-08-25"));
    // El proveedor 1 es «La Nacional», de los datos base.
    assert!(!deudas[0].proveedor.is_empty());
}

#[test]
fn el_saldo_del_proveedor_suma_lo_que_le_deben() {
    let mut db = base();
    una_compra(&mut db, true, None);
    una_compra(&mut db, true, None);

    let saldos = por_proveedor(&db).unwrap();
    assert_eq!(saldos.len(), 1);
    assert_eq!(saldos[0].saldo, 360_000);
    assert_eq!(saldos[0].compras, 2);
}

#[test]
fn una_compra_de_contado_se_puede_pasar_a_credito_despues() {
    let mut db = base();
    let compra = una_compra(&mut db, false, None);

    dejar_a_credito(&db, compra, Some("2026-08-30")).unwrap();

    assert_eq!(pendientes(&db).unwrap().len(), 1);
}

#[test]
fn una_fecha_que_no_es_una_fecha_se_rechaza() {
    let mut db = base();
    let compra = una_compra(&mut db, false, None);

    assert!(matches!(
        dejar_a_credito(&db, compra, Some("25 de agosto")),
        Err(ErrorDeuda::FechaInvalida),
    ));
}

mod pagar_lo_que_se_debe {
    use super::*;

    #[test]
    fn el_pago_en_efectivo_sale_del_cajon() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        let antes = esperado_en_caja(&db);
        let efectivo = id_metodo(&db, "EFECTIVO");

        pagar(&mut db, compra, 100_000, "2026-08-22", Some(efectivo), 1, None).unwrap();

        assert_eq!(esperado_en_caja(&db), antes - 100_000);
        assert_eq!(pendientes(&db).unwrap()[0].saldo, 80_000);
    }

    #[test]
    fn el_pago_por_transferencia_no_toca_el_cajon() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        let antes = esperado_en_caja(&db);
        let transferencia = id_metodo(&db, "TRANSFERENCIA");

        pagar(&mut db, compra, 100_000, "2026-08-22", Some(transferencia), 1, None).unwrap();

        assert_eq!(esperado_en_caja(&db), antes);
        assert_eq!(pendientes(&db).unwrap()[0].saldo, 80_000);
    }

    #[test]
    fn pagarla_entera_la_saca_de_las_pendientes() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        let efectivo = id_metodo(&db, "EFECTIVO");

        pagar(&mut db, compra, 180_000, "2026-08-22", Some(efectivo), 1, None).unwrap();

        assert!(pendientes(&db).unwrap().is_empty());
        assert!(por_proveedor(&db).unwrap().is_empty());
    }

    #[test]
    fn pagar_de_a_poco_va_bajando_el_saldo() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        let efectivo = id_metodo(&db, "EFECTIVO");

        pagar(&mut db, compra, 100_000, "2026-08-22", Some(efectivo), 1, None).unwrap();
        assert_eq!(pendientes(&db).unwrap()[0].saldo, 80_000);

        pagar(&mut db, compra, 50_000, "2026-08-25", Some(efectivo), 1, None).unwrap();
        assert_eq!(pendientes(&db).unwrap()[0].saldo, 30_000);

        // Y lo que ya se pago no se puede volver a pagar: 100.000 sobre un
        // saldo de 30.000 dejaria la compra pagada de mas.
        assert!(matches!(
            pagar(&mut db, compra, 100_000, "2026-08-26", Some(efectivo), 1, None),
            Err(ErrorDeuda::PagoExcesivo { saldo: 30_000, pago: 100_000 }),
        ));
    }

    #[test]
    fn un_pago_anulado_deja_de_contar_para_el_saldo() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        let efectivo = id_metodo(&db, "EFECTIVO");
        let pago = pagar(&mut db, compra, 180_000, "2026-08-22", Some(efectivo), 1, None)
            .unwrap();

        anular_pago(&mut db, pago, "no se hizo la transferencia", 1).unwrap();

        // Vuelve a deberse entera, asi que se puede volver a pagar entera.
        pagar(&mut db, compra, 180_000, "2026-08-23", Some(efectivo), 1, None).unwrap();
        assert!(pendientes(&db).unwrap().is_empty());
    }

    #[test]
    fn no_se_paga_mas_de_lo_que_se_debe() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        let efectivo = id_metodo(&db, "EFECTIVO");

        let fallo = pagar(&mut db, compra, 200_000, "2026-08-22", Some(efectivo), 1, None);

        assert!(matches!(
            fallo,
            Err(ErrorDeuda::PagoExcesivo { saldo: 180_000, pago: 200_000 }),
        ));
    }

    #[test]
    fn sin_caja_abierta_no_sale_efectivo() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        let esperado = esperado_en_caja(&db);
        caja::cerrar(&db, 1, esperado, 1, None).unwrap();
        let efectivo = id_metodo(&db, "EFECTIVO");

        let fallo = pagar(&mut db, compra, 100_000, "2026-08-22", Some(efectivo), 1, None);

        assert!(matches!(fallo, Err(ErrorDeuda::SinCaja)));
        let pagos: i64 = db
            .query_row("SELECT COUNT(*) FROM pagos_compra", [], |f| f.get(0))
            .unwrap();
        assert_eq!(pagos, 0, "no queda anotado a medias");
    }

    #[test]
    fn un_pago_en_cero_o_con_fecha_mala_no_pasa() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        let efectivo = id_metodo(&db, "EFECTIVO");

        assert!(matches!(
            pagar(&mut db, compra, 0, "2026-08-22", Some(efectivo), 1, None),
            Err(ErrorDeuda::MontoInvalido),
        ));
        assert!(matches!(
            pagar(&mut db, compra, 100, "22/08/2026", Some(efectivo), 1, None),
            Err(ErrorDeuda::FechaInvalida),
        ));
    }

    #[test]
    fn anular_un_pago_devuelve_la_plata_al_cajon() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        let efectivo = id_metodo(&db, "EFECTIVO");
        let pago = pagar(&mut db, compra, 100_000, "2026-08-22", Some(efectivo), 1, None)
            .unwrap();
        let con_pago = esperado_en_caja(&db);

        anular_pago(&mut db, pago, "le pague al proveedor equivocado", 1).unwrap();

        assert_eq!(esperado_en_caja(&db), con_pago + 100_000);
        assert_eq!(pendientes(&db).unwrap()[0].saldo, 180_000);
    }

    #[test]
    fn el_pago_anulado_sigue_a_la_vista() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        let efectivo = id_metodo(&db, "EFECTIVO");
        let pago = pagar(&mut db, compra, 100_000, "2026-08-22", Some(efectivo), 1, None)
            .unwrap();

        anular_pago(&mut db, pago, "error", 1).unwrap();

        let lista = pagos_de(&db, compra).unwrap();
        assert_eq!(lista.len(), 1);
        assert!(lista[0].anulado);
        assert_eq!(lista[0].monto, 100_000);
    }

    #[test]
    fn no_se_anula_dos_veces_ni_sin_motivo() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        let efectivo = id_metodo(&db, "EFECTIVO");
        let pago = pagar(&mut db, compra, 100_000, "2026-08-22", Some(efectivo), 1, None)
            .unwrap();

        assert!(matches!(
            anular_pago(&mut db, pago, "   ", 1),
            Err(ErrorDeuda::FaltaMotivo),
        ));
        anular_pago(&mut db, pago, "error", 1).unwrap();
        assert!(matches!(
            anular_pago(&mut db, pago, "otra vez", 1),
            Err(ErrorDeuda::YaAnulado),
        ));
    }
}

mod lo_vencido {
    use super::*;

    #[test]
    fn dice_cuantos_dias_lleva_vencida() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        // Vencio hace diez dias.
        let hace_diez: String = db
            .query_row("SELECT date('now','localtime','-10 days')", [], |f| f.get(0))
            .unwrap();
        dejar_a_credito(&db, compra, Some(&hace_diez)).unwrap();

        assert_eq!(pendientes(&db).unwrap()[0].vencida_hace, Some(10));
    }

    #[test]
    fn lo_que_todavia_no_vence_sale_en_negativo() {
        let mut db = base();
        let compra = una_compra(&mut db, true, None);
        let en_cinco: String = db
            .query_row("SELECT date('now','localtime','+5 days')", [], |f| f.get(0))
            .unwrap();
        dejar_a_credito(&db, compra, Some(&en_cinco)).unwrap();

        assert_eq!(pendientes(&db).unwrap()[0].vencida_hace, Some(-5));
    }

    #[test]
    fn lo_mas_vencido_va_primero_y_lo_sin_fecha_al_final() {
        let mut db = base();
        let a = una_compra(&mut db, true, Some("2026-08-30"));
        let b = una_compra(&mut db, true, Some("2026-08-20"));
        let c = una_compra(&mut db, true, None);

        // Es el orden en que hay que pagar.
        let ids: Vec<i64> = pendientes(&db).unwrap().iter().map(|d| d.compra_id).collect();
        assert_eq!(ids, vec![b, a, c]);
    }
}
