# 2. Las operaciones que tocan varias tablas se procesan en Rust

Fecha: 2026-08-19
Estado: aceptado

## El problema

Una venta toca cinco tablas: crea la venta, sus renglones, sus pagos, descuenta
el stock de cada producto y escribe el libro de inventario.

Si el computador se apaga a la mitad —y en un local comercial se va la luz— el
resultado tiene que ser **todo o nada**. Una venta con el inventario descontado a
medias es el error clásico de los POS caseros, y el más difícil de detectar
después: nadie se entera hasta que el conteo físico no cuadra, semanas más tarde.

## La decisión

La interfaz manda la operación **completa** y recibe una respuesta. Nunca escribe
paso a paso.

Todo lo que toca más de una tabla vive en el núcleo, dentro de una transacción de
SQLite: `ventas::registrar`, `ventas::anular`, `importacion::aplicar`,
`caja::cerrar`.

La base se abre en modo WAL. Cada transacción se escribe primero en un diario
aparte y solo después se consolida; si el equipo se apaga a la mitad, al arrancar
SQLite termina o deshace la operación automáticamente.

## Cómo está probado

- `una_categoria_inexistente_no_deja_nada_a_medias`: se importa una lista donde
  el segundo producto tiene una categoría inválida. La base queda con **cero**
  productos, ni siquiera el primero, que sí era válido.
- `un_producto_inexistente_deja_el_inventario_intacto`: igual con una venta.
- `si_el_pago_no_cuadra_no_se_registra_nada`.

## Consecuencias

- La interfaz no puede dejar datos a medias aunque quisiera: no tiene forma.
- Los comandos de Tauri son una capa fina que valida permisos y traduce errores.
  La lógica está debajo, y se prueba sin levantar la aplicación.
- Un `return Err(...)` dentro de la transacción la revierte al soltarse. Hay que
  tener cuidado de **no** hacer commit antes de las validaciones.
