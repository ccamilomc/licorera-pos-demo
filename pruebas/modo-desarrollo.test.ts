/**
 * El modo de desarrollo no puede llegar a la aplicacion instalada.
 *
 * El simulador entra directo como administrador y responde con datos de
 * mentira. Dentro del programa que usa el negocio eso seria una puerta
 * trasera y un inventario falso, asi que aqui se comprueba lo unico que
 * de verdad importa: que el empaquetado de produccion no lo lleve.
 *
 * La prueba compila el frontend igual que `npm run build` y revisa el
 * archivo resultante. No mira el codigo fuente —eso no probaria nada—
 * sino lo que quedaria dentro del instalador.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';

const RAIZ = process.cwd();
// Carpeta propia por proceso: esta prueba compila de verdad y no puede
// pisarse con otra corrida ni con el `dist` del desarrollo.
const SALIDA = join(RAIZ, `dist-prueba-produccion-${process.pid}`);

/** Todo el JavaScript que quedaria en el instalador. */
let bundle = '';

beforeAll(() => {
  rmSync(SALIDA, { recursive: true, force: true });

  // Se llama al script de Vite con node y no por `npx`: en Windows el
  // `.cmd` revienta con EINVAL desde execFileSync.
  execFileSync(
    process.execPath,
    [
      join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--mode', 'production', '--outDir', SALIDA, '--emptyOutDir',
    ],
    {
      cwd: RAIZ,
      stdio: 'pipe',
      timeout: 300_000,
      // Vitest deja NODE_ENV en «test» y Vite lo hereda: sin esto el
      // build sale en modo desarrollo y la prueba no comprueba nada.
      env: { ...process.env, NODE_ENV: 'production' },
    },
  );

  const assets = join(SALIDA, 'assets');
  bundle = readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
    .join('\n');
}, 320_000);

afterAll(() => {
  rmSync(SALIDA, { recursive: true, force: true });
});

describe('el empaquetado de produccion', () => {
  it('se genera, y de verdad en modo produccion', () => {
    expect(existsSync(SALIDA)).toBe(true);
    expect(bundle.length).toBeGreaterThan(10_000);
    // Si sale en modo desarrollo, todo lo de abajo pasaria sin probar nada.
    expect(bundle, 'el build salió en modo desarrollo').not.toContain('jsxDEV');
  });

  it('no lleva los datos de mentira', () => {
    // Nombres que solo existen en el simulador.
    expect(bundle).not.toContain('Modo desarrollo');
    expect(bundle).not.toContain('Distribuidora Bavaria');
    expect(bundle).not.toContain('Surtimax Mayorista');
    expect(bundle).not.toContain('Depósito La 30');
  });

  it('no lleva el nucleo de mentira', () => {
    expect(bundle).not.toContain('pedirSimulado');
    expect(bundle).not.toContain('SESION_DEV');
    expect(bundle).not.toContain('[simulador]');
  });

  it('no lleva la lista de permisos regalada', () => {
    // El simulador concede todos los permisos sin comprobar nada.
    expect(bundle).not.toContain('sesionDeDesarrollo');
  });

  it('si lleva la aplicacion de verdad', () => {
    // Si estas fallan, la comprobacion de arriba no probaba nada porque
    // el bundle estaria vacio o roto.
    expect(bundle).toContain('Buscar producto');
    expect(bundle).toContain('Cerrar caja');
  });
});
