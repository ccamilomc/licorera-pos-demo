# Punto de Venta

Sistema de punto de venta, inventario y caja para tiendas de barrio: cobrar,
fiar, recibir mercancía, cuadrar la caja y saber cómo va el negocio.

El nombre del local es un campo de configuración, no algo horneado en el
programa: se pone al crear la cuenta y se cambia cuando haga falta.
Aplicación de escritorio para Windows, 100 % local, sin dependencia de internet.

![estado](https://img.shields.io/badge/pruebas-239%20en%20verde-1b6a4e)

## Qué hace

Vender, cobrar y dar el vuelto sin tocar el mouse · llevar el inventario con
alertas de agotado y bajo mínimo · abrir y cerrar caja con arqueo ciego · recibir
mercancía y calcular el costo y el margen · reportes exportables a Excel · copias
de seguridad verificadas · auditoría de todo lo que pasa.

## Instalar

El instalador está en `src-tauri/target/release/bundle/`:

- `Punto de Venta_x64_es-ES.msi` — el recomendado
- `Punto de Venta_x64-setup.exe` — alternativo

Doble clic y listo. La primera vez pide crear la cuenta de administrador; no hay
usuario de fábrica.

**Para usarlo**, lee [`docs/MANUAL.md`](docs/MANUAL.md): está escrito para quien
atiende el mostrador, sin jerga.

## Desarrollar

Hace falta Node.js y Rust con las herramientas de compilación de Microsoft.

```bash
npm install
```

```bash
npm run app:dev
```

```bash
npm test
```

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

```bash
npm run app:build
```

## Cómo está armado

| Carpeta | Qué hay |
|---|---|
| `src/modulos/` | Interfaz, una carpeta por módulo del negocio |
| `src/nucleo/` | Sesión, escritorio, puente con Rust |
| `src-tauri/src/` | Núcleo: transacciones, respaldos, archivos |
| `src-tauri/migraciones/` | Esquema SQLite, incrustado en el ejecutable |
| `pruebas/` | Pruebas de la interfaz |
| `docs/adr/` | Por qué se decidió cada cosa |

Las reglas del proyecto y las trampas del Excel original están en
[`CLAUDE.md`](CLAUDE.md).

## Decisiones que vale la pena conocer

1. [El envase distingue el producto; el empaque es la forma de moverlo](docs/adr/0001-envase-y-empaque.md)
2. [Las operaciones que tocan varias tablas se procesan en Rust](docs/adr/0002-transacciones-en-el-nucleo.md)
3. [SQLite como base operativa, Excel como entrada y salida](docs/adr/0003-sqlite-local.md)
4. [El cierre de caja es un arqueo ciego](docs/adr/0004-arqueo-ciego.md)
5. [Nada se borra](docs/adr/0005-nada-se-borra.md)
6. [El dinero se guarda en enteros](docs/adr/0006-el-dinero-en-enteros.md)

## Dónde viven los datos

En `%APPDATA%\PuntoDeVenta\`, fuera de la carpeta del programa. Actualizar la
aplicación reemplaza el ejecutable y no toca la base ni los respaldos.

## Cifras del proyecto

| | |
|---|---|
| Módulos | 8 |
| Tablas | 25 |
| Comandos del núcleo | 47 |
| Pruebas | 270 |
| Instalador | 3,3 MB |

Esta es una versión de demostración con datos de ejemplo (catálogo, gastos y
proveedores inventados). Hay una prueba que simula un día completo de trabajo —importar, abrir caja,
vender, anular, cerrar cuadrando— y otra que mete 2.000 ventas para comprobar que
las consultas siguen respondiendo en menos de 100 ms.
