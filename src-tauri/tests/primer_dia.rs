//! El primer dia del negocio con el programa instalado.
//!
//! Comprueba lo que pasa entre que alguien hace doble clic en el
//! instalador y la primera venta: que el catalogo este cargado, que al
//! crear la cuenta el inventario quede cuadrado contra el libro, y que se
//! pueda cobrar sin haber configurado nada.
//!
//! Es la unica prueba que corre sobre la base tal como la recibe el
//! usuario, con sus ciento cincuenta y cuatro productos dentro.

use std::fs;
use std::path::PathBuf;

use tribuna_pos_lib::caja;
use tribuna_pos_lib::db;
use tribuna_pos_lib::ventas::{self, ItemCarrito, PagoRecibido, VentaEntrante};

/// Carpeta propia por prueba: corren en paralelo y no pueden pisarse.
fn carpeta(nombre: &str) -> PathBuf {
    let ruta = std::env::temp_dir().join(format!("tribuna_primer_dia_{nombre}"));
    let _ = fs::remove_dir_all(&ruta);
    fs::create_dir_all(&ruta).unwrap();
    ruta
}

/// La base como queda al instalar: migrada entera, sin tocar.
fn recien_instalado(nombre: &str) -> rusqlite::Connection {
    db::abrir(&carpeta(nombre).join("tribuna.db")).unwrap()
}

#[test]
fn el_catalogo_esta_listo_antes_de_crear_la_cuenta() {
    let db = recien_instalado("catalogo");

    let productos: i64 = db
        .query_row("SELECT COUNT(*) FROM productos WHERE activo = 1", [], |f| f.get(0))
        .unwrap();
    let vendibles: i64 = db
        .query_row(
            "SELECT COUNT(DISTINCT producto_id) FROM producto_empaques
             WHERE para_venta = 1 AND precio_venta > 0",
            [], |f| f.get(0),
        )
        .unwrap();

    assert_eq!(productos, 26, "los productos de ejemplo");
    assert_eq!(vendibles, 26, "todos se pueden cobrar");
}

/// Al crear la cuenta, la existencia que traia el catalogo entra al libro
/// a nombre de quien estrena el sistema. Sin esto, la existencia guardada
/// y la calculada no coincidirian nunca.
#[test]
fn crear_la_cuenta_cuadra_el_inventario_con_el_libro() {
    let db = recien_instalado("cuadra");

    let antes: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM v_existencia_calculada
             WHERE descuadre <> 0",
            [], |f| f.get(0),
        )
        .unwrap();
    assert!(antes > 0, "recien instalado, el libro esta vacio");

    // Lo que hace la pantalla de bienvenida.
    let creado = tribuna_pos_lib::usuarios::crear(
        &db, "camilo", "Camilo", "clave-larga-1", tribuna_pos_lib::usuarios::Rol::Administrador,
    )
    .unwrap();
    db.execute(
        "INSERT INTO movimientos_inventario
           (producto_id, tipo, cantidad_base, existencia_antes, existencia_despues,
            referencia_tipo, motivo, usuario_id)
         SELECT p.id, 'IMPORTACION', p.existencia, 0, p.existencia,
                'IMPORTACION', 'Existencia inicial del catalogo', ?1
         FROM productos p
         WHERE p.existencia > 0
           AND NOT EXISTS (
             SELECT 1 FROM movimientos_inventario m WHERE m.producto_id = p.id)",
        rusqlite::params![creado.id],
    )
    .unwrap();

    let despues: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM v_existencia_calculada WHERE descuadre <> 0",
            [], |f| f.get(0),
        )
        .unwrap();
    assert_eq!(despues, 0, "cada unidad del inventario tiene su asiento");
}

/// Del instalador a la primera venta sin configurar nada.
#[test]
fn se_puede_vender_el_primer_dia() {
    let mut db = recien_instalado("vender");

    let creado = tribuna_pos_lib::usuarios::crear(
        &db, "camilo", "Camilo", "clave-larga-1", tribuna_pos_lib::usuarios::Rol::Administrador,
    )
    .unwrap();
    caja::abrir(&db, creado.id, 100_000, None).unwrap();

    // Un producto cualquiera del catalogo, con su forma de venta.
    let (producto_id, empaque_id, precio): (i64, i64, i64) = db
        .query_row(
            "SELECT p.id, e.id, e.precio_venta
             FROM productos p
             JOIN producto_empaques e ON e.producto_id = p.id
             WHERE p.existencia > 5 AND e.para_venta = 1 AND e.precio_venta > 0
               AND e.factor = 1
             ORDER BY p.id LIMIT 1",
            [], |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)),
        )
        .unwrap();

    let antes: i64 = db
        .query_row(
            "SELECT existencia FROM productos WHERE id = ?1",
            rusqlite::params![producto_id], |f| f.get(0),
        )
        .unwrap();

    let venta = ventas::registrar(
        &mut db,
        &VentaEntrante {
            items: vec![ItemCarrito {
                producto_id, empaque_id: Some(empaque_id), cantidad: 2, descuento: 0,
            }],
            pagos: vec![PagoRecibido {
                metodo_pago_id: 1, monto: precio * 2, recibido: Some(precio * 2),
            }],
            usuario_id: creado.id,
            notas: None,
            recargo: None,
            cliente_id: None,
            cliente_nombre: None,
        },
    )
    .unwrap();

    assert_eq!(venta.total, precio * 2);

    let despues: i64 = db
        .query_row(
            "SELECT existencia FROM productos WHERE id = ?1",
            rusqlite::params![producto_id], |f| f.get(0),
        )
        .unwrap();
    assert_eq!(despues, antes - 2, "el inventario baja lo que se vendio");
}

/// Los productos que el Excel dejo dudosos siguen ahi, marcados, para que
/// el dueño los resuelva desde la ficha cuando pueda.
#[test]
fn los_dudosos_estan_marcados_y_no_estorban_para_vender() {
    let db = recien_instalado("dudosos");

    let (dudosos, vendibles): (i64, i64) = db
        .query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN EXISTS (
                      SELECT 1 FROM producto_empaques e
                      WHERE e.producto_id = p.id AND e.para_venta = 1
                        AND e.precio_venta > 0) THEN 1 ELSE 0 END)
             FROM productos p WHERE p.revisar = 1",
            [], |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .unwrap();

    assert!(dudosos > 0, "el Excel dejo casos sin resolver");
    assert_eq!(dudosos, vendibles, "pero se pueden cobrar igual");
}
