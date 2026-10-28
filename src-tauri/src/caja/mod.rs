//! Apertura, movimientos y cierre de caja.
//!
//! El cierre es **arqueo ciego**: el cajero digita lo que conto antes de
//! que el sistema le muestre lo esperado. Si ve el numero primero, el
//! conteo deja de ser un control y se vuelve un tramite.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum ErrorCaja {
    #[error("ya hay una caja abierta")]
    YaHayCajaAbierta,
    #[error("no hay ninguna caja abierta")]
    SinCajaAbierta,
    #[error("el monto debe ser mayor que cero")]
    MontoInvalido,
    #[error("hay que explicar la diferencia del cierre")]
    FaltaExplicacion,
    #[error("error de base de datos")]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, Serialize)]
pub struct Caja {
    pub id: i64,
    pub usuario_apertura: i64,
    pub apertura: String,
    pub base_inicial: i64,
    pub estado: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResumenCaja {
    pub caja_id: i64,
    pub base_inicial: i64,
    pub ventas_total: i64,
    pub ventas_cantidad: i64,
    pub entradas: i64,
    pub salidas: i64,
    /// Solo el efectivo: lo que deberia estar fisicamente en el cajon.
    pub efectivo_esperado: i64,
    pub por_metodo: Vec<TotalPorMetodo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TotalPorMetodo {
    pub metodo: String,
    pub es_efectivo: bool,
    pub total: i64,
    pub cantidad: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CierreCaja {
    pub caja_id: i64,
    pub resumen: ResumenCaja,
    pub contado: i64,
    /// Positiva sobra, negativa falta.
    pub diferencia: i64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub enum TipoMovimiento {
    Entrada,
    Salida,
}

impl TipoMovimiento {
    fn codigo(self) -> &'static str {
        match self {
            Self::Entrada => "ENTRADA",
            Self::Salida => "SALIDA",
        }
    }
}

pub fn abrir(
    conexion: &Connection,
    usuario_id: i64,
    base_inicial: i64,
    observaciones: Option<&str>,
) -> Result<Caja, ErrorCaja> {
    if base_inicial < 0 {
        return Err(ErrorCaja::MontoInvalido);
    }
    if abierta(conexion)?.is_some() {
        return Err(ErrorCaja::YaHayCajaAbierta);
    }

    conexion.execute(
        "INSERT INTO cajas (usuario_apertura, base_inicial, observaciones)
         VALUES (?1, ?2, ?3)",
        params![usuario_id, base_inicial, observaciones],
    )?;
    let id = conexion.last_insert_rowid();

    registrar_auditoria(
        conexion, usuario_id, "ABRIR_CAJA", id,
        &format!("Apertura de caja con base de {base_inicial}"),
    )?;

    Ok(Caja {
        id,
        usuario_apertura: usuario_id,
        apertura: String::new(),
        base_inicial,
        estado: "ABIERTA".to_owned(),
    })
}

pub fn abierta(conexion: &Connection) -> Result<Option<Caja>, ErrorCaja> {
    let caja = conexion
        .query_row(
            "SELECT id, usuario_apertura, apertura, base_inicial, estado
             FROM cajas WHERE estado = 'ABIERTA'",
            [],
            |f| {
                Ok(Caja {
                    id: f.get(0)?,
                    usuario_apertura: f.get(1)?,
                    apertura: f.get(2)?,
                    base_inicial: f.get(3)?,
                    estado: f.get(4)?,
                })
            },
        )
        .optional()?;
    Ok(caja)
}

/// Exige que haya caja abierta. Lo llaman las ventas: sin caja no se
/// puede cobrar, porque el dinero no tendria donde quedar registrado.
pub fn exigir_abierta(conexion: &Connection) -> Result<Caja, ErrorCaja> {
    abierta(conexion)?.ok_or(ErrorCaja::SinCajaAbierta)
}

pub fn registrar_movimiento(
    conexion: &Connection,
    caja_id: i64,
    tipo: TipoMovimiento,
    concepto: &str,
    monto: i64,
    usuario_id: i64,
) -> Result<i64, ErrorCaja> {
    if monto <= 0 {
        return Err(ErrorCaja::MontoInvalido);
    }
    conexion.execute(
        "INSERT INTO movimientos_caja
           (caja_id, tipo, concepto, monto, referencia_tipo, usuario_id)
         VALUES (?1, ?2, ?3, ?4, 'MANUAL', ?5)",
        params![caja_id, tipo.codigo(), concepto, monto, usuario_id],
    )?;
    let id = conexion.last_insert_rowid();

    registrar_auditoria(
        conexion, usuario_id, "MOVIMIENTO_CAJA", caja_id,
        &format!("{} de {monto}: {concepto}", tipo.codigo()),
    )?;
    Ok(id)
}

/// Cuanto deberia haber, desglosado por metodo de pago.
///
/// El efectivo esperado suma solo lo cobrado en efectivo: una venta con
/// transferencia no pone un peso en el cajon.
pub fn resumen(conexion: &Connection, caja_id: i64) -> Result<ResumenCaja, ErrorCaja> {
    let base_inicial: i64 = conexion.query_row(
        "SELECT base_inicial FROM cajas WHERE id = ?1",
        params![caja_id],
        |f| f.get(0),
    )?;

    let mut consulta = conexion.prepare(
        "SELECT m.nombre, m.es_efectivo,
                COALESCE(SUM(p.monto), 0), COUNT(DISTINCT v.id)
         FROM metodos_pago m
         LEFT JOIN venta_pagos p ON p.metodo_pago_id = m.id
         LEFT JOIN ventas v ON v.id = p.venta_id
              AND v.caja_id = ?1 AND v.estado = 'COMPLETADA'
         WHERE m.activo = 1
         GROUP BY m.id ORDER BY m.orden",
    )?;

    let por_metodo: Vec<TotalPorMetodo> = consulta
        .query_map(params![caja_id], |f| {
            Ok(TotalPorMetodo {
                metodo: f.get(0)?,
                es_efectivo: f.get::<_, i64>(1)? == 1,
                total: f.get(2)?,
                cantidad: f.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let (ventas_total, ventas_cantidad): (i64, i64) = conexion.query_row(
        "SELECT COALESCE(SUM(total), 0), COUNT(*) FROM ventas
         WHERE caja_id = ?1 AND estado = 'COMPLETADA'",
        params![caja_id],
        |f| Ok((f.get(0)?, f.get(1)?)),
    )?;

    let entradas: i64 = conexion.query_row(
        "SELECT COALESCE(SUM(monto), 0) FROM movimientos_caja
         WHERE caja_id = ?1 AND tipo = 'ENTRADA'",
        params![caja_id],
        |f| f.get(0),
    )?;
    let salidas: i64 = conexion.query_row(
        "SELECT COALESCE(SUM(monto), 0) FROM movimientos_caja
         WHERE caja_id = ?1 AND tipo = 'SALIDA'",
        params![caja_id],
        |f| f.get(0),
    )?;

    let ventas_efectivo: i64 = por_metodo
        .iter()
        .filter(|m| m.es_efectivo)
        .map(|m| m.total)
        .sum();

    Ok(ResumenCaja {
        caja_id,
        base_inicial,
        ventas_total,
        ventas_cantidad,
        entradas,
        salidas,
        efectivo_esperado: base_inicial + ventas_efectivo + entradas - salidas,
        por_metodo,
    })
}

/// Cierra la caja con lo que el cajero conto.
///
/// El conteo llega como dato de entrada, no como confirmacion de un
/// numero que el sistema mostro antes: eso es lo que lo hace un arqueo
/// ciego. Si hay diferencia, exige una explicacion escrita.
pub fn cerrar(
    conexion: &Connection,
    caja_id: i64,
    efectivo_contado: i64,
    usuario_id: i64,
    observaciones: Option<&str>,
) -> Result<CierreCaja, ErrorCaja> {
    if efectivo_contado < 0 {
        return Err(ErrorCaja::MontoInvalido);
    }

    let resumen = resumen(conexion, caja_id)?;
    let diferencia = efectivo_contado - resumen.efectivo_esperado;

    if diferencia != 0 && observaciones.map_or(true, |o| o.trim().is_empty()) {
        return Err(ErrorCaja::FaltaExplicacion);
    }

    conexion.execute(
        "UPDATE cajas SET
           estado = 'CERRADA',
           cierre = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
           usuario_cierre = ?2,
           efectivo_contado = ?3,
           efectivo_esperado = ?4,
           diferencia = ?5,
           observaciones = COALESCE(?6, observaciones)
         WHERE id = ?1 AND estado = 'ABIERTA'",
        params![
            caja_id, usuario_id, efectivo_contado,
            resumen.efectivo_esperado, diferencia, observaciones,
        ],
    )?;

    registrar_auditoria(
        conexion, usuario_id, "CERRAR_CAJA", caja_id,
        &format!(
            "Cierre: esperado {}, contado {efectivo_contado}, diferencia {diferencia}",
            resumen.efectivo_esperado
        ),
    )?;

    Ok(CierreCaja {
        caja_id,
        resumen,
        contado: efectivo_contado,
        diferencia,
    })
}

fn registrar_auditoria(
    conexion: &Connection,
    usuario_id: i64,
    accion: &str,
    entidad_id: i64,
    descripcion: &str,
) -> Result<(), ErrorCaja> {
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
         VALUES (?1, ?2, ?3, 'cajas', ?4, ?5)",
        params![usuario_id, nombre, accion, entidad_id, descripcion],
    )?;
    Ok(())
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db::abrir_en_memoria;

    fn base() -> Connection {
        let db = abrir_en_memoria().unwrap();
        db.execute(
            "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
             VALUES ('cajero', 'Cajero', 'h', 'CAJERO')",
            [],
        )
        .unwrap();
        db
    }

    #[test]
    fn abre_con_la_base_del_dia() {
        let db = base();
        let caja = abrir(&db, 1, 100_000, Some("turno de la mañana")).unwrap();
        assert_eq!(caja.base_inicial, 100_000);
        assert_eq!(caja.estado, "ABIERTA");
    }

    #[test]
    fn no_deja_abrir_una_segunda_caja() {
        let db = base();
        abrir(&db, 1, 100_000, None).unwrap();
        assert!(matches!(
            abrir(&db, 1, 50_000, None),
            Err(ErrorCaja::YaHayCajaAbierta)
        ));
    }

    #[test]
    fn deja_abrir_otra_despues_de_cerrar() {
        let db = base();
        let primera = abrir(&db, 1, 100_000, None).unwrap();
        cerrar(&db, primera.id, 100_000, 1, None).unwrap();
        assert!(abrir(&db, 1, 80_000, None).is_ok());
    }

    #[test]
    fn el_esperado_suma_base_entradas_y_resta_salidas() {
        let db = base();
        let caja = abrir(&db, 1, 100_000, None).unwrap();

        registrar_movimiento(&db, caja.id, TipoMovimiento::Entrada, "prestamo", 50_000, 1).unwrap();
        registrar_movimiento(&db, caja.id, TipoMovimiento::Salida, "domicilio", 20_000, 1).unwrap();

        let r = resumen(&db, caja.id).unwrap();
        assert_eq!(r.entradas, 50_000);
        assert_eq!(r.salidas, 20_000);
        assert_eq!(r.efectivo_esperado, 130_000, "100.000 + 50.000 - 20.000");
    }

    #[test]
    fn un_movimiento_en_cero_o_negativo_se_rechaza() {
        let db = base();
        let caja = abrir(&db, 1, 100_000, None).unwrap();
        assert!(matches!(
            registrar_movimiento(&db, caja.id, TipoMovimiento::Salida, "nada", 0, 1),
            Err(ErrorCaja::MontoInvalido)
        ));
        assert!(matches!(
            registrar_movimiento(&db, caja.id, TipoMovimiento::Entrada, "nada", -5000, 1),
            Err(ErrorCaja::MontoInvalido)
        ));
    }

    #[test]
    fn el_cierre_cuadrado_no_pide_explicacion() {
        let db = base();
        let caja = abrir(&db, 1, 100_000, None).unwrap();
        let cierre = cerrar(&db, caja.id, 100_000, 1, None).unwrap();
        assert_eq!(cierre.diferencia, 0);
    }

    #[test]
    fn una_diferencia_sin_explicacion_no_cierra() {
        let db = base();
        let caja = abrir(&db, 1, 100_000, None).unwrap();
        assert!(matches!(
            cerrar(&db, caja.id, 95_000, 1, None),
            Err(ErrorCaja::FaltaExplicacion)
        ));
        assert!(matches!(
            cerrar(&db, caja.id, 95_000, 1, Some("   ")),
            Err(ErrorCaja::FaltaExplicacion)
        ));
        // La caja sigue abierta: no se cierra a medias.
        assert!(abierta(&db).unwrap().is_some());
    }

    #[test]
    fn una_diferencia_explicada_si_cierra_y_queda_registrada() {
        let db = base();
        let caja = abrir(&db, 1, 100_000, None).unwrap();

        let cierre = cerrar(&db, caja.id, 95_000, 1, Some("falto un billete de 5.000")).unwrap();
        assert_eq!(cierre.diferencia, -5_000, "negativa porque falta");

        let guardada: i64 = db
            .query_row("SELECT diferencia FROM cajas WHERE id = ?1", [caja.id], |f| f.get(0))
            .unwrap();
        assert_eq!(guardada, -5_000);
    }

    #[test]
    fn si_sobra_dinero_la_diferencia_es_positiva() {
        let db = base();
        let caja = abrir(&db, 1, 100_000, None).unwrap();
        let cierre = cerrar(&db, caja.id, 103_000, 1, Some("sobro vuelto")).unwrap();
        assert_eq!(cierre.diferencia, 3_000);
    }

    #[test]
    fn vender_sin_caja_abierta_no_es_posible() {
        let db = base();
        assert!(matches!(exigir_abierta(&db), Err(ErrorCaja::SinCajaAbierta)));
    }

    #[test]
    fn la_apertura_y_el_cierre_quedan_en_la_auditoria() {
        let db = base();
        let caja = abrir(&db, 1, 100_000, None).unwrap();
        cerrar(&db, caja.id, 100_000, 1, None).unwrap();

        let registros: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM auditoria WHERE accion IN ('ABRIR_CAJA','CERRAR_CAJA')",
                [],
                |f| f.get(0),
            )
            .unwrap();
        assert_eq!(registros, 2);
    }
}
