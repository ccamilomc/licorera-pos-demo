/**
 * Exportación de reportes a Excel.
 *
 * ExcelJS se carga bajo demanda: pesa casi un megabyte y solo hace falta
 * al exportar, que es una acción puntual.
 */

export interface ColumnaExportable {
  readonly clave: string;
  readonly titulo: string;
  /** Alinea a la derecha y aplica formato de pesos. */
  readonly esDinero?: boolean;
  readonly esNumero?: boolean;
}

/** Formato de pesos colombianos para Excel: sin decimales, punto de miles. */
const FORMATO_PESOS = '"$"#,##0';

export async function generarExcel(
  hoja: string,
  columnas: readonly ColumnaExportable[],
  filas: readonly Record<string, unknown>[],
): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Punto de Venta';
  libro.created = new Date();

  // Excel no admite ciertos caracteres en el nombre de la hoja.
  const nombreHoja = hoja.replace(/[*?:/\\[\]]/g, '').slice(0, 31) || 'Reporte';
  const pagina = libro.addWorksheet(nombreHoja);

  pagina.columns = columnas.map((c) => ({
    header: c.titulo,
    key: c.clave,
    width: Math.max(12, Math.min(38, c.titulo.length + 6)),
  }));

  const encabezado = pagina.getRow(1);
  encabezado.font = { bold: true };
  encabezado.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EDEB' },
  };

  for (const fila of filas) pagina.addRow(fila);

  for (const [indice, columna] of columnas.entries()) {
    if (columna.esDinero === true) {
      const c = pagina.getColumn(indice + 1);
      c.numFmt = FORMATO_PESOS;
      c.alignment = { horizontal: 'right' };
    } else if (columna.esNumero === true) {
      pagina.getColumn(indice + 1).alignment = { horizontal: 'right' };
    }
  }

  // Fija el encabezado al desplazarse, que es lo que uno espera de una
  // tabla larga en Excel.
  pagina.views = [{ state: 'frozen', ySplit: 1 }];

  const datos = await libro.xlsx.writeBuffer();
  return new Uint8Array(datos);
}

/** Nombre con fecha, para que dos exportaciones no se pisen. */
export function nombreArchivo(reporte: string, desde: string, hasta: string): string {
  const limpio = reporte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return desde === hasta
    ? `${limpio}_${desde}.xlsx`
    : `${limpio}_${desde}_a_${hasta}.xlsx`;
}
