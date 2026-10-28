/**
 * Orquesta la importacion completa: leer el Excel, normalizarlo, armar el
 * plan y aplicarlo.
 *
 * El archivo original nunca se toca. ExcelJS lo lee en memoria y todo el
 * trabajo ocurre sobre esa copia.
 */

import type ExcelJS from 'exceljs';

import { adaptarHoja } from './adaptador-exceljs';
import { armarProductos } from './armador-productos';
import { leerHojaInventario, leerHojaPrecios } from './lector-inventario';
import type { Incidencia } from './lector-inventario';
import type { ProductoNormalizado } from './normalizador';
import { planificarImportacion } from './planificador';
import type { PlanImportacion, ProductoExistente } from './planificador';

/**
 * Nombres de hoja que se buscan. Se comparan sin distinguir mayusculas ni
 * espacios sobrantes, porque en el archivo del negocio la hoja de precios
 * se llama 'PRECIOS VENTA ' con un espacio al final.
 */
const HOJA_INVENTARIO = 'INVENTARIO';
const HOJA_PRECIOS = 'PRECIOS VENTA';

export interface ResultadoLectura {
  readonly productos: readonly ProductoNormalizado[];
  readonly incidencias: readonly Incidencia[];
  readonly filasLeidas: number;
}

export class ErrorLecturaExcel extends Error {
  constructor(
    message: string,
    readonly comoResolver: string,
  ) {
    super(message);
    this.name = 'ErrorLecturaExcel';
  }
}

function buscarHoja(libro: ExcelJS.Workbook, buscado: string): ExcelJS.Worksheet {
  const normalizar = (s: string): string => s.trim().toUpperCase();
  const hoja = libro.worksheets.find((w) => normalizar(w.name) === normalizar(buscado));
  if (hoja === undefined) {
    const disponibles = libro.worksheets.map((w) => w.name.trim()).join(', ');
    throw new ErrorLecturaExcel(
      `El archivo no tiene una hoja llamada "${buscado}".`,
      `Las hojas que trae son: ${disponibles}. Revisa que sea el archivo de inventario correcto.`,
    );
  }
  return hoja;
}

/**
 * Lee y normaliza. No escribe nada ni decide nada.
 *
 * ExcelJS se carga aqui, no al arrancar: pesa casi un megabyte y solo
 * hace falta al importar o exportar, que son acciones puntuales. Cargarlo
 * siempre retrasaria la apertura de la caja todos los dias por algo que
 * se usa de vez en cuando.
 */
export async function leerExcel(datos: ArrayBuffer): Promise<ResultadoLectura> {
  const { default: ExcelJS } = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(datos);
  } catch (causa) {
    throw new ErrorLecturaExcel(
      'No se pudo abrir el archivo.',
      'Puede estar dañado o no ser un archivo de Excel. Intenta abrirlo en Excel para comprobarlo.',
    );
  }

  const inventario = leerHojaInventario(adaptarHoja(buscarHoja(libro, HOJA_INVENTARIO)));
  const precios = leerHojaPrecios(adaptarHoja(buscarHoja(libro, HOJA_PRECIOS)));
  const armado = armarProductos(inventario.filas, precios.filas);

  return {
    productos: armado.productos,
    incidencias: [...inventario.incidencias, ...precios.incidencias, ...armado.incidencias],
    filasLeidas: inventario.filas.length,
  };
}

/**
 * Prepara la vista previa: que se crea, que se actualiza y que cambia.
 * Nada se escribe todavia.
 */
export async function prepararImportacion(
  datos: ArrayBuffer,
  existentes: readonly ProductoExistente[],
): Promise<PlanImportacion> {
  const lectura = await leerExcel(datos);
  return planificarImportacion(lectura.productos, existentes, lectura.incidencias);
}

/** Forma en que el nucleo espera el plan. */
export interface PlanParaNucleo {
  readonly crear: readonly PlanProducto[];
  readonly actualizar: readonly { id: number; producto: PlanProducto }[];
}

interface PlanProducto {
  readonly codigo: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly presentacion: string;
  readonly volumen_ml: number | null;
  readonly envase: string | null;
  readonly existencia: number;
  readonly precio_venta: number;
  readonly empaques: readonly {
    nombre: string;
    factor: number;
    precio_venta: number;
    predeterminado: boolean;
    orden: number;
  }[];
  readonly revisar: boolean;
  readonly revisar_motivo: string | null;
}

function aFormatoNucleo(p: ProductoNormalizado): PlanProducto {
  return {
    codigo: p.codigo,
    nombre: p.nombre,
    categoria: p.categoria,
    presentacion: p.presentacion,
    volumen_ml: p.volumenMl,
    envase: p.envase,
    existencia: p.existencia,
    precio_venta: p.precioVenta,
    empaques: p.empaques.map((e) => ({
      nombre: e.nombre,
      factor: e.factor,
      precio_venta: e.precioVenta,
      predeterminado: e.predeterminado,
      orden: e.orden,
    })),
    revisar: p.revisar,
    revisar_motivo: p.revisarMotivo,
  };
}

/**
 * Traduce el plan al formato del nucleo. La escritura ocurre alla, en una
 * sola transaccion: si algo falla, no queda medio inventario cargado.
 */
export function planParaNucleo(plan: PlanImportacion): PlanParaNucleo {
  return {
    crear: plan.crear.map((c) => aFormatoNucleo(c.producto)),
    actualizar: plan.actualizar.map((a) => ({
      id: a.id,
      producto: aFormatoNucleo(a.producto),
    })),
  };
}
