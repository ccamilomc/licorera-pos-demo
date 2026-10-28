-- Gastos del negocio, uno por uno y con su fecha.
--
-- Antes eran cinco numeros guardados en `configuracion` -- arriendo,
-- energia, internet, aseo, bolsas -- y el estado de resultados los
-- prorrateaba por dias sobre 30. Eso fallaba por los dos lados: no habia
-- manera de anotar el sueldo de un empleado ni una reparacion, y un
-- arriendo que sube en julio obligaba a pisar el valor viejo, con lo que
-- los meses anteriores quedaban recalculados con una cifra que en su
-- momento no fue la real.
--
-- Un gasto es ahora un hecho con fecha: lo que se pago, cuando y por que.
-- El estado de resultados suma los del periodo consultado, sin repartir
-- nada. Se repite «bolsas» todos los meses y cada vez es un renglon.

-- Las categorias las administra el dueño, como el resto de las listas.
CREATE TABLE gasto_categorias (
  id     INTEGER PRIMARY KEY,
  nombre TEXT    NOT NULL UNIQUE,
  -- Los fijos se repiten todos los meses; los variables, no. Sirve para
  -- proponer y para leer el estado de resultados, no para calcular.
  fijo   INTEGER NOT NULL DEFAULT 1,
  orden  INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,

  CHECK (TRIM(nombre) <> ''),
  CHECK (fijo IN (0, 1)),
  CHECK (activo IN (0, 1))
);

INSERT INTO gasto_categorias (nombre, fijo, orden) VALUES
  ('Arriendo',            1, 1),
  ('Servicios públicos',  1, 2),
  ('Internet y teléfono', 1, 3),
  ('Sueldos',             1, 4),
  ('Seguridad social',    1, 5),
  ('Aseo',                1, 6),
  ('Bolsas y empaque',    0, 7),
  ('Impuestos y trámites', 0, 8),
  ('Mantenimiento',       0, 9),
  ('Transporte',          0, 10),
  ('Otros',               0, 11);

CREATE TABLE gastos (
  id           INTEGER PRIMARY KEY,
  fecha        TEXT    NOT NULL,
  categoria_id INTEGER REFERENCES gasto_categorias(id),
  concepto     TEXT    NOT NULL,
  -- Enteros, como todo el dinero de este programa.
  monto        INTEGER NOT NULL,
  nota         TEXT,
  usuario_id   INTEGER REFERENCES usuarios(id),
  -- No se borra: se anula, con motivo, como las ventas y las compras.
  anulado      INTEGER NOT NULL DEFAULT 0,
  motivo_anulacion TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),

  CHECK (monto > 0),
  CHECK (TRIM(concepto) <> ''),
  CHECK (anulado IN (0, 1)),
  CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

CREATE INDEX idx_gastos_fecha ON gastos(fecha);
CREATE INDEX idx_gastos_categoria ON gastos(categoria_id);
