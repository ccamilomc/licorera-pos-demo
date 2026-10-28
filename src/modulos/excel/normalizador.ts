/**
 * Convierte las filas crudas del Excel en productos listos para la base
 * de datos, resolviendo los hallazgos del analisis.
 *
 * Funciones puras: reciben datos y devuelven datos. No tocan la base ni
 * el sistema de archivos, para poder probarlas contra el Excel real.
 */

import type { Incidencia } from './lector-inventario';
import { normalizarTexto } from './lector-inventario';

export type Envase =
  | 'BOTELLA' | 'LATA' | 'TETRAPAK' | 'CAJA' | 'BOLSA' | 'PAQUETE' | 'NINGUNO';

export interface EmpaqueNormalizado {
  readonly nombre: string;
  /** Unidades base que contiene. Vender un six descuenta 6. */
  readonly factor: number;
  /** Independiente, nunca calculado: el six de Poker cuesta 25.000 y la
   *  botella suelta 3.900, que son 23.400. No son proporcionales. */
  readonly precioVenta: number;
  readonly predeterminado: boolean;
  readonly orden: number;
}

export interface ProductoNormalizado {
  readonly codigo: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly marca: string | null;
  readonly presentacion: string;
  readonly volumenMl: number | null;
  readonly envase: Envase | null;
  /** Si el envase se dedujo del volumen en vez de leerse del nombre. */
  readonly envaseInferido: boolean;
  readonly existencia: number;
  readonly precioVenta: number;
  readonly empaques: readonly EmpaqueNormalizado[];
  readonly revisar: boolean;
  readonly revisarMotivo: string | null;
  readonly filasOrigen: readonly number[];
}

export interface ResultadoNormalizacion {
  readonly productos: readonly ProductoNormalizado[];
  readonly incidencias: readonly Incidencia[];
}

/** Categorias del Excel a las del sistema. 'CERVEZAS X UNIDAD' y
 *  'CERVEZAS X SIX' colapsan en una sola: no son dos categorias, son la
 *  misma cerveza en dos presentaciones (hallazgo H3). */
const MAPA_CATEGORIAS: Readonly<Record<string, string>> = {
  'WHISKY': 'Whisky',
  'TEQUILA': 'Tequila',
  'VODKA': 'Vodka',
  'RON': 'Ron',
  'AGUARDIENTE': 'Aguardiente',
  'BRANDY': 'Brandy',
  'GINEBRA': 'Ginebra',
  'CHAMPAGNE Y VINOS': 'Champaña y vinos',
  'CERVEZAS X UNIDAD': 'Cervezas',
  'CERVEZAS X SIX': 'Cervezas',
  'GASEOSAS Y AGUAS': 'Gaseosas y aguas',
  'CIGARRILLOS': 'Cigarrillos',
  'PAPAS Y DULCES': 'Papas y dulces',
};

/** Prefijos de categoria dentro del nombre del producto, para no repetir
 *  'AGUARDIENTE' en la categoria y en el nombre. */
const PREFIJOS_REDUNDANTES = ['AGUARDIENTE '];

const ABREVIATURAS_CATEGORIA: Readonly<Record<string, string>> = {
  'Whisky': 'WHI', 'Tequila': 'TEQ', 'Vodka': 'VOD', 'Ron': 'RON',
  'Aguardiente': 'AGU', 'Brandy': 'BRA', 'Ginebra': 'GIN',
  'Champaña y vinos': 'VIN', 'Cervezas': 'CER', 'Gaseosas y aguas': 'GAS',
  'Cigarrillos': 'CIG', 'Papas y dulces': 'DUL',
};

/** Volumenes tipicos de lata en el mercado colombiano de cerveza. */
const VOLUMENES_LATA = new Set([269, 250, 355, 473]);

export function mapearCategoria(cruda: string): string | null {
  return MAPA_CATEGORIAS[normalizarTexto(cruda).toUpperCase()] ?? null;
}

/**
 * Interpreta la columna ML, que en el Excel mezcla tres cosas distintas:
 * un numero de mililitros ('750'), un texto de tamaño ('MEDIO') y litros
 * escritos de dos formas ('1.5', '1 LITRO'). Exigir un numero fue lo que
 * hizo perder 30 productos en las hojas BD_.
 */
export function interpretarPresentacion(cruda: string): {
  presentacion: string;
  volumenMl: number | null;
} {
  const texto = normalizarTexto(cruda);
  if (texto === '') return { presentacion: 'Unidad', volumenMl: null };

  const litros = /^(\d+(?:[.,]\d+)?)\s*(?:L|LT|LTS?|LITROS?)$/i.exec(texto);
  const cantidadLitros = litros?.[1];
  if (cantidadLitros !== undefined) {
    const ml = Math.round(Number(cantidadLitros.replace(',', '.')) * 1000);
    return { presentacion: formatearVolumen(ml), volumenMl: ml };
  }

  // Un decimal suelto en la columna ML son litros: '1.5' es litro y medio,
  // no un mililitro y medio.
  const decimal = /^\d+[.,]\d+$/.exec(texto);
  if (decimal !== null) {
    const ml = Math.round(Number(texto.replace(',', '.')) * 1000);
    return { presentacion: formatearVolumen(ml), volumenMl: ml };
  }

  const entero = /^\d+$/.exec(texto);
  if (entero !== null) {
    const n = Number(texto);
    // 15000 ml no existe como botella: es 1500 con un cero de mas (H9).
    if (n > 5000) return { presentacion: formatearVolumen(n / 10), volumenMl: n / 10 };
    return { presentacion: formatearVolumen(n), volumenMl: n };
  }

  // Texto libre: 'MEDIO' de los cigarrillos y cualquier otro tamaño.
  return { presentacion: texto, volumenMl: null };
}

function formatearVolumen(ml: number): string {
  return ml >= 1000 ? `${(ml / 1000).toString().replace('.', ',')} L` : `${ml} ml`;
}

/** El envase distingue el producto, no la forma de venta: Corona lata
 *  269 ml y Corona botella 330 ml son dos productos distintos. */
export function detectarEnvase(
  nombre: string, volumenMl: number | null, categoria: string,
): { envase: Envase | null; inferido: boolean; nombreLimpio: string } {
  const may = nombre.toUpperCase();

  if (/\bLATA\b/.test(may)) {
    return { envase: 'LATA', inferido: false, nombreLimpio: quitarPalabra(nombre, 'LATA') };
  }
  if (/\bBOTELL[AI]N?\b/.test(may)) {
    return { envase: 'BOTELLA', inferido: false, nombreLimpio: quitarPalabra(nombre, 'BOTELLA') };
  }
  if (categoria === 'Cervezas' && volumenMl !== null) {
    return {
      envase: VOLUMENES_LATA.has(volumenMl) ? 'LATA' : 'BOTELLA',
      inferido: true, nombreLimpio: nombre,
    };
  }
  if (categoria === 'Cigarrillos') {
    return { envase: 'PAQUETE', inferido: true, nombreLimpio: nombre };
  }
  if (categoria === 'Papas y dulces') {
    return { envase: 'BOLSA', inferido: true, nombreLimpio: nombre };
  }
  if (volumenMl !== null) {
    return { envase: 'BOTELLA', inferido: true, nombreLimpio: nombre };
  }
  return { envase: null, inferido: false, nombreLimpio: nombre };
}

function quitarPalabra(nombre: string, palabra: string): string {
  return normalizarTexto(
    nombre.replace(new RegExp(`\\b${palabra}\\w*\\b`, 'gi'), ''),
  );
}

export function limpiarNombre(nombre: string, categoria: string): string {
  let limpio = normalizarTexto(nombre);
  const may = limpio.toUpperCase();
  for (const prefijo of PREFIJOS_REDUNDANTES) {
    if (categoria === 'Aguardiente' && may.startsWith(prefijo)) {
      limpio = normalizarTexto(limpio.slice(prefijo.length));
      break;
    }
  }
  return limpio;
}

export function generarCodigo(
  categoria: string, nombre: string, volumenMl: number | null,
  envase: Envase | null, usados: Set<string>,
): string {
  const cat = ABREVIATURAS_CATEGORIA[categoria] ?? 'GEN';
  const base = nombre.toUpperCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10) || 'PROD';
  const vol = volumenMl !== null ? String(volumenMl) : 'X';
  const env = envase === 'LATA' ? 'L' : envase === 'BOTELLA' ? 'B' : 'U';

  const candidato = `${cat}-${base}-${vol}${env}`;
  if (!usados.has(candidato)) { usados.add(candidato); return candidato; }
  for (let i = 2; ; i += 1) {
    const alterno = `${candidato}-${i}`;
    if (!usados.has(alterno)) { usados.add(alterno); return alterno; }
  }
}
