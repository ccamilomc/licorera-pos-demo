/**
 * Lector del Excel de inventario de una tienda.
 *
 * Lee las hojas de trabajo (INVENTARIO y PRECIOS VENTA), no las hojas BD_.
 * Las BD_ parecen la version ordenada del archivo, pero descartaron toda
 * fila cuya presentacion no fuera un numero y por eso perdieron 30
 * productos: los 10 cigarrillos ('MEDIO'), los 16 de papas y dulces (sin
 * presentacion) y 4 gaseosas de litro. Importar desde ahi habria dejado
 * por fuera el mecato y los cigarrillos sin que nadie lo notara.
 *
 * Este modulo solo LEE y NORMALIZA. No escribe en la base de datos y no
 * decide nada: devuelve filas limpias y una lista de incidencias para que
 * la vista previa las muestre antes de aplicar cambios.
 */

/** Categoria tal como aparece como titulo de seccion en la hoja. */
export interface FilaInventario {
  readonly categoria: string;
  readonly nombre: string;
  /** Texto crudo de la columna ML: '750', 'MEDIO', '1.5', '1 LITRO' o vacio. */
  readonly presentacionCruda: string;
  readonly cantidad: number;
  /**
   * Columna 'VALOR' de la hoja. Pese al nombre NO es el valor del
   * inventario: es el precio de venta de una unidad. Se confirmo cruzando
   * las dos hojas: 83 productos traen el numero identico en ambas.
   */
  readonly precioVenta: number;
  readonly fila: number;
}

export interface FilaPrecio {
  readonly categoria: string;
  readonly nombre: string;
  readonly presentacionCruda: string;
  readonly precioVenta: number;
  readonly fila: number;
}

export type SeveridadIncidencia = 'ERROR' | 'AVISO' | 'INFO';

export interface Incidencia {
  readonly severidad: SeveridadIncidencia;
  readonly hoja: string;
  readonly fila: number;
  readonly mensaje: string;
  /** Que hara la importacion si el usuario acepta. */
  readonly accion: string;
}

export interface LecturaInventario {
  readonly inventario: readonly FilaInventario[];
  readonly precios: readonly FilaPrecio[];
  readonly incidencias: readonly Incidencia[];
}

/** Minimo de una hoja de calculo que este lector necesita. */
export interface HojaLegible {
  readonly nombre: string;
  /** Valor crudo de una celda (1-indexado), o null si esta vacia. */
  celda(fila: number, columna: number): string | number | null;
  readonly ultimaFila: number;
  /** Filas que son titulo de seccion, por estar combinadas horizontalmente. */
  esFilaSeccion(fila: number): boolean;
}

const ENCABEZADOS = new Set(['PRODUCTO', 'ML', 'CANTIDAD', 'VALOR']);

/** Quita espacios sobrantes y colapsa los internos. Resuelve el hallazgo H10:
 *  34 nombres del Excel traen un espacio final invisible ('POKER ', 'GRANTS ')
 *  que impide reconocer dos renglones identicos entre si. */
export function normalizarTexto(valor: string | number | null): string {
  if (valor === null) return '';
  return String(valor).trim().replace(/\s+/g, ' ');
}

function aEntero(valor: string | number | null): number | null {
  if (valor === null || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor) : null;
  const limpio = String(valor).replace(/[^\d.-]/g, '');
  if (limpio === '' || limpio === '-') return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Localiza la fila de encabezado ('PRODUCTO' en la primera columna).
 * Los datos empiezan despues. Buscarla en vez de fijar un numero evita
 * que el importador se rompa si el negocio agrega una fila arriba, y
 * ademas descarta el titulo del documento, que tambien es una fila
 * combinada pero no es una categoria.
 */
function localizarEncabezado(hoja: HojaLegible): number {
  for (let f = 1; f <= Math.min(hoja.ultimaFila, 20); f += 1) {
    if (normalizarTexto(hoja.celda(f, 1)).toUpperCase() === 'PRODUCTO') return f;
  }
  return 1;
}

/**
 * Recorre una hoja con formato humano: titulos de seccion en filas
 * combinadas que actuan como categoria de las filas siguientes.
 */
function recorrerSecciones(
  hoja: HojaLegible,
  desdeFila: number,
  visitar: (categoria: string, fila: number) => void,
): void {
  let categoria = '';
  for (let f = desdeFila; f <= hoja.ultimaFila; f += 1) {
    if (hoja.esFilaSeccion(f)) {
      const titulo = normalizarTexto(hoja.celda(f, 1));
      if (titulo !== '') categoria = titulo;
      continue;
    }
    const primera = normalizarTexto(hoja.celda(f, 1));
    if (primera === '' || ENCABEZADOS.has(primera.toUpperCase())) continue;
    visitar(categoria, f);
  }
}

export function leerHojaInventario(hoja: HojaLegible): {
  filas: FilaInventario[];
  incidencias: Incidencia[];
} {
  const filas: FilaInventario[] = [];
  const incidencias: Incidencia[] = [];

  recorrerSecciones(hoja, localizarEncabezado(hoja) + 1, (categoria, f) => {
    const nombre = normalizarTexto(hoja.celda(f, 1));
    const presentacionCruda = normalizarTexto(hoja.celda(f, 2));
    const cantidad = aEntero(hoja.celda(f, 3));
    const precioVenta = aEntero(hoja.celda(f, 4));

    if (categoria === '') {
      incidencias.push({
        severidad: 'ERROR', hoja: hoja.nombre, fila: f,
        mensaje: `"${nombre}" no esta bajo ninguna categoria.`,
        accion: 'No se importa hasta asignarle categoria.',
      });
      return;
    }
    if (precioVenta === null) {
      incidencias.push({
        severidad: 'ERROR', hoja: hoja.nombre, fila: f,
        mensaje: `"${nombre}" no tiene precio.`,
        accion: 'No se importa: un producto sin precio no se puede cobrar.',
      });
      return;
    }
    if (cantidad === null) {
      incidencias.push({
        severidad: 'AVISO', hoja: hoja.nombre, fila: f,
        mensaje: `"${nombre}" no tiene cantidad.`,
        accion: 'Se importa con existencia 0.',
      });
    }

    filas.push({
      categoria, nombre, presentacionCruda,
      cantidad: cantidad ?? 0, precioVenta, fila: f,
    });
  });

  return { filas, incidencias };
}

export function leerHojaPrecios(hoja: HojaLegible): {
  filas: FilaPrecio[];
  incidencias: Incidencia[];
} {
  const filas: FilaPrecio[] = [];
  const incidencias: Incidencia[] = [];

  recorrerSecciones(hoja, localizarEncabezado(hoja) + 1, (categoria, f) => {
    const nombre = normalizarTexto(hoja.celda(f, 1));
    const presentacionCruda = normalizarTexto(hoja.celda(f, 2));
    const precioVenta = aEntero(hoja.celda(f, 3));

    if (precioVenta === null) {
      incidencias.push({
        severidad: 'AVISO', hoja: hoja.nombre, fila: f,
        mensaje: `"${nombre}" aparece sin precio en la lista de precios.`,
        accion: 'Se ignora esta fila; se usa el precio de la hoja de inventario.',
      });
      return;
    }
    filas.push({ categoria, nombre, presentacionCruda, precioVenta, fila: f });
  });

  return { filas, incidencias };
}
