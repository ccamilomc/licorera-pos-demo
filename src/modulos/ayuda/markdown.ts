/**
 * El manual, convertido a algo que la pantalla pueda dibujar.
 *
 * Es un conversor a la medida del manual del negocio, no un Markdown
 * completo: cubre exactamente lo que `docs/MANUAL.md` usa -- titulos,
 * parrafos, listas, tablas, citas, separadores y un bloque de codigo --
 * y nada mas. Traer una libreria de mil kilobytes para eso seria peor
 * negocio que estas cien lineas.
 *
 * La fuente sigue siendo el archivo del manual, uno solo: la pantalla lo
 * lee de ahi para que no puedan decir cosas distintas.
 */

export type Trozo =
  | { readonly tipo: 'texto'; readonly texto: string }
  | { readonly tipo: 'fuerte'; readonly texto: string }
  | { readonly tipo: 'enfasis'; readonly texto: string }
  | { readonly tipo: 'codigo'; readonly texto: string };

export type Bloque =
  | { readonly tipo: 'titulo'; readonly nivel: 1 | 2 | 3; readonly texto: string }
  | { readonly tipo: 'parrafo'; readonly trozos: readonly Trozo[] }
  | { readonly tipo: 'lista'; readonly puntos: readonly (readonly Trozo[])[] }
  | {
      readonly tipo: 'tabla';
      readonly cabecera: readonly (readonly Trozo[])[];
      readonly filas: readonly (readonly (readonly Trozo[])[])[];
    }
  | { readonly tipo: 'cita'; readonly trozos: readonly Trozo[] }
  | { readonly tipo: 'codigo'; readonly texto: string }
  | { readonly tipo: 'separador' };

/** Una seccion del manual: un titulo de segundo nivel y lo que lo sigue. */
export interface Seccion {
  readonly id: string;
  readonly titulo: string;
  readonly bloques: readonly Bloque[];
  /** Todo el texto plano, para poder buscar dentro. */
  readonly texto: string;
}

/** Negritas, cursivas y codigo dentro de una linea. */
export function trozosDe(linea: string): readonly Trozo[] {
  const trozos: Trozo[] = [];
  // Un solo recorrido: el orden importa, `**a**` no debe leerse como dos
  // cursivas pegadas.
  const patron = /\*\*([^*]+)\*\*|(?<![*\w])\*([^*\n]+)\*(?!\*)|`([^`\n]+)`/g;
  let ultimo = 0;

  for (const encontrado of linea.matchAll(patron)) {
    const desde = encontrado.index;
    if (desde > ultimo) {
      trozos.push({ tipo: 'texto', texto: linea.slice(ultimo, desde) });
    }
    const [, fuerte, enfasis, codigo] = encontrado;
    if (fuerte !== undefined) trozos.push({ tipo: 'fuerte', texto: fuerte });
    else if (enfasis !== undefined) trozos.push({ tipo: 'enfasis', texto: enfasis });
    else if (codigo !== undefined) trozos.push({ tipo: 'codigo', texto: codigo });
    ultimo = desde + encontrado[0].length;
  }

  if (ultimo < linea.length) {
    trozos.push({ tipo: 'texto', texto: linea.slice(ultimo) });
  }
  return trozos;
}

/** Las celdas de una fila de tabla, sin las barras de los extremos. */
function celdas(linea: string): readonly (readonly Trozo[])[] {
  return linea
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => trozosDe(c.trim()));
}

/** Solo raya y barras: la linea que separa la cabecera del cuerpo. */
function esSeparadorDeTabla(linea: string): boolean {
  return /^\|[\s:|-]+\|?$/.test(linea.trim()) && linea.includes('-');
}

export function aBloques(fuente: string): readonly Bloque[] {
  const bloques: Bloque[] = [];
  const lineas = fuente.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lineas.length) {
    const linea = lineas[i]!;
    const limpia = linea.trim();

    if (limpia === '') { i += 1; continue; }

    if (limpia === '---' || /^-{3,}$/.test(limpia)) {
      bloques.push({ tipo: 'separador' });
      i += 1;
      continue;
    }

    if (limpia.startsWith('```')) {
      const dentro: string[] = [];
      i += 1;
      while (i < lineas.length && !lineas[i]!.trim().startsWith('```')) {
        dentro.push(lineas[i]!);
        i += 1;
      }
      i += 1; // la cerca de cierre
      bloques.push({ tipo: 'codigo', texto: dentro.join('\n') });
      continue;
    }

    const titulo = /^(#{1,3})\s+(.*)$/.exec(limpia);
    if (titulo !== null) {
      bloques.push({
        tipo: 'titulo',
        nivel: titulo[1]!.length as 1 | 2 | 3,
        texto: titulo[2]!.trim(),
      });
      i += 1;
      continue;
    }

    if (limpia.startsWith('|')) {
      const cabecera = celdas(limpia);
      const filas: (readonly (readonly Trozo[])[])[] = [];
      i += 1;
      if (i < lineas.length && esSeparadorDeTabla(lineas[i]!)) i += 1;
      while (i < lineas.length && lineas[i]!.trim().startsWith('|')) {
        filas.push(celdas(lineas[i]!.trim()));
        i += 1;
      }
      bloques.push({ tipo: 'tabla', cabecera, filas });
      continue;
    }

    if (limpia.startsWith('> ')) {
      const partes: string[] = [];
      while (i < lineas.length && lineas[i]!.trim().startsWith('>')) {
        partes.push(lineas[i]!.trim().replace(/^>\s?/, ''));
        i += 1;
      }
      bloques.push({ tipo: 'cita', trozos: trozosDe(partes.join(' ')) });
      continue;
    }

    if (limpia.startsWith('- ')) {
      const puntos: (readonly Trozo[])[] = [];
      while (i < lineas.length && lineas[i]!.trim().startsWith('- ')) {
        puntos.push(trozosDe(lineas[i]!.trim().slice(2)));
        i += 1;
      }
      bloques.push({ tipo: 'lista', puntos });
      continue;
    }

    // Parrafo: hasta la proxima linea en blanco. El manual corta las
    // lineas a mano y aqui se vuelven a unir.
    const partes: string[] = [];
    while (i < lineas.length) {
      const actual = lineas[i]!;
      const corte = actual.trim();
      if (corte === '' || corte.startsWith('#') || corte.startsWith('|')
          || corte.startsWith('>') || corte.startsWith('- ')
          || corte.startsWith('```') || /^-{3,}$/.test(corte)) break;
      partes.push(corte);
      i += 1;
    }
    bloques.push({ tipo: 'parrafo', trozos: trozosDe(partes.join(' ')) });
  }

  return bloques;
}

function textoPlano(bloque: Bloque): string {
  const deTrozos = (t: readonly Trozo[]) => t.map((x) => x.texto).join('');
  switch (bloque.tipo) {
    case 'titulo': return bloque.texto;
    case 'parrafo': return deTrozos(bloque.trozos);
    case 'cita': return deTrozos(bloque.trozos);
    case 'codigo': return bloque.texto;
    case 'lista': return bloque.puntos.map(deTrozos).join(' ');
    case 'tabla':
      return [bloque.cabecera, ...bloque.filas]
        .map((fila) => fila.map(deTrozos).join(' '))
        .join(' ');
    case 'separador': return '';
  }
}

/** Un identificador estable para enlazar cada seccion desde el indice. */
export function idDe(titulo: string): string {
  return titulo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Parte el manual en secciones por sus titulos de segundo nivel, que es
 * como esta escrito: "El dia normal", "Copias de seguridad".
 */
export function aSecciones(fuente: string): readonly Seccion[] {
  const secciones: Seccion[] = [];
  let actual: { titulo: string; bloques: Bloque[] } | null = null;

  const cerrar = () => {
    if (actual === null) return;
    // Un separador al final solo pinta una raya suelta antes del titulo
    // siguiente.
    const bloques = [...actual.bloques];
    while (bloques.at(-1)?.tipo === 'separador') bloques.pop();
    secciones.push({
      id: idDe(actual.titulo),
      titulo: actual.titulo,
      bloques,
      texto: [actual.titulo, ...bloques.map(textoPlano)].join(' ').toLowerCase(),
    });
  };

  for (const bloque of aBloques(fuente)) {
    if (bloque.tipo === 'titulo' && bloque.nivel <= 2) {
      cerrar();
      actual = { titulo: bloque.texto, bloques: [] };
      continue;
    }
    if (actual === null) actual = { titulo: 'Introducción', bloques: [] };
    actual.bloques.push(bloque);
  }
  cerrar();

  return secciones.filter((s) => s.bloques.length > 0);
}
