//! Un día completo de La Tribuna, de principio a fin.
//!
//! Importa el inventario real del negocio, abre la caja, vende, anula una
//! venta, saca dinero para un domicilio y cierra cuadrando. Es la prueba
//! que responde a la pregunta que importa: ¿esto sirve para trabajar?

use tribuna_pos_lib::caja::{self, TipoMovimiento};
use tribuna_pos_lib::db;
use tribuna_pos_lib::inventario::importacion::{aplicar, PlanEntrante};
use tribuna_pos_lib::usuarios::{self, Rol};
use tribuna_pos_lib::ventas::{self, ItemCarrito, PagoRecibido, VentaEntrante};

const EFECTIVO: i64 = 1;
const TRANSFERENCIA: i64 = 2;

/// Base con el negocio cargado desde el Excel real y un cajero listo.
fn negocio_abierto() -> (rusqlite::Connection, i64) {
    let mut db = db::abrir_en_memoria().expect("la base debe abrir");

    let admin = usuarios::crear(&db, "camilo", "Camilo", "clave-seguraaa", Rol::Administrador)
        .expect("el administrador debe crearse");

    let plan: PlanEntrante =
        serde_json::from_str(include_str!("plan-real.json")).expect("el plan debe leerse");
    aplicar(&mut db, &plan, admin.id).expect("el inventario debe importarse");

    (db, admin.id)
}

fn buscar(db: &rusqlite::Connection, nombre: &str, ml: i64) -> (i64, i64) {
    db.query_row(
        "SELECT id, existencia FROM productos WHERE nombre = ?1 AND volumen_ml = ?2",
        rusqlite::params![nombre, ml],
        |f| Ok((f.get(0)?, f.get(1)?)),
    )
    .unwrap_or_else(|e| panic!("deberia existir {nombre} de {ml} ml: {e}"))
}

fn empaque(db: &rusqlite::Connection, producto_id: i64, nombre: &str) -> (i64, i64) {
    db.query_row(
        "SELECT id, precio_venta FROM producto_empaques
         WHERE producto_id = ?1 AND nombre = ?2",
        rusqlite::params![producto_id, nombre],
        |f| Ok((f.get(0)?, f.get(1)?)),
    )
    .unwrap_or_else(|e| panic!("{nombre} deberia existir para el producto {producto_id}: {e}"))
}

fn existencia(db: &rusqlite::Connection, id: i64) -> i64 {
    db.query_row("SELECT existencia FROM productos WHERE id = ?1", [id], |f| {
        f.get(0)
    })
    .unwrap()
}

#[test]
fn un_dia_completo_de_trabajo() {
    let (mut db, usuario) = negocio_abierto();

    // --- Se abre la caja con la base del dia ---
    let caja_hoy = caja::abrir(&db, usuario, 100_000, Some("turno de la tarde")).unwrap();

    let (poker, poker_inicial) = buscar(&db, "POKER", 330);
    let (poker_six, precio_six) = empaque(&db, poker, "Six");
    let (poker_unidad, precio_unidad) = empaque(&db, poker, "Unidad");
    assert_eq!(poker_inicial, 38, "8 sueltas mas 5 six, como en el Excel");
    assert_eq!(precio_six, 25_000);
    assert_eq!(precio_unidad, 3_900);

    // --- Venta 1: un six y dos botellas sueltas, en efectivo ---
    let venta1 = ventas::registrar(
        &mut db,
        &VentaEntrante {
            items: vec![
                ItemCarrito { producto_id: poker, empaque_id: Some(poker_six), cantidad: 1, descuento: 0 },
                ItemCarrito { producto_id: poker, empaque_id: Some(poker_unidad), cantidad: 2, descuento: 0 },
            ],
            pagos: vec![PagoRecibido {
                metodo_pago_id: EFECTIVO,
                monto: 32_800,
                recibido: Some(50_000),
            }],
            usuario_id: usuario,
            notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
        },
    )
    .unwrap();

    assert_eq!(venta1.total, 32_800, "25.000 del six mas 7.800 de las dos sueltas");
    assert_eq!(venta1.cambio, 17_200);
    assert_eq!(existencia(&db, poker), 30, "38 menos 6 del six menos 2 sueltas");

    // --- Venta 2: aguardiente por transferencia ---
    let (aguardiente, _) = buscar(&db, "ANTIOQUEÑO AZUL", 750);
    let (aguardiente_unidad, precio_aguardiente) = empaque(&db, aguardiente, "Unidad");

    let venta2 = ventas::registrar(
        &mut db,
        &VentaEntrante {
            items: vec![ItemCarrito {
                producto_id: aguardiente,
                empaque_id: Some(aguardiente_unidad),
                cantidad: 1,
                descuento: 0,
            }],
            pagos: vec![PagoRecibido {
                metodo_pago_id: TRANSFERENCIA,
                monto: precio_aguardiente,
                recibido: None,
            }],
            usuario_id: usuario,
            notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
        },
    )
    .unwrap();

    // --- Venta 3: cigarrillos, que las hojas BD_ habian perdido ---
    let cigarrillos: i64 = db
        .query_row(
            "SELECT p.id FROM productos p JOIN categorias c ON c.id = p.categoria_id
             WHERE c.nombre = 'Cigarrillos' LIMIT 1",
            [],
            |f| f.get(0),
        )
        .expect("los cigarrillos deben estar en el sistema");
    let (cig_empaque, precio_cig) = empaque(&db, cigarrillos, "Unidad");

    let venta3 = ventas::registrar(
        &mut db,
        &VentaEntrante {
            items: vec![ItemCarrito {
                producto_id: cigarrillos,
                empaque_id: Some(cig_empaque),
                cantidad: 2,
                descuento: 0,
            }],
            pagos: vec![PagoRecibido {
                metodo_pago_id: EFECTIVO,
                monto: precio_cig * 2,
                recibido: Some(20_000),
            }],
            usuario_id: usuario,
            notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
        },
    )
    .unwrap();

    // --- Se anula la venta 3: el cliente se arrepintio ---
    let cig_antes = existencia(&db, cigarrillos);
    ventas::anular(&mut db, venta3.id, "el cliente se arrepintio", usuario, None).unwrap();
    assert_eq!(
        existencia(&db, cigarrillos),
        cig_antes + 2,
        "vuelven las dos cajetillas"
    );

    // --- Sale dinero para un domicilio ---
    caja::registrar_movimiento(
        &db, caja_hoy.id, TipoMovimiento::Salida, "domicilio", 6_000, usuario,
    )
    .unwrap();

    // --- Cierre del turno ---
    let resumen = caja::resumen(&db, caja_hoy.id).unwrap();

    assert_eq!(resumen.ventas_cantidad, 2, "la anulada ya no cuenta");
    assert_eq!(resumen.ventas_total, venta1.total + venta2.total);

    // En el cajon hay: base + lo cobrado en efectivo - la salida.
    // La transferencia no pone un peso en el cajon, y la venta anulada
    // devolvio su efectivo.
    let esperado = 100_000 + venta1.total - 6_000;
    assert_eq!(
        resumen.efectivo_esperado, esperado,
        "el efectivo esperado no incluye la transferencia ni la venta anulada"
    );

    // El cajero cuenta y cuadra.
    let cierre = caja::cerrar(&db, caja_hoy.id, esperado, usuario, None).unwrap();
    assert_eq!(cierre.diferencia, 0);
    assert!(caja::abierta(&db).unwrap().is_none(), "la caja quedo cerrada");
}

#[test]
fn el_libro_de_inventario_cuadra_al_final_del_dia() {
    let (mut db, usuario) = negocio_abierto();
    caja::abrir(&db, usuario, 100_000, None).unwrap();

    let (poker, _) = buscar(&db, "POKER", 330);
    let (six, precio_six) = empaque(&db, poker, "Six");

    for _ in 0..3 {
        ventas::registrar(
            &mut db,
            &VentaEntrante {
                items: vec![ItemCarrito { producto_id: poker, empaque_id: Some(six), cantidad: 1, descuento: 0 }],
                pagos: vec![PagoRecibido { metodo_pago_id: EFECTIVO, monto: precio_six, recibido: None }],
                usuario_id: usuario,
                notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
            },
        )
        .unwrap();
    }

    // Tras un dia de ventas, la existencia guardada y la suma del libro
    // tienen que seguir coincidiendo en TODOS los productos.
    let descuadrados: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM v_existencia_calculada WHERE descuadre <> 0",
            [],
            |f| f.get(0),
        )
        .unwrap();
    assert_eq!(descuadrados, 0, "ningun producto puede quedar descuadrado");

    assert_eq!(existencia(&db, poker), 38 - 18, "tres six son 18 botellas");
}

#[test]
fn el_dia_queda_completo_en_la_auditoria() {
    let (mut db, usuario) = negocio_abierto();
    let caja_hoy = caja::abrir(&db, usuario, 100_000, None).unwrap();

    let (poker, _) = buscar(&db, "POKER", 330);
    let (unidad, precio) = empaque(&db, poker, "Unidad");

    let venta = ventas::registrar(
        &mut db,
        &VentaEntrante {
            items: vec![ItemCarrito { producto_id: poker, empaque_id: Some(unidad), cantidad: 1, descuento: 0 }],
            pagos: vec![PagoRecibido { metodo_pago_id: EFECTIVO, monto: precio, recibido: None }],
            usuario_id: usuario,
            notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
        },
    )
    .unwrap();
    ventas::anular(&mut db, venta.id, "prueba", usuario, None).unwrap();
    caja::cerrar(&db, caja_hoy.id, 100_000, usuario, None).unwrap();

    // Cada operacion sensible del dia dejo su rastro.
    for accion in ["IMPORTAR", "ABRIR_CAJA", "ANULAR_VENTA", "CERRAR_CAJA"] {
        let n: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM auditoria WHERE accion = ?1",
                [accion],
                |f| f.get(0),
            )
            .unwrap();
        assert!(n >= 1, "deberia haber registro de {accion}");
    }

    // Y nadie puede borrarlo.
    assert!(db.execute("DELETE FROM auditoria", []).is_err());
}

#[test]
fn el_sistema_aguanta_un_ano_de_ventas() {
    let (mut db, usuario) = negocio_abierto();
    caja::abrir(&db, usuario, 100_000, None).unwrap();

    let (poker, _) = buscar(&db, "POKER", 330);
    let (unidad, precio) = empaque(&db, poker, "Unidad");

    // Se repone existencia para poder vender mucho sin quedar en negativo.
    db.execute(
        "UPDATE productos SET existencia = 100000 WHERE id = ?1",
        [poker],
    )
    .unwrap();

    // Unas 2.000 ventas: mas de lo que una licorera hace en un año de
    // fines de semana.
    for _ in 0..2_000 {
        ventas::registrar(
            &mut db,
            &VentaEntrante {
                items: vec![ItemCarrito { producto_id: poker, empaque_id: Some(unidad), cantidad: 1, descuento: 0 }],
                pagos: vec![PagoRecibido { metodo_pago_id: EFECTIVO, monto: precio, recibido: None }],
                usuario_id: usuario,
                notas: None,
        recargo: None,
        cliente_id: None,
        cliente_nombre: None,
            },
        )
        .unwrap();
    }

    let inicio = std::time::Instant::now();
    let total: i64 = db
        .query_row(
            "SELECT COALESCE(SUM(total), 0) FROM ventas WHERE estado = 'COMPLETADA'",
            [],
            |f| f.get(0),
        )
        .unwrap();
    let consulta = inicio.elapsed();

    assert_eq!(total, precio * 2_000);
    assert!(
        consulta.as_millis() < 100,
        "el resumen de ventas tardo {consulta:?}; deberia ser instantaneo"
    );

    // Y la caja sigue cuadrando con 2.000 ventas encima.
    let caja_id = caja::abierta(&db).unwrap().unwrap().id;
    let resumen = caja::resumen(&db, caja_id).unwrap();
    assert_eq!(resumen.ventas_cantidad, 2_000);
    assert_eq!(resumen.efectivo_esperado, 100_000 + precio * 2_000);
}
