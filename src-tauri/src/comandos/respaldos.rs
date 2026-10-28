//! Comandos de respaldo que la interfaz puede invocar.

use std::path::{Path, PathBuf};

use chrono::Local;
use tauri::State;

use crate::respaldo::{self, EstadoRespaldos, MotivoRespaldo, Respaldo};
use crate::usuarios::{permisos, Rol};
use crate::{ErrorApp, EstadoApp};

/// Carpeta por omision, junto a la base de datos.
///
/// Se puede configurar una segunda carpeta en una USB o disco externo:
/// una copia en el mismo disco no protege del disco dañado.
fn carpeta_respaldos(app: &tauri::AppHandle) -> Result<PathBuf, ErrorApp> {
    let base = crate::carpeta_de_datos(app)
        .map_err(|e| ErrorApp::nuevo("No se encontro la carpeta de datos.", e))?;
    Ok(base.join("respaldos"))
}

#[tauri::command]
pub fn crear_respaldo(
    app: tauri::AppHandle,
    estado: State<'_, EstadoApp>,
    rol: Rol,
) -> Result<Respaldo, ErrorApp> {
    let carpeta = carpeta_respaldos(&app)?;
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::RESPALDO_CREAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para crear copias de seguridad.", e))?;

    let copia = respaldo::crear(&db, &carpeta, MotivoRespaldo::Manual, Local::now())
        .map_err(|e| ErrorApp::nuevo("No se pudo crear la copia de seguridad.", e))?;

    // Rotar despues de copiar, nunca antes: si la copia falla, las
    // anteriores siguen ahi.
    let _ = respaldo::rotar(&carpeta);
    Ok(copia)
}

#[tauri::command]
pub fn listar_respaldos(app: tauri::AppHandle) -> Result<Vec<Respaldo>, ErrorApp> {
    let carpeta = carpeta_respaldos(&app)?;
    respaldo::listar(&carpeta)
        .map_err(|e| ErrorApp::nuevo("No se pudo leer la carpeta de copias.", e))
}

#[tauri::command]
pub fn estado_respaldos(
    app: tauri::AppHandle,
    estado: State<'_, EstadoApp>,
) -> Result<EstadoRespaldos, ErrorApp> {
    let carpeta = carpeta_respaldos(&app)?;
    let dias = {
        let db = estado
            .db
            .lock()
            .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
        db.query_row(
            "SELECT CAST(valor AS INTEGER) FROM configuracion WHERE clave = 'respaldo.dias_alerta'",
            [],
            |f| f.get::<_, i64>(0),
        )
        .unwrap_or(3)
    };

    respaldo::estado(&carpeta, dias, Local::now())
        .map_err(|e| ErrorApp::nuevo("No se pudo revisar el estado de las copias.", e))
}

#[tauri::command]
pub fn verificar_respaldo(ruta: String) -> Result<bool, ErrorApp> {
    respaldo::verificar(Path::new(&ruta))
        .map_err(|e| ErrorApp::nuevo("No se pudo revisar la copia.", e))
}

/// Restaura una copia. Antes guarda el estado actual, siempre.
#[tauri::command]
pub fn restaurar_respaldo(
    app: tauri::AppHandle,
    estado: State<'_, EstadoApp>,
    ruta: String,
    rol: Rol,
) -> Result<Respaldo, ErrorApp> {
    let carpeta = carpeta_respaldos(&app)?;
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    // Restaurar reemplaza la base entera: es la operacion mas destructiva
    // del sistema y solo la puede hacer un administrador.
    permisos::exigir(&db, rol, permisos::RESPALDO_RESTAURAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para restaurar copias.", e))?;

    respaldo::restaurar(&mut db, Path::new(&ruta), &carpeta, Local::now()).map_err(|e| {
        ErrorApp::nuevo(
            "No se pudo restaurar la copia. Tus datos actuales no se modificaron.",
            e,
        )
    })
}
