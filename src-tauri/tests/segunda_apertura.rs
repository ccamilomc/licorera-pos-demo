//! Qué pasa la segunda vez que se abre el programa.
//!
//! El primer arranque crea la base y se prueba en todos lados. Lo que no
//! se había probado es el caso de todos los días: abrir una base que ya
//! tiene el negocio adentro, con ventas, usuarios y una caja a medio
//! turno.

use std::fs;
use std::path::PathBuf;

use tribuna_pos_lib::caja;
use tribuna_pos_lib::db;
use tribuna_pos_lib::inventario::importacion::{aplicar, PlanEntrante};
use tribuna_pos_lib::usuarios::{self, Rol};
use tribuna_pos_lib::ventas::{self, ItemCarrito, PagoRecibido, VentaEntrante};

fn carpeta(nombre: &str) -> PathBuf {
    let ruta = std::env::temp_dir().join(format!("tribuna_segunda_{nombre}"));
    let _ = fs::remove_dir_all(&ruta);
    fs::create_dir_all(&ruta).unwrap();
    ruta
}

#[test]
fn abrir_una_base_que_ya_tiene_el_negocio_adentro() {
    let dir = carpeta("con_datos");
    let archivo = dir.join("tribuna.db");

    // --- Primer arranque: se monta el negocio ---
    let (usuario_id, poker_id, existencia_inicial) = {
        let mut db = db::abrir_sin_catalogo(&archivo).unwrap();

        let admin = usuarios::crear(&db, "camilo", "Camilo", "clave-larga", Rol::Administrador)
            .unwrap();

        let plan: PlanEntrante =
            serde_json::from_str(include_str!("plan-real.json")).unwrap();
        aplicar(&mut db, &plan, admin.id).unwrap();

        caja::abrir(&db, admin.id, 100_000, None).unwrap();

        let (id, existencia): (i64, i64) = db
            .query_row(
                "SELECT id, existencia FROM productos WHERE nombre = 'POKER' AND volumen_ml = 330",
                [],
                |f| Ok((f.get(0)?, f.get(1)?)),
            )
            .unwrap();

        let empaque: i64 = db
            .query_row(
                "SELECT id FROM producto_empaques WHERE producto_id = ?1 AND nombre = 'Unidad'",
                [id],
                |f| f.get(0),
            )
            .unwrap();

        ventas::registrar(
            &mut db,
            &VentaEntrante {
                items: vec![ItemCarrito { producto_id: id, empaque_id: Some(empaque), cantidad: 2, descuento: 0 }],
                pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: 7_800, recibido: None }],
                usuario_id: admin.id,
                notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
            },
        )
        .unwrap();

        (admin.id, id, existencia)
    }; // se cierra el programa

    // --- Segundo arranque: todo tiene que seguir ahí ---
    let db = db::abrir_sin_catalogo(&archivo).unwrap();

    // Las migraciones no se vuelven a aplicar ni duplican nada.
    let categorias: i64 = db
        .query_row("SELECT COUNT(*) FROM categorias", [], |f| f.get(0))
        .unwrap();
    assert_eq!(categorias, 12, "las categorias no se duplicaron");

    // El usuario sigue y su contraseña sigue sirviendo.
    let entrada = usuarios::autenticar(&db, "camilo", "clave-larga").unwrap();
    assert_eq!(entrada.id, usuario_id);

    // El inventario sigue, con la venta ya descontada.
    let existencia: i64 = db
        .query_row("SELECT existencia FROM productos WHERE id = ?1", [poker_id], |f| f.get(0))
        .unwrap();
    assert_eq!(existencia, existencia_inicial - 2);

    // La caja quedó abierta: el turno continúa donde se dejó.
    let abierta = caja::abierta(&db).unwrap();
    assert!(abierta.is_some(), "la caja sigue abierta tras reabrir");
    assert_eq!(abierta.unwrap().base_inicial, 100_000);

    // Y la venta está en su sitio.
    let ventas_guardadas: i64 = db
        .query_row("SELECT COUNT(*) FROM ventas WHERE estado = 'COMPLETADA'", [], |f| f.get(0))
        .unwrap();
    assert_eq!(ventas_guardadas, 1);

    assert!(db::verificar_integridad(&db).unwrap());
}

#[test]
fn el_turno_continua_donde_se_dejo() {
    let dir = carpeta("turno_a_medias");
    let archivo = dir.join("tribuna.db");

    let esperado_antes = {
        let mut db = db::abrir_sin_catalogo(&archivo).unwrap();
        let admin = usuarios::crear(&db, "camilo", "Camilo", "clave-larga", Rol::Administrador)
            .unwrap();
        let plan: PlanEntrante = serde_json::from_str(include_str!("plan-real.json")).unwrap();
        aplicar(&mut db, &plan, admin.id).unwrap();

        let caja_hoy = caja::abrir(&db, admin.id, 100_000, None).unwrap();

        let (producto, empaque): (i64, i64) = db
            .query_row(
                "SELECT p.id, e.id FROM productos p
                 JOIN producto_empaques e ON e.producto_id = p.id
                 WHERE p.nombre = 'POKER' AND p.volumen_ml = 330 AND e.nombre = 'Unidad'",
                [],
                |f| Ok((f.get(0)?, f.get(1)?)),
            )
            .unwrap();

        for _ in 0..3 {
            ventas::registrar(
                &mut db,
                &VentaEntrante {
                    items: vec![ItemCarrito { producto_id: producto, empaque_id: Some(empaque), cantidad: 1, descuento: 0 }],
                    pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: 3_900, recibido: None }],
                    usuario_id: admin.id,
                    notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
                },
            )
            .unwrap();
        }

        caja::resumen(&db, caja_hoy.id).unwrap().efectivo_esperado
    };

    // Se apaga el computador a media jornada y se vuelve a abrir.
    let db = db::abrir_sin_catalogo(&archivo).unwrap();
    let caja_hoy = caja::abierta(&db).unwrap().expect("la caja sigue abierta");
    let esperado_despues = caja::resumen(&db, caja_hoy.id).unwrap().efectivo_esperado;

    assert_eq!(
        esperado_despues, esperado_antes,
        "el arqueo cuenta lo mismo antes y despues de reabrir"
    );
    assert_eq!(esperado_antes, 100_000 + 3 * 3_900);
}

#[test]
fn una_base_de_otro_programa_no_se_da_por_buena() {
    let dir = carpeta("base_ajena");
    let ajena = dir.join("otra.db");

    // Una base de SQLite válida, pero que no es de este programa.
    {
        let otra = rusqlite::Connection::open(&ajena).unwrap();
        otra.execute("CREATE TABLE cosas (id INTEGER PRIMARY KEY)", []).unwrap();
    }

    // El verificador de respaldos la rechaza: está intacta pero no sirve.
    assert!(
        !tribuna_pos_lib::respaldo::verificar(&ajena).unwrap(),
        "una base ajena no es un respaldo valido"
    );
}
