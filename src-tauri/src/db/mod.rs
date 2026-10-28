//! Conexion a SQLite y arranque de la base.
//!
//! La base vive en la carpeta de datos de la aplicacion, no junto al
//! ejecutable: asi actualizar el programa nunca toca la informacion del
//! negocio.

pub mod migraciones;

use rusqlite::Connection;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum ErrorBase {
    #[error("no se pudo abrir la base de datos")]
    Apertura(#[source] rusqlite::Error),
    #[error("no se pudo preparar la base de datos")]
    Configuracion(#[source] rusqlite::Error),
    #[error("fallo la migracion {version}")]
    Migracion {
        version: i32,
        #[source]
        fuente: rusqlite::Error,
    },
    #[error("error de base de datos")]
    Sqlite(#[from] rusqlite::Error),
}

/// Abre la base y la deja lista para operar.
///
/// Las tres opciones que se aplican no son adorno:
///
/// - `journal_mode = WAL` es lo que protege contra el corte de luz. Cada
///   transaccion se escribe primero en un diario aparte y solo despues se
///   consolida; si el equipo se apaga a la mitad, al abrir de nuevo SQLite
///   termina o deshace la operacion. Nunca queda media venta.
/// - `foreign_keys = ON` porque en SQLite vienen apagadas por omision, y
///   sin esto las claves foraneas del esquema serian decoracion.
/// - `busy_timeout` evita que una escritura falle al instante si la base
///   esta ocupada un momento.
pub fn abrir(ruta: &Path) -> Result<Connection, ErrorBase> {
    abrir_hasta(ruta, i32::MAX)
}

/// Como `abrir`, pero sin el catalogo del negocio.
///
/// La usan las pruebas que necesitan una base en archivo y no quieren
/// ciento cincuenta productos de ruido dentro. No la llama la aplicacion:
/// al instalar, el catalogo tiene que estar.
pub fn abrir_sin_catalogo(ruta: &Path) -> Result<Connection, ErrorBase> {
    abrir_hasta(ruta, migraciones::SIN_CATALOGO)
}

fn abrir_hasta(ruta: &Path, tope: i32) -> Result<Connection, ErrorBase> {
    let conexion = Connection::open(ruta).map_err(ErrorBase::Apertura)?;
    configurar(&conexion)?;
    migraciones::aplicar_hasta(&conexion, tope)?;
    Ok(conexion)
}

/// Base en memoria, para las pruebas.
pub fn abrir_en_memoria() -> Result<Connection, ErrorBase> {
    abrir_en_memoria_hasta(migraciones::SIN_CATALOGO)
}

/// Una base en memoria con el catalogo del negocio ya cargado.
///
/// Es lo que ve el usuario al instalar. Para las pruebas casi nunca sirve
/// —ciento cincuenta productos de ruido cuando se quiere comprobar una
/// suma— por eso `abrir_en_memoria` los deja fuera y esta existe aparte.
pub fn abrir_en_memoria_con_catalogo() -> Result<Connection, ErrorBase> {
    abrir_en_memoria_hasta(i32::MAX)
}

fn abrir_en_memoria_hasta(tope: i32) -> Result<Connection, ErrorBase> {
    let conexion = Connection::open_in_memory().map_err(ErrorBase::Apertura)?;
    conexion
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(ErrorBase::Configuracion)?;
    migraciones::aplicar_hasta(&conexion, tope)?;
    Ok(conexion)
}

fn configurar(conexion: &Connection) -> Result<(), ErrorBase> {
    conexion
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(ErrorBase::Configuracion)?;
    conexion
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(ErrorBase::Configuracion)?;
    conexion
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(ErrorBase::Configuracion)?;
    conexion
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(ErrorBase::Configuracion)?;
    Ok(())
}

/// Revisa que la base no este corrupta. Se usa al restaurar un respaldo
/// y antes de marcar una copia como verificada.
pub fn verificar_integridad(conexion: &Connection) -> Result<bool, ErrorBase> {
    let resultado: String =
        conexion.query_row("PRAGMA integrity_check", [], |fila| fila.get(0))?;
    Ok(resultado == "ok")
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn la_base_arranca_con_las_tablas_y_los_datos_base() {
        let db = abrir_en_memoria().expect("debe abrir");

        // Por nombre y no por cuenta: un numero escrito a mano hay que
        // subirlo cada vez que se agrega una tabla, y lo unico que dice
        // cuando falla es que el numero cambio. Estas son las que
        // sostienen el negocio; si falta alguna, el error dice cual.
        for tabla in [
            "usuarios", "roles", "rol_permisos", "cajas", "movimientos_caja",
            "productos", "producto_empaques", "categorias", "proveedores",
            "movimientos_inventario", "ventas", "venta_items", "venta_pagos",
            "anulaciones", "compras", "compra_items", "auditoria",
            "configuracion", "gastos", "gasto_categorias",
            "clientes", "cuentas_cobrar", "abonos", "pagos_compra",
        ] {
            let existe: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [tabla],
                    |f| f.get(0),
                )
                .unwrap();
            assert_eq!(existe, 1, "falta la tabla {tabla}");
        }

        let roles: i64 = db
            .query_row("SELECT COUNT(*) FROM roles", [], |f| f.get(0))
            .unwrap();
        assert_eq!(roles, 3);

        assert!(verificar_integridad(&db).unwrap());
    }

    #[test]
    fn las_claves_foraneas_estan_activas() {
        let db = abrir_en_memoria().unwrap();
        // Un usuario con un rol inexistente debe ser rechazado.
        let resultado = db.execute(
            "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
             VALUES ('x', 'X', 'h', 'ROL_QUE_NO_EXISTE')",
            [],
        );
        assert!(resultado.is_err(), "la clave foranea debe bloquearlo");
    }

    #[test]
    fn no_deja_dos_cajas_abiertas() {
        let db = abrir_en_memoria().unwrap();
        db.execute(
            "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
             VALUES ('admin', 'Camilo', 'h', 'ADMINISTRADOR')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO cajas (usuario_apertura, base_inicial) VALUES (1, 100000)",
            [],
        )
        .unwrap();
        let segunda = db.execute(
            "INSERT INTO cajas (usuario_apertura, base_inicial) VALUES (1, 50000)",
            [],
        );
        assert!(segunda.is_err(), "solo puede haber una caja abierta");
    }

    #[test]
    fn la_auditoria_no_se_puede_alterar() {
        let db = abrir_en_memoria().unwrap();
        db.execute(
            "INSERT INTO auditoria (usuario_nombre, accion, entidad, descripcion)
             VALUES ('Camilo', 'PRUEBA', 'x', 'y')",
            [],
        )
        .unwrap();
        assert!(db
            .execute("UPDATE auditoria SET descripcion = 'otro' WHERE id = 1", [])
            .is_err());
        assert!(db.execute("DELETE FROM auditoria WHERE id = 1", []).is_err());
    }
}
