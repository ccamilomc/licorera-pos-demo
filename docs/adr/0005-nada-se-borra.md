# 5. Nada se borra

Fecha: 2026-08-19
Estado: aceptado

## La decisión

En todo el sistema no existe un solo `DELETE` de datos del negocio.

- Las **ventas** se anulan: cambian de estado, ganan un registro con quién,
  cuándo y por qué, y generan los movimientos que devuelven la mercancía.
- Las **compras** igual.
- Los **productos y usuarios** se desactivan.
- La **auditoría** tiene disparadores que rechazan `UPDATE` y `DELETE`, así que
  ni el administrador puede tocarla desde la aplicación.

## Por qué

Porque la pregunta que se hace cuando algo no cuadra siempre es la misma: *¿qué
pasó aquí?* Y esa pregunta no se puede responder sobre datos que ya no están.

Un cajero que puede borrar una venta puede quedarse con la plata sin dejar
rastro. Uno que solo puede anularla deja su nombre, la hora y el motivo.

## Consecuencias

- La base crece y nunca se encoge. Con el volumen de una licorera eso no es un
  problema: 2.000 ventas ocupan poco y las consultas siguen siendo instantáneas.
- Los reportes tienen que filtrar por estado. Es un `WHERE` más en cada consulta,
  y a cambio el historial es real.
- Reimportar el mismo Excel no puede duplicar: el importador empareja por código
  y consume cada registro una sola vez.
- Restaurar un respaldo es la única operación que hace desaparecer datos, y por
  eso exige escribir una palabra completa y guarda antes una copia de lo actual.
