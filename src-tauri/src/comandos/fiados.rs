//! Comandos de fiados.
//!
//! Ver quién debe y recibir abonos es parte de la caja del día, no del
//! fondo del negocio: el cajero que recibe un abono en efectivo tiene que
//! poder anotarlo. Por eso el permiso es el de vender y no el financiero.
//!
//! Cambiar cupos y dar de baja clientes sí exige más: es política de a
//! quién se le fía y hasta cuánto.

use tauri::State;

use crate::fiados::{
    self, AbonoHecho, ClienteConSaldo, ClienteEditable, CuentaCliente, ErrorFiado,
    ResultadoAbono,
};
use crate::usuarios::{permisos, Rol};
use crate::{ErrorApp, EstadoApp};

fn traducir(error: ErrorFiado) -> ErrorApp {
    use ErrorFiado as E;
    match error {
        E::NombreVacio => ErrorApp::nuevo("Escribe a nombre de quién queda.", error),
        E::ClienteNoExiste => ErrorApp::nuevo("Ese cliente ya no existe.", error),
        E::CuentaNoExiste => ErrorApp::nuevo("Esa cuenta ya no existe.", error),
        E::MontoInvalido => ErrorApp::nuevo("El abono tiene que ser mayor que cero.", error),
        E::AbonoExcesivo { saldo, .. } => {
            ErrorApp::nuevo(format!("De esa venta solo deben ${saldo}."), error)
        }
        E::FaltaCliente => ErrorApp::nuevo(
            "Para fiar hay que decir a nombre de quién queda: una deuda sin dueño \
             no se puede cobrar después.",
            error,
        ),
        E::ClienteInactivo => ErrorApp::nuevo(
            "Ese cliente está dado de baja. Reactívalo si le vas a volver a fiar.",
            error,
        ),
        E::SinCupo { cupo, quedaria } => ErrorApp::nuevo(
            format!("Se pasa del cupo: quedaría debiendo ${quedaria} y el tope es ${cupo}."),
            error,
        ),
        E::AbonoYaAnulado => ErrorApp::nuevo("Ese abono ya está anulado.", error),
        E::FaltaMotivo => ErrorApp::nuevo("Escribe por qué se anula el abono.", error),
        E::ConSaldo => ErrorApp::nuevo(
            "Ese cliente todavía debe. Dar de baja a quien debe es la forma de \
             perder de vista una deuda.",
            error,
        ),
        E::SinCaja => ErrorApp::nuevo(
            "Para recibir un abono en efectivo tiene que haber una caja abierta, \
             o esa plata queda fuera del arqueo.",
            error,
        ),
        otro => ErrorApp::nuevo("No se pudo guardar. No se modificó nada.", otro),
    }
}

macro_rules! con_permiso {
    ($estado:expr, $rol:expr, $permiso:expr, $mensaje:expr) => {{
        let db = $estado
            .db
            .lock()
            .map_err(|e| ErrorApp::nuevo("No fue posible acceder a la base de datos.", e))?;
        permisos::exigir(&db, $rol, $permiso)
            .map_err(|e| ErrorApp::nuevo($mensaje, e))?;
        db
    }};
}

#[tauri::command]
pub fn clientes_con_saldo(
    estado: State<'_, EstadoApp>,
    rol: Rol,
) -> Result<Vec<ClienteConSaldo>, ErrorApp> {
    let db = con_permiso!(
        estado, rol, permisos::VENTA_CREAR,
        "No tienes permiso para ver los fiados."
    );
    fiados::clientes(&db).map_err(traducir)
}

#[tauri::command]
pub fn cuentas_del_cliente(
    estado: State<'_, EstadoApp>,
    cliente_id: i64,
    solo_pendientes: bool,
    rol: Rol,
) -> Result<Vec<CuentaCliente>, ErrorApp> {
    let db = con_permiso!(
        estado, rol, permisos::VENTA_CREAR,
        "No tienes permiso para ver los fiados."
    );
    fiados::cuentas_de(&db, cliente_id, solo_pendientes).map_err(traducir)
}

#[tauri::command]
pub fn abonar(
    estado: State<'_, EstadoApp>,
    cuenta_id: i64,
    monto: i64,
    metodo_pago_id: i64,
    usuario_id: i64,
    nota: Option<String>,
    rol: Rol,
) -> Result<ResultadoAbono, ErrorApp> {
    let mut db = con_permiso!(
        estado, rol, permisos::VENTA_CREAR,
        "No tienes permiso para recibir abonos."
    );
    fiados::abonar(&mut db, cuenta_id, monto, metodo_pago_id, usuario_id, nota.as_deref())
        .map_err(traducir)
}

#[tauri::command]
pub fn anular_abono(
    estado: State<'_, EstadoApp>,
    abono_id: i64,
    motivo: String,
    usuario_id: i64,
    rol: Rol,
) -> Result<(), ErrorApp> {
    let mut db = con_permiso!(
        estado, rol, permisos::VENTA_ANULAR,
        "No tienes permiso para anular abonos."
    );
    fiados::anular_abono(&mut db, abono_id, &motivo, usuario_id).map_err(traducir)
}

#[tauri::command]
pub fn abonos_de_cuenta(
    estado: State<'_, EstadoApp>,
    cuenta_id: i64,
    rol: Rol,
) -> Result<Vec<AbonoHecho>, ErrorApp> {
    let db = con_permiso!(
        estado, rol, permisos::VENTA_CREAR,
        "No tienes permiso para ver los fiados."
    );
    fiados::abonos_de(&db, cuenta_id).map_err(traducir)
}

#[tauri::command]
pub fn guardar_cliente(
    estado: State<'_, EstadoApp>,
    cliente: ClienteEditable,
    rol: Rol,
) -> Result<i64, ErrorApp> {
    let db = con_permiso!(
        estado, rol, permisos::VENTA_CREAR,
        "No tienes permiso para editar clientes."
    );
    match cliente.id {
        None => fiados::crear_cliente(&db, &cliente).map_err(traducir),
        Some(id) => fiados::editar_cliente(&db, &cliente).map(|()| id).map_err(traducir),
    }
}

#[tauri::command]
pub fn desactivar_cliente(
    estado: State<'_, EstadoApp>,
    cliente_id: i64,
    rol: Rol,
) -> Result<(), ErrorApp> {
    let db = con_permiso!(
        estado, rol, permisos::PRODUCTO_EDITAR,
        "No tienes permiso para dar de baja clientes."
    );
    fiados::desactivar_cliente(&db, cliente_id).map_err(traducir)
}

#[tauri::command]
pub fn reactivar_cliente(
    estado: State<'_, EstadoApp>,
    cliente_id: i64,
    rol: Rol,
) -> Result<(), ErrorApp> {
    let db = con_permiso!(
        estado, rol, permisos::PRODUCTO_EDITAR,
        "No tienes permiso para reactivar clientes."
    );
    fiados::reactivar_cliente(&db, cliente_id).map_err(traducir)
}
