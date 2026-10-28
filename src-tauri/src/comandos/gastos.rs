//! Comandos de gastos.
//!
//! Ver gastos es ver el fondo del negocio, así que todo aquí exige el
//! permiso financiero. Un cajero no tiene por qué saber cuánto se paga de
//! arriendo ni cuánto gana el otro empleado.

use tauri::State;

use crate::gastos::{self, CategoriaGasto, ErrorGasto, GastoEditable, GastoListado};
use crate::usuarios::{permisos, Rol};
use crate::{ErrorApp, EstadoApp};

fn traducir(error: ErrorGasto) -> ErrorApp {
    use ErrorGasto as E;
    match error {
        E::ConceptoVacio => ErrorApp::nuevo("Escribe en qué se gastó.", error),
        E::MontoInvalido => ErrorApp::nuevo("El monto tiene que ser mayor que cero.", error),
        E::FechaInvalida => ErrorApp::nuevo("Elige una fecha válida.", error),
        E::NoExiste => ErrorApp::nuevo("Ese gasto ya no existe.", error),
        E::YaAnulado => ErrorApp::nuevo("Ese gasto ya está anulado.", error),
        E::FaltaMotivo => ErrorApp::nuevo("Escribe por qué se anula el gasto.", error),
        E::CategoriaRepetida => ErrorApp::nuevo("Ya hay una categoría con ese nombre.", error),
        E::CategoriaEnUso => ErrorApp::nuevo(
            "Esa categoría tiene gastos registrados. Se desactiva en vez de borrarse.",
            error,
        ),
        otro => ErrorApp::nuevo("No se pudo guardar el gasto. No se modificó nada.", otro),
    }
}

/// Comprueba el permiso y entrega la conexión.
macro_rules! con_permiso {
    ($estado:expr, $rol:expr) => {{
        let db = $estado
            .db
            .lock()
            .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
        permisos::exigir(&db, $rol, permisos::REPORTE_FINANCIERO)
            .map_err(|e| ErrorApp::nuevo("No tienes permiso para ver los gastos.", e))?;
        db
    }};
}

#[tauri::command]
pub fn listar_gastos(
    estado: State<'_, EstadoApp>,
    desde: String,
    hasta: String,
    rol: Rol,
) -> Result<Vec<GastoListado>, ErrorApp> {
    let db = con_permiso!(estado, rol);
    gastos::listar(&db, &desde, &hasta).map_err(traducir)
}

#[tauri::command]
pub fn registrar_gasto(
    estado: State<'_, EstadoApp>,
    gasto: GastoEditable,
    usuario_id: i64,
    rol: Rol,
) -> Result<i64, ErrorApp> {
    let db = con_permiso!(estado, rol);
    gastos::registrar(&db, &gasto, usuario_id).map_err(traducir)
}

#[tauri::command]
pub fn editar_gasto(
    estado: State<'_, EstadoApp>,
    gasto: GastoEditable,
    usuario_id: i64,
    rol: Rol,
) -> Result<(), ErrorApp> {
    let db = con_permiso!(estado, rol);
    gastos::editar(&db, &gasto, usuario_id).map_err(traducir)
}

#[tauri::command]
pub fn anular_gasto(
    estado: State<'_, EstadoApp>,
    gasto_id: i64,
    motivo: String,
    usuario_id: i64,
    rol: Rol,
) -> Result<(), ErrorApp> {
    let db = con_permiso!(estado, rol);
    gastos::anular(&db, gasto_id, &motivo, usuario_id).map_err(traducir)
}

#[tauri::command]
pub fn categorias_de_gasto(
    estado: State<'_, EstadoApp>,
    rol: Rol,
) -> Result<Vec<CategoriaGasto>, ErrorApp> {
    let db = con_permiso!(estado, rol);
    gastos::categorias(&db).map_err(traducir)
}

#[tauri::command]
pub fn crear_categoria_gasto(
    estado: State<'_, EstadoApp>,
    nombre: String,
    fijo: bool,
    rol: Rol,
) -> Result<i64, ErrorApp> {
    let db = con_permiso!(estado, rol);
    gastos::crear_categoria(&db, &nombre, fijo).map_err(traducir)
}

#[tauri::command]
pub fn quitar_categoria_gasto(
    estado: State<'_, EstadoApp>,
    categoria_id: i64,
    rol: Rol,
) -> Result<(), ErrorApp> {
    let db = con_permiso!(estado, rol);
    gastos::quitar_categoria(&db, categoria_id).map_err(traducir)
}
