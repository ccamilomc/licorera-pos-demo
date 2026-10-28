//! Compras a proveedores.
//!
//! Registrar una compra hace tres cosas a la vez: guarda la factura, sube
//! la existencia y actualiza el costo. Las tres en una transaccion.
//!
//! Aqui es donde el sistema aprende cuanto cuestan las cosas. El Excel
//! del negocio traia precios de proveedor mezclando caja y unidad sin
//! decir cuantas unidades trae el empaque, asi que el costo unitario no
//! se podia calcular. Al recibir mercancia ese dato aparece solo: se
//! compran 2 canastas de 30 a 59.000 cada una, y de ahi sale que la
//! botella cuesta 1.967.

pub mod deudas;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum ErrorCompra {
    #[error("la compra no tiene productos")]
    CompraVacia,
    #[error("el producto {0} no existe")]
    ProductoInvalido(i64),
    #[error("la cantidad debe ser mayor que cero")]
    CantidadInvalida,
    #[error("el costo no puede ser negativo")]
    CostoInvalido,
    #[error("el proveedor no existe")]
    ProveedorInvalido,
    #[error("la compra ya estaba anulada")]
    YaAnulada,
    #[error("la compra no existe")]
    NoExiste,
    #[error("error de base de datos")]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, Deserialize)]
pub struct ItemCompra {
    pub producto_id: i64,
    pub empaque_id: Option<i64>,
    /// Cuantos empaques se recibieron: 2 canastas, 10 cajetillas.
    pub cantidad: i64,
    /// Lo que costo cada empaque completo.
    pub costo_empaque: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompraEntrante {
    pub proveedor_id: i64,
    pub documento: Option<String>,
    pub fecha: String,
    pub items: Vec<ItemCompra>,
    #[serde(default)]
    pub descuento: i64,
    pub usuario_id: i64,
    #[serde(default)]
    pub notas: Option<String>,
    /// El proveedor dejó la mercancía y cobra después.
    #[serde(default)]
    pub a_credito: bool,
    /// Cuándo hay que pagarla. Solo tiene sentido a crédito.
    #[serde(default)]
    pub vence: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompraRegistrada {
    pub id: i64,
    pub numero: String,
    pub subtotal: i64,
    pub descuento: i64,
    pub total: i64,
    pub unidades: i64,
    pub items: Vec<ItemRecibido>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ItemRecibido {
    pub producto: String,
    pub empaque: String,
    pub cantidad: i64,
    pub unidades: i64,
    pub costo_unitario: i64,
    /// Cuanto se gana vendiendo, en porcentaje sobre el precio de venta.
    pub margen: Option<i64>,
}

pub fn registrar(
    conexion: &mut Connection,
    entrante: &CompraEntrante,
) -> Result<CompraRegistrada, ErrorCompra> {
    if entrante.items.is_empty() {
        return Err(ErrorCompra::CompraVacia);
    }
    if entrante.items.iter().any(|i| i.cantidad <= 0) {
        return Err(ErrorCompra::CantidadInvalida);
    }
    if entrante.items.iter().any(|i| i.costo_empaque < 0) || entrante.descuento < 0 {
        return Err(ErrorCompra::CostoInvalido);
    }

    let existe_proveedor: bool = conexion
        .query_row(
            "SELECT 1 FROM proveedores WHERE id = ?1 AND activo = 1",
            params![entrante.proveedor_id],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if !existe_proveedor {
        return Err(ErrorCompra::ProveedorInvalido);
    }

    let tx = conexion.transaction()?;
    let numero = siguiente_numero(&tx)?;

    tx.execute(
        "INSERT INTO compras
           (numero, proveedor_id, documento, fecha, subtotal, descuento, total,
            notas, usuario_id, a_credito, vence)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, 0, ?6, ?7, ?8, ?9)",
        params![
            numero, entrante.proveedor_id, entrante.documento, entrante.fecha,
            entrante.descuento, entrante.notas, entrante.usuario_id,
            i64::from(entrante.a_credito),
            // La fecha de pago solo se guarda si de verdad queda debiendo.
            entrante.vence.as_deref().filter(|_| entrante.a_credito),
        ],
    )?;
    let compra_id = tx.last_insert_rowid();

    let mut subtotal = 0;
    let mut unidades_totales = 0;
    let mut recibidos = Vec::with_capacity(entrante.items.len());

    for item in &entrante.items {
        let (nombre, precio_venta) = datos_producto(&tx, item.producto_id)?;
        let (empaque_id, nombre_empaque, factor) = resolver_empaque(&tx, item)?;

        let unidades = item.cantidad * factor;
        // Reparto entero, truncando. El resto es de centavos —una canasta
        // de 60.001 entre 30 pierde tres centavos en total— y ese sobrante
        // se queda fuera del costo, con lo que la utilidad reportada sale
        // un pelo mas alta que la real. Se acepta a proposito: cuadrar el
        // centavo obligaria a repartir el resto entre las unidades y a
        // llevar costos distintos para botellas de la misma canasta, que
        // es mucho lio para menos de un peso.
        let costo_unitario = item.costo_empaque / factor;
        let total_item = item.cantidad * item.costo_empaque;

        tx.execute(
            "INSERT INTO compra_items
               (compra_id, producto_id, empaque_id, cantidad_empaques, factor,
                cantidad_base, costo_empaque, costo_unitario, total)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                compra_id, item.producto_id, empaque_id, item.cantidad, factor,
                unidades, item.costo_empaque, costo_unitario, total_item,
            ],
        )?;

        entrar_al_inventario(&tx, item.producto_id, unidades, empaque_id,
                             item.cantidad, compra_id, &numero, entrante.usuario_id)?;
        actualizar_costo(&tx, item.producto_id, costo_unitario, unidades)?;
        recordar_precio_proveedor(&tx, entrante.proveedor_id, item.producto_id,
                                  empaque_id, item.costo_empaque)?;

        subtotal += total_item;
        unidades_totales += unidades;

        recibidos.push(ItemRecibido {
            producto: nombre,
            empaque: nombre_empaque,
            cantidad: item.cantidad,
            unidades,
            costo_unitario,
            margen: margen(precio_venta, costo_unitario),
        });
    }

    let total = subtotal - entrante.descuento;
    tx.execute(
        "UPDATE compras SET subtotal = ?2, total = ?3 WHERE id = ?1",
        params![compra_id, subtotal, total],
    )?;

    registrar_auditoria(
        &tx, entrante.usuario_id, "REGISTRAR_COMPRA", compra_id,
        &format!("Compra {numero} por {}: {unidades_totales} unidades", crate::formato::pesos(total)),
    )?;

    tx.commit()?;

    Ok(CompraRegistrada {
        id: compra_id,
        numero,
        subtotal,
        descuento: entrante.descuento,
        total,
        unidades: unidades_totales,
        items: recibidos,
    })
}

/// Margen sobre el precio de venta, en porcentaje entero.
fn margen(precio_venta: i64, costo: i64) -> Option<i64> {
    if precio_venta <= 0 || costo <= 0 {
        return None;
    }
    Some(((precio_venta - costo) * 100) / precio_venta)
}

fn datos_producto(tx: &Transaction, id: i64) -> Result<(String, i64), ErrorCompra> {
    tx.query_row(
        "SELECT nombre, precio_venta FROM productos WHERE id = ?1 AND activo = 1",
        params![id],
        |f| Ok((f.get(0)?, f.get(1)?)),
    )
    .optional()?
    .ok_or(ErrorCompra::ProductoInvalido(id))
}

fn resolver_empaque(
    tx: &Transaction,
    item: &ItemCompra,
) -> Result<(Option<i64>, String, i64), ErrorCompra> {
    let Some(id) = item.empaque_id else {
        // Sin empaque se compra por unidad.
        return Ok((None, "Unidad".to_owned(), 1));
    };

    let fila: Option<(String, i64)> = tx
        .query_row(
            "SELECT nombre, factor FROM producto_empaques
             WHERE id = ?1 AND producto_id = ?2 AND activo = 1",
            params![id, item.producto_id],
            |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .optional()?;

    match fila {
        Some((nombre, factor)) => Ok((Some(id), nombre, factor)),
        None => Ok((None, "Unidad".to_owned(), 1)),
    }
}

#[allow(clippy::too_many_arguments)]
fn entrar_al_inventario(
    tx: &Transaction,
    producto_id: i64,
    unidades: i64,
    empaque_id: Option<i64>,
    cantidad_empaques: i64,
    compra_id: i64,
    numero: &str,
    usuario_id: i64,
) -> Result<(), ErrorCompra> {
    // Se lee dentro de la transaccion, igual que en las ventas: una
    // compra puede traer el mismo producto en dos renglones.
    let antes: i64 = tx.query_row(
        "SELECT existencia FROM productos WHERE id = ?1",
        params![producto_id],
        |f| f.get(0),
    )?;
    let despues = antes + unidades;

    tx.execute(
        "UPDATE productos SET existencia = ?2,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?1",
        params![producto_id, despues],
    )?;

    tx.execute(
        "INSERT INTO movimientos_inventario
           (producto_id, tipo, cantidad_base, empaque_id, cantidad_empaques,
            existencia_antes, existencia_despues, referencia_tipo, referencia_id,
            motivo, usuario_id)
         VALUES (?1, 'COMPRA', ?2, ?3, ?4, ?5, ?6, 'COMPRA', ?7, ?8, ?9)",
        params![
            producto_id, unidades, empaque_id, cantidad_empaques,
            antes, despues, compra_id, format!("Compra {numero}"), usuario_id,
        ],
    )?;
    Ok(())
}

/// Actualiza el ultimo costo y el promedio ponderado.
///
/// El promedio pondera por unidades, no por compras: recibir 300 botellas
/// a 2.000 pesa mas que haber recibido 6 a 2.500 el mes pasado.
fn actualizar_costo(
    tx: &Transaction,
    producto_id: i64,
    costo_unitario: i64,
    unidades: i64,
) -> Result<(), ErrorCompra> {
    let (existencia, promedio): (i64, Option<i64>) = tx.query_row(
        "SELECT existencia, costo_promedio FROM productos WHERE id = ?1",
        params![producto_id],
        |f| Ok((f.get(0)?, f.get(1)?)),
    )?;

    // `existencia` ya incluye lo que acaba de entrar.
    let anteriores = existencia - unidades;
    let nuevo_promedio = match promedio {
        Some(anterior) if anteriores > 0 => {
            ((anterior * anteriores) + (costo_unitario * unidades)) / existencia.max(1)
        }
        _ => costo_unitario,
    };

    tx.execute(
        "UPDATE productos SET costo_ultimo = ?2, costo_promedio = ?3 WHERE id = ?1",
        params![producto_id, costo_unitario, nuevo_promedio],
    )?;
    Ok(())
}

/// Guarda a que precio vende cada proveedor, para poder compararlos.
fn recordar_precio_proveedor(
    tx: &Transaction,
    proveedor_id: i64,
    producto_id: i64,
    empaque_id: Option<i64>,
    precio: i64,
) -> Result<(), ErrorCompra> {
    tx.execute(
        "INSERT INTO proveedor_productos (proveedor_id, producto_id, empaque_id, precio)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (proveedor_id, producto_id, empaque_id)
         DO UPDATE SET precio = ?4,
                       fecha_precio = strftime('%Y-%m-%dT%H:%M:%SZ','now')",
        params![proveedor_id, producto_id, empaque_id, precio],
    )?;
    Ok(())
}

fn siguiente_numero(tx: &Transaction) -> Result<String, ErrorCompra> {
    let cuenta: i64 = tx
        .query_row("SELECT COUNT(*) FROM compras", [], |f| f.get(0))
        .unwrap_or(0);
    Ok(format!("C-{:05}", cuenta + 1))
}

/// Anula una compra: saca la mercancia que habia entrado.
///
/// No se borra: queda anulada y con su rastro, igual que las ventas.
pub fn anular(
    conexion: &mut Connection,
    compra_id: i64,
    motivo: &str,
    usuario_id: i64,
) -> Result<(), ErrorCompra> {
    let estado: Option<String> = conexion
        .query_row(
            "SELECT estado FROM compras WHERE id = ?1",
            params![compra_id],
            |f| f.get(0),
        )
        .optional()?;

    match estado.as_deref() {
        None => return Err(ErrorCompra::NoExiste),
        Some("ANULADA") => return Err(ErrorCompra::YaAnulada),
        _ => {}
    }

    let tx = conexion.transaction()?;

    let numero: String = tx.query_row(
        "SELECT numero FROM compras WHERE id = ?1",
        params![compra_id],
        |f| f.get(0),
    )?;

    let mut consulta = tx.prepare(
        "SELECT producto_id, cantidad_base, empaque_id, cantidad_empaques
         FROM compra_items WHERE compra_id = ?1",
    )?;
    let items: Vec<(i64, i64, Option<i64>, i64)> = consulta
        .query_map(params![compra_id], |f| {
            Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(consulta);

    for (producto_id, unidades, empaque_id, cantidad_empaques) in items {
        entrar_al_inventario(
            &tx, producto_id, -unidades, empaque_id, cantidad_empaques,
            compra_id, &format!("{numero} anulada"), usuario_id,
        )?;
    }

    tx.execute(
        "UPDATE compras SET estado = 'ANULADA', notas = ?2 WHERE id = ?1",
        params![compra_id, motivo],
    )?;

    registrar_auditoria(
        &tx, usuario_id, "ANULAR_COMPRA", compra_id,
        &format!("Anulacion de la compra {numero}: {motivo}"),
    )?;

    tx.commit()?;
    Ok(())
}

fn registrar_auditoria(
    tx: &Transaction,
    usuario_id: i64,
    accion: &str,
    entidad_id: i64,
    descripcion: &str,
) -> Result<(), ErrorCompra> {
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
         VALUES (?1, ?2, ?3, 'compras', ?4, ?5)",
        params![usuario_id, nombre, accion, entidad_id, descripcion],
    )?;
    Ok(())
}

#[cfg(test)]
mod pruebas;
