//! Ventas y anulaciones.
//!
//! Una venta toca cinco tablas: la venta, sus renglones, sus pagos, el
//! stock de cada producto y el libro de inventario. Todo eso ocurre en
//! una sola transaccion. Si se corta la luz a la mitad, el resultado es
//! **todo o nada**: nunca una venta con el inventario descontado a medias.
//!
//! El precio y el costo se congelan en cada renglon. Si mañana sube el
//! aguardiente, las ventas de ayer siguen diciendo lo que se cobro de
//! verdad; sin eso, cada cambio de precio reescribiria el historial.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::caja;

#[derive(Debug, thiserror::Error)]
pub enum ErrorVenta {
    #[error("no hay ninguna caja abierta")]
    SinCajaAbierta,
    #[error("la venta no tiene productos")]
    VentaVacia,
    #[error("el producto {0} ya no existe o esta desactivado")]
    ProductoInvalido(i64),
    #[error("la forma de venta elegida no existe para {0}")]
    EmpaqueInvalido(String),
    #[error("los pagos suman {pagado} y la venta vale {total}")]
    PagoNoCuadra { pagado: i64, total: i64 },
    #[error("la cantidad debe ser mayor que cero")]
    CantidadInvalida,
    #[error("el descuento no puede superar el valor de la venta")]
    DescuentoExcesivo,
    #[error("la venta ya estaba anulada")]
    YaAnulada,
    #[error("la venta no existe")]
    NoExiste,
    #[error("hay que decir por que se anula")]
    FaltaMotivo,
    #[error("{0}")]
    Fiado(#[from] crate::fiados::ErrorFiado),
    #[error("error de base de datos")]
    Sqlite(#[from] rusqlite::Error),
}

impl From<caja::ErrorCaja> for ErrorVenta {
    fn from(error: caja::ErrorCaja) -> Self {
        match error {
            caja::ErrorCaja::SinCajaAbierta => Self::SinCajaAbierta,
            caja::ErrorCaja::Sqlite(e) => Self::Sqlite(e),
            _ => Self::SinCajaAbierta,
        }
    }
}

/// Un renglon del carrito tal como llega de la caja.
#[derive(Debug, Clone, Deserialize)]
pub struct ItemCarrito {
    pub producto_id: i64,
    /// Cual de las formas de venta del producto: unidad, six, canasta.
    pub empaque_id: Option<i64>,
    pub cantidad: i64,
    /// Descuento en pesos sobre este renglon.
    #[serde(default)]
    pub descuento: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PagoRecibido {
    pub metodo_pago_id: i64,
    pub monto: i64,
    /// Solo efectivo: con cuanto pago el cliente.
    pub recibido: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VentaEntrante {
    pub items: Vec<ItemCarrito>,
    pub pagos: Vec<PagoRecibido>,
    pub usuario_id: i64,
    #[serde(default)]
    pub notas: Option<String>,
    /// Lo que se cobra de mas sobre la venta entera: domicilio, servicio,
    /// lo que sea. Va aparte del descuento por renglon.
    #[serde(default)]
    pub recargo: Option<Recargo>,
    /// A nombre de quien queda lo que se fio. Obligatorio si alguno de
    /// los pagos es fiado: una deuda sin dueño no se puede cobrar.
    #[serde(default)]
    pub cliente_id: Option<i64>,
    /// El nombre escrito a mano en la caja. Si no hay un cliente con ese
    /// nombre se crea; si lo hay, la deuda se le suma a esa cuenta.
    ///
    /// En el mostrador se fia a texto libre —«la señora del 302», «el
    /// taller de la esquina»— y obligar a dar de alta un cliente antes de
    /// fiar hace que nadie fie por el sistema.
    #[serde(default)]
    pub cliente_nombre: Option<String>,
}

/// Un cobro adicional sobre el total, por monto fijo o por porcentaje.
///
/// Siempre con concepto: un recargo sin motivo en un recibo es una queja
/// del cliente esperando a pasar.
#[derive(Debug, Clone, Deserialize)]
pub struct Recargo {
    pub concepto: String,
    /// Si viene, se cobra este porcentaje del subtotal ya descontado.
    #[serde(default)]
    pub porcentaje: Option<i64>,
    /// Si no hay porcentaje, se cobra este monto tal cual.
    #[serde(default)]
    pub monto: i64,
}

impl Recargo {
    /// Cuanto suma, redondeado al peso.
    fn calcular(&self, base: i64) -> i64 {
        match self.porcentaje {
            // Redondeo al mas cercano: truncar un 10 % de 3.999 daria 399
            // y el cliente pagaria un peso menos del que se anuncio.
            Some(p) if p > 0 => (base * p + 50) / 100,
            _ => self.monto.max(0),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct VentaRegistrada {
    pub id: i64,
    pub numero: i64,
    pub subtotal: i64,
    pub descuento: i64,
    pub recargo: i64,
    pub recargo_concepto: Option<String>,
    /// Lo que del total corresponde al impuesto, cuando el negocio lo
    /// separa. Con precios finales -- el caso normal -- vale cero.
    pub impuesto: i64,
    pub total: i64,
    pub cambio: i64,
    /// Se vendio algo que el sistema creia agotado.
    pub con_faltante: bool,
    pub items: Vec<ItemVendido>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ItemVendido {
    pub producto: String,
    pub empaque: String,
    pub cantidad: i64,
    pub unidades_base: i64,
    pub precio_unitario: i64,
    pub total: i64,
}

/// Datos del producto y del empaque, ya validados.
struct Renglon {
    producto_id: i64,
    nombre_producto: String,
    empaque_id: Option<i64>,
    nombre_empaque: String,
    factor: i64,
    precio: i64,
    costo: Option<i64>,
    cantidad: i64,
    descuento: i64,
}

impl Renglon {
    fn unidades_base(&self) -> i64 {
        self.cantidad * self.factor
    }
    fn bruto(&self) -> i64 {
        self.cantidad * self.precio
    }
    fn total(&self) -> i64 {
        self.bruto() - self.descuento
    }
}

/// Registra una venta completa.
///
/// Si el stock no alcanza **no se bloquea**: se marca la venta con
/// faltante y sigue. Si el cajero tiene la botella en la mano, la
/// existencia esta mal, no la botella. Bloquear solo consigue que se
/// cobre por fuera del sistema, y ahi si se pierde el control.
pub fn registrar(
    conexion: &mut Connection,
    entrante: &VentaEntrante,
) -> Result<VentaRegistrada, ErrorVenta> {
    if entrante.items.is_empty() {
        return Err(ErrorVenta::VentaVacia);
    }
    if entrante.items.iter().any(|i| i.cantidad <= 0) {
        return Err(ErrorVenta::CantidadInvalida);
    }
    if entrante.items.iter().any(|i| i.descuento < 0) {
        return Err(ErrorVenta::DescuentoExcesivo);
    }

    let caja_abierta = caja::exigir_abierta(conexion)?;
    let tx = conexion.transaction()?;

    let mut renglones = Vec::with_capacity(entrante.items.len());
    for item in &entrante.items {
        renglones.push(resolver_renglon(&tx, item)?);
    }

    if renglones.iter().any(|r| r.descuento > r.bruto()) {
        return Err(ErrorVenta::DescuentoExcesivo);
    }

    let subtotal: i64 = renglones.iter().map(Renglon::bruto).sum();
    let descuento: i64 = renglones.iter().map(|r| r.descuento).sum();

    // El recargo se calcula sobre lo que quedo despues del descuento: un
    // 10 % de domicilio sobre el precio ya rebajado, no sobre el de lista.
    let base = subtotal - descuento;
    let recargo = entrante.recargo.as_ref().map_or(0, |r| r.calcular(base));
    let total = base + recargo;

    // El impuesto solo se separa si el negocio lo tiene activo. Casi
    // siempre esta apagado: la licorera vende a precio final.
    let impuesto = impuesto_de(&tx, total)?;

    let pagado: i64 = entrante.pagos.iter().map(|p| p.monto).sum();
    if pagado != total {
        return Err(ErrorVenta::PagoNoCuadra { pagado, total });
    }

    let numero = siguiente_numero(&tx)?;

    tx.execute(
        "INSERT INTO ventas
           (numero, caja_id, usuario_id, subtotal, descuento, impuesto, total,
            notas, recargo, recargo_concepto, recargo_porcentaje)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            numero, caja_abierta.id, entrante.usuario_id,
            subtotal, descuento, impuesto, total, entrante.notas,
            recargo,
            entrante.recargo.as_ref().map(|r| r.concepto.trim().to_owned()),
            entrante.recargo.as_ref().and_then(|r| r.porcentaje),
        ],
    )?;
    let venta_id = tx.last_insert_rowid();

    let mut vendidos = Vec::with_capacity(renglones.len());
    let mut con_faltante = false;
    for r in &renglones {
        tx.execute(
            "INSERT INTO venta_items
               (venta_id, producto_id, empaque_id, nombre_producto, nombre_empaque,
                cantidad_empaques, factor, cantidad_base, precio_unitario,
                costo_unitario, descuento, total)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                venta_id, r.producto_id, r.empaque_id, r.nombre_producto, r.nombre_empaque,
                r.cantidad, r.factor, r.unidades_base(), r.precio,
                r.costo, r.descuento, r.total(),
            ],
        )?;

        let existencia_antes = mover_stock(
            &tx, r.producto_id, -r.unidades_base(),
            "VENTA", r.empaque_id, Some(r.cantidad), venta_id,
            &format!("Venta {numero}"), entrante.usuario_id,
        )?;
        // Se compara con la existencia real del momento, ya descontados
        // los renglones anteriores de esta misma venta.
        if existencia_antes < r.unidades_base() {
            con_faltante = true;
        }

        vendidos.push(ItemVendido {
            producto: r.nombre_producto.clone(),
            empaque: r.nombre_empaque.clone(),
            cantidad: r.cantidad,
            unidades_base: r.unidades_base(),
            precio_unitario: r.precio,
            total: r.total(),
        });
    }

    if con_faltante {
        tx.execute(
            "UPDATE ventas SET con_faltante = 1 WHERE id = ?1",
            params![venta_id],
        )?;
    }

    // Lo fiado se anota aparte: la venta queda registrada y la plata
    // queda debiendo a nombre de alguien. Sin cliente no se puede cobrar
    // despues, asi que se rechaza la venta entera antes que dejar una
    // deuda sin dueño.
    let mut fiado = 0;

    let mut cambio = 0;
    for pago in &entrante.pagos {
        let es_efectivo: bool = tx
            .query_row(
                "SELECT es_efectivo FROM metodos_pago WHERE id = ?1",
                params![pago.metodo_pago_id],
                |f| f.get::<_, i64>(0),
            )
            .map(|v| v == 1)
            .unwrap_or(false);

        let vuelto = match (es_efectivo, pago.recibido) {
            (true, Some(recibido)) if recibido > pago.monto => recibido - pago.monto,
            _ => 0,
        };
        cambio += vuelto;

        let codigo: String = tx
            .query_row(
                "SELECT codigo FROM metodos_pago WHERE id = ?1",
                params![pago.metodo_pago_id],
                |f| f.get(0),
            )
            .unwrap_or_default();
        if codigo == crate::fiados::METODO_FIADO {
            fiado += pago.monto;
        }

        tx.execute(
            "INSERT INTO venta_pagos (venta_id, metodo_pago_id, monto, recibido, cambio)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![venta_id, pago.metodo_pago_id, pago.monto, pago.recibido, vuelto],
        )?;
    }

    if fiado > 0 {
        // El id manda si viene; si no, el nombre escrito en la caja.
        let cliente_id = match (entrante.cliente_id, entrante.cliente_nombre.as_deref()) {
            (Some(id), _) => id,
            (None, Some(nombre)) if !nombre.trim().is_empty() => {
                crate::fiados::cliente_por_nombre(&tx, nombre)?
            }
            _ => return Err(crate::fiados::ErrorFiado::FaltaCliente.into()),
        };
        crate::fiados::anotar_cuenta(&tx, venta_id, cliente_id, fiado)?;
    }

    tx.commit()?;

    Ok(VentaRegistrada {
        id: venta_id,
        numero,
        subtotal,
        descuento,
        recargo,
        recargo_concepto: entrante
            .recargo
            .as_ref()
            .map(|r| r.concepto.trim().to_owned())
            .filter(|c| !c.is_empty()),
        impuesto,
        total,
        cambio,
        con_faltante,
        items: vendidos,
    })
}

fn resolver_renglon(tx: &Transaction, item: &ItemCarrito) -> Result<Renglon, ErrorVenta> {
    let producto: Option<(String, i64, i64, Option<i64>)> = tx
        .query_row(
            "SELECT nombre, existencia, precio_venta, costo_promedio
             FROM productos WHERE id = ?1 AND activo = 1",
            params![item.producto_id],
            |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?)),
        )
        .optional()?;

    let Some((nombre, _existencia, precio_base, costo)) = producto else {
        return Err(ErrorVenta::ProductoInvalido(item.producto_id));
    };

    // Sin empaque explicito se usa el predeterminado; si tampoco lo hay,
    // se vende por unidad al precio del producto.
    let empaque: Option<(i64, String, i64, i64)> = match item.empaque_id {
        Some(id) => tx
            .query_row(
                "SELECT id, nombre, factor, COALESCE(precio_venta, 0)
                 FROM producto_empaques
                 WHERE id = ?1 AND producto_id = ?2 AND activo = 1 AND para_venta = 1",
                params![id, item.producto_id],
                |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?)),
            )
            .optional()?,
        None => tx
            .query_row(
                "SELECT id, nombre, factor, COALESCE(precio_venta, 0)
                 FROM producto_empaques
                 WHERE producto_id = ?1 AND activo = 1 AND para_venta = 1
                 ORDER BY predeterminado DESC, orden LIMIT 1",
                params![item.producto_id],
                |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?)),
            )
            .optional()?,
    };

    if item.empaque_id.is_some() && empaque.is_none() {
        return Err(ErrorVenta::EmpaqueInvalido(nombre));
    }

    let (empaque_id, nombre_empaque, factor, precio_normal) = match empaque {
        Some((id, n, f, p)) if p > 0 => (Some(id), n, f, p),
        _ => (None, "Unidad".to_owned(), 1, precio_base),
    };

    // Si hay un precio con vigencia para hoy, ese manda. El de siempre no
    // se toca: cuando la promocion venza se vuelve solo a el.
    let precio = precio_vigente(tx, item.producto_id, empaque_id)?.unwrap_or(precio_normal);

    Ok(Renglon {
        producto_id: item.producto_id,
        nombre_producto: nombre,
        empaque_id,
        nombre_empaque,
        factor,
        precio,
        costo,
        cantidad: item.cantidad,
        descuento: item.descuento,
    })
}

/// Cuanto del total corresponde al impuesto, si el negocio lo separa.
///
/// Devuelve cero cuando esta apagado, que es lo normal aqui: los precios
/// de la licorera son precio final y separar un impuesto que nadie cobra
/// solo ensuciaria el recibo.
///
/// Con `impuesto.incluido` en 1 el precio ya lo trae y se despeja hacia
/// atras; en 0 seria un impuesto que se suma encima, y entonces el total
/// tendria que haberse calculado antes. Por eso aqui solo se desglosa.
fn impuesto_de(tx: &Transaction, total: i64) -> Result<i64, ErrorVenta> {
    let activo: i64 = tx
        .query_row(
            "SELECT CAST(valor AS INTEGER) FROM configuracion WHERE clave = 'impuesto.activo'",
            [],
            |f| f.get(0),
        )
        .optional()?
        .unwrap_or(0);
    if activo == 0 {
        return Ok(0);
    }

    let porcentaje: i64 = tx
        .query_row(
            "SELECT CAST(valor AS INTEGER) FROM configuracion WHERE clave = 'impuesto.porcentaje'",
            [],
            |f| f.get(0),
        )
        .optional()?
        .unwrap_or(0);
    if porcentaje <= 0 {
        return Ok(0);
    }

    // Precio con impuesto incluido: la parte de impuesto sale de
    // despejar total = base * (100 + p) / 100.
    Ok((total * porcentaje + (100 + porcentaje) / 2) / (100 + porcentaje))
}

/// El precio especial que este rigiendo hoy, si lo hay.
///
/// Sirve para subir o bajar el precio de algo por un dia o una temporada
/// sin perder el precio de siempre. Se busca el del empaque exacto; si no
/// hay, el que aplica al producto entero.
///
/// Con dos vigencias encimadas gana la que empezo despues: es la que
/// alguien puso ultima, y por tanto la que quiso.
fn precio_vigente(
    tx: &Transaction,
    producto_id: i64,
    empaque_id: Option<i64>,
) -> Result<Option<i64>, ErrorVenta> {
    let precio: Option<i64> = tx
        .query_row(
            "SELECT precio FROM precios_vigencia
             WHERE producto_id = ?1
               AND activo = 1
               AND (empaque_id IS ?2 OR empaque_id IS NULL)
               AND date('now','localtime') BETWEEN desde AND hasta
             ORDER BY (empaque_id IS NOT NULL) DESC, desde DESC, id DESC
             LIMIT 1",
            params![producto_id, empaque_id],
            |f| f.get(0),
        )
        .optional()?;
    Ok(precio)
}

/// Cambia la existencia y deja constancia en el libro, siempre juntos.
///
/// La existencia se lee aqui dentro, no se recibe. Una venta puede traer
/// el mismo producto en dos renglones -- dos botellas sueltas y un six --
/// y si cada renglon partiera de la existencia que leyo antes de empezar,
/// el segundo pisaria al primero y el inventario quedaria mal.
#[allow(clippy::too_many_arguments)]
fn mover_stock(
    tx: &Transaction,
    producto_id: i64,
    cantidad: i64,
    tipo: &str,
    empaque_id: Option<i64>,
    cantidad_empaques: Option<i64>,
    referencia_id: i64,
    motivo: &str,
    usuario_id: i64,
) -> Result<i64, ErrorVenta> {
    let existencia_antes: i64 = tx.query_row(
        "SELECT existencia FROM productos WHERE id = ?1",
        params![producto_id],
        |f| f.get(0),
    )?;
    let despues = existencia_antes + cantidad;

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
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?2, ?8, ?9, ?10)",
        params![
            producto_id, tipo, cantidad, empaque_id, cantidad_empaques,
            existencia_antes, despues, referencia_id, motivo, usuario_id,
        ],
    )?;
    Ok(existencia_antes)
}

fn siguiente_numero(tx: &Transaction) -> Result<i64, ErrorVenta> {
    let actual: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(numero), 0) FROM ventas",
            [],
            |f| f.get(0),
        )
        .unwrap_or(0);
    Ok(actual + 1)
}

/// Anula una venta: devuelve la mercancia y saca el dinero de la caja.
///
/// La venta no se borra nunca. Se marca anulada y queda con su motivo,
/// su autor y su hora, para que el historial siga siendo auditable.
pub fn anular(
    conexion: &mut Connection,
    venta_id: i64,
    motivo: &str,
    usuario_id: i64,
    autorizado_por: Option<i64>,
) -> Result<(), ErrorVenta> {
    if motivo.trim().is_empty() {
        return Err(ErrorVenta::FaltaMotivo);
    }

    let estado: Option<String> = conexion
        .query_row(
            "SELECT estado FROM ventas WHERE id = ?1",
            params![venta_id],
            |f| f.get(0),
        )
        .optional()?;

    match estado.as_deref() {
        None => return Err(ErrorVenta::NoExiste),
        Some("ANULADA") => return Err(ErrorVenta::YaAnulada),
        _ => {}
    }

    // La devolucion del dinero entra en la caja que este abierta ahora,
    // que puede no ser la misma en que se vendio.
    let caja_actual = caja::exigir_abierta(conexion)?;
    let tx = conexion.transaction()?;

    let mut consulta = tx.prepare(
        "SELECT producto_id, cantidad_base, empaque_id, cantidad_empaques
         FROM venta_items WHERE venta_id = ?1",
    )?;
    let items: Vec<(i64, i64, Option<i64>, Option<i64>)> = consulta
        .query_map(params![venta_id], |f| {
            Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(consulta);

    let numero: i64 = tx.query_row(
        "SELECT numero FROM ventas WHERE id = ?1",
        params![venta_id],
        |f| f.get(0),
    )?;

    for (producto_id, cantidad_base, empaque_id, cantidad_empaques) in items {
        mover_stock(
            &tx, producto_id, cantidad_base, "ANULACION",
            empaque_id, cantidad_empaques, venta_id,
            &format!("Anulacion de la venta {numero}"), usuario_id,
        )?;
    }

    let total: i64 = tx.query_row(
        "SELECT total FROM ventas WHERE id = ?1",
        params![venta_id],
        |f| f.get(0),
    )?;

    tx.execute(
        "UPDATE ventas SET estado = 'ANULADA' WHERE id = ?1",
        params![venta_id],
    )?;

    // Si la venta estaba fiada, el cliente deja de deberla.
    crate::fiados::anular_cuenta_de_venta(&tx, venta_id)?;

    tx.execute(
        "INSERT INTO anulaciones (venta_id, motivo, usuario_id, autorizado_por, caja_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![venta_id, motivo.trim(), usuario_id, autorizado_por, caja_actual.id],
    )?;

    // Solo sale de la caja lo que entro en efectivo.
    let efectivo: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(p.monto), 0)
             FROM venta_pagos p JOIN metodos_pago m ON m.id = p.metodo_pago_id
             WHERE p.venta_id = ?1 AND m.es_efectivo = 1",
            params![venta_id],
            |f| f.get(0),
        )
        .unwrap_or(0);

    if efectivo > 0 {
        tx.execute(
            "INSERT INTO movimientos_caja
               (caja_id, tipo, concepto, monto, referencia_tipo, referencia_id, usuario_id)
             VALUES (?1, 'SALIDA', ?2, ?3, 'ANULACION', ?4, ?5)",
            params![
                caja_actual.id,
                format!("Devolucion por anulacion de la venta {numero}"),
                efectivo, venta_id, usuario_id,
            ],
        )?;
    }

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
         VALUES (?1, ?2, 'ANULAR_VENTA', 'ventas', ?3, ?4)",
        params![
            usuario_id, nombre, venta_id,
            format!("Anulacion de la venta {numero} por {total}: {}", motivo.trim()),
        ],
    )?;

    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod pruebas;
