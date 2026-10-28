/**
 * El conversor del manual.
 *
 * Corre contra el manual real del negocio, no contra ejemplos: si alguien
 * escribe algo que el conversor no entiende, la pantalla de ayuda lo
 * mostraria mal y nadie se enteraria hasta que un cajero lo abriera.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { aBloques, aSecciones, idDe, trozosDe } from '@/modulos/ayuda/markdown';
import type { Bloque } from '@/modulos/ayuda/markdown';

const manual = readFileSync(join(process.cwd(), 'docs', 'MANUAL.md'), 'utf8');

describe('el texto de una linea', () => {
  it('deja el texto suelto tal cual', () => {
    expect(trozosDe('hola mundo')).toEqual([{ tipo: 'texto', texto: 'hola mundo' }]);
  });

  it('reconoce la negrita', () => {
    expect(trozosDe('esto es **importante** de verdad')).toEqual([
      { tipo: 'texto', texto: 'esto es ' },
      { tipo: 'fuerte', texto: 'importante' },
      { tipo: 'texto', texto: ' de verdad' },
    ]);
  });

  it('no lee una negrita como dos cursivas pegadas', () => {
    const trozos = trozosDe('**Cerrar caja**');
    expect(trozos).toHaveLength(1);
    expect(trozos[0]).toEqual({ tipo: 'fuerte', texto: 'Cerrar caja' });
  });

  it('reconoce la cursiva, que es como el manual nombra los botones', () => {
    expect(trozosDe('toca *Cambiar contraseña*')).toEqual([
      { tipo: 'texto', texto: 'toca ' },
      { tipo: 'enfasis', texto: 'Cambiar contraseña' },
    ]);
  });

  it('reconoce el codigo, que es donde van las rutas', () => {
    const trozos = trozosDe('en `%APPDATA%\\PuntoDeVenta` estan');
    expect(trozos[1]).toEqual({ tipo: 'codigo', texto: '%APPDATA%\\PuntoDeVenta' });
  });

  it('no se pierde con varias marcas en la misma linea', () => {
    const trozos = trozosDe('**Uno** y *dos* y `tres`');
    expect(trozos.map((t) => t.tipo)).toEqual([
      'fuerte', 'texto', 'enfasis', 'texto', 'codigo',
    ]);
  });
});

describe('los bloques', () => {
  it('reconoce los tres niveles de titulo', () => {
    const bloques = aBloques('# Uno\n\n## Dos\n\n### Tres');
    expect(bloques).toEqual([
      { tipo: 'titulo', nivel: 1, texto: 'Uno' },
      { tipo: 'titulo', nivel: 2, texto: 'Dos' },
      { tipo: 'titulo', nivel: 3, texto: 'Tres' },
    ]);
  });

  it('une las lineas de un parrafo que el manual corto a mano', () => {
    const bloques = aBloques('Una frase que sigue\nen la linea de abajo.');
    expect(bloques).toHaveLength(1);
    expect(bloques[0]).toEqual({
      tipo: 'parrafo',
      trozos: [{ tipo: 'texto', texto: 'Una frase que sigue en la linea de abajo.' }],
    });
  });

  it('separa dos parrafos en blanco', () => {
    expect(aBloques('Uno.\n\nDos.')).toHaveLength(2);
  });

  it('arma la tabla con su cabecera', () => {
    const bloques = aBloques('| Rol | Puede |\n|---|---|\n| Cajero | Vender |');
    const tabla = bloques[0]!;
    expect(tabla.tipo).toBe('tabla');
    if (tabla.tipo !== 'tabla') return;
    expect(tabla.cabecera).toHaveLength(2);
    expect(tabla.filas).toHaveLength(1);
    expect(tabla.filas[0]![0]).toEqual([{ tipo: 'texto', texto: 'Cajero' }]);
  });

  it('la raya de la tabla no se cuela como fila', () => {
    const bloques = aBloques('| A | B |\n|:--|--:|\n| 1 | 2 |');
    const tabla = bloques[0]!;
    if (tabla.tipo !== 'tabla') throw new Error('no es tabla');
    expect(tabla.filas).toHaveLength(1);
  });

  it('junta los puntos de una lista en un solo bloque', () => {
    const bloques = aBloques('- uno\n- dos\n- tres');
    expect(bloques).toHaveLength(1);
    const lista = bloques[0]!;
    if (lista.tipo !== 'lista') throw new Error('no es lista');
    expect(lista.puntos).toHaveLength(3);
  });

  it('reconoce la cita', () => {
    const bloques = aBloques('> La contraseña se guarda cifrada.');
    expect(bloques[0]?.tipo).toBe('cita');
  });

  it('reconoce el bloque de codigo y no lo interpreta', () => {
    const bloques = aBloques('```bash\nnpm test\n# esto no es un titulo\n```');
    expect(bloques).toHaveLength(1);
    const codigo = bloques[0]!;
    if (codigo.tipo !== 'codigo') throw new Error('no es codigo');
    expect(codigo.texto).toBe('npm test\n# esto no es un titulo');
  });

  it('reconoce el separador', () => {
    expect(aBloques('---')[0]).toEqual({ tipo: 'separador' });
  });
});

describe('el identificador de cada seccion', () => {
  it('quita tildes, mayusculas y signos', () => {
    expect(idDe('¿Cuánto estoy ganando?')).toBe('cuanto-estoy-ganando');
  });

  it('no deja guiones sueltos en los extremos', () => {
    expect(idDe('— Copias de seguridad —')).toBe('copias-de-seguridad');
  });

  it('dos titulos distintos no dan el mismo identificador', () => {
    expect(idDe('El día normal')).not.toBe(idDe('Los tres roles'));
  });
});

describe('contra el manual real del negocio', () => {
  const secciones = aSecciones(manual);

  it('lo parte en secciones', () => {
    expect(secciones.length).toBeGreaterThan(8);
  });

  it('estan las secciones que el cajero necesita en la caja', () => {
    const titulos = secciones.map((s) => s.titulo);
    expect(titulos).toContain('El día normal');
    expect(titulos).toContain('Copias de seguridad');
    expect(titulos).toContain('Si algo sale mal');
  });

  it('ninguna seccion queda vacia', () => {
    for (const s of secciones) {
      expect(s.bloques.length, `la sección «${s.titulo}» quedó sin contenido`)
        .toBeGreaterThan(0);
    }
  });

  it('cada seccion tiene identificador propio', () => {
    const ids = secciones.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no se pierde nada por el camino', () => {
    // Todo parrafo del manual tiene que haber quedado en alguna seccion.
    const todo = secciones.map((s) => s.texto).join(' ');
    expect(todo).toContain('cuentas el dinero');
    expect(todo).toContain('cada botella');
    expect(todo).toContain('memoria usb');
  });

  it('no aparecen marcas de markdown sin convertir en el texto', () => {
    const todo = secciones.map((s) => s.texto).join(' ');
    expect(todo).not.toContain('**');
    expect(todo).not.toMatch(/^#/m);
    expect(todo).not.toContain('|---');
  });

  it('las tablas del manual quedaron como tablas', () => {
    const tablas = secciones
      .flatMap((s) => s.bloques)
      .filter((b: Bloque) => b.tipo === 'tabla');
    // Los atajos de teclado y los tres roles, al menos.
    expect(tablas.length).toBeGreaterThanOrEqual(2);
  });
});
