//! Permisos.
//!
//! Los codigos viven en constantes para que un error de escritura sea un
//! error de compilacion y no un permiso que nunca concede nada. Quien los
//! tiene lo dice la tabla `rol_permisos`, que se puede ajustar sin
//! recompilar.
//!
//! La comprobacion ocurre aqui, no en la pantalla. Un boton escondido
//! sigue teniendo su comando detras.

use rusqlite::{params, Connection};

use super::{ErrorUsuario, Rol};

pub const VENTA_CREAR: &str = "venta.crear";
pub const VENTA_ANULAR: &str = "venta.anular";
pub const VENTA_VER_TODAS: &str = "venta.ver_todas";
pub const VENTA_DESCUENTO: &str = "venta.descuento";

pub const CAJA_ABRIR: &str = "caja.abrir";
pub const CAJA_CERRAR: &str = "caja.cerrar";
pub const CAJA_MOVIMIENTO: &str = "caja.movimiento";
pub const CAJA_VER_TODAS: &str = "caja.ver_todas";

pub const PRODUCTO_CREAR: &str = "producto.crear";
pub const PRODUCTO_EDITAR: &str = "producto.editar";
pub const PRODUCTO_DESACTIVAR: &str = "producto.desactivar";
pub const PRODUCTO_PRECIO: &str = "producto.precio";

pub const INVENTARIO_AJUSTAR: &str = "inventario.ajustar";
pub const INVENTARIO_VER: &str = "inventario.ver";

pub const COMPRA_REGISTRAR: &str = "compra.registrar";
pub const COMPRA_ANULAR: &str = "compra.anular";
pub const PROVEEDOR_GESTIONAR: &str = "proveedor.gestionar";

pub const COSTO_VER: &str = "costo.ver";
pub const UTILIDAD_VER: &str = "utilidad.ver";
pub const REPORTE_OPERACION: &str = "reporte.operacion";
pub const REPORTE_FINANCIERO: &str = "reporte.financiero";

pub const USUARIO_GESTIONAR: &str = "usuario.gestionar";
pub const PERMISO_GESTIONAR: &str = "permiso.gestionar";
pub const CONFIG_EDITAR: &str = "config.editar";
pub const AUDITORIA_VER: &str = "auditoria.ver";

pub const RESPALDO_CREAR: &str = "respaldo.crear";
pub const RESPALDO_RESTAURAR: &str = "respaldo.restaurar";
pub const EXCEL_IMPORTAR: &str = "excel.importar";
pub const EXCEL_EXPORTAR: &str = "excel.exportar";

pub fn tiene(conexion: &Connection, rol: Rol, permiso: &str) -> Result<bool, ErrorUsuario> {
    let cuenta: i64 = conexion.query_row(
        "SELECT COUNT(*) FROM rol_permisos WHERE rol = ?1 AND permiso = ?2",
        params![rol.codigo(), permiso],
        |f| f.get(0),
    )?;
    Ok(cuenta > 0)
}

/// Exige un permiso. Es la funcion que llaman los comandos antes de
/// hacer cualquier cosa que importe.
pub fn exigir(conexion: &Connection, rol: Rol, permiso: &str) -> Result<(), ErrorUsuario> {
    if tiene(conexion, rol, permiso)? {
        return Ok(());
    }
    Err(ErrorUsuario::SinPermiso {
        permiso: permiso.to_owned(),
    })
}

/// Todos los permisos de un rol, para que la interfaz sepa que mostrar.
/// Es una comodidad visual, no el control: el control esta en `exigir`.
pub fn de_rol(conexion: &Connection, rol: Rol) -> Result<Vec<String>, ErrorUsuario> {
    let mut consulta =
        conexion.prepare("SELECT permiso FROM rol_permisos WHERE rol = ?1 ORDER BY permiso")?;
    let permisos = consulta
        .query_map(params![rol.codigo()], |f| f.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(permisos)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db::abrir_en_memoria;

    #[test]
    fn el_administrador_puede_con_todo_lo_sensible() {
        let db = abrir_en_memoria().unwrap();
        for permiso in [
            USUARIO_GESTIONAR, PRODUCTO_PRECIO, COSTO_VER, UTILIDAD_VER,
            RESPALDO_RESTAURAR, AUDITORIA_VER, CONFIG_EDITAR, VENTA_ANULAR,
        ] {
            assert!(
                tiene(&db, Rol::Administrador, permiso).unwrap(),
                "el administrador deberia poder {permiso}"
            );
        }
    }

    #[test]
    fn el_cajero_vende_pero_no_toca_lo_administrativo() {
        let db = abrir_en_memoria().unwrap();

        assert!(tiene(&db, Rol::Cajero, VENTA_CREAR).unwrap());
        assert!(tiene(&db, Rol::Cajero, CAJA_ABRIR).unwrap());
        assert!(tiene(&db, Rol::Cajero, CAJA_CERRAR).unwrap());

        for prohibido in [
            VENTA_ANULAR, INVENTARIO_AJUSTAR, PRODUCTO_PRECIO, COSTO_VER,
            USUARIO_GESTIONAR, RESPALDO_RESTAURAR, AUDITORIA_VER,
        ] {
            assert!(
                !tiene(&db, Rol::Cajero, prohibido).unwrap(),
                "el cajero no deberia poder {prohibido}"
            );
        }
    }

    #[test]
    fn el_encargado_opera_el_local_pero_no_ve_costos_ni_cambia_precios() {
        let db = abrir_en_memoria().unwrap();

        assert!(tiene(&db, Rol::Encargado, VENTA_ANULAR).unwrap());
        assert!(tiene(&db, Rol::Encargado, INVENTARIO_AJUSTAR).unwrap());
        assert!(tiene(&db, Rol::Encargado, COMPRA_REGISTRAR).unwrap());

        // Lo que se protege del encargado es justo el dinero de fondo.
        for prohibido in [COSTO_VER, UTILIDAD_VER, PRODUCTO_PRECIO,
                          USUARIO_GESTIONAR, RESPALDO_RESTAURAR] {
            assert!(
                !tiene(&db, Rol::Encargado, prohibido).unwrap(),
                "el encargado no deberia poder {prohibido}"
            );
        }
    }

    #[test]
    fn un_permiso_que_no_existe_no_lo_tiene_nadie() {
        let db = abrir_en_memoria().unwrap();
        for rol in [Rol::Administrador, Rol::Encargado, Rol::Cajero] {
            assert!(!tiene(&db, rol, "permiso.inventado").unwrap());
        }
    }

    #[test]
    fn exigir_deja_pasar_o_corta() {
        let db = abrir_en_memoria().unwrap();
        assert!(exigir(&db, Rol::Administrador, VENTA_ANULAR).is_ok());
        assert!(exigir(&db, Rol::Cajero, VENTA_ANULAR).is_err());
    }

    #[test]
    fn el_administrador_tiene_mas_permisos_que_el_encargado_y_este_mas_que_el_cajero() {
        let db = abrir_en_memoria().unwrap();
        let admin = de_rol(&db, Rol::Administrador).unwrap().len();
        let encargado = de_rol(&db, Rol::Encargado).unwrap().len();
        let cajero = de_rol(&db, Rol::Cajero).unwrap().len();

        assert!(admin > encargado && encargado > cajero,
                "admin {admin}, encargado {encargado}, cajero {cajero}");
    }
}
