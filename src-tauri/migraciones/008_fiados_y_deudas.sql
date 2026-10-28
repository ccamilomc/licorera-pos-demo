-- Lo que deben y lo que se debe.
--
-- En una licorera de barrio «me lo apunta» es medio negocio, y hasta
-- ahora no habia donde apuntarlo. La venta fiada se registraba como
-- cualquier otra, asi que el arqueo esperaba encontrar en la caja una
-- plata que nadie habia entregado, y el cierre salia descuadrado todos
-- los dias sin que nadie supiera por que.
--
-- Del otro lado pasa lo mismo: el proveedor deja la mercancia el martes y
-- cobra el viernes. Toda compra se anotaba como pagada de contado, asi
-- que no habia forma de saber cuanto se le debe a quien.
--
-- El saldo nunca se guarda. Se calcula restandole los abonos al total.
-- Un saldo guardado se desincroniza el dia que alguien anule un abono, y
-- entonces el sistema y el cuaderno del dueño dicen cosas distintas.

-- =============================================================================
-- CLIENTES
-- =============================================================================

CREATE TABLE clientes (
  id         INTEGER PRIMARY KEY,
  nombre     TEXT    NOT NULL,
  telefono   TEXT,
  documento  TEXT,
  nota       TEXT,
  -- Hasta cuanto se le fia. 0 es sin tope, que es lo normal al empezar.
  cupo       INTEGER NOT NULL DEFAULT 0,
  activo     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  CHECK (TRIM(nombre) <> ''),
  CHECK (cupo >= 0),
  CHECK (activo IN (0, 1))
);

CREATE INDEX idx_clientes_nombre ON clientes(nombre);

-- =============================================================================
-- LO QUE DEBEN
-- =============================================================================

CREATE TABLE cuentas_cobrar (
  id         INTEGER PRIMARY KEY,
  venta_id   INTEGER NOT NULL UNIQUE REFERENCES ventas(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  monto      INTEGER NOT NULL,
  -- Cuando se anula la venta, la deuda se va con ella.
  anulada    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  CHECK (monto > 0),
  CHECK (anulada IN (0, 1))
);

CREATE INDEX idx_cuentas_cliente ON cuentas_cobrar(cliente_id, anulada);

CREATE TABLE abonos (
  id             INTEGER PRIMARY KEY,
  cuenta_id      INTEGER NOT NULL REFERENCES cuentas_cobrar(id),
  monto          INTEGER NOT NULL,
  metodo_pago_id INTEGER NOT NULL REFERENCES metodos_pago(id),
  -- La caja en que entro la plata, si entro en efectivo. Sin esto, un
  -- abono en efectivo no aparece en el arqueo y vuelve el descuadre.
  caja_id        INTEGER REFERENCES cajas(id),
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id),
  nota           TEXT,
  anulado        INTEGER NOT NULL DEFAULT 0,
  motivo_anulacion TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  CHECK (monto > 0),
  CHECK (anulado IN (0, 1))
);

CREATE INDEX idx_abonos_cuenta ON abonos(cuenta_id, anulado);

-- Cuanto debe cada cliente, con los abonos ya restados.
CREATE VIEW saldos_clientes AS
SELECT c.id                                  AS cliente_id,
       c.nombre,
       c.telefono,
       c.cupo,
       c.activo,
       COALESCE(SUM(cc.monto), 0)            AS fiado,
       COALESCE(SUM(cc.abonado), 0)          AS abonado,
       COALESCE(SUM(cc.monto - cc.abonado), 0) AS saldo,
       COUNT(cc.id)                          AS cuentas
FROM clientes c
LEFT JOIN (
  SELECT cu.id,
         cu.cliente_id,
         cu.monto,
         COALESCE((SELECT SUM(a.monto) FROM abonos a
                   WHERE a.cuenta_id = cu.id AND a.anulado = 0), 0) AS abonado
  FROM cuentas_cobrar cu
  WHERE cu.anulada = 0
) cc ON cc.cliente_id = c.id
GROUP BY c.id;

-- =============================================================================
-- LO QUE SE DEBE
-- =============================================================================

-- La compra puede quedar debiendo. `vence` es cuando toca pagarla.
ALTER TABLE compras ADD COLUMN a_credito INTEGER NOT NULL DEFAULT 0;
ALTER TABLE compras ADD COLUMN vence TEXT;

CREATE TABLE pagos_compra (
  id             INTEGER PRIMARY KEY,
  compra_id      INTEGER NOT NULL REFERENCES compras(id),
  monto          INTEGER NOT NULL,
  fecha          TEXT    NOT NULL,
  metodo_pago_id INTEGER REFERENCES metodos_pago(id),
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id),
  nota           TEXT,
  anulado        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  CHECK (monto > 0),
  CHECK (anulado IN (0, 1)),
  CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

CREATE INDEX idx_pagoscompra_compra ON pagos_compra(compra_id, anulado);

-- Cuanto se le debe a cada proveedor.
CREATE VIEW saldos_proveedores AS
SELECT p.id                                   AS proveedor_id,
       p.nombre,
       COALESCE(SUM(cp.total), 0)             AS comprado,
       COALESCE(SUM(cp.pagado), 0)            AS pagado,
       COALESCE(SUM(cp.total - cp.pagado), 0) AS saldo,
       COUNT(cp.id)                           AS compras
FROM proveedores p
LEFT JOIN (
  SELECT c.id,
         c.proveedor_id,
         c.total,
         COALESCE((SELECT SUM(pc.monto) FROM pagos_compra pc
                   WHERE pc.compra_id = c.id AND pc.anulado = 0), 0) AS pagado
  FROM compras c
  WHERE c.estado = 'REGISTRADA' AND c.a_credito = 1
) cp ON cp.proveedor_id = p.id
GROUP BY p.id;

-- =============================================================================
-- EL MÉTODO DE PAGO
-- =============================================================================

-- Fiado no es efectivo: esa plata no esta en el cajon. Con esto el arqueo
-- deja de esperarla y el cierre vuelve a cuadrar.
INSERT INTO metodos_pago (codigo, nombre, es_efectivo, orden)
SELECT 'FIADO', 'Fiado', 0, 4
WHERE NOT EXISTS (SELECT 1 FROM metodos_pago WHERE codigo = 'FIADO');
