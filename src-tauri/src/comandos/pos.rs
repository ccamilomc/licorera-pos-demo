//! Comandos del punto de venta y de la caja.
//!
//! Cada uno comprueba el permiso antes de hacer nada: la pantalla puede
//! esconder un boton, pero el comando sigue existiendo.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::caja::{self, Caja, CierreCaja, ResumenCaja, TipoMovimiento};
use crate::usuarios::{permisos, Rol};
use crate::ventas::{self, VentaEntrante, VentaRegistrada};
use crate::{ErrorApp, EstadoApp};

/// Producto tal como lo necesita la caja: con sus formas de venta y su
/// texto de busqueda ya preparado.
#[derive(Debug, Serialize)]
pub struct ProductoParaVender {
    pub id: i64,
    pub codigo: String,
    pub nombre: String,
    pub categoria: String,
    pub presentacion: String,
    pub envase: Option<String>,
    pub existencia: i64,
    pub precio_venta: i64,
    /// Nombre, presentacion y codigos, sin tildes y en minusculas, para
    /// que buscar 'nectar' encuentre 'Néctar'.
    pub busqueda: String,
    pub codigos_barras: Vec<String>,
    /// Las formas con las que se puede cobrar: activas, marcadas para
    /// venta y con precio propio.
    pub empaques: Vec<EmpaqueParaVender>,
    /// Las formas con las que llega mercancia. No necesitan precio de
    /// venta: una canasta puede servir solo para recibir. Van aparte
    /// porque la caja no puede cobrar lo que no tiene precio.
    pub empaques_compra: Vec<EmpaqueParaComprar>,
}

#[derive(Debug, Serialize)]
pub struct EmpaqueParaVender {
    pub id: i64,
    pub nombre: String,
    pub factor: i64,
    pub precio_venta: i64,
    pub predeterminado: bool,
}

#[derive(Debug, Serialize)]
pub struct EmpaqueParaComprar {
    pub id: i64,
    pub nombre: String,
    pub factor: i64,
    /// Si es None, esa forma todavia no se puede vender. La pantalla lo
    /// dice en vez de esconder la forma, que es como el dueño se entera
    /// de que le falta ponerle precio.
    pub precio_venta: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct DatosApertura {
    pub usuario_id: i64,
    pub rol: Rol,
    pub base_inicial: i64,
    pub observaciones: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DatosCierre {
    pub usuario_id: i64,
    pub rol: Rol,
    pub caja_id: i64,
    pub efectivo_contado: i64,
    pub observaciones: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DatosMovimiento {
    pub usuario_id: i64,
    pub rol: Rol,
    pub caja_id: i64,
    pub es_entrada: bool,
    pub concepto: String,
    pub monto: i64,
}

#[derive(Debug, Deserialize)]
pub struct DatosAnulacion {
    pub venta_id: i64,
    pub motivo: String,
    pub usuario_id: i64,
    pub rol: Rol,
    /// Quien autorizo, cuando el cajero no tiene el permiso por si mismo.
    pub autorizado_por: Option<i64>,
}

/// Quita tildes y pasa a minusculas. En una caja se escribe rapido y sin
/// tildes; la busqueda tiene que encontrar igual.
fn para_buscar(texto: &str) -> String {
    texto
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            otro => otro,
        })
        .collect()
}

/// Catalogo completo para la caja.
///
/// Se carga entero de una vez y se busca en memoria: con unos cientos de
/// productos eso responde al instante y sin ir a la base en cada tecla.
#[tauri::command]
pub fn catalogo_venta(
    estado: State<'_, EstadoApp>,
) -> Result<Vec<ProductoParaVender>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudo cargar el catalogo.", e);

    let mut consulta = db
        .prepare(
            "SELECT p.id, p.codigo, p.nombre, c.nombre, p.presentacion,
                    p.envase, p.existencia, p.precio_venta
             FROM productos p
             JOIN categorias c ON c.id = p.categoria_id
             WHERE p.activo = 1
             ORDER BY c.orden, p.nombre",
        )
        .map_err(fallo)?;

    let mut productos: Vec<ProductoParaVender> = consulta
        .query_map([], |f| {
            let nombre: String = f.get(2)?;
            let presentacion: String = f.get(4)?;
            let codigo: String = f.get(1)?;
            Ok(ProductoParaVender {
                id: f.get(0)?,
                busqueda: para_buscar(&format!("{nombre} {presentacion} {codigo}")),
                codigo,
                nombre,
                categoria: f.get(3)?,
                presentacion,
                envase: f.get(5)?,
                existencia: f.get(6)?,
                precio_venta: f.get(7)?,
                codigos_barras: Vec::new(),
                empaques: Vec::new(),
                empaques_compra: Vec::new(),
            })
        })
        .map_err(fallo)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(fallo)?;

    // Empaques y codigos se traen de una vez y se reparten en memoria,
    // en vez de una consulta por producto.
    let mut por_producto: std::collections::HashMap<i64, Vec<EmpaqueParaVender>> =
        std::collections::HashMap::new();
    {
        let mut c = db
            .prepare(
                "SELECT producto_id, id, nombre, factor, precio_venta, predeterminado
                 FROM producto_empaques
                 WHERE activo = 1 AND para_venta = 1 AND precio_venta IS NOT NULL
                 ORDER BY producto_id, orden",
            )
            .map_err(fallo)?;
        let filas = c
            .query_map([], |f| {
                Ok((
                    f.get::<_, i64>(0)?,
                    EmpaqueParaVender {
                        id: f.get(1)?,
                        nombre: f.get(2)?,
                        factor: f.get(3)?,
                        precio_venta: f.get(4)?,
                        predeterminado: f.get::<_, i64>(5)? == 1,
                    },
                ))
            })
            .map_err(fallo)?;
        for fila in filas {
            let (id, e) = fila.map_err(fallo)?;
            por_producto.entry(id).or_default().push(e);
        }
    }

    let mut compra_por_producto: std::collections::HashMap<i64, Vec<EmpaqueParaComprar>> =
        std::collections::HashMap::new();
    {
        let mut c = db
            .prepare(
                "SELECT producto_id, id, nombre, factor, precio_venta
                 FROM producto_empaques
                 WHERE activo = 1 AND para_compra = 1
                 ORDER BY producto_id, factor",
            )
            .map_err(fallo)?;
        let filas = c
            .query_map([], |f| {
                Ok((
                    f.get::<_, i64>(0)?,
                    EmpaqueParaComprar {
                        id: f.get(1)?,
                        nombre: f.get(2)?,
                        factor: f.get(3)?,
                        precio_venta: f.get(4)?,
                    },
                ))
            })
            .map_err(fallo)?;
        for fila in filas {
            let (id, e) = fila.map_err(fallo)?;
            compra_por_producto.entry(id).or_default().push(e);
        }
    }

    let mut codigos: std::collections::HashMap<i64, Vec<String>> =
        std::collections::HashMap::new();
    {
        let mut c = db
            .prepare("SELECT producto_id, codigo FROM producto_codigos")
            .map_err(fallo)?;
        let filas = c
            .query_map([], |f| Ok((f.get::<_, i64>(0)?, f.get::<_, String>(1)?)))
            .map_err(fallo)?;
        for fila in filas {
            let (id, codigo) = fila.map_err(fallo)?;
            codigos.entry(id).or_default().push(codigo);
        }
    }

    for p in &mut productos {
        p.empaques = por_producto.remove(&p.id).unwrap_or_default();
        p.empaques_compra = compra_por_producto.remove(&p.id).unwrap_or_default();
        p.codigos_barras = codigos.remove(&p.id).unwrap_or_default();
        if !p.codigos_barras.is_empty() {
            p.busqueda = format!("{} {}", p.busqueda, p.codigos_barras.join(" "));
        }
    }

    Ok(productos)
}

#[derive(Debug, Serialize)]
pub struct MetodoDePago {
    pub id: i64,
    pub codigo: String,
    pub nombre: String,
    pub es_efectivo: bool,
}

/// Las formas de cobro que el negocio tiene activas.
///
/// La caja las traia escritas a mano con los ids 1, 2 y 3. Funcionaba de
/// casualidad: nada garantiza que la base les de esos numeros, y una
/// forma nueva -- fiado, sin ir mas lejos -- no aparecia hasta tocar el
/// codigo de la pantalla.
#[tauri::command]
pub fn metodos_de_pago(estado: State<'_, EstadoApp>) -> Result<Vec<MetodoDePago>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    let fallo = |e: rusqlite::Error| ErrorApp::nuevo("No se pudieron cargar las formas de pago.", e);

    let mut consulta = db
        .prepare(
            "SELECT id, codigo, nombre, es_efectivo FROM metodos_pago
             WHERE activo = 1 ORDER BY orden, nombre",
        )
        .map_err(fallo)?;
    let filas = consulta
        .query_map([], |f| {
            Ok(MetodoDePago {
                id: f.get(0)?,
                codigo: f.get(1)?,
                nombre: f.get(2)?,
                es_efectivo: f.get::<_, i64>(3)? == 1,
            })
        })
        .map_err(fallo)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(fallo)?;
    Ok(filas)
}

#[tauri::command]
pub fn caja_abierta(estado: State<'_, EstadoApp>) -> Result<Option<Caja>, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    caja::abierta(&db).map_err(|e| ErrorApp::nuevo("No se pudo consultar la caja.", e))
}

#[tauri::command]
pub fn abrir_caja(estado: State<'_, EstadoApp>, datos: DatosApertura) -> Result<Caja, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, datos.rol, permisos::CAJA_ABRIR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para abrir la caja.", e))?;

    caja::abrir(
        &db,
        datos.usuario_id,
        datos.base_inicial,
        datos.observaciones.as_deref(),
    )
    .map_err(|e| match e {
        caja::ErrorCaja::YaHayCajaAbierta => ErrorApp::nuevo(
            "Ya hay una caja abierta. Cierrala antes de abrir otra.", e),
        caja::ErrorCaja::MontoInvalido => ErrorApp::nuevo(
            "La base inicial no puede ser negativa.", e),
        otro => ErrorApp::nuevo("No se pudo abrir la caja.", otro),
    })
}

#[tauri::command]
pub fn resumen_caja(
    estado: State<'_, EstadoApp>,
    caja_id: i64,
) -> Result<ResumenCaja, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
    caja::resumen(&db, caja_id)
        .map_err(|e| ErrorApp::nuevo("No se pudo calcular el resumen de la caja.", e))
}

#[tauri::command]
pub fn cerrar_caja(
    estado: State<'_, EstadoApp>,
    datos: DatosCierre,
) -> Result<CierreCaja, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, datos.rol, permisos::CAJA_CERRAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para cerrar la caja.", e))?;

    caja::cerrar(
        &db,
        datos.caja_id,
        datos.efectivo_contado,
        datos.usuario_id,
        datos.observaciones.as_deref(),
    )
    .map_err(|e| match e {
        caja::ErrorCaja::FaltaExplicacion => ErrorApp::nuevo(
            "El dinero contado no coincide con lo esperado. Escribe una nota \
             explicando la diferencia para poder cerrar.",
            e,
        ),
        otro => ErrorApp::nuevo("No se pudo cerrar la caja.", otro),
    })
}

#[tauri::command]
pub fn movimiento_caja(
    estado: State<'_, EstadoApp>,
    datos: DatosMovimiento,
) -> Result<i64, ErrorApp> {
    let db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, datos.rol, permisos::CAJA_MOVIMIENTO)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para mover dinero de la caja.", e))?;

    let tipo = if datos.es_entrada {
        TipoMovimiento::Entrada
    } else {
        TipoMovimiento::Salida
    };

    caja::registrar_movimiento(
        &db, datos.caja_id, tipo, &datos.concepto, datos.monto, datos.usuario_id,
    )
    .map_err(|e| match e {
        caja::ErrorCaja::MontoInvalido =>
            ErrorApp::nuevo("El monto debe ser mayor que cero.", e),
        otro => ErrorApp::nuevo("No se pudo registrar el movimiento.", otro),
    })
}

#[tauri::command]
pub fn registrar_venta(
    estado: State<'_, EstadoApp>,
    venta: VentaEntrante,
    rol: Rol,
) -> Result<VentaRegistrada, ErrorApp> {
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    permisos::exigir(&db, rol, permisos::VENTA_CREAR)
        .map_err(|e| ErrorApp::nuevo("No tienes permiso para vender.", e))?;

    ventas::registrar(&mut db, &venta).map_err(|e| match e {
        ventas::ErrorVenta::SinCajaAbierta => ErrorApp::nuevo(
            "No hay caja abierta. Abre la caja para empezar a vender.", e),
        ventas::ErrorVenta::PagoNoCuadra { pagado, total } => ErrorApp::nuevo(
            format!("El pago no cuadra: se registraron {pagado} y la venta vale {total}."), e),
        ventas::ErrorVenta::VentaVacia => ErrorApp::nuevo(
            "No hay productos en la venta.", e),
        otro => ErrorApp::nuevo(
            "No se pudo guardar la venta. No se cobro nada y el inventario no cambio; \
             intentalo de nuevo.",
            otro,
        ),
    })
}

#[tauri::command]
pub fn anular_venta(
    estado: State<'_, EstadoApp>,
    datos: DatosAnulacion,
) -> Result<(), ErrorApp> {
    let mut db = estado
        .db
        .lock()
        .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;

    // El cajero no puede anular por si mismo, pero si con la autorizacion
    // de alguien que si pueda: es lo que evita cerrar sesion a media venta.
    let tiene_permiso = permisos::tiene(&db, datos.rol, permisos::VENTA_ANULAR)
        .map_err(|e| ErrorApp::nuevo("No se pudo comprobar el permiso.", e))?;

    if !tiene_permiso && datos.autorizado_por.is_none() {
        return Err(ErrorApp::nuevo(
            "No tienes permiso para anular ventas. Pide autorizacion a un administrador.",
            "anular sin permiso ni autorizacion",
        ));
    }

    ventas::anular(
        &mut db,
        datos.venta_id,
        &datos.motivo,
        datos.usuario_id,
        datos.autorizado_por,
    )
    .map_err(|e| match e {
        ventas::ErrorVenta::YaAnulada =>
            ErrorApp::nuevo("Esta venta ya estaba anulada.", e),
        ventas::ErrorVenta::FaltaMotivo =>
            ErrorApp::nuevo("Escribe por que se anula la venta.", e),
        ventas::ErrorVenta::SinCajaAbierta => ErrorApp::nuevo(
            "Abre la caja antes de anular: la devolucion tiene que quedar registrada.", e),
        otro => ErrorApp::nuevo(
            "No se pudo anular la venta. No se modifico nada; intentalo de nuevo.", otro),
    })
}

#[cfg(test)]
mod pruebas {
    use super::para_buscar;

    #[test]
    fn la_busqueda_ignora_tildes_y_mayusculas() {
        assert_eq!(para_buscar("Néctar Azul"), "nectar azul");
        assert_eq!(para_buscar("CHAMPAÑA"), "champana");
        assert_eq!(para_buscar("Águila Light"), "aguila light");
    }
}
