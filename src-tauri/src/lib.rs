//! Nucleo del punto de venta.
//!
//! Aqui vive todo lo que debe ser atomico o tocar el sistema: las
//! transacciones contra SQLite y los respaldos. La interfaz
//! pide operaciones completas y recibe un resultado; nunca escribe paso a
//! paso, porque asi es imposible que quede media venta registrada.

pub mod caja;
pub mod comandos;
pub mod compras;
pub mod db;
pub mod fiados;
pub mod formato;
pub mod gastos;
pub mod inventario;
pub mod reportes;
pub mod respaldo;
pub mod usuarios;
pub mod ventas;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

/// La conexion viva a la base, compartida por todos los comandos.
///
/// Un mutex y no un pool: la aplicacion la usa un cajero a la vez en un
/// solo equipo, y un pool solo agregaria piezas que mantener sin resolver
/// ningun problema real.
pub struct EstadoApp {
    pub db: Mutex<Connection>,
}

/// Mensaje de error que llega a la interfaz.
///
/// Lleva dos textos a proposito: `mensaje` es lo que ve el cajero, en
/// palabras que se entienden y diciendo si sus datos estan a salvo;
/// `detalle` es para el registro tecnico. El usuario nunca ve un error de
/// base de datos en crudo.
#[derive(Debug, serde::Serialize)]
pub struct ErrorApp {
    pub mensaje: String,
    pub detalle: String,
}

impl ErrorApp {
    pub fn nuevo(mensaje: impl Into<String>, detalle: impl std::fmt::Display) -> Self {
        Self {
            mensaje: mensaje.into(),
            detalle: detalle.to_string(),
        }
    }

    /// Para lo que el usuario hizo mal, no para lo que fallo por dentro:
    /// «escribe un nombre» no tiene detalle tecnico que guardar.
    pub fn mensaje(texto: impl Into<String>) -> Self {
        let texto = texto.into();
        Self {
            detalle: texto.clone(),
            mensaje: texto,
        }
    }
}

/// Cómo se llamaba la carpeta de datos antes de que el programa dejara
/// de llamarse por el nombre de un local en concreto.
const CARPETA_VIEJA: &str = "TribunaPOS";

/// Cómo se llama ahora.
const CARPETA: &str = "PuntoDeVenta";

/// Dónde viven la base de datos y los respaldos.
///
/// Se construye a mano en vez de usar `app_data_dir()`, que en Windows
/// devuelve una carpeta con el identificador de la aplicación. Ese nombre
/// nadie lo encuentra buscando sus respaldos: `%APPDATA%\PuntoDeVenta` sí.
///
/// Lo importante es que está fuera de la carpeta del programa, para que
/// actualizar el programa reemplace el ejecutable sin tocar los datos.
///
/// Si todavía existe la carpeta con el nombre viejo y no la nueva, se
/// renombra. Sin esto, cambiarle el nombre al programa dejaría huérfanos
/// la base y todos los respaldos de quien ya lo tenía instalado.
pub fn carpeta_de_datos(app: &tauri::AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(resolver_carpeta(&app.path().data_dir()?))
}

/// La decisión, aparte de Tauri para poder probarla.
///
/// Corre sobre los datos de alguien que ya tenía el programa instalado:
/// si se equivoca, esa persona abre el programa y no encuentra su
/// inventario. Se prueba contra carpetas de verdad, no simuladas.
fn resolver_carpeta(raiz: &Path) -> PathBuf {
    decidir_carpeta(raiz, |de, a| std::fs::rename(de, a))
}

/// Lo mismo, pero con el renombrado como parámetro.
///
/// Se separa para poder probar qué pasa **cuando el renombrado falla**:
/// la carpeta abierta en el Explorador, un antivirus, permisos. Es el
/// caso que importa, porque devolver ahí la carpeta nueva —vacía— haría
/// que el programa arrancara como si fuera la primera vez y creara una
/// base en blanco al lado de la de verdad.
fn decidir_carpeta<F>(raiz: &Path, renombrar: F) -> PathBuf
where
    F: FnOnce(&Path, &Path) -> std::io::Result<()>,
{
    let nueva = raiz.join(CARPETA);
    let vieja = raiz.join(CARPETA_VIEJA);

    // La nueva manda si ya existe: si estuvieran las dos, mover encima
    // pisaría datos más recientes con otros más viejos.
    if nueva.exists() || !vieja.is_dir() {
        return nueva;
    }

    // Si falla, se sigue usando la vieja: es preferible arrancar con el
    // nombre anterior que arrancar sin los datos.
    match renombrar(&vieja, &nueva) {
        Ok(()) => nueva,
        Err(_) => vieja,
    }
}

pub fn ejecutar() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let carpeta = carpeta_de_datos(app.handle())?;
            std::fs::create_dir_all(&carpeta)?;

            let conexion = db::abrir(&carpeta.join("tribuna.db"))?;
            app.manage(EstadoApp {
                db: Mutex::new(conexion),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            comandos::inventario::importar_productos,
            comandos::inventario::listar_productos,
            comandos::inventario::resumen_inventario,
            comandos::respaldos::crear_respaldo,
            comandos::respaldos::listar_respaldos,
            comandos::respaldos::estado_respaldos,
            comandos::respaldos::verificar_respaldo,
            comandos::respaldos::restaurar_respaldo,
            comandos::sesion::estado_arranque,
            comandos::sesion::iniciar_sesion,
            comandos::sesion::cerrar_sesion,
            comandos::sesion::crear_primer_administrador,
            comandos::pos::catalogo_venta,
            comandos::pos::metodos_de_pago,
            comandos::pos::caja_abierta,
            comandos::pos::abrir_caja,
            comandos::pos::cerrar_caja,
            comandos::pos::resumen_caja,
            comandos::pos::movimiento_caja,
            comandos::pos::registrar_venta,
            comandos::pos::anular_venta,
            comandos::tablero::tablero,
            comandos::reportes::reporte_ventas_por_dia,
            comandos::reportes::reporte_ventas_por_producto,
            comandos::reportes::reporte_ventas_por_categoria,
            comandos::reportes::reporte_ventas_por_usuario,
            comandos::reportes::reporte_cierres_de_caja,
            comandos::reportes::reporte_kardex,
            comandos::reportes::historial_de_precios,
            comandos::reportes::primer_dia_con_movimiento,
            comandos::fiados::clientes_con_saldo,
            comandos::fiados::cuentas_del_cliente,
            comandos::fiados::abonar,
            comandos::fiados::anular_abono,
            comandos::fiados::abonos_de_cuenta,
            comandos::fiados::guardar_cliente,
            comandos::fiados::desactivar_cliente,
            comandos::fiados::reactivar_cliente,
            comandos::compras::compras_por_pagar,
            comandos::compras::saldos_por_proveedor,
            comandos::compras::pagar_compra,
            comandos::compras::anular_pago_compra,
            comandos::compras::pagos_de_compra,
            comandos::gastos::listar_gastos,
            comandos::gastos::registrar_gasto,
            comandos::gastos::editar_gasto,
            comandos::gastos::anular_gasto,
            comandos::gastos::categorias_de_gasto,
            comandos::gastos::crear_categoria_gasto,
            comandos::gastos::quitar_categoria_gasto,
            comandos::configuracion::leer_configuracion,
            comandos::configuracion::guardar_configuracion,
            comandos::configuracion::listar_usuarios,
            comandos::configuracion::crear_usuario,
            comandos::configuracion::desactivar_usuario,
            comandos::configuracion::restablecer_contrasena,
            comandos::configuracion::leer_auditoria,
            comandos::compras::listar_proveedores,
            comandos::compras::listar_compras,
            comandos::compras::precios_de_producto,
            comandos::compras::registrar_compra,
            comandos::compras::anular_compra,
            comandos::catalogos::listar_catalogo,
            comandos::catalogos::guardar_catalogo,
            comandos::catalogos::desactivar_catalogo,
            comandos::catalogos::guardar_proveedor,
            comandos::catalogos::desactivar_proveedor,
            comandos::inventario::crear_producto,
            comandos::inventario::editar_producto,
            comandos::inventario::ajustar_existencia,
            comandos::inventario::deshacer_ajuste,
            comandos::inventario::agregar_empaque,
            comandos::inventario::asociar_codigo_barras,
            comandos::inventario::quitar_codigo_barras,
            comandos::inventario::desactivar_producto,
            comandos::inventario::listar_categorias,
            comandos::inventario::listar_precios_especiales,
            comandos::inventario::poner_precio_especial,
            comandos::inventario::quitar_precio_especial,
            comandos::reportes::historial_ventas,
            comandos::reportes::estado_de_resultados,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar el programa");
}

#[cfg(test)]
mod pruebas_carpeta {
    use super::{decidir_carpeta, resolver_carpeta, CARPETA, CARPETA_VIEJA};
    use std::fs;
    use std::path::{Path, PathBuf};

    /// Una carpeta vacia y recien hecha para cada prueba.
    fn raiz(nombre: &str) -> PathBuf {
        let ruta = std::env::temp_dir().join(format!("pdv_carpeta_{nombre}"));
        let _ = fs::remove_dir_all(&ruta);
        fs::create_dir_all(&ruta).unwrap();
        ruta
    }

    /// Deja una carpeta con un archivo adentro, para saber si se movio.
    fn con_datos(raiz: &Path, nombre: &str, archivo: &str) {
        let carpeta = raiz.join(nombre);
        fs::create_dir_all(&carpeta).unwrap();
        fs::write(carpeta.join(archivo), b"la base del negocio").unwrap();
    }

    #[test]
    fn instalacion_nueva_usa_el_nombre_nuevo() {
        let raiz = raiz("nueva");

        let elegida = resolver_carpeta(&raiz);

        assert_eq!(elegida, raiz.join(CARPETA));
    }

    #[test]
    fn quien_venia_del_nombre_viejo_encuentra_sus_datos() {
        let raiz = raiz("mudanza");
        con_datos(&raiz, CARPETA_VIEJA, "tribuna.db");

        let elegida = resolver_carpeta(&raiz);

        // La carpeta se renombro, con el archivo adentro. Sin esto, el
        // dueño abre el programa y no encuentra su inventario.
        assert_eq!(elegida, raiz.join(CARPETA));
        assert!(elegida.join("tribuna.db").exists(), "la base se movio con la carpeta");
        assert!(!raiz.join(CARPETA_VIEJA).exists(), "la vieja ya no esta");
    }

    #[test]
    fn los_respaldos_se_mudan_tambien() {
        let raiz = raiz("respaldos");
        let vieja = raiz.join(CARPETA_VIEJA);
        fs::create_dir_all(vieja.join("respaldos")).unwrap();
        fs::write(vieja.join("respaldos").join("copia-1.db"), b"copia").unwrap();

        let elegida = resolver_carpeta(&raiz);

        assert!(elegida.join("respaldos").join("copia-1.db").exists());
    }

    #[test]
    fn si_ya_existe_la_nueva_no_se_pisa_con_la_vieja() {
        let raiz = raiz("las_dos");
        con_datos(&raiz, CARPETA_VIEJA, "vieja.db");
        con_datos(&raiz, CARPETA, "nueva.db");

        let elegida = resolver_carpeta(&raiz);

        // Mover encima cambiaria datos de hoy por datos de antes del
        // cambio de nombre. Ante la duda, la nueva manda.
        assert_eq!(elegida, raiz.join(CARPETA));
        assert!(elegida.join("nueva.db").exists());
        assert!(raiz.join(CARPETA_VIEJA).join("vieja.db").exists(), "la vieja sigue ahi");
    }

    #[test]
    fn arrancar_dos_veces_no_cambia_nada() {
        let raiz = raiz("dos_veces");
        con_datos(&raiz, CARPETA_VIEJA, "tribuna.db");

        let primera = resolver_carpeta(&raiz);
        let segunda = resolver_carpeta(&raiz);

        assert_eq!(primera, segunda);
        assert!(segunda.join("tribuna.db").exists());
    }

    /// Lo que pasa cuando Windows no deja renombrar.
    mod si_no_se_puede_mover {
        use super::*;

        fn no_se_puede(_: &std::path::Path, _: &std::path::Path) -> std::io::Result<()> {
            Err(std::io::Error::other("la carpeta está abierta en el Explorador"))
        }

        #[test]
        fn se_sigue_usando_la_vieja_para_no_arrancar_sin_datos() {
            let raiz = raiz("no_se_puede");
            con_datos(&raiz, CARPETA_VIEJA, "tribuna.db");

            let elegida = decidir_carpeta(&raiz, no_se_puede);

            // Devolver la nueva —que esta vacia— haria que el programa
            // arrancara como si fuera la primera vez y creara una base en
            // blanco al lado de la de verdad.
            assert_eq!(elegida, raiz.join(CARPETA_VIEJA));
            assert!(elegida.join("tribuna.db").exists());
        }

        #[test]
        fn en_una_instalacion_nueva_no_cambia_nada() {
            let raiz = raiz("no_se_puede_nueva");

            // Sin carpeta vieja no hay nada que mover, asi que el fallo
            // ni siquiera se intenta.
            assert_eq!(decidir_carpeta(&raiz, no_se_puede), raiz.join(CARPETA));
        }
    }

    #[test]
    fn un_archivo_llamado_igual_que_la_carpeta_vieja_no_se_toca() {
        let raiz = raiz("archivo_suelto");
        // Alguien dejo un archivo, no una carpeta, con ese nombre.
        fs::write(raiz.join(CARPETA_VIEJA), b"no soy una carpeta").unwrap();

        let elegida = resolver_carpeta(&raiz);

        assert_eq!(elegida, raiz.join(CARPETA));
        assert!(raiz.join(CARPETA_VIEJA).is_file(), "sigue siendo un archivo");
    }
}
