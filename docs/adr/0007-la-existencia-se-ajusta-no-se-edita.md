# 7. La existencia se ajusta, no se edita

Fecha: 2026-08-19
Estado: aceptado

## La decisión

En la ficha de producto se puede cambiar el nombre, el precio, la categoría y las
formas de venta. La **existencia no**: es un dato de solo lectura.

Para cambiarla hay un botón aparte, *Ajustar existencia*, que pide dos cosas:
cuánto entra o sale, y **por qué**. Sin motivo no se aplica.

## Por qué

Si editar un producto pudiera cambiar el stock de paso, se perdería la única
pregunta que importa cuando el inventario no cuadra: *¿por qué cambió?*

Un ajuste sin motivo es indistinguible de un error de dedo. Uno con motivo —
«conteo físico», «se rompieron dos», «vencido» — es información que sirve para
encontrar el patrón: si todos los meses se rompen botellas en el mismo sitio,
eso se puede arreglar.

## Diferencia con las ventas

Una venta **sí** puede dejar la existencia en negativo: si el cajero tiene la
botella en la mano, la existencia está mal, no la botella. Bloquear la venta solo
consigue que se cobre por fuera del sistema.

Un ajuste manual **no**: aquí nadie tiene nada en la mano, es puro conteo. Un
ajuste que deja negativo es siempre un error de quien lo escribe, y se rechaza.

## Consecuencias

- Cada ajuste genera un movimiento en el libro y un registro de auditoría con
  quién, cuándo, cuánto y por qué.
- El kardex de un producto cuenta su historia completa sin huecos.
- Corregir un conteo cuesta dos clics más. Es el precio de poder explicarlo
  después.
