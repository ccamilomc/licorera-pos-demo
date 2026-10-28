-- =============================================================================
-- TRIBUNA POS - Catalogos abiertos
--
-- El sistema nacio leyendo el Excel del negocio, y de ahi salieron listas
-- cerradas: siete envases y las categorias que el archivo traia. Pero el
-- Excel es un punto de partida, no el molde: quien instale el programa
-- tiene que poder cargar SU inventario, con productos que ese archivo
-- nunca tuvo.
--
-- Esta migracion abre esas listas. Los envases pasan a ser una tabla que
-- se puede ampliar, en vez de un CHECK que obliga a recompilar.
-- =============================================================================

CREATE TABLE envases (
  id         INTEGER PRIMARY KEY,
  nombre     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  orden      INTEGER NOT NULL DEFAULT 0,
  activo     INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Los siete de siempre, mas los que faltaban para una licorera de verdad.
INSERT INTO envases (nombre, orden) VALUES
  ('BOTELLA', 10), ('LATA', 20), ('TETRAPAK', 30), ('GARRAFA', 40),
  ('CAJA', 50), ('BOLSA', 60), ('PAQUETE', 70), ('SOBRE', 80),
  ('BARRIL', 90), ('VASO', 100), ('NINGUNO', 999);

-- Unidades en las que se lleva la existencia. La mayoria de productos se
-- cuentan de a uno, pero el hielo se vende por kilo y hay cosas que se
-- miden por litro.
CREATE TABLE unidades (
  id         INTEGER PRIMARY KEY,
  codigo     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nombre     TEXT    NOT NULL,
  orden      INTEGER NOT NULL DEFAULT 0,
  activo     INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1))
);

INSERT INTO unidades (codigo, nombre, orden) VALUES
  ('UNIDAD', 'Unidad',    10),
  ('GRAMO',  'Gramos',    20),
  ('KILO',   'Kilos',     30),
  ('ML',     'Mililitros',40),
  ('LITRO',  'Litros',    50);

-- -----------------------------------------------------------------------
-- Recrear productos sin el CHECK cerrado del envase.
--
-- SQLite no sabe soltar un CHECK, asi que toca copiar la tabla. Las
-- claves foraneas de las otras tablas apuntan por nombre, de modo que al
-- renombrar la nueva siguen valiendo. Va dentro de la transaccion de la
-- migracion: o queda entera o no queda nada.
--
-- Las vistas si estorban: SQLite las revisa al soltar la tabla y aborta
-- con «no such table: main.productos». Se quitan antes y se rehacen al
-- final, iguales a como estaban.
-- -----------------------------------------------------------------------

DROP VIEW v_productos_alerta;
DROP VIEW v_existencia_calculada;

CREATE TABLE productos_nuevo (
  id             INTEGER PRIMARY KEY,
  codigo         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nombre         TEXT    NOT NULL,
  categoria_id   INTEGER NOT NULL REFERENCES categorias(id),
  marca_id       INTEGER          REFERENCES marcas(id),

  presentacion   TEXT    NOT NULL,
  volumen_ml     INTEGER CHECK (volumen_ml IS NULL OR volumen_ml > 0),
  -- Ya no es una lista fija: se valida contra la tabla envases.
  envase         TEXT,

  unidad_base    TEXT    NOT NULL DEFAULT 'UNIDAD',
  existencia     INTEGER NOT NULL DEFAULT 0,
  stock_minimo   INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  stock_maximo   INTEGER CHECK (stock_maximo IS NULL OR stock_maximo >= stock_minimo),

  precio_venta   INTEGER NOT NULL DEFAULT 0 CHECK (precio_venta >= 0),
  costo_ultimo   INTEGER CHECK (costo_ultimo IS NULL OR costo_ultimo >= 0),
  costo_promedio INTEGER CHECK (costo_promedio IS NULL OR costo_promedio >= 0),

  activo         INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  revisar        INTEGER NOT NULL DEFAULT 0 CHECK (revisar IN (0,1)),
  revisar_motivo TEXT,

  notas          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO productos_nuevo
  (id, codigo, nombre, categoria_id, marca_id, presentacion, volumen_ml,
   envase, unidad_base, existencia, stock_minimo, stock_maximo, precio_venta,
   costo_ultimo, costo_promedio, activo, revisar, revisar_motivo, notas,
   created_at, updated_at)
SELECT
   id, codigo, nombre, categoria_id, marca_id, presentacion, volumen_ml,
   envase, unidad_base, existencia, stock_minimo, stock_maximo, precio_venta,
   costo_ultimo, costo_promedio, activo, revisar, revisar_motivo, notas,
   created_at, updated_at
FROM productos;

DROP TABLE productos;
ALTER TABLE productos_nuevo RENAME TO productos;

-- Los indices se van con la tabla vieja: hay que rehacer los cinco, tal
-- como estaban.
CREATE INDEX idx_productos_categoria ON productos(categoria_id) WHERE activo = 1;
CREATE INDEX idx_productos_marca     ON productos(marca_id)     WHERE activo = 1;
CREATE INDEX idx_productos_nombre    ON productos(nombre COLLATE NOCASE);
CREATE INDEX idx_productos_bajos     ON productos(existencia)
  WHERE activo = 1 AND stock_minimo > 0;
CREATE INDEX idx_productos_revisar   ON productos(revisar) WHERE revisar = 1;

-- Las dos vistas, tal como estaban en la migracion inicial.
CREATE VIEW v_productos_alerta AS
SELECT p.id, p.codigo, p.nombre, p.presentacion, c.nombre AS categoria,
       p.existencia, p.stock_minimo,
       CASE WHEN p.existencia <= 0            THEN 'AGOTADO'
            WHEN p.existencia <= p.stock_minimo THEN 'BAJO'
       END AS alerta
FROM productos p
JOIN categorias c ON c.id = p.categoria_id
WHERE p.activo = 1
  AND (p.existencia <= 0 OR (p.stock_minimo > 0 AND p.existencia <= p.stock_minimo));

CREATE VIEW v_existencia_calculada AS
SELECT p.id AS producto_id, p.nombre, p.existencia AS existencia_guardada,
       COALESCE(SUM(m.cantidad_base), 0) AS existencia_calculada,
       p.existencia - COALESCE(SUM(m.cantidad_base), 0) AS descuadre
FROM productos p
LEFT JOIN movimientos_inventario m ON m.producto_id = p.id
GROUP BY p.id;
