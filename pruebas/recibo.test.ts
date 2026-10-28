/**
 * Pruebas del comprobante. Lo que importa es que las cifras salgan bien
 * y que no se pueda colar HTML por el nombre de un producto.
 */
import { describe, expect, it } from 'vitest';
import { generarRecibo } from '../src/modulos/pos/recibo';
import type { DatosNegocio, DatosRecibo } from '../src/modulos/pos/recibo';

const negocio: DatosNegocio = {
  nombre: 'Licorera Demo',
  nit: '900123456-7',
  direccion: 'Calle 10 #5-20',
  telefono: '3001234567',
};

const venta: DatosRecibo = {
  numero: 42,
  fecha: new Date('2026-08-19T21:45:00'),
  cajero: 'Camilo',
  items: [
    { producto: 'POKER', empaque: 'Six', cantidad: 1, precio_unitario: 25000, total: 25000 },
    { producto: 'POKER', empaque: 'Unidad', cantidad: 2, precio_unitario: 3900, total: 7800 },
  ],
  subtotal: 32800,
  descuento: 0,
  total: 32800,
  metodo: 'Efectivo',
  recibido: 50000,
  cambio: 17200,
};

describe('contenido del recibo', () => {
  it('lleva los datos del negocio', () => {
    const html = generarRecibo(negocio, venta);
    expect(html).toContain('Licorera Demo');
    expect(html).toContain('NIT 900123456-7');
    expect(html).toContain('Calle 10 #5-20');
  });

  it('lleva el número de recibo y quién atendió', () => {
    const html = generarRecibo(negocio, venta);
    expect(html).toContain('N° 42');
    expect(html).toContain('Camilo');
  });

  it('muestra cada renglón con su total', () => {
    const html = generarRecibo(negocio, venta);
    expect(html).toContain('POKER');
    expect(html).toContain('$25.000');
    expect(html).toContain('$7.800');
  });

  it('detalla la cantidad y el empaque cuando no es una unidad suelta', () => {
    const html = generarRecibo(negocio, venta);
    expect(html).toContain('1 six × $25.000');
    expect(html).toContain('2 unidad × $3.900');
  });

  it('muestra el total, lo recibido y el cambio', () => {
    const html = generarRecibo(negocio, venta);
    expect(html).toContain('$32.800');
    expect(html).toContain('$50.000');
    expect(html).toContain('$17.200');
  });

  it('no muestra cambio cuando se paga justo', () => {
    const html = generarRecibo(negocio, { ...venta, recibido: null, cambio: 0 });
    expect(html).not.toContain('Cambio');
  });

  it('solo muestra el descuento cuando lo hay', () => {
    expect(generarRecibo(negocio, venta)).not.toContain('Descuento');
    const conDescuento = generarRecibo(negocio, {
      ...venta, descuento: 2000, total: 30800,
    });
    expect(conDescuento).toContain('Descuento');
    expect(conDescuento).toContain('−$2.000');
  });

  it('omite los datos del negocio que estén vacíos', () => {
    const html = generarRecibo(
      { nombre: 'Licorera Demo', nit: '', direccion: '', telefono: '' },
      venta,
    );
    expect(html).not.toContain('NIT');
    expect(html).toContain('Licorera Demo');
  });
});

describe('seguridad', () => {
  it('escapa el HTML que venga en el nombre de un producto', () => {
    const html = generarRecibo(negocio, {
      ...venta,
      items: [{
        producto: '<script>alert(1)</script>',
        empaque: 'Unidad', cantidad: 1, precio_unitario: 100, total: 100,
      }],
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapa el nombre del negocio y del cajero', () => {
    const html = generarRecibo(
      { ...negocio, nombre: 'Bar & Grill "El Rincón"' },
      { ...venta, cajero: '<b>Camilo</b>' },
    );
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).not.toContain('<b>Camilo</b>');
  });
});

describe('formato para impresora térmica', () => {
  it('fija el ancho del papel', () => {
    const html = generarRecibo(negocio, venta);
    expect(html).toContain('size: 72mm auto');
    expect(html).toContain('width: 72mm');
  });

  it('no usa color ni fondos, que una térmica no imprime', () => {
    const html = generarRecibo(negocio, venta);
    const estilos = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

    // El único fondo permitido es el blanco del papel.
    const fondos = [...estilos.matchAll(/background:\s*([^;]+);/g)]
      .map((m) => m[1]?.trim());
    expect(fondos).toEqual(['#fff']);

    // Y la tinta es negra: una térmica no tiene otra.
    const colores = [...estilos.matchAll(/(?<!-)\bcolor:\s*([^;]+);/g)]
      .map((m) => m[1]?.trim());
    expect(colores).toEqual(['#000']);
  });
});
