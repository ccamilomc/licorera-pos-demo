// @vitest-environment jsdom
/**
 * Como ha cambiado el precio de un producto.
 *
 * Responde «¿yo cuando subi la Poker?». Lo que se protege aqui es que no
 * se confunda con lo vendido: cada venta guarda el precio con el que se
 * cobro, asi que subir el precio hoy no reescribe lo de ayer. La pantalla
 * tiene que decirlo, porque es justo lo que uno teme al cambiar un
 * precio.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

import { HistorialPrecios } from '@/modulos/inventario/HistorialPrecios';

const pedir = vi.hoisted(() => vi.fn());

vi.mock('@/nucleo/puente', () => ({
  pedir,
  mensajeDeError: (causa: unknown) => String(causa),
}));

const SESION = vi.hoisted(() => ({
  usuario: { id: 7, nombre: 'Camilo', rol: 'ADMINISTRADOR' },
  puede: () => true,
}));

vi.mock('@/nucleo/sesion', () => ({ useSesion: () => SESION }));

const SUBIDA = {
  id: 2, fecha: '2026-08-01 10:00', producto: 'PÓKER', empaque: null,
  precio_anterior: 2_700, precio_nuevo: 3_000, variacion: 11,
  motivo: 'Cambio manual', usuario: 'Camilo',
};

const DEL_SIX = {
  id: 3, fecha: '2026-08-19 18:00', producto: 'PÓKER', empaque: 'Six',
  precio_anterior: 25_000, precio_nuevo: 26_000, variacion: 4,
  motivo: 'Cambio manual', usuario: 'Camilo',
};

const BAJADA = {
  ...SUBIDA, id: 1, precio_anterior: 3_000, precio_nuevo: 2_700, variacion: -10,
};

async function montar(lista: readonly unknown[] = [DEL_SIX, SUBIDA]) {
  pedir.mockImplementation(() => Promise.resolve(lista));
  render(<HistorialPrecios productoId={1} />);
  if (lista.length > 0) await screen.findByRole('table');
  else await screen.findByText(/Nunca le has cambiado el precio/);
}

/** La fila de un cambio, por el precio en que quedó. */
function filaDe(precio: string): HTMLElement {
  return screen.getByText(precio).closest('tr') as HTMLElement;
}

beforeEach(() => {
  cleanup();
  pedir.mockReset();
});

afterEach(cleanup);

describe('lo que muestra', () => {
  it('dice de cuánto a cuánto y quién lo hizo', async () => {
    await montar();

    const fila = filaDe('$3.000');
    expect(within(fila).getByText('$2.700')).toBeTruthy();
    expect(within(fila).getByText('01/08/2026 10:00 a. m.')).toBeTruthy();
    expect(within(fila).getByText('Camilo')).toBeTruthy();
  });

  it('distingue el precio del producto del de cada forma de venta', async () => {
    await montar();

    // Subir el six sin tocar la unidad suelta es lo normal.
    expect(within(filaDe('$26.000')).getByText('Six')).toBeTruthy();
    expect(within(filaDe('$3.000')).getByText('Precio del producto')).toBeTruthy();
  });

  it('marca la subida y la bajada distinto', async () => {
    // Por el porcentaje y no por el precio: 3.000 sale dos veces, como
    // el precio nuevo de una y el anterior de la otra.
    await montar([SUBIDA, BAJADA]);

    // El signo va en la flecha y el color; el número siempre en positivo.
    expect(screen.getByText('11%').className).toContain('text-bien');
    expect(screen.getByText('10%').className).toContain('text-grave');
    expect(screen.queryByText('-10%')).toBeNull();
  });

  it('sin precio anterior no inventa un porcentaje', async () => {
    await montar([{ ...SUBIDA, precio_anterior: null, variacion: null }]);

    // Un precio que antes no había no subió ni bajó: es el primero.
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('avisa que lo vendido no cambia', async () => {
    await montar();

    // Es justo lo que uno teme al cambiar un precio.
    expect(screen.getByText(/Lo que ya se vendió no cambia/)).toBeTruthy();
    expect(screen.getByText(/cada venta guarda el precio con el que se\s+cobró/))
      .toBeTruthy();
  });
});

describe('cuando no hay nada', () => {
  it('explica que se va llenando al cambiar precios', async () => {
    await montar([]);

    expect(screen.getByText(/Nunca le has cambiado el precio/)).toBeTruthy();
    expect(screen.getByText(/con el precio que tenía antes/)).toBeTruthy();
  });
});

describe('lo que le pide al núcleo', () => {
  it('pide solo los de este producto', async () => {
    await montar();

    expect(pedir).toHaveBeenCalledWith('historial_de_precios', {
      productoId: 1, limite: 50, rol: 'ADMINISTRADOR',
    });
  });

  it('si falla lo dice en vez de mostrar una tabla vacía', async () => {
    pedir.mockImplementation(() => Promise.reject(new Error('La base está ocupada.')));
    render(<HistorialPrecios productoId={1} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
