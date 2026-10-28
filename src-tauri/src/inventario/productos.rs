//! Alta, edición y ajustes de productos.
//!
//! Aquí se resuelven a mano los casos que la importación dejó señalados:
//! ponerle tamaño a las dos Margaritas, unir la cerveza que quedó partida
//! en dos nombres, capturar el código de barras escaneando una vez.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum ErrorProducto {
    #[error("ese movimiento no es un ajuste manual")]
    NoEsAjuste,

    #[error("ese ajuste ya se deshizo")]
    AjusteYaDeshecho,

    #[error("el producto no existe")]
    NoExiste,
    #[error("ya hay un producto con el código {0}")]
    CodigoRepetido(String),
    #[error("ese código de barras ya está en otro producto")]
    CodigoBarrasRepetido,
    #[error("la categoría no existe")]
    CategoriaInvalida,
    #[error("el nombre no puede estar vacío")]
    NombreVacio,
    #[error("el precio no puede ser negativo")]
    PrecioInvalido,
    #[error("hay que decir por qué se ajusta")]
    FaltaMotivo,
    #[error("el ajuste dejaría la existencia en negativo")]
    ExistenciaNegativa,
    #[error("un producto vendible necesita al menos una forma de venta con precio")]
    SinFormaDeVenta,
    #[error("el factor tiene que ser al menos 1")]
    FactorInvalido,
    #[error("ese producto ya tiene una forma que se llama así")]
    EmpaqueRepetido,
    #[error("error de base de datos")]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, Deserialize)]
pub struct EmpaqueEditable {
    pub id: Option<i64>,
    pub nombre: String,
    pub factor: i64,
    pub precio_venta: Option<i64>,
    pub para_venta: bool,
    pub para_compra: bool,
    pub predeterminado: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProductoEditable {
    pub id: Option<i64>,
    pub codigo: String,
    pub nombre: String,
    pub categoria: String,
    /// Opcional: no todo producto tiene marca (el hielo, los desechables).
    #[serde(default)]
    pub marca: Option<String>,
    pub presentacion: String,
    pub volumen_ml: Option<i64>,
    pub envase: Option<String>,
    /// En que se cuenta la existencia. Casi siempre unidades, pero el
    /// hielo se vende por kilo.
    #[serde(default = "unidad_por_omision")]
    pub unidad_base: String,
    pub precio_venta: i64,
    pub stock_minimo: i64,
    /// Cuanto es demasiado. Sirve para no sobrecomprar lo que rota lento.
    #[serde(default)]
    pub stock_maximo: Option<i64>,
    pub empaques: Vec<EmpaqueEditable>,
    pub notas: Option<String>,
}

fn unidad_por_omision() -> String {
    "UNIDAD".to_owned()
}

#[derive(Debug, Clone, Deserialize)]
pub struct Ajuste {
    pub producto_id: i64,
    /// Con signo: positivo entra, negativo sale.
    pub cantidad: i64,
    pub motivo: String,
    pub usuario_id: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResultadoAjuste {
    pub producto: String,
    pub existencia_antes: i64,
    pub existencia_despues: i64,
}

fn validar(p: &ProductoEditable) -> Result<(), ErrorProducto> {
    if p.nombre.trim().is_empty() {
        return Err(ErrorProducto::NombreVacio);
    }
    if p.precio_venta < 0 {
        return Err(ErrorProducto::PrecioInvalido);
    }
    // Sin una forma de venta con precio no se puede cobrar el producto.
    let vendible = p
        .empaques
        .iter()
        .any(|e| e.para_venta && e.precio_venta.unwrap_or(0) > 0);
    if !vendible {
        return Err(ErrorProducto::SinFormaDeVenta);
    }
    Ok(())
}

/// El id de la categoria, creandola si hace falta.
///
/// El Excel del negocio trajo unas cuantas, pero es un punto de partida y
/// no el molde: quien instale el programa vende cosas que ese archivo
/// nunca tuvo. Antes se rechazaba el producto entero por una categoria
/// que no existia, y no habia ninguna forma de crearla.
///
/// Se crea aqui dentro, en la misma transaccion del producto: si el
/// guardado falla, la categoria tampoco queda.
fn id_categoria(tx: &Transaction, nombre: &str) -> Result<i64, ErrorProducto> {
    let nombre = nombre.trim();
    if nombre.is_empty() {
        return Err(ErrorProducto::CategoriaInvalida);
    }

    let existente: Option<i64> = tx
        .query_row(
            "SELECT id FROM categorias WHERE nombre = ?1 COLLATE NOCASE",
            params![nombre],
            |f| f.get(0),
        )
        .optional()?;
    if let Some(id) = existente {
        return Ok(id);
    }

    // Al final de la lista: el orden del Excel manda para las que ya
    // estaban, y las nuevas se van sumando abajo.
    tx.execute(
        "INSERT INTO categorias (nombre, orden)
         VALUES (?1, (SELECT COALESCE(MAX(orden), 0) + 10 FROM categorias))",
        params![nombre],
    )?;
    Ok(tx.last_insert_rowid())
}

/// Lo mismo con la marca, que ademas puede no venir.
fn id_marca(tx: &Transaction, nombre: Option<&str>) -> Result<Option<i64>, ErrorProducto> {
    let Some(nombre) = nombre.map(str::trim).filter(|n| !n.is_empty()) else {
        return Ok(None);
    };

    let existente: Option<i64> = tx
        .query_row(
            "SELECT id FROM marcas WHERE nombre = ?1 COLLATE NOCASE",
            params![nombre],
            |f| f.get(0),
        )
        .optional()?;
    if let Some(id) = existente {
        return Ok(Some(id));
    }

    tx.execute("INSERT INTO marcas (nombre) VALUES (?1)", params![nombre])?;
    Ok(Some(tx.last_insert_rowid()))
}

pub fn crear(
    conexion: &mut Connection,
    producto: &ProductoEditable,
    usuario_id: i64,
) -> Result<i64, ErrorProducto> {
    validar(producto)?;
    let tx = conexion.transaction()?;
    let categoria_id = id_categoria(&tx, &producto.categoria)?;
    let marca_id = id_marca(&tx, producto.marca.as_deref())?;

    tx.execute(
        "INSERT INTO productos
           (codigo, nombre, categoria_id, marca_id, presentacion, volumen_ml,
            envase, unidad_base, existencia, precio_venta, stock_minimo,
            stock_maximo, notas)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11, ?12)",
        params![
            producto.codigo.trim(), producto.nombre.trim(), categoria_id,
            marca_id, producto.presentacion.trim(), producto.volumen_ml,
            producto.envase, producto.unidad_base, producto.precio_venta,
            producto.stock_minimo, producto.stock_maximo, producto.notas,
        ],
    )
    .map_err(|e| traducir_unicidad(e, &producto.codigo))?;

    let id = tx.last_insert_rowid();
    escribir_empaques(&tx, id, &producto.empaques, usuario_id)?;
    auditar(&tx, usuario_id, "CREAR_PRODUCTO", id,
            &format!("Alta de {} {}", producto.nombre, producto.presentacion))?;

    tx.commit()?;
    Ok(id)
}

/// Guarda los cambios de un producto.
///
/// La existencia **no** se toca aquí: para eso está `ajustar`, que exige
/// motivo y deja el movimiento en el libro. Si editar pudiera cambiar el
/// stock de paso, se perdería el rastro de por qué cambió.
pub fn editar(
    conexion: &mut Connection,
    producto: &ProductoEditable,
    usuario_id: i64,
) -> Result<(), ErrorProducto> {
    let Some(id) = producto.id else {
        return Err(ErrorProducto::NoExiste);
    };
    validar(producto)?;

    let tx = conexion.transaction()?;
    let categoria_id = id_categoria(&tx, &producto.categoria)?;
    let marca_id = id_marca(&tx, producto.marca.as_deref())?;

    let antes: Option<(String, i64)> = tx
        .query_row(
            "SELECT nombre, precio_venta FROM productos WHERE id = ?1",
            params![id],
            |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .optional()?;
    let Some((nombre_antes, precio_antes)) = antes else {
        return Err(ErrorProducto::NoExiste);
    };

    tx.execute(
        "UPDATE productos SET
           codigo = ?2, nombre = ?3, categoria_id = ?4, marca_id = ?5,
           presentacion = ?6, volumen_ml = ?7, envase = ?8, unidad_base = ?9,
           precio_venta = ?10, stock_minimo = ?11, stock_maximo = ?12,
           notas = ?13,
           revisar = 0, revisar_motivo = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?1",
        params![
            id, producto.codigo.trim(), producto.nombre.trim(), categoria_id,
            marca_id, producto.presentacion.trim(), producto.volumen_ml,
            producto.envase, producto.unidad_base, producto.precio_venta,
            producto.stock_minimo, producto.stock_maximo, producto.notas,
        ],
    )
    .map_err(|e| traducir_unicidad(e, &producto.codigo))?;

    // Todo cambio de precio queda registrado con el valor anterior.
    if precio_antes != producto.precio_venta {
        tx.execute(
            "INSERT INTO precios_historial
               (producto_id, empaque_nombre, precio_anterior, precio_nuevo,
                motivo, usuario_id)
             VALUES (?1, NULL, ?2, ?3, 'Cambio manual', ?4)",
            params![id, precio_antes, producto.precio_venta, usuario_id],
        )?;
    }

    escribir_empaques(&tx, id, &producto.empaques, usuario_id)?;

    auditar(&tx, usuario_id, "EDITAR_PRODUCTO", id,
            &format!("{nombre_antes}: precio {precio_antes} -> {}", producto.precio_venta))?;

    tx.commit()?;
    Ok(())
}

/// Reemplaza los empaques enteros.
///
/// Es más simple y más seguro que casarlos uno por uno, y no hay
/// histórico que perder: cada venta guarda su propia copia del empaque.
fn escribir_empaques(
    tx: &Transaction,
    producto_id: i64,
    empaques: &[EmpaqueEditable],
    usuario_id: i64,
) -> Result<(), ErrorProducto> {
    // Los precios de antes, por nombre. Se comparan contra los que
    // entran para dejar anotado lo que cambio: subir el six de 25.000 a
    // 26.000 es un cambio de precio como cualquier otro, y hasta ahora
    // no quedaba en ninguna parte.
    //
    // Por nombre y no por id porque este mismo metodo borra los empaques
    // y los vuelve a insertar: los id cambian en cada edicion.
    let antes: std::collections::HashMap<String, Option<i64>> = {
        let mut c = tx.prepare(
            "SELECT nombre, precio_venta FROM producto_empaques WHERE producto_id = ?1",
        )?;
        let filas = c.query_map(params![producto_id], |f| {
            Ok((f.get::<_, String>(0)?, f.get::<_, Option<i64>>(1)?))
        })?;
        filas.collect::<Result<_, _>>()?
    };

    tx.execute(
        "DELETE FROM producto_empaques WHERE producto_id = ?1",
        params![producto_id],
    )?;

    // Si ninguno viene marcado, el primero manda: la caja necesita saber
    // cuál proponer.
    let hay_predeterminado = empaques.iter().any(|e| e.predeterminado && e.para_venta);

    for (indice, e) in empaques.iter().enumerate() {
        let predeterminado = if hay_predeterminado {
            e.predeterminado && e.para_venta
        } else {
            indice == 0 && e.para_venta
        };

        tx.execute(
            "INSERT INTO producto_empaques
               (producto_id, nombre, factor, precio_venta, para_venta, para_compra,
                predeterminado, orden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                producto_id, e.nombre.trim(), e.factor, e.precio_venta,
                i64::from(e.para_venta), i64::from(e.para_compra),
                i64::from(predeterminado), indice as i64,
            ],
        )?;

        // Solo si ya existia con otro precio. Una forma nueva no es un
        // cambio de precio: es un precio que antes no habia.
        let nombre = e.nombre.trim();
        if let Some(precio_antes) = antes.get(nombre) {
            if *precio_antes != e.precio_venta {
                if let Some(nuevo) = e.precio_venta {
                    tx.execute(
                        "INSERT INTO precios_historial
                           (producto_id, empaque_nombre, precio_anterior,
                            precio_nuevo, motivo, usuario_id)
                         VALUES (?1, ?2, ?3, ?4, 'Cambio manual', ?5)",
                        params![producto_id, nombre, precio_antes, nuevo, usuario_id],
                    )?;
                }
            }
        }
    }
    Ok(())
}

/// Ajuste manual de existencia. Siempre con motivo y siempre en el libro.
pub fn ajustar(
    conexion: &mut Connection,
    ajuste: &Ajuste,
) -> Result<ResultadoAjuste, ErrorProducto> {
    if ajuste.motivo.trim().is_empty() {
        return Err(ErrorProducto::FaltaMotivo);
    }
    if ajuste.cantidad == 0 {
        return Err(ErrorProducto::ExistenciaNegativa);
    }

    let tx = conexion.transaction()?;

    let datos: Option<(String, i64)> = tx
        .query_row(
            "SELECT nombre, existencia FROM productos WHERE id = ?1",
            params![ajuste.producto_id],
            |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .optional()?;
    let Some((nombre, antes)) = datos else {
        return Err(ErrorProducto::NoExiste);
    };

    let despues = antes + ajuste.cantidad;
    // Un ajuste manual sí se bloquea si deja negativo: a diferencia de una
    // venta, aquí nadie tiene la botella en la mano. Es puro conteo.
    if despues < 0 {
        return Err(ErrorProducto::ExistenciaNegativa);
    }

    tx.execute(
        "UPDATE productos SET existencia = ?2,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?1",
        params![ajuste.producto_id, despues],
    )?;

    tx.execute(
        "INSERT INTO movimientos_inventario
           (producto_id, tipo, cantidad_base, existencia_antes, existencia_despues,
            referencia_tipo, motivo, usuario_id)
         VALUES (?1, 'AJUSTE', ?2, ?3, ?4, 'MANUAL', ?5, ?6)",
        params![
            ajuste.producto_id, ajuste.cantidad, antes, despues,
            ajuste.motivo.trim(), ajuste.usuario_id,
        ],
    )?;

    auditar(
        &tx, ajuste.usuario_id, "AJUSTAR_INVENTARIO", ajuste.producto_id,
        &format!(
            "{nombre}: {antes} -> {despues} ({}{}). Motivo: {}",
            if ajuste.cantidad > 0 { "+" } else { "" },
            ajuste.cantidad,
            ajuste.motivo.trim()
        ),
    )?;

    tx.commit()?;

    Ok(ResultadoAjuste {
        producto: nombre,
        existencia_antes: antes,
        existencia_despues: despues,
    })
}

/// Deshace un ajuste manual que se hizo mal.
///
/// No borra nada: mete el movimiento contrario y deja los dos en el
/// libro, igual que anular una venta o una compra. El kardex termina
/// contando la verdad —«entraron 50, salieron 50, fue un error»— en vez
/// de fingir que nunca paso.
///
/// Solo se pueden deshacer ajustes manuales. Los movimientos de una venta
/// o una compra se arreglan anulando la venta o la compra, que ademas
/// devuelve la plata; deshacerlos por aqui dejaria el dinero descuadrado.
pub fn deshacer_ajuste(
    conexion: &mut Connection,
    movimiento_id: i64,
    motivo: &str,
    usuario_id: i64,
) -> Result<ResultadoAjuste, ErrorProducto> {
    if motivo.trim().is_empty() {
        return Err(ErrorProducto::FaltaMotivo);
    }

    let tx = conexion.transaction()?;

    let original: Option<(i64, i64, String, String)> = tx
        .query_row(
            "SELECT m.producto_id, m.cantidad_base, m.tipo,
                    COALESCE(m.motivo, '')
             FROM movimientos_inventario m
             WHERE m.id = ?1",
            params![movimiento_id],
            |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?)),
        )
        .optional()?;

    let Some((producto_id, cantidad, tipo, motivo_original)) = original else {
        return Err(ErrorProducto::NoExiste);
    };

    if tipo != "AJUSTE" {
        return Err(ErrorProducto::NoEsAjuste);
    }

    // Un ajuste ya deshecho no se puede deshacer dos veces: quedaria
    // aplicado al reves.
    let ya: i64 = tx.query_row(
        "SELECT COUNT(*) FROM movimientos_inventario
         WHERE referencia_tipo = 'MANUAL' AND referencia_id = ?1",
        params![movimiento_id],
        |f| f.get(0),
    )?;
    if ya > 0 {
        return Err(ErrorProducto::AjusteYaDeshecho);
    }

    let datos: Option<(String, i64)> = tx
        .query_row(
            "SELECT nombre, existencia FROM productos WHERE id = ?1",
            params![producto_id],
            |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .optional()?;
    let Some((nombre, antes)) = datos else {
        return Err(ErrorProducto::NoExiste);
    };

    let despues = antes - cantidad;
    // Deshacer un ajuste que sumaba puede dejar en negativo si ya se
    // vendio lo que entro de mas. Ahi no hay nada que deshacer: toca un
    // ajuste nuevo por lo que de verdad falta.
    if despues < 0 {
        return Err(ErrorProducto::ExistenciaNegativa);
    }

    tx.execute(
        "UPDATE productos SET existencia = ?2,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?1",
        params![producto_id, despues],
    )?;

    tx.execute(
        "INSERT INTO movimientos_inventario
           (producto_id, tipo, cantidad_base, existencia_antes, existencia_despues,
            referencia_tipo, referencia_id, motivo, usuario_id)
         VALUES (?1, 'AJUSTE', ?2, ?3, ?4, 'MANUAL', ?5, ?6, ?7)",
        params![
            producto_id, -cantidad, antes, despues, movimiento_id,
            format!("Deshace: {motivo_original}. {}", motivo.trim()),
            usuario_id,
        ],
    )?;

    auditar(
        &tx, usuario_id, "DESHACER_AJUSTE", producto_id,
        &format!(
            "{nombre}: {antes} -> {despues}. Se deshizo un ajuste de {}{cantidad}. Motivo: {}",
            if cantidad > 0 { "+" } else { "" },
            motivo.trim()
        ),
    )?;

    tx.commit()?;

    Ok(ResultadoAjuste {
        producto: nombre,
        existencia_antes: antes,
        existencia_despues: despues,
    })
}

/// Asocia un código de barras escaneado.
///
/// Un producto puede tener varios: la misma cerveza cambia de código
/// entre lotes, y conviene que los dos sigan funcionando en la caja.
pub fn agregar_codigo_barras(
    conexion: &Connection,
    producto_id: i64,
    codigo: &str,
    usuario_id: i64,
) -> Result<(), ErrorProducto> {
    let limpio = codigo.trim();
    if limpio.is_empty() {
        return Err(ErrorProducto::NombreVacio);
    }

    let duenio: Option<i64> = conexion
        .query_row(
            "SELECT producto_id FROM producto_codigos WHERE codigo = ?1 COLLATE NOCASE",
            params![limpio],
            |f| f.get(0),
        )
        .optional()?;

    match duenio {
        // Ya está en este mismo producto: no es un error, no hay nada que hacer.
        Some(id) if id == producto_id => return Ok(()),
        Some(_) => return Err(ErrorProducto::CodigoBarrasRepetido),
        None => {}
    }

    conexion.execute(
        "INSERT INTO producto_codigos (producto_id, codigo) VALUES (?1, ?2)",
        params![producto_id, limpio],
    )?;

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
         VALUES (?1, ?2, 'CODIGO_BARRAS', 'productos', ?3, ?4)",
        params![usuario_id, nombre, producto_id, format!("Se asocio el codigo {limpio}")],
    )?;
    Ok(())
}

pub fn quitar_codigo_barras(
    conexion: &Connection,
    codigo: &str,
) -> Result<(), ErrorProducto> {
    conexion.execute(
        "DELETE FROM producto_codigos WHERE codigo = ?1 COLLATE NOCASE",
        params![codigo.trim()],
    )?;
    Ok(())
}

/// Desactiva un producto. No se borra: sus ventas tienen que seguir
/// teniendo a qué apuntar.
pub fn desactivar(
    conexion: &Connection,
    producto_id: i64,
    usuario_id: i64,
) -> Result<(), ErrorProducto> {
    let nombre: Option<String> = conexion
        .query_row(
            "SELECT nombre FROM productos WHERE id = ?1",
            params![producto_id],
            |f| f.get(0),
        )
        .optional()?;
    let Some(nombre) = nombre else {
        return Err(ErrorProducto::NoExiste);
    };

    conexion.execute(
        "UPDATE productos SET activo = 0,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?1",
        params![producto_id],
    )?;

    let quien: String = conexion
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
         VALUES (?1, ?2, 'DESACTIVAR_PRODUCTO', 'productos', ?3, ?4)",
        params![usuario_id, quien, producto_id, format!("Se desactivo {nombre}")],
    )?;
    Ok(())
}

fn traducir_unicidad(error: rusqlite::Error, codigo: &str) -> ErrorProducto {
    match error {
        rusqlite::Error::SqliteFailure(e, _)
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            ErrorProducto::CodigoRepetido(codigo.to_owned())
        }
        otro => ErrorProducto::Sqlite(otro),
    }
}

fn auditar(
    tx: &Transaction,
    usuario_id: i64,
    accion: &str,
    entidad_id: i64,
    descripcion: &str,
) -> Result<(), ErrorProducto> {
    let nombre: String = tx
        .query_row(
            "SELECT nombre FROM usuarios WHERE id = ?1",
            params![usuario_id],
            |f| f.get(0),
        )
        .optional()?
        .unwrap_or_else(|| "desconocido".to_owned());

    tx.execute(
        "INSERT INTO auditoria
           (usuario_id, usuario_nombre, accion, entidad, entidad_id, descripcion)
         VALUES (?1, ?2, ?3, 'productos', ?4, ?5)",
        params![usuario_id, nombre, accion, entidad_id, descripcion],
    )?;
    Ok(())
}

/// Lo que queda de agregar una forma de mover el producto.
#[derive(Debug, Clone, Serialize)]
pub struct EmpaqueAgregado {
    pub id: i64,
    pub nombre: String,
    pub factor: i64,
    pub precio_venta: Option<i64>,
    pub para_venta: bool,
    pub para_compra: bool,
}

/// Agrega una forma de mover el producto sin tocar el resto de la ficha.
///
/// Existe para el momento en que llega mercancia en un empaque que el
/// producto no tenia. La canasta se conoce al recibirla, no antes: el
/// Excel del negocio solo trajo unidades y sixpacks, y mandar al dueño a
/// la ficha a mitad de una compra es la manera segura de que no lo haga y
/// termine registrando canastas como si fueran unidades.
///
/// El precio de venta es opcional. Una canasta puede servir solo para
/// comprar; para venderla hay que ponerle su precio, que nunca se calcula
/// a partir del de la unidad.
pub fn agregar_empaque(
    conexion: &Connection,
    producto_id: i64,
    nombre: &str,
    factor: i64,
    precio_venta: Option<i64>,
    para_venta: bool,
    para_compra: bool,
) -> Result<EmpaqueAgregado, ErrorProducto> {
    let nombre = nombre.trim();
    if nombre.is_empty() {
        return Err(ErrorProducto::NombreVacio);
    }
    if factor < 1 {
        return Err(ErrorProducto::FactorInvalido);
    }
    if precio_venta.is_some_and(|p| p <= 0) {
        return Err(ErrorProducto::PrecioInvalido);
    }

    let existe: i64 = conexion.query_row(
        "SELECT COUNT(*) FROM productos WHERE id = ?1",
        params![producto_id],
        |f| f.get(0),
    )?;
    if existe == 0 {
        return Err(ErrorProducto::NoExiste);
    }

    let repetido: i64 = conexion.query_row(
        "SELECT COUNT(*) FROM producto_empaques
         WHERE producto_id = ?1 AND nombre = ?2 COLLATE NOCASE AND activo = 1",
        params![producto_id, nombre],
        |f| f.get(0),
    )?;
    if repetido > 0 {
        return Err(ErrorProducto::EmpaqueRepetido);
    }

    // Al final de la lista, y el orden sigue al factor para que las
    // formas grandes queden abajo como en la ficha.
    let orden: i64 = conexion.query_row(
        "SELECT COALESCE(MAX(orden), 0) + 1 FROM producto_empaques WHERE producto_id = ?1",
        params![producto_id],
        |f| f.get(0),
    )?;

    conexion.execute(
        "INSERT INTO producto_empaques
           (producto_id, nombre, factor, precio_venta, para_venta, para_compra,
            predeterminado, orden, activo)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 1)",
        params![
            producto_id,
            nombre,
            factor,
            precio_venta,
            i64::from(para_venta && precio_venta.is_some()),
            i64::from(para_compra),
            orden
        ],
    )?;

    Ok(EmpaqueAgregado {
        id: conexion.last_insert_rowid(),
        nombre: nombre.to_owned(),
        factor,
        precio_venta,
        para_venta: para_venta && precio_venta.is_some(),
        para_compra,
    })
}

#[cfg(test)]
mod pruebas;
