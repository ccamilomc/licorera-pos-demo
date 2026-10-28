//! Comandos de inventario que la interfaz puede invocar.
//!
//! Cada comando es una operacion completa. La interfaz manda todo lo que
//! hace falta y recibe un resultado; no existe forma de escribir a medias
//! desde la pantalla.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::inventario::importacion::{self, PlanEntrante, ResultadoImportacion};
use crate::usuarios::{permisos, Rol};
use crate::{ErrorApp, EstadoApp};

#[derive(Debug, Serialize)]
pub struct ProductoListado {
    pub id: i64,
    pub codigo: String,
    pub nombre: String,
    pub categoria: String,
    pub marca: Option<String>,
    pub presentacion: String,
    pub volumen_ml: Option<i64>,
    pub envase: Option<String>,
    pub unidad_base: String,
    pub existencia: i64,
    pub precio_venta: i64,
    pub stock_minimo: i64,
    pub stock_maximo: Option<i64>,
    pub revisar: bool,
    pub revisar_motivo: Option<String>,
    pub empaques: Vec<EmpaqueListado>,
    pub codigos_barras: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct EmpaqueListado {
    pub id: i64,
    pub nombre: String,
    pub factor: i64,
    pub precio_venta: Option<i64>,
    pub predeterminado: bool,
}

#[derive(Debug, Serialize)]
pub struct ResumenInventario {
    pub productos: i64,
    pub unidades: i64,
    /// Lo que costo la mercancia que hay en bodega. Solo llega a quien
    /// puede ver costos: es informacion de fondo del negocio.
    pub valorizado_costo: Option<i64>,
    /// Lo que se recibiria vendiendolo todo. Esta lo puede ver cualquiera
    /// que trabaje en el local, porque son los precios del mostrador.
    pub valorizado_venta: i64,
    pub agotados: i64,
    pub bajo_minimo: i64,
    pub por_revisar: i64,
}

#[tauri::command]
pub fn importar_productos(
    estado: State<'_, EstadoApp>,
    plan: PlanEntrante,
    usuario_id: i64,
    rol: Rol,
) -> Result<ResultadoImportacion, ErrorApp> {
    let mut db = estado.db.lock().map_err(|e| {
        ErrorApp::nuevo("No fue posible acceder a la base de datos.", e)
    })?;

    // Una importacion reescribe el catalogo entero: no es algo que pueda
    // lanzar cualquiera.
    permisos::exigir(&db, rol, permisos::EXCEL_IMPORTAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para importar el inventario.", e))?;

    importacion::aplicar(&mut db, &plan, usuario_id).map_err(|e| {
        ErrorApp::nuevo(
            "No se pudo importar el inventario. No se modifico ningun dato; \
             puedes intentarlo de nuevo.",
            e,
        )
    })
}

#[tauri::command]
pub fn listar_productos(
    estado: State<'_, EstadoApp>,
) -> Result<Vec<ProductoListado>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    let error = |e: rusqlite::Error| {
        ErrorApp::nuevo("No se pudo consultar el inventario.", e)
    };

    let mut consulta = db
        .prepare(
            "SELECT p.id, p.codigo, p.nombre, c.nombre, p.presentacion, p.volumen_ml,
                    p.envase, p.existencia, p.precio_venta, p.stock_minimo,
                    p.revisar, p.revisar_motivo, m.nombre, p.unidad_base,
                    p.stock_maximo
             FROM productos p
             JOIN categorias c ON c.id = p.categoria_id
             LEFT JOIN marcas m ON m.id = p.marca_id
             WHERE p.activo = 1
             ORDER BY c.orden, p.nombre",
        )
        .map_err(error)?;

    let filas = consulta
        .query_map([], |f| {
            Ok(ProductoListado {
                id: f.get(0)?,
                codigo: f.get(1)?,
                nombre: f.get(2)?,
                categoria: f.get(3)?,
                presentacion: f.get(4)?,
                volumen_ml: f.get(5)?,
                envase: f.get(6)?,
                existencia: f.get(7)?,
                precio_venta: f.get(8)?,
                stock_minimo: f.get(9)?,
                revisar: f.get::<_, i64>(10)? == 1,
                revisar_motivo: f.get(11)?,
                marca: f.get(12)?,
                unidad_base: f.get(13)?,
                stock_maximo: f.get(14)?,
                empaques: Vec::new(),
                codigos_barras: Vec::new(),
            })
        })
        .map_err(error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error)?;

    // Los empaques se traen de una sola vez y se reparten en memoria, en
    // vez de una consulta por producto.
    let mut consulta_empaques = db
        .prepare(
            "SELECT producto_id, id, nombre, factor, precio_venta, predeterminado
             FROM producto_empaques
             WHERE activo = 1
             ORDER BY producto_id, orden",
        )
        .map_err(error)?;

    let mut por_producto: std::collections::HashMap<i64, Vec<EmpaqueListado>> =
        std::collections::HashMap::new();

    let empaques = consulta_empaques
        .query_map([], |f| {
            Ok((
                f.get::<_, i64>(0)?,
                EmpaqueListado {
                    id: f.get(1)?,
                    nombre: f.get(2)?,
                    factor: f.get(3)?,
                    precio_venta: f.get(4)?,
                    predeterminado: f.get::<_, i64>(5)? == 1,
                },
            ))
        })
        .map_err(error)?;

    for empaque in empaques {
        let (producto_id, e) = empaque.map_err(error)?;
        por_producto.entry(producto_id).or_default().push(e);
    }

    let mut codigos: std::collections::HashMap<i64, Vec<String>> =
        std::collections::HashMap::new();
    {
        let mut consulta_codigos = db
            .prepare("SELECT producto_id, codigo FROM producto_codigos ORDER BY id")
            .map_err(error)?;
        let filas_codigos = consulta_codigos
            .query_map([], |f| Ok((f.get::<_, i64>(0)?, f.get::<_, String>(1)?)))
            .map_err(error)?;
        for fila in filas_codigos {
            let (id, codigo) = fila.map_err(error)?;
            codigos.entry(id).or_default().push(codigo);
        }
    }

    Ok(filas
        .into_iter()
        .map(|mut p| {
            p.empaques = por_producto.remove(&p.id).unwrap_or_default();
            p.codigos_barras = codigos.remove(&p.id).unwrap_or_default();
            p
        })
        .collect())
}

#[tauri::command]
pub fn resumen_inventario(
    estado: State<'_, EstadoApp>,
    rol: Rol,
) -> Result<ResumenInventario, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    // El costo no se manda y se esconde en la pantalla: no se manda.
    let ve_costos = permisos::tiene(&db, rol, permisos::COSTO_VER).unwrap_or(false);

    let mut resumen = db
        .query_row(
            "SELECT
               COUNT(*),
               COALESCE(SUM(existencia), 0),
               COALESCE(SUM(existencia * COALESCE(costo_promedio, 0)), 0),
               COALESCE(SUM(existencia * precio_venta), 0),
               COALESCE(SUM(CASE WHEN existencia <= 0 THEN 1 ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN stock_minimo > 0 AND existencia > 0
                                  AND existencia <= stock_minimo THEN 1 ELSE 0 END), 0),
               COALESCE(SUM(revisar), 0)
             FROM productos WHERE activo = 1",
            [],
            |f| {
                Ok(ResumenInventario {
                    productos: f.get(0)?,
                    unidades: f.get(1)?,
                    valorizado_costo: Some(f.get(2)?),
                    valorizado_venta: f.get(3)?,
                    agotados: f.get(4)?,
                    bajo_minimo: f.get(5)?,
                    por_revisar: f.get(6)?,
                })
            },
        )
        .map_err(|e| ErrorApp::nuevo("No se pudo calcular el resumen del inventario.", e))?;

    if !ve_costos {
        resumen.valorizado_costo = None;
    }
    Ok(resumen)
}

// ---------------------------------------------------------------------------
// Alta, edicion y ajustes
// ---------------------------------------------------------------------------

use crate::inventario::productos::{self, Ajuste, ProductoEditable, ResultadoAjuste};

fn traducir(error: productos::ErrorProducto) -> ErrorApp {
    use productos::ErrorProducto as E;
    match error {
        E::CodigoRepetido(ref c) =>
            ErrorApp::nuevo(format!("Ya hay un producto con el codigo {c}."), error),
        E::CodigoBarrasRepetido => ErrorApp::nuevo(
            "Ese codigo de barras ya esta en otro producto.", error),
        E::CategoriaInvalida =>
            ErrorApp::nuevo("Elige una categoria valida.", error),
        E::NombreVacio =>
            ErrorApp::nuevo("El nombre no puede quedar vacio.", error),
        E::SinFormaDeVenta => ErrorApp::nuevo(
            "El producto necesita al menos una forma de venta con precio.", error),
        E::FaltaMotivo =>
            ErrorApp::nuevo("Escribe por que se ajusta la existencia.", error),
        E::ExistenciaNegativa => ErrorApp::nuevo(
            "El ajuste dejaria la existencia en negativo. Revisa la cantidad.", error),
        E::NoExiste =>
            ErrorApp::nuevo("Ese producto ya no existe.", error),
        E::NoEsAjuste => ErrorApp::nuevo(
            "Eso no es un ajuste manual. Los movimientos de una venta o una              compra se arreglan anulando la venta o la compra.", error),
        E::AjusteYaDeshecho =>
            ErrorApp::nuevo("Ese ajuste ya se deshizo.", error),
        E::FactorInvalido => ErrorApp::nuevo(
            "Di cuantas unidades trae. Una canasta de cerveza, por ejemplo, trae 30.",
            error),
        E::EmpaqueRepetido => ErrorApp::nuevo(
            "Ese producto ya tiene una forma que se llama asi.", error),
        otro => ErrorApp::nuevo(
            "No se pudo guardar. No se modifico nada; intentalo de nuevo.", otro),
    }
}

#[tauri::command]
pub fn crear_producto(
    estado: State<'_, EstadoApp>,
    producto: ProductoEditable,
    rol: Rol,
    usuario_id: i64,
) -> Result<i64, ErrorApp> {
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PRODUCTO_CREAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para crear productos.", e))?;

    productos::crear(&mut db, &producto, usuario_id).map_err(traducir)
}

#[tauri::command]
pub fn editar_producto(
    estado: State<'_, EstadoApp>,
    producto: ProductoEditable,
    rol: Rol,
    usuario_id: i64,
) -> Result<(), ErrorApp> {
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PRODUCTO_EDITAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para editar productos.", e))?;

    // Cambiar el precio es aparte de editar el resto: el encargado puede
    // corregir un nombre pero no tocar lo que se cobra.
    let precio_actual: i64 = producto
        .id
        .and_then(|id| {
            db.query_row(
                "SELECT precio_venta FROM productos WHERE id = ?1",
                rusqlite::params![id],
                |f| f.get(0),
            )
            .ok()
        })
        .unwrap_or(producto.precio_venta);

    if precio_actual != producto.precio_venta {
        permisos::exigir(&db, rol, permisos::PRODUCTO_PRECIO)
            .map_err(|e| ErrorApp::nuevo("No tienes permiso para cambiar precios.", e))?;
    }

    productos::editar(&mut db, &producto, usuario_id).map_err(traducir)
}

#[tauri::command]
pub fn ajustar_existencia(
    estado: State<'_, EstadoApp>,
    ajuste: Ajuste,
    rol: Rol,
) -> Result<ResultadoAjuste, ErrorApp> {
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::INVENTARIO_AJUSTAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para ajustar el inventario.", e))?;

    productos::ajustar(&mut db, &ajuste).map_err(traducir)
}

/// Deshace un ajuste que se hizo mal.
///
/// Mete el movimiento contrario y deja los dos en el libro. No borra
/// nada, igual que anular una venta.
#[tauri::command]
pub fn deshacer_ajuste(
    estado: State<'_, EstadoApp>,
    movimiento_id: i64,
    motivo: String,
    usuario_id: i64,
    rol: Rol,
) -> Result<ResultadoAjuste, ErrorApp> {
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::INVENTARIO_AJUSTAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para ajustar el inventario.", e))?;

    productos::deshacer_ajuste(&mut db, movimiento_id, &motivo, usuario_id).map_err(traducir)
}

/// Agrega una forma de mover el producto desde donde haga falta.
///
/// La usa la pantalla de compras: si llegan cinco canastas y el producto
/// no tiene canasta, se crea ahi mismo en vez de abandonar la compra a
/// medias para ir a la ficha.
#[derive(Debug, Deserialize)]
pub struct FormaNueva {
    pub producto_id: i64,
    pub nombre: String,
    pub factor: i64,
    pub precio_venta: Option<i64>,
    pub para_venta: bool,
    pub para_compra: bool,
}

#[tauri::command]
pub fn agregar_empaque(
    estado: State<'_, EstadoApp>,
    forma: FormaNueva,
    rol: Rol,
) -> Result<productos::EmpaqueAgregado, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PRODUCTO_EDITAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para editar productos.", e))?;

    productos::agregar_empaque(
        &db,
        forma.producto_id,
        &forma.nombre,
        forma.factor,
        forma.precio_venta,
        forma.para_venta,
        forma.para_compra,
    )
    .map_err(traducir)
}

#[tauri::command]
pub fn asociar_codigo_barras(
    estado: State<'_, EstadoApp>,
    producto_id: i64,
    codigo: String,
    rol: Rol,
    usuario_id: i64,
) -> Result<(), ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PRODUCTO_EDITAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para editar productos.", e))?;

    productos::agregar_codigo_barras(&db, producto_id, &codigo, usuario_id).map_err(traducir)
}

#[tauri::command]
pub fn quitar_codigo_barras(
    estado: State<'_, EstadoApp>,
    codigo: String,
    rol: Rol,
) -> Result<(), ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PRODUCTO_EDITAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para editar productos.", e))?;

    productos::quitar_codigo_barras(&db, &codigo).map_err(traducir)
}

#[tauri::command]
pub fn desactivar_producto(
    estado: State<'_, EstadoApp>,
    producto_id: i64,
    rol: Rol,
    usuario_id: i64,
) -> Result<(), ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PRODUCTO_DESACTIVAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para desactivar productos.", e))?;

    productos::desactivar(&db, producto_id, usuario_id).map_err(traducir)
}

#[tauri::command]
pub fn listar_categorias(estado: State<'_, EstadoApp>) -> Result<Vec<String>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudieron cargar las categorias.", e);

    let mut consulta = db
        .prepare("SELECT nombre FROM categorias WHERE activo = 1 ORDER BY orden")
        .map_err(fallo)?;
    let filas = consulta
        .query_map([], |f| f.get(0))
        .map_err(fallo)?
        .collect::<Result<Vec<String>, _>>()
        .map_err(fallo)?;
    Ok(filas)
}


/// Un precio especial con fecha de vencimiento.
#[derive(Debug, Serialize)]
pub struct PrecioVigencia {
    pub id: i64,
    pub producto_id: i64,
    pub producto: String,
    pub empaque_id: Option<i64>,
    pub empaque: Option<String>,
    /// El precio de siempre, para poder comparar.
    pub precio_normal: i64,
    pub precio: i64,
    pub motivo: Option<String>,
    pub desde: String,
    pub hasta: String,
    pub activo: bool,
    /// Si esta rigiendo hoy.
    pub vigente_hoy: bool,
}

#[derive(Debug, Deserialize)]
pub struct PrecioEspecial {
    pub producto_id: i64,
    pub empaque_id: Option<i64>,
    pub precio: i64,
    pub motivo: Option<String>,
    pub desde: String,
    pub hasta: String,
}

/// Los precios especiales de un producto, o los de todo el negocio.
#[tauri::command]
pub fn listar_precios_especiales(
    estado: State<'_, EstadoApp>,
    producto_id: Option<i64>,
    rol: Rol,
) -> Result<Vec<PrecioVigencia>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PRODUCTO_EDITAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para ver los precios especiales.", e))?;

    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudieron cargar los precios.", e);

    let mut consulta = db
        .prepare(
            "SELECT v.id, v.producto_id, p.nombre, v.empaque_id, e.nombre,
                    COALESCE(e.precio_venta, p.precio_venta),
                    v.precio, v.motivo, v.desde, v.hasta, v.activo,
                    CASE WHEN v.activo = 1
                          AND date('now','localtime') BETWEEN v.desde AND v.hasta
                         THEN 1 ELSE 0 END
             FROM precios_vigencia v
             JOIN productos p ON p.id = v.producto_id
             LEFT JOIN producto_empaques e ON e.id = v.empaque_id
             WHERE (?1 IS NULL OR v.producto_id = ?1)
             ORDER BY v.hasta DESC, v.id DESC",
        )
        .map_err(fallo)?;

    let filas = consulta
        .query_map(rusqlite::params![producto_id], |f| {
            Ok(PrecioVigencia {
                id: f.get(0)?,
                producto_id: f.get(1)?,
                producto: f.get(2)?,
                empaque_id: f.get(3)?,
                empaque: f.get(4)?,
                precio_normal: f.get(5)?,
                precio: f.get(6)?,
                motivo: f.get(7)?,
                desde: f.get(8)?,
                hasta: f.get(9)?,
                activo: f.get::<_, i64>(10)? == 1,
                vigente_hoy: f.get::<_, i64>(11)? == 1,
            })
        })
        .map_err(fallo)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(fallo)?;
    Ok(filas)
}

/// Pone un precio especial por un rango de fechas.
///
/// No toca el precio de siempre: cuando la vigencia acabe, el producto
/// vuelve solo a su precio de lista.
#[tauri::command]
pub fn poner_precio_especial(
    estado: State<'_, EstadoApp>,
    precio: PrecioEspecial,
    usuario_id: i64,
    rol: Rol,
) -> Result<i64, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PRODUCTO_PRECIO)
        .map_err(|e| ErrorApp::nuevo("Solo un administrador puede cambiar precios.", e))?;

    if precio.precio < 0 {
        return Err(ErrorApp::mensaje("El precio no puede ser negativo."));
    }
    if precio.hasta < precio.desde {
        return Err(ErrorApp::mensaje("La fecha de fin no puede ser antes de la de inicio."));
    }

    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudo guardar el precio.", e);

    db.execute(
        "INSERT INTO precios_vigencia
           (producto_id, empaque_id, precio, motivo, desde, hasta, usuario_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            precio.producto_id, precio.empaque_id, precio.precio,
            precio.motivo.as_deref().map(str::trim).filter(|m| !m.is_empty()),
            precio.desde, precio.hasta, usuario_id,
        ],
    )
    .map_err(fallo)?;
    let id = db.last_insert_rowid();

    let quien: String = db
        .query_row(
            "SELECT nombre FROM usuarios WHERE id = ?1",
            rusqlite::params![usuario_id],
            |f| f.get(0),
        )
        .unwrap_or_else(|_| "desconocido".to_owned());

    db.execute(
        "INSERT INTO auditoria
           (usuario_id, usuario_nombre, accion, entidad, entidad_id, descripcion)
         VALUES (?1, ?2, 'PRECIO_ESPECIAL', 'productos', ?3, ?4)",
        rusqlite::params![
            usuario_id, quien, precio.producto_id,
            format!("Precio {} del {} al {}", precio.precio, precio.desde, precio.hasta),
        ],
    )
    .map_err(fallo)?;

    Ok(id)
}

/// Quita un precio especial antes de que venza.
#[tauri::command]
pub fn quitar_precio_especial(
    estado: State<'_, EstadoApp>,
    precio_id: i64,
    usuario_id: i64,
    rol: Rol,
) -> Result<(), ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::PRODUCTO_PRECIO)
        .map_err(|e| ErrorApp::nuevo("Solo un administrador puede cambiar precios.", e))?;

    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudo quitar el precio.", e);

    // Se desactiva y no se borra: hay ventas que se cobraron con el.
    db.execute(
        "UPDATE precios_vigencia SET activo = 0 WHERE id = ?1",
        rusqlite::params![precio_id],
    )
    .map_err(fallo)?;

    let quien: String = db
        .query_row(
            "SELECT nombre FROM usuarios WHERE id = ?1",
            rusqlite::params![usuario_id],
            |f| f.get(0),
        )
        .unwrap_or_else(|_| "desconocido".to_owned());

    db.execute(
        "INSERT INTO auditoria
           (usuario_id, usuario_nombre, accion, entidad, entidad_id, descripcion)
         VALUES (?1, ?2, 'PRECIO_ESPECIAL', 'precios_vigencia', ?3, 'Precio especial retirado')",
        rusqlite::params![usuario_id, quien, precio_id],
    )
    .map_err(fallo)?;

    Ok(())
}
