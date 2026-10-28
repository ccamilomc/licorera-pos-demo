//! Migraciones de la base.
//!
//! Cada migracion se aplica una sola vez y en orden, dentro de su propia
//! transaccion: si una falla, la base queda como estaba y no a medias.
//! Los archivos .sql se incrustan en el ejecutable, asi que la aplicacion
//! instalada no depende de que existan en el disco.

use rusqlite::Connection;

use super::ErrorBase;

struct Migracion {
    version: i32,
    nombre: &'static str,
    sql: &'static str,
    /// No cambia el esquema: mete datos con los que arranca el negocio.
    /// Las pruebas se las saltan -- 24 productos de ruido hacen ilegible
    /// cualquier comprobacion de una suma -- pero el esquema que venga
    /// despues si tiene que aplicarse.
    solo_datos: bool,
}

const MIGRACIONES: &[Migracion] = &[
    Migracion {
        version: 1,
        nombre: "inicial",
        sql: include_str!("../../migraciones/001_inicial.sql"),
        solo_datos: false,
    },
    Migracion {
        version: 2,
        nombre: "datos_base",
        sql: include_str!("../../migraciones/002_datos_base.sql"),
        solo_datos: false,
    },
    Migracion {
        version: 3,
        nombre: "catalogos_abiertos",
        sql: include_str!("../../migraciones/003_catalogos_abiertos.sql"),
        solo_datos: false,
    },
    Migracion {
        version: 4,
        nombre: "precios_y_recargos",
        sql: include_str!("../../migraciones/004_precios_y_recargos.sql"),
        solo_datos: false,
    },
    Migracion {
        version: 5,
        nombre: "catalogo_inicial",
        sql: include_str!("../../migraciones/005_catalogo_inicial.sql"),
        solo_datos: true,
    },
    Migracion {
        version: 6,
        nombre: "gastos",
        sql: include_str!("../../migraciones/006_gastos.sql"),
        solo_datos: false,
    },
    Migracion {
        version: 7,
        nombre: "gastos_iniciales",
        sql: include_str!("../../migraciones/007_gastos_iniciales.sql"),
        solo_datos: true,
    },
    Migracion {
        version: 8,
        nombre: "fiados_y_deudas",
        sql: include_str!("../../migraciones/008_fiados_y_deudas.sql"),
        solo_datos: false,
    },
    Migracion {
        version: 9,
        nombre: "historial_de_precios",
        sql: include_str!("../../migraciones/009_historial_de_precios.sql"),
        solo_datos: false,
    },
];

/// Marca para pedir el esquema sin los datos con que arranca el negocio.
///
/// Antes esto era «para hasta la version 4», y funciono mientras la
/// ultima migracion fuera la del catalogo. Al agregar una detras, parar
/// en un numero dejaba la base sin la tabla nueva: lo que se salta es la
/// migracion de datos, no todo lo que venga despues de ella.
pub const SIN_CATALOGO: i32 = -1;

pub fn aplicar(conexion: &Connection) -> Result<(), ErrorBase> {
    aplicar_hasta(conexion, i32::MAX)
}

/// Aplica solo hasta cierta version.
///
/// Existe para poder probar una migracion sobre datos que ya estaban:
/// llenar la base con lo que habria antes, correr la siguiente y
/// comprobar que nada se perdio por el camino.
pub fn aplicar_hasta(conexion: &Connection, tope: i32) -> Result<(), ErrorBase> {
    conexion.execute_batch(
        "CREATE TABLE IF NOT EXISTS migraciones (
           version    INTEGER PRIMARY KEY,
           nombre     TEXT NOT NULL,
           aplicada   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
         );",
    )?;

    // Cuales estan aplicadas, una por una y no «hasta la N». Saltarse la
    // del catalogo dejaba un hueco, y con el maximo ese hueco se daba por
    // aplicado para siempre.
    let aplicadas: std::collections::HashSet<i32> = {
        let mut c = conexion.prepare("SELECT version FROM migraciones")?;
        let filas = c.query_map([], |f| f.get::<_, i32>(0))?;
        filas.collect::<Result<_, _>>()?
    };

    for m in MIGRACIONES.iter().filter(|m| {
        if aplicadas.contains(&m.version) {
            return false;
        }
        if tope == SIN_CATALOGO {
            return !m.solo_datos;
        }
        m.version <= tope
    }) {
        conexion
            .execute_batch(&format!("BEGIN; {} COMMIT;", m.sql))
            .map_err(|fuente| {
                let _ = conexion.execute_batch("ROLLBACK;");
                ErrorBase::Migracion {
                    version: m.version,
                    fuente,
                }
            })?;

        conexion.execute(
            "INSERT INTO migraciones (version, nombre) VALUES (?1, ?2)",
            rusqlite::params![m.version, m.nombre],
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod pruebas {
    #[test]
    fn aplicar_dos_veces_no_duplica_nada() {
        let db = crate::db::abrir_en_memoria_con_catalogo().unwrap();
        // La segunda pasada no debe volver a insertar los datos base.
        super::aplicar(&db).unwrap();
        super::aplicar(&db).unwrap();

        let roles: i64 = db
            .query_row("SELECT COUNT(*) FROM roles", [], |f| f.get(0))
            .unwrap();
        let categorias: i64 = db
            .query_row("SELECT COUNT(*) FROM categorias", [], |f| f.get(0))
            .unwrap();
        let versiones: i64 = db
            .query_row("SELECT COUNT(*) FROM migraciones", [], |f| f.get(0))
            .unwrap();

        assert_eq!(roles, 3);
        assert_eq!(categorias, 12);
        // Contra la lista y no contra un numero escrito a mano: lo que se
        // prueba es que no se repitan, no cuantas hay.
        assert_eq!(versiones, super::MIGRACIONES.len() as i64);
    }

    #[test]
    fn sin_datos_iniciales_el_esquema_llega_completo_igual() {
        let db = crate::db::abrir_en_memoria().unwrap();

        // Las de datos se saltan, pero las de esquema que vienen despues
        // de ellas tienen que estar. Antes esto era «parar en la 4», y la
        // primera tabla que se agrego detras del catalogo no llegaba.
        for tabla in ["productos", "ventas", "gastos", "gasto_categorias"] {
            let existe: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [tabla], |f| f.get(0),
                )
                .unwrap();
            assert_eq!(existe, 1, "falta la tabla {tabla}");
        }

        let productos: i64 = db
            .query_row("SELECT COUNT(*) FROM productos", [], |f| f.get(0))
            .unwrap();
        let gastos: i64 = db
            .query_row("SELECT COUNT(*) FROM gastos", [], |f| f.get(0))
            .unwrap();
        assert_eq!(productos, 0, "los datos del negocio no");
        assert_eq!(gastos, 0);
    }

    /// El catalogo con el que arranca el negocio.
    ///
    /// Son los productos del Excel real, ya listos para vender. Si esto
    /// se rompe, el dueño abre el programa el primer dia y no tiene nada
    /// que cobrar.
    mod catalogo_inicial {
        use crate::db::{abrir_en_memoria, abrir_en_memoria_con_catalogo};

        #[test]
        fn el_negocio_arranca_con_sus_productos() {
            let db = abrir_en_memoria_con_catalogo().unwrap();

            let cuantos: i64 = db
                .query_row("SELECT COUNT(*) FROM productos", [], |f| f.get(0))
                .unwrap();
            assert_eq!(cuantos, 26, "los productos de ejemplo");
        }

        #[test]
        fn sin_el_catalogo_la_base_queda_vacia() {
            // Es lo que usan las pruebas: ciento cincuenta productos de
            // ruido harian ilegible cualquier comprobacion de una suma.
            let db = abrir_en_memoria().unwrap();
            let cuantos: i64 = db
                .query_row("SELECT COUNT(*) FROM productos", [], |f| f.get(0))
                .unwrap();
            assert_eq!(cuantos, 0);
        }

        #[test]
        fn cada_producto_se_puede_vender() {
            let db = abrir_en_memoria_con_catalogo().unwrap();

            // Sin una forma de venta con precio, un producto esta en el
            // catalogo pero no se puede cobrar: es peor que no tenerlo.
            let mudos: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM productos p
                     WHERE NOT EXISTS (
                       SELECT 1 FROM producto_empaques e
                       WHERE e.producto_id = p.id AND e.para_venta = 1
                         AND e.precio_venta > 0)",
                    [], |f| f.get(0),
                )
                .unwrap();
            assert_eq!(mudos, 0, "todos tienen al menos una forma de venta con precio");
        }

        #[test]
        fn cada_producto_tiene_una_sola_forma_predeterminada() {
            let db = abrir_en_memoria_con_catalogo().unwrap();
            let malos: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM (
                       SELECT producto_id FROM producto_empaques
                       WHERE predeterminado = 1
                       GROUP BY producto_id HAVING COUNT(*) <> 1)",
                    [], |f| f.get(0),
                )
                .unwrap();
            assert_eq!(malos, 0);
        }

        /// Al migrar todavia no hay usuarios, y todo movimiento lleva
        /// autor: el libro arranca vacio a proposito. Lo llena el primer
        /// administrador al crearse —ver `crear_primer_administrador`— y
        /// hasta entonces la existencia guardada no cuadra con el libro.
        #[test]
        fn el_libro_arranca_vacio_porque_no_hay_a_nombre_de_quien() {
            let db = abrir_en_memoria_con_catalogo().unwrap();

            let usuarios: i64 = db
                .query_row("SELECT COUNT(*) FROM usuarios", [], |f| f.get(0))
                .unwrap();
            let movimientos: i64 = db
                .query_row("SELECT COUNT(*) FROM movimientos_inventario", [], |f| f.get(0))
                .unwrap();

            assert_eq!(usuarios, 0);
            assert_eq!(movimientos, 0, "sin autor no se puede escribir en el libro");

            // Y hay existencia esperando a que alguien la firme.
            let con_existencia: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM productos WHERE existencia > 0",
                    [], |f| f.get(0),
                )
                .unwrap();
            assert!(con_existencia > 0);
        }

        #[test]
        fn los_dudosos_son_unos_pocos_y_dicen_por_que() {
            let db = abrir_en_memoria_con_catalogo().unwrap();

            let (cuantos, sin_motivo): (i64, i64) = db
                .query_row(
                    "SELECT COUNT(*),
                            SUM(CASE WHEN revisar_motivo IS NULL THEN 1 ELSE 0 END)
                     FROM productos WHERE revisar = 1",
                    [], |f| Ok((f.get(0)?, f.get(1)?)),
                )
                .unwrap();

            assert!(cuantos > 0 && cuantos < 20, "quedaron {cuantos} por revisar");
            assert_eq!(sin_motivo, 0, "cada uno dice por que hay que mirarlo");
        }

        #[test]
        fn no_se_carga_encima_de_un_inventario_que_ya_existe() {
            let db = abrir_en_memoria().unwrap();
            db.execute(
                "INSERT INTO productos
                   (codigo, nombre, categoria_id, presentacion, existencia, precio_venta)
                 VALUES ('MIO-1', 'LO MIO', 1, 'unidad', 5, 1000)",
                [],
            )
            .unwrap();

            crate::db::migraciones::aplicar(&db).unwrap();

            let cuantos: i64 = db
                .query_row("SELECT COUNT(*) FROM productos", [], |f| f.get(0))
                .unwrap();
            assert_eq!(cuantos, 1, "quien ya cargo lo suyo no quiere otro catalogo encima");
        }
    }

    /// La 003 recrea la tabla de productos para soltar el CHECK del
    /// envase. Copiar una tabla con datos adentro es lo mas delicado que
    /// hace este sistema: si se pierde una fila, se pierde inventario de
    /// alguien que ya estaba trabajando.
    /// La mudanza del historial de precios.
    ///
    /// Corre sobre la base de alguien que ya tiene el programa y ya le ha
    /// cambiado el precio a cosas. Si la copia falla, esa persona pierde
    /// la unica constancia de cuando subio cada producto.
    mod historial_de_precios {
        /// La base como estaba antes de la 009, con cambios ya anotados.
        ///
        /// Desde una conexion limpia y no desde `abrir_en_memoria`: esa
        /// se salta la migracion del catalogo, y pedirle despues
        /// `aplicar_hasta(8)` se la mete de vuelta con sus 24 productos.
        fn base_con_cambios() -> rusqlite::Connection {
            let db = rusqlite::Connection::open_in_memory().unwrap();
            db.pragma_update(None, "foreign_keys", "ON").unwrap();
            crate::db::migraciones::aplicar_hasta(&db, 8).unwrap();

            db.execute_batch(
                "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
                 VALUES ('admin', 'Camilo', 'h', 'ADMINISTRADOR');
                 INSERT INTO productos
                   (codigo, nombre, categoria_id, presentacion, existencia,
                    precio_venta, stock_minimo)
                 SELECT 'PDV-PRUEBA', 'POKER DE PRUEBA', id, '330 ml', 38, 3900, 6
                 FROM categorias LIMIT 1;

                 INSERT INTO precios_historial
                   (producto_id, precio_anterior, precio_nuevo, motivo, usuario_id)
                 SELECT p.id, 2700, 3000, 'Cambio manual', 1
                 FROM productos p WHERE p.codigo = 'PDV-PRUEBA';
                 INSERT INTO precios_historial
                   (producto_id, precio_anterior, precio_nuevo, motivo, usuario_id)
                 SELECT p.id, 3000, 3900, 'Cambio manual', 1
                 FROM productos p WHERE p.codigo = 'PDV-PRUEBA';",
            )
            .unwrap();
            db
        }

        #[test]
        fn lo_que_ya_estaba_anotado_sobrevive() {
            let db = base_con_cambios();

            crate::db::migraciones::aplicar(&db).unwrap();

            let cambios: Vec<(Option<i64>, i64)> = {
                let mut c = db
                    .prepare(
                        "SELECT h.precio_anterior, h.precio_nuevo
                         FROM precios_historial h
                         JOIN productos p ON p.id = h.producto_id
                         WHERE p.codigo = 'PDV-PRUEBA'
                         ORDER BY h.id",
                    )
                    .unwrap();
                c.query_map([], |f| Ok((f.get(0)?, f.get(1)?)))
                    .unwrap()
                    .collect::<Result<_, _>>()
                    .unwrap()
            };

            assert_eq!(cambios, vec![(Some(2700), 3000), (Some(3000), 3900)]);
        }

        #[test]
        fn lo_viejo_queda_sin_empaque_porque_no_lo_tenia() {
            let db = base_con_cambios();

            crate::db::migraciones::aplicar(&db).unwrap();

            let con_empaque: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM precios_historial WHERE empaque_nombre IS NOT NULL",
                    [], |f| f.get(0),
                )
                .unwrap();
            assert_eq!(con_empaque, 0);
        }

        #[test]
        fn la_tabla_nueva_ya_no_referencia_empaques() {
            let db = base_con_cambios();
            crate::db::migraciones::aplicar(&db).unwrap();

            // La referencia en cascada era una mina: editar un producto
            // borra e inserta sus empaques, y se habria llevado por
            // delante el historial.
            let sql: String = db
                .query_row(
                    "SELECT sql FROM sqlite_master
                     WHERE type='table' AND name='precios_historial'",
                    [], |f| f.get(0),
                )
                .unwrap();
            assert!(!sql.contains("producto_empaques"), "sigue referenciando empaques: {sql}");
            assert!(sql.contains("empaque_nombre"));
        }
    }

    mod catalogos_abiertos {
        use crate::db::abrir_en_memoria;

        /// Deja la base como estaba antes de la 003, con datos dentro.
        fn base_con_datos() -> rusqlite::Connection {
            let db = abrir_en_memoria().unwrap();
            crate::db::migraciones::aplicar_hasta(&db, 2).unwrap();

            db.execute_batch(
                "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
                 VALUES ('admin', 'Camilo', 'h', 'ADMINISTRADOR');
                 INSERT INTO marcas (nombre) VALUES ('Bavaria');
                 INSERT INTO productos
                   (id, codigo, nombre, categoria_id, marca_id, presentacion,
                    volumen_ml, envase, existencia, precio_venta, stock_minimo,
                    stock_maximo, costo_promedio, notas, revisar, revisar_motivo)
                 VALUES
                   (1, 'CER-POKER-330B', 'POKER', 1, 1, '330 ml', 330, 'BOTELLA',
                    38, 3900, 6, 120, 2600, 'la de siempre', 1, 'precio dudoso'),
                   (2, 'MEC-MARGARITA', 'MARGARITA', 1, NULL, 'MEDIO',
                    NULL, NULL, 5, 3500, 2, NULL, NULL, NULL, 0, NULL);

                 INSERT INTO producto_empaques
                   (producto_id, nombre, factor, precio_venta, para_venta)
                 VALUES (1, 'Unidad', 1, 3900, 1), (1, 'Six', 6, 25000, 1);

                 INSERT INTO movimientos_inventario
                   (producto_id, tipo, cantidad_base, existencia_antes,
                    existencia_despues, motivo, usuario_id)
                 VALUES (1, 'IMPORTACION', 38, 0, 38, 'carga inicial', 1);",
            )
            .unwrap();
            db
        }

        #[test]
        fn los_productos_sobreviven_a_la_copia_de_la_tabla() {
            let db = base_con_datos();
            crate::db::migraciones::aplicar(&db).unwrap();

            let fila: (String, String, i64, i64, i64, Option<String>, Option<String>) = db
                .query_row(
                    "SELECT codigo, nombre, existencia, precio_venta, revisar,
                            revisar_motivo, notas
                     FROM productos WHERE id = 1",
                    [],
                    |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?, f.get(4)?,
                            f.get(5)?, f.get(6)?)),
                )
                .unwrap();

            assert_eq!(fila.0, "CER-POKER-330B");
            assert_eq!(fila.1, "POKER");
            assert_eq!(fila.2, 38, "la existencia no se puede perder");
            assert_eq!(fila.3, 3900);
            assert_eq!(fila.4, 1, "la marca de revisar tiene que seguir");
            assert_eq!(fila.5.as_deref(), Some("precio dudoso"));
            assert_eq!(fila.6.as_deref(), Some("la de siempre"));

            let cuantos: i64 = db
                .query_row("SELECT COUNT(*) FROM productos", [], |f| f.get(0))
                .unwrap();
            assert_eq!(cuantos, 2, "no se puede quedar ningun producto por el camino");
        }

        #[test]
        fn lo_que_apunta_a_un_producto_sigue_apuntando() {
            let db = base_con_datos();
            crate::db::migraciones::aplicar(&db).unwrap();

            let empaques: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM producto_empaques WHERE producto_id = 1",
                    [], |f| f.get(0),
                )
                .unwrap();
            let movimientos: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM movimientos_inventario WHERE producto_id = 1",
                    [], |f| f.get(0),
                )
                .unwrap();

            assert_eq!(empaques, 2);
            assert_eq!(movimientos, 1);
        }

        #[test]
        fn las_vistas_vuelven_a_funcionar() {
            let db = base_con_datos();
            crate::db::migraciones::aplicar(&db).unwrap();

            let descuadre: i64 = db
                .query_row(
                    "SELECT descuadre FROM v_existencia_calculada WHERE producto_id = 1",
                    [], |f| f.get(0),
                )
                .unwrap();
            assert_eq!(descuadre, 0);

            let _: i64 = db
                .query_row("SELECT COUNT(*) FROM v_productos_alerta", [], |f| f.get(0))
                .unwrap();
        }

        #[test]
        fn los_indices_se_rehacen() {
            let db = base_con_datos();
            crate::db::migraciones::aplicar(&db).unwrap();

            let indices: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'index' AND tbl_name = 'productos'
                       AND name LIKE 'idx_productos_%'",
                    [], |f| f.get(0),
                )
                .unwrap();
            assert_eq!(indices, 5, "los cinco indices tienen que volver");
        }

        /// El motivo de todo esto: antes, guardar una garrafa era
        /// imposible porque el CHECK solo admitia siete envases.
        #[test]
        fn ahora_se_puede_usar_un_envase_que_antes_no_existia() {
            let db = base_con_datos();
            crate::db::migraciones::aplicar(&db).unwrap();

            db.execute(
                "INSERT INTO productos
                   (codigo, nombre, categoria_id, presentacion, envase, precio_venta)
                 VALUES ('LIC-AGUARDIENTE-GAR', 'AGUARDIENTE', 1, '2 L', 'GARRAFA', 45000)",
                [],
            )
            .expect("una garrafa tiene que poder guardarse");

            let envase: String = db
                .query_row(
                    "SELECT envase FROM productos WHERE codigo = 'LIC-AGUARDIENTE-GAR'",
                    [], |f| f.get(0),
                )
                .unwrap();
            assert_eq!(envase, "GARRAFA");
        }

        #[test]
        fn las_listas_nuevas_llegan_con_sus_opciones() {
            let db = abrir_en_memoria().unwrap();
            crate::db::migraciones::aplicar(&db).unwrap();

            let envases: i64 = db
                .query_row("SELECT COUNT(*) FROM envases WHERE activo = 1", [], |f| f.get(0))
                .unwrap();
            let unidades: i64 = db
                .query_row("SELECT COUNT(*) FROM unidades WHERE activo = 1", [], |f| f.get(0))
                .unwrap();

            assert_eq!(envases, 11);
            assert_eq!(unidades, 5);
        }

        #[test]
        fn correrla_de_nuevo_no_vuelve_a_copiar_la_tabla() {
            let db = base_con_datos();
            crate::db::migraciones::aplicar(&db).unwrap();
            crate::db::migraciones::aplicar(&db).unwrap();

            let productos: i64 = db
                .query_row("SELECT COUNT(*) FROM productos", [], |f| f.get(0))
                .unwrap();
            let envases: i64 = db
                .query_row("SELECT COUNT(*) FROM envases", [], |f| f.get(0))
                .unwrap();

            assert_eq!(productos, 2);
            assert_eq!(envases, 11, "los envases no se pueden duplicar");
        }
    }
}
