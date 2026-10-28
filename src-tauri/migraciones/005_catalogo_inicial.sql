-- =============================================================================
-- TRIBUNA POS - Catalogo de ejemplo
--
-- 26 productos de muestra con precios y existencias inventados, para que la
-- demo arranque con algo que vender. Se pueden editar o retirar: son
-- productos normales.
--
-- Solo corre si la base esta vacia de productos.
-- =============================================================================

CREATE TEMP TABLE IF NOT EXISTS hay_productos AS
  SELECT COUNT(*) AS n FROM productos;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'WHI-OLDPARR-750B', 'OLD PARR',
       (SELECT id FROM categorias WHERE nombre = 'Whisky' COLLATE NOCASE),
       '750 ml', 750, 'BOTELLA',
       'UNIDAD', 2, 144500,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Whisky' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 144500,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'WHI-OLDPARR-750B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'WHI-SOMETHINGE-750B', 'SOMETHING ESPECIAL',
       (SELECT id FROM categorias WHERE nombre = 'Whisky' COLLATE NOCASE),
       '750 ml', 750, 'BOTELLA',
       'UNIDAD', 9, 85500,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Whisky' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 85500,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'WHI-SOMETHINGE-750B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'TEQ-JOSECUERVO-750B', 'JOSE CUERVO',
       (SELECT id FROM categorias WHERE nombre = 'Tequila' COLLATE NOCASE),
       '750 ml', 750, 'BOTELLA',
       'UNIDAD', 16, 109000,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Tequila' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 109000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'TEQ-JOSECUERVO-750B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'AGU-AGUARDENTE-750B', 'AGUARDENTE ROSADO',
       (SELECT id FROM categorias WHERE nombre = 'Aguardiente' COLLATE NOCASE),
       '750 ml', 750, 'BOTELLA',
       'UNIDAD', 4, 73000,
       6, 1, 'Inventario dice 74000 y la lista de precios 73000.'
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Aguardiente' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 73000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'AGU-AGUARDENTE-750B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'AGU-ANTIOQUENO-750B-3', 'ANTIOQUEÑO VERDE',
       (SELECT id FROM categorias WHERE nombre = 'Aguardiente' COLLATE NOCASE),
       '750 ml', 750, 'BOTELLA',
       'UNIDAD', 11, 56500,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Aguardiente' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 56500,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'AGU-ANTIOQUENO-750B-3'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'AGU-AMARILLO-750B', 'AMARILLO',
       (SELECT id FROM categorias WHERE nombre = 'Aguardiente' COLLATE NOCASE),
       '750 ml', 750, 'BOTELLA',
       'UNIDAD', 18, 59500,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Aguardiente' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 59500,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'AGU-AMARILLO-750B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'AGU-TAPAROJA-375B', 'TAPA ROJA',
       (SELECT id FROM categorias WHERE nombre = 'Aguardiente' COLLATE NOCASE),
       '375 ml', 375, 'BOTELLA',
       'UNIDAD', 6, 32500,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Aguardiente' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 32500,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'AGU-TAPAROJA-375B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'BRA-ALFONSOBRA-700B', 'ALFONSO BRANDY',
       (SELECT id FROM categorias WHERE nombre = 'Brandy' COLLATE NOCASE),
       '700 ml', 700, 'BOTELLA',
       'UNIDAD', 13, 47500,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Brandy' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 47500,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'BRA-ALFONSOBRA-700B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'VIN-SANTALUCIA-750B-2', 'SANTA LUCIA VINO BLANCO',
       (SELECT id FROM categorias WHERE nombre = 'Champaña y vinos' COLLATE NOCASE),
       '750 ml', 750, 'BOTELLA',
       'UNIDAD', 20, 20000,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Champaña y vinos' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 20000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'VIN-SANTALUCIA-750B-2'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'CER-CORONA-269L', 'CORONA',
       (SELECT id FROM categorias WHERE nombre = 'Cervezas' COLLATE NOCASE),
       '269 ml', 269, 'LATA',
       'UNIDAD', 8, 4500,
       6, 1, 'Six: inventario dice 27000 y la lista 28000.'
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Cervezas' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 4500,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'CER-CORONA-269L'
  AND (SELECT n FROM hay_productos) = 0;
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Six', 6, 29500,
       1, 1,
       0, 6
FROM productos p WHERE p.codigo = 'CER-CORONA-269L'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'CER-STELLAARTO-269L', 'STELLA ARTOIS',
       (SELECT id FROM categorias WHERE nombre = 'Cervezas' COLLATE NOCASE),
       '269 ml', 269, 'LATA',
       'UNIDAD', 15, 4000,
       6, 1, 'Inventario dice 5000 y la lista de precios 4500.'
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Cervezas' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 4000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'CER-STELLAARTO-269L'
  AND (SELECT n FROM hay_productos) = 0;
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Six', 6, 24000,
       1, 1,
       0, 6
FROM productos p WHERE p.codigo = 'CER-STELLAARTO-269L'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'CER-REEDSROSAD-269L', 'REEDS ROSADA',
       (SELECT id FROM categorias WHERE nombre = 'Cervezas' COLLATE NOCASE),
       '269 ml', 269, 'LATA',
       'UNIDAD', 3, 3500,
       6, 1, 'Inventario dice 3900 y la lista de precios 3700.'
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Cervezas' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 3500,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'CER-REEDSROSAD-269L'
  AND (SELECT n FROM hay_productos) = 0;
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Six', 6, 21500,
       1, 1,
       0, 6
FROM productos p WHERE p.codigo = 'CER-REEDSROSAD-269L'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'GAS-AGUACRISTA-300B', 'AGUA CRISTAL',
       (SELECT id FROM categorias WHERE nombre = 'Gaseosas y aguas' COLLATE NOCASE),
       '300 ml', 300, 'BOTELLA',
       'UNIDAD', 10, 1000,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Gaseosas y aguas' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 1000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'GAS-AGUACRISTA-300B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'GAS-POSTOBONCO-1500B', 'POSTOBON COLOMBIANA',
       (SELECT id FROM categorias WHERE nombre = 'Gaseosas y aguas' COLLATE NOCASE),
       '1,5 L', 1500, 'BOTELLA',
       'UNIDAD', 17, 7000,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Gaseosas y aguas' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 7000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'GAS-POSTOBONCO-1500B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'GAS-HITPINA-500B', 'HIT PIÑA',
       (SELECT id FROM categorias WHERE nombre = 'Gaseosas y aguas' COLLATE NOCASE),
       '500 ml', 500, 'BOTELLA',
       'UNIDAD', 5, 3500,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Gaseosas y aguas' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 3500,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'GAS-HITPINA-500B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'GAS-GATORADEMA-500B-2', 'GATORADE MANDARINA',
       (SELECT id FROM categorias WHERE nombre = 'Gaseosas y aguas' COLLATE NOCASE),
       '500 ml', 500, 'BOTELLA',
       'UNIDAD', 12, 4000,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Gaseosas y aguas' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 4000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'GAS-GATORADEMA-500B-2'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'GAS-FOURLOKOMO-473B', 'FOUR LOKO MORADO',
       (SELECT id FROM categorias WHERE nombre = 'Gaseosas y aguas' COLLATE NOCASE),
       '473 ml', 473, 'BOTELLA',
       'UNIDAD', 19, 16000,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Gaseosas y aguas' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 16000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'GAS-FOURLOKOMO-473B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'GAS-AMPERMANGO-473B', 'AMPER MANGO',
       (SELECT id FROM categorias WHERE nombre = 'Gaseosas y aguas' COLLATE NOCASE),
       '473 ml', 473, 'BOTELLA',
       'UNIDAD', 7, 4500,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Gaseosas y aguas' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 4500,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'GAS-AMPERMANGO-473B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'CIG-MARLBORORO-XU', 'MARLBORO ROJO',
       (SELECT id FROM categorias WHERE nombre = 'Cigarrillos' COLLATE NOCASE),
       'MEDIO', NULL, 'PAQUETE',
       'UNIDAD', 14, 8000,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Cigarrillos' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 8000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'CIG-MARLBORORO-XU'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'DUL-MARGARITA-XU-2', 'MARGARITA',
       (SELECT id FROM categorias WHERE nombre = 'Papas y dulces' COLLATE NOCASE),
       'Familiar', NULL, 'BOLSA',
       'UNIDAD', 2, 10500,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Papas y dulces' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 10500,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'DUL-MARGARITA-XU-2'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'DUL-TRIDENTX18-XU', 'TRIDENT X 18',
       (SELECT id FROM categorias WHERE nombre = 'Papas y dulces' COLLATE NOCASE),
       'Unidad', NULL, 'BOLSA',
       'UNIDAD', 9, 4000,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Papas y dulces' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 4000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'DUL-TRIDENTX18-XU'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'AGU-ANTIOQUENO-750B', 'ANTIOQUEÑO AZUL',
       (SELECT id FROM categorias WHERE nombre = 'Aguardiente' COLLATE NOCASE),
       '750 ml', 750, 'BOTELLA',
       'UNIDAD', 2, 62000,
       6, 1, 'Inventario dice 64000 y la lista de precios 62000.'
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Aguardiente' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 62000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'AGU-ANTIOQUENO-750B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'CER-POKER-330B', 'POKER',
       (SELECT id FROM categorias WHERE nombre = 'Cervezas' COLLATE NOCASE),
       '330 ml', 330, 'BOTELLA',
       'UNIDAD', 38, 3900,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Cervezas' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 3900,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'CER-POKER-330B'
  AND (SELECT n FROM hay_productos) = 0;
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Six', 6, 25000,
       1, 1,
       0, 6
FROM productos p WHERE p.codigo = 'CER-POKER-330B'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'CIG-MALBOROSAN-XU', 'MALBORO SANDIA',
       (SELECT id FROM categorias WHERE nombre = 'Cigarrillos' COLLATE NOCASE),
       'MEDIO', NULL, 'PAQUETE',
       'UNIDAD', 11, 8000,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Cigarrillos' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 8000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'CIG-MALBOROSAN-XU'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'CIG-CHESTERFIE-XU', 'CHESTERFIELD',
       (SELECT id FROM categorias WHERE nombre = 'Cigarrillos' COLLATE NOCASE),
       'MEDIO', NULL, 'PAQUETE',
       'UNIDAD', 18, 8500,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Cigarrillos' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 8500,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'CIG-CHESTERFIE-XU'
  AND (SELECT n FROM hay_productos) = 0;

INSERT INTO productos
  (codigo, nombre, categoria_id, presentacion, volumen_ml, envase,
   unidad_base, existencia, precio_venta, stock_minimo, revisar, revisar_motivo)
SELECT 'CIG-LUCKYAZUL-XU', 'LUCKY AZUL',
       (SELECT id FROM categorias WHERE nombre = 'Cigarrillos' COLLATE NOCASE),
       'MEDIO', NULL, 'PAQUETE',
       'UNIDAD', 6, 7000,
       6, 0, NULL
WHERE (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Cigarrillos' COLLATE NOCASE);
INSERT INTO producto_empaques
  (producto_id, nombre, factor, precio_venta, para_venta, para_compra, predeterminado, orden)
SELECT p.id, 'Unidad', 1, 7000,
       1, 1,
       1, 1
FROM productos p WHERE p.codigo = 'CIG-LUCKYAZUL-XU'
  AND (SELECT n FROM hay_productos) = 0;

-- La existencia inicial entra al libro de movimientos. Sin esto, la
-- existencia guardada y la calculada no coincidirian nunca y el sistema
-- reportaria un descuadre permanente que nadie podria explicar.
INSERT INTO movimientos_inventario
  (producto_id, tipo, cantidad_base, existencia_antes, existencia_despues,
   referencia_tipo, motivo, usuario_id)
SELECT p.id, 'IMPORTACION', p.existencia, 0, p.existencia,
       'IMPORTACION', 'Catalogo inicial del negocio',
       (SELECT id FROM usuarios ORDER BY id LIMIT 1)
FROM productos p
WHERE p.existencia > 0
  AND (SELECT n FROM hay_productos) = 0
  AND EXISTS (SELECT 1 FROM usuarios);

DROP TABLE hay_productos;