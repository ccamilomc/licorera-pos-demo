/**
 * Adapta un libro de ExcelJS a la interfaz que espera el lector.
 *
 * Existe para que el lector y el armador no sepan nada de ExcelJS: se
 * prueban con datos en memoria y, si algun dia se cambia de libreria,
 * solo se reescribe este archivo.
 */

import type { Worksheet } from 'exceljs';
import type { HojaLegible } from './lector-inventario';

/** Valor de celda de ExcelJS reducido a texto o numero. */
function valorPlano(valor: unknown): string | number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string' || typeof valor === 'number') return valor;
  if (typeof valor === 'object') {
    // Celda con formula: interesa el resultado, no la formula.
    if ('result' in valor) return valorPlano((valor as { result: unknown }).result);
    // Texto con formato mezclado.
    if ('richText' in valor) {
      const partes = (valor as { richText: readonly { text: string }[] }).richText;
      return partes.map((p) => p.text).join('');
    }
    if (valor instanceof Date) return valor.toISOString();
  }
  return String(valor);
}

/**
 * Una fila es titulo de seccion cuando su primera celda abre un rango
 * combinado horizontalmente. Asi estan marcadas las categorias
 * ('WHISKY', 'CERVEZAS X SIX') en las hojas del negocio.
 *
 * No sirve comprobar que las celdas siguientes esten vacias: ExcelJS
 * devuelve el valor del maestro en todas las celdas del rango, de modo
 * que la columna 2 de la fila 'WHISKY' tambien responde 'WHISKY'.
 */
function detectarSecciones(hoja: Worksheet): Set<number> {
  const secciones = new Set<number>();
  hoja.eachRow((fila, numero) => {
    const primera = fila.getCell(1);
    if (!primera.isMerged) return;
    // ExcelJS tipa `master.row` y `master.col` como string, pero devuelve
    // numeros. Se normaliza antes de comparar.
    const filaMaestra = Number(primera.master.row);
    const columnaMaestra = Number(primera.master.col);
    const abreRangoCombinado = filaMaestra === numero && columnaMaestra === 1;
    if (abreRangoCombinado && valorPlano(primera.value) !== null) {
      secciones.add(numero);
    }
  });
  return secciones;
}

export function adaptarHoja(hoja: Worksheet): HojaLegible {
  const secciones = detectarSecciones(hoja);
  return {
    nombre: hoja.name.trim(),
    ultimaFila: hoja.rowCount,
    celda: (fila, columna) => valorPlano(hoja.getRow(fila).getCell(columna).value),
    esFilaSeccion: (fila) => secciones.has(fila),
  };
}
