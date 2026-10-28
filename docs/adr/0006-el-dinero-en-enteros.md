# 6. El dinero se guarda en enteros

Fecha: 2026-08-19
Estado: aceptado

## La decisión

Todo valor monetario se almacena como entero de 64 bits, en pesos colombianos.
Nunca `REAL` en SQLite ni `f64` en Rust.

## Por qué

Los decimales de computador no representan exactamente valores como 0,1. Sumar
muchos precios acumula un error diminuto que, después de un día de ventas,
convierte un cierre que debería cuadrar en uno que difiere por unos pesos.

Ese descuadre es especialmente malo porque es pequeño: no se ve como un error del
sistema, se ve como si al cajero le faltara plata.

El peso colombiano además no usa centavos en la práctica, así que el entero no
pierde nada.

## Cómo se aplica

- Esquema: `INTEGER` con `CHECK (>= 0)` donde corresponde.
- Rust: `i64`.
- TypeScript: `number` entero; `pesos()` formatea al mostrar y `Math.round`
  redondea al entrar.
- Los repartos que no dividen exacto (el costo de una canasta entre 30 botellas)
  redondean **hacia abajo**, para no inflar el costo y con eso desinflar la
  utilidad.

## Consecuencias

- Los totales cuadran siempre, sin margen de tolerancia.
- Si algún día hace falta otra moneda con centavos, se guardarían centavos como
  enteros. La regla no cambia: enteros.
