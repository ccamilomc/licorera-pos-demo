-- =============================================================================
-- TRIBUNA POS - Esquema inicial
-- =============================================================================
-- Convenciones que se aplican en TODO el esquema:
--
--   DINERO      INTEGER en pesos colombianos, sin centavos. Nunca REAL:
--               los decimales binarios acumulan error y descuadran la caja.
--   FECHAS      TEXT en ISO-8601 UTC ('2026-08-19T14:30:00Z'). Ordenable
--               como texto, comparable con BETWEEN, sin ambiguedad horaria.
--   BOOLEANOS   INTEGER 0/1 con CHECK. SQLite no tiene tipo booleano.
--   BORRADOS    No existen. Se desactiva (activo=0) o se anula (estado).
--   CANTIDADES  Siempre en UNIDAD BASE del producto. Ver nota de empaques.
--
-- NOTA SOBRE EMPAQUES (la decision central de este esquema)
--   Un producto se cuenta en una sola unidad fisica: la botella, la lata,
--   la cajetilla, el paquete. Eso es `productos.existencia`.
--   Las formas de comprar y vender ese producto -- unidad, six, media
--   canasta, canasta, carton -- viven en `producto_empaques` con un factor
--   que dice cuantas unidades base contiene cada una.
--   Vender un six de Poker descuenta 6 botellas. Comprar una canasta
--   suma 30. El precio de cada empaque es independiente, no calculado:
--   en La Tribuna el six de Poker cuesta 25.000 y la botella suelta 3.900,
--   que son 23.400 -- no son proporcionales y no deben serlo.
--
--   El ENVASE (lata / botella) NO es un empaque: distingue al producto.
--   Corona lata 269ml y Corona botella 330ml son dos productos distintos,
--   cada uno con su propia escalera de empaques.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- =============================================================================
-- SEGURIDAD Y ACCESO
-- =============================================================================

CREATE TABLE usuarios (
  id                INTEGER PRIMARY KEY,
  usuario           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nombre            TEXT    NOT NULL,
  password_hash     TEXT    NOT NULL,              -- Argon2id. Nunca texto plano.
  rol               TEXT    NOT NULL REFERENCES roles(codigo),
  activo            INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta   TEXT,
  ultimo_ingreso    TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE roles (
  codigo      TEXT PRIMARY KEY CHECK (codigo IN ('ADMINISTRADOR','ENCARGADO','CAJERO')),
  nombre      TEXT NOT NULL,
  descripcion TEXT NOT NULL
);

-- Que puede hacer cada rol. Los codigos de permiso son constantes en el
-- codigo; esta tabla decide quien los tiene, para poder ajustarlos sin
-- recompilar y sin inventar una jerarquia de roles que el negocio no usa.
CREATE TABLE rol_permisos (
  rol     TEXT NOT NULL REFERENCES roles(codigo) ON DELETE CASCADE,
  permiso TEXT NOT NULL,
  PRIMARY KEY (rol, permiso)
);

CREATE TABLE sesiones (
  id         INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  inicio     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  fin        TEXT,
  motivo_fin TEXT CHECK (motivo_fin IS NULL OR motivo_fin IN ('CIERRE','INACTIVIDAD','CAIDA'))
);
CREATE INDEX idx_sesiones_usuario ON sesiones(usuario_id, inicio DESC);

-- =============================================================================
-- CATALOGO
-- =============================================================================

CREATE TABLE categorias (
  id         INTEGER PRIMARY KEY,
  nombre     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  orden      INTEGER NOT NULL DEFAULT 0,   -- respeta el orden del Excel del negocio
  activo     INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Permite el precio por familia: cambiar el precio de "Hit" y que cambien
-- sus cuatro sabores. Ver hallazgo H8 del analisis.
CREATE TABLE marcas (
  id         INTEGER PRIMARY KEY,
  nombre     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  activo     INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE productos (
  id             INTEGER PRIMARY KEY,
  codigo         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nombre         TEXT    NOT NULL,
  categoria_id   INTEGER NOT NULL REFERENCES categorias(id),
  marca_id       INTEGER          REFERENCES marcas(id),

  -- Presentacion en TEXTO, no numero. El Excel tenia '750', pero tambien
  -- 'MEDIO' (cigarrillos), '1.5' y '1 LITRO'. Exigir un numero fue
  -- exactamente lo que hizo perder 30 productos en las hojas BD_ (H2).
  presentacion   TEXT    NOT NULL,
  volumen_ml     INTEGER CHECK (volumen_ml IS NULL OR volumen_ml > 0),
  envase         TEXT    CHECK (envase IS NULL OR envase IN
                     ('BOTELLA','LATA','TETRAPAK','CAJA','BOLSA','PAQUETE','NINGUNO')),

  unidad_base    TEXT    NOT NULL DEFAULT 'UNIDAD',
  existencia     INTEGER NOT NULL DEFAULT 0,
  stock_minimo   INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  stock_maximo   INTEGER CHECK (stock_maximo IS NULL OR stock_maximo >= stock_minimo),

  -- Precio y costo de UNA unidad base. Los precios de los demas empaques
  -- viven en producto_empaques, no se derivan de este.
  precio_venta   INTEGER NOT NULL DEFAULT 0 CHECK (precio_venta >= 0),
  costo_ultimo   INTEGER CHECK (costo_ultimo IS NULL OR costo_ultimo >= 0),
  costo_promedio INTEGER CHECK (costo_promedio IS NULL OR costo_promedio >= 0),

  activo         INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),

  -- Marca los productos que llegaron del Excel con datos contradictorios
  -- (precios en conflicto, presentacion ambigua) para revisarlos dentro
  -- de la app en vez de adivinar durante la importacion.
  revisar        INTEGER NOT NULL DEFAULT 0 CHECK (revisar IN (0,1)),
  revisar_motivo TEXT,

  notas          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_productos_categoria ON productos(categoria_id) WHERE activo = 1;
CREATE INDEX idx_productos_marca     ON productos(marca_id)     WHERE activo = 1;
CREATE INDEX idx_productos_nombre    ON productos(nombre COLLATE NOCASE);
CREATE INDEX idx_productos_bajos     ON productos(existencia)
  WHERE activo = 1 AND stock_minimo > 0;
CREATE INDEX idx_productos_revisar   ON productos(revisar) WHERE revisar = 1;

-- Varios codigos por producto: la misma cerveza cambia de codigo de barras
-- entre lotes, y algunos productos no traen ninguno.
CREATE TABLE producto_codigos (
  id          INTEGER PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  codigo      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  tipo        TEXT    NOT NULL DEFAULT 'BARRAS' CHECK (tipo IN ('BARRAS','INTERNO')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_codigos_producto ON producto_codigos(producto_id);

-- -----------------------------------------------------------------------------
-- EMPAQUES: las formas de comprar y vender un producto.
-- Resuelve el six-pack, la canasta, la media canasta y el carton de
-- cigarrillos con un solo mecanismo.
-- -----------------------------------------------------------------------------
CREATE TABLE producto_empaques (
  id            INTEGER PRIMARY KEY,
  producto_id   INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  nombre        TEXT    NOT NULL,                    -- 'Unidad', 'Six', 'Canasta'
  factor        INTEGER NOT NULL CHECK (factor > 0), -- unidades base que contiene

  -- Precio independiente, NO calculado desde el precio unitario.
  -- NULL significa que no se vende (o no se compra) en esta presentacion.
  precio_venta  INTEGER CHECK (precio_venta  IS NULL OR precio_venta  >= 0),
  costo_compra  INTEGER CHECK (costo_compra  IS NULL OR costo_compra  >= 0),

  para_venta    INTEGER NOT NULL DEFAULT 1 CHECK (para_venta  IN (0,1)),
  para_compra   INTEGER NOT NULL DEFAULT 1 CHECK (para_compra IN (0,1)),
  predeterminado INTEGER NOT NULL DEFAULT 0 CHECK (predeterminado IN (0,1)),
  orden         INTEGER NOT NULL DEFAULT 0,
  activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  UNIQUE (producto_id, nombre),
  -- Si se vende en esta presentacion, tiene que tener precio.
  CHECK (para_venta = 0 OR precio_venta IS NOT NULL)
);
CREATE INDEX idx_empaques_producto ON producto_empaques(producto_id) WHERE activo = 1;
-- Un solo empaque predeterminado por producto: el que propone la caja.
CREATE UNIQUE INDEX idx_empaques_predeterminado
  ON producto_empaques(producto_id) WHERE predeterminado = 1;

-- Todo cambio de precio queda registrado. Exigido para trazabilidad.
CREATE TABLE precios_historial (
  id             INTEGER PRIMARY KEY,
  producto_id    INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  empaque_id     INTEGER          REFERENCES producto_empaques(id) ON DELETE CASCADE,
  precio_anterior INTEGER,
  precio_nuevo   INTEGER NOT NULL,
  motivo         TEXT,
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_precios_producto ON precios_historial(producto_id, created_at DESC);

-- =============================================================================
-- PROVEEDORES Y COMPRAS
-- =============================================================================

CREATE TABLE proveedores (
  id         INTEGER PRIMARY KEY,
  nombre     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nit        TEXT,
  telefono   TEXT,
  contacto   TEXT,
  direccion  TEXT,
  notas      TEXT,
  activo     INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Reemplaza la matriz producto x proveedor del Excel. Guarda el precio y
-- en que empaque lo vende ese proveedor, que es justo el dato que faltaba
-- para poder calcular el costo unitario (H4).
CREATE TABLE proveedor_productos (
  id            INTEGER PRIMARY KEY,
  proveedor_id  INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  producto_id   INTEGER NOT NULL REFERENCES productos(id)   ON DELETE CASCADE,
  empaque_id    INTEGER          REFERENCES producto_empaques(id) ON DELETE SET NULL,
  precio        INTEGER NOT NULL CHECK (precio >= 0),
  nombre_origen TEXT,          -- como lo llama el proveedor, para reconciliar
  fecha_precio  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (proveedor_id, producto_id, empaque_id)
);
CREATE INDEX idx_provprod_producto ON proveedor_productos(producto_id);

CREATE TABLE compras (
  id           INTEGER PRIMARY KEY,
  numero       TEXT    NOT NULL UNIQUE,
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  documento    TEXT,                                   -- factura o remision
  fecha        TEXT    NOT NULL,
  subtotal     INTEGER NOT NULL DEFAULT 0,
  descuento    INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  estado       TEXT    NOT NULL DEFAULT 'REGISTRADA'
                 CHECK (estado IN ('REGISTRADA','ANULADA')),
  notas        TEXT,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_compras_fecha     ON compras(fecha DESC);
CREATE INDEX idx_compras_proveedor ON compras(proveedor_id, fecha DESC);

CREATE TABLE compra_items (
  id                INTEGER PRIMARY KEY,
  compra_id         INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  producto_id       INTEGER NOT NULL REFERENCES productos(id),
  empaque_id        INTEGER          REFERENCES producto_empaques(id),
  cantidad_empaques INTEGER NOT NULL CHECK (cantidad_empaques > 0),
  factor            INTEGER NOT NULL CHECK (factor > 0),  -- congelado al comprar
  cantidad_base     INTEGER NOT NULL CHECK (cantidad_base > 0),
  costo_empaque     INTEGER NOT NULL CHECK (costo_empaque >= 0),
  costo_unitario    INTEGER NOT NULL CHECK (costo_unitario >= 0),
  total             INTEGER NOT NULL CHECK (total >= 0)
);
CREATE INDEX idx_compraitems_compra   ON compra_items(compra_id);
CREATE INDEX idx_compraitems_producto ON compra_items(producto_id);

-- =============================================================================
-- CAJA
-- =============================================================================

CREATE TABLE cajas (
  id                INTEGER PRIMARY KEY,
  usuario_apertura  INTEGER NOT NULL REFERENCES usuarios(id),
  usuario_cierre    INTEGER          REFERENCES usuarios(id),
  apertura          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  cierre            TEXT,
  base_inicial      INTEGER NOT NULL CHECK (base_inicial >= 0),

  -- Se llenan al cerrar. `contado` lo digita el cajero ANTES de ver el
  -- esperado: un arqueo que muestra el numero primero no es un control.
  efectivo_contado  INTEGER,
  efectivo_esperado INTEGER,
  diferencia        INTEGER,

  estado            TEXT    NOT NULL DEFAULT 'ABIERTA'
                      CHECK (estado IN ('ABIERTA','CERRADA')),
  observaciones     TEXT
);
-- Una sola caja abierta a la vez, garantizado por el motor y no por la
-- pantalla. Una validacion de interfaz se puede saltar; un indice no.
CREATE UNIQUE INDEX idx_caja_unica_abierta ON cajas(estado) WHERE estado = 'ABIERTA';
CREATE INDEX idx_cajas_apertura ON cajas(apertura DESC);

CREATE TABLE metodos_pago (
  id          INTEGER PRIMARY KEY,
  codigo      TEXT    NOT NULL UNIQUE,
  nombre      TEXT    NOT NULL,
  es_efectivo INTEGER NOT NULL DEFAULT 0 CHECK (es_efectivo IN (0,1)),
  orden       INTEGER NOT NULL DEFAULT 0,
  activo      INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1))
);

CREATE TABLE movimientos_caja (
  id         INTEGER PRIMARY KEY,
  caja_id    INTEGER NOT NULL REFERENCES cajas(id),
  tipo       TEXT    NOT NULL CHECK (tipo IN ('ENTRADA','SALIDA')),
  concepto   TEXT    NOT NULL,
  monto      INTEGER NOT NULL CHECK (monto > 0),
  referencia_tipo TEXT CHECK (referencia_tipo IS NULL OR
                    referencia_tipo IN ('VENTA','ANULACION','COMPRA','MANUAL')),
  referencia_id   INTEGER,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_movcaja_caja ON movimientos_caja(caja_id, created_at);

-- =============================================================================
-- VENTAS
-- =============================================================================

CREATE TABLE ventas (
  id         INTEGER PRIMARY KEY,
  numero     INTEGER NOT NULL UNIQUE,
  caja_id    INTEGER NOT NULL REFERENCES cajas(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  subtotal   INTEGER NOT NULL CHECK (subtotal >= 0),
  descuento  INTEGER NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  impuesto   INTEGER NOT NULL DEFAULT 0 CHECK (impuesto >= 0),
  total      INTEGER NOT NULL CHECK (total >= 0),
  estado     TEXT    NOT NULL DEFAULT 'COMPLETADA'
               CHECK (estado IN ('COMPLETADA','ANULADA')),
  -- Se vendio algo que el sistema creia agotado. No bloquea la venta:
  -- si el cajero tiene la botella en la mano, la existencia esta mal.
  -- Queda marcada para el reporte de descuadres.
  con_faltante INTEGER NOT NULL DEFAULT 0 CHECK (con_faltante IN (0,1)),
  notas      TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_ventas_fecha   ON ventas(created_at DESC);
CREATE INDEX idx_ventas_caja    ON ventas(caja_id);
CREATE INDEX idx_ventas_usuario ON ventas(usuario_id, created_at DESC);
CREATE INDEX idx_ventas_estado  ON ventas(estado) WHERE estado = 'ANULADA';

CREATE TABLE venta_items (
  id                INTEGER PRIMARY KEY,
  venta_id          INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id       INTEGER NOT NULL REFERENCES productos(id),
  empaque_id        INTEGER          REFERENCES producto_empaques(id),

  -- Se guarda el nombre tal como estaba al vender. Si mañana se renombra
  -- el producto, el recibo de ayer sigue diciendo lo que decia.
  nombre_producto   TEXT    NOT NULL,
  nombre_empaque    TEXT    NOT NULL,

  cantidad_empaques INTEGER NOT NULL CHECK (cantidad_empaques > 0),
  factor            INTEGER NOT NULL CHECK (factor > 0),
  cantidad_base     INTEGER NOT NULL CHECK (cantidad_base > 0),

  -- Precio y costo CONGELADOS. Sin esto, cambiar un precio hoy reescribe
  -- los reportes de todo el historial.
  precio_unitario   INTEGER NOT NULL CHECK (precio_unitario >= 0),
  costo_unitario    INTEGER,
  descuento         INTEGER NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  total             INTEGER NOT NULL CHECK (total >= 0)
);
CREATE INDEX idx_ventaitems_venta    ON venta_items(venta_id);
CREATE INDEX idx_ventaitems_producto ON venta_items(producto_id);

CREATE TABLE venta_pagos (
  id             INTEGER PRIMARY KEY,
  venta_id       INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  metodo_pago_id INTEGER NOT NULL REFERENCES metodos_pago(id),
  monto          INTEGER NOT NULL CHECK (monto > 0),
  recibido       INTEGER,     -- solo efectivo: con cuanto pago
  cambio         INTEGER      -- solo efectivo: cuanto se devolvio
);
CREATE INDEX idx_ventapagos_venta ON venta_pagos(venta_id);

-- Una venta nunca se borra. Se anula, y la anulacion deja su propio rastro.
CREATE TABLE anulaciones (
  id            INTEGER PRIMARY KEY,
  venta_id      INTEGER NOT NULL UNIQUE REFERENCES ventas(id),
  motivo        TEXT    NOT NULL,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
  autorizado_por INTEGER         REFERENCES usuarios(id),
  caja_id       INTEGER NOT NULL REFERENCES cajas(id),  -- caja donde se devolvio
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- =============================================================================
-- INVENTARIO
-- =============================================================================

-- El libro mayor del inventario. La existencia en `productos` se puede
-- reconstruir sumando esta tabla; si alguna vez no cuadra, aqui esta la
-- evidencia de en que movimiento se rompio.
CREATE TABLE movimientos_inventario (
  id                INTEGER PRIMARY KEY,
  producto_id       INTEGER NOT NULL REFERENCES productos(id),
  tipo              TEXT    NOT NULL CHECK (tipo IN
                      ('VENTA','ANULACION','COMPRA','AJUSTE',
                       'DEVOLUCION_PROVEEDOR','BAJA','IMPORTACION')),
  -- Con signo: positivo entra, negativo sale. Nunca cero.
  cantidad_base     INTEGER NOT NULL CHECK (cantidad_base <> 0),
  empaque_id        INTEGER          REFERENCES producto_empaques(id),
  cantidad_empaques INTEGER,
  existencia_antes  INTEGER NOT NULL,
  existencia_despues INTEGER NOT NULL,
  referencia_tipo   TEXT    CHECK (referencia_tipo IS NULL OR
                      referencia_tipo IN ('VENTA','COMPRA','ANULACION','MANUAL','IMPORTACION')),
  referencia_id     INTEGER,
  motivo            TEXT,
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_movinv_producto ON movimientos_inventario(producto_id, created_at DESC);
CREATE INDEX idx_movinv_fecha    ON movimientos_inventario(created_at DESC);
CREATE INDEX idx_movinv_tipo     ON movimientos_inventario(tipo, created_at DESC);

-- =============================================================================
-- SISTEMA
-- =============================================================================

-- Solo acepta inserciones. Ni el administrador la edita desde la app.
CREATE TABLE auditoria (
  id           INTEGER PRIMARY KEY,
  usuario_id   INTEGER          REFERENCES usuarios(id),
  usuario_nombre TEXT   NOT NULL,          -- congelado: el usuario puede cambiar
  accion       TEXT    NOT NULL,
  entidad      TEXT    NOT NULL,
  entidad_id   INTEGER,
  descripcion  TEXT    NOT NULL,
  valor_antes  TEXT,                       -- JSON
  valor_despues TEXT,                      -- JSON
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_auditoria_fecha   ON auditoria(created_at DESC);
CREATE INDEX idx_auditoria_usuario ON auditoria(usuario_id, created_at DESC);
CREATE INDEX idx_auditoria_entidad ON auditoria(entidad, entidad_id);

CREATE TRIGGER auditoria_no_update BEFORE UPDATE ON auditoria
BEGIN SELECT RAISE(ABORT, 'La auditoria no se puede modificar'); END;

CREATE TRIGGER auditoria_no_delete BEFORE DELETE ON auditoria
BEGIN SELECT RAISE(ABORT, 'La auditoria no se puede borrar'); END;

CREATE TABLE configuracion (
  clave       TEXT PRIMARY KEY,
  valor       TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'TEXTO'
                CHECK (tipo IN ('TEXTO','NUMERO','BOOLEANO','JSON')),
  descripcion TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE respaldos (
  id           INTEGER PRIMARY KEY,
  archivo      TEXT    NOT NULL,
  ruta         TEXT    NOT NULL,
  tamano_bytes INTEGER NOT NULL,
  tipo         TEXT    NOT NULL CHECK (tipo IN
                 ('MANUAL','CIERRE_APP','CIERRE_CAJA','PRE_RESTAURACION','PRE_IMPORTACION')),
  integridad   TEXT    NOT NULL DEFAULT 'PENDIENTE'
                 CHECK (integridad IN ('PENDIENTE','VERIFICADO','DANADO')),
  usuario_id   INTEGER REFERENCES usuarios(id),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_respaldos_fecha ON respaldos(created_at DESC);

-- =============================================================================
-- VISTAS de consulta frecuente
-- =============================================================================

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

-- Existencia recalculada desde el libro de movimientos, para contrastarla
-- con productos.existencia y detectar cualquier descuadre.
CREATE VIEW v_existencia_calculada AS
SELECT p.id AS producto_id, p.nombre, p.existencia AS existencia_guardada,
       COALESCE(SUM(m.cantidad_base), 0) AS existencia_calculada,
       p.existencia - COALESCE(SUM(m.cantidad_base), 0) AS descuadre
FROM productos p
LEFT JOIN movimientos_inventario m ON m.producto_id = p.id
GROUP BY p.id;
