//! Pruebas de los gastos del negocio.
//!
//! Lo que se protege aqui es que un gasto sea un hecho con fecha y no una
//! cifra que se reparte: el arriendo de julio tiene que seguir siendo el
//! de julio aunque en agosto suba, y un mes tiene que poder llevar dos
//! renglones de «bolsas» sin que se pisen.

use super::*;
use crate::db::abrir_en_memoria;

fn base() -> Connection {
    let db = abrir_en_memoria().unwrap();
    db.execute(
        "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
         VALUES ('admin', 'Camilo', 'h', 'ADMINISTRADOR')",
        [],
    )
    .unwrap();
    db
}

fn gasto(fecha: &str, concepto: &str, monto: i64) -> GastoEditable {
    GastoEditable {
        id: None,
        fecha: fecha.to_owned(),
        categoria_id: None,
        concepto: concepto.to_owned(),
        monto,
        nota: None,
    }
}

/// Cuánto suma el período, según el estado de resultados.
fn del_periodo(db: &Connection, desde: &str, hasta: &str) -> i64 {
    listar(db, desde, hasta)
        .unwrap()
        .iter()
        .filter(|g| !g.anulado)
        .map(|g| g.monto)
        .sum()
}

#[test]
fn el_gasto_queda_con_su_fecha_y_su_concepto() {
    let db = base();
    let id = registrar(&db, &gasto("2026-08-01", "Arriendo del local", 800_000), 1).unwrap();

    let lista = listar(&db, "2026-08-01", "2026-08-31").unwrap();
    assert_eq!(lista.len(), 1);
    assert_eq!(lista[0].id, id);
    assert_eq!(lista[0].concepto, "Arriendo del local");
    assert_eq!(lista[0].monto, 800_000);
    assert_eq!(lista[0].usuario.as_deref(), Some("Camilo"));
}

#[test]
fn el_mismo_concepto_se_puede_repetir_todas_las_veces_que_haga_falta() {
    let db = base();
    registrar(&db, &gasto("2026-08-03", "Bolsas", 20_000), 1).unwrap();
    registrar(&db, &gasto("2026-08-17", "Bolsas", 18_000), 1).unwrap();

    // Dos compras de bolsas en el mes son dos hechos, no uno corregido.
    assert_eq!(del_periodo(&db, "2026-08-01", "2026-08-31"), 38_000);
    assert_eq!(listar(&db, "2026-08-01", "2026-08-31").unwrap().len(), 2);
}

#[test]
fn un_arriendo_que_sube_no_reescribe_los_meses_anteriores() {
    let db = base();
    registrar(&db, &gasto("2026-06-01", "Arriendo", 800_000), 1).unwrap();
    registrar(&db, &gasto("2026-07-01", "Arriendo", 1_050_000), 1).unwrap();

    // Junio sigue costando lo que costó. Con un valor mensual único,
    // subir el arriendo en julio recalculaba junio hacia arriba.
    assert_eq!(del_periodo(&db, "2026-06-01", "2026-06-30"), 800_000);
    assert_eq!(del_periodo(&db, "2026-07-01", "2026-07-31"), 1_050_000);
}

#[test]
fn el_periodo_deja_fuera_lo_que_no_le_toca() {
    let db = base();
    registrar(&db, &gasto("2026-07-31", "Arriendo de julio", 800_000), 1).unwrap();
    registrar(&db, &gasto("2026-08-01", "Arriendo de agosto", 800_000), 1).unwrap();
    registrar(&db, &gasto("2026-09-01", "Arriendo de septiembre", 800_000), 1).unwrap();

    let agosto = listar(&db, "2026-08-01", "2026-08-31").unwrap();
    assert_eq!(agosto.len(), 1);
    assert_eq!(agosto[0].concepto, "Arriendo de agosto");
}

#[test]
fn se_puede_anotar_cualquier_cosa_y_no_solo_las_cinco_del_excel() {
    let db = base();
    let sueldo = GastoEditable {
        categoria_id: Some(
            categorias(&db).unwrap().iter().find(|c| c.nombre == "Sueldos").unwrap().id,
        ),
        ..gasto("2026-08-30", "Sueldo de Andrés", 1_423_500)
    };
    registrar(&db, &sueldo, 1).unwrap();

    let lista = listar(&db, "2026-08-01", "2026-08-31").unwrap();
    assert_eq!(lista[0].concepto, "Sueldo de Andrés");
    assert_eq!(lista[0].categoria.as_deref(), Some("Sueldos"));
}

mod lo_que_no_se_acepta {
    use super::*;

    #[test]
    fn un_gasto_sin_concepto() {
        let db = base();
        assert!(matches!(
            registrar(&db, &gasto("2026-08-01", "   ", 10_000), 1),
            Err(ErrorGasto::ConceptoVacio),
        ));
    }

    #[test]
    fn un_monto_en_cero_o_negativo() {
        let db = base();
        assert!(matches!(
            registrar(&db, &gasto("2026-08-01", "Aseo", 0), 1),
            Err(ErrorGasto::MontoInvalido),
        ));
        assert!(matches!(
            registrar(&db, &gasto("2026-08-01", "Aseo", -5_000), 1),
            Err(ErrorGasto::MontoInvalido),
        ));
    }

    #[test]
    fn una_fecha_que_no_es_una_fecha() {
        let db = base();
        // Sin esto entra y despues el filtro por periodo la deja fuera
        // sin que nadie entienda por que falta ese gasto.
        for mala in ["21/08/2026", "2026-8-1", "ayer", ""] {
            assert!(
                matches!(
                    registrar(&db, &gasto(mala, "Aseo", 30_000), 1),
                    Err(ErrorGasto::FechaInvalida),
                ),
                "«{mala}» no deberia pasar",
            );
        }
    }
}

mod corregir_y_anular {
    use super::*;

    #[test]
    fn editar_cambia_el_gasto_y_deja_rastro_de_lo_que_era() {
        let db = base();
        let id = registrar(&db, &gasto("2026-08-01", "Arriendo", 97_700), 1).unwrap();

        editar(
            &db,
            &GastoEditable { id: Some(id), ..gasto("2026-08-01", "Arriendo", 800_000) },
            1,
        )
        .unwrap();

        assert_eq!(del_periodo(&db, "2026-08-01", "2026-08-31"), 800_000);

        let rastro: String = db
            .query_row(
                "SELECT descripcion FROM auditoria WHERE accion = 'EDITAR_GASTO'",
                [], |f| f.get(0),
            )
            .unwrap();
        // En pesos y no en digitos pelados: el rastro lo lee el dueño,
        // y «80000» al lado de «800000» no se distingue de un vistazo.
        assert!(rastro.contains("$97.700"), "tiene que decir cuanto era antes");
        assert!(rastro.contains("$800.000"));
    }

    #[test]
    fn anular_lo_saca_de_la_cuenta_pero_no_de_la_vista() {
        let db = base();
        let id = registrar(&db, &gasto("2026-08-01", "Arriendo", 800_000), 1).unwrap();

        anular(&db, id, "lo pague dos veces por error", 1).unwrap();

        assert_eq!(del_periodo(&db, "2026-08-01", "2026-08-31"), 0);

        // Sigue en la lista: alguien lo vio en un reporte y va a preguntar.
        let lista = listar(&db, "2026-08-01", "2026-08-31").unwrap();
        assert_eq!(lista.len(), 1);
        assert!(lista[0].anulado);
        assert_eq!(lista[0].motivo_anulacion.as_deref(), Some("lo pague dos veces por error"));
    }

    #[test]
    fn anular_exige_decir_por_que() {
        let db = base();
        let id = registrar(&db, &gasto("2026-08-01", "Arriendo", 800_000), 1).unwrap();
        assert!(matches!(
            anular(&db, id, "   ", 1),
            Err(ErrorGasto::FaltaMotivo),
        ));
    }

    #[test]
    fn no_se_anula_dos_veces() {
        let db = base();
        let id = registrar(&db, &gasto("2026-08-01", "Arriendo", 800_000), 1).unwrap();
        anular(&db, id, "error", 1).unwrap();
        assert!(matches!(anular(&db, id, "otra vez", 1), Err(ErrorGasto::YaAnulado)));
    }

    #[test]
    fn un_gasto_anulado_ya_no_se_edita() {
        let db = base();
        let id = registrar(&db, &gasto("2026-08-01", "Arriendo", 800_000), 1).unwrap();
        anular(&db, id, "error", 1).unwrap();

        let fallo = editar(
            &db,
            &GastoEditable { id: Some(id), ..gasto("2026-08-01", "Arriendo", 500_000) },
            1,
        );
        assert!(matches!(fallo, Err(ErrorGasto::YaAnulado)));
    }

    #[test]
    fn no_se_toca_un_gasto_que_no_existe() {
        let db = base();
        assert!(matches!(anular(&db, 999, "x", 1), Err(ErrorGasto::NoExiste)));
        assert!(matches!(
            editar(&db, &GastoEditable { id: Some(999), ..gasto("2026-08-01", "X", 1) }, 1),
            Err(ErrorGasto::NoExiste),
        ));
    }
}

mod las_categorias {
    use super::*;

    #[test]
    fn vienen_unas_cuantas_de_arranque_y_se_pueden_sumar_mas() {
        let db = base();
        let iniciales = categorias(&db).unwrap();
        assert!(iniciales.iter().any(|c| c.nombre == "Sueldos"));
        assert!(iniciales.iter().any(|c| c.nombre == "Arriendo"));

        crear_categoria(&db, "Domicilios", false).unwrap();
        assert!(categorias(&db).unwrap().iter().any(|c| c.nombre == "Domicilios"));
    }

    #[test]
    fn no_deja_dos_con_el_mismo_nombre() {
        let db = base();
        assert!(matches!(
            crear_categoria(&db, "arriendo", true),
            Err(ErrorGasto::CategoriaRepetida),
        ));
    }

    #[test]
    fn la_que_nunca_se_uso_se_borra_de_verdad() {
        let db = base();
        let id = crear_categoria(&db, "Domicilios", false).unwrap();

        quitar_categoria(&db, id).unwrap();

        assert!(!categorias(&db).unwrap().iter().any(|c| c.nombre == "Domicilios"));
    }

    #[test]
    fn la_que_tiene_gastos_detras_se_desactiva_y_no_se_borra() {
        let db = base();
        let id = crear_categoria(&db, "Domicilios", false).unwrap();
        registrar(
            &db,
            &GastoEditable { categoria_id: Some(id), ..gasto("2026-08-01", "Rappi", 12_000) },
            1,
        )
        .unwrap();

        quitar_categoria(&db, id).unwrap();

        // Borrarla dejaria el gasto viejo sin nombre y un reporte de
        // agosto diria algo distinto de lo que decia ayer.
        let c = categorias(&db).unwrap();
        let domicilios = c.iter().find(|c| c.nombre == "Domicilios").unwrap();
        assert!(!domicilios.activo);
        assert_eq!(domicilios.en_uso, 1);

        let lista = listar(&db, "2026-08-01", "2026-08-31").unwrap();
        assert_eq!(lista[0].categoria.as_deref(), Some("Domicilios"));
    }
}
