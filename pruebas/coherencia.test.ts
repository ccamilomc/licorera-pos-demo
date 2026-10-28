/**
 * Que el manual y el codigo digan lo mismo.
 *
 * Dos veces paso que el manual prometiera cosas que no existian: primero
 * funciones enteras -- el boton de movimientos de caja, restablecer la
 * contrasena -- y despues nombres de botones que en la pantalla se
 * llamaban de otra forma. El usuario que lee el manual y no encuentra el
 * boton no piensa "el manual esta viejo", piensa que no sabe usar el
 * programa.
 *
 * Estas dos pruebas cierran las dos direcciones: que lo que el manual
 * nombra exista, y que lo que el nucleo ofrece tenga donde tocarse.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = process.cwd();

/** Todo el codigo de la interfaz, concatenado. */
function fuenteInterfaz(): string {
  const partes: string[] = [];
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (/\.tsx?$/.test(entrada.name)) partes.push(readFileSync(ruta, 'utf8'));
    }
  };
  recorrer(join(RAIZ, 'src'));
  return partes.join('\n');
}

const manual = readFileSync(join(RAIZ, 'docs', 'MANUAL.md'), 'utf8');
const interfaz = fuenteInterfaz();

describe('el manual nombra botones que existen', () => {
  /** No son botones de la aplicacion sino de Windows. */
  const AJENOS = new Set(['Microsoft Print to PDF']);

  const nombres = [...manual.matchAll(/(?<![*\w])\*([A-ZÁÉÍÓÚÑ][^*\n]{2,40}?)\*(?!\*)/g)]
    .map((m) => m[1]!)
    .filter((n) => !AJENOS.has(n));

  it('encuentra nombres de botones en el manual', () => {
    expect(nombres.length).toBeGreaterThan(5);
  });

  it.each(nombres)('«%s» existe en la interfaz', (nombre) => {
    expect(
      interfaz.includes(nombre),
      `El manual manda tocar «${nombre}» y en la interfaz no aparece con ese nombre. ` +
        `O se renombro el boton y falta actualizar el manual, o el manual promete ` +
        `algo que no se construyo.`,
    ).toBe(true);
  });
});

describe('todo comando del nucleo tiene donde tocarse', () => {
  const lib = readFileSync(join(RAIZ, 'src-tauri', 'src', 'lib.rs'), 'utf8');

  // Los comandos van listados en el invoke_handler como rutas de modulo.
  const registrados = [...lib.matchAll(/comandos::\w+::(\w+)/g)].map((m) => m[1]!);
  const unicos = [...new Set(registrados)];

  it('encuentra los comandos registrados', () => {
    expect(unicos.length).toBeGreaterThan(40);
  });

  it.each(unicos)('«%s» se llama desde alguna pantalla', (comando) => {
    expect(
      interfaz.includes(`'${comando}'`) || interfaz.includes(`"${comando}"`),
      `El comando «${comando}» esta registrado en el nucleo y ninguna pantalla lo ` +
        `llama. Un comando sin pantalla es trabajo hecho que el usuario no puede ` +
        `usar -- y sigue siendo alcanzable para quien sepa invocarlo.`,
    ).toBe(true);
  });
});

describe('ninguna pantalla escribe una fecha como la manda el núcleo', () => {
  /**
   * El nucleo manda `2026-08-21` o `2026-08-21 18:37`, que es como los
   * guarda SQLite. Al usuario hay que mostrarle `21/08/2026`: es
   * colombiano y ademas asi lo pidio. Ya paso cuatro veces que una
   * pantalla nueva pintara `{algo.fecha}` tal cual.
   */
  const archivos = (() => {
    const encontrados: { ruta: string; texto: string }[] = [];
    const recorrer = (dir: string) => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, entrada.name);
        if (entrada.isDirectory()) recorrer(ruta);
        else if (entrada.name.endsWith('.tsx')) {
          encontrados.push({ ruta, texto: readFileSync(ruta, 'utf8') });
        }
      }
    };
    recorrer(join(RAIZ, 'src', 'modulos'));
    return encontrados;
  })();

  it('encuentra las pantallas', () => {
    expect(archivos.length).toBeGreaterThan(10);
  });

  it.each(archivos.map((a) => a.ruta))('%s', (ruta) => {
    const texto = archivos.find((a) => a.ruta === ruta)!.texto;

    // `{v.fecha}` o `{fila.fecha_pago}` puestos crudos dentro del JSX.
    // No cuentan los que van en un atributo: `key={d.fecha}` no se ve, y
    // `value={b.fecha}` de un <input type="date"> tiene que ir en ISO,
    // que es justo lo que el navegador espera.
    const crudas = [...texto.matchAll(/(?<![a-zA-Z]=)\{\s*\w+\.fecha\w*\s*\}/g)]
      .map((m) => m[0]);

    expect(
      crudas,
      `${ruta} pinta ${crudas.join(', ')} tal como llega del nucleo. ` +
        `Envuelvelo en fechaCorta o fechaHoraCorta: al usuario le tiene que ` +
        `salir 21/08/2026, no 2026-08-21.`,
    ).toEqual([]);
  });
});
