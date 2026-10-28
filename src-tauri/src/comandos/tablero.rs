//! Comando del tablero.

use tauri::State;

use crate::reportes::{self, Tablero};
use crate::usuarios::{permisos, Rol};
use crate::{ErrorApp, EstadoApp};

#[tauri::command]
pub fn tablero(estado: State<'_, EstadoApp>, rol: Rol) -> Result<Tablero, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    // La utilidad solo llega a quien puede ver costos. No se manda y se
    // esconde en la pantalla: no se manda.
    let puede_ver_utilidad = permisos::tiene(&db, rol, permisos::UTILIDAD_VER).unwrap_or(false);

    reportes::tablero(&db, puede_ver_utilidad)
        .map_err(|e| ErrorApp::nuevo("No se pudo cargar el resumen del negocio.", e))
}
