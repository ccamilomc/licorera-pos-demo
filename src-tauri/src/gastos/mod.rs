//! Gastos del negocio.
//!
//! Un gasto es un hecho con fecha: qué se pagó, cuándo, cuánto y por qué.
//! No una cifra mensual de la que después se saca una parte.
//!
//! La diferencia importa. Antes había cinco números en `configuracion` y
//! el estado de resultados los repartía por días sobre 30. Con eso no se
//! podía anotar el sueldo de un empleado ni una reparación, y subir el
//! arriendo en julio recalculaba también los meses de antes, con una
//! cifra que en su momento no fue la real.
//!
//! Como todo lo demás aquí: nada se borra. Un gasto mal anotado se anula
//! con su motivo y sigue estando, porque alguien lo vio en un reporte y
//! va a preguntar por él.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ErrorGasto {
    #[error("hay que decir en qué se gastó")]
    ConceptoVacio,
    #[error("el monto tiene que ser mayor que cero")]
    MontoInvalido,
    #[error("la fecha tiene que ser como 2026-08-21")]
    FechaInvalida,
    #[error("ese gasto no existe")]
    NoExiste,
    #[error("ese gasto ya está anulado")]
    YaAnulado,
    #[error("hay que decir por qué se anula")]
    FaltaMotivo,
    #[error("ya hay una categoría que se llama así")]
    CategoriaRepetida,
    #[error("la categoría tiene gastos registrados")]
    CategoriaEnUso,
    #[error("error de base de datos")]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, Deserialize)]
pub struct GastoEditable {
    pub id: Option<i64>,
    pub fecha: String,
    pub categoria_id: Option<i64>,
    pub concepto: String,
    pub monto: i64,
    pub nota: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GastoListado {
    pub id: i64,
    pub fecha: String,
    pub categoria_id: Option<i64>,
    pub categoria: Option<String>,
    pub concepto: String,
    pub monto: i64,
    pub nota: Option<String>,
    pub usuario: Option<String>,
    pub anulado: bool,
    pub motivo_anulacion: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CategoriaGasto {
    pub id: i64,
    pub nombre: String,
    pub fijo: bool,
    pub activo: bool,
    /// Cuántos gastos la usan. Sirve para no ofrecer borrar la que sí.
    pub en_uso: i64,
}

/// `2026-08-21` y nada más. Sin esto entra cualquier cosa y después el
/// filtro por período la deja fuera sin que nadie entienda por qué.
fn fecha_valida(fecha: &str) -> bool {
    let b = fecha.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

/// Deja constancia en la auditoría, con el nombre de quien lo hizo.
///
/// El nombre se copia y no se referencia: si mañana el usuario cambia de
/// nombre o se desactiva, el registro tiene que seguir diciendo quién
/// fue en ese momento.
fn anotar(
    conexion: &Connection,
    usuario_id: i64,
    accion: &str,
    gasto_id: i64,
    descripcion: &str,
) -> Result<(), ErrorGasto> {
    let nombre: String = conexion
        .query_row(
            "SELECT nombre FROM usuarios WHERE id = ?1",
            params![usuario_id],
            |f| f.get(0),
        )
        .optional()?
        .unwrap_or_else(|| "desconocido".to_owned());

    conexion.execute(
        "INSERT INTO auditoria
           (usuario_id, usuario_nombre, accion, entidad, entidad_id, descripcion)
         VALUES (?1, ?2, ?3, 'gastos', ?4, ?5)",
        params![usuario_id, nombre, accion, gasto_id, descripcion],
    )?;
    Ok(())
}

fn validar(g: &GastoEditable) -> Result<(), ErrorGasto> {
    if g.concepto.trim().is_empty() {
        return Err(ErrorGasto::ConceptoVacio);
    }
    if g.monto <= 0 {
        return Err(ErrorGasto::MontoInvalido);
    }
    if !fecha_valida(&g.fecha) {
        return Err(ErrorGasto::FechaInvalida);
    }
    Ok(())
}

pub fn registrar(
    conexion: &Connection,
    gasto: &GastoEditable,
    usuario_id: i64,
) -> Result<i64, ErrorGasto> {
    validar(gasto)?;

    conexion.execute(
        "INSERT INTO gastos (fecha, categoria_id, concepto, monto, nota, usuario_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            gasto.fecha,
            gasto.categoria_id,
            gasto.concepto.trim(),
            gasto.monto,
            gasto.nota.as_deref().map(str::trim).filter(|n| !n.is_empty()),
            usuario_id
        ],
    )?;
    let id = conexion.last_insert_rowid();

    anotar(
        conexion,
        usuario_id,
        "REGISTRAR_GASTO",
        id,
        &format!(
            "{} por {} el {}",
            gasto.concepto.trim(),
            crate::formato::pesos(gasto.monto),
            gasto.fecha,
        ),
    )?;
    Ok(id)
}

/// Corrige un gasto ya anotado.
///
/// Editar y no anular-y-rehacer: equivocarse escribiendo un monto es
/// distinto de haber pagado algo que no era. Lo segundo se anula; lo
/// primero se corrige, y la auditoría guarda qué cambió.
pub fn editar(
    conexion: &Connection,
    gasto: &GastoEditable,
    usuario_id: i64,
) -> Result<(), ErrorGasto> {
    validar(gasto)?;
    let id = gasto.id.ok_or(ErrorGasto::NoExiste)?;

    let antes: Option<(String, i64, i64)> = conexion
        .query_row(
            "SELECT concepto, monto, anulado FROM gastos WHERE id = ?1",
            params![id],
            |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)),
        )
        .optional()?;
    let (concepto_antes, monto_antes, anulado) = antes.ok_or(ErrorGasto::NoExiste)?;
    if anulado == 1 {
        return Err(ErrorGasto::YaAnulado);
    }

    conexion.execute(
        "UPDATE gastos
         SET fecha = ?1, categoria_id = ?2, concepto = ?3, monto = ?4, nota = ?5
         WHERE id = ?6",
        params![
            gasto.fecha,
            gasto.categoria_id,
            gasto.concepto.trim(),
            gasto.monto,
            gasto.nota.as_deref().map(str::trim).filter(|n| !n.is_empty()),
            id
        ],
    )?;

    anotar(
        conexion,
        usuario_id,
        "EDITAR_GASTO",
        id,
        &format!(
            "«{concepto_antes}» por {} pasa a «{}» por {}",
            crate::formato::pesos(monto_antes),
            gasto.concepto.trim(),
            crate::formato::pesos(gasto.monto),
        ),
    )?;
    Ok(())
}

/// Anula un gasto. No lo borra: alguien lo vio en un reporte.
pub fn anular(
    conexion: &Connection,
    id: i64,
    motivo: &str,
    usuario_id: i64,
) -> Result<(), ErrorGasto> {
    if motivo.trim().is_empty() {
        return Err(ErrorGasto::FaltaMotivo);
    }

    let estado: Option<i64> = conexion
        .query_row("SELECT anulado FROM gastos WHERE id = ?1", params![id], |f| {
            f.get(0)
        })
        .optional()?;
    match estado {
        None => return Err(ErrorGasto::NoExiste),
        Some(1) => return Err(ErrorGasto::YaAnulado),
        Some(_) => {}
    }

    conexion.execute(
        "UPDATE gastos SET anulado = 1, motivo_anulacion = ?1 WHERE id = ?2",
        params![motivo.trim(), id],
    )?;

    anotar(conexion, usuario_id, "ANULAR_GASTO", id, motivo.trim())?;
    Ok(())
}

/// Los gastos de un período, del más reciente al más viejo.
///
/// Los anulados vienen también: esconderlos haría que un total que no
/// cuadra con lo que alguien recuerda no tenga explicación en pantalla.
pub fn listar(
    conexion: &Connection,
    desde: &str,
    hasta: &str,
) -> Result<Vec<GastoListado>, ErrorGasto> {
    let mut consulta = conexion.prepare(
        "SELECT g.id, g.fecha, g.categoria_id, c.nombre, g.concepto, g.monto,
                g.nota, u.nombre, g.anulado, g.motivo_anulacion
         FROM gastos g
         LEFT JOIN gasto_categorias c ON c.id = g.categoria_id
         LEFT JOIN usuarios u ON u.id = g.usuario_id
         WHERE g.fecha BETWEEN ?1 AND ?2
         ORDER BY g.fecha DESC, g.id DESC",
    )?;
    let filas = consulta
        .query_map(params![desde, hasta], |f| {
            Ok(GastoListado {
                id: f.get(0)?,
                fecha: f.get(1)?,
                categoria_id: f.get(2)?,
                categoria: f.get(3)?,
                concepto: f.get(4)?,
                monto: f.get(5)?,
                nota: f.get(6)?,
                usuario: f.get(7)?,
                anulado: f.get::<_, i64>(8)? == 1,
                motivo_anulacion: f.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

pub fn categorias(conexion: &Connection) -> Result<Vec<CategoriaGasto>, ErrorGasto> {
    let mut consulta = conexion.prepare(
        "SELECT c.id, c.nombre, c.fijo, c.activo,
                (SELECT COUNT(*) FROM gastos g WHERE g.categoria_id = c.id)
         FROM gasto_categorias c
         ORDER BY c.activo DESC, c.orden, c.nombre",
    )?;
    let filas = consulta
        .query_map([], |f| {
            Ok(CategoriaGasto {
                id: f.get(0)?,
                nombre: f.get(1)?,
                fijo: f.get::<_, i64>(2)? == 1,
                activo: f.get::<_, i64>(3)? == 1,
                en_uso: f.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

pub fn crear_categoria(
    conexion: &Connection,
    nombre: &str,
    fijo: bool,
) -> Result<i64, ErrorGasto> {
    let nombre = nombre.trim();
    if nombre.is_empty() {
        return Err(ErrorGasto::ConceptoVacio);
    }

    let repetida: i64 = conexion.query_row(
        "SELECT COUNT(*) FROM gasto_categorias WHERE nombre = ?1 COLLATE NOCASE",
        params![nombre],
        |f| f.get(0),
    )?;
    if repetida > 0 {
        return Err(ErrorGasto::CategoriaRepetida);
    }

    let orden: i64 = conexion.query_row(
        "SELECT COALESCE(MAX(orden), 0) + 1 FROM gasto_categorias",
        [],
        |f| f.get(0),
    )?;
    conexion.execute(
        "INSERT INTO gasto_categorias (nombre, fijo, orden) VALUES (?1, ?2, ?3)",
        params![nombre, i64::from(fijo), orden],
    )?;
    Ok(conexion.last_insert_rowid())
}

/// Quita una categoría de la lista.
///
/// Si nunca se usó se borra; si tiene gastos detrás se desactiva, para
/// que los reportes viejos sigan diciendo lo que decían.
pub fn quitar_categoria(conexion: &Connection, id: i64) -> Result<(), ErrorGasto> {
    let usos: Option<i64> = conexion
        .query_row(
            "SELECT (SELECT COUNT(*) FROM gastos WHERE categoria_id = ?1)
             FROM gasto_categorias WHERE id = ?1",
            params![id],
            |f| f.get(0),
        )
        .optional()?;
    let usos = usos.ok_or(ErrorGasto::NoExiste)?;

    if usos == 0 {
        conexion.execute("DELETE FROM gasto_categorias WHERE id = ?1", params![id])?;
    } else {
        conexion.execute(
            "UPDATE gasto_categorias SET activo = 0 WHERE id = ?1",
            params![id],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod pruebas;
