# 3. SQLite como base operativa, Excel como entrada y salida

Fecha: 2026-08-19
Estado: aceptado

## El problema

El negocio lleva su inventario en un Excel. La pregunta era si el sistema debía
seguir usándolo como almacenamiento o pasar a una base de datos.

## Por qué no Excel como motor

- Un archivo abierto se bloquea y se corrompe.
- No hay transacciones: un corte de luz parte la venta.
- No hay integridad referencial ni control de concurrencia.
- Se degrada con el volumen.

## Por qué SQLite

Es una base de datos completa en un solo archivo, sin servidor, sin instalación
y sin red. Es exactamente el caso de uso de una licorera con un computador:

- Cero dependencia de internet, por diseño. No es que tolere estar sin conexión:
  es que no la usa.
- Transacciones ACID.
- Respaldar es copiar un archivo.
- Miles de ventas al año sin despeinarse. Probado con 2.000 ventas: el resumen
  sale en menos de 100 ms.
- Formato estable y documentado por décadas.

## El papel del Excel

Sigue siendo la entrada y la salida, no el motor. Entra una vez como semilla y
después sirve para importar y exportar cuando haga falta. **El archivo original
nunca se modifica**: se trabaja siempre sobre una copia en memoria.

## Consecuencias

- La base vive en `%APPDATA%\PuntoDeVenta\`, no junto al ejecutable, para que
  actualizar el programa nunca toque los datos.
- Las migraciones se incrustan en el binario con `include_str!`: la aplicación
  instalada no depende de archivos sueltos en el disco.
- Si algún día hacen falta varias cajas conectadas, habrá que revisar esta
  decisión. Para un local con un computador, un servidor sería complejidad sin
  beneficio.
