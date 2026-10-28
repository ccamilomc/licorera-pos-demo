-- El historial de precios, para que se pueda ver y no se pueda perder.
--
-- La tabla existia desde el principio y nadie la leia: cada cambio de
-- precio quedaba anotado y no habia pantalla que lo mostrara. Ademas solo
-- guardaba el precio principal del producto; subir el six de 25.000 a
-- 26.000 no quedaba en ninguna parte.
--
-- Y traia una mina. `empaque_id` referenciaba `producto_empaques` con
-- ON DELETE CASCADE, y editar un producto borra e inserta sus empaques
-- de nuevo. El dia que alguien anotara un cambio de precio de empaque, la
-- siguiente edicion de ese producto se llevaria por delante su historial.
--
-- Se guarda el **nombre** del empaque y no su id: el nombre sobrevive a
-- ese borrado, y ademas es lo que el dueño reconoce. «El six subio a
-- 26.000» se entiende; «el empaque 47 subio» no.

CREATE TABLE precios_historial_nuevo (
  id              INTEGER PRIMARY KEY,
  producto_id     INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  -- Cual forma de venta cambio. NULL es el precio principal del producto.
  empaque_nombre  TEXT,
  precio_anterior INTEGER,
  precio_nuevo    INTEGER NOT NULL,
  motivo          TEXT,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Lo que ya estaba anotado se conserva: son cambios de verdad que el
-- dueño hizo, y ninguno tenia empaque.
INSERT INTO precios_historial_nuevo
  (id, producto_id, empaque_nombre, precio_anterior, precio_nuevo, motivo,
   usuario_id, created_at)
SELECT id, producto_id, NULL, precio_anterior, precio_nuevo, motivo,
       usuario_id, created_at
FROM precios_historial;

DROP TABLE precios_historial;
ALTER TABLE precios_historial_nuevo RENAME TO precios_historial;

CREATE INDEX idx_precios_producto ON precios_historial(producto_id, created_at DESC);
CREATE INDEX idx_precios_fecha ON precios_historial(created_at DESC);
