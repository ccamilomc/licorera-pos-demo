-- Los gastos con los que arranca el negocio.
--
-- Va aparte de la 006 a proposito: aquella crea las tablas y esta mete
-- datos. Las pruebas se saltan las de datos, porque cinco gastos de
-- ruido hacen ilegible cualquier comprobacion de una suma; el esquema,
-- en cambio, lo necesitan todas.

-- Los cinco valores del Excel pasan a ser gastos del mes en curso, para
-- que el estado de resultados no quede en blanco de un dia para otro.
-- Se anotan el primero del mes, que es cuando se pagan.
INSERT INTO gastos (fecha, categoria_id, concepto, monto, nota)
SELECT date('now', 'localtime', 'start of month'),
       (SELECT id FROM gasto_categorias WHERE nombre = c.categoria),
       c.concepto,
       CAST(v.valor AS INTEGER),
       'Venía de la configuración inicial. Revísalo y ajústalo.'
FROM (
  SELECT 'gastos.arriendo' AS clave, 'Arriendo del local' AS concepto,
         'Arriendo' AS categoria
  UNION ALL SELECT 'gastos.energia',  'Energía',  'Servicios públicos'
  UNION ALL SELECT 'gastos.internet', 'Internet', 'Internet y teléfono'
  UNION ALL SELECT 'gastos.aseo',     'Aseo',     'Aseo'
  UNION ALL SELECT 'gastos.bolsas',   'Bolsas',   'Bolsas y empaque'
) AS c
JOIN configuracion v ON v.clave = c.clave
WHERE CAST(v.valor AS INTEGER) > 0;

-- Y se van de la configuración: dos fuentes para el mismo numero es la
-- forma segura de que se contradigan.
DELETE FROM configuracion WHERE clave LIKE 'gastos.%';
