//! Usuarios, contraseñas y permisos.
//!
//! Las contraseñas se guardan con Argon2id, el estandar actual. Ni el
//! sistema ni nadie puede leerlas: solo comprobar si una coincide. Si un
//! usuario la olvida se restablece, no se recupera.
//!
//! Los permisos se comprueban aqui, en la capa que la interfaz no puede
//! saltarse. Esconder un boton no es seguridad: es cortesia.

pub mod permisos;

use argon2::Argon2;
use password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Intentos fallidos antes de bloquear la cuenta.
const INTENTOS_PERMITIDOS: i64 = 5;
/// Cuanto dura el bloqueo.
const MINUTOS_BLOQUEO: i64 = 15;
/// Lo minimo que se le exige a una contraseña. No mas: reglas barrocas
/// terminan en la clave escrita en un papel pegado al monitor.
const LARGO_MINIMO: usize = 6;

#[derive(Debug, thiserror::Error)]
pub enum ErrorUsuario {
    #[error("el usuario o la contraseña no coinciden")]
    CredencialesInvalidas,
    #[error("la cuenta esta desactivada")]
    CuentaInactiva,
    #[error("demasiados intentos fallidos; espera {minutos} minutos")]
    CuentaBloqueada { minutos: i64 },
    #[error("la contraseña debe tener al menos {LARGO_MINIMO} caracteres")]
    ContrasenaCorta,
    #[error("ya existe un usuario con ese nombre")]
    UsuarioRepetido,
    #[error("el usuario y el nombre no pueden ir vacios")]
    SinNombre,
    #[error("no se puede desactivar al ultimo administrador")]
    UltimoAdministrador,
    #[error("no tienes permiso para esta operacion")]
    SinPermiso { permiso: String },
    #[error("no se pudo procesar la contraseña")]
    Cifrado,
    #[error("error de base de datos")]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Rol {
    Administrador,
    Encargado,
    Cajero,
}

impl Rol {
    pub fn codigo(self) -> &'static str {
        match self {
            Self::Administrador => "ADMINISTRADOR",
            Self::Encargado => "ENCARGADO",
            Self::Cajero => "CAJERO",
        }
    }

    pub fn desde_codigo(codigo: &str) -> Option<Self> {
        match codigo {
            "ADMINISTRADOR" => Some(Self::Administrador),
            "ENCARGADO" => Some(Self::Encargado),
            "CAJERO" => Some(Self::Cajero),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Usuario {
    pub id: i64,
    pub usuario: String,
    pub nombre: String,
    pub rol: Rol,
    pub activo: bool,
    pub ultimo_ingreso: Option<String>,
}

/// Cifra una contraseña con Argon2id y una sal distinta para cada una.
fn cifrar(contrasena: &str) -> Result<String, ErrorUsuario> {
    if contrasena.chars().count() < LARGO_MINIMO {
        return Err(ErrorUsuario::ContrasenaCorta);
    }
    let sal = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(contrasena.as_bytes(), &sal)
        .map(|h| h.to_string())
        .map_err(|_| ErrorUsuario::Cifrado)
}

fn coincide(contrasena: &str, cifrada: &str) -> bool {
    PasswordHash::new(cifrada)
        .map(|esperada| {
            Argon2::default()
                .verify_password(contrasena.as_bytes(), &esperada)
                .is_ok()
        })
        .unwrap_or(false)
}

pub fn crear(
    conexion: &Connection,
    usuario: &str,
    nombre: &str,
    contrasena: &str,
    rol: Rol,
) -> Result<Usuario, ErrorUsuario> {
    let usuario_limpio = usuario.trim();
    // `required` del formulario da por bueno un campo con solo espacios,
    // y al recortarlo quedaba una cuenta con el nombre vacio: imposible
    // de usar y ahi para siempre, porque los usuarios no se borran.
    if usuario_limpio.is_empty() || nombre.trim().is_empty() {
        return Err(ErrorUsuario::SinNombre);
    }

    let cifrada = cifrar(contrasena)?;

    conexion
        .execute(
            "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
             VALUES (?1, ?2, ?3, ?4)",
            params![usuario_limpio, nombre.trim(), cifrada, rol.codigo()],
        )
        .map_err(|e| match e {
            rusqlite::Error::SqliteFailure(err, _)
                if err.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                ErrorUsuario::UsuarioRepetido
            }
            otro => ErrorUsuario::Sqlite(otro),
        })?;

    Ok(Usuario {
        id: conexion.last_insert_rowid(),
        usuario: usuario_limpio.to_owned(),
        nombre: nombre.trim().to_owned(),
        rol,
        activo: true,
        ultimo_ingreso: None,
    })
}

/// Comprueba las credenciales.
///
/// El mensaje de error nunca distingue entre "ese usuario no existe" y
/// "la contraseña esta mal": decirlo permitiria averiguar que cuentas
/// existen probando nombres.
/// La fila cruda de `usuarios`, tal como sale de la consulta.
type FilaUsuario = (i64, String, String, String, String, i64, i64, Option<String>);

pub fn autenticar(
    conexion: &Connection,
    usuario: &str,
    contrasena: &str,
) -> Result<Usuario, ErrorUsuario> {
    let fila: Option<FilaUsuario> = conexion
        .query_row(
            "SELECT id, usuario, nombre, password_hash, rol, activo, intentos_fallidos,
                    bloqueado_hasta
             FROM usuarios WHERE usuario = ?1 COLLATE NOCASE",
            params![usuario.trim()],
            |f| {
                Ok((
                    f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?,
                    f.get(4)?, f.get(5)?, f.get(6)?, f.get(7)?,
                ))
            },
        )
        .optional()?;

    let Some((id, nombre_usuario, nombre, cifrada, rol, activo, intentos, bloqueado)) = fila else {
        // Se cifra igualmente una cadena cualquiera para que responder a
        // un usuario inexistente tarde lo mismo que a uno real. Si no, el
        // tiempo de respuesta delata que cuentas existen.
        let _ = cifrar("tiempo-constante");
        return Err(ErrorUsuario::CredencialesInvalidas);
    };

    if activo == 0 {
        return Err(ErrorUsuario::CuentaInactiva);
    }

    if let Some(hasta) = bloqueado.as_deref() {
        let ahora = chrono::Utc::now();
        if let Ok(momento) = chrono::DateTime::parse_from_rfc3339(hasta) {
            let restan = momento.signed_duration_since(ahora).num_minutes();
            if restan > 0 {
                return Err(ErrorUsuario::CuentaBloqueada { minutos: restan.max(1) });
            }
        }
    }

    if !coincide(contrasena, &cifrada) {
        registrar_fallo(conexion, id, intentos + 1)?;
        return Err(ErrorUsuario::CredencialesInvalidas);
    }

    conexion.execute(
        "UPDATE usuarios
         SET intentos_fallidos = 0, bloqueado_hasta = NULL,
             ultimo_ingreso = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?1",
        params![id],
    )?;

    Ok(Usuario {
        id,
        usuario: nombre_usuario,
        nombre,
        rol: Rol::desde_codigo(&rol).unwrap_or(Rol::Cajero),
        activo: true,
        ultimo_ingreso: None,
    })
}

fn registrar_fallo(
    conexion: &Connection,
    id: i64,
    intentos: i64,
) -> Result<(), ErrorUsuario> {
    if intentos >= INTENTOS_PERMITIDOS {
        conexion.execute(
            "UPDATE usuarios
             SET intentos_fallidos = ?2,
                 bloqueado_hasta = strftime('%Y-%m-%dT%H:%M:%SZ','now', ?3)
             WHERE id = ?1",
            params![id, intentos, format!("+{MINUTOS_BLOQUEO} minutes")],
        )?;
    } else {
        conexion.execute(
            "UPDATE usuarios SET intentos_fallidos = ?2 WHERE id = ?1",
            params![id, intentos],
        )?;
    }
    Ok(())
}

pub fn cambiar_contrasena(
    conexion: &Connection,
    id: i64,
    nueva: &str,
) -> Result<(), ErrorUsuario> {
    let cifrada = cifrar(nueva)?;
    conexion.execute(
        "UPDATE usuarios
         SET password_hash = ?2, intentos_fallidos = 0, bloqueado_hasta = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?1",
        params![id, cifrada],
    )?;
    Ok(())
}

/// Desactiva una cuenta. Nunca se borra: sus ventas y movimientos tienen
/// que seguir teniendo autor.
pub fn desactivar(conexion: &Connection, id: i64) -> Result<(), ErrorUsuario> {
    let administradores_activos: i64 = conexion.query_row(
        "SELECT COUNT(*) FROM usuarios
         WHERE rol = 'ADMINISTRADOR' AND activo = 1 AND id <> ?1",
        params![id],
        |f| f.get(0),
    )?;

    let es_admin: bool = conexion
        .query_row(
            "SELECT rol = 'ADMINISTRADOR' FROM usuarios WHERE id = ?1",
            params![id],
            |f| f.get::<_, i64>(0),
        )
        .map(|v| v == 1)
        .unwrap_or(false);

    // Dejar el sistema sin ningun administrador lo vuelve inadministrable.
    if es_admin && administradores_activos == 0 {
        return Err(ErrorUsuario::UltimoAdministrador);
    }

    conexion.execute(
        "UPDATE usuarios SET activo = 0,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn listar(conexion: &Connection) -> Result<Vec<Usuario>, ErrorUsuario> {
    let mut consulta = conexion.prepare(
        "SELECT id, usuario, nombre, rol, activo, ultimo_ingreso
         FROM usuarios ORDER BY activo DESC, nombre",
    )?;
    let usuarios = consulta
        .query_map([], |f| {
            Ok(Usuario {
                id: f.get(0)?,
                usuario: f.get(1)?,
                nombre: f.get(2)?,
                rol: Rol::desde_codigo(&f.get::<_, String>(3)?).unwrap_or(Rol::Cajero),
                activo: f.get::<_, i64>(4)? == 1,
                ultimo_ingreso: f.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(usuarios)
}

/// ¿Es la primera vez que se abre el sistema?
pub fn hay_usuarios(conexion: &Connection) -> Result<bool, ErrorUsuario> {
    let total: i64 = conexion.query_row("SELECT COUNT(*) FROM usuarios", [], |f| f.get(0))?;
    Ok(total > 0)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db::abrir_en_memoria;

    fn base() -> Connection {
        abrir_en_memoria().unwrap()
    }

    #[test]
    fn la_contrasena_no_se_guarda_en_texto_plano() {
        let db = base();
        crear(&db, "camilo", "Camilo", "clave-secreta", Rol::Administrador).unwrap();

        let guardada: String = db
            .query_row("SELECT password_hash FROM usuarios", [], |f| f.get(0))
            .unwrap();

        assert!(!guardada.contains("clave-secreta"));
        assert!(guardada.starts_with("$argon2id$"), "debe ser Argon2id");
    }

    #[test]
    fn dos_usuarios_con_la_misma_clave_tienen_cifrados_distintos() {
        let db = base();
        crear(&db, "uno", "Uno", "la-misma-clave", Rol::Cajero).unwrap();
        crear(&db, "dos", "Dos", "la-misma-clave", Rol::Cajero).unwrap();

        let mut c = db.prepare("SELECT password_hash FROM usuarios ORDER BY id").unwrap();
        let cifrados: Vec<String> = c
            .query_map([], |f| f.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();

        assert_ne!(cifrados[0], cifrados[1], "cada una lleva su propia sal");
    }

    #[test]
    fn entra_con_la_clave_correcta() {
        let db = base();
        crear(&db, "camilo", "Camilo", "clave-buena", Rol::Administrador).unwrap();

        let u = autenticar(&db, "camilo", "clave-buena").unwrap();
        assert_eq!(u.nombre, "Camilo");
        assert_eq!(u.rol, Rol::Administrador);
    }

    #[test]
    fn el_nombre_de_usuario_no_distingue_mayusculas() {
        let db = base();
        crear(&db, "camilo", "Camilo", "clave-buena", Rol::Cajero).unwrap();
        assert!(autenticar(&db, "CAMILO", "clave-buena").is_ok());
        assert!(autenticar(&db, "  Camilo  ", "clave-buena").is_ok());
    }

    #[test]
    fn no_entra_con_la_clave_equivocada() {
        let db = base();
        crear(&db, "camilo", "Camilo", "clave-buena", Rol::Cajero).unwrap();
        assert!(matches!(
            autenticar(&db, "camilo", "clave-mala"),
            Err(ErrorUsuario::CredencialesInvalidas)
        ));
    }

    #[test]
    fn un_usuario_inexistente_da_el_mismo_error_que_una_clave_mala() {
        let db = base();
        crear(&db, "camilo", "Camilo", "clave-buena", Rol::Cajero).unwrap();

        // El mensaje no puede delatar que cuentas existen.
        let inexistente = autenticar(&db, "fantasma", "lo-que-sea");
        let clave_mala = autenticar(&db, "camilo", "clave-mala");
        assert_eq!(inexistente.unwrap_err().to_string(), clave_mala.unwrap_err().to_string());
    }

    #[test]
    fn bloquea_la_cuenta_tras_cinco_intentos() {
        let db = base();
        crear(&db, "camilo", "Camilo", "clave-buena", Rol::Cajero).unwrap();

        for _ in 0..INTENTOS_PERMITIDOS {
            let _ = autenticar(&db, "camilo", "equivocada");
        }

        // Ni siquiera con la clave correcta entra mientras dure el bloqueo.
        assert!(matches!(
            autenticar(&db, "camilo", "clave-buena"),
            Err(ErrorUsuario::CuentaBloqueada { .. })
        ));
    }

    #[test]
    fn un_ingreso_correcto_limpia_los_intentos_fallidos() {
        let db = base();
        crear(&db, "camilo", "Camilo", "clave-buena", Rol::Cajero).unwrap();

        let _ = autenticar(&db, "camilo", "mala");
        let _ = autenticar(&db, "camilo", "mala");
        autenticar(&db, "camilo", "clave-buena").unwrap();

        let intentos: i64 = db
            .query_row("SELECT intentos_fallidos FROM usuarios", [], |f| f.get(0))
            .unwrap();
        assert_eq!(intentos, 0);
    }

    #[test]
    fn una_cuenta_desactivada_no_entra() {
        let db = base();
        let admin = crear(&db, "admin", "Admin", "clave-buena", Rol::Administrador).unwrap();
        let cajero = crear(&db, "cajero", "Cajero", "clave-buena", Rol::Cajero).unwrap();

        desactivar(&db, cajero.id).unwrap();
        assert!(matches!(
            autenticar(&db, "cajero", "clave-buena"),
            Err(ErrorUsuario::CuentaInactiva)
        ));
        // El administrador sigue entrando.
        assert!(autenticar(&db, "admin", "clave-buena").is_ok());
        assert_eq!(admin.rol, Rol::Administrador);
    }

    #[test]
    fn no_deja_desactivar_al_ultimo_administrador() {
        let db = base();
        let admin = crear(&db, "admin", "Admin", "clave-buena", Rol::Administrador).unwrap();
        crear(&db, "cajero", "Cajero", "clave-buena", Rol::Cajero).unwrap();

        assert!(matches!(
            desactivar(&db, admin.id),
            Err(ErrorUsuario::UltimoAdministrador)
        ));
    }

    #[test]
    fn deja_desactivar_un_administrador_si_queda_otro() {
        let db = base();
        let primero = crear(&db, "admin1", "Admin 1", "clave-buena", Rol::Administrador).unwrap();
        crear(&db, "admin2", "Admin 2", "clave-buena", Rol::Administrador).unwrap();
        assert!(desactivar(&db, primero.id).is_ok());
    }

    #[test]
    fn rechaza_contrasenas_demasiado_cortas() {
        let db = base();
        assert!(matches!(
            crear(&db, "camilo", "Camilo", "123", Rol::Cajero),
            Err(ErrorUsuario::ContrasenaCorta)
        ));
    }

    #[test]
    fn un_usuario_de_puros_espacios_no_es_un_usuario() {
        // El `required` del formulario da por bueno «   », y al
        // recortarlo quedaba una cuenta con el nombre vacio. Como los
        // usuarios no se borran, se quedaria ahi para siempre.
        let db = base();

        assert!(matches!(
            crear(&db, "   ", "Camilo", "clave-buena", Rol::Cajero),
            Err(ErrorUsuario::SinNombre)
        ));
        assert!(matches!(
            crear(&db, "camilo", "  ", "clave-buena", Rol::Cajero),
            Err(ErrorUsuario::SinNombre)
        ));

        let cuantos: i64 = db
            .query_row("SELECT COUNT(*) FROM usuarios", [], |f| f.get(0))
            .unwrap();
        assert_eq!(cuantos, 0, "no queda ninguna cuenta a medio crear");
    }

    #[test]
    fn no_permite_dos_usuarios_con_el_mismo_nombre() {
        let db = base();
        crear(&db, "camilo", "Camilo", "clave-buena", Rol::Cajero).unwrap();
        assert!(matches!(
            crear(&db, "CAMILO", "Otro", "clave-buena", Rol::Cajero),
            Err(ErrorUsuario::UsuarioRepetido)
        ));
    }

    #[test]
    fn cambiar_la_contrasena_desbloquea_la_cuenta() {
        let db = base();
        let u = crear(&db, "camilo", "Camilo", "clave-vieja", Rol::Cajero).unwrap();
        for _ in 0..INTENTOS_PERMITIDOS {
            let _ = autenticar(&db, "camilo", "mala");
        }

        cambiar_contrasena(&db, u.id, "clave-nueva").unwrap();

        assert!(autenticar(&db, "camilo", "clave-nueva").is_ok());
        assert!(autenticar(&db, "camilo", "clave-vieja").is_err());
    }
}
