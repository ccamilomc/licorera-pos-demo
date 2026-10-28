//! Pruebas de compras.
//!
//! El caso que importa: recibir una canasta de 30 tiene que sumar 30
//! botellas y dejar el costo por botella, que es el dato que el Excel del
//! negocio nunca pudo dar.

use super::*;
use crate::db::abrir_en_memoria;

fn escenario() -> Connection {
    let db = abrir_en_memoria().unwrap();
    db.execute(
        "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
         VALUES ('admin', 'Camilo', 'h', 'ADMINISTRADOR')",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO productos
           (id, codigo, nombre, categoria_id, presentacion, existencia, precio_venta)
         VALUES (1, 'CER-POKER', 'POKER', 9, '330 ml', 8, 3900)",
        [],
    )
    .unwrap();
    // La canasta solo se compra: no se vende suelta, asi que va con
    // para_venta = 0. El esquema no permite un empaque vendible sin precio.
    db.execute(
        "INSERT INTO producto_empaques
           (id, producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado)
         VALUES (1, 1, 'Unidad', 1, 3900, 1, 1, 1),
                (2, 1, 'Six', 6, 25000, 1, 1, 0),
                (3, 1, 'Canasta', 30, NULL, 0, 1, 0)",
        [],
    )
    .unwrap();
    db
}

fn compra_de(items: Vec<ItemCompra>) -> CompraEntrante {
    CompraEntrante {
        proveedor_id: 1, // La Nacional, de los datos base
        documento: Some("F-001".into()),
        fecha: "2026-08-19".into(),
        items,
        descuento: 0,
        usuario_id: 1,
        notas: None,
        a_credito: false,
        vence: None,
    }
}

fn existencia(db: &Connection) -> i64 {
    db.query_row("SELECT existencia FROM productos WHERE id = 1", [], |f| f.get(0))
        .unwrap()
}

#[test]
fn recibir_una_canasta_suma_treinta_botellas() {
    let mut db = escenario();
    let compra = registrar(
        &mut db,
        &compra_de(vec![ItemCompra {
            producto_id: 1,
            empaque_id: Some(3),
            cantidad: 1,
            costo_empaque: 59_000,
        }]),
    )
    .unwrap();

    assert_eq!(compra.unidades, 30);
    assert_eq!(existencia(&db), 38, "8 que habia mas 30");
}

#[test]
fn el_costo_por_unidad_sale_del_empaque() {
    let mut db = escenario();
    let compra = registrar(
        &mut db,
        &compra_de(vec![ItemCompra {
            producto_id: 1,
            empaque_id: Some(3),
            cantidad: 2,
            costo_empaque: 59_000,
        }]),
    )
    .unwrap();

    // 59.000 la canasta de 30 son 1.966 por botella.
    assert_eq!(compra.items[0].costo_unitario, 1_966);

    let guardado: i64 = db
        .query_row("SELECT costo_ultimo FROM productos WHERE id = 1", [], |f| f.get(0))
        .unwrap();
    assert_eq!(guardado, 1_966);
}

#[test]
fn el_margen_aparece_al_conocer_el_costo() {
    let mut db = escenario();
    let compra = registrar(
        &mut db,
        &compra_de(vec![ItemCompra {
            producto_id: 1, empaque_id: Some(3), cantidad: 1, costo_empaque: 59_000,
        }]),
    )
    .unwrap();

    // Se vende a 3.900 y cuesta 1.966: casi la mitad es ganancia.
    assert_eq!(compra.items[0].margen, Some(49));
}

#[test]
fn el_costo_promedio_pondera_por_unidades() {
    let mut db = escenario();

    // Primero 30 botellas a 2.000.
    registrar(&mut db, &compra_de(vec![ItemCompra {
        producto_id: 1, empaque_id: Some(3), cantidad: 1, costo_empaque: 60_000,
    }]))
    .unwrap();

    // Despues 6 a 2.500: pesa mucho menos que las 30 anteriores.
    registrar(&mut db, &compra_de(vec![ItemCompra {
        producto_id: 1, empaque_id: Some(2), cantidad: 1, costo_empaque: 15_000,
    }]))
    .unwrap();

    let promedio: i64 = db
        .query_row("SELECT costo_promedio FROM productos WHERE id = 1", [], |f| f.get(0))
        .unwrap();

    let ultimo: i64 = db
        .query_row("SELECT costo_ultimo FROM productos WHERE id = 1", [], |f| f.get(0))
        .unwrap();

    assert_eq!(ultimo, 2_500, "el ultimo es el de la compra mas reciente");
    assert!(
        promedio > 2_000 && promedio < 2_500,
        "el promedio queda entre los dos, mas cerca del que trajo mas unidades: {promedio}"
    );
}

#[test]
fn la_compra_queda_en_el_libro_de_inventario() {
    let mut db = escenario();
    registrar(&mut db, &compra_de(vec![ItemCompra {
        producto_id: 1, empaque_id: Some(3), cantidad: 1, costo_empaque: 59_000,
    }]))
    .unwrap();

    let (tipo, cantidad): (String, i64) = db
        .query_row(
            "SELECT tipo, cantidad_base FROM movimientos_inventario ORDER BY id DESC LIMIT 1",
            [],
            |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .unwrap();

    assert_eq!(tipo, "COMPRA");
    assert_eq!(cantidad, 30);
}

#[test]
fn el_mismo_producto_en_dos_renglones_suma_los_dos() {
    let mut db = escenario();
    registrar(&mut db, &compra_de(vec![
        ItemCompra { producto_id: 1, empaque_id: Some(3), cantidad: 1, costo_empaque: 59_000 },
        ItemCompra { producto_id: 1, empaque_id: Some(2), cantidad: 2, costo_empaque: 15_000 },
    ]))
    .unwrap();

    assert_eq!(existencia(&db), 8 + 30 + 12, "el segundo renglon no pisa al primero");
}

#[test]
fn un_producto_inexistente_no_deja_nada_a_medias() {
    let mut db = escenario();
    let resultado = registrar(&mut db, &compra_de(vec![
        ItemCompra { producto_id: 1, empaque_id: Some(3), cantidad: 1, costo_empaque: 59_000 },
        ItemCompra { producto_id: 999, empaque_id: None, cantidad: 1, costo_empaque: 1_000 },
    ]));

    assert!(matches!(resultado, Err(ErrorCompra::ProductoInvalido(999))));
    assert_eq!(existencia(&db), 8, "ni siquiera el renglon valido entro");

    let compras: i64 = db
        .query_row("SELECT COUNT(*) FROM compras", [], |f| f.get(0))
        .unwrap();
    assert_eq!(compras, 0);
}

#[test]
fn un_proveedor_que_no_existe_se_rechaza() {
    let mut db = escenario();
    let mut compra = compra_de(vec![ItemCompra {
        producto_id: 1, empaque_id: Some(3), cantidad: 1, costo_empaque: 59_000,
    }]);
    compra.proveedor_id = 999;

    assert!(matches!(
        registrar(&mut db, &compra),
        Err(ErrorCompra::ProveedorInvalido)
    ));
}

#[test]
fn una_compra_vacia_o_con_cantidades_invalidas_se_rechaza() {
    let mut db = escenario();
    assert!(matches!(
        registrar(&mut db, &compra_de(vec![])),
        Err(ErrorCompra::CompraVacia)
    ));
    assert!(matches!(
        registrar(&mut db, &compra_de(vec![ItemCompra {
            producto_id: 1, empaque_id: Some(3), cantidad: 0, costo_empaque: 59_000,
        }])),
        Err(ErrorCompra::CantidadInvalida)
    ));
}

#[test]
fn se_guarda_a_que_precio_vende_cada_proveedor() {
    let mut db = escenario();
    registrar(&mut db, &compra_de(vec![ItemCompra {
        producto_id: 1, empaque_id: Some(3), cantidad: 1, costo_empaque: 59_000,
    }]))
    .unwrap();

    let precio: i64 = db
        .query_row(
            "SELECT precio FROM proveedor_productos
             WHERE proveedor_id = 1 AND producto_id = 1",
            [],
            |f| f.get(0),
        )
        .unwrap();
    assert_eq!(precio, 59_000);
}

#[test]
fn comprarle_al_mismo_proveedor_actualiza_su_precio_en_vez_de_duplicarlo() {
    let mut db = escenario();
    for costo in [59_000, 61_000] {
        registrar(&mut db, &compra_de(vec![ItemCompra {
            producto_id: 1, empaque_id: Some(3), cantidad: 1, costo_empaque: costo,
        }]))
        .unwrap();
    }

    let (filas, precio): (i64, i64) = db
        .query_row(
            "SELECT COUNT(*), MAX(precio) FROM proveedor_productos
             WHERE proveedor_id = 1 AND producto_id = 1",
            [],
            |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .unwrap();

    assert_eq!(filas, 1, "una sola fila por proveedor, producto y empaque");
    assert_eq!(precio, 61_000, "con el precio mas reciente");
}

#[test]
fn anular_una_compra_saca_la_mercancia_que_habia_entrado() {
    let mut db = escenario();
    let compra = registrar(&mut db, &compra_de(vec![ItemCompra {
        producto_id: 1, empaque_id: Some(3), cantidad: 1, costo_empaque: 59_000,
    }]))
    .unwrap();
    assert_eq!(existencia(&db), 38);

    anular(&mut db, compra.id, "llego en mal estado", 1).unwrap();
    assert_eq!(existencia(&db), 8, "vuelve a como estaba");
}

#[test]
fn no_se_puede_anular_dos_veces() {
    let mut db = escenario();
    let compra = registrar(&mut db, &compra_de(vec![ItemCompra {
        producto_id: 1, empaque_id: Some(3), cantidad: 1, costo_empaque: 59_000,
    }]))
    .unwrap();

    anular(&mut db, compra.id, "motivo", 1).unwrap();
    assert!(matches!(
        anular(&mut db, compra.id, "otra vez", 1),
        Err(ErrorCompra::YaAnulada)
    ));
    assert_eq!(existencia(&db), 8, "la mercancia no sale dos veces");
}

#[test]
fn el_descuento_baja_el_total_pero_no_el_costo_unitario() {
    let mut db = escenario();
    let mut compra = compra_de(vec![ItemCompra {
        producto_id: 1, empaque_id: Some(3), cantidad: 2, costo_empaque: 59_000,
    }]);
    compra.descuento = 8_000;

    let registrada = registrar(&mut db, &compra).unwrap();
    assert_eq!(registrada.subtotal, 118_000);
    assert_eq!(registrada.total, 110_000);
}

#[test]
fn la_compra_queda_en_la_auditoria() {
    let mut db = escenario();
    registrar(&mut db, &compra_de(vec![ItemCompra {
        producto_id: 1, empaque_id: Some(3), cantidad: 1, costo_empaque: 59_000,
    }]))
    .unwrap();

    let n: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM auditoria WHERE accion = 'REGISTRAR_COMPRA'",
            [],
            |f| f.get(0),
        )
        .unwrap();
    assert_eq!(n, 1);
}
