/**
 * Pruebas de la impresión de reportes. Lo que importa es que el reporte
 * salga completo, en hoja carta, y que nadie pueda colar HTML por el
 * nombre de un producto.
 */
import { describe, expect, it } from 'vitest';
import { generarImpresion } from '../src/modulos/reportes/imprimir';

const base = {
  negocio: 'Licorera Demo',
  reporte: 'Ventas por producto',
  desde: '2026-08-01',
  hasta: '2026-08-19',
  columnas: [
    { titulo: 'Producto' },
    { titulo: 'Unidades', esNumero: true },
    { titulo: 'Total', esDinero: true },
  ],
  filas: [
    ['POKER 330 ml', '18', '$75.000'],
    ['NECTAR AZUL 750 ml', '1', '$62.000'],
  ],
};

describe('contenido', () => {
  it('lleva el negocio, el reporte y el período', () => {
    const html = generarImpresion(base);
    expect(html).toContain('Licorera Demo');
    expect(html).toContain('Ventas por producto');
    expect(html).toContain('01/08/2026 al 19/08/2026');
  });

  it('un solo día no repite la fecha', () => {
    const html = generarImpresion({ ...base, desde: '2026-08-19', hasta: '2026-08-19' });
    expect(html).toContain('19/08/2026');
    expect(html).not.toContain('19/08/2026 al');
  });

  it('imprime todas las filas', () => {
    const html = generarImpresion(base);
    expect(html).toContain('POKER 330 ml');
    expect(html).toContain('NECTAR AZUL 750 ml');
    expect(html).toContain('2 registros');
  });

  it('concuerda el singular con una sola fila', () => {
    const html = generarImpresion({ ...base, filas: [base.filas[0]!] });
    expect(html).toContain('1 registro');
    expect(html).not.toContain('1 registros');
  });

  it('alinea a la derecha las columnas de números y dinero', () => {
    const html = generarImpresion(base);
    // Producto va a la izquierda; unidades y total, a la derecha.
    expect(html).toContain('<th>Producto</th>');
    expect(html).toContain('<th class="num">Unidades</th>');
    expect(html).toContain('<th class="num">Total</th>');
  });

  it('incluye el pie de totales cuando se le pasa', () => {
    const html = generarImpresion({ ...base, totales: ['Total', '19', '$137.000'] });
    expect(html).toContain('<tfoot>');
    expect(html).toContain('$137.000');
  });

  it('sin totales no dibuja el pie', () => {
    expect(generarImpresion(base)).not.toContain('<tfoot>');
  });
});

describe('formato de página', () => {
  it('usa hoja carta, no el ancho del recibo', () => {
    const html = generarImpresion(base);
    expect(html).toContain('size: letter');
    expect(html).not.toContain('72mm');
  });

  it('repite el encabezado si el reporte ocupa varias hojas', () => {
    const html = generarImpresion(base);
    expect(html).toContain('display: table-header-group');
  });
});

describe('seguridad', () => {
  it('escapa el HTML de las celdas', () => {
    const html = generarImpresion({
      ...base,
      filas: [['<script>alert(1)</script>', '1', '$0']],
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapa el nombre del negocio', () => {
    const html = generarImpresion({ ...base, negocio: 'Bar & Grill "El Rincón"' });
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });
});
