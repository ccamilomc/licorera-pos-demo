# Punto de Venta

Sistema de punto de venta, inventario y caja para tiendas de barrio.
Se probo contra los datos reales de **Licorera Demo**, pero el nombre
del local es un campo de configuracion, no algo horneado en el programa.
Aplicación de escritorio para Windows, 100 % local, sin dependencia de internet.

## Cómo está armado

```
src/            interfaz — React 19 + TypeScript, organizada por módulo del negocio
src-tauri/      núcleo — Rust: transacciones, respaldos, archivos
pruebas/        pruebas de la interfaz (Vitest)
docs/           decisiones de arquitectura
```

La regla es que una capa solo habla con la de abajo:

| Capa | Hace | Tiene prohibido |
|---|---|---|
| Interfaz (`src/modulos`) | Mostrar y recibir | Calcular totales, tocar la base |
| Lógica pura (`carrito.ts`, `normalizador.ts`) | Reglas del negocio | Conocer React o SQL |
| Comandos (`src-tauri/src/comandos`) | Validar permisos, traducir errores | Lógica de negocio |
| Núcleo (`src-tauri/src/{ventas,caja,...}`) | Transacciones contra SQLite | Conocer la pantalla |

## Reglas que no se negocian

**El dinero se guarda en enteros.** Pesos colombianos sin centavos. Nunca `REAL`
ni `f64`: los decimales binarios acumulan error y descuadran el cierre de caja.

**Nada se borra.** Ventas, productos y usuarios se anulan o desactivan. Una venta
anulada conserva su registro, gana un motivo y genera los movimientos que
devuelven la mercancía.

**Las operaciones son atómicas.** Una venta toca cinco tablas en una sola
transacción. Si falla algo a la mitad, no queda nada escrito. Si vas a tocar
`ventas::registrar` o `importacion::aplicar`, mantén esa propiedad.

**Los permisos se comprueban en el núcleo.** Esconder un botón no es seguridad:
el comando sigue existiendo. Usa `permisos::exigir` antes de cualquier operación
que importe.

**Envase ≠ empaque.** Es la decisión central del modelo:

- El **envase** (lata, botella) distingue al *producto*. Corona lata de 269 ml y
  Corona botella de 330 ml son dos productos con existencia propia.
- El **empaque** (unidad, six, media canasta, canasta, cartón) es la *forma de
  moverlo*, con su factor y su **precio propio, nunca calculado**. Seis Póker
  sueltas valen $23.400 y el six vale $25.000.

La existencia se lleva siempre en la unidad física. Vender un six descuenta 6;
recibir una canasta suma 30. Aplica igual a compras y a ventas.

**La existencia se lee dentro de la transacción**, justo antes de cada
movimiento. Una venta puede traer el mismo producto en dos renglones (dos
botellas y un six) y si cada uno partiera del valor leído al empezar, el segundo
pisaría al primero.

## Importacion desde Excel

Trampas conocidas del Excel de un negocio real, cubiertas por pruebas del importador:

- Las hojas `BD_` pueden perder productos al exigir presentacion numerica
  (cigarrillos, mecato sin ml, gaseosas de litro). Se importa desde las hojas
  de inventario y precios de venta.
- `ValorInventario` no es el valor del inventario: es el precio de venta unitario.
- Productos con el mismo nombre y precio distinto son tamaños que el Excel nunca
  nombro. No se fusionan: se importan separados y marcados con `revisar = 1`.

## Comandos

```bash
npm test
```

```bash
npm run app:dev
```

```bash
npm run app:build
```

Las pruebas de Rust van aparte:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Al tocar el importador

Las pruebas corren contra el archivo **real** del negocio, no contra datos de
ejemplo. Si cambias algo ahí, `npm test` te dirá si volviste a perder los
cigarrillos. Si cambias el plan que consume Rust, regenera el JSON:

```bash
npx vitest run pruebas/generar-plan.test.ts
```

## Dónde viven los datos

En `%APPDATA%\PuntoDeVenta\`, no en la carpeta del programa. Actualizar la
aplicación reemplaza el ejecutable y no toca la base. Los respaldos van a
`%APPDATA%\PuntoDeVenta
espaldos\`. Quien venia de la version que se
llamaba «Tribuna POS» encuentra su carpeta ya renombrada: se mueve sola al
arrancar.

## Migraciones

Se incrustan en el ejecutable con `include_str!`, así que la aplicación instalada
no depende de archivos sueltos. Para agregar una: crea
`src-tauri/migraciones/00N_nombre.sql` y súmala al arreglo `MIGRACIONES`. Cada una
corre una sola vez, en orden y dentro de su propia transacción.

## Estilo

- Español en nombres, comentarios y mensajes. El usuario es colombiano.
- TypeScript estricto con `exactOptionalPropertyTypes` y `noUncheckedIndexedAccess`.
- Ningún componente escribe un color directo: todo sale de los tokens de
  `src/estilos/global.css`.
- Los comentarios explican **por qué**, no qué. El qué ya lo dice el código.
