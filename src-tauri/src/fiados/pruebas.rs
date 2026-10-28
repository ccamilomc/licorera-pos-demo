//! Pruebas de los fiados.
//!
//! Lo que se protege es lo que descuadra la caja. Una venta fiada no
//! puede pedirle al arqueo una plata que nadie entrego, un abono en
//! efectivo si tiene que aparecer en el cajon, y anular un abono tiene
//! que sacar de vuelta lo que habia metido. El saldo se calcula, nunca
//! se guarda: es la unica forma de que no se desincronice.

use super::*;
use crate::caja;
use crate::db::abrir_en_memoria;
use crate::ventas::{self, ItemCarrito, PagoRecibido, VentaEntrante};

fn base() -> Connection {
    let db = abrir_en_memoria().unwrap();
    db.execute(
        "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
         VALUES ('admin', 'Camilo', 'h', 'ADMINISTRADOR')",
        [],
    )
    .unwrap();
    // «Cervezas» ya viene con los datos base: se busca, no se crea.
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
         SELECT id, 'Unidad', 1, 3900, 1, 1, 1, 1 FROM productos WHERE codigo = 'C1'",
        [],
    )
    .unwrap();
    caja::abrir(&db, 1, 50_000, None).unwrap();
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

fn un_cliente(db: &Connection, nombre: &str, cupo: i64) -> i64 {
    crear_cliente(
        db,
        &ClienteEditable {
            id: None,
            nombre: nombre.to_owned(),
            telefono: None,
            documento: None,
            nota: None,
            cupo,
        },
    )
    .unwrap()
}

/// Vende `cantidad` unidades, fiadas al cliente indicado.
fn venta_fiada(
    db: &mut Connection,
    cliente_id: Option<i64>,
    cantidad: i64,
) -> Result<ventas::VentaRegistrada, ventas::ErrorVenta> {
    let total = 3_900 * cantidad;
    let fiado = id_metodo(db, "FIADO");
    ventas::registrar(
        db,
        &VentaEntrante {
            items: vec![ItemCarrito {
                producto_id: 1,
                empaque_id: Some(1),
                cantidad,
                descuento: 0,
            }],
            pagos: vec![PagoRecibido {
                metodo_pago_id: fiado,
                monto: total,
                recibido: None,
            }],
            usuario_id: 1,
            notas: None,
            recargo: None,
            cliente_id,
            cliente_nombre: None,
        },
    )
}

/// Lo que el arqueo espera encontrar en el cajón.
fn esperado_en_caja(db: &Connection) -> i64 {
    caja::resumen(db, 1).unwrap().efectivo_esperado
}

#[test]
fn una_venta_fiada_no_le_pide_plata_al_cajon() {
    let mut db = base();
    let antes = esperado_en_caja(&db);
    let cliente = un_cliente(&db, "Don Jairo", 0);

    venta_fiada(&mut db, Some(cliente), 10).unwrap();

    // Antes esa venta entraba como cualquier otra y el arqueo salia
    // descuadrado en 39.000 todos los dias.
    assert_eq!(esperado_en_caja(&db), antes, "esa plata no esta en el cajon");
}

#[test]
fn la_venta_queda_a_nombre_de_alguien_y_con_su_saldo() {
    let mut db = base();
    let cliente = un_cliente(&db, "Don Jairo", 0);

    venta_fiada(&mut db, Some(cliente), 10).unwrap();

    let lista = clientes(&db).unwrap();
    let jairo = lista.iter().find(|c| c.id == cliente).unwrap();
    assert_eq!(jairo.saldo, 39_000);
    assert_eq!(jairo.fiado, 39_000);
    assert_eq!(jairo.abonado, 0);
    assert_eq!(jairo.cuentas, 1);
}

#[test]
fn sin_cliente_la_venta_entera_se_rechaza() {
    let mut db = base();

    let fallo = venta_fiada(&mut db, None, 10);

    assert!(matches!(
        fallo,
        Err(ventas::ErrorVenta::Fiado(ErrorFiado::FaltaCliente)),
    ));
    // Y no queda a medias: ni venta ni movimiento de inventario.
    let ventas: i64 = db
        .query_row("SELECT COUNT(*) FROM ventas", [], |f| f.get(0))
        .unwrap();
    let existencia: i64 = db
        .query_row("SELECT existencia FROM productos WHERE id = 1", [], |f| f.get(0))
        .unwrap();
    assert_eq!(ventas, 0);
    assert_eq!(existencia, 100, "la mercancia no se movio");
}

#[test]
fn el_cupo_frena_al_que_ya_debe_demasiado() {
    let mut db = base();
    let cliente = un_cliente(&db, "Don Jairo", 50_000);

    venta_fiada(&mut db, Some(cliente), 10).unwrap();
    let fallo = venta_fiada(&mut db, Some(cliente), 10);

    assert!(matches!(
        fallo,
        Err(ventas::ErrorVenta::Fiado(ErrorFiado::SinCupo { cupo: 50_000, quedaria: 78_000 })),
    ));
}

#[test]
fn sin_cupo_no_hay_tope() {
    let mut db = base();
    let cliente = un_cliente(&db, "Don Jairo", 0);

    for _ in 0..5 {
        venta_fiada(&mut db, Some(cliente), 10).unwrap();
    }

    assert_eq!(clientes(&db).unwrap()[0].saldo, 195_000);
}

#[test]
fn no_se_le_fia_a_un_cliente_dado_de_baja() {
    let mut db = base();
    let cliente = un_cliente(&db, "Don Jairo", 0);
    desactivar_cliente(&db, cliente).unwrap();

    assert!(matches!(
        venta_fiada(&mut db, Some(cliente), 1),
        Err(ventas::ErrorVenta::Fiado(ErrorFiado::ClienteInactivo)),
    ));
}

/// Fiar escribiendo el nombre, sin dar de alta a nadie antes.
///
/// Es como se fia de verdad en el mostrador: «Don Jairo», «la señora del
/// 302», «el taller de la esquina». Obligar a llenar una ficha primero
/// hace que nadie fie por el sistema y todo vuelva al cuaderno.
mod fiar_a_nombre_escrito {
    use super::*;

    /// Vende 10 unidades fiadas al nombre que se escriba.
    fn fiar_a(db: &mut Connection, nombre: &str) -> Result<i64, ventas::ErrorVenta> {
        let fiado = id_metodo(db, "FIADO");
        ventas::registrar(
            db,
            &VentaEntrante {
                items: vec![ItemCarrito {
                    producto_id: 1, empaque_id: Some(1), cantidad: 10, descuento: 0,
                }],
                pagos: vec![PagoRecibido {
                    metodo_pago_id: fiado, monto: 39_000, recibido: None,
                }],
                usuario_id: 1,
                notas: None,
                recargo: None,
                cliente_id: None,
                cliente_nombre: Some(nombre.to_owned()),
            },
        )
        .map(|v| v.id)
    }

    #[test]
    fn un_nombre_nuevo_abre_su_cuenta() {
        let mut db = base();

        fiar_a(&mut db, "la señora del 302").unwrap();

        let lista = clientes(&db).unwrap();
        assert_eq!(lista.len(), 1);
        assert_eq!(lista[0].nombre, "la señora del 302");
        assert_eq!(lista[0].saldo, 39_000);
    }

    #[test]
    fn el_mismo_nombre_suma_a_la_misma_cuenta() {
        let mut db = base();

        fiar_a(&mut db, "Don Jairo").unwrap();
        fiar_a(&mut db, "don jairo").unwrap();
        fiar_a(&mut db, "  DON JAIRO  ").unwrap();

        // Si cada una abriera cuenta propia, el saldo real quedaria
        // repartido en tres nombres y nadie sabria cuanto debe.
        let lista = clientes(&db).unwrap();
        assert_eq!(lista.len(), 1, "es la misma persona escrita distinto");
        assert_eq!(lista[0].saldo, 117_000);
        assert_eq!(lista[0].cuentas, 3);
    }

    #[test]
    fn se_le_suma_al_cliente_que_ya_estaba_dado_de_alta() {
        let mut db = base();
        let jairo = un_cliente(&db, "Don Jairo", 0);
        venta_fiada(&mut db, Some(jairo), 10).unwrap();

        fiar_a(&mut db, "Don Jairo").unwrap();

        let lista = clientes(&db).unwrap();
        assert_eq!(lista.len(), 1, "no se duplica el que ya existia");
        assert_eq!(lista[0].id, jairo);
        assert_eq!(lista[0].saldo, 78_000);
    }

    #[test]
    fn un_nombre_en_blanco_no_vale() {
        let mut db = base();

        let fallo = fiar_a(&mut db, "   ");

        assert!(matches!(
            fallo,
            Err(ventas::ErrorVenta::Fiado(ErrorFiado::FaltaCliente)),
        ));
        let clientes_creados: i64 = db
            .query_row("SELECT COUNT(*) FROM clientes", [], |f| f.get(0))
            .unwrap();
        assert_eq!(clientes_creados, 0);
    }

    #[test]
    fn no_se_le_fia_a_un_nombre_dado_de_baja() {
        let mut db = base();
        let jairo = un_cliente(&db, "Don Jairo", 0);
        desactivar_cliente(&db, jairo).unwrap();

        // Escribir el nombre no puede ser la forma de saltarse la baja.
        assert!(matches!(
            fiar_a(&mut db, "Don Jairo"),
            Err(ventas::ErrorVenta::Fiado(ErrorFiado::ClienteInactivo)),
        ));
    }

    #[test]
    fn si_la_venta_falla_no_queda_el_cliente_creado() {
        let mut db = base();
        let fiado = id_metodo(&db, "FIADO");

        // Los pagos no cuadran con el total: la venta entera se cae.
        let fallo = ventas::registrar(
            &mut db,
            &VentaEntrante {
                items: vec![ItemCarrito {
                    producto_id: 1, empaque_id: Some(1), cantidad: 10, descuento: 0,
                }],
                pagos: vec![PagoRecibido {
                    metodo_pago_id: fiado, monto: 1_000, recibido: None,
                }],
                usuario_id: 1,
                notas: None,
                recargo: None,
                cliente_id: None,
                cliente_nombre: Some("Alguien nuevo".to_owned()),
            },
        );

        assert!(fallo.is_err());
        let creados: i64 = db
            .query_row("SELECT COUNT(*) FROM clientes", [], |f| f.get(0))
            .unwrap();
        assert_eq!(creados, 0, "el cliente se crea dentro de la misma transaccion");
    }
}

mod abonar {
    use super::*;

    /// Deja a Don Jairo debiendo 39.000 y devuelve (db, cliente, cuenta).
    fn con_deuda() -> (Connection, i64, i64) {
        let mut db = base();
        let cliente = un_cliente(&db, "Don Jairo", 0);
        venta_fiada(&mut db, Some(cliente), 10).unwrap();
        let cuenta = cuentas_de(&db, cliente, true).unwrap()[0].id;
        (db, cliente, cuenta)
    }

    #[test]
    fn un_abono_en_efectivo_entra_al_cajon() {
        let (mut db, _, cuenta) = con_deuda();
        let antes = esperado_en_caja(&db);
        let efectivo = id_metodo(&db, "EFECTIVO");

        let r = abonar(&mut db, cuenta, 20_000, efectivo, 1, None).unwrap();

        assert!(r.entro_a_caja);
        assert_eq!(esperado_en_caja(&db), antes + 20_000);
        assert_eq!(r.saldo_cuenta, 19_000);
        assert_eq!(r.saldo_cliente, 19_000);
    }

    #[test]
    fn un_abono_por_transferencia_no_toca_el_cajon() {
        let (mut db, _, cuenta) = con_deuda();
        let antes = esperado_en_caja(&db);
        let transferencia = id_metodo(&db, "TRANSFERENCIA");

        let r = abonar(&mut db, cuenta, 20_000, transferencia, 1, None).unwrap();

        assert!(!r.entro_a_caja);
        assert_eq!(esperado_en_caja(&db), antes);
        // Pero la deuda si baja: el cliente pago.
        assert_eq!(r.saldo_cuenta, 19_000);
    }

    #[test]
    fn abonar_de_a_poco_va_bajando_el_saldo() {
        let (mut db, cliente, cuenta) = con_deuda();
        let efectivo = id_metodo(&db, "EFECTIVO");

        abonar(&mut db, cuenta, 10_000, efectivo, 1, None).unwrap();
        abonar(&mut db, cuenta, 15_000, efectivo, 1, None).unwrap();
        let ultimo = abonar(&mut db, cuenta, 14_000, efectivo, 1, None).unwrap();

        assert_eq!(ultimo.saldo_cuenta, 0);
        assert_eq!(clientes(&db).unwrap()[0].saldo, 0);
        // La cuenta saldada deja de estar pendiente.
        assert!(cuentas_de(&db, cliente, true).unwrap().is_empty());
        assert_eq!(cuentas_de(&db, cliente, false).unwrap().len(), 1);
    }

    #[test]
    fn no_se_puede_abonar_mas_de_lo_que_se_debe() {
        let (mut db, _, cuenta) = con_deuda();
        let efectivo = id_metodo(&db, "EFECTIVO");

        let fallo = abonar(&mut db, cuenta, 50_000, efectivo, 1, None);

        // Recibir de mas dejaria un saldo negativo, que en un cuaderno de
        // fiados no significa nada.
        assert!(matches!(
            fallo,
            Err(ErrorFiado::AbonoExcesivo { saldo: 39_000, abono: 50_000 }),
        ));
    }

    #[test]
    fn un_abono_en_cero_o_negativo_no_es_un_abono() {
        let (mut db, _, cuenta) = con_deuda();
        let efectivo = id_metodo(&db, "EFECTIVO");

        assert!(matches!(
            abonar(&mut db, cuenta, 0, efectivo, 1, None),
            Err(ErrorFiado::MontoInvalido),
        ));
        assert!(matches!(
            abonar(&mut db, cuenta, -5_000, efectivo, 1, None),
            Err(ErrorFiado::MontoInvalido),
        ));
    }

    #[test]
    fn sin_caja_abierta_no_se_recibe_efectivo() {
        let (mut db, _, cuenta) = con_deuda();
        // Se cierra cuadrada: lo fiado no entro al cajon, asi que lo
        // esperado sigue siendo la base.
        let esperado = esperado_en_caja(&db);
        caja::cerrar(&db, 1, esperado, 1, None).unwrap();
        let efectivo = id_metodo(&db, "EFECTIVO");

        let fallo = abonar(&mut db, cuenta, 20_000, efectivo, 1, None);

        // Anotarlo sin caja lo dejaria fuera del arqueo, y esa plata
        // aparece despues en el cajon sin explicacion.
        assert!(matches!(fallo, Err(ErrorFiado::SinCaja)));
        let abonos: i64 = db
            .query_row("SELECT COUNT(*) FROM abonos", [], |f| f.get(0))
            .unwrap();
        assert_eq!(abonos, 0, "no queda anotado a medias");
    }

    #[test]
    fn sin_caja_abierta_si_se_recibe_una_transferencia() {
        let (mut db, _, cuenta) = con_deuda();
        // Se cierra cuadrada: lo fiado no entro al cajon, asi que lo
        // esperado sigue siendo la base.
        let esperado = esperado_en_caja(&db);
        caja::cerrar(&db, 1, esperado, 1, None).unwrap();
        let transferencia = id_metodo(&db, "TRANSFERENCIA");

        // Esa plata no pasa por el cajon: no hay nada que cuadrar.
        let r = abonar(&mut db, cuenta, 20_000, transferencia, 1, None).unwrap();
        assert_eq!(r.saldo_cuenta, 19_000);
    }
}

mod anular {
    use super::*;

    #[test]
    fn anular_la_venta_borra_la_deuda() {
        let mut db = base();
        let cliente = un_cliente(&db, "Don Jairo", 0);
        let venta = venta_fiada(&mut db, Some(cliente), 10).unwrap();

        ventas::anular(&mut db, venta.id, "se arrepintio", 1, None).unwrap();

        assert_eq!(clientes(&db).unwrap()[0].saldo, 0);
        assert!(cuentas_de(&db, cliente, false).unwrap().is_empty());
    }

    #[test]
    fn anular_una_venta_fiada_no_saca_plata_del_cajon() {
        let mut db = base();
        let cliente = un_cliente(&db, "Don Jairo", 0);
        let venta = venta_fiada(&mut db, Some(cliente), 10).unwrap();
        let antes = esperado_en_caja(&db);

        ventas::anular(&mut db, venta.id, "se arrepintio", 1, None).unwrap();

        // Nunca entro, asi que no tiene por que salir.
        assert_eq!(esperado_en_caja(&db), antes);
    }

    #[test]
    fn anular_un_abono_devuelve_la_plata_al_cajon() {
        let mut db = base();
        let cliente = un_cliente(&db, "Don Jairo", 0);
        venta_fiada(&mut db, Some(cliente), 10).unwrap();
        let cuenta = cuentas_de(&db, cliente, true).unwrap()[0].id;
        let efectivo = id_metodo(&db, "EFECTIVO");
        let r = abonar(&mut db, cuenta, 20_000, efectivo, 1, None).unwrap();
        let con_abono = esperado_en_caja(&db);

        anular_abono(&mut db, r.abono_id, "me equivoque de cliente", 1).unwrap();

        assert_eq!(esperado_en_caja(&db), con_abono - 20_000);
        // Y el cliente vuelve a deber lo de antes.
        assert_eq!(clientes(&db).unwrap()[0].saldo, 39_000);
    }

    #[test]
    fn anular_un_abono_por_transferencia_no_toca_el_cajon() {
        let mut db = base();
        let cliente = un_cliente(&db, "Don Jairo", 0);
        venta_fiada(&mut db, Some(cliente), 10).unwrap();
        let cuenta = cuentas_de(&db, cliente, true).unwrap()[0].id;
        let transferencia = id_metodo(&db, "TRANSFERENCIA");
        let r = abonar(&mut db, cuenta, 20_000, transferencia, 1, None).unwrap();
        let antes = esperado_en_caja(&db);

        anular_abono(&mut db, r.abono_id, "no llego la transferencia", 1).unwrap();

        assert_eq!(esperado_en_caja(&db), antes);
        assert_eq!(clientes(&db).unwrap()[0].saldo, 39_000);
    }

    #[test]
    fn un_abono_anulado_sigue_a_la_vista_con_su_motivo() {
        let mut db = base();
        let cliente = un_cliente(&db, "Don Jairo", 0);
        venta_fiada(&mut db, Some(cliente), 10).unwrap();
        let cuenta = cuentas_de(&db, cliente, true).unwrap()[0].id;
        let efectivo = id_metodo(&db, "EFECTIVO");
        let r = abonar(&mut db, cuenta, 20_000, efectivo, 1, None).unwrap();

        anular_abono(&mut db, r.abono_id, "me equivoque de cliente", 1).unwrap();

        let lista = abonos_de(&db, cuenta).unwrap();
        assert_eq!(lista.len(), 1);
        assert!(lista[0].anulado);
    }

    #[test]
    fn no_se_anula_dos_veces_ni_sin_motivo() {
        let mut db = base();
        let cliente = un_cliente(&db, "Don Jairo", 0);
        venta_fiada(&mut db, Some(cliente), 10).unwrap();
        let cuenta = cuentas_de(&db, cliente, true).unwrap()[0].id;
        let efectivo = id_metodo(&db, "EFECTIVO");
        let r = abonar(&mut db, cuenta, 20_000, efectivo, 1, None).unwrap();

        assert!(matches!(
            anular_abono(&mut db, r.abono_id, "  ", 1),
            Err(ErrorFiado::FaltaMotivo),
        ));
        anular_abono(&mut db, r.abono_id, "error", 1).unwrap();
        assert!(matches!(
            anular_abono(&mut db, r.abono_id, "otra vez", 1),
            Err(ErrorFiado::AbonoYaAnulado),
        ));
    }
}

mod los_clientes {
    use super::*;

    #[test]
    fn se_crean_editan_y_se_dan_de_baja() {
        let db = base();
        let id = un_cliente(&db, "  Don Jairo  ", 100_000);

        let antes = clientes(&db).unwrap();
        assert_eq!(antes[0].nombre, "Don Jairo", "sin espacios de sobra");
        assert_eq!(antes[0].cupo, 100_000);

        editar_cliente(
            &db,
            &ClienteEditable {
                id: Some(id),
                nombre: "Jairo Restrepo".to_owned(),
                telefono: Some("3001234567".to_owned()),
                documento: None,
                nota: Some("el de la esquina".to_owned()),
                cupo: 200_000,
            },
        )
        .unwrap();

        let despues = clientes(&db).unwrap();
        assert_eq!(despues[0].nombre, "Jairo Restrepo");
        assert_eq!(despues[0].telefono.as_deref(), Some("3001234567"));
        assert_eq!(despues[0].cupo, 200_000);

        desactivar_cliente(&db, id).unwrap();
        assert!(!clientes(&db).unwrap()[0].activo);

        reactivar_cliente(&db, id).unwrap();
        assert!(clientes(&db).unwrap()[0].activo);
    }

    #[test]
    fn un_cliente_sin_nombre_no_se_crea() {
        let db = base();
        assert!(matches!(
            crear_cliente(
                &db,
                &ClienteEditable {
                    id: None, nombre: "   ".to_owned(), telefono: None,
                    documento: None, nota: None, cupo: 0,
                },
            ),
            Err(ErrorFiado::NombreVacio),
        ));
    }

    #[test]
    fn no_se_da_de_baja_a_quien_debe() {
        let mut db = base();
        let cliente = un_cliente(&db, "Don Jairo", 0);
        venta_fiada(&mut db, Some(cliente), 10).unwrap();

        // Desactivar a alguien que debe es la forma de perder de vista
        // una deuda.
        assert!(matches!(desactivar_cliente(&db, cliente), Err(ErrorFiado::ConSaldo)));
    }

    #[test]
    fn el_que_ya_pago_si_se_da_de_baja() {
        let mut db = base();
        let cliente = un_cliente(&db, "Don Jairo", 0);
        venta_fiada(&mut db, Some(cliente), 10).unwrap();
        let cuenta = cuentas_de(&db, cliente, true).unwrap()[0].id;
        let efectivo = id_metodo(&db, "EFECTIVO");
        abonar(&mut db, cuenta, 39_000, efectivo, 1, None).unwrap();

        desactivar_cliente(&db, cliente).unwrap();
        assert!(!clientes(&db).unwrap()[0].activo);
    }

    #[test]
    fn los_que_deben_salen_primero() {
        let mut db = base();
        un_cliente(&db, "Ana", 0);
        let jairo = un_cliente(&db, "Don Jairo", 0);
        venta_fiada(&mut db, Some(jairo), 10).unwrap();

        // Quien mas debe arriba: es a quien hay que cobrarle.
        let lista = clientes(&db).unwrap();
        assert_eq!(lista[0].nombre, "Don Jairo");
        assert_eq!(lista[1].nombre, "Ana");
        assert_eq!(lista[1].saldo, 0, "el que no debe tambien esta, para poder fiarle");
    }
}

#[test]
fn media_venta_fiada_y_media_en_efectivo() {
    let mut db = base();
    let cliente = un_cliente(&db, "Don Jairo", 0);
    let antes = esperado_en_caja(&db);
    let efectivo = id_metodo(&db, "EFECTIVO");
    let fiado = id_metodo(&db, "FIADO");

    ventas::registrar(
        &mut db,
        &VentaEntrante {
            items: vec![ItemCarrito {
                producto_id: 1, empaque_id: Some(1), cantidad: 10,
                descuento: 0,
            }],
            pagos: vec![
                PagoRecibido { metodo_pago_id: efectivo, monto: 20_000, recibido: Some(20_000) },
                PagoRecibido { metodo_pago_id: fiado, monto: 19_000, recibido: None },
            ],
            usuario_id: 1,
            notas: None,
            recargo: None,
            cliente_id: Some(cliente),
            cliente_nombre: None,
        },
    )
    .unwrap();

    // «Le doy veinte y el resto me lo apunta» es de todos los dias.
    assert_eq!(esperado_en_caja(&db), antes + 20_000);
    assert_eq!(clientes(&db).unwrap()[0].saldo, 19_000);
}

#[test]
fn una_venta_normal_no_le_crea_cuenta_a_nadie() {
    let mut db = base();
    un_cliente(&db, "Don Jairo", 0);
    let efectivo = id_metodo(&db, "EFECTIVO");

    ventas::registrar(
        &mut db,
        &VentaEntrante {
            items: vec![ItemCarrito {
                producto_id: 1, empaque_id: Some(1), cantidad: 1,
                descuento: 0,
            }],
            pagos: vec![PagoRecibido {
                metodo_pago_id: efectivo, monto: 3_900, recibido: Some(5_000),
            }],
            usuario_id: 1,
            notas: None,
            recargo: None,
            // Aunque venga el cliente: si nadie fio, nadie debe.
            cliente_id: Some(1),
            cliente_nombre: None,
        },
    )
    .unwrap();

    assert_eq!(clientes(&db).unwrap()[0].saldo, 0);
    let cuentas: i64 = db
        .query_row("SELECT COUNT(*) FROM cuentas_cobrar", [], |f| f.get(0))
        .unwrap();
    assert_eq!(cuentas, 0);
}
