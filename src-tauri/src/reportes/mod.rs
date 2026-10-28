//! Consultas de resumen para el tablero y los reportes.
//!
//! Todo sale de las ventas ya registradas: no hay cifras guardadas aparte
//! que puedan quedar desfasadas. Cada consulta parte de la verdad.

pub mod consultas;

use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum ErrorReporte {
    #[error("error de base de datos")]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, Serialize)]
pub struct ResumenDia {
    pub total: i64,
    pub cantidad: i64,
    /// Cuanto gasta en promedio cada cliente.
    pub ticket_promedio: i64,
    /// El mismo dia de la semana pasada, para comparar contra algo
    /// parecido: un martes con un martes, no con el domingo de ayer.
    pub total_semana_pasada: i64,
    pub unidades: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct VentaPorDia {
    pub fecha: String,
    pub total: i64,
    pub cantidad: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProductoVendido {
    pub nombre: String,
    pub presentacion: String,
    pub unidades: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct VentaReciente {
    pub id: i64,
    pub numero: i64,
    pub total: i64,
    pub hora: String,
    pub usuario: String,
    pub anulada: bool,
    pub articulos: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertaInventario {
    pub id: i64,
    pub nombre: String,
    pub presentacion: String,
    pub existencia: i64,
    pub stock_minimo: i64,
    pub agotado: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Tablero {
    pub hoy: ResumenDia,
    pub ultimos_dias: Vec<VentaPorDia>,
    pub mas_vendidos: Vec<ProductoVendido>,
    pub ventas_recientes: Vec<VentaReciente>,
    pub alertas: Vec<AlertaInventario>,
    pub agotados: i64,
    pub bajo_minimo: i64,
    /// Solo se llena para quien puede ver costos.
    pub utilidad_estimada: Option<i64>,
    /// Lo que esta afuera y lo que hay que pagar. Sin esto, el tablero
    /// dice cuanto se vendio hoy sin decir que una parte no entro, y
    /// nada avisa de una factura del proveedor que se vencio ayer.
    pub credito: Credito,
}

#[derive(Debug, Clone, Serialize)]
pub struct Credito {
    /// De lo vendido hoy, cuanto se fio.
    pub fiado_hoy: i64,
    /// Todo lo que deben los clientes, de cualquier fecha.
    pub por_cobrar: i64,
    /// De eso, lo que lleva mas de treinta dias sin moverse.
    pub por_cobrar_viejo: i64,
    /// Cuantas personas deben algo.
    pub deudores: i64,
    /// Todo lo que se le debe a los proveedores.
    pub por_pagar: i64,
    /// De eso, lo que ya se vencio.
    pub por_pagar_vencido: i64,
    /// Cuantas compras estan vencidas.
    pub compras_vencidas: i64,
}

/// Fecha local en formato 'YYYY-MM-DD'.
///
/// Las ventas se guardan en UTC, pero el dueño piensa en dias del local:
/// una venta de las 8 de la noche pertenece a ese dia, no al siguiente.
/// `localtime` hace esa conversion dentro de SQLite.
const FECHA_LOCAL: &str = "date(created_at, 'localtime')";

pub fn tablero(
    conexion: &Connection,
    incluir_utilidad: bool,
) -> Result<Tablero, ErrorReporte> {
    Ok(Tablero {
        hoy: resumen_de_hoy(conexion)?,
        ultimos_dias: ventas_por_dia(conexion, 14)?,
        mas_vendidos: mas_vendidos(conexion, 10)?,
        ventas_recientes: ventas_recientes(conexion, 10)?,
        alertas: alertas(conexion, 12)?,
        agotados: contar(conexion, "existencia <= 0")?,
        bajo_minimo: contar(
            conexion,
            "stock_minimo > 0 AND existencia > 0 AND existencia <= stock_minimo",
        )?,
        utilidad_estimada: if incluir_utilidad {
            Some(utilidad_del_mes(conexion)?)
        } else {
            None
        },
        credito: credito(conexion)?,
    })
}

/// Lo que esta afuera y lo que hay que pagar.
fn credito(conexion: &Connection) -> Result<Credito, ErrorReporte> {
    let (fiado_hoy,): (i64,) = conexion.query_row(
        "SELECT COALESCE(SUM(cu.monto), 0)
         FROM cuentas_cobrar cu
         JOIN ventas v ON v.id = cu.venta_id
         WHERE cu.anulada = 0 AND v.estado = 'COMPLETADA'
           AND date(v.created_at, 'localtime') = date('now', 'localtime')",
        [],
        |f| Ok((f.get(0)?,)),
    )?;

    // El saldo viejo se mide por la fecha de la venta: una cuenta con
    // abonos recientes sigue siendo vieja si lleva meses sin saldarse.
    let (por_cobrar, por_cobrar_viejo, deudores): (i64, i64, i64) = conexion.query_row(
        "SELECT COALESCE(SUM(s.saldo), 0),
                COALESCE(SUM(CASE WHEN s.vieja = 1 THEN s.saldo ELSE 0 END), 0),
                COUNT(DISTINCT CASE WHEN s.saldo > 0 THEN s.cliente_id END)
         FROM (
           SELECT cu.cliente_id,
                  cu.monto - COALESCE((SELECT SUM(a.monto) FROM abonos a
                                       WHERE a.cuenta_id = cu.id AND a.anulado = 0), 0)
                    AS saldo,
                  CASE WHEN date(v.created_at, 'localtime')
                            < date('now', 'localtime', '-30 days')
                       THEN 1 ELSE 0 END AS vieja
           FROM cuentas_cobrar cu
           JOIN ventas v ON v.id = cu.venta_id
           WHERE cu.anulada = 0 AND v.estado = 'COMPLETADA'
         ) s
         WHERE s.saldo > 0",
        [],
        |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)),
    )?;

    let (por_pagar, por_pagar_vencido, compras_vencidas): (i64, i64, i64) = conexion.query_row(
        "SELECT COALESCE(SUM(d.saldo), 0),
                COALESCE(SUM(CASE WHEN d.vencida = 1 THEN d.saldo ELSE 0 END), 0),
                COUNT(CASE WHEN d.vencida = 1 THEN 1 END)
         FROM (
           SELECT c.total - COALESCE((SELECT SUM(p.monto) FROM pagos_compra p
                                      WHERE p.compra_id = c.id AND p.anulado = 0), 0)
                    AS saldo,
                  CASE WHEN c.vence IS NOT NULL
                            AND c.vence < date('now', 'localtime')
                       THEN 1 ELSE 0 END AS vencida
           FROM compras c
           WHERE c.estado = 'REGISTRADA' AND c.a_credito = 1
         ) d
         WHERE d.saldo > 0",
        [],
        |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)),
    )?;

    Ok(Credito {
        fiado_hoy,
        por_cobrar,
        por_cobrar_viejo,
        deudores,
        por_pagar,
        por_pagar_vencido,
        compras_vencidas,
    })
}

fn contar(conexion: &Connection, condicion: &str) -> Result<i64, ErrorReporte> {
    let sql = format!("SELECT COUNT(*) FROM productos WHERE activo = 1 AND ({condicion})");
    Ok(conexion.query_row(&sql, [], |f| f.get(0))?)
}

pub fn resumen_de_hoy(conexion: &Connection) -> Result<ResumenDia, ErrorReporte> {
    let sql = format!(
        "SELECT COALESCE(SUM(total), 0), COUNT(*)
         FROM ventas
         WHERE estado = 'COMPLETADA' AND {FECHA_LOCAL} = date('now', 'localtime')"
    );
    let (total, cantidad): (i64, i64) =
        conexion.query_row(&sql, [], |f| Ok((f.get(0)?, f.get(1)?)))?;

    let sql_semana = format!(
        "SELECT COALESCE(SUM(total), 0)
         FROM ventas
         WHERE estado = 'COMPLETADA' AND {FECHA_LOCAL} = date('now', 'localtime', '-7 days')"
    );
    let total_semana_pasada: i64 = conexion.query_row(&sql_semana, [], |f| f.get(0))?;

    let sql_unidades = format!(
        "SELECT COALESCE(SUM(i.cantidad_base), 0)
         FROM venta_items i JOIN ventas v ON v.id = i.venta_id
         WHERE v.estado = 'COMPLETADA' AND {} = date('now', 'localtime')",
        FECHA_LOCAL.replace("created_at", "v.created_at")
    );
    let unidades: i64 = conexion.query_row(&sql_unidades, [], |f| f.get(0))?;

    Ok(ResumenDia {
        total,
        cantidad,
        ticket_promedio: if cantidad > 0 { total / cantidad } else { 0 },
        total_semana_pasada,
        unidades,
    })
}

/// Las ventas de cada uno de los ultimos `dias` dias.
///
/// Devuelve el dia aunque no se haya vendido nada, con cero. Agrupar solo
/// lo que existe deja los dias cerrados fuera de la lista, y entonces la
/// grafica pega las barras vecinas: un lunes muerto desaparece en vez de
/// verse como un hueco, y la linea aparenta una racha que no hubo.
pub fn ventas_por_dia(
    conexion: &Connection,
    dias: i64,
) -> Result<Vec<VentaPorDia>, ErrorReporte> {
    // La serie de fechas se arma en SQL para que 'localtime' valga igual
    // aqui que en el resto de la consulta.
    let sql = format!(
        "WITH RECURSIVE serie(dia) AS (
           SELECT date('now', 'localtime', ?1)
           UNION ALL
           SELECT date(dia, '+1 day') FROM serie
           WHERE dia < date('now', 'localtime')
         )
         SELECT serie.dia,
                COALESCE(SUM(v.total), 0),
                COUNT(v.id)
         FROM serie
         LEFT JOIN ventas v
           ON {FECHA_LOCAL_V} = serie.dia AND v.estado = 'COMPLETADA'
         GROUP BY serie.dia ORDER BY serie.dia",
        FECHA_LOCAL_V = FECHA_LOCAL.replace("created_at", "v.created_at"),
    );
    let mut consulta = conexion.prepare(&sql)?;
    let filas = consulta
        .query_map(params![format!("-{} days", dias - 1)], |f| {
            Ok(VentaPorDia {
                fecha: f.get(0)?,
                total: f.get(1)?,
                cantidad: f.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

pub fn mas_vendidos(
    conexion: &Connection,
    limite: i64,
) -> Result<Vec<ProductoVendido>, ErrorReporte> {
    let sql = format!(
        "SELECT i.nombre_producto, COALESCE(p.presentacion, ''),
                SUM(i.cantidad_base), SUM(i.total)
         FROM venta_items i
         JOIN ventas v ON v.id = i.venta_id
         LEFT JOIN productos p ON p.id = i.producto_id
         WHERE v.estado = 'COMPLETADA'
           AND {} >= date('now', 'localtime', 'start of month')
         GROUP BY i.producto_id
         ORDER BY SUM(i.total) DESC
         LIMIT ?1",
        FECHA_LOCAL.replace("created_at", "v.created_at")
    );
    let mut consulta = conexion.prepare(&sql)?;
    let filas = consulta
        .query_map(params![limite], |f| {
            Ok(ProductoVendido {
                nombre: f.get(0)?,
                presentacion: f.get(1)?,
                unidades: f.get(2)?,
                total: f.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

pub fn ventas_recientes(
    conexion: &Connection,
    limite: i64,
) -> Result<Vec<VentaReciente>, ErrorReporte> {
    let mut consulta = conexion.prepare(
        "SELECT v.id, v.numero, v.total,
                strftime('%H:%M', v.created_at, 'localtime'),
                COALESCE(u.nombre, ''), v.estado,
                (SELECT COALESCE(SUM(cantidad_empaques), 0)
                 FROM venta_items WHERE venta_id = v.id)
         FROM ventas v
         LEFT JOIN usuarios u ON u.id = v.usuario_id
         ORDER BY v.id DESC LIMIT ?1",
    )?;
    let filas = consulta
        .query_map(params![limite], |f| {
            Ok(VentaReciente {
                id: f.get(0)?,
                numero: f.get(1)?,
                total: f.get(2)?,
                hora: f.get(3)?,
                usuario: f.get(4)?,
                anulada: f.get::<_, String>(5)? == "ANULADA",
                articulos: f.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

pub fn alertas(
    conexion: &Connection,
    limite: i64,
) -> Result<Vec<AlertaInventario>, ErrorReporte> {
    let mut consulta = conexion.prepare(
        "SELECT id, nombre, presentacion, existencia, stock_minimo
         FROM productos
         WHERE activo = 1
           AND (existencia <= 0 OR (stock_minimo > 0 AND existencia <= stock_minimo))
         ORDER BY existencia, nombre
         LIMIT ?1",
    )?;
    let filas = consulta
        .query_map(params![limite], |f| {
            let existencia: i64 = f.get(3)?;
            Ok(AlertaInventario {
                id: f.get(0)?,
                nombre: f.get(1)?,
                presentacion: f.get(2)?,
                existencia,
                stock_minimo: f.get(4)?,
                agotado: existencia <= 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

/// Utilidad del mes: lo cobrado menos lo que costo.
///
/// Solo cuenta los renglones que tienen costo registrado. Mientras no se
/// hayan hecho compras, esta cifra sera baja y hay que decirlo en la
/// pantalla en vez de presentarla como si fuera la utilidad real.
pub fn utilidad_del_mes(conexion: &Connection) -> Result<i64, ErrorReporte> {
    let sql = format!(
        "SELECT COALESCE(SUM(i.total - (COALESCE(i.costo_unitario, 0) * i.cantidad_base)), 0)
         FROM venta_items i JOIN ventas v ON v.id = i.venta_id
         WHERE v.estado = 'COMPLETADA'
           AND i.costo_unitario IS NOT NULL
           AND {} >= date('now', 'localtime', 'start of month')",
        FECHA_LOCAL.replace("created_at", "v.created_at")
    );
    Ok(conexion.query_row(&sql, [], |f| f.get(0))?)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::caja;
    use crate::db::abrir_en_memoria;
    use crate::ventas::{self, ItemCarrito, PagoRecibido, VentaEntrante};

    fn escenario() -> Connection {
        let mut db = abrir_en_memoria().unwrap();
        db.execute(
            "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
             VALUES ('cajero', 'Cajero', 'h', 'CAJERO')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO productos
               (id, codigo, nombre, categoria_id, presentacion, existencia,
                precio_venta, costo_promedio, stock_minimo)
             VALUES
               (1, 'CER-POKER', 'POKER', 9, '330 ml', 38, 3900, 2100, 12),
               (2, 'AGU-NECTAR', 'NECTAR', 5, '750 ml', 0, 62000, 40000, 3),
               (3, 'RON-CALDAS', 'RON CALDAS', 4, '750 ml', 2, 55000, 38000, 5)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO producto_empaques (id, producto_id, nombre, factor, precio_venta, predeterminado)
             VALUES (1, 1, 'Unidad', 1, 3900, 1), (2, 1, 'Six', 6, 25000, 0)",
            [],
        )
        .unwrap();
        caja::abrir(&db, 1, 100_000, None).unwrap();

        for _ in 0..3 {
            ventas::registrar(
                &mut db,
                &VentaEntrante {
                    items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(2), cantidad: 1, descuento: 0 }],
                    pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: 25_000, recibido: None }],
                    usuario_id: 1,
                    notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
                },
            )
            .unwrap();
        }
        db
    }

    /// Un dia sin ventas tiene que llegar igual, con cero.
    ///
    /// Antes se agrupaba solo lo que existia, asi que los dias cerrados
    /// no salian en la lista y la grafica pegaba las barras vecinas: un
    /// lunes muerto desaparecia en vez de verse como un hueco.
    mod dias_completos {
        use super::escenario;
        use crate::reportes::ventas_por_dia;

        #[test]
        fn devuelve_tantos_dias_como_se_le_piden() {
            let db = escenario();

            assert_eq!(ventas_por_dia(&db, 14).unwrap().len(), 14);
            assert_eq!(ventas_por_dia(&db, 7).unwrap().len(), 7);
            assert_eq!(ventas_por_dia(&db, 1).unwrap().len(), 1);
        }

        #[test]
        fn los_dias_sin_ventas_llegan_en_cero() {
            let db = escenario();
            let dias = ventas_por_dia(&db, 14).unwrap();

            // Las tres ventas del escenario son de hoy, que es el ultimo.
            let (hoy, anteriores) = dias.split_last().unwrap();
            assert_eq!(hoy.cantidad, 3);
            assert_eq!(hoy.total, 75_000);

            assert_eq!(anteriores.len(), 13);
            for d in anteriores {
                assert_eq!(d.total, 0, "el dia {} deberia venir en cero", d.fecha);
                assert_eq!(d.cantidad, 0);
            }
        }

        #[test]
        fn vienen_en_orden_y_sin_saltos() {
            let db = escenario();
            let dias = ventas_por_dia(&db, 14).unwrap();

            let fechas: Vec<&str> = dias.iter().map(|d| d.fecha.as_str()).collect();
            let mut ordenadas = fechas.clone();
            ordenadas.sort_unstable();
            assert_eq!(fechas, ordenadas, "tienen que venir del mas viejo al mas nuevo");

            // Ninguna repetida: una fecha dos veces significaria doble barra.
            let unicas: std::collections::HashSet<&&str> = fechas.iter().collect();
            assert_eq!(unicas.len(), fechas.len());
        }

        /// Una venta anulada no cuenta, pero su dia sigue estando.
        #[test]
        fn una_anulada_deja_el_dia_en_cero_pero_no_lo_borra() {
            let mut db = escenario();
            let ids: Vec<i64> = db
                .prepare("SELECT id FROM ventas")
                .unwrap()
                .query_map([], |f| f.get(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            for id in ids {
                crate::ventas::anular(&mut db, id, "prueba", 1, None).unwrap();
            }

            let dias = ventas_por_dia(&db, 14).unwrap();
            assert_eq!(dias.len(), 14, "el dia no se puede perder");
            assert_eq!(dias.last().unwrap().total, 0);
        }
    }

    #[test]
    fn el_resumen_de_hoy_cuenta_las_ventas_del_dia() {
        let db = escenario();
        let hoy = resumen_de_hoy(&db).unwrap();

        assert_eq!(hoy.cantidad, 3);
        assert_eq!(hoy.total, 75_000);
        assert_eq!(hoy.ticket_promedio, 25_000);
        assert_eq!(hoy.unidades, 18, "tres six son 18 botellas");
    }

    #[test]
    fn una_venta_anulada_no_cuenta_en_el_resumen() {
        let mut db = escenario();
        let venta: i64 = db
            .query_row("SELECT id FROM ventas LIMIT 1", [], |f| f.get(0))
            .unwrap();
        ventas::anular(&mut db, venta, "prueba", 1, None).unwrap();

        let hoy = resumen_de_hoy(&db).unwrap();
        assert_eq!(hoy.cantidad, 2);
        assert_eq!(hoy.total, 50_000);
    }

    #[test]
    fn las_alertas_ponen_primero_lo_agotado() {
        let db = escenario();
        let lista = alertas(&db, 10).unwrap();

        assert_eq!(lista.len(), 2, "el agotado y el que esta bajo minimo");
        assert!(lista[0].agotado, "primero lo que ya no hay");
        assert_eq!(lista[0].nombre, "NECTAR");
        assert!(!lista[1].agotado);
        assert_eq!(lista[1].nombre, "RON CALDAS");
    }

    #[test]
    fn el_producto_mas_vendido_es_el_que_mas_dinero_dejo() {
        let db = escenario();
        let lista = mas_vendidos(&db, 5).unwrap();

        assert_eq!(lista[0].nombre, "POKER");
        assert_eq!(lista[0].unidades, 18);
        assert_eq!(lista[0].total, 75_000);
    }

    #[test]
    fn las_ventas_recientes_llegan_de_la_mas_nueva_a_la_mas_vieja() {
        let db = escenario();
        let lista = ventas_recientes(&db, 10).unwrap();

        assert_eq!(lista.len(), 3);
        assert_eq!(lista[0].numero, 3, "la ultima primero");
        assert_eq!(lista[2].numero, 1);
        assert!(!lista[0].anulada);
    }

    #[test]
    fn la_utilidad_descuenta_el_costo() {
        let db = escenario();
        // 18 botellas a 3.900 de venta menos 2.100 de costo.
        assert_eq!(utilidad_del_mes(&db).unwrap(), 75_000 - (2_100 * 18));
    }

    #[test]
    fn el_tablero_oculta_la_utilidad_a_quien_no_puede_verla() {
        let db = escenario();
        assert!(tablero(&db, false).unwrap().utilidad_estimada.is_none());
        assert!(tablero(&db, true).unwrap().utilidad_estimada.is_some());
    }

    #[test]
    fn el_tablero_cuenta_agotados_y_bajo_minimo_por_separado() {
        let db = escenario();
        let t = tablero(&db, false).unwrap();
        assert_eq!(t.agotados, 1);
        assert_eq!(t.bajo_minimo, 1);
    }

    /// El crédito en el tablero.
    ///
    /// Sin esto, el tablero dice cuanto se vendio hoy sin decir que una
    /// parte no entro, y nada avisa de una factura del proveedor que se
    /// vencio ayer.
    mod credito {
        use super::*;

        fn id_metodo(db: &Connection, codigo: &str) -> i64 {
            db.query_row(
                "SELECT id FROM metodos_pago WHERE codigo = ?1", [codigo], |f| f.get(0),
            )
            .unwrap()
        }

        /// Fia una venta de 10 Poker (39.000) a nombre de alguien.
        fn fiar(db: &mut Connection, a_quien: &str) {
            let fiado = id_metodo(db, "FIADO");
            ventas::registrar(
                db,
                &VentaEntrante {
                    items: vec![ItemCarrito {
                        producto_id: 1, empaque_id: None, cantidad: 10, descuento: 0,
                    }],
                    pagos: vec![PagoRecibido {
                        metodo_pago_id: fiado, monto: 39_000, recibido: None,
                    }],
                    usuario_id: 1,
                    notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: Some(a_quien.to_owned()),
                },
            )
            .unwrap();
        }

        #[test]
        fn dice_cuanto_se_fio_hoy_y_cuanto_deben_en_total() {
            let mut db = escenario();
            fiar(&mut db, "Don Jairo");
            fiar(&mut db, "la señora del 302");

            let c = tablero(&db, true).unwrap().credito;

            assert_eq!(c.fiado_hoy, 78_000);
            assert_eq!(c.por_cobrar, 78_000);
            assert_eq!(c.deudores, 2);
        }

        #[test]
        fn lo_abonado_deja_de_estar_por_cobrar() {
            let mut db = escenario();
            fiar(&mut db, "Don Jairo");
            let cuenta: i64 = db
                .query_row("SELECT id FROM cuentas_cobrar", [], |f| f.get(0))
                .unwrap();
            let efectivo = id_metodo(&db, "EFECTIVO");
            crate::fiados::abonar(&mut db, cuenta, 20_000, efectivo, 1, None).unwrap();

            let c = tablero(&db, true).unwrap().credito;

            // Se fio lo mismo hoy; lo que bajo es lo que falta por cobrar.
            assert_eq!(c.fiado_hoy, 39_000);
            assert_eq!(c.por_cobrar, 19_000);
        }

        #[test]
        fn un_fiado_saldado_no_deja_deudor() {
            let mut db = escenario();
            fiar(&mut db, "Don Jairo");
            let cuenta: i64 = db
                .query_row("SELECT id FROM cuentas_cobrar", [], |f| f.get(0))
                .unwrap();
            let efectivo = id_metodo(&db, "EFECTIVO");
            crate::fiados::abonar(&mut db, cuenta, 39_000, efectivo, 1, None).unwrap();

            let c = tablero(&db, true).unwrap().credito;
            assert_eq!(c.por_cobrar, 0);
            assert_eq!(c.deudores, 0);
        }

        #[test]
        fn separa_lo_que_lleva_mas_de_un_mes_sin_cobrarse() {
            let mut db = escenario();
            fiar(&mut db, "Don Jairo");
            // Se envejece la venta cuarenta dias.
            db.execute(
                "UPDATE ventas SET created_at = datetime('now', '-40 days')",
                [],
            )
            .unwrap();
            fiar(&mut db, "la señora del 302");

            let c = tablero(&db, true).unwrap().credito;

            assert_eq!(c.por_cobrar, 78_000);
            assert_eq!(c.por_cobrar_viejo, 39_000, "solo la de hace cuarenta dias");
            assert_eq!(c.fiado_hoy, 39_000, "la vieja ya no es de hoy");
        }

        #[test]
        fn avisa_de_lo_que_se_le_debe_al_proveedor_y_de_lo_vencido() {
            let db = escenario();
            db.execute(
                "INSERT INTO compras
                   (numero, proveedor_id, fecha, subtotal, descuento, total,
                    usuario_id, a_credito, vence)
                 VALUES
                   ('C-1', 1, '2026-08-01', 500000, 0, 500000, 1, 1,
                    date('now','localtime','-3 days')),
                   ('C-2', 1, '2026-08-10', 300000, 0, 300000, 1, 1,
                    date('now','localtime','+5 days'))",
                [],
            )
            .unwrap();

            let c = tablero(&db, true).unwrap().credito;

            assert_eq!(c.por_pagar, 800_000);
            assert_eq!(c.por_pagar_vencido, 500_000);
            assert_eq!(c.compras_vencidas, 1);
        }

        #[test]
        fn una_compra_pagada_deja_de_pesar() {
            let mut db = escenario();
            db.execute(
                "INSERT INTO compras
                   (numero, proveedor_id, fecha, subtotal, descuento, total,
                    usuario_id, a_credito, vence)
                 VALUES ('C-1', 1, '2026-08-01', 500000, 0, 500000, 1, 1,
                         date('now','localtime','-3 days'))",
                [],
            )
            .unwrap();
            let compra: i64 = db
                .query_row("SELECT id FROM compras", [], |f| f.get(0))
                .unwrap();
            let efectivo = id_metodo(&db, "EFECTIVO");
            // El escenario ya deja una caja abierta.
            crate::compras::deudas::pagar(
                &mut db, compra, 500_000, "2026-08-21", Some(efectivo), 1, None,
            )
            .unwrap();

            let c = tablero(&db, true).unwrap().credito;
            assert_eq!(c.por_pagar, 0);
            assert_eq!(c.compras_vencidas, 0);
        }

        #[test]
        fn sin_creditos_todo_queda_en_cero() {
            let db = escenario();
            let c = tablero(&db, true).unwrap().credito;

            assert_eq!(c.fiado_hoy, 0);
            assert_eq!(c.por_cobrar, 0);
            assert_eq!(c.por_pagar, 0);
            assert_eq!(c.deudores, 0);
        }
    }

    #[test]
    fn sin_ventas_el_tablero_no_falla_ni_inventa_cifras() {
        let db = abrir_en_memoria().unwrap();
        let t = tablero(&db, true).unwrap();

        assert_eq!(t.hoy.total, 0);
        assert_eq!(t.hoy.ticket_promedio, 0, "sin ventas no se divide por cero");
        assert!(t.mas_vendidos.is_empty());
        assert!(t.ventas_recientes.is_empty());
    }
}
