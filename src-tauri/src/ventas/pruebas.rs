//! Pruebas de venta y anulacion.
//!
//! Lo que se comprueba aqui es lo que duele si falla: que el inventario
//! baje exactamente lo que se vendio, que un six descuente seis, que una
//! venta interrumpida no deje rastro, y que anular devuelva la mercancia
//! justa.

use super::*;
use crate::caja::{self, TipoMovimiento};
use crate::db::abrir_en_memoria;

/// Base con un cajero, caja abierta y Poker con sus dos formas de venta.
fn escenario() -> Connection {
    let db = abrir_en_memoria().unwrap();
    db.execute(
        "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
         VALUES ('cajero', 'Cajero', 'h', 'CAJERO')",
        [],
    )
    .unwrap();

    db.execute(
        "INSERT INTO productos
           (id, codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
            existencia, precio_venta, costo_promedio)
         VALUES (1, 'CER-POKER-330B', 'POKER', 9, '330 ml', 330, 'BOTELLA', 38, 3900, 2100)",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO producto_empaques
           (id, producto_id, nombre, factor, precio_venta, predeterminado, orden)
         VALUES (1, 1, 'Unidad', 1, 3900, 1, 1), (2, 1, 'Six', 6, 25000, 0, 2)",
        [],
    )
    .unwrap();

    caja::abrir(&db, 1, 100_000, None).unwrap();
    db
}

fn efectivo(monto: i64, recibido: Option<i64>) -> PagoRecibido {
    PagoRecibido { metodo_pago_id: 1, monto, recibido }
}

fn existencia(db: &Connection) -> i64 {
    db.query_row("SELECT existencia FROM productos WHERE id = 1", [], |f| f.get(0))
        .unwrap()
}

#[test]
fn vender_tres_unidades_descuenta_exactamente_tres() {
    let mut db = escenario();
    let venta = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 3, descuento: 0 }],
        pagos: vec![efectivo(11_700, Some(20_000))],
        usuario_id: 1,
        notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    assert_eq!(venta.total, 11_700);
    assert_eq!(venta.cambio, 8_300);
    assert_eq!(existencia(&db), 35, "38 menos 3");
}

#[test]
fn vender_un_six_descuenta_seis_botellas_no_una() {
    let mut db = escenario();
    let venta = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(2), cantidad: 1, descuento: 0 }],
        pagos: vec![efectivo(25_000, None)],
        usuario_id: 1,
        notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    assert_eq!(venta.total, 25_000, "el precio del six, no seis veces el unitario");
    assert_eq!(venta.items[0].unidades_base, 6);
    assert_eq!(existencia(&db), 32, "38 menos 6");
}

#[test]
fn se_puede_vender_unidades_y_six_en_la_misma_venta() {
    let mut db = escenario();
    let venta = registrar(&mut db, &VentaEntrante {
        items: vec![
            ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 2, descuento: 0 },
            ItemCarrito { producto_id: 1, empaque_id: Some(2), cantidad: 1, descuento: 0 },
        ],
        pagos: vec![efectivo(32_800, None)],
        usuario_id: 1,
        notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    assert_eq!(venta.total, 2 * 3_900 + 25_000);
    assert_eq!(existencia(&db), 30, "38 menos 2 menos 6");
}

#[test]
fn sin_empaque_se_usa_el_predeterminado() {
    let mut db = escenario();
    let venta = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: None, cantidad: 1, descuento: 0 }],
        pagos: vec![efectivo(3_900, None)],
        usuario_id: 1,
        notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();
    assert_eq!(venta.items[0].empaque, "Unidad");
}

#[test]
fn el_libro_de_inventario_cuadra_despues_de_vender() {
    let mut db = escenario();
    // Carga inicial en el libro para que la comparacion sea justa.
    db.execute(
        "INSERT INTO movimientos_inventario
           (producto_id, tipo, cantidad_base, existencia_antes, existencia_despues, usuario_id)
         VALUES (1, 'IMPORTACION', 38, 0, 38, 1)",
        [],
    )
    .unwrap();

    registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(2), cantidad: 2, descuento: 0 }],
        pagos: vec![efectivo(50_000, None)],
        usuario_id: 1,
        notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    let descuadre: i64 = db
        .query_row("SELECT descuadre FROM v_existencia_calculada WHERE producto_id = 1", [], |f| f.get(0))
        .unwrap();
    assert_eq!(descuadre, 0);
}

#[test]
fn si_el_pago_no_cuadra_no_se_registra_nada() {
    let mut db = escenario();
    let resultado = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 3, descuento: 0 }],
        pagos: vec![efectivo(10_000, None)],
        usuario_id: 1,
        notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    });

    assert!(matches!(resultado, Err(ErrorVenta::PagoNoCuadra { .. })));
    assert_eq!(existencia(&db), 38, "el inventario no se toco");

    let ventas: i64 = db.query_row("SELECT COUNT(*) FROM ventas", [], |f| f.get(0)).unwrap();
    assert_eq!(ventas, 0, "no quedo media venta");
}

#[test]
fn un_producto_inexistente_deja_el_inventario_intacto() {
    let mut db = escenario();
    let resultado = registrar(&mut db, &VentaEntrante {
        items: vec![
            ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 2, descuento: 0 },
            ItemCarrito { producto_id: 999, empaque_id: None, cantidad: 1, descuento: 0 },
        ],
        pagos: vec![efectivo(7_800, None)],
        usuario_id: 1,
        notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    });

    assert!(matches!(resultado, Err(ErrorVenta::ProductoInvalido(999))));
    assert_eq!(existencia(&db), 38, "ni siquiera el renglon valido se aplico");
}

#[test]
fn no_se_puede_vender_sin_caja_abierta() {
    let mut db = escenario();
    let caja_id = caja::abierta(&db).unwrap().unwrap().id;
    caja::cerrar(&db, caja_id, 100_000, 1, None).unwrap();

    let resultado = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
        pagos: vec![efectivo(3_900, None)],
        usuario_id: 1,
        notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    });
    assert!(matches!(resultado, Err(ErrorVenta::SinCajaAbierta)));
}

#[test]
fn una_venta_vacia_se_rechaza() {
    let mut db = escenario();
    assert!(matches!(
        registrar(&mut db, &VentaEntrante {
            items: vec![], pagos: vec![], usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
        }),
        Err(ErrorVenta::VentaVacia)
    ));
}

#[test]
fn una_cantidad_en_cero_o_negativa_se_rechaza() {
    let mut db = escenario();
    for cantidad in [0, -2] {
        assert!(matches!(
            registrar(&mut db, &VentaEntrante {
                items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad, descuento: 0 }],
                pagos: vec![efectivo(0, None)],
                usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
            }),
            Err(ErrorVenta::CantidadInvalida)
        ));
    }
}

#[test]
fn un_descuento_mayor_que_el_renglon_se_rechaza() {
    let mut db = escenario();
    let resultado = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 5_000 }],
        pagos: vec![efectivo(0, None)],
        usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    });
    assert!(matches!(resultado, Err(ErrorVenta::DescuentoExcesivo)));
}

#[test]
fn vender_sin_existencia_no_bloquea_pero_queda_marcado() {
    let mut db = escenario();
    db.execute("UPDATE productos SET existencia = 1 WHERE id = 1", []).unwrap();

    // El cajero tiene las botellas en la mano: la existencia esta mal.
    let venta = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 5, descuento: 0 }],
        pagos: vec![efectivo(19_500, None)],
        usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    assert!(venta.con_faltante, "queda para el reporte de descuadres");
    assert_eq!(existencia(&db), -4, "refleja lo que de verdad paso");
}

#[test]
fn los_numeros_de_venta_no_se_repiten() {
    let mut db = escenario();
    let mut numeros = Vec::new();
    for _ in 0..3 {
        let v = registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
            pagos: vec![efectivo(3_900, None)],
            usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
        })
        .unwrap();
        numeros.push(v.numero);
    }
    assert_eq!(numeros, vec![1, 2, 3]);
}

#[test]
fn el_precio_queda_congelado_en_la_venta() {
    let mut db = escenario();
    registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
        pagos: vec![efectivo(3_900, None)],
        usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    // Sube el precio despues de vender.
    db.execute("UPDATE productos SET precio_venta = 4500 WHERE id = 1", []).unwrap();
    db.execute("UPDATE producto_empaques SET precio_venta = 4500 WHERE id = 1", []).unwrap();

    let cobrado: i64 = db
        .query_row("SELECT precio_unitario FROM venta_items WHERE venta_id = 1", [], |f| f.get(0))
        .unwrap();
    assert_eq!(cobrado, 3_900, "la venta de ayer no se reescribe");
}

#[test]
fn el_pago_mixto_se_reparte_por_metodo() {
    let mut db = escenario();
    registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(2), cantidad: 1, descuento: 0 }],
        pagos: vec![
            efectivo(10_000, None),
            PagoRecibido { metodo_pago_id: 2, monto: 15_000, recibido: None },
        ],
        usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    let pagos: i64 = db
        .query_row("SELECT COUNT(*) FROM venta_pagos WHERE venta_id = 1", [], |f| f.get(0))
        .unwrap();
    assert_eq!(pagos, 2);
}

#[test]
fn la_caja_solo_espera_el_efectivo_no_las_transferencias() {
    let mut db = escenario();
    let caja_id = caja::abierta(&db).unwrap().unwrap().id;

    registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(2), cantidad: 1, descuento: 0 }],
        pagos: vec![PagoRecibido { metodo_pago_id: 2, monto: 25_000, recibido: None }],
        usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    let r = caja::resumen(&db, caja_id).unwrap();
    assert_eq!(r.ventas_total, 25_000);
    assert_eq!(r.efectivo_esperado, 100_000, "la transferencia no entra al cajon");
}

#[test]
fn anular_devuelve_la_mercancia_exacta() {
    let mut db = escenario();
    let venta = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(2), cantidad: 2, descuento: 0 }],
        pagos: vec![efectivo(50_000, None)],
        usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();
    assert_eq!(existencia(&db), 26, "38 menos 12");

    anular(&mut db, venta.id, "el cliente se arrepintio", 1, None).unwrap();
    assert_eq!(existencia(&db), 38, "vuelven las 12 botellas");
}

#[test]
fn anular_no_borra_la_venta_y_deja_rastro() {
    let mut db = escenario();
    let venta = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
        pagos: vec![efectivo(3_900, None)],
        usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    anular(&mut db, venta.id, "se cobro de mas", 1, None).unwrap();

    let (estado, existe): (String, i64) = db
        .query_row(
            "SELECT estado, (SELECT COUNT(*) FROM anulaciones WHERE venta_id = ?1)
             FROM ventas WHERE id = ?1",
            [venta.id],
            |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .unwrap();

    assert_eq!(estado, "ANULADA");
    assert_eq!(existe, 1, "la anulacion tiene su propio registro");

    let motivo: String = db
        .query_row("SELECT motivo FROM anulaciones WHERE venta_id = ?1", [venta.id], |f| f.get(0))
        .unwrap();
    assert_eq!(motivo, "se cobro de mas");
}

#[test]
fn anular_saca_el_efectivo_de_la_caja() {
    let mut db = escenario();
    let caja_id = caja::abierta(&db).unwrap().unwrap().id;

    let venta = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(2), cantidad: 1, descuento: 0 }],
        pagos: vec![efectivo(25_000, None)],
        usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    let antes = caja::resumen(&db, caja_id).unwrap().efectivo_esperado;
    assert_eq!(antes, 125_000);

    anular(&mut db, venta.id, "producto en mal estado", 1, None).unwrap();

    let despues = caja::resumen(&db, caja_id).unwrap().efectivo_esperado;
    assert_eq!(despues, 100_000, "sale el efectivo y la venta ya no cuenta");
}

#[test]
fn no_se_puede_anular_dos_veces() {
    let mut db = escenario();
    let venta = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
        pagos: vec![efectivo(3_900, None)],
        usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    anular(&mut db, venta.id, "motivo", 1, None).unwrap();
    assert!(matches!(
        anular(&mut db, venta.id, "otra vez", 1, None),
        Err(ErrorVenta::YaAnulada)
    ));
    assert_eq!(existencia(&db), 38, "la mercancia no vuelve dos veces");
}

#[test]
fn anular_sin_motivo_no_se_permite() {
    let mut db = escenario();
    let venta = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
        pagos: vec![efectivo(3_900, None)],
        usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    assert!(matches!(
        anular(&mut db, venta.id, "   ", 1, None),
        Err(ErrorVenta::FaltaMotivo)
    ));
}

#[test]
fn el_resumen_de_caja_cuenta_ventas_y_movimientos() {
    let mut db = escenario();
    let caja_id = caja::abierta(&db).unwrap().unwrap().id;

    registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 2, descuento: 0 }],
        pagos: vec![efectivo(7_800, Some(10_000))],
        usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();

    caja::registrar_movimiento(&db, caja_id, TipoMovimiento::Salida, "almuerzo", 15_000, 1)
        .unwrap();

    let r = caja::resumen(&db, caja_id).unwrap();
    assert_eq!(r.ventas_cantidad, 1);
    assert_eq!(r.ventas_total, 7_800);
    assert_eq!(r.salidas, 15_000);
    assert_eq!(r.efectivo_esperado, 100_000 + 7_800 - 15_000);
}

#[test]
fn una_venta_anulada_no_cuenta_en_el_cierre() {
    let mut db = escenario();
    let caja_id = caja::abierta(&db).unwrap().unwrap().id;

    let venta = registrar(&mut db, &VentaEntrante {
        items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
        pagos: vec![efectivo(3_900, None)],
        usuario_id: 1, notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
    })
    .unwrap();
    anular(&mut db, venta.id, "error de cobro", 1, None).unwrap();

    let r = caja::resumen(&db, caja_id).unwrap();
    assert_eq!(r.ventas_cantidad, 0);
    assert_eq!(r.ventas_total, 0);
}


// ---------------------------------------------------------------------
// Precio especial por tiempo limitado
// ---------------------------------------------------------------------

mod precio_con_vigencia {
    use super::*;

    /// Pone un precio especial de hoy a la fecha que se indique.
    fn promocion(db: &Connection, precio: i64, empaque_id: Option<i64>, dias: i64) {
        db.execute(
            "INSERT INTO precios_vigencia
               (producto_id, empaque_id, precio, motivo, desde, hasta, usuario_id)
             VALUES (1, ?1, ?2, 'promocion', date('now','localtime'),
                     date('now','localtime', '+' || ?3 || ' days'), 1)",
            params![empaque_id, precio, dias],
        )
        .unwrap();
    }

    #[test]
    fn el_precio_de_hoy_manda_sobre_el_de_siempre() {
        let mut db = escenario();
        promocion(&db, 2_900, Some(1), 0); // solo hoy

        let venta = registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 2, descuento: 0 }],
            pagos: vec![efectivo(5_800, None)],
            usuario_id: 1, notas: None, recargo: None,
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        assert_eq!(venta.total, 5_800, "dos a 2.900, no a 3.900");
        assert_eq!(venta.items[0].precio_unitario, 2_900);
    }

    /// El precio de siempre tiene que seguir intacto: cuando la promocion
    /// venza hay que poder volver a el.
    #[test]
    fn la_promocion_no_pisa_el_precio_de_lista() {
        let db = escenario();
        promocion(&db, 2_900, Some(1), 0);

        let precio: i64 = db
            .query_row("SELECT precio_venta FROM producto_empaques WHERE id = 1", [], |f| f.get(0))
            .unwrap();
        assert_eq!(precio, 3_900, "el de siempre no se toca");
    }

    #[test]
    fn una_promocion_vencida_no_se_aplica() {
        let mut db = escenario();
        db.execute(
            "INSERT INTO precios_vigencia
               (producto_id, empaque_id, precio, desde, hasta, usuario_id)
             VALUES (1, 1, 1_000, date('now','localtime','-10 days'),
                     date('now','localtime','-1 day'), 1)",
            [],
        )
        .unwrap();

        let venta = registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
            pagos: vec![efectivo(3_900, None)],
            usuario_id: 1, notas: None, recargo: None,
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        assert_eq!(venta.total, 3_900, "vencida ayer: vuelve el de siempre");
    }

    #[test]
    fn una_promocion_que_todavia_no_empieza_tampoco() {
        let mut db = escenario();
        db.execute(
            "INSERT INTO precios_vigencia
               (producto_id, empaque_id, precio, desde, hasta, usuario_id)
             VALUES (1, 1, 1_000, date('now','localtime','+3 days'),
                     date('now','localtime','+9 days'), 1)",
            [],
        )
        .unwrap();

        let venta = registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
            pagos: vec![efectivo(3_900, None)],
            usuario_id: 1, notas: None, recargo: None,
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        assert_eq!(venta.total, 3_900);
    }

    /// Una promocion sin empaque vale para todas las formas de venta;
    /// una con empaque solo para esa. La del empaque es mas especifica y
    /// tiene que ganar.
    #[test]
    fn la_del_empaque_gana_sobre_la_del_producto() {
        let mut db = escenario();
        promocion(&db, 3_000, None, 5);      // todo el producto
        promocion(&db, 20_000, Some(2), 5);  // solo el six

        let venta = registrar(&mut db, &VentaEntrante {
            items: vec![
                ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 },
                ItemCarrito { producto_id: 1, empaque_id: Some(2), cantidad: 1, descuento: 0 },
            ],
            pagos: vec![efectivo(23_000, None)],
            usuario_id: 1, notas: None, recargo: None,
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        assert_eq!(venta.items[0].precio_unitario, 3_000, "la unidad, del producto");
        assert_eq!(venta.items[1].precio_unitario, 20_000, "el six, la suya");
    }

    #[test]
    fn una_promocion_apagada_no_cuenta() {
        let mut db = escenario();
        promocion(&db, 2_900, Some(1), 5);
        db.execute("UPDATE precios_vigencia SET activo = 0", []).unwrap();

        let venta = registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
            pagos: vec![efectivo(3_900, None)],
            usuario_id: 1, notas: None, recargo: None,
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        assert_eq!(venta.total, 3_900);
    }

    /// El precio con el que se vendio queda congelado en el renglon: si
    /// mañana cambia la promocion, la venta de hoy sigue diciendo lo que
    /// de verdad se cobro.
    #[test]
    fn el_precio_cobrado_queda_guardado_en_la_venta() {
        let mut db = escenario();
        promocion(&db, 2_900, Some(1), 0);

        registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
            pagos: vec![efectivo(2_900, None)],
            usuario_id: 1, notas: None, recargo: None,
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        db.execute("UPDATE precios_vigencia SET precio = 1", []).unwrap();

        let guardado: i64 = db
            .query_row("SELECT precio_unitario FROM venta_items", [], |f| f.get(0))
            .unwrap();
        assert_eq!(guardado, 2_900);
    }
}

// ---------------------------------------------------------------------
// Recargos
// ---------------------------------------------------------------------

mod recargos {
    use super::*;

    #[test]
    fn un_recargo_por_monto_se_suma_al_total() {
        let mut db = escenario();
        let venta = registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 2, descuento: 0 }],
            pagos: vec![efectivo(10_800, None)],
            usuario_id: 1, notas: None,
            recargo: Some(Recargo {
                concepto: "Domicilio".to_owned(), porcentaje: None, monto: 3_000,
            }),
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        assert_eq!(venta.subtotal, 7_800);
        assert_eq!(venta.recargo, 3_000);
        assert_eq!(venta.total, 10_800);
        assert_eq!(venta.recargo_concepto.as_deref(), Some("Domicilio"));
    }

    #[test]
    fn un_recargo_por_porcentaje_se_calcula_sobre_lo_que_queda() {
        let mut db = escenario();
        // 10.000 con 1.000 de descuento -> base 9.000, 10 % = 900.
        let venta = registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(2), cantidad: 1, descuento: 1_000 }],
            pagos: vec![efectivo(26_400, None)],
            usuario_id: 1, notas: None,
            recargo: Some(Recargo {
                concepto: "Servicio".to_owned(), porcentaje: Some(10), monto: 0,
            }),
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        assert_eq!(venta.subtotal, 25_000);
        assert_eq!(venta.descuento, 1_000);
        assert_eq!(venta.recargo, 2_400, "10 % de 24.000, no de 25.000");
        assert_eq!(venta.total, 26_400);
    }

    /// Truncar dejaria al cliente pagando un peso menos del anunciado.
    #[test]
    fn el_porcentaje_redondea_al_peso_mas_cercano() {
        let r = Recargo { concepto: "x".to_owned(), porcentaje: Some(10), monto: 0 };
        assert_eq!(r.calcular(3_999), 400, "399,9 se cobra como 400");
        assert_eq!(r.calcular(3_990), 399);
    }

    #[test]
    fn el_recargo_queda_guardado_con_su_concepto_y_porcentaje() {
        let mut db = escenario();
        registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
            pagos: vec![efectivo(4_290, None)],
            usuario_id: 1, notas: None,
            recargo: Some(Recargo {
                concepto: "Domicilio".to_owned(), porcentaje: Some(10), monto: 0,
            }),
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        let (monto, concepto, porcentaje): (i64, String, i64) = db
            .query_row(
                "SELECT recargo, recargo_concepto, recargo_porcentaje FROM ventas",
                [], |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)),
            )
            .unwrap();

        assert_eq!(monto, 390);
        assert_eq!(concepto, "Domicilio");
        assert_eq!(porcentaje, 10, "para poder explicar el numero despues");
    }

    #[test]
    fn sin_recargo_la_venta_sigue_igual_que_siempre() {
        let mut db = escenario();
        let venta = registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
            pagos: vec![efectivo(3_900, None)],
            usuario_id: 1, notas: None, recargo: None,
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        assert_eq!(venta.recargo, 0);
        assert_eq!(venta.recargo_concepto, None);
        assert_eq!(venta.total, 3_900);
    }

    /// El pago tiene que cuadrar contra el total CON recargo. Si no, se
    /// cobraria de menos sin que nadie lo note.
    #[test]
    fn el_pago_tiene_que_cubrir_el_recargo() {
        let mut db = escenario();
        let fallo = registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
            pagos: vec![efectivo(3_900, None)], // sin contar el domicilio
            usuario_id: 1, notas: None,
            recargo: Some(Recargo {
                concepto: "Domicilio".to_owned(), porcentaje: None, monto: 2_000,
            }),
            cliente_id: None,
            cliente_nombre: None,
        });

        assert!(matches!(fallo, Err(ErrorVenta::PagoNoCuadra { .. })));
    }
}

// ---------------------------------------------------------------------
// Impuesto separado
// ---------------------------------------------------------------------

mod impuesto {
    use super::*;

    fn activar(db: &Connection, porcentaje: i64) {
        db.execute(
            "UPDATE configuracion SET valor = '1' WHERE clave = 'impuesto.activo'",
            [],
        )
        .unwrap();
        db.execute(
            "UPDATE configuracion SET valor = ?1 WHERE clave = 'impuesto.porcentaje'",
            params![porcentaje.to_string()],
        )
        .unwrap();
    }

    /// Apagado es lo normal: la licorera vende a precio final.
    #[test]
    fn apagado_no_separa_nada() {
        let mut db = escenario();
        let venta = registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
            pagos: vec![efectivo(3_900, None)],
            usuario_id: 1, notas: None, recargo: None,
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        assert_eq!(venta.impuesto, 0);
        assert_eq!(venta.total, 3_900);
    }

    /// Con precio final, el impuesto sale de adentro del precio: el total
    /// no cambia, solo se dice cuanto de el era impuesto.
    #[test]
    fn activo_desglosa_sin_encarecer() {
        let mut db = escenario();
        activar(&db, 19);

        let venta = registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
            pagos: vec![efectivo(3_900, None)],
            usuario_id: 1, notas: None, recargo: None,
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        assert_eq!(venta.total, 3_900, "el cliente paga lo mismo");
        // 3.900 con 19 % incluido: 3.900 * 19 / 119 = 622,7 -> 623.
        assert_eq!(venta.impuesto, 623);
    }

    #[test]
    fn en_cero_por_ciento_no_separa_aunque_este_activo() {
        let mut db = escenario();
        activar(&db, 0);

        let venta = registrar(&mut db, &VentaEntrante {
            items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 1, descuento: 0 }],
            pagos: vec![efectivo(3_900, None)],
            usuario_id: 1, notas: None, recargo: None,
            cliente_id: None,
            cliente_nombre: None,
        })
        .unwrap();

        assert_eq!(venta.impuesto, 0);
    }
}
