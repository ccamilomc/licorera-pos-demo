//! Fiados: lo que los clientes deben.
//!
//! «Me lo apunta» es medio negocio en una licorera de barrio. Antes esa
//! venta se registraba como cualquier otra, así que el arqueo esperaba
//! encontrar en el cajón una plata que nadie había entregado y el cierre
//! salía descuadrado todos los días.
//!
//! Fiado es un método de pago que no es efectivo, más una cuenta a nombre
//! de alguien. El saldo **no se guarda**: se calcula restándole los abonos
//! al total. Un saldo guardado se desincroniza el día que alguien anule un
//! abono, y ahí el sistema y el cuaderno del dueño dicen cosas distintas.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::caja;

/// Código del método de pago que deja la venta debiendo.
pub const METODO_FIADO: &str = "FIADO";

#[derive(Debug, Error)]
pub enum ErrorFiado {
    #[error("hay que decir cómo se llama el cliente")]
    NombreVacio,
    #[error("ese cliente no existe")]
    ClienteNoExiste,
    #[error("esa cuenta no existe")]
    CuentaNoExiste,
    #[error("el abono tiene que ser mayor que cero")]
    MontoInvalido,
    #[error("el abono es mayor que lo que se debe")]
    AbonoExcesivo { saldo: i64, abono: i64 },
    #[error("una venta fiada necesita saber a nombre de quién")]
    FaltaCliente,
    #[error("el cliente está inactivo")]
    ClienteInactivo,
    #[error("se pasa del cupo del cliente")]
    SinCupo { cupo: i64, quedaria: i64 },
    #[error("ese abono ya está anulado")]
    AbonoYaAnulado,
    #[error("hay que decir por qué se anula")]
    FaltaMotivo,
    #[error("el cliente tiene saldo pendiente")]
    ConSaldo,
    #[error("no hay una caja abierta para recibir el abono")]
    SinCaja,
    #[error("error de base de datos")]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClienteEditable {
    pub id: Option<i64>,
    pub nombre: String,
    pub telefono: Option<String>,
    pub documento: Option<String>,
    pub nota: Option<String>,
    /// Hasta cuánto se le fía. 0 es sin tope.
    pub cupo: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClienteConSaldo {
    pub id: i64,
    pub nombre: String,
    pub telefono: Option<String>,
    pub documento: Option<String>,
    pub nota: Option<String>,
    pub cupo: i64,
    pub activo: bool,
    pub fiado: i64,
    pub abonado: i64,
    pub saldo: i64,
    pub cuentas: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CuentaCliente {
    pub id: i64,
    pub venta_id: i64,
    pub venta_numero: i64,
    pub fecha: String,
    pub monto: i64,
    pub abonado: i64,
    pub saldo: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AbonoHecho {
    pub id: i64,
    pub cuenta_id: i64,
    pub fecha: String,
    pub monto: i64,
    pub metodo: String,
    pub usuario: String,
    pub nota: Option<String>,
    pub anulado: bool,
}

/// Lo que queda de recibir un abono.
#[derive(Debug, Clone, Serialize)]
pub struct ResultadoAbono {
    pub abono_id: i64,
    pub saldo_cuenta: i64,
    pub saldo_cliente: i64,
    /// Si entró al cajón. Un abono por transferencia no toca la caja.
    pub entro_a_caja: bool,
}

fn limpio(texto: &Option<String>) -> Option<String> {
    texto
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

pub fn crear_cliente(conexion: &Connection, c: &ClienteEditable) -> Result<i64, ErrorFiado> {
    let nombre = c.nombre.trim();
    if nombre.is_empty() {
        return Err(ErrorFiado::NombreVacio);
    }
    if c.cupo < 0 {
        return Err(ErrorFiado::MontoInvalido);
    }

    conexion.execute(
        "INSERT INTO clientes (nombre, telefono, documento, nota, cupo)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            nombre,
            limpio(&c.telefono),
            limpio(&c.documento),
            limpio(&c.nota),
            c.cupo
        ],
    )?;
    Ok(conexion.last_insert_rowid())
}

pub fn editar_cliente(conexion: &Connection, c: &ClienteEditable) -> Result<(), ErrorFiado> {
    let id = c.id.ok_or(ErrorFiado::ClienteNoExiste)?;
    let nombre = c.nombre.trim();
    if nombre.is_empty() {
        return Err(ErrorFiado::NombreVacio);
    }
    if c.cupo < 0 {
        return Err(ErrorFiado::MontoInvalido);
    }

    let cambiadas = conexion.execute(
        "UPDATE clientes SET nombre = ?1, telefono = ?2, documento = ?3,
                             nota = ?4, cupo = ?5
         WHERE id = ?6",
        params![
            nombre,
            limpio(&c.telefono),
            limpio(&c.documento),
            limpio(&c.nota),
            c.cupo,
            id
        ],
    )?;
    if cambiadas == 0 {
        return Err(ErrorFiado::ClienteNoExiste);
    }
    Ok(())
}

/// Da de baja a un cliente. No lo borra: sus ventas siguen siendo suyas.
///
/// Con saldo pendiente se niega. Desactivar a alguien que debe es la forma
/// de perder de vista una deuda.
pub fn desactivar_cliente(conexion: &Connection, id: i64) -> Result<(), ErrorFiado> {
    let saldo: Option<i64> = conexion
        .query_row(
            "SELECT saldo FROM saldos_clientes WHERE cliente_id = ?1",
            params![id],
            |f| f.get(0),
        )
        .optional()?;
    let saldo = saldo.ok_or(ErrorFiado::ClienteNoExiste)?;
    if saldo > 0 {
        return Err(ErrorFiado::ConSaldo);
    }

    conexion.execute("UPDATE clientes SET activo = 0 WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn reactivar_cliente(conexion: &Connection, id: i64) -> Result<(), ErrorFiado> {
    let cambiadas = conexion.execute(
        "UPDATE clientes SET activo = 1 WHERE id = ?1",
        params![id],
    )?;
    if cambiadas == 0 {
        return Err(ErrorFiado::ClienteNoExiste);
    }
    Ok(())
}

/// Todos los clientes con lo que deben.
///
/// Los que no deben nada vienen también: hace falta poder elegirlos al
/// fiar, no solo cuando ya deben.
pub fn clientes(conexion: &Connection) -> Result<Vec<ClienteConSaldo>, ErrorFiado> {
    let mut consulta = conexion.prepare(
        "SELECT s.cliente_id, s.nombre, c.telefono, c.documento, c.nota,
                s.cupo, s.activo, s.fiado, s.abonado, s.saldo, s.cuentas
         FROM saldos_clientes s
         JOIN clientes c ON c.id = s.cliente_id
         ORDER BY s.saldo DESC, s.nombre",
    )?;
    let filas = consulta
        .query_map([], |f| {
            Ok(ClienteConSaldo {
                id: f.get(0)?,
                nombre: f.get(1)?,
                telefono: f.get(2)?,
                documento: f.get(3)?,
                nota: f.get(4)?,
                cupo: f.get(5)?,
                activo: f.get::<_, i64>(6)? == 1,
                fiado: f.get(7)?,
                abonado: f.get(8)?,
                saldo: f.get(9)?,
                cuentas: f.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

// ---------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------

/// Deja una venta debiendo a nombre de alguien.
///
/// La llama `ventas::registrar` dentro de su propia transacción, para que
/// una venta fiada no pueda quedar registrada sin su cuenta.
pub fn anotar_cuenta(
    tx: &rusqlite::Transaction,
    venta_id: i64,
    cliente_id: i64,
    monto: i64,
) -> Result<i64, ErrorFiado> {
    if monto <= 0 {
        return Err(ErrorFiado::MontoInvalido);
    }

    let cliente: Option<(i64, i64)> = tx
        .query_row(
            "SELECT c.activo, COALESCE(s.saldo, 0)
             FROM clientes c
             LEFT JOIN saldos_clientes s ON s.cliente_id = c.id
             WHERE c.id = ?1",
            params![cliente_id],
            |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .optional()?;
    let (activo, saldo) = cliente.ok_or(ErrorFiado::ClienteNoExiste)?;
    if activo == 0 {
        return Err(ErrorFiado::ClienteInactivo);
    }

    let cupo: i64 = tx.query_row(
        "SELECT cupo FROM clientes WHERE id = ?1",
        params![cliente_id],
        |f| f.get(0),
    )?;
    if cupo > 0 && saldo + monto > cupo {
        return Err(ErrorFiado::SinCupo {
            cupo,
            quedaria: saldo + monto,
        });
    }

    tx.execute(
        "INSERT INTO cuentas_cobrar (venta_id, cliente_id, monto)
         VALUES (?1, ?2, ?3)",
        params![venta_id, cliente_id, monto],
    )?;
    Ok(tx.last_insert_rowid())
}

/// La deuda se va con la venta anulada.
pub fn anular_cuenta_de_venta(
    tx: &rusqlite::Transaction,
    venta_id: i64,
) -> Result<(), ErrorFiado> {
    tx.execute(
        "UPDATE cuentas_cobrar SET anulada = 1 WHERE venta_id = ?1",
        params![venta_id],
    )?;
    Ok(())
}

/// Lo que un cliente debe, cuenta por cuenta, de lo más viejo a lo más nuevo.
///
/// De lo más viejo primero porque es el orden en que se cobra.
pub fn cuentas_de(
    conexion: &Connection,
    cliente_id: i64,
    solo_pendientes: bool,
) -> Result<Vec<CuentaCliente>, ErrorFiado> {
    let filtro = if solo_pendientes {
        "AND cu.monto > COALESCE((SELECT SUM(a.monto) FROM abonos a
                                  WHERE a.cuenta_id = cu.id AND a.anulado = 0), 0)"
    } else {
        ""
    };
    let mut consulta = conexion.prepare(&format!(
        "SELECT cu.id, cu.venta_id, v.numero,
                strftime('%Y-%m-%d %H:%M', v.created_at, 'localtime'),
                cu.monto,
                COALESCE((SELECT SUM(a.monto) FROM abonos a
                          WHERE a.cuenta_id = cu.id AND a.anulado = 0), 0)
         FROM cuentas_cobrar cu
         JOIN ventas v ON v.id = cu.venta_id
         WHERE cu.cliente_id = ?1 AND cu.anulada = 0 {filtro}
         ORDER BY cu.id"
    ))?;
    let filas = consulta
        .query_map(params![cliente_id], |f| {
            let monto: i64 = f.get(4)?;
            let abonado: i64 = f.get(5)?;
            Ok(CuentaCliente {
                id: f.get(0)?,
                venta_id: f.get(1)?,
                venta_numero: f.get(2)?,
                fecha: f.get(3)?,
                monto,
                abonado,
                saldo: monto - abonado,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(filas)
}

/// Cuánto falta por pagar de una cuenta.
fn saldo_de_cuenta(conexion: &Connection, cuenta_id: i64) -> Result<i64, ErrorFiado> {
    let fila: Option<(i64, i64, i64)> = conexion
        .query_row(
            "SELECT cu.monto,
                    COALESCE((SELECT SUM(a.monto) FROM abonos a
                              WHERE a.cuenta_id = cu.id AND a.anulado = 0), 0),
                    cu.anulada
             FROM cuentas_cobrar cu WHERE cu.id = ?1",
            params![cuenta_id],
            |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)),
        )
        .optional()?;
    let (monto, abonado, anulada) = fila.ok_or(ErrorFiado::CuentaNoExiste)?;
    if anulada == 1 {
        return Err(ErrorFiado::CuentaNoExiste);
    }
    Ok(monto - abonado)
}

fn saldo_de_cliente(conexion: &Connection, cliente_id: i64) -> Result<i64, ErrorFiado> {
    Ok(conexion
        .query_row(
            "SELECT saldo FROM saldos_clientes WHERE cliente_id = ?1",
            params![cliente_id],
            |f| f.get(0),
        )
        .optional()?
        .unwrap_or(0))
}

/// Recibe un abono contra una cuenta.
///
/// Si entra en efectivo tiene que quedar en la caja abierta, o el arqueo
/// va a encontrar plata de más y nadie va a saber de dónde salió. Por eso
/// un abono en efectivo sin caja abierta se rechaza en vez de guardarse a
/// medias.
pub fn abonar(
    conexion: &mut Connection,
    cuenta_id: i64,
    monto: i64,
    metodo_pago_id: i64,
    usuario_id: i64,
    nota: Option<&str>,
) -> Result<ResultadoAbono, ErrorFiado> {
    if monto <= 0 {
        return Err(ErrorFiado::MontoInvalido);
    }

    let saldo = saldo_de_cuenta(conexion, cuenta_id)?;
    if monto > saldo {
        return Err(ErrorFiado::AbonoExcesivo {
            saldo,
            abono: monto,
        });
    }

    let (cliente_id, venta_numero): (i64, i64) = conexion.query_row(
        "SELECT cu.cliente_id, v.numero
         FROM cuentas_cobrar cu JOIN ventas v ON v.id = cu.venta_id
         WHERE cu.id = ?1",
        params![cuenta_id],
        |f| Ok((f.get(0)?, f.get(1)?)),
    )?;

    let es_efectivo: bool = conexion
        .query_row(
            "SELECT es_efectivo FROM metodos_pago WHERE id = ?1",
            params![metodo_pago_id],
            |f| f.get::<_, i64>(0),
        )
        .map(|v| v == 1)
        .unwrap_or(false);

    // La caja se exige antes de abrir la transaccion: es preferible
    // negarse a recibir el abono que dejarlo anotado fuera del arqueo.
    let caja_id = if es_efectivo {
        Some(caja::exigir_abierta(conexion).map_err(|_| ErrorFiado::SinCaja)?.id)
    } else {
        None
    };

    let nombre_cliente: String = conexion.query_row(
        "SELECT nombre FROM clientes WHERE id = ?1",
        params![cliente_id],
        |f| f.get(0),
    )?;

    let tx = conexion.transaction()?;
    tx.execute(
        "INSERT INTO abonos (cuenta_id, monto, metodo_pago_id, caja_id, usuario_id, nota)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            cuenta_id,
            monto,
            metodo_pago_id,
            caja_id,
            usuario_id,
            nota.map(str::trim).filter(|n| !n.is_empty())
        ],
    )?;
    let abono_id = tx.last_insert_rowid();

    if let Some(caja) = caja_id {
        tx.execute(
            "INSERT INTO movimientos_caja
               (caja_id, tipo, concepto, monto, referencia_tipo, referencia_id, usuario_id)
             VALUES (?1, 'ENTRADA', ?2, ?3, 'VENTA', ?4, ?5)",
            params![
                caja,
                format!("Abono de {nombre_cliente} a la venta {venta_numero}"),
                monto,
                cuenta_id,
                usuario_id
            ],
        )?;
    }
    tx.commit()?;

    Ok(ResultadoAbono {
        abono_id,
        saldo_cuenta: saldo - monto,
        saldo_cliente: saldo_de_cliente(conexion, cliente_id)?,
        entro_a_caja: caja_id.is_some(),
    })
}

/// Anula un abono mal anotado y devuelve la plata al cajón.
pub fn anular_abono(
    conexion: &mut Connection,
    abono_id: i64,
    motivo: &str,
    usuario_id: i64,
) -> Result<(), ErrorFiado> {
    if motivo.trim().is_empty() {
        return Err(ErrorFiado::FaltaMotivo);
    }

    let fila: Option<(i64, i64, Option<i64>)> = conexion
        .query_row(
            "SELECT anulado, monto, caja_id FROM abonos WHERE id = ?1",
            params![abono_id],
            |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)),
        )
        .optional()?;
    let (anulado, monto, caja_id) = fila.ok_or(ErrorFiado::CuentaNoExiste)?;
    if anulado == 1 {
        return Err(ErrorFiado::AbonoYaAnulado);
    }

    let tx = conexion.transaction()?;
    tx.execute(
        "UPDATE abonos SET anulado = 1, motivo_anulacion = ?1 WHERE id = ?2",
        params![motivo.trim(), abono_id],
    )?;

    // Si habia entrado al cajon, sale: si no, el arqueo encuentra plata
    // de mas por un abono que ya no cuenta.
    if let Some(caja) = caja_id {
        tx.execute(
            "INSERT INTO movimientos_caja
               (caja_id, tipo, concepto, monto, referencia_tipo, referencia_id, usuario_id)
             VALUES (?1, 'SALIDA', ?2, ?3, 'ANULACION', ?4, ?5)",
            params![
                caja,
                format!("Se anuló un abono: {}", motivo.trim()),
                monto,
                abono_id,
                usuario_id
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Los abonos de una cuenta, del más nuevo al más viejo.
pub fn abonos_de(conexion: &Connection, cuenta_id: i64) -> Result<Vec<AbonoHecho>, ErrorFiado> {
    let mut consulta = conexion.prepare(
        "SELECT a.id, a.cuenta_id,
                strftime('%Y-%m-%d %H:%M', a.created_at, 'localtime'),
                a.monto, m.nombre, COALESCE(u.nombre, ''), a.nota, a.anulado
         FROM abonos a
         JOIN metodos_pago m ON m.id = a.metodo_pago_id
         LEFT JOIN usuarios u ON u.id = a.usuario_id
         WHERE a.cuenta_id = ?1
         ORDER BY a.id DESC",
    )?;
    let filas = consulta
        .query_map(params![cuenta_id], |f| {
            Ok(AbonoHecho {
                id: f.get(0)?,
                cuenta_id: f.get(1)?,
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

/// Busca un cliente por su nombre y lo crea si no estaba.
///
/// Existe porque en el mostrador se fía a texto libre: «Don Jairo», «la
/// señora del 302», «el taller de la esquina». Obligar a dar de alta un
/// cliente antes de fiar hace que nadie fíe por el sistema y todo vuelva
/// al cuaderno.
///
/// Se busca sin distinguir mayúsculas: «don jairo» y «Don Jairo» son el
/// mismo, o cada venta abriría una cuenta nueva y el saldo real quedaría
/// repartido en cinco nombres.
pub fn cliente_por_nombre(tx: &rusqlite::Transaction, nombre: &str) -> Result<i64, ErrorFiado> {
    let nombre = nombre.trim();
    if nombre.is_empty() {
        return Err(ErrorFiado::NombreVacio);
    }

    let existente: Option<(i64, i64)> = tx
        .query_row(
            "SELECT id, activo FROM clientes WHERE nombre = ?1 COLLATE NOCASE",
            params![nombre],
            |f| Ok((f.get(0)?, f.get(1)?)),
        )
        .optional()?;

    if let Some((id, activo)) = existente {
        if activo == 0 {
            return Err(ErrorFiado::ClienteInactivo);
        }
        return Ok(id);
    }

    tx.execute("INSERT INTO clientes (nombre) VALUES (?1)", params![nombre])?;
    Ok(tx.last_insert_rowid())
}

/// El id del método de pago «Fiado», si el negocio lo tiene.
pub fn metodo_fiado(conexion: &Connection) -> Result<Option<i64>, ErrorFiado> {
    Ok(conexion
        .query_row(
            "SELECT id FROM metodos_pago WHERE codigo = ?1",
            params![METODO_FIADO],
            |f| f.get(0),
        )
        .optional()?)
}

#[cfg(test)]
mod pruebas;
