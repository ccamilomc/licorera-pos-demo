/**
 * Contraste del tema.
 *
 * Estas cifras no se pueden verificar mirando la pantalla, y ya han
 * fallado dos veces por confiar en el ojo: un ámbar que «se veía bien»
 * daba 4,19 sobre su propio fondo, y el texto blanco sobre los botones de
 * color daba 2,3 —la mitad de lo que exige la norma— sin que se notara
 * hasta medirlo. La prueba fija los mínimos para que un retoque de color
 * no los rompa sin que nadie se entere.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Luminancia relativa según WCAG 2.1. */
function luminancia(hexadecimal: string): number {
  const limpio = hexadecimal.replace('#', '');
  const canales = [0, 2, 4].map((i) => parseInt(limpio.slice(i, i + 2), 16) / 255);
  const ajustados = canales.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * ajustados[0]! + 0.7152 * ajustados[1]! + 0.0722 * ajustados[2]!;
}

function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro! + 0.05) / (oscuro! + 0.05);
}

const css = readFileSync('src/estilos/global.css', 'utf8');

const paleta: Record<string, string> = {};
for (const m of css.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
  paleta[m[1]!] = m[2]!;
}

/** Texto sobre fondo, con el mínimo que exige WCAG AA para cada caso. */
const PARES: readonly [string, string, string, number][] = [
  ['tinta', 'fondo', 'texto principal', 4.5],
  ['tinta', 'panel', 'texto en tarjetas', 4.5],
  ['tinta-2', 'panel', 'texto secundario', 4.5],
  ['tinta-2', 'panel-2', 'texto secundario en panel hondo', 4.5],
  ['tinta-2', 'panel-3', 'texto secundario en el panel más alto', 4.5],
  // Cada tinta contra cada superficie: el fallo que se colo estaba justo
  // aqui, en las cabeceras de tabla, que viven sobre `panel-2`.
  ['tinta-3', 'fondo', 'texto de apoyo sobre el fondo', 4.5],
  ['tinta-3', 'panel', 'texto de apoyo', 4.5],
  ['tinta-3', 'panel-2', 'cabeceras de tabla', 4.5],
  ['tinta-3', 'panel-3', 'texto de apoyo en el panel más alto', 4.5],
  ['acento', 'panel', 'acento sobre panel', 4.5],
  ['acento', 'fondo', 'acento sobre el fondo', 4.5],
  ['acento', 'acento-suave', 'acento sobre su fondo', 4.5],
  ['grave', 'grave-suave', 'errores', 4.5],
  ['grave', 'panel', 'errores sobre panel', 4.5],
  ['bien', 'bien-suave', 'confirmaciones', 4.5],
  ['alerta', 'alerta-suave', 'avisos', 4.5],
  ['dato', 'dato-suave', 'información', 4.5],

  // Lo que va ENCIMA de un color sólido. Aquí es donde el blanco fallaba:
  // los tres colores son claros para verse sobre el carbón, y el blanco
  // encima daba entre 2,3 y 2,6.
  ['sobre-acento', 'acento', 'texto en botón principal', 4.5],
  ['sobre-acento', 'acento-fuerte', 'texto en botón al pasar el mouse', 4.5],
  ['sobre-bien', 'bien', 'texto en marca de confirmación', 4.5],
  ['sobre-grave', 'grave', 'texto en botón destructivo', 4.5],
];

describe('la paleta está completa', () => {
  it('define todos los tokens que la interfaz usa', () => {
    const necesarios = [
      'fondo', 'panel', 'panel-2', 'panel-3',
      'tinta', 'tinta-2', 'tinta-3', 'linea', 'linea-2',
      'acento', 'acento-fuerte', 'acento-suave',
      'sobre-acento', 'sobre-bien', 'sobre-grave',
      'bien', 'bien-suave', 'alerta', 'alerta-suave',
      'grave', 'grave-suave', 'dato', 'dato-suave',
    ];
    for (const clave of necesarios) {
      expect(paleta[clave], `falta --color-${clave}`).toBeDefined();
    }
  });

  it('es un solo tema: no quedan restos del claro y el oscuro', () => {
    expect(css, 'quedó la clase .oscuro').not.toContain('.oscuro');
    expect(css, 'quedó la consulta de tema del sistema')
      .not.toContain('prefers-color-scheme');
  });
});

describe('el tema es penumbra, ni blanco ni negro', () => {
  it('el fondo es oscuro, para no deslumbrar en un local a media luz', () => {
    expect(luminancia(paleta['fondo']!)).toBeLessThan(0.05);
  });

  it('pero no es negro puro, que hace vibrar las cifras', () => {
    expect(luminancia(paleta['fondo']!)).toBeGreaterThan(0.004);
  });

  it('el texto no es blanco puro, por lo mismo', () => {
    expect(paleta['tinta']).not.toBe('#ffffff');
    expect(luminancia(paleta['tinta']!)).toBeLessThan(0.95);
  });

  it('los grises son cálidos, para no pelearse con el ámbar', () => {
    // Más rojo que azul en cada superficie.
    for (const clave of ['fondo', 'panel', 'panel-2', 'panel-3']) {
      const hex = paleta[clave]!.replace('#', '');
      const rojo = parseInt(hex.slice(0, 2), 16);
      const azul = parseInt(hex.slice(4, 6), 16);
      expect(rojo, `--color-${clave} no es cálido`).toBeGreaterThan(azul);
    }
  });

  it('los paneles suben de tono con la jerarquía', () => {
    const l = (c: string) => luminancia(paleta[c]!);
    expect(l('fondo')).toBeLessThan(l('panel'));
    expect(l('panel')).toBeLessThan(l('panel-2'));
    expect(l('panel-2')).toBeLessThan(l('panel-3'));
  });
});

describe('contraste', () => {
  it.each(PARES)('%s sobre %s (%s) llega al mínimo', (texto, fondo, _uso, minimo) => {
    const medido = contraste(paleta[texto]!, paleta[fondo]!);
    expect(medido, `${texto} sobre ${fondo} da ${medido.toFixed(2)}`)
      .toBeGreaterThanOrEqual(minimo);
  });
});

describe('el acento no se confunde con los estados', () => {
  it('el error y el acento son colores distintos', () => {
    expect(paleta['acento']).not.toBe(paleta['grave']);
  });

  it('la confirmación y el acento son colores distintos', () => {
    expect(paleta['acento']).not.toBe(paleta['bien']);
  });
});
