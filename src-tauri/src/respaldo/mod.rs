//! Copias de seguridad y restauracion.
//!
//! Es lo que separa un sistema de un experimento: un disco dañado sin
//! respaldo es el negocio completo perdido.
//!
//! Dos decisiones que vale la pena explicar:
//!
//! **Crear la copia con `VACUUM INTO` y no copiando el archivo.** Con el
//! modo WAL activo, parte de lo escrito vive en un diario aparte; copiar
//! el .db a secas puede producir una copia a la que le falten las ultimas
//! operaciones. `VACUUM INTO` escribe una base completa y consistente, y
//! ademas compacta.
//!
//! **Restaurar con la API de respaldo de SQLite y no reemplazando el
//! archivo.** En Windows no se puede sobrescribir un archivo que la
//! aplicacion tiene abierto; habria que cerrar la conexion, mover
//! archivos y reabrir, con varios puntos donde quedar a medias. La API de
//! respaldo vuelca el contenido del archivo elegido dentro de la conexion
//! que ya esta abierta, sin cerrar nada.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Datelike, Local};
use rusqlite::backup::Backup;
use rusqlite::Connection;
use serde::Serialize;

/// Cuantas copias se conservan al rotar.
const DIARIAS_A_CONSERVAR: usize = 30;
const MENSUALES_A_CONSERVAR: usize = 12;

const PREFIJO: &str = "tribuna_";
const EXTENSION: &str = "db";

#[derive(Debug, thiserror::Error)]
pub enum ErrorRespaldo {
    #[error("no se pudo crear la carpeta de respaldos")]
    Carpeta(#[source] std::io::Error),
    #[error("no se pudo escribir la copia")]
    Escritura(#[source] rusqlite::Error),
    #[error("no se pudo leer la carpeta de respaldos")]
    Lectura(#[source] std::io::Error),
    #[error("la copia '{0}' no existe")]
    NoExiste(String),
    #[error("la copia '{0}' esta dañada y no se puede restaurar")]
    Danada(String),
    #[error("error de base de datos")]
    Sqlite(#[from] rusqlite::Error),
    #[error("la copia se restauro pero no se pudo poner al dia el esquema")]
    Esquema(#[source] crate::db::ErrorBase),
}

/// Por que se creo una copia. Sirve para no rotar las que protegen una
/// operacion peligrosa.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum MotivoRespaldo {
    Manual,
    CierreApp,
    CierreCaja,
    PreRestauracion,
    PreImportacion,
}

impl MotivoRespaldo {
    fn codigo(self) -> &'static str {
        match self {
            Self::Manual => "MANUAL",
            Self::CierreApp => "CIERRE_APP",
            Self::CierreCaja => "CIERRE_CAJA",
            Self::PreRestauracion => "PRE_RESTAURACION",
            Self::PreImportacion => "PRE_IMPORTACION",
        }
    }

    fn sufijo(self) -> &'static str {
        match self {
            Self::Manual => "",
            Self::CierreApp => "_cierre",
            Self::CierreCaja => "_caja",
            Self::PreRestauracion => "_antes-de-restaurar",
            Self::PreImportacion => "_antes-de-importar",
        }
    }

    /// Las copias que protegen una operacion peligrosa no se rotan: son
    /// justo las que hacen falta cuando algo salio mal.
    fn es_protegida(self) -> bool {
        matches!(self, Self::PreRestauracion | Self::PreImportacion)
    }

    /// Deduce el motivo a partir del nombre del archivo.
    ///
    /// El motivo se codifica en el sufijo al crear la copia, asi que la
    /// carpeta se puede interpretar sin consultar la base -- que es justo
    /// lo que hace falta cuando la base es la que se perdio.
    fn desde_nombre(archivo: &str) -> Self {
        for motivo in [
            Self::PreRestauracion, Self::PreImportacion,
            Self::CierreCaja, Self::CierreApp,
        ] {
            if archivo.contains(motivo.sufijo()) {
                return motivo;
            }
        }
        Self::Manual
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Respaldo {
    pub archivo: String,
    pub ruta: String,
    pub tamano_bytes: u64,
    pub creado: String,
    pub verificado: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EstadoRespaldos {
    pub total: usize,
    pub ultimo: Option<Respaldo>,
    pub dias_sin_respaldo: Option<i64>,
    /// El sistema debe insistir mientras esto sea cierto.
    pub necesita_respaldo: bool,
    pub carpeta: String,
}

/// Nombre con fecha y hora, para que nunca se sobrescriba una copia buena.
fn nombre_para(momento: DateTime<Local>, motivo: MotivoRespaldo) -> String {
    format!(
        "{PREFIJO}{}{}.{EXTENSION}",
        momento.format("%Y-%m-%d_%H%M%S"),
        motivo.sufijo()
    )
}

/// Crea una copia consistente y comprueba que sirva.
///
/// Una copia que no se ha verificado no es un respaldo: es un archivo.
pub fn crear(
    conexion: &Connection,
    carpeta: &Path,
    motivo: MotivoRespaldo,
    momento: DateTime<Local>,
) -> Result<Respaldo, ErrorRespaldo> {
    fs::create_dir_all(carpeta).map_err(ErrorRespaldo::Carpeta)?;

    let archivo = nombre_para(momento, motivo);
    let destino = carpeta.join(&archivo);

    // Si ya existiera una copia con ese nombre exacto, se busca un nombre
    // libre en vez de pisarla.
    let destino = ruta_libre(destino);

    conexion
        .execute("VACUUM INTO ?1", [ruta_texto(&destino)])
        .map_err(ErrorRespaldo::Escritura)?;

    let verificado = verificar(&destino)?;
    if !verificado {
        // Una copia dañada no se deja en la carpeta fingiendo ser valida.
        let _ = fs::remove_file(&destino);
        return Err(ErrorRespaldo::Danada(archivo));
    }

    let tamano = fs::metadata(&destino)
        .map_err(ErrorRespaldo::Lectura)?
        .len();

    registrar_en_base(conexion, &destino, tamano, motivo)?;

    Ok(Respaldo {
        archivo: nombre_de(&destino),
        ruta: ruta_texto(&destino),
        tamano_bytes: tamano,
        creado: momento.to_rfc3339(),
        verificado: true,
    })
}

fn ruta_libre(propuesta: PathBuf) -> PathBuf {
    if !propuesta.exists() {
        return propuesta;
    }
    let tallo = propuesta
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("tribuna")
        .to_owned();
    let carpeta = propuesta.parent().map(Path::to_path_buf).unwrap_or_default();
    for i in 2..1000 {
        let alterna = carpeta.join(format!("{tallo}_{i}.{EXTENSION}"));
        if !alterna.exists() {
            return alterna;
        }
    }
    propuesta
}

fn ruta_texto(ruta: &Path) -> String {
    ruta.to_string_lossy().into_owned()
}

fn nombre_de(ruta: &Path) -> String {
    ruta.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_owned()
}

/// Abre la copia y le pasa la revision de integridad de SQLite.
pub fn verificar(ruta: &Path) -> Result<bool, ErrorRespaldo> {
    if !ruta.exists() {
        return Ok(false);
    }
    let copia = match Connection::open(ruta) {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };
    let estado: String = match copia.query_row("PRAGMA integrity_check", [], |f| f.get(0)) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };
    if estado != "ok" {
        return Ok(false);
    }
    // Una base intacta pero de otro programa tampoco sirve.
    let tiene_productos: bool = copia
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='productos'",
            [],
            |f| f.get::<_, i64>(0),
        )
        .map(|n| n == 1)
        .unwrap_or(false);
    Ok(tiene_productos)
}

/// Lo que hay de verdad en el disco.
///
/// Se lee la carpeta y no la tabla: tras restaurar una copia vieja, la
/// tabla vendria con la lista de esa copia y no con la real. El disco es
/// la fuente de verdad.
pub fn listar(carpeta: &Path) -> Result<Vec<Respaldo>, ErrorRespaldo> {
    if !carpeta.exists() {
        return Ok(Vec::new());
    }
    let mut copias = Vec::new();
    for entrada in fs::read_dir(carpeta).map_err(ErrorRespaldo::Lectura)? {
        let entrada = entrada.map_err(ErrorRespaldo::Lectura)?;
        let ruta = entrada.path();
        let nombre = nombre_de(&ruta);
        if !nombre.starts_with(PREFIJO) || !nombre.ends_with(EXTENSION) {
            continue;
        }
        let datos = entrada.metadata().map_err(ErrorRespaldo::Lectura)?;
        let creado: DateTime<Local> = datos
            .modified()
            .map(DateTime::from)
            .unwrap_or_else(|_| Local::now());

        copias.push(Respaldo {
            archivo: nombre,
            ruta: ruta_texto(&ruta),
            tamano_bytes: datos.len(),
            creado: creado.to_rfc3339(),
            verificado: false,
        });
    }
    copias.sort_by(|a, b| b.creado.cmp(&a.creado));
    Ok(copias)
}

/// Resumen para el tablero: cuando fue la ultima copia y si urge una.
pub fn estado(
    carpeta: &Path,
    dias_alerta: i64,
    ahora: DateTime<Local>,
) -> Result<EstadoRespaldos, ErrorRespaldo> {
    let copias = listar(carpeta)?;
    let ultimo = copias.first().cloned();

    let dias = ultimo.as_ref().and_then(|r| {
        DateTime::parse_from_rfc3339(&r.creado)
            .ok()
            .map(|f| (ahora.signed_duration_since(f)).num_days())
    });

    Ok(EstadoRespaldos {
        total: copias.len(),
        // Si nunca se ha respaldado, hay que decirlo hasta que se haga.
        necesita_respaldo: dias.map_or(true, |d| d >= dias_alerta),
        dias_sin_respaldo: dias,
        ultimo,
        carpeta: ruta_texto(carpeta),
    })
}

/// Restaura una copia sobre la base abierta.
///
/// Antes de tocar nada se guarda el estado actual: si la copia elegida
/// resulta ser peor que lo que habia, no se pierde el trabajo del dia.
pub fn restaurar(
    conexion: &mut Connection,
    copia: &Path,
    carpeta: &Path,
    momento: DateTime<Local>,
) -> Result<Respaldo, ErrorRespaldo> {
    if !copia.exists() {
        return Err(ErrorRespaldo::NoExiste(nombre_de(copia)));
    }
    if !verificar(copia)? {
        return Err(ErrorRespaldo::Danada(nombre_de(copia)));
    }

    let seguridad = crear(conexion, carpeta, MotivoRespaldo::PreRestauracion, momento)?;

    let origen = Connection::open(copia)?;
    {
        let respaldo = Backup::new(&origen, conexion)?;
        respaldo.run_to_completion(100, std::time::Duration::from_millis(0), None)?;
    }

    // Una copia hecha con una version anterior trae el esquema de
    // entonces. Sin esto la aplicacion sigue andando contra ese esquema
    // viejo —editar un producto revienta— hasta que alguien la reinicie,
    // y nadie sabe que hay que reiniciarla.
    //
    // Se pone al dia el esquema y no los datos: las migraciones de datos
    // siembran el catalogo y los gastos iniciales, y volver a correrlas
    // resucitaria productos que el dueño dio de baja.
    crate::db::migraciones::aplicar_hasta(conexion, crate::db::migraciones::SIN_CATALOGO)
        .map_err(ErrorRespaldo::Esquema)?;

    Ok(seguridad)
}

/// Borra copias viejas conservando las ultimas diarias y una por mes.
///
/// Devuelve las que se eliminaron. Las copias que protegen una operacion
/// peligrosa no se tocan nunca.
pub fn rotar(carpeta: &Path) -> Result<Vec<String>, ErrorRespaldo> {
    let copias = listar(carpeta)?;
    let mut eliminadas = Vec::new();

    let mut meses_vistos: Vec<(i32, u32)> = Vec::new();

    for (indice, copia) in copias.iter().enumerate() {
        let protegida = MotivoRespaldo::desde_nombre(&copia.archivo).es_protegida();
        if indice < DIARIAS_A_CONSERVAR || protegida {
            continue;
        }
        let Ok(fecha) = DateTime::parse_from_rfc3339(&copia.creado) else {
            continue;
        };
        let mes = (fecha.year(), fecha.month());

        // De cada mes anterior se conserva la copia mas reciente.
        if !meses_vistos.contains(&mes) && meses_vistos.len() < MENSUALES_A_CONSERVAR {
            meses_vistos.push(mes);
            continue;
        }

        if fs::remove_file(&copia.ruta).is_ok() {
            eliminadas.push(copia.archivo.clone());
        }
    }
    Ok(eliminadas)
}

fn registrar_en_base(
    conexion: &Connection,
    ruta: &Path,
    tamano: u64,
    motivo: MotivoRespaldo,
) -> Result<(), ErrorRespaldo> {
    conexion.execute(
        "INSERT INTO respaldos (archivo, ruta, tamano_bytes, tipo, integridad)
         VALUES (?1, ?2, ?3, ?4, 'VERIFICADO')",
        rusqlite::params![
            nombre_de(ruta),
            ruta_texto(ruta),
            tamano as i64,
            motivo.codigo(),
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db;
    use chrono::TimeZone;

    fn carpeta_temporal(nombre: &str) -> PathBuf {
        let ruta = std::env::temp_dir().join(format!("tribuna_pruebas_{nombre}"));
        let _ = fs::remove_dir_all(&ruta);
        fs::create_dir_all(&ruta).unwrap();
        ruta
    }

    fn base_con_datos(ruta: &Path) -> Connection {
        let conexion = db::abrir_sin_catalogo(ruta).unwrap();
        conexion
            .execute(
                "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
                 VALUES ('admin', 'Camilo', 'h', 'ADMINISTRADOR')",
                [],
            )
            .unwrap();
        conexion
            .execute(
                "INSERT INTO productos (codigo, nombre, categoria_id, presentacion, existencia, precio_venta)
                 VALUES ('CER-POKER-330B', 'POKER', 9, '330 ml', 38, 3900)",
                [],
            )
            .unwrap();
        conexion
    }

    fn momento() -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 8, 19, 21, 45, 0).unwrap()
    }

    #[test]
    fn la_copia_se_crea_verificada_y_con_los_datos_dentro() {
        let dir = carpeta_temporal("crear");
        let conexion = base_con_datos(&dir.join("tribuna.db"));
        let copias = dir.join("respaldos");

        let r = crear(&conexion, &copias, MotivoRespaldo::Manual, momento()).unwrap();

        assert!(r.verificado);
        assert!(r.tamano_bytes > 0);
        assert_eq!(r.archivo, "tribuna_2026-08-19_214500.db");

        // La copia trae los datos, no solo la estructura.
        let copia = Connection::open(&r.ruta).unwrap();
        let existencia: i64 = copia
            .query_row("SELECT existencia FROM productos WHERE codigo='CER-POKER-330B'", [], |f| f.get(0))
            .unwrap();
        assert_eq!(existencia, 38);
    }

    #[test]
    fn nunca_sobrescribe_una_copia_existente() {
        let dir = carpeta_temporal("no_sobrescribe");
        let conexion = base_con_datos(&dir.join("tribuna.db"));
        let copias = dir.join("respaldos");

        let primera = crear(&conexion, &copias, MotivoRespaldo::Manual, momento()).unwrap();
        // Mismo instante exacto: el nombre chocaria.
        let segunda = crear(&conexion, &copias, MotivoRespaldo::Manual, momento()).unwrap();

        assert_ne!(primera.archivo, segunda.archivo);
        assert_eq!(listar(&copias).unwrap().len(), 2);
    }

    #[test]
    fn una_copia_dañada_no_pasa_la_verificacion() {
        let dir = carpeta_temporal("danada");
        let falsa = dir.join("tribuna_2026-01-01_000000.db");
        fs::write(&falsa, b"esto no es una base de datos").unwrap();
        assert!(!verificar(&falsa).unwrap());
    }

    #[test]
    fn un_archivo_que_no_existe_no_se_da_por_bueno() {
        let dir = carpeta_temporal("inexistente");
        assert!(!verificar(&dir.join("no_existe.db")).unwrap());
    }

    #[test]
    fn restaurar_devuelve_los_datos_de_la_copia() {
        let dir = carpeta_temporal("restaurar");
        let mut conexion = base_con_datos(&dir.join("tribuna.db"));
        let copias = dir.join("respaldos");

        let copia = crear(&conexion, &copias, MotivoRespaldo::Manual, momento()).unwrap();

        // Se altera la base despues de la copia.
        conexion
            .execute("UPDATE productos SET existencia = 0", [])
            .unwrap();
        let antes: i64 = conexion
            .query_row("SELECT existencia FROM productos", [], |f| f.get(0))
            .unwrap();
        assert_eq!(antes, 0);

        restaurar(&mut conexion, Path::new(&copia.ruta), &copias, momento()).unwrap();

        let despues: i64 = conexion
            .query_row("SELECT existencia FROM productos", [], |f| f.get(0))
            .unwrap();
        assert_eq!(despues, 38, "vuelven las 38 botellas de la copia");
    }

    /// La ultima migracion que existe hoy, sin fijarla a un numero: al
    /// agregar la siguiente, la prueba se mueve sola.
    fn ultima_migracion(dir: &Path) -> i32 {
        db::abrir_sin_catalogo(&dir.join("referencia.db"))
            .unwrap()
            .query_row("SELECT MAX(version) FROM migraciones", [], |f| f.get(0))
            .unwrap()
    }

    #[test]
    fn restaurar_una_copia_vieja_deja_la_base_al_dia() {
        // Quien actualiza y luego restaura una copia de antes se trae el
        // esquema de entonces. Sin volver a migrar, la aplicacion sigue
        // andando contra ese esquema: guardar un producto revienta con
        // «no such column» hasta que alguien la reinicie, y nadie sabe
        // que hay que reiniciarla.
        let dir = carpeta_temporal("restaurar_vieja");
        let copias = dir.join("respaldos");
        let ultima = ultima_migracion(&dir);

        // Una base como la dejaba la version anterior: todo menos la
        // ultima migracion.
        let ruta_vieja = dir.join("vieja.db");
        let vieja = Connection::open(&ruta_vieja).unwrap();
        db::migraciones::aplicar_hasta(&vieja, ultima - 1).unwrap();
        vieja
            .execute(
                "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
                 VALUES ('admin', 'Camilo', 'h', 'ADMINISTRADOR')",
                [],
            )
            .unwrap();
        let copia = crear(&vieja, &copias, MotivoRespaldo::Manual, momento()).unwrap();
        drop(vieja);

        // La aplicacion, ya actualizada, restaura esa copia.
        let mut conexion = base_con_datos(&dir.join("tribuna.db"));
        restaurar(&mut conexion, Path::new(&copia.ruta), &copias, momento()).unwrap();

        let tiene: i32 = conexion
            .query_row("SELECT MAX(version) FROM migraciones", [], |f| f.get(0))
            .unwrap();
        assert_eq!(tiene, ultima, "la base restaurada queda con el esquema al dia");
    }

    #[test]
    fn restaurar_no_resucita_lo_que_el_dueño_dio_de_baja() {
        // Poner al dia el esquema no puede sembrar datos otra vez: las
        // migraciones de datos traen el catalogo y los gastos iniciales,
        // y el dueño ya decidio que se queda y que no.
        let dir = carpeta_temporal("restaurar_sin_sembrar");
        let copias = dir.join("respaldos");
        let mut conexion = base_con_datos(&dir.join("tribuna.db"));

        let copia = crear(&conexion, &copias, MotivoRespaldo::Manual, momento()).unwrap();
        restaurar(&mut conexion, Path::new(&copia.ruta), &copias, momento()).unwrap();

        let productos: i64 = conexion
            .query_row("SELECT COUNT(*) FROM productos", [], |f| f.get(0))
            .unwrap();
        assert_eq!(productos, 1, "sigue estando solo el producto de la copia");
    }

    #[test]
    fn restaurar_guarda_antes_el_estado_actual() {
        let dir = carpeta_temporal("pre_restauracion");
        let mut conexion = base_con_datos(&dir.join("tribuna.db"));
        let copias = dir.join("respaldos");

        let copia = crear(&conexion, &copias, MotivoRespaldo::Manual, momento()).unwrap();
        conexion
            .execute("UPDATE productos SET existencia = 99", [])
            .unwrap();

        let seguridad = restaurar(&mut conexion, Path::new(&copia.ruta), &copias, momento()).unwrap();

        // La copia de seguridad conserva lo que habia justo antes.
        let guardada = Connection::open(&seguridad.ruta).unwrap();
        let existencia: i64 = guardada
            .query_row("SELECT existencia FROM productos", [], |f| f.get(0))
            .unwrap();
        assert_eq!(existencia, 99, "lo de antes de restaurar no se pierde");
        assert!(seguridad.archivo.contains("antes-de-restaurar"));
    }

    #[test]
    fn no_restaura_una_copia_dañada() {
        let dir = carpeta_temporal("restaurar_danada");
        let mut conexion = base_con_datos(&dir.join("tribuna.db"));
        let copias = dir.join("respaldos");
        fs::create_dir_all(&copias).unwrap();

        let falsa = copias.join("tribuna_2026-01-01_000000.db");
        fs::write(&falsa, b"archivo corrupto").unwrap();

        let resultado = restaurar(&mut conexion, &falsa, &copias, momento());
        assert!(matches!(resultado, Err(ErrorRespaldo::Danada(_))));

        // La base sigue intacta.
        let existencia: i64 = conexion
            .query_row("SELECT existencia FROM productos", [], |f| f.get(0))
            .unwrap();
        assert_eq!(existencia, 38);
    }

    #[test]
    fn avisa_cuando_nunca_se_ha_respaldado() {
        let dir = carpeta_temporal("sin_respaldos");
        let e = estado(&dir.join("respaldos"), 3, momento()).unwrap();

        assert_eq!(e.total, 0);
        assert!(e.ultimo.is_none());
        assert!(e.necesita_respaldo, "sin ninguna copia hay que insistir");
    }

    #[test]
    fn deja_de_avisar_cuando_hay_una_copia_reciente() {
        let dir = carpeta_temporal("con_respaldo");
        let conexion = base_con_datos(&dir.join("tribuna.db"));
        let copias = dir.join("respaldos");

        crear(&conexion, &copias, MotivoRespaldo::Manual, momento()).unwrap();
        let e = estado(&copias, 3, momento()).unwrap();

        assert_eq!(e.total, 1);
        assert!(e.ultimo.is_some());
        assert!(!e.necesita_respaldo);
    }

    #[test]
    fn la_rotacion_no_borra_las_copias_que_protegen_una_operacion() {
        let dir = carpeta_temporal("rotacion");
        let copias = dir.join("respaldos");
        fs::create_dir_all(&copias).unwrap();

        let conexion = base_con_datos(&dir.join("tribuna.db"));
        // Mas copias de las que se conservan, mas una protegida.
        for dia in 1..=35 {
            let fecha = Local.with_ymd_and_hms(2026, 8, 1, 10, 0, 0).unwrap()
                + chrono::Duration::days(dia);
            crear(&conexion, &copias, MotivoRespaldo::CierreApp, fecha).unwrap();
        }
        let protegida = crear(
            &conexion,
            &copias,
            MotivoRespaldo::PreImportacion,
            Local.with_ymd_and_hms(2026, 8, 2, 9, 0, 0).unwrap(),
        )
        .unwrap();

        rotar(&copias).unwrap();

        let quedan = listar(&copias).unwrap();
        assert!(
            quedan.iter().any(|r| r.archivo == protegida.archivo),
            "la copia previa a importar no se puede borrar"
        );
    }
    #[test]
    fn el_motivo_se_deduce_del_nombre_del_archivo() {
        // La carpeta se puede interpretar sin la base, que es justo lo
        // que hace falta cuando la base es la que se perdio.
        assert!(MotivoRespaldo::desde_nombre("tribuna_2026-08-19_1000_antes-de-restaurar.db")
            .es_protegida());
        assert!(MotivoRespaldo::desde_nombre("tribuna_2026-08-19_1000_antes-de-importar.db")
            .es_protegida());
        assert!(!MotivoRespaldo::desde_nombre("tribuna_2026-08-19_1000.db").es_protegida());
        assert!(!MotivoRespaldo::desde_nombre("tribuna_2026-08-19_1000_cierre.db").es_protegida());
    }
}
