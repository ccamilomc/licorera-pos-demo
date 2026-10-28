//! Comandos de reportes.
//!
//! Todos exigen permiso de operación, y los que muestran dinero de fondo
//! comprueban aparte si el rol puede ver costos.

use serde::Deserialize;
use tauri::State;

use crate::reportes::consultas::{
    self, FilaCierre, FilaMovimiento, FilaPorCategoria, FilaPorProducto, FilaPorUsuario,
    FilaVentasPorDia,
};
use crate::usuarios::{permisos, Rol};
use crate::{ErrorApp, EstadoApp};

#[derive(Debug, Deserialize)]
pub struct Periodo {
    pub desde: String,
    pub hasta: String,
    pub rol: Rol,
}

/// Comprueba el permiso y entrega la conexión. Lo comparten todos los
/// reportes para que ninguno se olvide de validar.
macro_rules! con_permiso {
    ($estado:expr, $rol:expr, $permiso:expr) => {{
        let db = $estado
            .db
            .lock()
            .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
        permisos::exigir(&db, $rol, $permiso)
            .map_err(|e| ErrorApp::nuevo("No tienes permiso para ver este reporte.", e))?;
        db
    }};
}

fn fallo(e: impl std::fmt::Display) -> ErrorApp {
    ErrorApp::nuevo("No se pudo generar el reporte.", e)
}

#[tauri::command]
pub fn reporte_ventas_por_dia(
    estado: State<'_, EstadoApp>,
    periodo: Periodo,
) -> Result<Vec<FilaVentasPorDia>, ErrorApp> {
    let db = con_permiso!(estado, periodo.rol, permisos::REPORTE_OPERACION);
    consultas::ventas_por_dia(&db, &periodo.desde, &periodo.hasta).map_err(fallo)
}

#[tauri::command]
pub fn reporte_ventas_por_producto(
    estado: State<'_, EstadoApp>,
    periodo: Periodo,
) -> Result<Vec<FilaPorProducto>, ErrorApp> {
    let db = con_permiso!(estado, periodo.rol, permisos::REPORTE_OPERACION);
    let con_utilidad = permisos::tiene(&db, periodo.rol, permisos::UTILIDAD_VER).unwrap_or(false);
    consultas::ventas_por_producto(&db, &periodo.desde, &periodo.hasta, con_utilidad)
        .map_err(fallo)
}

#[tauri::command]
pub fn reporte_ventas_por_categoria(
    estado: State<'_, EstadoApp>,
    periodo: Periodo,
) -> Result<Vec<FilaPorCategoria>, ErrorApp> {
    let db = con_permiso!(estado, periodo.rol, permisos::REPORTE_OPERACION);
    consultas::ventas_por_categoria(&db, &periodo.desde, &periodo.hasta).map_err(fallo)
}

#[tauri::command]
pub fn reporte_ventas_por_usuario(
    estado: State<'_, EstadoApp>,
    periodo: Periodo,
) -> Result<Vec<FilaPorUsuario>, ErrorApp> {
    let db = con_permiso!(estado, periodo.rol, permisos::REPORTE_OPERACION);
    consultas::ventas_por_usuario(&db, &periodo.desde, &periodo.hasta).map_err(fallo)
}

#[tauri::command]
pub fn reporte_cierres_de_caja(
    estado: State<'_, EstadoApp>,
    periodo: Periodo,
) -> Result<Vec<FilaCierre>, ErrorApp> {
    let db = con_permiso!(estado, periodo.rol, permisos::CAJA_VER_TODAS);
    consultas::cierres_de_caja(&db, &periodo.desde, &periodo.hasta).map_err(fallo)
}

/// El primer día del que hay algo registrado.
///
/// Lo usa el selector de período para su atajo «Todo». Sin esto habría
/// que inventar una fecha de arranque, y ofrecer enero cuando el negocio
/// abrió en marzo es una manera de mentir.
///
/// No exige permiso: es una sola fecha, sin cifras detrás.
#[tauri::command]
pub fn primer_dia_con_movimiento(estado: State<'_, EstadoApp>) -> Result<Option<String>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    db.query_row(
        "SELECT MIN(dia) FROM (
             SELECT MIN(date(created_at, 'localtime')) AS dia FROM ventas
             UNION ALL
             SELECT MIN(fecha) FROM compras
             UNION ALL
             SELECT MIN(date(created_at, 'localtime')) FROM movimientos_inventario
         )",
        [],
        |f| f.get::<_, Option<String>>(0),
    )
    .map_err(|e| ErrorApp::nuevo("No se pudo leer desde cuándo hay movimiento.", e))
}

/// Cuando cambio de precio un producto, y de cuanto a cuanto.
#[tauri::command]
pub fn historial_de_precios(
    estado: State<'_, EstadoApp>,
    producto_id: Option<i64>,
    limite: Option<i64>,
    rol: Rol,
) -> Result<Vec<consultas::CambioDePrecio>, ErrorApp> {
    let db = con_permiso!(estado, rol, permisos::INVENTARIO_VER);
    let limite = limite.unwrap_or(100).clamp(1, 2_000);
    consultas::historial_de_precios(&db, producto_id, limite).map_err(fallo)
}

#[tauri::command]
pub fn reporte_kardex(
    estado: State<'_, EstadoApp>,
    producto_id: i64,
    limite: Option<i64>,
    rol: Rol,
) -> Result<Vec<FilaMovimiento>, ErrorApp> {
    let db = con_permiso!(estado, rol, permisos::INVENTARIO_VER);
    // La pantalla arranca con los ultimos 200 y pide mas si hacen falta.
    // El tope de arriba existe porque una cerveza con dos años de venta
    // diaria tiene miles de movimientos y pintarlos todos de golpe
    // congela la ventana.
    let limite = limite.unwrap_or(200).clamp(1, 5_000);
    consultas::movimientos_de_producto(&db, producto_id, limite).map_err(fallo)
}

// ---------------------------------------------------------------------------
// Historial de ventas
// ---------------------------------------------------------------------------

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct VentaDetallada {
    pub id: i64,
    pub numero: i64,
    pub fecha: String,
    pub usuario: String,
    pub subtotal: i64,
    pub descuento: i64,
    pub total: i64,
    pub anulada: bool,
    pub motivo_anulacion: Option<String>,
    pub con_faltante: bool,
    pub metodos: String,
    pub items: Vec<RenglonVenta>,
}

#[derive(Debug, Serialize)]
pub struct RenglonVenta {
    pub producto: String,
    pub empaque: String,
    pub cantidad: i64,
    pub unidades: i64,
    pub precio_unitario: i64,
    pub total: i64,
}

/// Ventas del periodo con su detalle.
///
/// Un cajero solo ve las suyas: `venta.ver_todas` es lo que abre el resto.
#[tauri::command]
pub fn historial_ventas(
    estado: State<'_, EstadoApp>,
    periodo: Periodo,
    usuario_id: i64,
    limite: i64,
) -> Result<Vec<VentaDetallada>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    let ve_todas = permisos::tiene(&db, periodo.rol, permisos::VENTA_VER_TODAS).unwrap_or(false);
    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudo cargar el historial.", e);

    let mut consulta = db
        .prepare(
            "SELECT v.id, v.numero,
                    strftime('%Y-%m-%d %H:%M', v.created_at, 'localtime'),
                    COALESCE(u.nombre, ''),
                    v.subtotal, v.descuento, v.total, v.estado, v.con_faltante,
                    (SELECT a.motivo FROM anulaciones a WHERE a.venta_id = v.id),
                    (SELECT GROUP_CONCAT(m.nombre, ', ')
                     FROM venta_pagos p JOIN metodos_pago m ON m.id = p.metodo_pago_id
                     WHERE p.venta_id = v.id)
             FROM ventas v
             LEFT JOIN usuarios u ON u.id = v.usuario_id
             WHERE date(v.created_at, 'localtime') BETWEEN ?1 AND ?2
               AND (?3 = 1 OR v.usuario_id = ?4)
             ORDER BY v.id DESC LIMIT ?5",
        )
        .map_err(fallo)?;

    let mut ventas: Vec<VentaDetallada> = consulta
        .query_map(
            rusqlite::params![
                periodo.desde, periodo.hasta, i64::from(ve_todas), usuario_id, limite
            ],
            |f| {
                Ok(VentaDetallada {
                    id: f.get(0)?,
                    numero: f.get(1)?,
                    fecha: f.get(2)?,
                    usuario: f.get(3)?,
                    subtotal: f.get(4)?,
                    descuento: f.get(5)?,
                    total: f.get(6)?,
                    anulada: f.get::<_, String>(7)? == "ANULADA",
                    con_faltante: f.get::<_, i64>(8)? == 1,
                    motivo_anulacion: f.get(9)?,
                    metodos: f.get::<_, Option<String>>(10)?.unwrap_or_default(),
                    items: Vec::new(),
                })
            },
        )
        .map_err(fallo)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(fallo)?;

    // Los renglones se traen de una vez y se reparten en memoria.
    let mut por_venta: std::collections::HashMap<i64, Vec<RenglonVenta>> =
        std::collections::HashMap::new();
    {
        let mut consulta_items = db
            .prepare(
                "SELECT venta_id, nombre_producto, nombre_empaque,
                        cantidad_empaques, cantidad_base, precio_unitario, total
                 FROM venta_items ORDER BY id",
            )
            .map_err(fallo)?;
        let filas = consulta_items
            .query_map([], |f| {
                Ok((
                    f.get::<_, i64>(0)?,
                    RenglonVenta {
                        producto: f.get(1)?,
                        empaque: f.get(2)?,
                        cantidad: f.get(3)?,
                        unidades: f.get(4)?,
                        precio_unitario: f.get(5)?,
                        total: f.get(6)?,
                    },
                ))
            })
            .map_err(fallo)?;
        for fila in filas {
            let (venta_id, renglon) = fila.map_err(fallo)?;
            por_venta.entry(venta_id).or_default().push(renglon);
        }
    }

    for v in &mut ventas {
        v.items = por_venta.remove(&v.id).unwrap_or_default();
    }
    Ok(ventas)
}

/// Estado de resultados. Solo para quien puede ver la utilidad: es la
/// cifra de fondo del negocio.
#[tauri::command]
pub fn estado_de_resultados(
    estado: State<'_, EstadoApp>,
    periodo: Periodo,
) -> Result<consultas::EstadoResultados, ErrorApp> {
    let db = con_permiso!(estado, periodo.rol, permisos::REPORTE_FINANCIERO);
    consultas::estado_de_resultados(&db, &periodo.desde, &periodo.hasta).map_err(fallo)
}
