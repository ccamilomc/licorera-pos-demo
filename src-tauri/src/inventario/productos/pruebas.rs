//! Pruebas de alta, edición y ajustes de productos.

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

fn poker() -> ProductoEditable {
    ProductoEditable {
        id: None,
        codigo: "CER-POKER-330B".into(),
        nombre: "POKER".into(),
        categoria: "Cervezas".into(),
        marca: Some("Bavaria".into()),
        presentacion: "330 ml".into(),
        volumen_ml: Some(330),
        envase: Some("BOTELLA".into()),
        unidad_base: "UNIDAD".into(),
        precio_venta: 3_900,
        stock_minimo: 12,
        stock_maximo: None,
        notas: None,
        empaques: vec![
            EmpaqueEditable {
                id: None, nombre: "Unidad".into(), factor: 1,
                precio_venta: Some(3_900), para_venta: true, para_compra: true,
                predeterminado: true,
            },
            EmpaqueEditable {
                id: None, nombre: "Six".into(), factor: 6,
                precio_venta: Some(25_000), para_venta: true, para_compra: true,
                predeterminado: false,
            },
        ],
    }
}

fn existencia(db: &Connection, id: i64) -> i64 {
    db.query_row("SELECT existencia FROM productos WHERE id = ?1", [id], |f| f.get(0))
        .unwrap()
}

#[test]
fn crear_deja_el_producto_con_sus_formas_de_venta() {
    let mut db = base();
    let id = crear(&mut db, &poker(), 1).unwrap();

    let (nombre, precio, existencia): (String, i64, i64) = db
        .query_row(
            "SELECT nombre, precio_venta, existencia FROM productos WHERE id = ?1",
            [id], |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)),
        )
        .unwrap();

    assert_eq!(nombre, "POKER");
    assert_eq!(precio, 3_900);
    assert_eq!(existencia, 0, "un producto nuevo arranca sin existencia");

    let empaques: i64 = db
        .query_row("SELECT COUNT(*) FROM producto_empaques WHERE producto_id = ?1", [id], |f| f.get(0))
        .unwrap();
    assert_eq!(empaques, 2);
}

#[test]
fn un_producto_sin_forma_de_venta_con_precio_se_rechaza() {
    let mut db = base();
    let mut sin = poker();
    sin.empaques = vec![EmpaqueEditable {
        id: None, nombre: "Canasta".into(), factor: 30,
        precio_venta: None, para_venta: false, para_compra: true,
        predeterminado: false,
    }];

    assert!(matches!(
        crear(&mut db, &sin, 1),
        Err(ErrorProducto::SinFormaDeVenta)
    ));
}

#[test]
fn no_deja_repetir_el_codigo() {
    let mut db = base();
    crear(&mut db, &poker(), 1).unwrap();
    assert!(matches!(
        crear(&mut db, &poker(), 1),
        Err(ErrorProducto::CodigoRepetido(_))
    ));
}

/// El Excel trajo doce categorias, pero es una guia y no el molde: quien
/// venda algo que ese archivo no tenia debe poder crear la suya.
#[test]
fn una_categoria_que_no_existia_se_crea_sola() {
    let mut db = base();
    let mut nuevo = poker();
    nuevo.categoria = "Vinos".into();

    let id = crear(&mut db, &nuevo, 1).expect("deberia crear la categoria y el producto");

    let categoria: String = db
        .query_row(
            "SELECT c.nombre FROM productos p
             JOIN categorias c ON c.id = p.categoria_id WHERE p.id = ?1",
            rusqlite::params![id],
            |f| f.get(0),
        )
        .unwrap();
    assert_eq!(categoria, "Vinos");
}

#[test]
fn la_categoria_nueva_no_se_duplica_al_usarla_otra_vez() {
    let mut db = base();
    let mut uno = poker();
    uno.categoria = "Vinos".into();
    crear(&mut db, &uno, 1).unwrap();

    let mut otro = poker();
    otro.categoria = "vinos".into(); // en minuscula, es la misma
    otro.codigo = "VIN-OTRO".into();
    crear(&mut db, &otro, 1).unwrap();

    let cuantas: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM categorias WHERE nombre = 'Vinos' COLLATE NOCASE",
            [], |f| f.get(0),
        )
        .unwrap();
    assert_eq!(cuantas, 1, "no se puede crear dos veces la misma categoria");
}

#[test]
fn una_categoria_vacia_si_se_rechaza() {
    let mut db = base();
    let mut malo = poker();
    malo.categoria = "   ".into();
    assert!(matches!(
        crear(&mut db, &malo, 1),
        Err(ErrorProducto::CategoriaInvalida)
    ));
}

#[test]
fn la_marca_tambien_se_crea_al_vuelo_y_puede_faltar() {
    let mut db = base();
    let con_marca = crear(&mut db, &poker(), 1).unwrap();

    let mut sin_marca = poker();
    sin_marca.codigo = "SIN-MARCA".into();
    sin_marca.marca = None;
    let sin = crear(&mut db, &sin_marca, 1).unwrap();

    let marca: Option<String> = db
        .query_row(
            "SELECT m.nombre FROM productos p
             LEFT JOIN marcas m ON m.id = p.marca_id WHERE p.id = ?1",
            rusqlite::params![con_marca], |f| f.get(0),
        )
        .unwrap();
    let ninguna: Option<String> = db
        .query_row(
            "SELECT m.nombre FROM productos p
             LEFT JOIN marcas m ON m.id = p.marca_id WHERE p.id = ?1",
            rusqlite::params![sin], |f| f.get(0),
        )
        .unwrap();

    assert_eq!(marca.as_deref(), Some("Bavaria"));
    assert_eq!(ninguna, None, "no todo producto tiene marca");
}

#[test]
fn editar_no_toca_la_existencia() {
    let mut db = base();
    let id = crear(&mut db, &poker(), 1).unwrap();
    ajustar(&mut db, &Ajuste {
        producto_id: id, cantidad: 38, motivo: "conteo inicial".into(), usuario_id: 1,
    })
    .unwrap();

    let mut cambiado = poker();
    cambiado.id = Some(id);
    cambiado.precio_venta = 4_100;
    editar(&mut db, &cambiado, 1).unwrap();

    assert_eq!(existencia(&db, id), 38, "editar precios no mueve el stock");
}

#[test]
fn editar_registra_el_cambio_de_precio_con_el_valor_anterior() {
    let mut db = base();
    let id = crear(&mut db, &poker(), 1).unwrap();

    let mut cambiado = poker();
    cambiado.id = Some(id);
    cambiado.precio_venta = 4_100;
    editar(&mut db, &cambiado, 1).unwrap();

    let (antes, despues): (i64, i64) = db
        .query_row(
            "SELECT precio_anterior, precio_nuevo FROM precios_historial WHERE producto_id = ?1",
            [id], |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .unwrap();
    assert_eq!((antes, despues), (3_900, 4_100));
}

#[test]
fn editar_limpia_la_marca_de_revisar() {
    let mut db = base();
    let id = crear(&mut db, &poker(), 1).unwrap();
    db.execute(
        "UPDATE productos SET revisar = 1, revisar_motivo = 'precio dudoso' WHERE id = ?1",
        [id],
    )
    .unwrap();

    let mut revisado = poker();
    revisado.id = Some(id);
    editar(&mut db, &revisado, 1).unwrap();

    let (revisar, motivo): (i64, Option<String>) = db
        .query_row(
            "SELECT revisar, revisar_motivo FROM productos WHERE id = ?1",
            [id], |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .unwrap();
    assert_eq!(revisar, 0, "revisarlo y guardarlo es justo lo que lo resuelve");
    assert!(motivo.is_none());
}

#[test]
fn si_ningun_empaque_viene_marcado_manda_el_primero() {
    let mut db = base();
    let mut sin_marca = poker();
    for e in &mut sin_marca.empaques {
        e.predeterminado = false;
    }
    let id = crear(&mut db, &sin_marca, 1).unwrap();

    let predeterminado: String = db
        .query_row(
            "SELECT nombre FROM producto_empaques
             WHERE producto_id = ?1 AND predeterminado = 1",
            [id], |f| f.get(0),
        )
        .unwrap();
    assert_eq!(predeterminado, "Unidad", "la caja necesita saber cual proponer");
}

#[test]
fn el_ajuste_suma_o_resta_y_queda_en_el_libro() {
    let mut db = base();
    let id = crear(&mut db, &poker(), 1).unwrap();

    let entrada = ajustar(&mut db, &Ajuste {
        producto_id: id, cantidad: 38, motivo: "conteo inicial".into(), usuario_id: 1,
    })
    .unwrap();
    assert_eq!(entrada.existencia_antes, 0);
    assert_eq!(entrada.existencia_despues, 38);

    let salida = ajustar(&mut db, &Ajuste {
        producto_id: id, cantidad: -3, motivo: "se rompieron".into(), usuario_id: 1,
    })
    .unwrap();
    assert_eq!(salida.existencia_despues, 35);

    let movimientos: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM movimientos_inventario WHERE tipo = 'AJUSTE'",
            [], |f| f.get(0),
        )
        .unwrap();
    assert_eq!(movimientos, 2);
}

#[test]
fn un_ajuste_sin_motivo_no_pasa() {
    let mut db = base();
    let id = crear(&mut db, &poker(), 1).unwrap();

    assert!(matches!(
        ajustar(&mut db, &Ajuste {
            producto_id: id, cantidad: 10, motivo: "   ".into(), usuario_id: 1,
        }),
        Err(ErrorProducto::FaltaMotivo)
    ));
    assert_eq!(existencia(&db, id), 0);
}

#[test]
fn un_ajuste_no_puede_dejar_la_existencia_en_negativo() {
    let mut db = base();
    let id = crear(&mut db, &poker(), 1).unwrap();
    ajustar(&mut db, &Ajuste {
        producto_id: id, cantidad: 5, motivo: "conteo".into(), usuario_id: 1,
    })
    .unwrap();

    // A diferencia de una venta, aquí nadie tiene la botella en la mano.
    assert!(matches!(
        ajustar(&mut db, &Ajuste {
            producto_id: id, cantidad: -10, motivo: "conteo".into(), usuario_id: 1,
        }),
        Err(ErrorProducto::ExistenciaNegativa)
    ));
    assert_eq!(existencia(&db, id), 5);
}

#[test]
fn el_ajuste_queda_en_la_auditoria_con_su_motivo() {
    let mut db = base();
    let id = crear(&mut db, &poker(), 1).unwrap();
    // Primero hay que tener existencia para poder restarle.
    ajustar(&mut db, &Ajuste {
        producto_id: id, cantidad: 10, motivo: "conteo inicial".into(), usuario_id: 1,
    })
    .unwrap();
    ajustar(&mut db, &Ajuste {
        producto_id: id, cantidad: -2, motivo: "se rompieron dos".into(), usuario_id: 1,
    })
    .unwrap();

    let descripcion: String = db
        .query_row(
            "SELECT descripcion FROM auditoria
             WHERE accion = 'AJUSTAR_INVENTARIO' ORDER BY id DESC LIMIT 1",
            [], |f| f.get(0),
        )
        .unwrap();
    assert!(descripcion.contains("se rompieron dos"));
    assert!(descripcion.contains("-2"));
}

#[test]
fn el_libro_cuadra_despues_de_varios_ajustes() {
    let mut db = base();
    let id = crear(&mut db, &poker(), 1).unwrap();

    for (cantidad, motivo) in [(38, "conteo"), (-3, "rotura"), (12, "devolucion")] {
        ajustar(&mut db, &Ajuste {
            producto_id: id, cantidad, motivo: motivo.into(), usuario_id: 1,
        })
        .unwrap();
    }

    let descuadre: i64 = db
        .query_row("SELECT descuadre FROM v_existencia_calculada WHERE producto_id = ?1", [id], |f| f.get(0))
        .unwrap();
    assert_eq!(descuadre, 0);
    assert_eq!(existencia(&db, id), 47);
}

#[test]
fn un_codigo_de_barras_se_asocia_una_vez() {
    let mut db = base();
    let id = crear(&mut db, &poker(), 1).unwrap();

    agregar_codigo_barras(&db, id, "7702004003515", 1).unwrap();
    // Volver a escanear el mismo no es un error: no hay nada que hacer.
    agregar_codigo_barras(&db, id, "7702004003515", 1).unwrap();

    let codigos: i64 = db
        .query_row("SELECT COUNT(*) FROM producto_codigos WHERE producto_id = ?1", [id], |f| f.get(0))
        .unwrap();
    assert_eq!(codigos, 1);
}

#[test]
fn un_producto_puede_tener_varios_codigos() {
    let mut db = base();
    let id = crear(&mut db, &poker(), 1).unwrap();

    // La misma cerveza cambia de codigo entre lotes.
    agregar_codigo_barras(&db, id, "7702004003515", 1).unwrap();
    agregar_codigo_barras(&db, id, "7702004009999", 1).unwrap();

    let codigos: i64 = db
        .query_row("SELECT COUNT(*) FROM producto_codigos WHERE producto_id = ?1", [id], |f| f.get(0))
        .unwrap();
    assert_eq!(codigos, 2);
}

#[test]
fn un_codigo_no_puede_estar_en_dos_productos() {
    let mut db = base();
    let poker_id = crear(&mut db, &poker(), 1).unwrap();

    let mut otra = poker();
    otra.codigo = "CER-AGUILA-330B".into();
    otra.nombre = "AGUILA".into();
    let aguila_id = crear(&mut db, &otra, 1).unwrap();

    agregar_codigo_barras(&db, poker_id, "7702004003515", 1).unwrap();
    assert!(matches!(
        agregar_codigo_barras(&db, aguila_id, "7702004003515", 1),
        Err(ErrorProducto::CodigoBarrasRepetido)
    ));
}

#[test]
fn desactivar_no_borra_el_producto() {
    let mut db = base();
    let id = crear(&mut db, &poker(), 1).unwrap();
    desactivar(&db, id, 1).unwrap();

    let (existe, activo): (i64, i64) = db
        .query_row(
            "SELECT COUNT(*), MAX(activo) FROM productos WHERE id = ?1",
            [id], |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .unwrap();
    assert_eq!(existe, 1, "sigue en la base");
    assert_eq!(activo, 0, "pero ya no aparece en la caja");
}


// ---------------------------------------------------------------------
// Deshacer un ajuste mal hecho
// ---------------------------------------------------------------------

mod deshacer {
    use super::*;

    /// Deja el producto con un ajuste hecho y devuelve el id de ese
    /// movimiento, que es lo que hay que deshacer.
    fn con_ajuste(db: &mut Connection, cantidad: i64, motivo: &str) -> (i64, i64) {
        let id = crear(db, &poker(), 1).unwrap();

        // Un producto nuevo nace en cero: primero hay que tener con que.
        ajustar(db, &Ajuste {
            producto_id: id,
            cantidad: 100,
            motivo: "carga inicial".to_owned(),
            usuario_id: 1,
        })
        .unwrap();

        ajustar(db, &Ajuste {
            producto_id: id,
            cantidad,
            motivo: motivo.to_owned(),
            usuario_id: 1,
        })
        .unwrap();

        let movimiento: i64 = db
            .query_row(
                "SELECT id FROM movimientos_inventario
                 WHERE producto_id = ?1 AND tipo = 'AJUSTE'
                 ORDER BY id DESC LIMIT 1",
                rusqlite::params![id],
                |f| f.get(0),
            )
            .unwrap();
        (id, movimiento)
    }

    fn existencia(db: &Connection, producto_id: i64) -> i64 {
        db.query_row(
            "SELECT existencia FROM productos WHERE id = ?1",
            rusqlite::params![producto_id],
            |f| f.get(0),
        )
        .unwrap()
    }

    /// El caso que motivo todo esto: alguien escribe -50 donde iba -5.
    #[test]
    fn devuelve_la_existencia_a_como_estaba() {
        let mut db = base();
        let (producto, movimiento) = con_ajuste(&mut db, -50, "conteo fisico");
        let despues_del_error = existencia(&db, producto);

        deshacer_ajuste(&mut db, movimiento, "me equivoque de cantidad", 1).unwrap();

        assert_eq!(existencia(&db, producto), despues_del_error + 50);
    }

    /// No se borra: quedan los dos movimientos, el malo y el que lo
    /// deshace. El kardex cuenta lo que de verdad paso.
    #[test]
    fn el_libro_conserva_los_dos_movimientos() {
        let mut db = base();
        let (producto, movimiento) = con_ajuste(&mut db, -50, "conteo fisico");

        deshacer_ajuste(&mut db, movimiento, "me equivoque", 1).unwrap();

        // Sin contar la carga inicial que el helper deja para tener stock.
        let mut consulta = db
            .prepare(
                "SELECT cantidad_base, motivo FROM movimientos_inventario
                 WHERE producto_id = ?1 AND tipo = 'AJUSTE'
                   AND motivo NOT LIKE 'carga inicial%'
                 ORDER BY id",
            )
            .unwrap();
        let filas: Vec<(i64, String)> = consulta
            .query_map(rusqlite::params![producto], |f| Ok((f.get(0)?, f.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(filas.len(), 2, "el malo y el que lo deshace");
        assert_eq!(filas[0].0, -50);
        assert_eq!(filas[1].0, 50);
        assert!(filas[1].1.contains("Deshace"), "dice que deshace al otro");
        assert!(filas[1].1.contains("me equivoque"), "y por que");
    }

    /// Dos veces lo dejaria aplicado al reves.
    #[test]
    fn no_se_puede_deshacer_dos_veces() {
        let mut db = base();
        let (_, movimiento) = con_ajuste(&mut db, -10, "conteo");

        deshacer_ajuste(&mut db, movimiento, "error", 1).unwrap();
        let segunda = deshacer_ajuste(&mut db, movimiento, "otra vez", 1);

        assert!(matches!(segunda, Err(ErrorProducto::AjusteYaDeshecho)));
    }

    /// Los movimientos de una venta se arreglan anulando la venta, que
    /// ademas devuelve la plata. Deshacerlos por aqui dejaria la caja
    /// descuadrada sin que nadie se enterara.
    #[test]
    fn solo_deshace_ajustes_manuales() {
        let mut db = base();
        let id = crear(&mut db, &poker(), 1).unwrap();
        db.execute(
            "INSERT INTO movimientos_inventario
               (producto_id, tipo, cantidad_base, existencia_antes,
                existencia_despues, motivo, usuario_id)
             VALUES (?1, 'VENTA', -2, 10, 8, 'venta 1', 1)",
            rusqlite::params![id],
        )
        .unwrap();
        let movimiento: i64 = db
            .query_row(
                "SELECT id FROM movimientos_inventario WHERE tipo = 'VENTA'",
                [], |f| f.get(0),
            )
            .unwrap();

        let fallo = deshacer_ajuste(&mut db, movimiento, "no deberia", 1);
        assert!(matches!(fallo, Err(ErrorProducto::NoEsAjuste)));
    }

    #[test]
    fn exige_decir_por_que() {
        let mut db = base();
        let (_, movimiento) = con_ajuste(&mut db, -5, "conteo");

        let fallo = deshacer_ajuste(&mut db, movimiento, "   ", 1);
        assert!(matches!(fallo, Err(ErrorProducto::FaltaMotivo)));
    }

    /// Si ya se vendio lo que habia entrado de mas, deshacer dejaria la
    /// existencia en negativo. Ahi no hay nada que deshacer.
    #[test]
    fn no_deja_la_existencia_en_negativo() {
        let mut db = base();
        let (producto, movimiento) = con_ajuste(&mut db, 20, "aparecieron");

        // Se vende casi todo lo que habia.
        let hay = existencia(&db, producto);
        ajustar(&mut db, &Ajuste {
            producto_id: producto,
            cantidad: -(hay - 3),
            motivo: "se vendieron".to_owned(),
            usuario_id: 1,
        })
        .unwrap();

        let fallo = deshacer_ajuste(&mut db, movimiento, "error", 1);
        assert!(matches!(fallo, Err(ErrorProducto::ExistenciaNegativa)));
        assert_eq!(existencia(&db, producto), 3, "no se toco nada");
    }

    #[test]
    fn queda_en_la_auditoria_con_su_autor() {
        let mut db = base();
        let (_, movimiento) = con_ajuste(&mut db, -50, "conteo fisico");

        deshacer_ajuste(&mut db, movimiento, "me equivoque de cantidad", 1).unwrap();

        let descripcion: String = db
            .query_row(
                "SELECT descripcion FROM auditoria
                 WHERE accion = 'DESHACER_AJUSTE'",
                [], |f| f.get(0),
            )
            .unwrap();
        assert!(descripcion.contains("me equivoque de cantidad"));
    }

    #[test]
    fn un_movimiento_que_no_existe_se_rechaza() {
        let mut db = base();
        let fallo = deshacer_ajuste(&mut db, 99_999, "prueba", 1);
        assert!(matches!(fallo, Err(ErrorProducto::NoExiste)));
    }
}

/// Agregar una forma de mover el producto sin abrir la ficha entera.
///
/// El Excel del negocio solo trajo unidades y sixpacks. La canasta se
/// conoce el dia que llega, y hay que poder crearla ahi mismo.
mod agregar_una_forma {
    use super::*;

    fn con_poker() -> (Connection, i64) {
        let mut db = base();
        let id = crear(&mut db, &poker(), 1).unwrap();
        (db, id)
    }

    /// Las formas activas del producto, con su factor.
    fn formas(db: &Connection, id: i64) -> Vec<(String, i64)> {
        let mut c = db
            .prepare(
                "SELECT nombre, factor FROM producto_empaques
                 WHERE producto_id = ?1 AND activo = 1 ORDER BY orden",
            )
            .unwrap();
        c.query_map([id], |f| Ok((f.get(0)?, f.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[test]
    fn la_canasta_queda_junto_a_las_que_ya_estaban() {
        let (db, id) = con_poker();

        let e = agregar_empaque(&db, id, "Canasta", 30, Some(108_000), true, true).unwrap();

        assert_eq!(e.nombre, "Canasta");
        assert_eq!(e.factor, 30);
        assert_eq!(
            formas(&db, id),
            vec![
                ("Unidad".to_owned(), 1),
                ("Six".to_owned(), 6),
                ("Canasta".to_owned(), 30),
            ],
        );
    }

    #[test]
    fn sin_precio_sirve_para_comprar_pero_no_para_vender() {
        let (db, id) = con_poker();

        // Llego en canasta pero todavia no se decidio a como se vende.
        let e = agregar_empaque(&db, id, "Canasta", 30, None, true, true).unwrap();

        assert!(!e.para_venta, "vender sin precio obligaria a calcularlo");
        assert!(e.para_compra);

        let vendible: i64 = db
            .query_row(
                "SELECT para_venta FROM producto_empaques WHERE id = ?1",
                [e.id], |f| f.get(0),
            )
            .unwrap();
        assert_eq!(vendible, 0);
    }

    #[test]
    fn no_deja_dos_formas_con_el_mismo_nombre() {
        let (db, id) = con_poker();

        let fallo = agregar_empaque(&db, id, "six", 12, Some(40_000), true, true);

        assert!(matches!(fallo, Err(ErrorProducto::EmpaqueRepetido)),
                "«six» y «Six» son la misma forma escrita distinto");
    }

    #[test]
    fn exige_saber_cuantas_unidades_trae() {
        let (db, id) = con_poker();

        assert!(matches!(
            agregar_empaque(&db, id, "Canasta", 0, None, false, true),
            Err(ErrorProducto::FactorInvalido),
        ));
        assert!(matches!(
            agregar_empaque(&db, id, "Canasta", -3, None, false, true),
            Err(ErrorProducto::FactorInvalido),
        ));
    }

    #[test]
    fn exige_un_nombre() {
        let (db, id) = con_poker();
        assert!(matches!(
            agregar_empaque(&db, id, "   ", 30, None, false, true),
            Err(ErrorProducto::NombreVacio),
        ));
    }

    #[test]
    fn un_precio_en_cero_no_es_un_precio() {
        let (db, id) = con_poker();
        assert!(matches!(
            agregar_empaque(&db, id, "Canasta", 30, Some(0), true, true),
            Err(ErrorProducto::PrecioInvalido),
        ));
    }

    #[test]
    fn no_le_agrega_formas_a_un_producto_que_no_existe() {
        let (db, _) = con_poker();
        assert!(matches!(
            agregar_empaque(&db, 99_999, "Canasta", 30, None, false, true),
            Err(ErrorProducto::NoExiste),
        ));
    }

    #[test]
    fn la_nueva_nunca_se_vuelve_la_predeterminada() {
        let (db, id) = con_poker();

        agregar_empaque(&db, id, "Canasta", 30, Some(108_000), true, true).unwrap();

        // Si la canasta fuera la predeterminada, la caja arrancaria
        // cobrando treinta cervezas cada vez que se marca una Poker.
        let predeterminadas: Vec<String> = {
            let mut c = db
                .prepare(
                    "SELECT nombre FROM producto_empaques
                     WHERE producto_id = ?1 AND predeterminado = 1",
                )
                .unwrap();
            c.query_map([id], |f| f.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
        };
        assert_eq!(predeterminadas, vec!["Unidad".to_owned()]);
    }
}

/// El historial de precios.
///
/// Existia desde el principio y nadie lo leia; ademas solo anotaba el
/// precio principal. Lo que se protege aqui es que quede anotado todo
/// cambio -- del producto y de cada forma de venta -- y sobre todo que
/// **no se pierda al editar**: editar un producto borra sus empaques y
/// los vuelve a insertar, y la tabla los referenciaba en cascada.
mod historial_de_precios {
    use super::*;
    use crate::reportes::consultas::historial_de_precios;

    /// Los cambios anotados de un producto, del mas nuevo al mas viejo.
    fn cambios(db: &Connection, id: i64) -> Vec<(Option<String>, Option<i64>, i64)> {
        historial_de_precios(db, Some(id), 50)
            .unwrap()
            .into_iter()
            .map(|c| (c.empaque, c.precio_anterior, c.precio_nuevo))
            .collect()
    }

    /// Edita el producto aplicandole un cambio.
    fn editar_con(db: &mut Connection, id: i64, f: impl FnOnce(&mut ProductoEditable)) {
        let mut p = poker();
        p.id = Some(id);
        f(&mut p);
        editar(db, &p, 1).unwrap();
    }

    #[test]
    fn anota_el_cambio_del_precio_principal() {
        let mut db = base();
        let id = crear(&mut db, &poker(), 1).unwrap();

        editar_con(&mut db, id, |p| p.precio_venta = 4_100);

        assert_eq!(cambios(&db, id), vec![(None, Some(3_900), 4_100)]);
    }

    #[test]
    fn anota_tambien_el_de_cada_forma_de_venta() {
        let mut db = base();
        let id = crear(&mut db, &poker(), 1).unwrap();

        // Subir el six sin tocar la unidad suelta es lo normal, y hasta
        // ahora no quedaba en ninguna parte.
        editar_con(&mut db, id, |p| {
            p.empaques[1].precio_venta = Some(26_000);
        });

        assert_eq!(cambios(&db, id), vec![(Some("Six".to_owned()), Some(25_000), 26_000)]);
    }

    #[test]
    fn no_anota_nada_cuando_los_precios_no_cambian() {
        let mut db = base();
        let id = crear(&mut db, &poker(), 1).unwrap();

        // Se corrige el nombre, no el precio.
        editar_con(&mut db, id, |p| p.nombre = "POKER 330".into());

        assert!(cambios(&db, id).is_empty());
    }

    #[test]
    fn una_forma_nueva_no_es_un_cambio_de_precio() {
        let mut db = base();
        let id = crear(&mut db, &poker(), 1).unwrap();

        editar_con(&mut db, id, |p| {
            p.empaques.push(EmpaqueEditable {
                id: None, nombre: "Canasta".into(), factor: 30,
                precio_venta: Some(108_000), para_venta: true, para_compra: true,
                predeterminado: false,
            });
        });

        // Es un precio que antes no habia, no uno que subio.
        assert!(cambios(&db, id).is_empty());
    }

    #[test]
    fn editar_otra_vez_no_borra_lo_anotado() {
        let mut db = base();
        let id = crear(&mut db, &poker(), 1).unwrap();

        editar_con(&mut db, id, |p| p.empaques[1].precio_venta = Some(26_000));
        // La segunda edicion borra los empaques y los vuelve a insertar.
        // Con la referencia en cascada que habia, esto se llevaba por
        // delante el historial del six.
        editar_con(&mut db, id, |p| {
            p.precio_venta = 4_100;
            p.empaques[1].precio_venta = Some(26_000);
        });

        assert_eq!(
            cambios(&db, id),
            vec![(None, Some(3_900), 4_100), (Some("Six".to_owned()), Some(25_000), 26_000)],
            "el cambio del six de la primera edicion sigue ahi",
        );
    }

    #[test]
    fn cuenta_de_cuanto_subio_en_porcentaje() {
        let mut db = base();
        let id = crear(&mut db, &poker(), 1).unwrap();

        editar_con(&mut db, id, |p| p.precio_venta = 4_680);

        let c = &historial_de_precios(&db, Some(id), 50).unwrap()[0];
        assert_eq!(c.variacion, Some(20), "3.900 a 4.680 es 20 %");
    }

    #[test]
    fn una_bajada_sale_en_negativo() {
        let mut db = base();
        let id = crear(&mut db, &poker(), 1).unwrap();

        editar_con(&mut db, id, |p| p.precio_venta = 3_510);

        assert_eq!(historial_de_precios(&db, Some(id), 50).unwrap()[0].variacion, Some(-10));
    }

    #[test]
    fn dice_quien_lo_cambio_y_cuando() {
        let mut db = base();
        let id = crear(&mut db, &poker(), 1).unwrap();

        editar_con(&mut db, id, |p| p.precio_venta = 4_100);

        let c = &historial_de_precios(&db, Some(id), 50).unwrap()[0];
        assert_eq!(c.usuario, "Camilo");
        assert_eq!(c.producto, "POKER");
        assert!(c.fecha.len() >= 16, "fecha y hora: {}", c.fecha);
    }

    #[test]
    fn sin_producto_salen_los_de_todos() {
        let mut db = base();
        let poker_id = crear(&mut db, &poker(), 1).unwrap();
        let otro = {
            let mut p = poker();
            p.codigo = "CER-AGUILA-330B".into();
            p.nombre = "AGUILA".into();
            crear(&mut db, &p, 1).unwrap()
        };

        editar_con(&mut db, poker_id, |p| p.precio_venta = 4_100);
        {
            let mut p = poker();
            p.id = Some(otro);
            p.codigo = "CER-AGUILA-330B".into();
            p.nombre = "AGUILA".into();
            p.precio_venta = 4_000;
            editar(&mut db, &p, 1).unwrap();
        }

        // Asi se revisa «que subi este mes».
        let todos = historial_de_precios(&db, None, 50).unwrap();
        assert_eq!(todos.len(), 2);
        assert_eq!(todos[0].producto, "AGUILA", "el mas nuevo primero");
    }

    #[test]
    fn el_tope_corta_pero_deja_lo_mas_nuevo() {
        let mut db = base();
        let id = crear(&mut db, &poker(), 1).unwrap();

        for precio in [4_000, 4_100, 4_200] {
            editar_con(&mut db, id, |p| p.precio_venta = precio);
        }

        let dos = historial_de_precios(&db, Some(id), 2).unwrap();
        assert_eq!(dos.len(), 2);
        assert_eq!(dos[0].precio_nuevo, 4_200, "arriba el ultimo cambio");
    }
}
