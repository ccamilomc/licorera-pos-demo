/**
 * Pruebas de la exportacion a Excel. Se genera el archivo de verdad y se
 * vuelve a leer, para comprobar que Excel lo va a poder abrir.
 */
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { generarExcel, nombreArchivo } from '../src/modulos/reportes/exportar';

const columnas = [
  { clave: 'producto', titulo: 'Producto' },
  { clave: 'unidades', titulo: 'Unidades', esNumero: true },
  { clave: 'total', titulo: 'Total', esDinero: true },
];

const filas = [
  { producto: 'POKER 330 ml', unidades: 18, total: 75_000 },
  { producto: 'NECTAR AZUL 750 ml', unidades: 1, total: 62_000 },
];

async function leer(datos: Uint8Array) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(datos.buffer.slice(
    datos.byteOffset, datos.byteOffset + datos.byteLength,
  ) as ArrayBuffer);
  return libro;
}

describe('generar el archivo', () => {
  it('produce un Excel que se puede volver a abrir', async () => {
    const libro = await leer(await generarExcel('Ventas por producto', columnas, filas));
    expect(libro.worksheets).toHaveLength(1);
    expect(libro.getWorksheet('Ventas por producto')).toBeDefined();
  });

  it('escribe el encabezado y todas las filas', async () => {
    const libro = await leer(await generarExcel('Ventas', columnas, filas));
    const hoja = libro.worksheets[0]!;

    expect(hoja.getRow(1).getCell(1).value).toBe('Producto');
    expect(hoja.getRow(2).getCell(1).value).toBe('POKER 330 ml');
    expect(hoja.getRow(3).getCell(3).value).toBe(62_000);
    expect(hoja.rowCount).toBe(3);
  });

  it('el dinero va como numero, no como texto, para poder sumarlo en Excel', async () => {
    const libro = await leer(await generarExcel('Ventas', columnas, filas));
    const celda = libro.worksheets[0]!.getRow(2).getCell(3);

    expect(typeof celda.value).toBe('number');
    expect(celda.numFmt).toContain('$');
  });

  it('limpia los caracteres que Excel no admite en el nombre de la hoja', async () => {
    const libro = await leer(await generarExcel('Ventas/Compras: 2026', columnas, filas));
    expect(libro.worksheets[0]!.name).toBe('VentasCompras 2026');
  });

  it('no falla con un reporte vacio', async () => {
    const libro = await leer(await generarExcel('Vacio', columnas, []));
    expect(libro.worksheets[0]!.rowCount).toBe(1);
  });
});

describe('nombre del archivo', () => {
  it('incluye el periodo', () => {
    expect(nombreArchivo('Ventas por día', '2026-08-01', '2026-08-19'))
      .toBe('ventas-por-dia_2026-08-01_a_2026-08-19.xlsx');
  });

  it('un solo dia no repite la fecha', () => {
    expect(nombreArchivo('Cierres de caja', '2026-08-19', '2026-08-19'))
      .toBe('cierres-de-caja_2026-08-19.xlsx');
  });

  it('quita tildes y caracteres raros', () => {
    expect(nombreArchivo('Ventas por categoría', '2026-08-01', '2026-08-01'))
      .toBe('ventas-por-categoria_2026-08-01.xlsx');
  });
});
