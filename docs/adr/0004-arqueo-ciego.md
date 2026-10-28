# 4. El cierre de caja es un arqueo ciego

Fecha: 2026-08-19
Estado: aceptado

## El problema

Al cerrar el turno hay que comparar el dinero que hay en el cajón con el que
debería haber. La pregunta es en qué orden.

## La decisión

El cajero cuenta el efectivo y digita lo que contó **antes** de que el sistema le
muestre lo esperado. La pantalla tiene dos pasos que no se pueden saltar.

Si viera el número primero, el conteo dejaría de ser un control y se volvería un
trámite de confirmar: se teclea la cifra que el sistema ya mostró y la caja
siempre cuadra. Un arqueo así no detecta nada.

Además, una diferencia sin explicación escrita no cierra la caja.

## Detalles que importan

- El efectivo esperado suma **solo** lo cobrado en efectivo. Una venta por
  transferencia no pone un peso en el cajón, y sumarla haría que faltara plata
  todos los días.
- Una venta anulada no cuenta, y su efectivo sale como movimiento de caja.
- Se puede contar billete por billete con las denominaciones que circulan en el
  local, o escribir el total directamente.

## Consecuencias

- Cerrar toma unos segundos más. Es el punto.
- Las diferencias quedan registradas con su explicación, y de ahí sale el reporte
  de descuadres.
