/**
 * Arma los productos finales a partir de las filas del Excel.
 *
 * Aqui se resuelve el hallazgo central del analisis (H3): en el Excel,
 * "CERVEZAS X UNIDAD" y "CERVEZAS X SIX" son dos secciones distintas, y
 * Poker 330 aparece en las dos con existencias separadas (8 sueltas y 5
 * six). No son dos cervezas: son la misma, contada de dos formas.
 *
 * El resultado es un solo producto con existencia en botellas
 * (8 + 5 x 6 = 38) y dos formas de venta con precio propio. El envase
 * (lata / botella) si separa productos, porque una Corona en lata de
 * 269 ml y una en botella de 330 ml son cosas distintas.
 */

import type { FilaInventario, FilaPrecio, Incidencia } from './lector-inventario';
import type {
  EmpaqueNormalizado, Envase, ProductoNormalizado, ResultadoNormalizacion,
} from './normalizador';
import {
  detectarEnvase, generarCodigo, interpretarPresentacion, limpiarNombre, mapearCategoria,
} from './normalizador';

/** Unidades que trae un six-pack. */
const FACTOR_SIX = 6;

interface Acumulado {
  categoria: string;
  nombre: string;
  presentacion: string;
  volumenMl: number | null;
  envase: Envase | null;
  envaseInferido: boolean;
  existencia: number;
  precioUnidad: number | null;
  precioSix: number | null;
  filas: number[];
  avisos: string[];
  /** Comparte nombre y presentacion con otro producto de precio distinto.
   *  La lista de precios trae un solo renglon para los dos, asi que no se
   *  puede saber a cual corresponde: se conserva el precio del inventario. */
  ambiguo: boolean;
}

function clave(nombre: string, volumenMl: number | null, envase: Envase | null): string {
  return `${nombre.toUpperCase()}|${volumenMl ?? 'S'}|${envase ?? 'S'}`;
}

export function armarProductos(
  inventario: readonly FilaInventario[],
  precios: readonly FilaPrecio[],
): ResultadoNormalizacion {
  const incidencias: Incidencia[] = [];
  const acumulados = new Map<string, Acumulado>();

  for (const fila of inventario) {
    const categoria = mapearCategoria(fila.categoria);
    if (categoria === null) {
      incidencias.push({
        severidad: 'ERROR', hoja: 'INVENTARIO', fila: fila.fila,
        mensaje: `Categoria desconocida "${fila.categoria}" en "${fila.nombre}".`,
        accion: 'No se importa hasta mapear la categoria.',
      });
      continue;
    }

    const { presentacion, volumenMl } = interpretarPresentacion(fila.presentacionCruda);
    const nombreBase = limpiarNombre(fila.nombre, categoria);
    const { envase, inferido, nombreLimpio } = detectarEnvase(nombreBase, volumenMl, categoria);
    const nombre = nombreLimpio !== '' ? nombreLimpio : nombreBase;
    const esSix = fila.categoria.toUpperCase().includes('SIX');

    if (volumenMl !== null && /^\d+$/.test(fila.presentacionCruda)
        && Number(fila.presentacionCruda) !== volumenMl) {
      incidencias.push({
        severidad: 'AVISO', hoja: 'INVENTARIO', fila: fila.fila,
        mensaje: `"${fila.nombre}" dice ${fila.presentacionCruda} ml, que no existe como envase.`,
        accion: `Se corrige a ${volumenMl} ml.`,
      });
    }

    const k = clave(nombre, volumenMl, envase);
    const previo = acumulados.get(k);

    const nuevo = (): Acumulado => ({
      categoria, nombre, presentacion, volumenMl, envase, envaseInferido: inferido,
      existencia: esSix ? fila.cantidad * FACTOR_SIX : fila.cantidad,
      precioUnidad: esSix ? null : fila.precioVenta,
      precioSix: esSix ? fila.precioVenta : null,
      filas: [fila.fila], avisos: [], ambiguo: false,
    });

    if (previo === undefined) {
      acumulados.set(k, nuevo());
      continue;
    }

    // Solo se fusiona cuando una fila es la unidad y la otra el six: son
    // la misma cerveza contada de dos formas. Dos filas del mismo tipo
    // con precios distintos NO son el mismo producto -- son tamaños
    // distintos que el Excel nunca nombro (hallazgo H7: la Margarita de
    // 3.500 y la de 10.000 comparten nombre y no hay como diferenciarlas).
    // Fusionarlas mezclaria dos productos en la caja.
    const yaTieneEsteTipo = esSix ? previo.precioSix !== null : previo.precioUnidad !== null;

    if (yaTieneEsteTipo) {
      const otroPrecio = esSix ? previo.precioSix : previo.precioUnidad;
      const nota = `Comparte nombre y presentacion con otro producto de precio distinto `
        + `(${otroPrecio} y ${fila.precioVenta}). `
        + `Falta ponerles el tamaño para distinguirlos en la caja.`;

      const aparte = nuevo();
      aparte.avisos.push(nota);
      aparte.ambiguo = true;
      // Los dos quedan marcados: el problema es del par, no de uno solo.
      previo.avisos.push(nota);
      previo.ambiguo = true;

      // Clave desambiguada por precio: mantiene separados los dos tamaños.
      acumulados.set(`${k}|${fila.precioVenta}`, aparte);
      incidencias.push({
        severidad: 'AVISO', hoja: 'INVENTARIO', fila: fila.fila,
        mensaje: `"${fila.nombre}" aparece dos veces con precios distintos `
          + `(${esSix ? previo.precioSix : previo.precioUnidad} y ${fila.precioVenta}).`,
        accion: 'Se importan como dos productos. Hay que nombrarles el tamaño.',
      });
      continue;
    }

    // Segunda aparicion del mismo producto: es la otra forma de venta.
    previo.existencia += esSix ? fila.cantidad * FACTOR_SIX : fila.cantidad;
    previo.filas.push(fila.fila);
    if (esSix) previo.precioSix = fila.precioVenta;
    else previo.precioUnidad = fila.precioVenta;

    incidencias.push({
      severidad: 'INFO', hoja: 'INVENTARIO', fila: fila.fila,
      mensaje: `"${fila.nombre}" ${presentacion} aparece en unidad y en six.`,
      accion: `Se unifica en un producto con existencia ${previo.existencia} y dos formas de venta.`,
    });
  }

  // Contrastar con la lista de precios. Cuando difieren, manda la lista de
  // precios (para eso existe) y el producto queda marcado para revisar (H6).
  const mapaPrecios = new Map<string, FilaPrecio>();
  for (const p of precios) {
    const categoria = mapearCategoria(p.categoria);
    if (categoria === null) continue;
    const { volumenMl } = interpretarPresentacion(p.presentacionCruda);
    const nombreBase = limpiarNombre(p.nombre, categoria);
    const { envase, nombreLimpio } = detectarEnvase(nombreBase, volumenMl, categoria);
    const nombre = nombreLimpio !== '' ? nombreLimpio : nombreBase;
    const esSix = p.categoria.toUpperCase().includes('SIX');
    const k = `${clave(nombre, volumenMl, envase)}|${esSix ? 'SIX' : 'UNI'}`;
    if (!mapaPrecios.has(k)) mapaPrecios.set(k, p);
  }

  const productos: ProductoNormalizado[] = [];
  const codigosUsados = new Set<string>();

  for (const a of acumulados.values()) {
    const kBase = clave(a.nombre, a.volumenMl, a.envase);
    const conflictos: string[] = [...a.avisos];

    // Un producto ambiguo comparte nombre con otro y la lista de precios
    // trae un solo renglon para ambos. Aplicarlo seria adivinar a cual de
    // los dos se referia, y dejaria los dos con el mismo precio -- que es
    // justo lo que no son. Se conserva el precio del inventario.
    const precioListaUnidad = a.ambiguo ? undefined : mapaPrecios.get(`${kBase}|UNI`);
    if (precioListaUnidad !== undefined && a.precioUnidad !== null
        && precioListaUnidad.precioVenta !== a.precioUnidad) {
      conflictos.push(
        `Inventario dice ${a.precioUnidad} y la lista de precios ${precioListaUnidad.precioVenta}.`,
      );
      incidencias.push({
        severidad: 'AVISO', hoja: 'PRECIOS VENTA', fila: precioListaUnidad.fila,
        mensaje: `"${a.nombre}" tiene dos precios: ${a.precioUnidad} y ${precioListaUnidad.precioVenta}.`,
        accion: `Se usa ${precioListaUnidad.precioVenta} y el producto queda marcado para revisar.`,
      });
      a.precioUnidad = precioListaUnidad.precioVenta;
    }

    const precioListaSix = a.ambiguo ? undefined : mapaPrecios.get(`${kBase}|SIX`);
    if (precioListaSix !== undefined && a.precioSix !== null
        && precioListaSix.precioVenta !== a.precioSix) {
      conflictos.push(
        `Six: inventario dice ${a.precioSix} y la lista ${precioListaSix.precioVenta}.`,
      );
      a.precioSix = precioListaSix.precioVenta;
    }

    const empaques: EmpaqueNormalizado[] = [];
    const soloSix = a.precioUnidad === null && a.precioSix !== null;

    if (a.precioUnidad !== null) {
      empaques.push({
        nombre: 'Unidad', factor: 1, precioVenta: a.precioUnidad,
        predeterminado: true, orden: 1,
      });
    }
    if (a.precioSix !== null) {
      empaques.push({
        nombre: 'Six', factor: FACTOR_SIX, precioVenta: a.precioSix,
        predeterminado: soloSix, orden: 2,
      });
    }

    if (soloSix) {
      conflictos.push('Solo se vendia por six; falta confirmar el precio de la unidad suelta.');
      incidencias.push({
        severidad: 'AVISO', hoja: 'INVENTARIO', fila: a.filas[0] ?? 0,
        mensaje: `"${a.nombre}" solo tiene precio de six.`,
        accion: 'Se importa vendible por six; la unidad suelta queda pendiente de precio.',
      });
    }

    if (a.envaseInferido && a.categoria === 'Cervezas') {
      incidencias.push({
        severidad: 'INFO', hoja: 'INVENTARIO', fila: a.filas[0] ?? 0,
        mensaje: `"${a.nombre}" no dice si es lata o botella.`,
        accion: `Se deduce ${a.envase === 'LATA' ? 'lata' : 'botella'} por los ${a.volumenMl ?? '?'} ml. Editable.`,
      });
    }

    // Precio de la unidad base. Si solo se vendia por six, se deriva y
    // queda marcado: derivar un precio no es lo mismo que saberlo.
    const precioBase = a.precioUnidad
      ?? (a.precioSix !== null ? Math.round(a.precioSix / FACTOR_SIX) : 0);

    productos.push({
      codigo: generarCodigo(a.categoria, a.nombre, a.volumenMl, a.envase, codigosUsados),
      nombre: a.nombre,
      categoria: a.categoria,
      marca: null,
      presentacion: a.presentacion,
      volumenMl: a.volumenMl,
      envase: a.envase,
      envaseInferido: a.envaseInferido,
      existencia: a.existencia,
      precioVenta: precioBase,
      empaques,
      revisar: conflictos.length > 0,
      revisarMotivo: conflictos.length > 0 ? conflictos.join(' ') : null,
      filasOrigen: a.filas,
    });
  }

  return { productos, incidencias: [...incidencias, ...detectarPosiblesDuplicados(productos)] };
}

/**
 * Busca productos que probablemente sean el mismo con dos nombres.
 *
 * El caso real del Excel: la unidad se llama 'STELLA ARTOIS LATA' y el
 * six 'STELLA LATA'. Como los nombres difieren, no se fusionaron, y la
 * cerveza queda con el stock partido en dos productos.
 *
 * Solo avisa: unir dos productos por parecido de nombre es justo el tipo
 * de decision que no se debe tomar sola.
 */
function detectarPosiblesDuplicados(
  productos: readonly ProductoNormalizado[],
): Incidencia[] {
  const avisos: Incidencia[] = [];

  for (let i = 0; i < productos.length; i += 1) {
    for (let j = i + 1; j < productos.length; j += 1) {
      const a = productos[i]!;
      const b = productos[j]!;
      if (a.categoria !== b.categoria) continue;
      if (a.volumenMl !== b.volumenMl) continue;
      if (a.envase !== b.envase) continue;

      const na = a.nombre.toUpperCase();
      const nb = b.nombre.toUpperCase();
      if (na === nb) continue;
      const unoContieneAlOtro = na.startsWith(`${nb} `) || nb.startsWith(`${na} `);
      if (!unoContieneAlOtro) continue;

      // El indicio fuerte: uno solo se vende por unidad y el otro solo por
      // six. Eso es una cerveza partida en dos por el nombre, no dos
      // sabores. Sin este filtro el aviso salta tambien en 'Nectar' vs
      // 'Nectar Azul', que si son productos distintos, y 13 avisos de los
      // que 3 son reales se ignoran todos.
      const formas = (p: ProductoNormalizado): string =>
        p.empaques.map((e) => e.nombre).sort().join('+');
      const complementarios =
        (formas(a) === 'Unidad' && formas(b) === 'Six')
        || (formas(a) === 'Six' && formas(b) === 'Unidad');
      if (!complementarios) continue;

      avisos.push({
        severidad: 'AVISO', hoja: 'INVENTARIO', fila: a.filasOrigen[0] ?? 0,
        mensaje: `"${a.nombre}" y "${b.nombre}" tienen la misma presentacion `
          + `y podrian ser el mismo producto con dos nombres.`,
        accion: 'Se importan por separado. Si son el mismo, hay que unirlos '
          + 'para que el stock no quede partido en dos.',
      });
    }
  }
  return avisos;
}
