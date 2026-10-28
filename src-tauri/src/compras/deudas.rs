//! Lo que se le debe a los proveedores.
//!
//! Bavaria deja la mercancía el martes y cobra el viernes. Hasta ahora
//! toda compra se anotaba como pagada de contado, así que no había forma
//! de saber cuánto se le debe a quién ni qué vence esta semana.
//!
//! Igual que con los fiados: el saldo no se guarda, se calcula restándole
//! los pagos al total de la compra. Y un pago en efectivo sale del cajón,
//! porque si no el arqueo encuentra plata de menos sin explicación.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use thiserror::Error;

use crate::caja;

#[derive(Debug, Error)]
pub enum ErrorDeuda {
    #[error("esa compra no existe")]
    NoExiste,
    #[error("esa compra está anulada")]
    Anulada,
    #[error("el pago tiene que ser mayor que cero")]
    MontoInvalido,
    #[error("el pago es mayor que lo que se debe")]
    PagoExcesivo { saldo: i64, pago: i64 },
    #[error("la fecha tiene que ser como 2026-08-21")]
    FechaInvalida,
    #[error("ese pago ya está anulado")]
    YaAnulado,
    #[error("hay que decir por qué se anula")]
    FaltaMotivo,
    #[error("no hay una caja abierta de donde sacar el efectivo")]
    SinCaja,
    #[error("error de base de datos")]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, Serialize)]
pub struct DeudaCompra {
    pub compra_id: i64,
    pub numero: String,
    pub proveedor_id: i64,
    pub proveedor: String,
    pub documento: Option<String>,
    pub fecha: String,
    pub vence: Option<String>,
    pub total: i64,
    pub pagado: i64,
    pub saldo: i64,
    /// Días que lleva vencida. Negativo si todavía no vence, `None` si no
    /// se le puso fecha.
    pub vencida_hace: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SaldoProveedor {
    pub proveedor_id: i64,
    pub nombre: String,
    pub comprado: i64,
    pub pagado: i64,
    pub saldo: i64,
    pub compras: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PagoHecho {
    pub id: i64,
    pub compra_id: i64,
    pub fecha: String,
    pub monto: i64,
    pub metodo: Option<String>,
    pub usuario: String,
    pub nota: Option<String>,
    pub anulado: bool,
}

fn fecha_valida(fecha: &str) -> bool {
    let b = fecha.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

/// Marca una compra como recibida a crédito, con su fecha de pago.
pub fn dejar_a_credito(
    conexion: &Connection,
    compra_id: i64,
    vence: Option<&str>,
) -> Result<(), ErrorDeuda> {
    if let Some(v) = vence {
        if !fecha_valida(v) {
            return Err(ErrorDeuda::FechaInvalida);
        }
    }

    let cambiadas = conexion.execute(
        "UPDATE compras SET a_credito = 1, vence = ?1
         WHERE id = ?2 AND estado = 'REGISTRADA'",
        params![vence, compra_id],
    )?;
    if cambiadas == 0 {
        return Err(ErrorDeuda::NoExiste);
    }
    Ok(())
}

fn saldo_de(conexion: &Connection, compra_id: i64) -> Result<i64, ErrorDeuda> {
    let fila: Option<(i64, i64, String)> = conexion
        .query_row(
            "SELECT c.total,
                    COALESCE((SELECT SUM(p.monto) FROM pagos_compra p
                              WHERE p.compra_id = c.id AND p.anulado = 0), 0),
                    c.estado
             FROM compras c WHERE c.id = ?1",
            params![compra_id],
            |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)),
        )
        .optional()?;
    let (total, pagado, estado) = fila.ok_or(ErrorDeuda::NoExiste)?;
    if estado == "ANULADA" {
        return Err(ErrorDeuda::Anulada);
    }
    Ok(total - pagado)
}

/// Paga —entera o en partes— una compra a crédito.
///
/// El efectivo sale de la caja abierta. Sin caja no se recibe el pago en
/// efectivo: anotarlo por fuera dejaría el arqueo con plata de menos y
/// nadie sabría por qué.
pub fn pagar(
    conexion: &mut Connection,
    compra_id: i64,
    monto: i64,
    fecha: &str,
    metodo_pago_id: Option<i64>,
    usuario_id: i64,
    nota: Option<&str>,
) -> Result<i64, ErrorDeuda> {
    if monto <= 0 {
        return Err(ErrorDeuda::MontoInvalido);
    }
    if !fecha_valida(fecha) {
        return Err(ErrorDeuda::FechaInvalida);
    }

    let saldo = saldo_de(conexion, compra_id)?;
    if monto > saldo {
        return Err(ErrorDeuda::PagoExcesivo { saldo, pago: monto });
    }

    let es_efectivo: bool = metodo_pago_id
        .and_then(|id| {
            conexion
                .query_row(
                    "SELECT es_efectivo FROM metodos_pago WHERE id = ?1",
                    params![id],
                    |f| f.get::<_, i64>(0),
                )
                .ok()
        })
        .is_some_and(|v| v == 1);

    let caja_id = if es_efectivo {
        Some(
            caja::exigir_abierta(conexion)
                .map_err(|_| ErrorDeuda::SinCaja)?
                .id,
        )
    } else {
        None
    };

    let numero: String = conexion.query_row(
        "SELECT numero FROM compras WHERE id = ?1",
        params![compra_id],
        |f| f.get(0),
    )?;

    let tx = conexion.transaction()?;
    tx.execute(
        "INSERT INTO pagos_compra
           (compra_id, monto, fecha, metodo_pago_id, usuario_id, nota)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            compra_id,
            monto,
            fecha,
            metodo_pago_id,
            usuario_id,
            nota.map(str::trim).filter(|n| !n.is_empty())
        ],
    )?;
    let pago_id = tx.last_insert_rowid();

    if let Some(caja) = caja_id {
        tx.execute(
            "INSERT INTO movimientos_caja
               (caja_id, tipo, concepto, monto, referencia_tipo, referencia_id, usuario_id)
             VALUES (?1, 'SALIDA', ?2, ?3, 'COMPRA', ?4, ?5)",
            params![
                caja,
                format!("Pago de la compra {numero}"),
                monto,
                compra_id,
                usuario_id
            ],
        )?;
    }
    tx.commit()?;
    Ok(pago_id)
}

/// Anula un pago mal anotado y devuelve la plata al cajón.
pub fn anular_pago(
    conexion: &mut Connection,
    pago_id: i64,
    motivo: &str,
    usuario_id: i64,
) -> Result<(), ErrorDeuda> {
    if motivo.trim().is_empty() {
        return Err(ErrorDeuda::FaltaMotivo);
    }

    let fila: Option<(i64, i64, i64, Option<i64>)> = conexion
        .query_row(
            "SELECT p.anulado, p.monto, p.compra_id,
                    (SELECT m.id FROM metodos_pago m
                     WHERE m.id = p.metodo_pago_id AND m.es_efectivo = 1)
             FROM pagos_compra p WHERE p.id = ?1",
            params![pago_id],
            |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?)),
        )
        .optional()?;
    let (anulado, monto, compra_id, era_efectivo) = fila.ok_or(ErrorDeuda::NoExiste)?;
    if anulado == 1 {
        return Err(ErrorDeuda::YaAnulado);
    }

    // La plata vuelve a la caja que este abierta ahora, que puede no ser
    // la misma en que salio.
    let caja_id = if era_efectivo.is_some() {
        Some(
            caja::exigir_abierta(conexion)
                .map_err(|_| ErrorDeuda::SinCaja)?
                .id,
        )
    } else {
        None
    };

    let numero: String = conexion.query_row(
        "SELECT numero FROM compras WHERE id = ?1",
        params![compra_id],
        |f| f.get(0),
    )?;

    let tx = conexion.transaction()?;
    tx.execute(
        "UPDATE pagos_compra SET anulado = 1 WHERE id = ?1",
        params![pago_id],
    )?;

    if let Some(caja) = caja_id {
        tx.execute(
            "INSERT INTO movimientos_caja
               (caja_id, tipo, concepto, monto, referencia_tipo, referencia_id, usuario_id)
             VALUES (?1, 'ENTRADA', ?2, ?3, 'ANULACION', ?4, ?5)",
            params![
                caja,
                format!("Se anuló un pago de la compra {numero}: {}", motivo.trim()),
                monto,
                pago_id,
                usuario_id
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Las compras que quedan debiendo, de la más vencida a la más nueva.
pub fn pendientes(conexion: &Connection) -> Result<Vec<DeudaCompra>, ErrorDeuda> {
    let mut consulta = conexion.prepare(
        "SELECT c.id, c.numero, c.proveedor_id, p.nombre, c.documento, c.fecha,
                c.vence, c.total,
                COALESCE((SELECT SUM(pc.monto) FROM pagos_compra pc
                          WHERE pc.compra_id = c.id AND pc.anulado = 0), 0),
                CASE WHEN c.vence IS NULL THEN NULL
                     ELSE CAST(julianday(date('now', 'localtime'))
                               - julianday(c.vence) AS INTEGER) END
         FROM compras c
         JOIN proveedores p ON p.id = c.proveedor_id
         WHERE c.estado = 'REGISTRADA' AND c.a_credito = 1
           AND c.total > COALESCE((SELECT SUM(pc.monto) FROM pagos_compra pc
                                   WHERE pc.compra_id = c.id AND pc.anulado = 0), 0)
         ORDER BY c.vence IS NULL, c.vence, c.id",
    )?;
    let filas = consulta
        .query_map([], |f| {
            let total: i64 = f.get(7)?;
            let pagado: i64 = f.get(8)?;
            Ok(DeudaCompra {
                compra_id: f.get(0)?,
                numero: f.get(1)?,
                proveedor_id: f.get(2)?,
                proveedor: f.get(3)?,
                documento: f.get(4)?,
                fecha: f.get(5)?,
                vence: f.get(6)?,
                total,
                pagado,
                saldo: total - pagado,
                vencida_hace: f.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

/// Cuánto se le debe a cada proveedor.
pub fn por_proveedor(conexion: &Connection) -> Result<Vec<SaldoProveedor>, ErrorDeuda> {
    let mut consulta = conexion.prepare(
        "SELECT proveedor_id, nombre, comprado, pagado, saldo, compras
         FROM saldos_proveedores
         WHERE saldo > 0
         ORDER BY saldo DESC",
    )?;
    let filas = consulta
        .query_map([], |f| {
            Ok(SaldoProveedor {
                proveedor_id: f.get(0)?,
                nombre: f.get(1)?,
                comprado: f.get(2)?,
                pagado: f.get(3)?,
                saldo: f.get(4)?,
                compras: f.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

/// Los pagos hechos contra una compra, del más nuevo al más viejo.
pub fn pagos_de(conexion: &Connection, compra_id: i64) -> Result<Vec<PagoHecho>, ErrorDeuda> {
    let mut consulta = conexion.prepare(
        "SELECT p.id, p.compra_id, p.fecha, p.monto, m.nombre,
                COALESCE(u.nombre, ''), p.nota, p.anulado
         FROM pagos_compra p
         LEFT JOIN metodos_pago m ON m.id = p.metodo_pago_id
         LEFT JOIN usuarios u ON u.id = p.usuario_id
         WHERE p.compra_id = ?1
         ORDER BY p.id DESC",
    )?;
    let filas = consulta
        .query_map(params![compra_id], |f| {
            Ok(PagoHecho {
                id: f.get(0)?,
                compra_id: f.get(1)?,
                fecha: f.get(2)?,
                monto: f.get(3)?,
                metodo: f.get(4)?,
                usuario: f.get(5)?,
                nota: f.get(6)?,
                anulado: f.get::<_, i64>(7)? == 1,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

#[cfg(test)]
mod pruebas;
