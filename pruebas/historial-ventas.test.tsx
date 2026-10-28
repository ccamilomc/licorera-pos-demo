// @vitest-environment jsdom
/**
 * El historial de ventas.
 *
 * Es donde se anula una venta, que es de las pocas cosas que mueven plata
 * hacia atras: la mercancia vuelve al inventario y el efectivo sale del
 * cajon. Lo que se protege aqui es que anular exija un motivo escrito,
 * que una venta ya anulada no se pueda anular otra vez, y que el total de
 * abajo no cuente las anuladas.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HistorialVentas } from '@/modulos/reportes/HistorialVentas';

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

const COMPLETADA = {
  id: 1,
  numero: 128,
  fecha: '2026-08-20 18:40',
  usuario: 'Camilo',
  subtotal: 50_000,
  descuento: 2_200,
  total: 47_800,
  anulada: false,
  motivo_anulacion: null,
  con_faltante: false,
  metodos: 'Efectivo',
  items: [
    { producto: 'PÓKER', empaque: 'Six', cantidad: 2, unidades: 12,
      precio_unitario: 25_000, total: 50_000 },
  ],
};

const ANULADA = {
  ...COMPLETADA,
  id: 2,
  numero: 129,
  total: 12_500,
  anulada: true,
  motivo_anulacion: 'el cliente se arrepintió',
  items: [
    { producto: 'HIELO', empaque: 'Unidad', cantidad: 1, unidades: 1,
      precio_unitario: 12_500, total: 12_500 },
  ],
};

function nucleo(lista: readonly unknown[]) {
  return (comando: string) => {
    if (comando === 'historial_ventas') return Promise.resolve(lista);
    if (comando === 'primer_dia_con_movimiento') return Promise.resolve('2026-08-01');
    return Promise.resolve(undefined);
  };
}

async function montar(lista: readonly unknown[] = [COMPLETADA, ANULADA]) {
  pedir.mockImplementation(nucleo(lista));
  render(<HistorialVentas />);
  if (lista.length > 0) await screen.findByText(`#${(lista[0] as { numero: number }).numero}`);
  else await screen.findByText(/No hay ventas en este período/);
  return userEvent.setup();
}

/** Abre el detalle de una venta por su número. */
async function abrir(usuario: ReturnType<typeof userEvent.setup>, numero: string) {
  await usuario.click(screen.getByText(numero).closest('button') as HTMLElement);
}

beforeEach(() => {
  cleanup();
  permisos.negados = [];
  pedir.mockReset();
});

afterEach(cleanup);

describe('la lista', () => {
  it('muestra cada venta con su hora, quién la hizo y cómo se pagó', async () => {
    await montar();

    const fila = screen.getByText('#128').closest('button');
    expect(fila?.textContent).toContain('20/08/2026');
    expect(fila?.textContent).toContain('Camilo');
    expect(fila?.textContent).toContain('Efectivo');
    expect(fila?.textContent).toContain('$47.800');
  });

  it('marca la anulada y la tacha', async () => {
    await montar();

    expect(screen.getByText('anulada')).toBeTruthy();
    const fila = screen.getByText('#129').closest('button');
    expect(within(fila as HTMLElement).getByText('$12.500').className)
      .toContain('line-through');
  });

  it('el total de abajo no cuenta las anuladas', async () => {
    await montar();

    // El renglon del pie, no su padre: el padre es media pantalla y ahi
    // el 47.800 aparece igual porque esta en la fila de la venta.
    const pie = screen.getByText((_, e) => (e?.textContent ?? '')
      .includes('sin contar las anuladas') && e?.tagName === 'P');

    // 47.800 de la buena; los 12.500 de la anulada no suman.
    expect(pie.textContent).toContain('$47.800');
    expect(pie.textContent).not.toContain('$60.300');
    expect(pie.textContent).toContain('2 ventas');
  });

  it('avisa a un cajero de que solo ve lo suyo', async () => {
    permisos.negados = ['venta.ver_todas'];
    await montar();

    expect(screen.getByText(/solo tus ventas/)).toBeTruthy();
  });

  it('a quien las ve todas no le dice nada', async () => {
    await montar();
    expect(screen.queryByText(/solo tus ventas/)).toBeNull();
  });

  it('avisa cuando el período no tiene ninguna', async () => {
    await montar([]);
    expect(screen.getByText(/No hay ventas en este período/)).toBeTruthy();
  });
});

describe('el detalle', () => {
  it('empieza cerrado y se abre al tocarlo', async () => {
    const usuario = await montar();
    expect(screen.queryByText('PÓKER')).toBeNull();

    await abrir(usuario, '#128');
    expect(screen.getByText('PÓKER')).toBeTruthy();
  });

  it('dice cuántas unidades salieron, no solo cuántos empaques', async () => {
    const usuario = await montar();
    await abrir(usuario, '#128');

    // Dos six son doce cervezas: es lo que salio del inventario.
    expect(screen.getByText(/12 unidades/)).toBeTruthy();
  });

  it('muestra el descuento que se hizo', async () => {
    const usuario = await montar();
    await abrir(usuario, '#128');

    expect(screen.getByText('Descuento')).toBeTruthy();
    expect(screen.getByText('−$2.200')).toBeTruthy();
  });

  it('en la anulada dice por qué se anuló', async () => {
    const usuario = await montar();
    await abrir(usuario, '#129');

    expect(screen.getByText(/Anulada: el cliente se arrepintió/)).toBeTruthy();
  });
});

describe('anular una venta', () => {
  /** Abre la venta buena y pide anularla. */
  async function pedirAnular(usuario: ReturnType<typeof userEvent.setup>) {
    await abrir(usuario, '#128');
    await usuario.click(screen.getByRole('button', { name: /Anular esta venta/ }));
  }

  it('no se ofrece sobre una que ya está anulada', async () => {
    const usuario = await montar();
    await abrir(usuario, '#129');

    expect(screen.queryByRole('button', { name: /Anular esta venta/ })).toBeNull();
  });

  it('no se ofrece a quien no tiene el permiso', async () => {
    permisos.negados = ['venta.anular'];
    const usuario = await montar();
    await abrir(usuario, '#128');

    expect(screen.queryByRole('button', { name: /Anular esta venta/ })).toBeNull();
  });

  it('avisa qué pasa con la mercancía y con la plata', async () => {
    const usuario = await montar();
    await pedirAnular(usuario);

    expect(screen.getByText(/vuelve al inventario/)).toBeTruthy();
    expect(screen.getByText(/sale de la caja abierta/)).toBeTruthy();
    // Nada se borra: queda el registro con su motivo.
    expect(screen.getByText(/no se borra/i)).toBeTruthy();
  });

  it('exige un motivo escrito', async () => {
    const usuario = await montar();
    await pedirAnular(usuario);

    const confirmar = screen.getByRole('button', { name: /Anular la venta/ });
    expect(confirmar.hasAttribute('disabled')).toBe(true);

    await usuario.type(screen.getByRole('textbox'), '   ');
    expect(confirmar.hasAttribute('disabled')).toBe(true);

    await usuario.type(screen.getByRole('textbox'), 'se cobró de más');
    expect(confirmar.hasAttribute('disabled')).toBe(false);
  });

  it('manda la venta y el motivo sin espacios de sobra', async () => {
    const usuario = await montar();
    await pedirAnular(usuario);
    await usuario.type(screen.getByRole('textbox'), '  se cobró de más  ');
    await usuario.click(screen.getByRole('button', { name: /Anular la venta/ }));

    const llamada = pedir.mock.calls.find(([c]) => c === 'anular_venta');
    expect(llamada?.[1]).toMatchObject({
      datos: { venta_id: 1, motivo: 'se cobró de más', usuario_id: 7 },
    });
  });

  it('vuelve a leer la lista, porque la venta cambió de estado', async () => {
    const usuario = await montar();
    const lecturas = () =>
      pedir.mock.calls.filter(([c]) => c === 'historial_ventas').length;
    const antes = lecturas();

    await pedirAnular(usuario);
    await usuario.type(screen.getByRole('textbox'), 'se cobró de más');
    await usuario.click(screen.getByRole('button', { name: /Anular la venta/ }));

    expect(lecturas()).toBeGreaterThan(antes);
  });

  it('cancelar no anula nada', async () => {
    const usuario = await montar();
    await pedirAnular(usuario);
    await usuario.type(screen.getByRole('textbox'), 'me arrepentí');
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(pedir.mock.calls.some(([c]) => c === 'anular_venta')).toBe(false);
  });

  it('si el núcleo lo rechaza, lo dice', async () => {
    const usuario = await montar();
    await pedirAnular(usuario);
    await usuario.type(screen.getByRole('textbox'), 'se cobró de más');

    pedir.mockImplementation((comando: string) => {
      if (comando === 'anular_venta') {
        return Promise.reject(new Error('No hay ninguna caja abierta.'));
      }
      return nucleo([COMPLETADA, ANULADA])(comando);
    });
    await usuario.click(screen.getByRole('button', { name: /Anular la venta/ }));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('el período', () => {
  it('arranca en el último mes y no solo en hoy', async () => {
    await montar();

    // Quien entra a Ventas viene buscando una que ya paso.
    const desde = screen.getByLabelText('Desde') as HTMLInputElement;
    const hasta = screen.getByLabelText('Hasta') as HTMLInputElement;
    const dias = (new Date(hasta.value).getTime() - new Date(desde.value).getTime())
      / 86_400_000;
    expect(Math.round(dias)).toBe(29);
  });

  it('trae los atajos de siempre', async () => {
    await montar();

    const atajos = within(screen.getByRole('group', { name: /Períodos/ }))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(atajos).toContain('Hoy');
    expect(atajos).toContain('30 días');
  });
});
