//! Configuración del sistema y gestión de usuarios.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::usuarios::{self, permisos, Rol, Usuario};
use crate::{ErrorApp, EstadoApp};

#[derive(Debug, Serialize)]
pub struct Ajuste {
    pub clave: String,
    pub valor: String,
    pub tipo: String,
    pub descripcion: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CambioAjuste {
    pub clave: String,
    pub valor: String,
}

#[derive(Debug, Deserialize)]
pub struct DatosUsuario {
    pub usuario: String,
    pub nombre: String,
    pub contrasena: String,
    pub rol: Rol,
    /// Quién lo está creando.
    pub solicitante: Rol,
    pub solicitante_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct CambioContrasena {
    pub usuario_id: i64,
    pub nueva: String,
    pub solicitante: Rol,
    pub solicitante_id: i64,
}

#[derive(Debug, Serialize)]
pub struct RegistroAuditoria {
    pub id: i64,
    pub fecha: String,
    pub usuario: String,
    pub accion: String,
    pub entidad: String,
    pub descripcion: String,
}

fn mensaje_de(error: &usuarios::ErrorUsuario) -> String {
    match error {
        usuarios::ErrorUsuario::ContrasenaCorta =>
            "La contraseña debe tener al menos 6 caracteres.".to_owned(),
        usuarios::ErrorUsuario::UsuarioRepetido =>
            "Ya existe un usuario con ese nombre. Elige otro.".to_owned(),
        usuarios::ErrorUsuario::UltimoAdministrador =>
            "No se puede desactivar al único administrador: el sistema quedaría sin quien \
             lo administre.".to_owned(),
        usuarios::ErrorUsuario::SinPermiso { .. } =>
            "No tienes permiso para esta operación.".to_owned(),
        _ => "No fue posible completar la operación. Inténtalo de nuevo.".to_owned(),
    }
}

#[tauri::command]
pub fn leer_configuracion(estado: State<'_, EstadoApp>) -> Result<Vec<Ajuste>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudo leer la configuración.", e);

    let mut consulta = db
        .prepare("SELECT clave, valor, tipo, descripcion FROM configuracion ORDER BY clave")
        .map_err(fallo)?;
    let filas = consulta
        .query_map([], |f| {
            Ok(Ajuste {
                clave: f.get(0)?,
                valor: f.get(1)?,
                tipo: f.get(2)?,
                descripcion: f.get(3)?,
            })
        })
        .map_err(fallo)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(fallo)?;
    Ok(filas)
}

/// Guarda varios ajustes de una vez, en una transacción: o quedan todos
/// los cambios de la pantalla o no queda ninguno.
#[tauri::command]
pub fn guardar_configuracion(
    estado: State<'_, EstadoApp>,
    cambios: Vec<CambioAjuste>,
    rol: Rol,
    usuario_id: i64,
) -> Result<(), ErrorApp> {
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::CONFIG_EDITAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para cambiar la configuración.", e))?;

    let fallo = |e: rusqlite::Error| {
        ErrorApp::nuevo(
            "No se pudo guardar la configuración. No se cambió nada; inténtalo de nuevo.",
            e,
        )
    };

    let tx = db.transaction().map_err(fallo)?;
    for cambio in &cambios {
        tx.execute(
            "UPDATE configuracion
             SET valor = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
             WHERE clave = ?1",
            rusqlite::params![cambio.clave, cambio.valor],
        )
        .map_err(fallo)?;
    }

    let nombre: String = tx
        .query_row(
            "SELECT nombre FROM usuarios WHERE id = ?1",
            rusqlite::params![usuario_id],
            |f| f.get(0),
        )
        .unwrap_or_else(|_| "desconocido".to_owned());

    tx.execute(
        "INSERT INTO auditoria (usuario_id, usuario_nombre, accion, entidad, descripcion)
         VALUES (?1, ?2, 'CONFIGURAR', 'configuracion', ?3)",
        rusqlite::params![
            usuario_id, nombre,
            format!("Se cambiaron {} ajustes", cambios.len()),
        ],
    )
    .map_err(fallo)?;

    tx.commit().map_err(fallo)?;
    Ok(())
}

#[tauri::command]
pub fn listar_usuarios(
    estado: State<'_, EstadoApp>,
    rol: Rol,
) -> Result<Vec<Usuario>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::USUARIO_GESTIONAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para ver los usuarios.", e))?;

    usuarios::listar(&db).map_err(|e| ErrorApp::nuevo("No se pudieron cargar los usuarios.", e))
}

/// Crea la cuenta y su registro de auditoría en una transacción.
///
/// Si se hicieran por separado y fallara el segundo, quedaría un usuario
/// creado sin rastro de quién lo creó, y el mensaje de error diría que no
/// se creó. Dos cosas falsas a la vez.
#[tauri::command]
pub fn crear_usuario(
    estado: State<'_, EstadoApp>,
    datos: DatosUsuario,
) -> Result<Usuario, ErrorApp> {
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, datos.solicitante, permisos::USUARIO_GESTIONAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para crear usuarios.", e))?;

    let fallo = |e: rusqlite::Error| {
        ErrorApp::nuevo(
            "No se pudo crear el usuario. No se guardó nada; inténtalo de nuevo.", e)
    };

    let tx = db.transaction().map_err(fallo)?;

    let creado = usuarios::crear(&tx, &datos.usuario, &datos.nombre, &datos.contrasena, datos.rol)
        .map_err(|e| ErrorApp::nuevo(mensaje_de(&e), e))?;

    let quien: String = tx
        .query_row(
            "SELECT nombre FROM usuarios WHERE id = ?1",
            rusqlite::params![datos.solicitante_id],
            |f| f.get(0),
        )
        .unwrap_or_else(|_| "desconocido".to_owned());

    tx.execute(
        "INSERT INTO auditoria
           (usuario_id, usuario_nombre, accion, entidad, entidad_id, descripcion)
         VALUES (?1, ?2, 'CREAR_USUARIO', 'usuarios', ?3, ?4)",
        rusqlite::params![
            datos.solicitante_id, quien, creado.id,
            format!("Se creó el usuario {} con rol {:?}", creado.usuario, datos.rol),
        ],
    )
    .map_err(fallo)?;

    tx.commit().map_err(fallo)?;
    Ok(creado)
}

#[tauri::command]
pub fn desactivar_usuario(
    estado: State<'_, EstadoApp>,
    usuario_id: i64,
    rol: Rol,
    solicitante_id: i64,
) -> Result<(), ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::USUARIO_GESTIONAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para desactivar usuarios.", e))?;

    usuarios::desactivar(&db, usuario_id).map_err(|e| ErrorApp::nuevo(mensaje_de(&e), e))?;

    let quien: String = db
        .query_row(
            "SELECT nombre FROM usuarios WHERE id = ?1",
            rusqlite::params![solicitante_id],
            |f| f.get(0),
        )
        .unwrap_or_else(|_| "desconocido".to_owned());

    db.execute(
        "INSERT INTO auditoria
           (usuario_id, usuario_nombre, accion, entidad, entidad_id, descripcion)
         VALUES (?1, ?2, 'DESACTIVAR_USUARIO', 'usuarios', ?3, 'Cuenta desactivada')",
        rusqlite::params![solicitante_id, quien, usuario_id],
    )
    .map_err(|e| ErrorApp::nuevo(
            "No se pudo guardar el cambio. Inténtalo de nuevo.", e))?;

    Ok(())
}

#[tauri::command]
pub fn restablecer_contrasena(
    estado: State<'_, EstadoApp>,
    datos: CambioContrasena,
) -> Result<(), ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    // Cualquiera puede cambiar su propia contraseña; para la de otro hace
    // falta permiso.
    if datos.usuario_id != datos.solicitante_id {
        permisos::exigir(&db, datos.solicitante, permisos::USUARIO_GESTIONAR)
            .map_err(|e| ErrorApp::nuevo("No tienes permiso para cambiar esa contraseña.", e))?;
    }

    usuarios::cambiar_contrasena(&db, datos.usuario_id, &datos.nueva)
        .map_err(|e| ErrorApp::nuevo(mensaje_de(&e), e))?;

    let quien: String = db
        .query_row(
            "SELECT nombre FROM usuarios WHERE id = ?1",
            rusqlite::params![datos.solicitante_id],
            |f| f.get(0),
        )
        .unwrap_or_else(|_| "desconocido".to_owned());

    // Se registra que cambió, nunca el valor.
    db.execute(
        "INSERT INTO auditoria
           (usuario_id, usuario_nombre, accion, entidad, entidad_id, descripcion)
         VALUES (?1, ?2, 'CAMBIAR_CONTRASENA', 'usuarios', ?3, 'Contraseña restablecida')",
        rusqlite::params![datos.solicitante_id, quien, datos.usuario_id],
    )
    .map_err(|e| ErrorApp::nuevo(
            "No se pudo guardar el cambio. Inténtalo de nuevo.", e))?;

    Ok(())
}

#[tauri::command]
pub fn leer_auditoria(
    estado: State<'_, EstadoApp>,
    rol: Rol,
    limite: i64,
) -> Result<Vec<RegistroAuditoria>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::AUDITORIA_VER)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para ver la auditoría.", e))?;

    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudo leer la auditoría.", e);

    let mut consulta = db
        .prepare(
            "SELECT id, strftime('%Y-%m-%d %H:%M', created_at, 'localtime'),
                    usuario_nombre, accion, entidad, descripcion
             FROM auditoria ORDER BY id DESC LIMIT ?1",
        )
        .map_err(fallo)?;
    let filas = consulta
        .query_map(rusqlite::params![limite], |f| {
            Ok(RegistroAuditoria {
                id: f.get(0)?,
                fecha: f.get(1)?,
                usuario: f.get(2)?,
                accion: f.get(3)?,
                entidad: f.get(4)?,
                descripcion: f.get(5)?,
            })
        })
        .map_err(fallo)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(fallo)?;
    Ok(filas)
}
