// @vitest-environment jsdom
/**
 * A cuanto vende cada proveedor este producto.
 *
 * Responde la pregunta que uno hace antes de pedir: quien lo tiene mas
 * barato hoy. Lo que se protege aqui es que la comparacion sea **por
 * unidad y no por empaque**: una canasta siempre va a costar mas que una
 * botella suelta, y ordenar por el precio crudo diria que el que vende
 * canastas es el caro. Eso ya paso una vez.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

import { PreciosProveedor } from '@/modulos/inventario/PreciosProveedor';

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

/** El que vende canastas: caro por empaque, barato por unidad. */
const CANASTA = {
  proveedor: 'Distribuidora Bavaria', empaque: 'Canasta',
  precio: 96_000, precio_unitario: 3_200, fecha: '2026-08-18', mejor: true,
};

const SUELTA = {
  proveedor: 'Surtimax Mayorista', empaque: 'Unidad',
  precio: 3_500, precio_unitario: 3_500, fecha: '2026-08-10', mejor: false,
};

async function montar(lista: readonly unknown[] = [CANASTA, SUELTA]) {
  pedir.mockImplementation(() => Promise.resolve(lista));
  render(<PreciosProveedor productoId={1} />);
  if (lista.length > 0) await screen.findByRole('table');
  else await screen.findByText(/Todavía no hay precios de proveedor/);
}

/** La fila de un proveedor. */
function filaDe(proveedor: string): HTMLElement {
  return screen.getByText(proveedor).closest('tr') as HTMLElement;
}

beforeEach(() => {
  cleanup();
  pedir.mockReset();
});

afterEach(cleanup);

describe('la comparación', () => {
  it('muestra el precio del empaque y el de la unidad, por separado', async () => {
    await montar();

    const fila = filaDe('Distribuidora Bavaria');
    expect(within(fila).getByText('$96.000')).toBeTruthy();
    expect(within(fila).getByText('$3.200')).toBeTruthy();
  });

  it('marca al más barato por unidad, aunque su empaque sea el más caro', async () => {
    await montar();

    // La canasta cuesta 96.000 y la botella 3.500. Por el precio crudo
    // diria que Bavaria es el caro, y es al reves.
    expect(within(filaDe('Distribuidora Bavaria')).getByText('más barato')).toBeTruthy();
    expect(within(filaDe('Surtimax Mayorista')).queryByText('más barato')).toBeNull();
  });

  it('explica por qué se compara así', async () => {
    await montar();

    expect(screen.getByText(/una canasta siempre va a costar más que una botella suelta/))
      .toBeTruthy();
  });

  it('puede haber varios más baratos si empatan', async () => {
    await montar([
      CANASTA,
      { ...SUELTA, proveedor: 'La Nacional', precio: 3_200, precio_unitario: 3_200,
        mejor: true },
    ]);

    expect(screen.getAllByText('más barato')).toHaveLength(2);
  });

  it('dice de cuándo es cada precio', async () => {
    await montar();

    // Un precio de hace seis meses no sirve para decidir hoy.
    expect(within(filaDe('Distribuidora Bavaria')).getByText('18/08/2026')).toBeTruthy();
    expect(within(filaDe('Surtimax Mayorista')).getByText('10/08/2026')).toBeTruthy();
  });

  it('un empaque sin nombre se lee como unidad', async () => {
    await montar([{ ...SUELTA, empaque: null }]);

    expect(within(filaDe('Surtimax Mayorista')).getByText('Unidad')).toBeTruthy();
  });
});

describe('cuando no hay nada', () => {
  it('explica que se llenan solos al registrar compras', async () => {
    await montar([]);

    expect(screen.getByText(/Se van llenando solos cada vez que\s+registras una compra/))
      .toBeTruthy();
  });
});

describe('cuando el núcleo falla', () => {
  it('lo dice en vez de mostrar una tabla vacía', async () => {
    pedir.mockImplementation(() => Promise.reject(new Error('La base está ocupada.')));
    render(<PreciosProveedor productoId={1} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
