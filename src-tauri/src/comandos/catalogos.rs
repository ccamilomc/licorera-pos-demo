//! Las listas que el dueño administra.
//!
//! Categorias, marcas, envases y proveedores. El Excel del negocio trajo
//! unas cuantas de cada una, pero era una guia de como estaba el local el
//! dia que se miro, no el molde: el dueño tiene que poder agregar,
//! renombrar y retirar las suyas sin depender de nadie.
//!
//! Nada se borra, igual que en el resto del sistema: se desactiva. Una
//! categoria borrada dejaria productos apuntando al vacio y reportes
//! viejos sin explicacion.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::usuarios::{permisos, Rol};
use crate::{ErrorApp, EstadoApp};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TipoCatalogo {
    Categorias,
    Marcas,
    Envases,
    Unidades,
}

impl TipoCatalogo {
    /// El nombre de la tabla nunca sale de la entrada del usuario: se
    /// elige aqui, entre estas cuatro constantes.
    fn tabla(self) -> &'static str {
        match self {
            Self::Categorias => "categorias",
            Self::Marcas => "marcas",
            Self::Envases => "envases",
            Self::Unidades => "unidades",
        }
    }

    /// Las marcas no tienen orden propio; se listan alfabeticamente.
    fn tiene_orden(self) -> bool {
        !matches!(self, Self::Marcas)
    }

    /// A que columna de productos apunta, para saber si esta en uso.
    fn columna_en_productos(self) -> &'static str {
        match self {
            Self::Categorias => "categoria_id",
            Self::Marcas => "marca_id",
            Self::Envases => "envase",
            Self::Unidades => "unidad_base",
        }
    }

    /// Envases y unidades se guardan por nombre en productos, no por id.
    fn se_guarda_por_nombre(self) -> bool {
        matches!(self, Self::Envases | Self::Unidades)
    }
}

#[derive(Debug, Serialize)]
pub struct ItemCatalogo {
    pub id: i64,
    pub nombre: String,
    pub activo: bool,
    /// Cuantos productos lo usan. Sirve para avisar antes de retirarlo.
    pub en_uso: i64,
}

#[tauri::command]
pub fn listar_catalogo(
    estado: State<'_, EstadoApp>,
    tipo: TipoCatalogo,
    incluir_inactivos: bool,
) -> Result<Vec<ItemCatalogo>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudo cargar la lista.", e);

    // Unidades guarda el valor en `codigo`; las demas en `nombre`.
    let campo = if matches!(tipo, TipoCatalogo::Unidades) { "codigo" } else { "nombre" };
    let orden = if tipo.tiene_orden() { "orden, nombre" } else { "nombre" };
    let filtro = if incluir_inactivos { "" } else { "WHERE activo = 1" };

    let cuenta = if tipo.se_guarda_por_nombre() {
        format!(
            "(SELECT COUNT(*) FROM productos p WHERE p.{} = c.{} COLLATE NOCASE)",
            tipo.columna_en_productos(), campo,
        )
    } else {
        format!(
            "(SELECT COUNT(*) FROM productos p WHERE p.{} = c.id)",
            tipo.columna_en_productos(),
        )
    };

    let consulta = format!(
        "SELECT c.id, c.{campo}, c.activo, {cuenta} FROM {} c {filtro} ORDER BY {orden}",
        tipo.tabla(),
    );

    let mut preparada = db.prepare(&consulta).map_err(fallo)?;
    let filas = preparada
        .query_map([], |f| {
            Ok(ItemCatalogo {
                id: f.get(0)?,
                nombre: f.get(1)?,
                activo: f.get::<_, i64>(2)? == 1,
                en_uso: f.get(3)?,
            })
        })
        .map_err(fallo)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(fallo)?;
    Ok(filas)
}

/// Crea una entrada nueva, o renombra la que se indique.
#[tauri::command]
pub fn guardar_catalogo(
    estado: State<'_, EstadoApp>,
    tipo: TipoCatalogo,
    id: Option<i64>,
    nombre: String,
    usuario_id: i64,
    rol: Rol,
) -> Result<i64, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PRODUCTO_EDITAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para cambiar estas listas.", e))?;

    let limpio = nombre.trim();
    if limpio.is_empty() {
        return Err(ErrorApp::mensaje("Escribe un nombre."));
    }

    let tabla = tipo.tabla();
    let campo = if matches!(tipo, TipoCatalogo::Unidades) { "codigo" } else { "nombre" };

    // Se comprueba antes para poder dar un mensaje que se entienda, en
    // vez del error crudo de la restriccion.
    let repetido: Option<i64> = db
        .query_row(
            &format!("SELECT id FROM {tabla} WHERE {campo} = ?1 COLLATE NOCASE"),
            params![limpio],
            |f| f.get(0),
        )
        .optional()
        .map_err(|e| ErrorApp::nuevo("No se pudo comprobar el nombre.", e))?;
    if let Some(otro) = repetido {
        if Some(otro) != id {
            return Err(ErrorApp::mensaje(format!("«{limpio}» ya está en la lista.")));
        }
    }

    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudo guardar.", e);

    let id_final = match id {
        Some(id) => {
            db.execute(
                &format!("UPDATE {tabla} SET {campo} = ?2 WHERE id = ?1"),
                params![id, limpio],
            )
            .map_err(fallo)?;
            id
        }
        None => {
            if tipo.tiene_orden() {
                db.execute(
                    &format!(
                        "INSERT INTO {tabla} ({campo}, orden)
                         VALUES (?1, (SELECT COALESCE(MAX(orden), 0) + 10 FROM {tabla}))"
                    ),
                    params![limpio],
                )
                .map_err(fallo)?;
            } else {
                db.execute(
                    &format!("INSERT INTO {tabla} ({campo}) VALUES (?1)"),
                    params![limpio],
                )
                .map_err(fallo)?;
            }
            db.last_insert_rowid()
        }
    };

    // Las unidades llevan ademas un nombre para mostrar.
    if matches!(tipo, TipoCatalogo::Unidades) {
        db.execute(
            "UPDATE unidades SET nombre = ?2 WHERE id = ?1 AND (nombre IS NULL OR nombre = '')",
            params![id_final, limpio],
        )
        .map_err(fallo)?;
    }

    let quien: String = db
        .query_row(
            "SELECT nombre FROM usuarios WHERE id = ?1",
            params![usuario_id],
            |f| f.get(0),
        )
        .unwrap_or_else(|_| "desconocido".to_owned());

    db.execute(
        "INSERT INTO auditoria
           (usuario_id, usuario_nombre, accion, entidad, entidad_id, descripcion)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            usuario_id, quien,
            if id.is_some() { "EDITAR_CATALOGO" } else { "CREAR_CATALOGO" },
            tabla, id_final,
            format!("{}: {limpio}", if id.is_some() { "Renombrado" } else { "Agregado" }),
        ],
    )
    .map_err(fallo)?;

    Ok(id_final)
}

/// Retira una entrada de la lista sin borrarla.
#[tauri::command]
pub fn desactivar_catalogo(
    estado: State<'_, EstadoApp>,
    tipo: TipoCatalogo,
    id: i64,
    activo: bool,
    usuario_id: i64,
    rol: Rol,
) -> Result<(), ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PRODUCTO_EDITAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para cambiar estas listas.", e))?;

    let tabla = tipo.tabla();
    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudo guardar el cambio.", e);

    db.execute(
        &format!("UPDATE {tabla} SET activo = ?2 WHERE id = ?1"),
        params![id, i64::from(activo)],
    )
    .map_err(fallo)?;

    let quien: String = db
        .query_row(
            "SELECT nombre FROM usuarios WHERE id = ?1",
            params![usuario_id],
            |f| f.get(0),
        )
        .unwrap_or_else(|_| "desconocido".to_owned());

    db.execute(
        "INSERT INTO auditoria
           (usuario_id, usuario_nombre, accion, entidad, entidad_id, descripcion)
         VALUES (?1, ?2, 'EDITAR_CATALOGO', ?3, ?4, ?5)",
        params![usuario_id, quien, tabla, id,
                if activo { "Reactivado" } else { "Retirado de la lista" }],
    )
    .map_err(fallo)?;

    Ok(())
}

// ---------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ProveedorEditable {
    pub id: Option<i64>,
    pub nombre: String,
    pub nit: Option<String>,
    pub telefono: Option<String>,
    pub contacto: Option<String>,
    pub direccion: Option<String>,
    pub notas: Option<String>,
}

/// Da de alta un proveedor o guarda sus datos.
///
/// Faltaba por completo: se podian listar y comprarles, pero no habia
/// forma de agregar uno nuevo. Quien estrena el programa no tiene
/// ninguno.
#[tauri::command]
pub fn guardar_proveedor(
    estado: State<'_, EstadoApp>,
    proveedor: ProveedorEditable,
    usuario_id: i64,
    rol: Rol,
) -> Result<i64, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PROVEEDOR_GESTIONAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para gestionar proveedores.", e))?;

    let nombre = proveedor.nombre.trim();
    if nombre.is_empty() {
        return Err(ErrorApp::mensaje("El proveedor necesita un nombre."));
    }

    let repetido: Option<i64> = db
        .query_row(
            "SELECT id FROM proveedores WHERE nombre = ?1 COLLATE NOCASE",
            params![nombre],
            |f| f.get(0),
        )
        .optional()
        .map_err(|e| ErrorApp::nuevo("No se pudo comprobar el nombre.", e))?;
    if let Some(otro) = repetido {
        if Some(otro) != proveedor.id {
            return Err(ErrorApp::mensaje(format!("Ya tienes un proveedor llamado «{nombre}».")));
        }
    }

    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudo guardar el proveedor.", e);
    let vacio_a_nulo = |v: &Option<String>| {
        v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned)
    };

    let id = match proveedor.id {
        Some(id) => {
            db.execute(
                "UPDATE proveedores SET nombre = ?2, nit = ?3, telefono = ?4,
                        contacto = ?5, direccion = ?6, notas = ?7
                 WHERE id = ?1",
                params![id, nombre, vacio_a_nulo(&proveedor.nit),
                        vacio_a_nulo(&proveedor.telefono), vacio_a_nulo(&proveedor.contacto),
                        vacio_a_nulo(&proveedor.direccion), vacio_a_nulo(&proveedor.notas)],
            )
            .map_err(fallo)?;
            id
        }
        None => {
            db.execute(
                "INSERT INTO proveedores (nombre, nit, telefono, contacto, direccion, notas)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![nombre, vacio_a_nulo(&proveedor.nit),
                        vacio_a_nulo(&proveedor.telefono), vacio_a_nulo(&proveedor.contacto),
                        vacio_a_nulo(&proveedor.direccion), vacio_a_nulo(&proveedor.notas)],
            )
            .map_err(fallo)?;
            db.last_insert_rowid()
        }
    };

    let quien: String = db
        .query_row(
            "SELECT nombre FROM usuarios WHERE id = ?1",
            params![usuario_id],
            |f| f.get(0),
        )
        .unwrap_or_else(|_| "desconocido".to_owned());

    db.execute(
        "INSERT INTO auditoria
           (usuario_id, usuario_nombre, accion, entidad, entidad_id, descripcion)
         VALUES (?1, ?2, ?3, 'proveedores', ?4, ?5)",
        params![usuario_id, quien,
                if proveedor.id.is_some() { "EDITAR_PROVEEDOR" } else { "CREAR_PROVEEDOR" },
                id, format!("Proveedor {nombre}")],
    )
    .map_err(fallo)?;

    Ok(id)
}

#[tauri::command]
pub fn desactivar_proveedor(
    estado: State<'_, EstadoApp>,
    proveedor_id: i64,
    activo: bool,
    usuario_id: i64,
    rol: Rol,
) -> Result<(), ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PROVEEDOR_GESTIONAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para gestionar proveedores.", e))?;

    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudo guardar el cambio.", e);

    db.execute(
        "UPDATE proveedores SET activo = ?2 WHERE id = ?1",
        params![proveedor_id, i64::from(activo)],
    )
    .map_err(fallo)?;

    let quien: String = db
        .query_row(
            "SELECT nombre FROM usuarios WHERE id = ?1",
            params![usuario_id],
            |f| f.get(0),
        )
        .unwrap_or_else(|_| "desconocido".to_owned());

    db.execute(
        "INSERT INTO auditoria
           (usuario_id, usuario_nombre, accion, entidad, entidad_id, descripcion)
         VALUES (?1, ?2, 'EDITAR_PROVEEDOR', 'proveedores', ?3, ?4)",
        params![usuario_id, quien, proveedor_id,
                if activo { "Proveedor reactivado" } else { "Proveedor retirado" }],
    )
    .map_err(fallo)?;

    Ok(())
}
