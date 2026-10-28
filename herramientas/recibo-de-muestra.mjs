/**
 * Genera el recibo de ejemplo tal como lo imprime la aplicacion.
 *
 * Usa el modulo de verdad, compilado al vuelo con esbuild —el mismo que
 * trae Vite—, para que lo que se vea aqui sea exactamente lo que sale por
 * la impresora y no una copia parecida.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'muestras', 'recibo-de-ejemplo.html');

const modulo = await import(
  pathToFileURL(join(RAIZ, 'src', 'modulos', 'pos', 'recibo.ts')).href
);

const NEGOCIO = {
  nombre: 'Licorera Demo',
  nit: '900.123.456-7',
  direccion: 'Carrera 30 #8-15',
  telefono: '318 555 0142',
};

const VENTA = {
    numero: 128,
    fecha: new Date(),
    cajero: 'María',
    items: [
      { producto: 'PÓKER 330 ml', empaque: 'Six', cantidad: 2, unidades: 12,
        precio_unitario: 25_000, total: 50_000 },
      { producto: 'AGUARDIENTE ANTIOQUEÑO 750 ml', empaque: 'Unidad', cantidad: 1,
        unidades: 1, precio_unitario: 52_000, total: 52_000 },
      { producto: 'MARLBORO MEDIO', empaque: 'Unidad', cantidad: 3, unidades: 3,
        precio_unitario: 7_500, total: 22_500 },
      { producto: 'COCA-COLA 1.5 L', empaque: 'Unidad', cantidad: 2, unidades: 2,
        precio_unitario: 5_800, total: 11_600 },
      { producto: 'HIELO 2 kg', empaque: 'Unidad', cantidad: 1, unidades: 1,
        precio_unitario: 4_000, total: 4_000 },
    ],
    subtotal: 140_100,
    descuento: 2_100,
    recargo: 5_000,
    recargoConcepto: 'Domicilio',
    impuesto: 0,
    total: 143_000,
  metodo: 'Efectivo',
  recibido: 150_000,
  cambio: 7_000,
};

/** La misma venta, pero fiada: es el recibo que se manda por WhatsApp. */
const FIADA = {
  ...VENTA,
  numero: 129,
  metodo: 'Fiado',
  recibido: null,
  cambio: 0,
  fiadoA: 'Don Jairo',
};

mkdirSync(join(RAIZ, 'muestras'), { recursive: true });

for (const [nombre, venta] of [['recibo-de-ejemplo', VENTA], ['recibo-fiado', FIADA]]) {
  const html = modulo.generarRecibo(NEGOCIO, venta);
  const ruta = join(RAIZ, 'muestras', `${nombre}.html`);
  writeFileSync(ruta, html, 'utf8');
  console.log(`${ruta} (${html.length} caracteres)`);
}

// Y el de texto, que es el que se copia para mandar.
const texto = modulo.reciboEnTexto(NEGOCIO, FIADA);
writeFileSync(join(RAIZ, 'muestras', 'recibo-para-enviar.txt'), texto, 'utf8');
console.log(`
--- así queda el que se copia para WhatsApp ---
${texto}`);
