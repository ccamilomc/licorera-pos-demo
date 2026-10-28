-- =============================================================================
-- TRIBUNA POS - Precios con vigencia, recargos e impuesto configurable
--
-- Tres cosas que el mostrador necesita y el sistema no permitia:
--
--  1. Subir o bajar el precio de algo solo por hoy, sin perder el precio
--     de siempre ni tener que acordarse de devolverlo mañana.
--  2. Cobrar un recargo con su motivo -- domicilio, servicio, lo que
--     sea -- por monto o por porcentaje.
--  3. Separar un impuesto, si el negocio lo maneja separado. Por omision
--     va en cero: los precios de la licorera son precio final.
-- =============================================================================

-- -----------------------------------------------------------------------
-- Precios con fecha de vencimiento
--
-- No se toca `productos.precio_venta`: ese es el precio de siempre y
-- tiene que seguir ahi para volver a el solo cuando la promocion acabe.
-- Si se sobreescribiera, al vencer nadie sabria a cuanto se vendia antes.
-- -----------------------------------------------------------------------
CREATE TABLE precios_vigencia (
  id           INTEGER PRIMARY KEY,
  producto_id  INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  -- NULL = el precio de la unidad. Si no, el de ese empaque.
  empaque_id   INTEGER          REFERENCES producto_empaques(id) ON DELETE CASCADE,

  precio       INTEGER NOT NULL CHECK (precio >= 0),
  motivo       TEXT,

  -- Ambas fechas incluidas. Un solo dia es desde = hasta.
  desde        TEXT    NOT NULL,
  hasta        TEXT    NOT NULL,

  activo       INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Las restricciones de tabla van al final: en medio de las columnas
  -- SQLite las rechaza.
  CHECK (hasta >= desde)
);

CREATE INDEX idx_precios_vigencia_producto
  ON precios_vigencia(producto_id) WHERE activo = 1;

-- -----------------------------------------------------------------------
-- Recargos de la venta
--
-- El descuento ya existia por renglon; esto es lo contrario y va sobre la
-- venta entera: el domicilio, el servicio, lo que se cobre de mas. Lleva
-- su concepto porque un recargo sin motivo en un recibo es una queja.
-- -----------------------------------------------------------------------
ALTER TABLE ventas ADD COLUMN recargo INTEGER NOT NULL DEFAULT 0
  CHECK (recargo >= 0);
ALTER TABLE ventas ADD COLUMN recargo_concepto TEXT;

-- Que porcentaje se aplico, cuando se cobro por porcentaje y no por monto
-- fijo. Se guarda para poder explicar el numero despues.
ALTER TABLE ventas ADD COLUMN recargo_porcentaje INTEGER;

-- -----------------------------------------------------------------------
-- Impuesto, si el negocio lo separa
--
-- En cero por omision. La licorera vende a precio final y separar un
-- impuesto que nadie cobra solo ensuciaria los recibos. Queda listo para
-- quien lo necesite.
-- -----------------------------------------------------------------------
-- `impuesto.activo` e `impuesto.porcentaje` ya venian de la migracion
-- inicial. Aqui solo se agrega lo que falta para poder mostrarlo bien, y
-- se aclaran las descripciones, que es lo que se ve en Configuracion.
INSERT INTO configuracion (clave, valor, tipo, descripcion) VALUES
  ('impuesto.nombre', 'IVA', 'TEXTO',
   'Como se llama en el recibo. Solo se usa si el porcentaje es mayor que cero.'),
  ('impuesto.incluido', '1', 'BOOLEANO',
   'Si esta activo: 1 = el precio ya lo incluye y se desglosa; 0 = se suma al total.');

UPDATE configuracion
   SET descripcion = 'Cobrar impuesto separado. Apagado, los precios son precio final.'
 WHERE clave = 'impuesto.activo';

UPDATE configuracion
   SET descripcion = 'Porcentaje del impuesto. Solo cuenta si esta activo.'
 WHERE clave = 'impuesto.porcentaje';

-- Conceptos de recargo que se ofrecen de a un toque, para no escribirlos
-- cada vez. El dueño puede cambiarlos.
INSERT INTO configuracion (clave, valor, tipo, descripcion) VALUES
  ('venta.recargos_sugeridos', 'Domicilio,Servicio,Recargo nocturno', 'TEXTO',
   'Separados por coma. Aparecen como botones al cobrar.');
