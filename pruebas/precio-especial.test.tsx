// @vitest-environment jsdom
/**
 * El precio por unos dias.
 *
 * «Subo la Poker solo por el partido» es una promocion, no un cambio de
 * lista: al vencer tiene que volver sola al precio de siempre. Lo que se
 * protege aqui es que no se pueda guardar un periodo al reves —que
 * dejaria un precio que nunca aplica— ni un precio en cero, y que lo
 * vigente hoy se distinga de lo que ya paso o esta por venir.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PrecioEspecial } from '@/modulos/inventario/PrecioEspecial';

const pedir = vi.hoisted(() => vi.fn());
const permisos = vi.hoisted(() => ({ negados: [] as string[] }));

vi.mock('@/nucleo/puente', () => ({
  pedir,
  mensajeDeError: (causa: unknown) => String(causa),
}));

const SESION = vi.hoisted(() => ({
  usuario: { id: 7, nombre: 'Camilo', rol: 'ADMINISTRADOR' },
  puede: (p: string) => !permisos.negados.includes(p),
}));

vi.mock('@/nucleo/sesion', () => ({ useSesion: () => SESION }));

const EMPAQUES = [
  { id: null, nombre: 'Todas las formas', precio_venta: null },
  { id: 1, nombre: 'Unidad', precio_venta: 3_900 },
  { id: 2, nombre: 'Six', precio_venta: 25_000 },
];

/** Un precio que rige hoy. */
const VIGENTE = {
  id: 10, producto: 'PÓKER', empaque_id: null, empaque: null,
  precio_normal: 3_900, precio: 4_500, motivo: 'partido de la selección',
  desde: '2026-08-21', hasta: '2026-08-21', activo: true, vigente_hoy: true,
};

/** Uno que ya pasó o está por venir. */
const OTRO = {
  ...VIGENTE, id: 11, precio: 4_200, motivo: 'fin de semana',
  desde: '2026-08-28', hasta: '2026-08-30', vigente_hoy: false,
};

function nucleo(lista: readonly unknown[]) {
  return (comando: string) => {
    if (comando === 'listar_precios_especiales') return Promise.resolve(lista);
    return Promise.resolve(undefined);
  };
}

async function montar(lista: readonly unknown[] = [VIGENTE, OTRO]) {
  pedir.mockImplementation(nucleo(lista));
  render(<PrecioEspecial productoId={1} precioNormal={3_900} empaques={EMPAQUES} />);
  await screen.findByRole('button', { name: /Poner un precio por unos días/ });
  return userEvent.setup();
}

/** Abre el formulario y escribe un precio. */
async function proponer(
  usuario: ReturnType<typeof userEvent.setup>,
  cuanto: string,
) {
  await usuario.click(
    screen.getByRole('button', { name: /Poner un precio por unos días/ }),
  );
  await usuario.type(screen.getByLabelText('Precio especial'), cuanto);
}

beforeEach(() => {
  cleanup();
  permisos.negados = [];
  pedir.mockReset();
});

afterEach(cleanup);

describe('los que ya están puestos', () => {
  it('muestra el precio y por qué se puso', async () => {
    await montar();

    expect(screen.getByText('$4.500')).toBeTruthy();
    expect(screen.getByText(/partido de la selección/)).toBeTruthy();
  });

  it('separa lo que rige hoy de lo que no', async () => {
    await montar();

    // Un precio que empieza la otra semana no puede leerse como si ya
    // estuviera cobrandose.
    expect(screen.getByRole('button', { name: /Quitar el precio especial de \$4\.500/ }))
      .toBeTruthy();
    expect(screen.getByRole('button', { name: /Quitar el precio de 28\/08\/2026/ }))
      .toBeTruthy();
  });

  it('quitar manda el precio al núcleo', async () => {
    const usuario = await montar();
    await usuario.click(
      screen.getByRole('button', { name: /Quitar el precio especial de \$4\.500/ }),
    );

    expect(pedir).toHaveBeenCalledWith('quitar_precio_especial', {
      precioId: 10, usuarioId: 7, rol: 'ADMINISTRADOR',
    });
  });
});

describe('poner uno nuevo', () => {
  it('no deja guardar sin precio', async () => {
    const usuario = await montar();
    await usuario.click(
      screen.getByRole('button', { name: /Poner un precio por unos días/ }),
    );

    const guardar = screen.getByRole('button', { name: /Poner este precio|Guardando/ });
    expect(guardar.hasAttribute('disabled')).toBe(true);

    await usuario.type(screen.getByLabelText('Precio especial'), '4500');
    expect(guardar.hasAttribute('disabled')).toBe(false);
  });

  it('el campo del precio filtra lo que no es número', async () => {
    const usuario = await montar();
    await proponer(usuario, '4.500 pesos');

    // Se filtra al escribir y no al guardar: así el dueño ve enseguida
    // lo que quedó, en vez de descubrirlo cuando ya cobró distinto.
    expect((screen.getByLabelText('Precio especial') as HTMLInputElement).value)
      .toBe('4500');
  });

  it('no deja un período al revés', async () => {
    const usuario = await montar();
    await proponer(usuario, '4500');

    const desde = screen.getByLabelText('Desde') as HTMLInputElement;
    const hasta = screen.getByLabelText('Hasta') as HTMLInputElement;
    await usuario.clear(hasta);
    await usuario.type(hasta, '2020-01-01');

    // Un período al revés deja un precio que no aplica ningún día.
    expect(hasta.value < desde.value).toBe(true);
    expect(screen.getByRole('button', { name: /Poner este precio|Guardando/ }).hasAttribute('disabled'))
      .toBe(true);
  });

  it('manda el precio con su período y su motivo', async () => {
    const usuario = await montar();
    await proponer(usuario, '4500');
    await usuario.type(
      screen.getByLabelText('Motivo del precio especial'), '  partido  ',
    );
    await usuario.click(screen.getByRole('button', { name: /Poner este precio|Guardando/ }));

    const llamada = pedir.mock.calls.find(([c]) => c === 'poner_precio_especial');
    expect(llamada?.[1]).toMatchObject({
      precio: { producto_id: 1, precio: 4_500, motivo: 'partido', empaque_id: null },
      usuarioId: 7,
    });
  });

  it('sin motivo lo manda vacío, no como texto en blanco', async () => {
    const usuario = await montar();
    await proponer(usuario, '4500');
    await usuario.click(screen.getByRole('button', { name: /Poner este precio|Guardando/ }));

    const llamada = pedir.mock.calls.find(([c]) => c === 'poner_precio_especial');
    expect((llamada?.[1] as { precio: { motivo: string | null } }).precio.motivo)
      .toBeNull();
  });

  it('se puede poner a una sola forma de venta', async () => {
    const usuario = await montar();
    await proponer(usuario, '26000');
    await usuario.selectOptions(
      screen.getByLabelText('A qué forma de venta se le pone'), '2',
    );
    await usuario.click(screen.getByRole('button', { name: /Poner este precio|Guardando/ }));

    // Subir el six sin tocar la unidad suelta es lo normal.
    const llamada = pedir.mock.calls.find(([c]) => c === 'poner_precio_especial');
    expect((llamada?.[1] as { precio: { empaque_id: number } }).precio.empaque_id)
      .toBe(2);
  });

  it('los atajos evitan escribir fechas a mano', async () => {
    const usuario = await montar();
    await usuario.click(
      screen.getByRole('button', { name: /Poner un precio por unos días/ }),
    );

    for (const atajo of ['Solo hoy', 'Hoy y mañana', 'Una semana', 'Un mes']) {
      expect(screen.getByRole('button', { name: atajo })).toBeTruthy();
    }

    await usuario.click(screen.getByRole('button', { name: 'Una semana' }));
    const desde = screen.getByLabelText('Desde') as HTMLInputElement;
    const hasta = screen.getByLabelText('Hasta') as HTMLInputElement;
    const dias = (new Date(hasta.value).getTime() - new Date(desde.value).getTime())
      / 86_400_000;
    expect(Math.round(dias)).toBe(6);
  });

  it('si el núcleo lo rechaza, lo dice', async () => {
    const usuario = await montar();
    await proponer(usuario, '4500');

    pedir.mockImplementation((comando: string) => {
      if (comando === 'poner_precio_especial') {
        return Promise.reject(new Error('Ya hay un precio para esas fechas.'));
      }
      return nucleo([VIGENTE, OTRO])(comando);
    });
    await usuario.click(screen.getByRole('button', { name: /Poner este precio|Guardando/ }));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
