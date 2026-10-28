//! Ingreso, salida y estado de la sesion.

use serde::Serialize;
use tauri::State;

use crate::usuarios::{self, permisos, ErrorUsuario, Rol, Usuario};
use crate::{ErrorApp, EstadoApp};

#[derive(Debug, Serialize)]
pub struct SesionIniciada {
    pub usuario: Usuario,
    /// Lo que este rol puede hacer, para que la interfaz sepa que mostrar.
    /// Es comodidad visual: el control de verdad esta en el nucleo.
    pub permisos: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct EstadoArranque {
    /// Si es false, hay que crear el primer administrador.
    pub tiene_usuarios: bool,
    pub nombre_negocio: String,
    /// Ajustes que la pantalla necesita antes de que alguien entre.
    ///
    /// Viajan con el arranque y no en una consulta aparte porque el
    /// bloqueo por inactividad tiene que estar armado desde el primer
    /// momento, y porque son tres numeros: pedirlos por separado seria
    /// tres viajes para nada.
    pub minutos_inactividad: i64,
    pub stock_minimo_defecto: i64,
}

/// Un ajuste numerico, con su valor por omision si falta o no sirve.
///
/// Un cero guardado por error no puede dejar el mostrador bloqueandose
/// a cada rato ni el inventario alertando de todo.
fn ajuste_numerico(db: &rusqlite::Connection, clave: &str, defecto: i64) -> i64 {
    db.query_row(
        "SELECT CAST(valor AS INTEGER) FROM configuracion WHERE clave = ?1",
        [clave],
        |f| f.get::<_, i64>(0),
    )
    .ok()
    .filter(|n| *n > 0)
    .unwrap_or(defecto)
}

/// Traduce un fallo de credenciales a algo que el cajero entienda, sin
/// revelar de mas.
fn mensaje_de(error: &ErrorUsuario) -> String {
    match error {
        ErrorUsuario::CredencialesInvalidas =>
            "El usuario o la contraseña no coinciden.".to_owned(),
        ErrorUsuario::CuentaInactiva =>
            "Esta cuenta esta desactivada. Pide a un administrador que la habilite.".to_owned(),
        ErrorUsuario::CuentaBloqueada { minutos } => format!(
            "Demasiados intentos fallidos. Vuelve a intentarlo en {minutos} minutos, \
             o pide a un administrador que restablezca la contraseña."
        ),
        ErrorUsuario::ContrasenaCorta =>
            "La contraseña debe tener al menos 6 caracteres.".to_owned(),
        ErrorUsuario::UsuarioRepetido =>
            "Ya existe un usuario con ese nombre. Elige otro.".to_owned(),
        ErrorUsuario::SinNombre =>
            "El usuario y el nombre no pueden quedar vacios.".to_owned(),
        ErrorUsuario::UltimoAdministrador =>
            "No se puede desactivar al unico administrador: el sistema quedaria sin quien \
             lo administre.".to_owned(),
        ErrorUsuario::SinPermiso { .. } =>
            "No tienes permiso para esta operacion.".to_owned(),
        _ => "No fue posible completar la operacion. Intentalo de nuevo.".to_owned(),
    }
}

#[tauri::command]
pub fn estado_arranque(estado: State<'_, EstadoApp>) -> Result<EstadoArranque, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    let tiene_usuarios = usuarios::hay_usuarios(&db)
        .map_err(|e| ErrorApp::nuevo("No se pudo revisar el estado del sistema.", e))?;

    let nombre_negocio: String = db
        .query_row(
            "SELECT valor FROM configuracion WHERE clave = 'negocio.nombre'",
            [],
            |f| f.get(0),
        )
        // Vacio si no esta puesto: el nombre lo pone el dueño.
        .unwrap_or_default();

    Ok(EstadoArranque {
        tiene_usuarios,
        nombre_negocio,
        minutos_inactividad: ajuste_numerico(&db, "sesion.minutos_inactividad", 15),
        stock_minimo_defecto: ajuste_numerico(&db, "inventario.stock_minimo_defecto", 3),
    })
}

#[tauri::command]
pub fn iniciar_sesion(
    estado: State<'_, EstadoApp>,
    usuario: String,
    contrasena: String,
) -> Result<SesionIniciada, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    let autenticado = usuarios::autenticar(&db, &usuario, &contrasena)
        .map_err(|e| ErrorApp::nuevo(mensaje_de(&e), e))?;

    let lista = permisos::de_rol(&db, autenticado.rol)
        .map_err(|e| ErrorApp::nuevo("No se pudieron cargar los permisos.", e))?;

    db.execute(
        "INSERT INTO sesiones (usuario_id) VALUES (?1)",
        rusqlite::params![autenticado.id],
    )
    .map_err(|e| ErrorApp::nuevo("No se pudo registrar el ingreso.", e))?;

    db.execute(
        "INSERT INTO auditoria (usuario_id, usuario_nombre, accion, entidad, descripcion)
         VALUES (?1, ?2, 'INGRESO', 'sesiones', 'Inicio de sesion')",
        rusqlite::params![autenticado.id, autenticado.nombre],
    )
    .map_err(|e| ErrorApp::nuevo("No se pudo registrar el ingreso.", e))?;

    Ok(SesionIniciada {
        usuario: autenticado,
        permisos: lista,
    })
}

#[tauri::command]
pub fn cerrar_sesion(
    estado: State<'_, EstadoApp>,
    usuario_id: i64,
    por_inactividad: bool,
) -> Result<(), ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    let motivo = if por_inactividad { "INACTIVIDAD" } else { "CIERRE" };

    db.execute(
        "UPDATE sesiones
         SET fin = strftime('%Y-%m-%dT%H:%M:%SZ','now'), motivo_fin = ?2
         WHERE usuario_id = ?1 AND fin IS NULL",
        rusqlite::params![usuario_id, motivo],
    )
    .map_err(|e| ErrorApp::nuevo("No se pudo cerrar la sesion.", e))?;

    Ok(())
}

/// Crea el primer administrador. Solo funciona si no hay ningun usuario:
/// despues de eso, las cuentas se crean desde el modulo de usuarios, con
/// permiso.
#[tauri::command]
pub fn crear_primer_administrador(
    estado: State<'_, EstadoApp>,
    usuario: String,
    nombre: String,
    contrasena: String,
    // `negocio` es como se llama el local. Se pide aqui porque es lo
    // primero que hay que saber: sin el, la pantalla de ingreso y el
    // recibo salen sin encabezado, y el programa no tiene por que
    // suponer uno.
    negocio: Option<String>,
) -> Result<SesionIniciada, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    let hay = usuarios::hay_usuarios(&db)
        .map_err(|e| ErrorApp::nuevo("No se pudo revisar el estado del sistema.", e))?;
    if hay {
        return Err(ErrorApp::nuevo(
            "El sistema ya tiene usuarios. Inicia sesion con tu cuenta.",
            "crear_primer_administrador con usuarios existentes",
        ));
    }

    let creado = usuarios::crear(&db, &usuario, &nombre, &contrasena, Rol::Administrador)
        .map_err(|e| ErrorApp::nuevo(mensaje_de(&e), e))?;

    if let Some(local) = negocio.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        db.execute(
            "INSERT INTO configuracion (clave, valor, tipo, descripcion)
             VALUES ('negocio.nombre', ?1, 'TEXTO', 'Nombre del negocio')
             ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
            rusqlite::params![local],
        )
        .map_err(|e| ErrorApp::nuevo("No se pudo guardar el nombre del negocio.", e))?;
    }

    let lista = permisos::de_rol(&db, Rol::Administrador)
        .map_err(|e| ErrorApp::nuevo("No se pudieron cargar los permisos.", e))?;

    db.execute(
        "INSERT INTO auditoria (usuario_id, usuario_nombre, accion, entidad, entidad_id, descripcion)
         VALUES (?1, ?2, 'CREAR_USUARIO', 'usuarios', ?1, 'Primer administrador del sistema')",
        rusqlite::params![creado.id, creado.nombre],
    )
    .map_err(|e| ErrorApp::nuevo("No se pudo registrar la creacion.", e))?;

    // La existencia con la que vino el catalogo entra al libro ahora, a
    // nombre de quien acaba de estrenar el sistema.
    //
    // No se pudo hacer al migrar porque todo movimiento lleva autor y en
    // ese momento no habia ni un usuario. Sin esto, la existencia
    // guardada y la que sale del libro no coincidirian nunca y el sistema
    // reportaria un descuadre permanente que nadie podria explicar.
    db.execute(
        "INSERT INTO movimientos_inventario
           (producto_id, tipo, cantidad_base, existencia_antes, existencia_despues,
            referencia_tipo, motivo, usuario_id)
         SELECT p.id, 'IMPORTACION', p.existencia, 0, p.existencia,
                'IMPORTACION', 'Existencia inicial del catalogo', ?1
         FROM productos p
         WHERE p.existencia > 0
           AND NOT EXISTS (
             SELECT 1 FROM movimientos_inventario m WHERE m.producto_id = p.id)",
        rusqlite::params![creado.id],
    )
    .map_err(|e| ErrorApp::nuevo("No se pudo registrar la existencia inicial.", e))?;

    Ok(SesionIniciada {
        usuario: creado,
        permisos: lista,
    })
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db;

    /// Un ajuste con un valor puesto a mano, como quedaria en la base.
    fn con_valor(clave: &str, valor: &str) -> rusqlite::Connection {
        let db = db::abrir_en_memoria().unwrap();
        db.execute(
            "UPDATE configuracion SET valor = ?2 WHERE clave = ?1",
            rusqlite::params![clave, valor],
        )
        .unwrap();
        db
    }

    #[test]
    fn el_ajuste_guardado_es_el_que_rige() {
        let db = con_valor("sesion.minutos_inactividad", "5");

        assert_eq!(ajuste_numerico(&db, "sesion.minutos_inactividad", 15), 5);
    }

    #[test]
    fn un_cero_guardado_no_bloquea_el_mostrador_a_cada_rato() {
        // Cero minutos cerraria la sesion sin parar y dejaria al cajero
        // sin poder cobrar. Vale mas el valor por omision que obedecer.
        let db = con_valor("sesion.minutos_inactividad", "0");

        assert_eq!(ajuste_numerico(&db, "sesion.minutos_inactividad", 15), 15);
    }

    #[test]
    fn un_valor_que_no_es_numero_tampoco_manda() {
        let db = con_valor("inventario.stock_minimo_defecto", "muchos");

        assert_eq!(ajuste_numerico(&db, "inventario.stock_minimo_defecto", 3), 3);
    }

    #[test]
    fn una_clave_que_no_existe_cae_en_el_valor_por_omision() {
        let db = db::abrir_en_memoria().unwrap();

        assert_eq!(ajuste_numerico(&db, "no.existe", 7), 7);
    }
}
