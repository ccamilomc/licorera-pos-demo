//! Pruebas de resistencia: qué pasa cuando algo sale mal.
//!
//! Un corte de luz a media venta, un cajero intentando hacer algo que no
//! le corresponde, datos absurdos. Son los casos que el sistema promete
//! aguantar, así que hay que comprobarlos y no solo afirmarlos.

use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use tribuna_pos_lib::caja;
use tribuna_pos_lib::db;
use tribuna_pos_lib::usuarios::{self, permisos, Rol};
use tribuna_pos_lib::ventas::{self, ItemCarrito, PagoRecibido, VentaEntrante};

fn carpeta(nombre: &str) -> PathBuf {
    let ruta = std::env::temp_dir().join(format!("tribuna_resistencia_{nombre}"));
    let _ = fs::remove_dir_all(&ruta);
    fs::create_dir_all(&ruta).unwrap();
    ruta
}

/// Base en disco (no en memoria) con un producto y la caja abierta.
/// Tiene que ser en disco para que el modo WAL entre en juego.
fn negocio(ruta: &std::path::Path) -> Connection {
    let db = db::abrir_sin_catalogo(ruta).unwrap();
    db.execute(
        "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
         VALUES ('cajero', 'Cajero', 'h', 'CAJERO')",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO productos
           (id, codigo, nombre, categoria_id, presentacion, existencia, precio_venta)
         VALUES (1, 'CER-POKER', 'POKER', 9, '330 ml', 38, 3900)",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO producto_empaques (id, producto_id, nombre, factor, precio_venta, predeterminado)
         VALUES (1, 1, 'Unidad', 1, 3900, 1)",
        [],
    )
    .unwrap();
    caja::abrir(&db, 1, 100_000, None).unwrap();
    db
}

fn existencia(db: &Connection) -> i64 {
    db.query_row("SELECT existencia FROM productos WHERE id = 1", [], |f| f.get(0))
        .unwrap()
}

#[test]
fn un_corte_de_luz_a_media_transaccion_no_deja_rastro() {
    let dir = carpeta("corte_de_luz");
    let archivo = dir.join("tribuna.db");

    {
        let mut db = negocio(&archivo);

        // Una venta normal, que sí se confirma.
        ventas::registrar(
            &mut db,
            &VentaEntrante {
                items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 2, descuento: 0 }],
                pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: 7_800, recibido: None }],
                usuario_id: 1,
                notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
            },
        )
        .unwrap();
        assert_eq!(existencia(&db), 36);

        // Ahora una operación a medias: se abre transacción, se escribe y
        // NUNCA se hace commit. Soltar la conexión sin confirmar es lo
        // que pasa cuando se va la luz.
        let tx = db.transaction().unwrap();
        tx.execute("UPDATE productos SET existencia = 0 WHERE id = 1", []).unwrap();
        tx.execute(
            "INSERT INTO ventas (numero, caja_id, usuario_id, subtotal, total)
             VALUES (999, 1, 1, 50000, 50000)",
            [],
        )
        .unwrap();
        drop(tx); // se va la luz
        drop(db);
    }

    // Se vuelve a abrir, como al encender el computador de nuevo.
    let db = db::abrir_sin_catalogo(&archivo).unwrap();

    assert_eq!(
        existencia(&db), 36,
        "la venta confirmada sigue; la que quedó a medias no toco nada"
    );
    let fantasma: i64 = db
        .query_row("SELECT COUNT(*) FROM ventas WHERE numero = 999", [], |f| f.get(0))
        .unwrap();
    assert_eq!(fantasma, 0, "la venta a medias no existe");

    let ventas_reales: i64 = db
        .query_row("SELECT COUNT(*) FROM ventas", [], |f| f.get(0))
        .unwrap();
    assert_eq!(ventas_reales, 1);

    assert!(db::verificar_integridad(&db).unwrap(), "la base quedo sana");
}

#[test]
fn el_libro_de_inventario_sobrevive_al_corte() {
    let dir = carpeta("libro_tras_corte");
    let archivo = dir.join("tribuna.db");

    {
        let mut db = negocio(&archivo);
        db.execute(
            "INSERT INTO movimientos_inventario
               (producto_id, tipo, cantidad_base, existencia_antes, existencia_despues, usuario_id)
             VALUES (1, 'IMPORTACION', 38, 0, 38, 1)",
            [],
        )
        .unwrap();

        ventas::registrar(
            &mut db,
            &VentaEntrante {
                items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 3, descuento: 0 }],
                pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: 11_700, recibido: None }],
                usuario_id: 1,
                notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
            },
        )
        .unwrap();

        let tx = db.transaction().unwrap();
        tx.execute("UPDATE productos SET existencia = 999 WHERE id = 1", []).unwrap();
        drop(tx);
        drop(db);
    }

    let db = db::abrir_sin_catalogo(&archivo).unwrap();
    let descuadre: i64 = db
        .query_row("SELECT descuadre FROM v_existencia_calculada WHERE producto_id = 1", [], |f| f.get(0))
        .unwrap();
    assert_eq!(descuadre, 0, "la existencia y el libro siguen coincidiendo");
}

#[test]
fn un_cajero_no_puede_hacer_lo_que_no_le_toca() {
    let db = db::abrir_en_memoria().unwrap();

    // Lo que sí: vender y cuadrar su caja.
    for permitido in [permisos::VENTA_CREAR, permisos::CAJA_ABRIR, permisos::CAJA_CERRAR] {
        assert!(
            permisos::exigir(&db, Rol::Cajero, permitido).is_ok(),
            "el cajero deberia poder {permitido}"
        );
    }

    // Lo que no, y es lo que protege al negocio.
    for prohibido in [
        permisos::VENTA_ANULAR, permisos::INVENTARIO_AJUSTAR, permisos::PRODUCTO_PRECIO,
        permisos::COSTO_VER, permisos::UTILIDAD_VER, permisos::USUARIO_GESTIONAR,
        permisos::RESPALDO_RESTAURAR, permisos::AUDITORIA_VER, permisos::CONFIG_EDITAR,
        permisos::EXCEL_IMPORTAR,
    ] {
        assert!(
            permisos::exigir(&db, Rol::Cajero, prohibido).is_err(),
            "el cajero NO deberia poder {prohibido}"
        );
    }
}

#[test]
fn el_encargado_opera_el_local_pero_no_toca_el_dinero_de_fondo() {
    let db = db::abrir_en_memoria().unwrap();

    for permitido in [
        permisos::VENTA_ANULAR, permisos::INVENTARIO_AJUSTAR,
        permisos::COMPRA_REGISTRAR, permisos::CAJA_VER_TODAS,
    ] {
        assert!(permisos::exigir(&db, Rol::Encargado, permitido).is_ok());
    }

    for prohibido in [
        permisos::COSTO_VER, permisos::UTILIDAD_VER, permisos::PRODUCTO_PRECIO,
        permisos::USUARIO_GESTIONAR, permisos::RESPALDO_RESTAURAR,
    ] {
        assert!(
            permisos::exigir(&db, Rol::Encargado, prohibido).is_err(),
            "el encargado NO deberia poder {prohibido}"
        );
    }
}

#[test]
fn los_datos_absurdos_se_rechazan_en_vez_de_guardarse() {
    let dir = carpeta("datos_absurdos");
    let mut db = negocio(&dir.join("tribuna.db"));

    // Cantidad negativa.
    assert!(ventas::registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: -5, descuento: 0 }],
        pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: 0, recibido: None }],
        usuario_id: 1, notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
    }).is_err());

    // Descuento mayor que el renglón.
    assert!(ventas::registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 999_999 }],
        pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: 0, recibido: None }],
        usuario_id: 1, notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
    }).is_err());

    // Pago que no cuadra.
    assert!(ventas::registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
        pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: 1, recibido: None }],
        usuario_id: 1, notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
    }).is_err());

    // El precio no puede quedar negativo ni por SQL directo.
    assert!(db.execute("UPDATE productos SET precio_venta = -100 WHERE id = 1", []).is_err());

    assert_eq!(existencia(&db), 38, "nada de eso toco el inventario");
}

#[test]
fn una_contrasena_no_se_puede_leer_ni_teniendo_la_base() {
    let dir = carpeta("contrasenas");
    let db = db::abrir_sin_catalogo(&dir.join("tribuna.db")).unwrap();

    usuarios::crear(&db, "camilo", "Camilo", "mi-clave-secreta", Rol::Administrador).unwrap();

    // Alguien con el archivo en la mano solo encuentra el hash.
    let guardado: String = db
        .query_row("SELECT password_hash FROM usuarios", [], |f| f.get(0))
        .unwrap();

    assert!(!guardado.contains("mi-clave-secreta"));
    assert!(guardado.starts_with("$argon2id$"));

    // Y con el hash no se puede entrar: solo la clave original sirve.
    assert!(usuarios::autenticar(&db, "camilo", &guardado).is_err());
    assert!(usuarios::autenticar(&db, "camilo", "mi-clave-secreta").is_ok());
}

#[test]
fn la_auditoria_aguanta_aunque_se_reabra_la_base() {
    let dir = carpeta("auditoria_persistente");
    let archivo = dir.join("tribuna.db");

    {
        let db = negocio(&archivo);
        db.execute(
            "INSERT INTO auditoria (usuario_nombre, accion, entidad, descripcion)
             VALUES ('Cajero', 'PRUEBA', 'x', 'no se puede borrar')",
            [],
        )
        .unwrap();
        drop(db);
    }

    let db = db::abrir_sin_catalogo(&archivo).unwrap();
    assert!(db.execute("DELETE FROM auditoria", []).is_err());
    assert!(db
        .execute("UPDATE auditoria SET descripcion = 'alterado'", [])
        .is_err());

    let registros: i64 = db
        .query_row("SELECT COUNT(*) FROM auditoria", [], |f| f.get(0))
        .unwrap();
    assert!(registros >= 1, "el registro sigue ahi");
}

/// Los permisos que protegen las operaciones destructivas.
///
/// Esta prueba nació de una auditoría que encontró tres comandos
/// escribiendo sin comprobar permiso: importar el Excel, crear un respaldo
/// y —el peor— restaurar uno, que reemplaza la base entera.
///
/// Comprueba la tabla de permisos, que es de donde salen esas decisiones.
#[test]
fn las_operaciones_destructivas_estan_reservadas() {
    let db = db::abrir_en_memoria().unwrap();

    // Restaurar un respaldo revierte el negocio a un punto anterior:
    // es lo más destructivo que se puede hacer.
    assert!(permisos::exigir(&db, Rol::Administrador, permisos::RESPALDO_RESTAURAR).is_ok());
    assert!(permisos::exigir(&db, Rol::Encargado, permisos::RESPALDO_RESTAURAR).is_err());
    assert!(permisos::exigir(&db, Rol::Cajero, permisos::RESPALDO_RESTAURAR).is_err());

    // Importar reescribe el catálogo entero.
    assert!(permisos::exigir(&db, Rol::Administrador, permisos::EXCEL_IMPORTAR).is_ok());
    assert!(permisos::exigir(&db, Rol::Encargado, permisos::EXCEL_IMPORTAR).is_err());
    assert!(permisos::exigir(&db, Rol::Cajero, permisos::EXCEL_IMPORTAR).is_err());

    // Crear una copia no destruye nada, pero sigue siendo una operación
    // de administración.
    assert!(permisos::exigir(&db, Rol::Administrador, permisos::RESPALDO_CREAR).is_ok());
    assert!(permisos::exigir(&db, Rol::Cajero, permisos::RESPALDO_CREAR).is_err());
}

/// El costo del inventario no sale de la base para quien no puede verlo.
///
/// La segunda auditoría, sobre qué datos salen hacia la pantalla, encontró
/// que el resumen de inventario mandaba el valorizado a costo a cualquiera.
/// Un cajero no tiene por qué saber cuánto le costó la mercancía al dueño.
#[test]
fn el_costo_del_inventario_solo_lo_ve_quien_puede() {
    let db = db::abrir_en_memoria().unwrap();

    assert!(permisos::tiene(&db, Rol::Administrador, permisos::COSTO_VER).unwrap());
    assert!(!permisos::tiene(&db, Rol::Encargado, permisos::COSTO_VER).unwrap());
    assert!(!permisos::tiene(&db, Rol::Cajero, permisos::COSTO_VER).unwrap());

    // El valorizado a precio de venta sí lo puede ver cualquiera que
    // trabaje en el local: son los precios del mostrador.
    assert!(permisos::tiene(&db, Rol::Cajero, permisos::INVENTARIO_VER).unwrap());
}
