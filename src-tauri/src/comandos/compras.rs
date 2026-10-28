//! Comandos de compras y proveedores.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::compras::{self, CompraEntrante, CompraRegistrada};
use crate::usuarios::{permisos, Rol};
use crate::{ErrorApp, EstadoApp};

#[derive(Debug, Serialize)]
pub struct Proveedor {
    pub id: i64,
    pub nombre: String,
    pub telefono: Option<String>,
    pub contacto: Option<String>,
    /// Cuántos productos se le han comprado alguna vez.
    pub productos: i64,
}

#[derive(Debug, Serialize)]
pub struct CompraListada {
    pub id: i64,
    pub numero: String,
    pub fecha: String,
    pub proveedor: String,
    pub documento: Option<String>,
    pub total: i64,
    pub anulada: bool,
    pub articulos: i64,
}

/// Qué proveedor tiene más barato un producto.
#[derive(Debug, Serialize)]
pub struct PrecioProveedor {
    pub proveedor: String,
    pub empaque: Option<String>,
    /// Lo que cobra por el empaque completo: la canasta, el six, la unidad.
    pub precio: i64,
    /// Lo que sale cada unidad. Es lo único comparable entre proveedores:
    /// una canasta de 30 a 60.000 y una botella suelta a 2.400 son 60.000
    /// contra 2.400 si uno mira el precio, pero 2.000 contra 2.400 cuando
    /// mira lo que de verdad cuesta la botella.
    pub precio_unitario: i64,
    pub fecha: String,
    /// El más barato por unidad. Puede haber varios si empatan.
    pub mejor: bool,
}

// ---------------------------------------------------------------------------
// Lo que se le debe a los proveedores
// ---------------------------------------------------------------------------

fn fallo_deuda(error: crate::compras::deudas::ErrorDeuda) -> ErrorApp {
    use crate::compras::deudas::ErrorDeuda as E;
    match error {
        E::NoExiste => ErrorApp::nuevo("Esa compra ya no existe.", error),
        E::Anulada => ErrorApp::nuevo("Esa compra está anulada.", error),
        E::MontoInvalido => ErrorApp::nuevo("El pago tiene que ser mayor que cero.", error),
        E::PagoExcesivo { saldo, .. } => ErrorApp::nuevo(
            format!("De esa compra solo quedan debiendo ${saldo}."),
            error,
        ),
        E::FechaInvalida => ErrorApp::nuevo("Elige una fecha válida.", error),
        E::YaAnulado => ErrorApp::nuevo("Ese pago ya está anulado.", error),
        E::FaltaMotivo => ErrorApp::nuevo("Escribe por qué se anula el pago.", error),
        E::SinCaja => ErrorApp::nuevo(
            "Para pagar en efectivo tiene que haber una caja abierta, o esa plata              sale del cajón sin quedar registrada.",
            error,
        ),
        otro => ErrorApp::nuevo("No se pudo registrar el pago.", otro),
    }
}

#[tauri::command]
pub fn compras_por_pagar(
    estado: State<'_, EstadoApp>,
    rol: Rol,
) -> Result<Vec<crate::compras::deudas::DeudaCompra>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    permisos::exigir(&db, rol, permisos::COMPRA_REGISTRAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para ver las compras.", e))?;
    crate::compras::deudas::pendientes(&db).map_err(fallo_deuda)
}

#[tauri::command]
pub fn saldos_por_proveedor(
    estado: State<'_, EstadoApp>,
    rol: Rol,
) -> Result<Vec<crate::compras::deudas::SaldoProveedor>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    permisos::exigir(&db, rol, permisos::COMPRA_REGISTRAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para ver las compras.", e))?;
    crate::compras::deudas::por_proveedor(&db).map_err(fallo_deuda)
}

/// Lo que hace falta para anotar un pago a un proveedor.
#[derive(Debug, Deserialize)]
pub struct PagoAProveedor {
    pub compra_id: i64,
    pub monto: i64,
    pub fecha: String,
    pub metodo_pago_id: Option<i64>,
    pub nota: Option<String>,
}

#[tauri::command]
pub fn pagar_compra(
    estado: State<'_, EstadoApp>,
    pago: PagoAProveedor,
    usuario_id: i64,
    rol: Rol,
) -> Result<i64, ErrorApp> {
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    permisos::exigir(&db, rol, permisos::COMPRA_REGISTRAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para registrar pagos.", e))?;
    crate::compras::deudas::pagar(
        &mut db,
        pago.compra_id,
        pago.monto,
        &pago.fecha,
        pago.metodo_pago_id,
        usuario_id,
        pago.nota.as_deref(),
    )
    .map_err(fallo_deuda)
}

#[tauri::command]
pub fn anular_pago_compra(
    estado: State<'_, EstadoApp>,
    pago_id: i64,
    motivo: String,
    usuario_id: i64,
    rol: Rol,
) -> Result<(), ErrorApp> {
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    permisos::exigir(&db, rol, permisos::COMPRA_REGISTRAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para anular pagos.", e))?;
    crate::compras::deudas::anular_pago(&mut db, pago_id, &motivo, usuario_id)
        .map_err(fallo_deuda)
}

#[tauri::command]
pub fn pagos_de_compra(
    estado: State<'_, EstadoApp>,
    compra_id: i64,
    rol: Rol,
) -> Result<Vec<crate::compras::deudas::PagoHecho>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    permisos::exigir(&db, rol, permisos::COMPRA_REGISTRAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para ver las compras.", e))?;
    crate::compras::deudas::pagos_de(&db, compra_id).map_err(fallo_deuda)
}

#[tauri::command]
pub fn listar_proveedores(estado: State<'_, EstadoApp>) -> Result<Vec<Proveedor>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudieron cargar los proveedores.", e);

    let mut consulta = db
        .prepare(
            "SELECT p.id, p.nombre, p.telefono, p.contacto,
                    (SELECT COUNT(*) FROM proveedor_productos pp WHERE pp.proveedor_id = p.id)
             FROM proveedores p WHERE p.activo = 1 ORDER BY p.nombre",
        )
        .map_err(fallo)?;
    let filas = consulta
        .query_map([], |f| {
            Ok(Proveedor {
                id: f.get(0)?,
                nombre: f.get(1)?,
                telefono: f.get(2)?,
                contacto: f.get(3)?,
                productos: f.get(4)?,
            })
        })
        .map_err(fallo)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(fallo)?;
    Ok(filas)
}

#[tauri::command]
pub fn listar_compras(
    estado: State<'_, EstadoApp>,
    limite: i64,
) -> Result<Vec<CompraListada>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudieron cargar las compras.", e);

    let mut consulta = db
        .prepare(
            "SELECT c.id, c.numero, c.fecha, p.nombre, c.documento, c.total, c.estado,
                    (SELECT COALESCE(SUM(cantidad_empaques), 0)
                     FROM compra_items WHERE compra_id = c.id)
             FROM compras c
             JOIN proveedores p ON p.id = c.proveedor_id
             ORDER BY c.id DESC LIMIT ?1",
        )
        .map_err(fallo)?;
    let filas = consulta
        .query_map(rusqlite::params![limite], |f| {
            Ok(CompraListada {
                id: f.get(0)?,
                numero: f.get(1)?,
                fecha: f.get(2)?,
                proveedor: f.get(3)?,
                documento: f.get(4)?,
                total: f.get(5)?,
                anulada: f.get::<_, String>(6)? == "ANULADA",
                articulos: f.get(7)?,
            })
        })
        .map_err(fallo)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(fallo)?;
    Ok(filas)
}

/// Precios que cada proveedor ha cobrado por un producto.
///
/// Reemplaza la matriz de proveedores del Excel, y además marca el más
/// barato, que es la pregunta que uno hace de verdad antes de pedir.
#[tauri::command]
pub fn precios_de_producto(
    estado: State<'_, EstadoApp>,
    producto_id: i64,
    rol: Rol,
) -> Result<Vec<PrecioProveedor>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::COSTO_VER)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para ver los costos.", e))?;

    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudieron cargar los precios.", e);

    // Sin empaque el precio ya es por unidad, de ahí el factor 1.
    let mut consulta = db
        .prepare(
            "SELECT pr.nombre, e.nombre, pp.precio,
                    COALESCE(e.factor, 1),
                    date(pp.fecha_precio, 'localtime')
             FROM proveedor_productos pp
             JOIN proveedores pr ON pr.id = pp.proveedor_id
             LEFT JOIN producto_empaques e ON e.id = pp.empaque_id
             WHERE pp.producto_id = ?1",
        )
        .map_err(fallo)?;

    let mut filas: Vec<PrecioProveedor> = consulta
        .query_map(rusqlite::params![producto_id], |f| {
            let precio: i64 = f.get(2)?;
            let factor: i64 = f.get(3)?;
            Ok(PrecioProveedor {
                proveedor: f.get(0)?,
                empaque: f.get(1)?,
                precio,
                precio_unitario: precio_por_unidad(precio, factor),
                fecha: f.get(4)?,
                mejor: false,
            })
        })
        .map_err(fallo)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(fallo)?;

    filas.sort_by_key(|f| f.precio_unitario);

    // Se marcan todos los que empatan en el mínimo. Marcar solo al primero
    // sería decidir por sorteo entre dos proveedores que cobran lo mismo.
    if let Some(minimo) = filas.first().map(|f| f.precio_unitario) {
        for fila in filas.iter_mut().filter(|f| f.precio_unitario == minimo) {
            fila.mejor = true;
        }
    }
    Ok(filas)
}

/// Lo que cuesta cada unidad dentro de un empaque, redondeado al peso.
///
/// Se redondea al más cercano en vez de truncar porque truncar hace ver
/// más barato de lo que es: una canasta de 30 a 60.001 saldría a 2.000 la
/// botella cuando en realidad se paga un peso más.
fn precio_por_unidad(precio: i64, factor: i64) -> i64 {
    if factor <= 0 {
        return precio;
    }
    (precio + factor / 2) / factor
}

#[tauri::command]
pub fn registrar_compra(
    estado: State<'_, EstadoApp>,
    compra: CompraEntrante,
    rol: Rol,
) -> Result<CompraRegistrada, ErrorApp> {
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::COMPRA_REGISTRAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para registrar compras.", e))?;

    compras::registrar(&mut db, &compra).map_err(|e| match e {
        compras::ErrorCompra::CompraVacia =>
            ErrorApp::nuevo("Agrega al menos un producto a la compra.", e),
        compras::ErrorCompra::ProveedorInvalido =>
            ErrorApp::nuevo("Elige un proveedor.", e),
        compras::ErrorCompra::CantidadInvalida =>
            ErrorApp::nuevo("Las cantidades deben ser mayores que cero.", e),
        otro => ErrorApp::nuevo(
            "No se pudo registrar la compra. No se modificó el inventario; \
             inténtalo de nuevo.",
            otro,
        ),
    })
}

#[tauri::command]
pub fn anular_compra(
    estado: State<'_, EstadoApp>,
    compra_id: i64,
    motivo: String,
    usuario_id: i64,
    rol: Rol,
) -> Result<(), ErrorApp> {
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::COMPRA_ANULAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para anular compras.", e))?;

    compras::anular(&mut db, compra_id, &motivo, usuario_id).map_err(|e| match e {
        compras::ErrorCompra::YaAnulada =>
            ErrorApp::nuevo("Esta compra ya estaba anulada.", e),
        otro => ErrorApp::nuevo(
            "No se pudo anular la compra. No se modificó nada; inténtalo de nuevo.", otro),
    })
}

#[cfg(test)]
mod pruebas {
    use super::precio_por_unidad;

    /// El caso que motivo el cambio: comparar por el precio del empaque
    /// daba la respuesta al reves.
    #[test]
    fn la_canasta_barata_le_gana_a_la_botella_cara() {
        let canasta = precio_por_unidad(60_000, 30); // 2.000 la botella
        let suelta = precio_por_unidad(2_400, 1);    // 2.400 la botella

        let precio_canasta = 60_000;
        let precio_suelta = 2_400;

        assert_eq!(canasta, 2_000);
        assert_eq!(suelta, 2_400);
        assert!(canasta < suelta, "la canasta sale mas barata por botella");
        assert!(
            precio_canasta > precio_suelta,
            "y sin embargo su precio es mayor: ordenar por ahi da la respuesta al reves",
        );
    }

    #[test]
    fn el_six_se_reparte_entre_seis() {
        assert_eq!(precio_por_unidad(25_000, 6), 4_167);
    }

    #[test]
    fn sin_empaque_el_precio_ya_es_por_unidad() {
        assert_eq!(precio_por_unidad(3_500, 1), 3_500);
    }

    /// Truncar haria ver mas barato de lo que se paga.
    #[test]
    fn redondea_al_peso_mas_cercano_en_vez_de_truncar() {
        assert_eq!(precio_por_unidad(60_001, 30), 2_000);
        assert_eq!(precio_por_unidad(60_020, 30), 2_001);
    }

    /// Un factor invalido no deberia existir -- la tabla lo prohibe -- pero
    /// dividir por cero tumbaria el programa entero.
    #[test]
    fn un_factor_imposible_no_tumba_nada() {
        assert_eq!(precio_por_unidad(5_000, 0), 5_000);
        assert_eq!(precio_por_unidad(5_000, -3), 5_000);
    }
}
