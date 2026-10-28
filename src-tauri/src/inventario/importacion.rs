//! Aplica el plan de importacion en una sola transaccion.
//!
//! La interfaz lee el Excel, lo normaliza y arma el plan; aqui solo se
//! escribe. Todo o nada: si algo falla a mitad de camino, la base queda
//! exactamente como estaba y no con medio inventario cargado.
//!
//! Cada existencia inicial entra como un movimiento del libro, no como un
//! numero suelto. Sin eso, la existencia guardada y la suma del libro
//! nunca cuadrarian y el detector de descuadres marcaria diferencias
//! falsas desde el primer dia.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum ErrorImportacion {
    #[error("la categoria '{0}' no existe")]
    CategoriaDesconocida(String),
    #[error("el producto '{0}' no trae ninguna forma de venta")]
    SinEmpaques(String),
    #[error("error de base de datos")]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EmpaqueEntrante {
    pub nombre: String,
    pub factor: i64,
    pub precio_venta: i64,
    pub predeterminado: bool,
    pub orden: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProductoEntrante {
    pub codigo: String,
    pub nombre: String,
    pub categoria: String,
    pub presentacion: String,
    pub volumen_ml: Option<i64>,
    pub envase: Option<String>,
    pub existencia: i64,
    pub precio_venta: i64,
    pub empaques: Vec<EmpaqueEntrante>,
    pub revisar: bool,
    pub revisar_motivo: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PlanEntrante {
    pub crear: Vec<ProductoEntrante>,
    pub actualizar: Vec<ActualizacionEntrante>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ActualizacionEntrante {
    pub id: i64,
    pub producto: ProductoEntrante,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ResultadoImportacion {
    pub creados: usize,
    pub actualizados: usize,
    pub empaques: usize,
    pub movimientos: usize,
    pub unidades: i64,
}

/// Escribe el plan completo. `usuario_id` queda como responsable de todos
/// los movimientos que se generen.
pub fn aplicar(
    conexion: &mut Connection,
    plan: &PlanEntrante,
    usuario_id: i64,
) -> Result<ResultadoImportacion, ErrorImportacion> {
    let tx = conexion.transaction()?;
    let mut resultado = ResultadoImportacion {
        creados: 0,
        actualizados: 0,
        empaques: 0,
        movimientos: 0,
        unidades: 0,
    };

    for entrante in &plan.crear {
        let id = insertar_producto(&tx, entrante)?;
        resultado.empaques += insertar_empaques(&tx, id, entrante)?;

        if entrante.existencia != 0 {
            registrar_movimiento(
                &tx,
                id,
                entrante.existencia,
                0,
                entrante.existencia,
                "Carga inicial desde el Excel del negocio",
                usuario_id,
            )?;
            resultado.movimientos += 1;
            resultado.unidades += entrante.existencia;
        }
        resultado.creados += 1;
    }

    for actualizacion in &plan.actualizar {
        let anterior: i64 = tx.query_row(
            "SELECT existencia FROM productos WHERE id = ?1",
            params![actualizacion.id],
            |f| f.get(0),
        )?;

        actualizar_producto(&tx, actualizacion.id, &actualizacion.producto)?;

        // Los empaques se reemplazan enteros: es mas simple y mas seguro
        // que intentar casarlos uno por uno, y no hay historico que perder
        // porque las ventas guardan su propia copia del empaque.
        tx.execute(
            "DELETE FROM producto_empaques WHERE producto_id = ?1",
            params![actualizacion.id],
        )?;
        resultado.empaques += insertar_empaques(&tx, actualizacion.id, &actualizacion.producto)?;

        let diferencia = actualizacion.producto.existencia - anterior;
        if diferencia != 0 {
            registrar_movimiento(
                &tx,
                actualizacion.id,
                diferencia,
                anterior,
                actualizacion.producto.existencia,
                "Ajuste por importacion de Excel",
                usuario_id,
            )?;
            resultado.movimientos += 1;
            resultado.unidades += diferencia;
        }
        resultado.actualizados += 1;
    }

    registrar_auditoria(&tx, usuario_id, &resultado)?;
    tx.commit()?;
    Ok(resultado)
}

fn id_categoria(tx: &Transaction, nombre: &str) -> Result<i64, ErrorImportacion> {
    tx.query_row(
        "SELECT id FROM categorias WHERE nombre = ?1 COLLATE NOCASE",
        params![nombre],
        |f| f.get(0),
    )
    .optional()?
    .ok_or_else(|| ErrorImportacion::CategoriaDesconocida(nombre.to_owned()))
}

fn insertar_producto(
    tx: &Transaction,
    p: &ProductoEntrante,
) -> Result<i64, ErrorImportacion> {
    if p.empaques.is_empty() {
        return Err(ErrorImportacion::SinEmpaques(p.nombre.clone()));
    }
    let categoria_id = id_categoria(tx, &p.categoria)?;

    tx.execute(
        "INSERT INTO productos
           (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
            existencia, precio_venta, revisar, revisar_motivo)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            p.codigo,
            p.nombre,
            categoria_id,
            p.presentacion,
            p.volumen_ml,
            p.envase,
            p.existencia,
            p.precio_venta,
            i64::from(p.revisar),
            p.revisar_motivo,
        ],
    )?;
    Ok(tx.last_insert_rowid())
}

fn actualizar_producto(
    tx: &Transaction,
    id: i64,
    p: &ProductoEntrante,
) -> Result<(), ErrorImportacion> {
    let categoria_id = id_categoria(tx, &p.categoria)?;
    tx.execute(
        "UPDATE productos SET
           nombre = ?2, categoria_id = ?3, presentacion = ?4, volumen_ml = ?5,
           envase = ?6, existencia = ?7, precio_venta = ?8,
           revisar = ?9, revisar_motivo = ?10,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?1",
        params![
            id,
            p.nombre,
            categoria_id,
            p.presentacion,
            p.volumen_ml,
            p.envase,
            p.existencia,
            p.precio_venta,
            i64::from(p.revisar),
            p.revisar_motivo,
        ],
    )?;
    Ok(())
}

fn insertar_empaques(
    tx: &Transaction,
    producto_id: i64,
    p: &ProductoEntrante,
) -> Result<usize, ErrorImportacion> {
    let mut insertados = 0;
    for e in &p.empaques {
        tx.execute(
            "INSERT INTO producto_empaques
               (producto_id, nombre, factor, precio_venta, predeterminado, orden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                producto_id,
                e.nombre,
                e.factor,
                e.precio_venta,
                i64::from(e.predeterminado),
                e.orden,
            ],
        )?;
        insertados += 1;
    }
    Ok(insertados)
}

fn registrar_movimiento(
    tx: &Transaction,
    producto_id: i64,
    cantidad: i64,
    antes: i64,
    despues: i64,
    motivo: &str,
    usuario_id: i64,
) -> Result<(), ErrorImportacion> {
    tx.execute(
        "INSERT INTO movimientos_inventario
           (producto_id, tipo, cantidad_base, existencia_antes, existencia_despues,
            referencia_tipo, motivo, usuario_id)
         VALUES (?1, 'IMPORTACION', ?2, ?3, ?4, 'IMPORTACION', ?5, ?6)",
        params![producto_id, cantidad, antes, despues, motivo, usuario_id],
    )?;
    Ok(())
}

fn registrar_auditoria(
    tx: &Transaction,
    usuario_id: i64,
    r: &ResultadoImportacion,
) -> Result<(), ErrorImportacion> {
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
           (usuario_id, usuario_nombre, accion, entidad, descripcion, valor_despues)
         VALUES (?1, ?2, 'IMPORTAR', 'productos', ?3, ?4)",
        params![
            usuario_id,
            nombre,
            format!(
                "Importacion de Excel: {} productos creados, {} actualizados, {} unidades",
                r.creados, r.actualizados, r.unidades
            ),
            serde_json::to_string(r).unwrap_or_default(),
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db::abrir_en_memoria;

    fn base_con_usuario() -> Connection {
        let db = abrir_en_memoria().unwrap();
        db.execute(
            "INSERT INTO usuarios (usuario, nombre, password_hash, rol)
             VALUES ('admin', 'Camilo', 'h', 'ADMINISTRADOR')",
            [],
        )
        .unwrap();
        db
    }

    fn poker() -> ProductoEntrante {
        ProductoEntrante {
            codigo: "CER-POKER-330B".into(),
            nombre: "POKER".into(),
            categoria: "Cervezas".into(),
            presentacion: "330 ml".into(),
            volumen_ml: Some(330),
            envase: Some("BOTELLA".into()),
            existencia: 38,
            precio_venta: 3900,
            empaques: vec![
                EmpaqueEntrante {
                    nombre: "Unidad".into(),
                    factor: 1,
                    precio_venta: 3900,
                    predeterminado: true,
                    orden: 1,
                },
                EmpaqueEntrante {
                    nombre: "Six".into(),
                    factor: 6,
                    precio_venta: 25000,
                    predeterminado: false,
                    orden: 2,
                },
            ],
            revisar: false,
            revisar_motivo: None,
        }
    }

    #[test]
    fn crea_el_producto_con_sus_empaques_y_su_movimiento() {
        let mut db = base_con_usuario();
        let plan = PlanEntrante {
            crear: vec![poker()],
            actualizar: vec![],
        };

        let r = aplicar(&mut db, &plan, 1).unwrap();
        assert_eq!(r.creados, 1);
        assert_eq!(r.empaques, 2);
        assert_eq!(r.movimientos, 1);
        assert_eq!(r.unidades, 38);

        let existencia: i64 = db
            .query_row("SELECT existencia FROM productos WHERE codigo='CER-POKER-330B'", [], |f| f.get(0))
            .unwrap();
        assert_eq!(existencia, 38);
    }

    #[test]
    fn la_existencia_inicial_cuadra_con_el_libro_de_movimientos() {
        let mut db = base_con_usuario();
        let plan = PlanEntrante {
            crear: vec![poker()],
            actualizar: vec![],
        };
        aplicar(&mut db, &plan, 1).unwrap();

        // La vista compara la existencia guardada contra la suma del libro.
        let descuadre: i64 = db
            .query_row("SELECT descuadre FROM v_existencia_calculada", [], |f| f.get(0))
            .unwrap();
        assert_eq!(descuadre, 0, "la carga inicial debe dejar el libro cuadrado");
    }

    #[test]
    fn una_categoria_inexistente_no_deja_nada_a_medias() {
        let mut db = base_con_usuario();
        let mut malo = poker();
        malo.categoria = "Categoria Que No Existe".into();

        let plan = PlanEntrante {
            crear: vec![poker(), malo],
            actualizar: vec![],
        };

        let resultado = aplicar(&mut db, &plan, 1);
        assert!(resultado.is_err());

        // El primero era valido, pero la transaccion se revierte entera.
        let productos: i64 = db
            .query_row("SELECT COUNT(*) FROM productos", [], |f| f.get(0))
            .unwrap();
        assert_eq!(productos, 0, "todo o nada: no puede quedar el primero solo");
    }

    #[test]
    fn reimportar_actualiza_y_registra_la_diferencia() {
        let mut db = base_con_usuario();
        aplicar(
            &mut db,
            &PlanEntrante { crear: vec![poker()], actualizar: vec![] },
            1,
        )
        .unwrap();

        let id: i64 = db
            .query_row("SELECT id FROM productos WHERE codigo='CER-POKER-330B'", [], |f| f.get(0))
            .unwrap();

        let mut cambiado = poker();
        cambiado.existencia = 50;
        cambiado.precio_venta = 4100;

        let r = aplicar(
            &mut db,
            &PlanEntrante {
                crear: vec![],
                actualizar: vec![ActualizacionEntrante { id, producto: cambiado }],
            },
            1,
        )
        .unwrap();

        assert_eq!(r.actualizados, 1);
        assert_eq!(r.unidades, 12, "solo entra la diferencia, no las 50");

        let descuadre: i64 = db
            .query_row("SELECT descuadre FROM v_existencia_calculada", [], |f| f.get(0))
            .unwrap();
        assert_eq!(descuadre, 0);
    }

    #[test]
    fn reimportar_sin_cambios_no_genera_movimientos_fantasma() {
        let mut db = base_con_usuario();
        aplicar(
            &mut db,
            &PlanEntrante { crear: vec![poker()], actualizar: vec![] },
            1,
        )
        .unwrap();

        let id: i64 = db
            .query_row("SELECT id FROM productos WHERE codigo='CER-POKER-330B'", [], |f| f.get(0))
            .unwrap();

        let r = aplicar(
            &mut db,
            &PlanEntrante {
                crear: vec![],
                actualizar: vec![ActualizacionEntrante { id, producto: poker() }],
            },
            1,
        )
        .unwrap();

        assert_eq!(r.movimientos, 0, "misma existencia, ningun movimiento");
    }

    #[test]
    fn un_producto_sin_formas_de_venta_se_rechaza() {
        let mut db = base_con_usuario();
        let mut sin = poker();
        sin.empaques.clear();

        let resultado = aplicar(
            &mut db,
            &PlanEntrante { crear: vec![sin], actualizar: vec![] },
            1,
        );
        assert!(matches!(resultado, Err(ErrorImportacion::SinEmpaques(_))));
    }

    #[test]
    fn la_importacion_queda_en_la_auditoria() {
        let mut db = base_con_usuario();
        aplicar(
            &mut db,
            &PlanEntrante { crear: vec![poker()], actualizar: vec![] },
            1,
        )
        .unwrap();

        let registros: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM auditoria WHERE accion='IMPORTAR'",
                [],
                |f| f.get(0),
            )
            .unwrap();
        assert_eq!(registros, 1);
    }
}
