//! Reportes con rango de fechas.
//!
//! Todos reciben dos fechas locales ('2026-08-01') y filtran por el día
//! del local, no por UTC: una venta de las once de la noche pertenece a
//! ese día, no al siguiente.

use rusqlite::{params, Connection};
use serde::Serialize;

use super::ErrorReporte;

/// Filtro de fechas compartido. Se escribe una vez para que todos los
/// reportes recorten el periodo igual.
const RANGO: &str = "date(v.created_at, 'localtime') BETWEEN ?1 AND ?2";

#[derive(Debug, Clone, Serialize)]
pub struct FilaVentasPorDia {
    pub fecha: String,
    pub ventas: i64,
    pub unidades: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FilaPorProducto {
    pub producto: String,
    pub presentacion: String,
    pub categoria: String,
    pub unidades: i64,
    pub total: i64,
    /// Solo llega a quien puede ver costos.
    pub utilidad: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FilaPorCategoria {
    pub categoria: String,
    pub unidades: i64,
    pub total: i64,
    pub participacion: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FilaPorUsuario {
    pub usuario: String,
    pub ventas: i64,
    pub total: i64,
    pub anuladas: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FilaCierre {
    pub caja_id: i64,
    pub apertura: String,
    pub cierre: Option<String>,
    pub usuario: String,
    pub base_inicial: i64,
    pub esperado: Option<i64>,
    pub contado: Option<i64>,
    pub diferencia: Option<i64>,
    pub observaciones: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FilaMovimiento {
    /// Hace falta para poder deshacer un ajuste desde la pantalla.
    pub id: i64,
    pub fecha: String,
    pub producto: String,
    pub tipo: String,
    pub cantidad: i64,
    pub existencia_despues: i64,
    pub motivo: Option<String>,
    pub usuario: String,
    /// Solo los ajustes manuales se pueden deshacer, y solo una vez.
    pub se_puede_deshacer: bool,
}

pub fn ventas_por_dia(
    conexion: &Connection,
    desde: &str,
    hasta: &str,
) -> Result<Vec<FilaVentasPorDia>, ErrorReporte> {
    let sql = format!(
        "SELECT date(v.created_at, 'localtime') AS dia,
                COUNT(DISTINCT v.id),
                COALESCE(SUM(i.cantidad_base), 0),
                COALESCE(SUM(v.total), 0)
         FROM ventas v
         LEFT JOIN venta_items i ON i.venta_id = v.id
         WHERE v.estado = 'COMPLETADA' AND {RANGO}
         GROUP BY dia ORDER BY dia"
    );
    // El total se suma una vez por venta, no una por renglon.
    let sql = sql.replace(
        "COALESCE(SUM(v.total), 0)",
        "(SELECT COALESCE(SUM(total), 0) FROM ventas v2
          WHERE v2.estado = 'COMPLETADA'
            AND date(v2.created_at, 'localtime') = date(v.created_at, 'localtime'))",
    );

    let mut consulta = conexion.prepare(&sql)?;
    let filas = consulta
        .query_map(params![desde, hasta], |f| {
            Ok(FilaVentasPorDia {
                fecha: f.get(0)?,
                ventas: f.get(1)?,
                unidades: f.get(2)?,
                total: f.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

pub fn ventas_por_producto(
    conexion: &Connection,
    desde: &str,
    hasta: &str,
    con_utilidad: bool,
) -> Result<Vec<FilaPorProducto>, ErrorReporte> {
    let sql = format!(
        "SELECT i.nombre_producto,
                COALESCE(p.presentacion, ''),
                COALESCE(c.nombre, 'Sin categoria'),
                SUM(i.cantidad_base),
                SUM(i.total),
                SUM(i.total - (COALESCE(i.costo_unitario, 0) * i.cantidad_base))
         FROM venta_items i
         JOIN ventas v ON v.id = i.venta_id
         LEFT JOIN productos p ON p.id = i.producto_id
         LEFT JOIN categorias c ON c.id = p.categoria_id
         WHERE v.estado = 'COMPLETADA' AND {RANGO}
         GROUP BY i.producto_id
         ORDER BY SUM(i.total) DESC"
    );
    let mut consulta = conexion.prepare(&sql)?;
    let filas = consulta
        .query_map(params![desde, hasta], |f| {
            Ok(FilaPorProducto {
                producto: f.get(0)?,
                presentacion: f.get(1)?,
                categoria: f.get(2)?,
                unidades: f.get(3)?,
                total: f.get(4)?,
                utilidad: if con_utilidad { f.get(5)? } else { None },
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

pub fn ventas_por_categoria(
    conexion: &Connection,
    desde: &str,
    hasta: &str,
) -> Result<Vec<FilaPorCategoria>, ErrorReporte> {
    let sql = format!(
        "SELECT COALESCE(c.nombre, 'Sin categoria'),
                SUM(i.cantidad_base), SUM(i.total)
         FROM venta_items i
         JOIN ventas v ON v.id = i.venta_id
         LEFT JOIN productos p ON p.id = i.producto_id
         LEFT JOIN categorias c ON c.id = p.categoria_id
         WHERE v.estado = 'COMPLETADA' AND {RANGO}
         GROUP BY c.id ORDER BY SUM(i.total) DESC"
    );
    let mut consulta = conexion.prepare(&sql)?;
    let filas: Vec<(String, i64, i64)> = consulta
        .query_map(params![desde, hasta], |f| {
            Ok((f.get(0)?, f.get(1)?, f.get(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let total: i64 = filas.iter().map(|(_, _, t)| t).sum();

    Ok(filas
        .into_iter()
        .map(|(categoria, unidades, monto)| FilaPorCategoria {
            categoria,
            unidades,
            total: monto,
            // Cuanto de las ventas del periodo aporta cada categoria.
            participacion: if total > 0 { (monto * 100) / total } else { 0 },
        })
        .collect())
}

pub fn ventas_por_usuario(
    conexion: &Connection,
    desde: &str,
    hasta: &str,
) -> Result<Vec<FilaPorUsuario>, ErrorReporte> {
    let sql = format!(
        "SELECT COALESCE(u.nombre, 'Sin usuario'),
                SUM(CASE WHEN v.estado = 'COMPLETADA' THEN 1 ELSE 0 END),
                SUM(CASE WHEN v.estado = 'COMPLETADA' THEN v.total ELSE 0 END),
                SUM(CASE WHEN v.estado = 'ANULADA' THEN 1 ELSE 0 END)
         FROM ventas v
         LEFT JOIN usuarios u ON u.id = v.usuario_id
         WHERE {RANGO}
         GROUP BY v.usuario_id
         ORDER BY 3 DESC"
    );
    let mut consulta = conexion.prepare(&sql)?;
    let filas = consulta
        .query_map(params![desde, hasta], |f| {
            Ok(FilaPorUsuario {
                usuario: f.get(0)?,
                ventas: f.get(1)?,
                total: f.get(2)?,
                anuladas: f.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

pub fn cierres_de_caja(
    conexion: &Connection,
    desde: &str,
    hasta: &str,
) -> Result<Vec<FilaCierre>, ErrorReporte> {
    let mut consulta = conexion.prepare(
        "SELECT c.id, c.apertura, c.cierre, COALESCE(u.nombre, ''),
                c.base_inicial, c.efectivo_esperado, c.efectivo_contado,
                c.diferencia, c.observaciones
         FROM cajas c
         LEFT JOIN usuarios u ON u.id = c.usuario_apertura
         WHERE date(c.apertura, 'localtime') BETWEEN ?1 AND ?2
         ORDER BY c.apertura DESC",
    )?;
    let filas = consulta
        .query_map(params![desde, hasta], |f| {
            Ok(FilaCierre {
                caja_id: f.get(0)?,
                apertura: f.get(1)?,
                cierre: f.get(2)?,
                usuario: f.get(3)?,
                base_inicial: f.get(4)?,
                esperado: f.get(5)?,
                contado: f.get(6)?,
                diferencia: f.get(7)?,
                observaciones: f.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

#[derive(Debug, Clone, Serialize)]
pub struct CambioDePrecio {
    pub id: i64,
    pub fecha: String,
    pub producto: String,
    /// Cual forma de venta. `None` es el precio principal del producto.
    pub empaque: Option<String>,
    pub precio_anterior: Option<i64>,
    pub precio_nuevo: i64,
    /// Cuanto cambio, en porcentaje. `None` la primera vez, cuando no
    /// habia con que comparar.
    pub variacion: Option<i64>,
    pub motivo: Option<String>,
    pub usuario: String,
}

/// Cuando cambio de precio un producto, y de cuanto a cuanto.
///
/// Responde la pregunta de «¿yo cuando subi la Poker?». El precio de las
/// ventas viejas no se toca -- cada venta guarda el suyo --, asi que esto
/// es lo unico que cuenta la historia del precio de lista.
///
/// Si `producto_id` es `None` salen los de todos los productos, que es
/// como se revisa «que subi este mes».
pub fn historial_de_precios(
    conexion: &Connection,
    producto_id: Option<i64>,
    limite: i64,
) -> Result<Vec<CambioDePrecio>, ErrorReporte> {
    let filtro = if producto_id.is_some() {
        "WHERE h.producto_id = ?1"
    } else {
        "WHERE ?1 IS NULL"
    };
    let mut consulta = conexion.prepare(&format!(
        "SELECT h.id,
                strftime('%Y-%m-%d %H:%M', h.created_at, 'localtime'),
                p.nombre, h.empaque_nombre, h.precio_anterior, h.precio_nuevo,
                h.motivo, COALESCE(u.nombre, '')
         FROM precios_historial h
         JOIN productos p ON p.id = h.producto_id
         LEFT JOIN usuarios u ON u.id = h.usuario_id
         {filtro}
         ORDER BY h.id DESC
         LIMIT ?2"
    ))?;
    let filas = consulta
        .query_map(params![producto_id, limite], |f| {
            let anterior: Option<i64> = f.get(4)?;
            let nuevo: i64 = f.get(5)?;
            Ok(CambioDePrecio {
                id: f.get(0)?,
                fecha: f.get(1)?,
                producto: f.get(2)?,
                empaque: f.get(3)?,
                precio_anterior: anterior,
                precio_nuevo: nuevo,
                // Sobre el anterior, que es contra lo que se compara. Un
                // precio que no existia no subio ni bajo: es el primero.
                variacion: anterior
                    .filter(|a| *a > 0)
                    .map(|a| ((nuevo - a) * 100) / a),
                motivo: f.get(6)?,
                usuario: f.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

/// Kardex: todo lo que le paso a un producto, en orden.
pub fn movimientos_de_producto(
    conexion: &Connection,
    producto_id: i64,
    limite: i64,
) -> Result<Vec<FilaMovimiento>, ErrorReporte> {
    let mut consulta = conexion.prepare(
        "SELECT m.id,
                strftime('%Y-%m-%d %H:%M', m.created_at, 'localtime'),
                p.nombre, m.tipo, m.cantidad_base, m.existencia_despues,
                m.motivo, COALESCE(u.nombre, ''),
                -- Deshacer solo aplica a los ajustes manuales que no se
                -- hayan deshecho ya: dos veces lo dejaria al reves.
                CASE WHEN m.tipo = 'AJUSTE' AND NOT EXISTS (
                       SELECT 1 FROM movimientos_inventario d
                       WHERE d.referencia_tipo = 'MANUAL' AND d.referencia_id = m.id)
                     THEN 1 ELSE 0 END
         FROM movimientos_inventario m
         JOIN productos p ON p.id = m.producto_id
         LEFT JOIN usuarios u ON u.id = m.usuario_id
         WHERE m.producto_id = ?1
         ORDER BY m.id DESC LIMIT ?2",
    )?;
    let filas = consulta
        .query_map(params![producto_id, limite], |f| {
            Ok(FilaMovimiento {
                id: f.get(0)?,
                fecha: f.get(1)?,
                producto: f.get(2)?,
                tipo: f.get(3)?,
                cantidad: f.get(4)?,
                existencia_despues: f.get(5)?,
                motivo: f.get(6)?,
                usuario: f.get(7)?,
                se_puede_deshacer: f.get::<_, i64>(8)? == 1,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::caja;
    use crate::db::abrir_en_memoria;
    use crate::ventas::{self, ItemCarrito, PagoRecibido, VentaEntrante};

    const HOY: &str = "date('now', 'localtime')";

    fn hoy(db: &Connection) -> String {
        db.query_row(&format!("SELECT {HOY}"), [], |f| f.get(0)).unwrap()
    }

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
                precio_venta, costo_promedio)
             VALUES (1, 'CER-POKER', 'POKER', 9, '330 ml', 100, 3900, 2100),
                    (2, 'AGU-NECTAR', 'NECTAR', 5, '750 ml', 20, 62000, 40000)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO producto_empaques (id, producto_id, nombre, factor, precio_venta, predeterminado)
             VALUES (1, 1, 'Unidad', 1, 3900, 1), (2, 2, 'Unidad', 1, 62000, 1)",
            [],
        )
        .unwrap();
        caja::abrir(&db, 1, 100_000, None).unwrap();

        for (producto, empaque, precio, veces) in [(1, 1, 3_900, 4), (2, 2, 62_000, 1)] {
            for _ in 0..veces {
                ventas::registrar(
                    &mut db,
                    &VentaEntrante {
                        items: vec![ItemCarrito { producto_id: producto, empaque_id: Some(empaque), cantidad: 1, descuento: 0 }],
                        pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: precio, recibido: None }],
                        usuario_id: 1,
                        notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
                    },
                )
                .unwrap();
            }
        }
        db
    }

    #[test]
    fn ventas_por_dia_no_multiplica_el_total_por_los_renglones() {
        let db = escenario();
        let d = hoy(&db);
        let filas = ventas_por_dia(&db, &d, &d).unwrap();

        assert_eq!(filas.len(), 1);
        assert_eq!(filas[0].ventas, 5);
        assert_eq!(filas[0].total, 4 * 3_900 + 62_000);
    }

    #[test]
    fn el_reporte_por_producto_ordena_por_lo_que_mas_dinero_dejo() {
        let db = escenario();
        let d = hoy(&db);
        let filas = ventas_por_producto(&db, &d, &d, true).unwrap();

        assert_eq!(filas[0].producto, "NECTAR", "62.000 pesa mas que 15.600");
        assert_eq!(filas[0].total, 62_000);
        assert_eq!(filas[1].producto, "POKER");
        assert_eq!(filas[1].unidades, 4);
    }

    #[test]
    fn la_utilidad_no_llega_a_quien_no_puede_verla() {
        let db = escenario();
        let d = hoy(&db);

        assert!(ventas_por_producto(&db, &d, &d, false).unwrap()[0].utilidad.is_none());
        assert!(ventas_por_producto(&db, &d, &d, true).unwrap()[0].utilidad.is_some());
    }

    #[test]
    fn la_participacion_por_categoria_suma_cien() {
        let db = escenario();
        let d = hoy(&db);
        let filas = ventas_por_categoria(&db, &d, &d).unwrap();

        let suma: i64 = filas.iter().map(|f| f.participacion).sum();
        assert!((99..=100).contains(&suma), "dio {suma}");
    }

    #[test]
    fn el_reporte_por_usuario_separa_las_anuladas() {
        let mut db = escenario();
        let venta: i64 = db
            .query_row("SELECT id FROM ventas LIMIT 1", [], |f| f.get(0))
            .unwrap();
        ventas::anular(&mut db, venta, "prueba", 1, None).unwrap();

        let d = hoy(&db);
        let filas = ventas_por_usuario(&db, &d, &d).unwrap();

        assert_eq!(filas[0].usuario, "Cajero");
        assert_eq!(filas[0].ventas, 4, "las completadas");
        assert_eq!(filas[0].anuladas, 1);
    }

    #[test]
    fn los_cierres_muestran_la_diferencia_y_su_explicacion() {
        let db = escenario();
        let caja_id = caja::abierta(&db).unwrap().unwrap().id;
        caja::cerrar(&db, caja_id, 100_000, 1, Some("falto plata")).unwrap();

        let d = hoy(&db);
        let filas = cierres_de_caja(&db, &d, &d).unwrap();

        assert_eq!(filas.len(), 1);
        assert!(filas[0].diferencia.unwrap() < 0);
        assert_eq!(filas[0].observaciones.as_deref(), Some("falto plata"));
    }

    #[test]
    fn el_kardex_muestra_los_movimientos_del_mas_nuevo_al_mas_viejo() {
        let db = escenario();
        let filas = movimientos_de_producto(&db, 1, 50).unwrap();

        assert_eq!(filas.len(), 4, "las cuatro ventas de Poker");
        assert!(filas.iter().all(|f| f.tipo == "VENTA"));
        assert_eq!(filas[0].existencia_despues, 96, "el ultimo movimiento primero");
    }

    #[test]
    fn el_kardex_corta_donde_se_le_diga_y_deja_lo_mas_nuevo() {
        let db = escenario();

        let dos = movimientos_de_producto(&db, 1, 2).unwrap();
        assert_eq!(dos.len(), 2, "el tope manda");

        // Lo que se corta es la cola vieja, no la cabeza: quien abre el
        // kardex quiere ver lo de ayer, no lo del primer dia. Se compara
        // contra el id mas alto y no contra otra consulta, que si el
        // orden estuviera al reves las dos mentirian igual.
        let todas = movimientos_de_producto(&db, 1, 50).unwrap();
        let mas_nuevo = todas.iter().map(|f| f.id).max().unwrap();
        assert_eq!(dos[0].id, mas_nuevo, "arriba va el ultimo movimiento");
        assert!(dos[1].id < dos[0].id, "y despues los anteriores");
    }

    #[test]
    fn un_periodo_sin_ventas_devuelve_vacio_sin_fallar() {
        let db = escenario();
        let filas = ventas_por_dia(&db, "2020-01-01", "2020-01-31").unwrap();
        assert!(filas.is_empty());

        let categorias = ventas_por_categoria(&db, "2020-01-01", "2020-01-31").unwrap();
        assert!(categorias.is_empty(), "sin ventas no se divide por cero");
    }
}

// ---------------------------------------------------------------------------
// Estado de resultados
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct GastoFijo {
    /// La categoría, o «Sin categoría» si el gasto no tiene ninguna.
    pub concepto: String,
    /// Lo que se pagó de eso dentro del período. Es lo registrado, no una
    /// parte calculada de un valor mensual.
    pub del_periodo: i64,
    /// Cuántos pagos lo componen. «Sueldos $2.400.000» se lee distinto si
    /// son dos pagos que si son ocho.
    pub cuantos: i64,
}

/// Lo que deja cada linea del negocio.
#[derive(Debug, Clone, Serialize)]
pub struct UtilidadPorCategoria {
    pub categoria: String,
    pub ventas: i64,
    pub costo: i64,
    pub utilidad: i64,
    pub margen: i64,
    /// Que parte de la utilidad total del periodo sale de aqui.
    pub peso: i64,
}

/// Existencia que se perdio: rota, vencida, robada o descuadrada.
#[derive(Debug, Clone, Serialize)]
pub struct Merma {
    pub motivo: String,
    pub unidades: i64,
    /// Valorizada al costo, que es lo que de verdad costo perderla.
    pub costo: i64,
}

/// El mismo periodo, corrido hacia atras, para poder comparar.
#[derive(Debug, Clone, Serialize)]
pub struct PeriodoAnterior {
    pub desde: String,
    pub hasta: String,
    pub ventas_netas: i64,
    pub utilidad_bruta: i64,
    pub utilidad_operacional: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct EstadoResultados {
    pub desde: String,
    pub hasta: String,
    pub dias: i64,

    // --- Ingresos ---
    /// Todo lo que paso por la caja, antes de restar nada: incluye lo que
    /// despues se anulo. Se empieza por aqui para que este reporte se
    /// pueda cuadrar contra el historial de ventas, que tambien las
    /// muestra. Si se partiera de lo que quedo en pie, las anuladas
    /// apareceriam restandose de un numero que ya las excluia y la
    /// cascada no cerraria.
    pub ventas_registradas: i64,
    /// Rebajas hechas en el mostrador.
    pub descuentos: i64,
    /// Ventas del periodo que despues se anularon. No son ingreso, pero
    /// esconderlas haria que las cuentas no cuadren contra el historial.
    pub anulaciones: i64,
    pub ventas_netas: i64,
    /// Impuesto cobrado aparte, si el negocio lo separa. Con precios que
    /// ya lo incluyen —el caso normal aqui— vale cero.
    pub impuestos: i64,

    // --- Costo de lo vendido ---
    pub costo_de_ventas: i64,
    pub utilidad_bruta: i64,
    pub margen_bruto: i64,

    // --- Perdidas de inventario ---
    pub mermas: Vec<Merma>,
    pub total_merma: i64,
    pub utilidad_bruta_ajustada: i64,

    // --- Gastos ---
    pub gastos: Vec<GastoFijo>,
    pub total_gastos: i64,
    pub utilidad_operacional: i64,
    pub margen_operacional: i64,

    // --- Para entender el numero ---
    pub por_categoria: Vec<UtilidadPorCategoria>,
    pub anterior: Option<PeriodoAnterior>,
    /// Cuanto hay que vender para no perder plata, al margen actual.
    pub punto_de_equilibrio: i64,
    pub ventas_contadas: i64,
    pub unidades_vendidas: i64,
    pub ticket_promedio: i64,

    /// Cuánto de lo vendido en el período se fio y todavía no ha
    /// entrado. La utilidad lo cuenta —contablemente la venta esta
    /// hecha—, pero esa plata esta en la calle. Leer «utilidad
    /// 2.400.000» sin saber que 600.000 estan fiados lleva a gastar lo
    /// que no hay.
    pub fiado_del_periodo: i64,
    /// De lo fiado en el período, cuánto sigue sin cobrarse hoy.
    pub fiado_sin_cobrar: i64,

    /// Cuántos renglones vendidos no tienen costo registrado. Mientras
    /// haya, el costo de ventas es menor que el real y la utilidad sale
    /// inflada. Hay que decirlo, no esconderlo.
    pub renglones_sin_costo: i64,
    /// Cuanta plata de esas ventas no tiene costo detras. Un renglon
    /// suelto no dice nada; mil pesos o un millon si.
    pub ventas_sin_costo: i64,
}

/// Estado de resultados del periodo.
///
/// Sigue el orden de un estado de resultados de verdad, y cada renglon
/// sale de un dato registrado, no de una estimacion:
///
///   Ventas brutas
///   (-) Descuentos concedidos
///   (-) Ventas anuladas
///   = Ventas netas
///   (-) Costo de la mercancia vendida
///   = Utilidad bruta
///   (-) Merma (roto, vencido, descuadrado)
///   = Utilidad bruta ajustada
///   (-) Gastos de operacion
///   = Utilidad operacional
///
/// Dos renglones que casi ningun POS muestra y aqui si:
///
/// - **Las anuladas.** No son ingreso, pero si no aparecen restadas, el
///   dueño no puede cuadrar este reporte contra el historial de ventas y
///   deja de creerle a los dos.
/// - **La merma.** Una botella rota es plata perdida igual que un gasto.
///   Si solo desaparece del inventario, la utilidad sale inflada y nadie
///   sabe cuanto se esta yendo en roturas.
///
/// Los gastos fijos estan guardados como mensuales, asi que se prorratean
/// por los dias del periodo sobre 30. Un mes completo da el gasto entero;
/// una semana, la cuarta parte.
pub fn estado_de_resultados(
    conexion: &Connection,
    desde: &str,
    hasta: &str,
) -> Result<EstadoResultados, ErrorReporte> {
    let dias = dias_del_periodo(conexion, desde, hasta);
    let cifras = cifras_del_periodo(conexion, desde, hasta)?;

    // Merma: los ajustes que sacaron existencia, valorizados al costo que
    // tenia el producto. Los que suman son correcciones de conteo, no
    // perdida, y no cuentan aqui.
    let mut consulta = conexion.prepare(
        "SELECT COALESCE(NULLIF(TRIM(m.motivo), ''), 'Sin motivo anotado'),
                SUM(-m.cantidad_base),
                SUM(-m.cantidad_base * COALESCE(p.costo_promedio, p.costo_ultimo, 0))
         FROM movimientos_inventario m
         JOIN productos p ON p.id = m.producto_id
         WHERE m.tipo IN ('AJUSTE','BAJA')
           AND m.cantidad_base < 0
           AND date(m.created_at, 'localtime') BETWEEN ?1 AND ?2
         GROUP BY 1 ORDER BY 3 DESC",
    )?;
    let mermas: Vec<Merma> = consulta
        .query_map(params![desde, hasta], |f| {
            Ok(Merma { motivo: f.get(0)?, unidades: f.get(1)?, costo: f.get(2)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let total_merma: i64 = mermas.iter().map(|m| m.costo).sum();

    // Los gastos del período, agrupados por categoría. Se suma lo que se
    // registró con fecha dentro del rango: nada se prorratea. Un arriendo
    // que se paga el primero aparece entero en el mes y no aparece en una
    // semana que no lo incluya, que es lo que de verdad pasó.
    let mut consulta = conexion.prepare(
        "SELECT COALESCE(c.nombre, 'Sin categoría'), SUM(g.monto), COUNT(*)
         FROM gastos g
         LEFT JOIN gasto_categorias c ON c.id = g.categoria_id
         WHERE g.anulado = 0 AND g.fecha BETWEEN ?1 AND ?2
         GROUP BY COALESCE(c.nombre, 'Sin categoría')
         ORDER BY SUM(g.monto) DESC",
    )?;
    let gastos: Vec<GastoFijo> = consulta
        .query_map(params![desde, hasta], |f| {
            Ok(GastoFijo {
                concepto: f.get(0)?,
                del_periodo: f.get(1)?,
                cuantos: f.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let total_gastos: i64 = gastos.iter().map(|g| g.del_periodo).sum();

    // Lo que se fio en el periodo y lo que de eso sigue afuera. Las
    // cuentas anuladas no cuentan: esa venta se deshizo.
    let fiado: (i64, i64) = conexion.query_row(
        &format!(
            "SELECT COALESCE(SUM(cu.monto), 0),
                    COALESCE(SUM(cu.monto - COALESCE((
                        SELECT SUM(a.monto) FROM abonos a
                        WHERE a.cuenta_id = cu.id AND a.anulado = 0), 0)), 0)
             FROM cuentas_cobrar cu
             JOIN ventas v ON v.id = cu.venta_id
             WHERE cu.anulada = 0 AND v.estado = 'COMPLETADA' AND {RANGO}"
        ),
        params![desde, hasta],
        |f| Ok((f.get(0)?, f.get(1)?)),
    )?;

    let utilidad_bruta = cifras.ventas_netas - cifras.costo;
    let utilidad_bruta_ajustada = utilidad_bruta - total_merma;
    let utilidad_operacional = utilidad_bruta_ajustada - total_gastos;

    // Por categoria, para saber que linea sostiene el negocio.
    let mut consulta = conexion.prepare(
        &format!(
            "SELECT c.nombre,
                    COALESCE(SUM(i.total), 0),
                    COALESCE(SUM(COALESCE(i.costo_unitario, 0) * i.cantidad_base), 0)
             FROM venta_items i
             JOIN ventas v ON v.id = i.venta_id
             JOIN productos p ON p.id = i.producto_id
             JOIN categorias c ON c.id = p.categoria_id
             WHERE v.estado = 'COMPLETADA' AND {RANGO}
             GROUP BY c.id ORDER BY 2 DESC"
        ),
    )?;
    let crudas: Vec<(String, i64, i64)> = consulta
        .query_map(params![desde, hasta], |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    let utilidad_total_categorias: i64 = crudas.iter().map(|(_, v, c)| v - c).sum();
    let por_categoria: Vec<UtilidadPorCategoria> = crudas
        .into_iter()
        .map(|(categoria, ventas, costo)| {
            let utilidad = ventas - costo;
            UtilidadPorCategoria {
                categoria,
                ventas,
                costo,
                utilidad,
                margen: porcentaje(utilidad, ventas),
                peso: porcentaje(utilidad, utilidad_total_categorias),
            }
        })
        .collect();

    // El mismo numero de dias, inmediatamente antes.
    let anterior = periodo_anterior(conexion, desde, dias, total_gastos)?;

    // Punto de equilibrio: cuanto hay que vender para cubrir gastos y
    // merma con el margen que se esta logrando. Sin margen no hay numero
    // que valga: por mucho que venda, no cubre nada.
    let punto_de_equilibrio = if cifras.ventas_netas > 0 && utilidad_bruta > 0 {
        ((total_gastos + total_merma) * cifras.ventas_netas) / utilidad_bruta
    } else {
        0
    };

    Ok(EstadoResultados {
        desde: desde.to_owned(),
        hasta: hasta.to_owned(),
        dias,

        ventas_registradas: cifras.ventas_registradas,
        descuentos: cifras.descuentos,
        anulaciones: cifras.anuladas,
        ventas_netas: cifras.ventas_netas,
        impuestos: cifras.impuestos,

        costo_de_ventas: cifras.costo,
        utilidad_bruta,
        margen_bruto: porcentaje(utilidad_bruta, cifras.ventas_netas),

        mermas,
        total_merma,
        utilidad_bruta_ajustada,

        gastos,
        total_gastos,
        utilidad_operacional,
        margen_operacional: porcentaje(utilidad_operacional, cifras.ventas_netas),

        por_categoria,
        anterior,
        punto_de_equilibrio,
        fiado_del_periodo: fiado.0,
        fiado_sin_cobrar: fiado.1,
        ventas_contadas: cifras.cuantas,
        unidades_vendidas: cifras.unidades,
        ticket_promedio: if cifras.cuantas > 0 {
            cifras.ventas_netas / cifras.cuantas
        } else {
            0
        },

        renglones_sin_costo: cifras.sin_costo,
        ventas_sin_costo: cifras.ventas_sin_costo,
    })
}

/// Todo lo que sale de las ventas de un periodo, en una sola pasada.
struct CifrasVenta {
    ventas_registradas: i64,
    descuentos: i64,
    ventas_netas: i64,
    anuladas: i64,
    impuestos: i64,
    costo: i64,
    sin_costo: i64,
    ventas_sin_costo: i64,
    cuantas: i64,
    unidades: i64,
}

fn cifras_del_periodo(
    conexion: &Connection,
    desde: &str,
    hasta: &str,
) -> Result<CifrasVenta, ErrorReporte> {
    // El total del renglon ya viene con su descuento restado, asi que lo
    // bruto se reconstruye sumandoselo de vuelta.
    let (ventas_netas, descuentos, costo, sin_costo, ventas_sin_costo, unidades) = conexion
        .query_row(
            &format!(
                "SELECT
                   COALESCE(SUM(i.total), 0),
                   COALESCE(SUM(i.descuento), 0),
                   COALESCE(SUM(COALESCE(i.costo_unitario, 0) * i.cantidad_base), 0),
                   COALESCE(SUM(CASE WHEN i.costo_unitario IS NULL THEN 1 ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN i.costo_unitario IS NULL THEN i.total ELSE 0 END), 0),
                   COALESCE(SUM(i.cantidad_base), 0)
                 FROM venta_items i
                 JOIN ventas v ON v.id = i.venta_id
                 WHERE v.estado = 'COMPLETADA' AND {RANGO}"
            ),
            params![desde, hasta],
            |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?, f.get(4)?, f.get(5)?)),
        )?;

    let (cuantas, impuestos): (i64, i64) = conexion.query_row(
        &format!(
            "SELECT COUNT(*), COALESCE(SUM(v.impuesto), 0)
             FROM ventas v WHERE v.estado = 'COMPLETADA' AND {RANGO}"
        ),
        params![desde, hasta],
        |f| Ok((f.get(0)?, f.get(1)?)),
    )?;

    let anuladas: i64 = conexion.query_row(
        &format!(
            "SELECT COALESCE(SUM(v.total), 0)
             FROM ventas v WHERE v.estado = 'ANULADA' AND {RANGO}"
        ),
        params![desde, hasta],
        |f| f.get(0),
    )?;

    Ok(CifrasVenta {
        // Lo completado con su descuento devuelto, mas lo que se anulo.
        // Restarle luego descuentos y anuladas devuelve exactamente lo
        // neto: la cascada cierra.
        ventas_registradas: ventas_netas + descuentos + anuladas,
        descuentos,
        ventas_netas,
        anuladas,
        impuestos,
        costo,
        sin_costo,
        ventas_sin_costo,
        cuantas,
        unidades,
    })
}

/// Dias del periodo, ambos extremos incluidos.
fn dias_del_periodo(conexion: &Connection, desde: &str, hasta: &str) -> i64 {
    conexion
        .query_row(
            "SELECT CAST(julianday(?2) - julianday(?1) AS INTEGER) + 1",
            params![desde, hasta],
            |f| f.get(0),
        )
        .unwrap_or(1)
        .max(1)
}

/// El mismo numero de dias, justo antes del periodo consultado.
///
/// Se compara contra un tramo igual de largo y no contra "el mes pasado":
/// una semana contra un mes no dice nada.
fn periodo_anterior(
    conexion: &Connection,
    desde: &str,
    dias: i64,
    gastos_del_periodo: i64,
) -> Result<Option<PeriodoAnterior>, ErrorReporte> {
    let (ini, fin): (String, String) = conexion.query_row(
        "SELECT date(?1, '-' || ?2 || ' days'), date(?1, '-1 day')",
        params![desde, dias],
        |f| Ok((f.get(0)?, f.get(1)?)),
    )?;

    let cifras = cifras_del_periodo(conexion, &ini, &fin)?;
    if cifras.cuantas == 0 {
        // Sin ventas antes no hay con que comparar, y un "-100 %" contra
        // la nada engaña mas de lo que informa.
        return Ok(None);
    }

    let utilidad_bruta = cifras.ventas_netas - cifras.costo;
    Ok(Some(PeriodoAnterior {
        desde: ini,
        hasta: fin,
        ventas_netas: cifras.ventas_netas,
        utilidad_bruta,
        utilidad_operacional: utilidad_bruta - gastos_del_periodo,
    }))
}

/// Porcentaje entero, y cero cuando no hay sobre que calcularlo.
fn porcentaje(parte: i64, total: i64) -> i64 {
    if total == 0 { 0 } else { (parte * 100) / total }
}


#[cfg(test)]
mod pruebas_estado {
    use super::*;
    use crate::caja;
    use crate::db::abrir_en_memoria;
    use crate::ventas::{self, ItemCarrito, PagoRecibido, VentaEntrante};

    fn hoy(db: &Connection) -> String {
        db.query_row("SELECT date('now','localtime')", [], |f| f.get(0)).unwrap()
    }

    /// Un producto que se vende a 3.900 y costó 2.100.
    fn negocio_con_una_venta() -> Connection {
        let mut db = abrir_en_memoria().unwrap();
        db.execute(
            "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
             VALUES ('admin', 'Camilo', 'h', 'ADMINISTRADOR')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO productos
               (id, codigo, nombre, categoria_id, presentacion, existencia,
                precio_venta, costo_promedio)
             VALUES (1, 'CER-POKER', 'POKER', 9, '330 ml', 100, 3900, 2100)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO producto_empaques
               (id, producto_id, nombre, factor, precio_venta, predeterminado)
             VALUES (1, 1, 'Unidad', 1, 3900, 1)",
            [],
        )
        .unwrap();
        caja::abrir(&db, 1, 100_000, None).unwrap();

        ventas::registrar(
            &mut db,
            &VentaEntrante {
                items: vec![ItemCarrito { producto_id: 1, empaque_id: Some(1), cantidad: 10, descuento: 0 }],
                pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: 39_000, recibido: None }],
                usuario_id: 1,
                notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
            },
        )
        .unwrap();
        db
    }

    #[test]
    fn la_utilidad_bruta_es_lo_vendido_menos_lo_que_costo() {
        let db = negocio_con_una_venta();
        let d = hoy(&db);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert_eq!(e.ventas_netas, 39_000);
        assert_eq!(e.costo_de_ventas, 21_000, "10 unidades a 2.100 de costo");
        assert_eq!(e.utilidad_bruta, 18_000);
        assert_eq!(e.margen_bruto, 46, "18.000 de 39.000");
    }

    /// Anota un gasto y devuelve su id.
    fn con_gasto(db: &Connection, fecha: &str, concepto: &str, monto: i64) -> i64 {
        crate::gastos::registrar(
            db,
            &crate::gastos::GastoEditable {
                id: None,
                fecha: fecha.to_owned(),
                categoria_id: None,
                concepto: concepto.to_owned(),
                monto,
                nota: None,
            },
            1,
        )
        .unwrap()
    }

    #[test]
    fn los_gastos_del_periodo_son_los_que_se_pagaron_en_el_periodo() {
        let db = negocio_con_una_venta();
        let d = hoy(&db);
        con_gasto(&db, &d, "Arriendo", 800_000);
        con_gasto(&db, "2020-01-15", "Arriendo viejo", 500_000);

        let e = estado_de_resultados(&db, &d, &d).unwrap();

        // Nada se reparte por dias: es lo registrado con esa fecha. El de
        // 2020 no aparece por ningun lado.
        assert_eq!(e.total_gastos, 800_000);
        assert_eq!(e.gastos.len(), 1);
    }

    #[test]
    fn un_dia_sin_gastos_pagados_no_carga_ninguno() {
        let db = negocio_con_una_venta();
        let d = hoy(&db);
        con_gasto(&db, "2020-01-15", "Arriendo de otro tiempo", 800_000);

        let e = estado_de_resultados(&db, &d, &d).unwrap();

        // Antes, con el prorrateo, este dia cargaba 1/30 del arriendo
        // aunque ese arriendo fuera de hace seis años.
        assert_eq!(e.total_gastos, 0);
    }

    #[test]
    fn los_gastos_se_agrupan_por_categoria_y_dicen_cuantos_pagos_son() {
        let db = negocio_con_una_venta();
        let d = hoy(&db);
        let sueldos = crate::gastos::categorias(&db)
            .unwrap()
            .iter()
            .find(|c| c.nombre == "Sueldos")
            .unwrap()
            .id;
        for (concepto, monto) in [("Sueldo de Andres", 1_400_000), ("Sueldo de Luz", 1_400_000)] {
            crate::gastos::registrar(
                &db,
                &crate::gastos::GastoEditable {
                    id: None,
                    fecha: d.clone(),
                    categoria_id: Some(sueldos),
                    concepto: concepto.to_owned(),
                    monto,
                    nota: None,
                },
                1,
            )
            .unwrap();
        }

        let e = estado_de_resultados(&db, &d, &d).unwrap();
        let fila = e.gastos.iter().find(|g| g.concepto == "Sueldos").unwrap();

        assert_eq!(fila.del_periodo, 2_800_000);
        // «Sueldos 2.800.000» se lee distinto si son dos pagos que si son ocho.
        assert_eq!(fila.cuantos, 2);
    }

    /// Lo fiado se cuenta como venta pero no ha entrado.
    ///
    /// Contablemente la venta esta hecha, asi que suma a la utilidad. Lo
    /// que no puede pasar es que el dueño lea «utilidad 2.400.000» sin
    /// saber que una parte de eso esta en la calle.
    mod lo_que_esta_afuera {
        use super::*;

        /// Fia `cuanto` en pesos, hoy, a nombre de alguien.
        fn fiar(db: &mut Connection, cuanto: i64) -> i64 {
            let cliente = crate::fiados::crear_cliente(
                db,
                &crate::fiados::ClienteEditable {
                    id: None, nombre: format!("Cliente {cuanto}"), telefono: None,
                    documento: None, nota: None, cupo: 0,
                },
            )
            .unwrap();
            let fiado: i64 = db
                .query_row(
                    "SELECT id FROM metodos_pago WHERE codigo = 'FIADO'", [], |f| f.get(0),
                )
                .unwrap();
            let unidades = cuanto / 3_900;
            crate::ventas::registrar(
                db,
                &crate::ventas::VentaEntrante {
                    items: vec![crate::ventas::ItemCarrito {
                        producto_id: 1, empaque_id: Some(1), cantidad: unidades, descuento: 0,
                    }],
                    pagos: vec![crate::ventas::PagoRecibido {
                        metodo_pago_id: fiado, monto: unidades * 3_900, recibido: None,
                    }],
                    usuario_id: 1,
                    notas: None,
                    recargo: None,
                    cliente_id: Some(cliente),
                    cliente_nombre: None,
                },
            )
            .unwrap();
            cliente
        }

        #[test]
        fn el_estado_dice_cuanto_se_fio_y_cuanto_sigue_afuera() {
            let mut db = negocio_con_una_venta();
            let d = hoy(&db);
            fiar(&mut db, 39_000);

            let e = estado_de_resultados(&db, &d, &d).unwrap();

            assert_eq!(e.fiado_del_periodo, 39_000);
            assert_eq!(e.fiado_sin_cobrar, 39_000);
            // Y suma a las ventas: la venta esta hecha.
            assert!(e.ventas_netas > 39_000);
        }

        #[test]
        fn lo_abonado_deja_de_estar_afuera() {
            let mut db = negocio_con_una_venta();
            let d = hoy(&db);
            let cliente = fiar(&mut db, 39_000);
            let cuenta = crate::fiados::cuentas_de(&db, cliente, true).unwrap()[0].id;
            let efectivo: i64 = db
                .query_row(
                    "SELECT id FROM metodos_pago WHERE codigo = 'EFECTIVO'", [], |f| f.get(0),
                )
                .unwrap();
            crate::fiados::abonar(&mut db, cuenta, 20_000, efectivo, 1, None).unwrap();

            let e = estado_de_resultados(&db, &d, &d).unwrap();

            // Se fio lo mismo; lo que cambio es cuanto falta por cobrar.
            assert_eq!(e.fiado_del_periodo, 39_000);
            assert_eq!(e.fiado_sin_cobrar, 19_000);
        }

        #[test]
        fn una_venta_fiada_anulada_no_cuenta_como_fiado() {
            let mut db = negocio_con_una_venta();
            let d = hoy(&db);
            fiar(&mut db, 39_000);
            let venta: i64 = db
                .query_row(
                    "SELECT MAX(id) FROM ventas", [], |f| f.get(0),
                )
                .unwrap();
            crate::ventas::anular(&mut db, venta, "se arrepintio", 1, None).unwrap();

            let e = estado_de_resultados(&db, &d, &d).unwrap();
            assert_eq!(e.fiado_del_periodo, 0);
            assert_eq!(e.fiado_sin_cobrar, 0);
        }

        #[test]
        fn sin_fiados_el_renglon_queda_en_cero() {
            let db = negocio_con_una_venta();
            let d = hoy(&db);

            let e = estado_de_resultados(&db, &d, &d).unwrap();
            assert_eq!(e.fiado_del_periodo, 0);
        }

        #[test]
        fn lo_fiado_en_otro_periodo_no_se_cuela() {
            let mut db = negocio_con_una_venta();
            fiar(&mut db, 39_000);

            // La venta es de hoy; se consulta un mes de 2020.
            let e = estado_de_resultados(&db, "2020-01-01", "2020-01-31").unwrap();
            assert_eq!(e.fiado_del_periodo, 0);
        }
    }

    #[test]
    fn un_gasto_anulado_deja_de_pesar() {
        let db = negocio_con_una_venta();
        let d = hoy(&db);
        let id = con_gasto(&db, &d, "Arriendo", 800_000);

        crate::gastos::anular(&db, id, "lo pague dos veces", 1).unwrap();

        assert_eq!(estado_de_resultados(&db, &d, &d).unwrap().total_gastos, 0);
    }

    #[test]
    fn la_utilidad_operacional_descuenta_los_gastos() {
        let db = negocio_con_una_venta();
        let d = hoy(&db);
        con_gasto(&db, &d, "Arriendo", 800_000);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert_eq!(
            e.utilidad_operacional,
            e.utilidad_bruta - e.total_merma - e.total_gastos,
        );
        assert!(e.total_gastos > 0);
    }

    #[test]
    fn avisa_cuando_hay_ventas_sin_costo_registrado() {
        let db = negocio_con_una_venta();
        // Una venta de un producto sin costo: la utilidad sale inflada y
        // hay que decirlo, no esconderlo.
        db.execute("UPDATE venta_items SET costo_unitario = NULL", []).unwrap();

        let d = hoy(&db);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert!(e.renglones_sin_costo > 0);
        assert_eq!(e.costo_de_ventas, 0);
    }

    // -----------------------------------------------------------------
    // Lo que un estado de resultados tiene que dejar cuadrado
    // -----------------------------------------------------------------

    /// El renglon de arriba tiene que llevar al de abajo sin saltos.
    #[test]
    fn la_cascada_cuadra_de_arriba_abajo() {
        let db = negocio_con_una_venta();
        let d = hoy(&db);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert_eq!(
            e.ventas_netas,
            e.ventas_registradas - e.descuentos - e.anulaciones,
            "de lo que paso por caja se restan descuentos y anuladas",
        );
        assert_eq!(e.utilidad_bruta, e.ventas_netas - e.costo_de_ventas);
        assert_eq!(e.utilidad_bruta_ajustada, e.utilidad_bruta - e.total_merma);
        assert_eq!(
            e.utilidad_operacional,
            e.utilidad_bruta_ajustada - e.total_gastos,
        );
    }

    /// Un descuento en el mostrador es plata que se dejo de cobrar y
    /// tiene que verse, no desaparecer dentro del total.
    #[test]
    fn los_descuentos_se_ven_aparte_de_lo_vendido() {
        let mut db = negocio_con_una_venta();
        caja::abrir(&db, 1, 0, None).ok();
        ventas::registrar(
            &mut db,
            &VentaEntrante {
                items: vec![ItemCarrito {
                    producto_id: 1, empaque_id: Some(1), cantidad: 2, descuento: 1_800,
                }],
                pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: 6_000, recibido: None }],
                usuario_id: 1,
                notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
            },
        )
        .unwrap();

        let d = hoy(&db);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert_eq!(e.descuentos, 1_800);
        assert_eq!(e.ventas_registradas, e.ventas_netas + 1_800);
        // Y lo neto es lo que de verdad entro.
        assert_eq!(e.ventas_netas, 39_000 + (3_900 * 2 - 1_800));
    }

    /// Una venta anulada no es ingreso, pero tiene que aparecer restada:
    /// si no, el reporte no cuadra contra el historial y el dueño deja de
    /// creerle a los dos.
    #[test]
    fn las_anuladas_no_suman_pero_se_muestran() {
        let mut db = negocio_con_una_venta();
        let id: i64 = db
            .query_row("SELECT id FROM ventas LIMIT 1", [], |f| f.get(0))
            .unwrap();
        ventas::anular(&mut db, id, "prueba", 1, None).unwrap();

        let d = hoy(&db);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert_eq!(e.ventas_netas, 0, "lo anulado no es ingreso");
        assert_eq!(e.anulaciones, 39_000, "pero se ve cuanto se anulo");
        assert_eq!(e.costo_de_ventas, 0);
    }

    /// Con una vendida y otra anulada a la vez, cada una tiene que caer
    /// en su renglon. Anular la unica venta que hay no lo demuestra: sin
    /// nada completado, sumar mal las dos da el mismo resultado.
    #[test]
    fn separa_lo_vendido_de_lo_anulado_cuando_hay_de_los_dos() {
        let mut db = negocio_con_una_venta();

        // Una segunda venta, que se anula.
        ventas::registrar(
            &mut db,
            &VentaEntrante {
                items: vec![ItemCarrito {
                    producto_id: 1, empaque_id: Some(1), cantidad: 4, descuento: 0,
                }],
                pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: 15_600, recibido: None }],
                usuario_id: 1,
                notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
            },
        )
        .unwrap();
        let segunda: i64 = db
            .query_row("SELECT MAX(id) FROM ventas", [], |f| f.get(0))
            .unwrap();
        ventas::anular(&mut db, segunda, "se arrepintio", 1, None).unwrap();

        let d = hoy(&db);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert_eq!(e.ventas_netas, 39_000, "solo la que quedo en pie");
        assert_eq!(e.anulaciones, 15_600, "y solo la anulada aqui");
        assert_eq!(e.ventas_contadas, 1);
        assert_eq!(e.costo_de_ventas, 21_000, "la anulada no costo nada");
    }

    /// El renglon de arriba tiene que llevar al de abajo TAMBIEN cuando
    /// hay anuladas. Es el caso donde es facil que no cierre.
    #[test]
    fn la_cascada_cierra_aunque_haya_anuladas() {
        let mut db = negocio_con_una_venta();
        ventas::registrar(
            &mut db,
            &VentaEntrante {
                items: vec![ItemCarrito {
                    producto_id: 1, empaque_id: Some(1), cantidad: 4, descuento: 0,
                }],
                pagos: vec![PagoRecibido { metodo_pago_id: 1, monto: 15_600, recibido: None }],
                usuario_id: 1,
                notas: None,
                    recargo: None,
                    cliente_id: None,
                    cliente_nombre: None,
            },
        )
        .unwrap();
        let segunda: i64 = db
            .query_row("SELECT MAX(id) FROM ventas", [], |f| f.get(0))
            .unwrap();
        ventas::anular(&mut db, segunda, "se arrepintio", 1, None).unwrap();

        let d = hoy(&db);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert_eq!(e.ventas_registradas, 39_000 + 15_600, "todo lo que paso por caja");
        assert_eq!(e.anulaciones, 15_600);
        assert_eq!(
            e.ventas_netas,
            e.ventas_registradas - e.descuentos - e.anulaciones,
        );
        assert_eq!(e.ventas_netas, 39_000);
    }

    /// Una botella rota es plata perdida igual que un gasto. Si solo
    /// desaparece del inventario, la utilidad sale inflada.
    #[test]
    fn la_merma_baja_la_utilidad_y_dice_por_que() {
        let mut db = negocio_con_una_venta();
        crate::inventario::productos::ajustar(
            &mut db,
            &crate::inventario::productos::Ajuste {
                producto_id: 1,
                cantidad: -5,
                motivo: "Se rompieron en el estante".to_owned(),
                usuario_id: 1,
            },
        )
        .unwrap();

        let d = hoy(&db);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert_eq!(e.total_merma, 5 * 2_100, "cinco unidades al costo");
        assert_eq!(e.mermas.len(), 1);
        assert_eq!(e.mermas[0].motivo, "Se rompieron en el estante");
        assert_eq!(e.mermas[0].unidades, 5);
        assert_eq!(e.utilidad_bruta_ajustada, e.utilidad_bruta - 10_500);
    }

    /// Contar un ajuste que suma como si fuera perdida seria inventarse
    /// un costo que nadie tuvo.
    #[test]
    fn un_ajuste_que_suma_no_es_merma() {
        let mut db = negocio_con_una_venta();
        crate::inventario::productos::ajustar(
            &mut db,
            &crate::inventario::productos::Ajuste {
                producto_id: 1,
                cantidad: 8,
                motivo: "Aparecieron en la bodega".to_owned(),
                usuario_id: 1,
            },
        )
        .unwrap();

        let d = hoy(&db);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert_eq!(e.total_merma, 0);
        assert!(e.mermas.is_empty());
    }

    #[test]
    fn dice_que_categoria_sostiene_el_negocio() {
        let db = negocio_con_una_venta();
        let d = hoy(&db);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert_eq!(e.por_categoria.len(), 1);
        let linea = &e.por_categoria[0];
        assert_eq!(linea.ventas, 39_000);
        assert_eq!(linea.utilidad, 18_000);
        assert_eq!(linea.peso, 100, "es la unica, se lleva todo");
    }

    #[test]
    fn compara_contra_un_tramo_igual_de_largo() {
        let db = negocio_con_una_venta();
        let d = hoy(&db);

        // Sin ventas antes no hay con que comparar, y un -100 % contra la
        // nada engaña mas de lo que informa.
        let e = estado_de_resultados(&db, &d, &d).unwrap();
        assert!(e.anterior.is_none());

        // Con un periodo de tres dias, el anterior son los tres de antes.
        let hace_dos: String = db
            .query_row("SELECT date('now','localtime','-2 days')", [], |f| f.get(0))
            .unwrap();
        let e = estado_de_resultados(&db, &hace_dos, &d).unwrap();
        assert_eq!(e.dias, 3);
    }

    /// Con margen cero no hay volumen que cubra los gastos, y un numero
    /// enorme ahi seria peor que ninguno.
    #[test]
    fn el_punto_de_equilibrio_necesita_margen() {
        let db = negocio_con_una_venta();
        let d = hoy(&db);
        // Sin gastos no hay nada que cubrir: el punto de equilibrio es 0
        // y la prueba no diria nada.
        con_gasto(&db, &d, "Arriendo", 800_000);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        // Vendiendo con 46 % de margen, para cubrir los gastos hay que
        // vender los gastos divididos por ese margen.
        assert!(e.punto_de_equilibrio > e.total_gastos);

        db.execute("UPDATE venta_items SET costo_unitario = 3900", []).unwrap();
        let sin_margen = estado_de_resultados(&db, &d, &d).unwrap();
        assert_eq!(sin_margen.punto_de_equilibrio, 0);
    }

    #[test]
    fn el_ticket_promedio_sale_de_las_ventas_que_hubo() {
        let db = negocio_con_una_venta();
        let d = hoy(&db);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert_eq!(e.ventas_contadas, 1);
        assert_eq!(e.unidades_vendidas, 10);
        assert_eq!(e.ticket_promedio, 39_000);
    }

    /// Un renglon suelto sin costo no dice nada; saber cuanta plata no
    /// tiene costo detras si.
    #[test]
    fn dice_cuanta_venta_esta_sin_costo() {
        let db = negocio_con_una_venta();
        db.execute("UPDATE venta_items SET costo_unitario = NULL", []).unwrap();

        let d = hoy(&db);
        let e = estado_de_resultados(&db, &d, &d).unwrap();

        assert_eq!(e.renglones_sin_costo, 1);
        assert_eq!(e.ventas_sin_costo, 39_000);
    }

    #[test]
    fn un_periodo_sin_ventas_no_divide_por_cero() {
        let db = negocio_con_una_venta();
        // Un mes con arriendo pagado y sin una sola venta.
        con_gasto(&db, "2020-01-05", "Arriendo", 800_000);
        let e = estado_de_resultados(&db, "2020-01-01", "2020-01-31").unwrap();

        assert_eq!(e.ventas_netas, 0);
        assert_eq!(e.margen_bruto, 0);
        assert_eq!(e.ticket_promedio, 0);
        assert_eq!(e.punto_de_equilibrio, 0);
        // Lo que se pago se pago, aunque no haya entrado nada.
        assert!(e.utilidad_operacional < 0);
    }
}
