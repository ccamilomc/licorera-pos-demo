# 1. El envase distingue el producto; el empaque es la forma de moverlo

Fecha: 2026-08-19
Estado: aceptado

## El problema

El Excel del negocio tiene dos secciones separadas, «CERVEZAS X UNIDAD» y
«CERVEZAS X SIX», y Póker 330 aparece en las dos con existencias distintas: 8
sueltas y 5 six. No son dos cervezas. Son la misma, contada de dos formas.

Eso produce 15 pares duplicados y hace imposible saber cuánta cerveza hay:
¿son 13 botellas, o son 8 + 30 = 38?

En caja el problema es peor: si el cajero vende un six, no habría forma de
descontar las 6 botellas del otro renglón.

## Lo que se consideró

**Un producto por presentación, como está hoy.** Es lo que hace el Excel.
Rechazado: parte el stock en dos y obliga a que el cajero adivine de cuál
renglón descontar.

**Un producto con existencia y un factor fijo.** Rechazado por dos motivos que
salieron al preguntarle al dueño: a veces el six es en lata y la unidad en
botella, que no son lo mismo; y además existen la canasta de 30 y la media
canasta.

**Dos niveles separados.** Aceptado.

## La decisión

El **envase** (lata, botella, tetrapak) es un atributo del *producto*. Corona
lata de 269 ml y Corona botella de 330 ml son dos productos distintos, con
existencia y precio propios. El Excel ya los distinguía en el nombre.

El **empaque** (unidad, six, media canasta, canasta, cartón) vive en
`producto_empaques`, con un factor que dice cuántas unidades base contiene y su
propio precio. Aplica tanto a compras como a ventas.

La existencia se lleva siempre en la unidad física. Vender un six descuenta 6;
recibir una canasta suma 30.

## Por qué el precio no se calcula

Seis Póker sueltas cuestan $23.400 y el six vale $25.000. En el negocio de prueba el six
sale **más caro** por unidad, no más barato. Igual pasa con Michelo (+300) y
Corona botella (±0).

Un sistema que multiplicara el precio unitario por el factor cobraría mal todos
los días. Cada empaque guarda su propio precio, y la restricción
`para_venta = 0 OR precio_venta IS NOT NULL` impide que quede uno vendible sin él.

## Consecuencias

- Póker queda con 38 botellas y dos formas de venta. El conteo es el real.
- El mismo mecanismo cubre el cartón de cigarrillos y la Margarita familiar sin
  código nuevo.
- Añadir la canasta a un producto es insertar una fila, no tocar el modelo.
- El carrito agrupa por producto **más** empaque, no por producto solo: dos
  botellas sueltas y un six conviven como renglones distintos en la misma venta.
- El aviso de faltante suma las unidades de todas las formas del mismo producto
  antes de comparar con la existencia. Dos botellas más un six son ocho, no dos.
