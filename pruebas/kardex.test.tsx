// @vitest-environment jsdom
/**
 * El historial de un producto.
 *
 * Es la pantalla a la que se llega cuando el conteo fisico no cuadra, asi
 * que lo que se protege aqui es que no mienta: que el boton de deshacer
 * salga solo donde se puede deshacer, y que un fallo al deshacer no borre
 * de la vista el historial que se estaba consultando.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Kardex } from '@/modulos/inventario/Kardex';

const pedir = vi.hoisted(() => vi.fn());
const permiso = vi.hoisted(() => ({ tiene: true }));

vi.mock('@/nucleo/puente', () => ({
  pedir,
  mensajeDeError: (causa: unknown) => String(causa),
}));

// La sesion de verdad memoiza su valor. Devolver un objeto nuevo en cada
// render dispararia el efecto que carga el historial sin parar.
const SESION = vi.hoisted(() => ({
  usuario: { id: 7, nombre: 'Camilo', rol: 'ADMINISTRADOR' },
  puede: () => permiso.tiene,
}));

vi.mock('@/nucleo/sesion', () => ({ useSesion: () => SESION }));

interface Fila {
  id: number;
  fecha: string;
  producto: string;
  tipo: string;
  cantidad: number;
  existencia_despues: number;
  motivo: string | null;
  usuario: string;
  se_puede_deshacer: boolean;
}

function movimiento(cambios: Partial<Fila>): Fila {
  return {
    id: 1,
    fecha: '2026-08-20T14:30:00',
    producto: 'PÓKER',
    tipo: 'AJUSTE',
    cantidad: -2,
    existencia_despues: 44,
    motivo: 'Se rompieron en el estante',
    usuario: 'Camilo',
    se_puede_deshacer: true,
    ...cambios,
  };
}

const AJUSTE = movimiento({});
const VENTA = movimiento({
  id: 2, tipo: 'VENTA', cantidad: -6, existencia_despues: 38,
  motivo: 'Venta 128', se_puede_deshacer: false,
});

beforeEach(() => {
  cleanup();
  permiso.tiene = true;
  pedir.mockReset();
  pedir.mockImplementation((comando: string) => {
    if (comando === 'reporte_kardex') return Promise.resolve([VENTA, AJUSTE]);
    return Promise.resolve({ existencia_despues: 46 });
  });
});

afterEach(cleanup);

/** Espera a que el historial termine de cargar. */
async function montar(onCambio?: (existencia: number) => void) {
  render(
    onCambio === undefined
      ? <Kardex productoId={1} />
      : <Kardex productoId={1} onCambio={onCambio} />,
  );
  await screen.findByText('Se rompieron en el estante');
  return userEvent.setup();
}

/** Abre el dialogo de deshacer del unico ajuste que hay. */
async function abrirDeshacer(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(screen.getByRole('button', { name: /deshacer/i }));
  return screen.getByRole('dialog');
}

describe('el historial de un producto', () => {
  it('muestra cada movimiento con su cambio y con qué quedó', async () => {
    await montar();

    const filas = screen.getAllByRole('row');
    // La primera es el encabezado.
    expect(within(filas[1] as HTMLElement).getByText('-6')).toBeTruthy();
    expect(within(filas[1] as HTMLElement).getByText('38')).toBeTruthy();
    expect(within(filas[2] as HTMLElement).getByText('-2')).toBeTruthy();
    expect(within(filas[2] as HTMLElement).getByText('44')).toBeTruthy();
  });

  it('pone el signo + a lo que entra, para que no se lea como resta', async () => {
    pedir.mockImplementation(() =>
      Promise.resolve([movimiento({ tipo: 'COMPRA', cantidad: 60, motivo: 'Compra C-45' })]));
    render(<Kardex productoId={1} />);
    await screen.findByText('Compra C-45');

    expect(screen.getByText('+60')).toBeTruthy();
  });

  it('no repite el motivo cuando dice lo mismo que el tipo', async () => {
    pedir.mockImplementation(() =>
      Promise.resolve([movimiento({ tipo: 'IMPORTACION', motivo: 'Carga inicial' })]));
    render(<Kardex productoId={1} />);

    // Una sola vez: el nombre del tipo. El motivo repetido no aporta nada.
    const apariciones = await screen.findAllByText('Carga inicial');
    expect(apariciones).toHaveLength(1);
  });

  it('avisa cuando el producto todavía no tiene movimientos', async () => {
    pedir.mockImplementation(() => Promise.resolve([]));
    render(<Kardex productoId={1} />);

    expect(await screen.findByText(/todavía no tiene movimientos/i)).toBeTruthy();
  });
});

describe('cuando hay más movimientos de los que caben', () => {
  /** Tantos movimientos como se hayan pedido: siempre parece que hay más. */
  function llenoHasta(limite: number) {
    return Array.from({ length: limite }, (_, i) =>
      movimiento({ id: i + 1, tipo: 'VENTA', se_puede_deshacer: false }));
  }

  it('pide los últimos 200 y no todo el historial', async () => {
    await montar();

    const consulta = pedir.mock.calls.find(([c]) => c === 'reporte_kardex');
    expect((consulta?.[1] as { limite: number }).limite).toBe(200);
  });

  it('avisa que hay más atrás en vez de dejar creer que eso es todo', async () => {
    pedir.mockImplementation((_c: string, a: { limite: number }) =>
      Promise.resolve(llenoHasta(a.limite)));
    render(<Kardex productoId={1} />);

    expect(await screen.findByText(/Hay más atrás/)).toBeTruthy();
  });

  it('no molesta con el aviso cuando ya está todo a la vista', async () => {
    await montar();

    expect(screen.queryByText(/Hay más atrás/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ver más' })).toBeNull();
  });

  it('trae más cuando se lo piden', async () => {
    pedir.mockImplementation((_c: string, a: { limite: number }) =>
      Promise.resolve(llenoHasta(a.limite)));
    render(<Kardex productoId={1} />);
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole('button', { name: 'Ver más' }));

    const ultima = pedir.mock.calls.at(-1);
    expect((ultima?.[1] as { limite: number }).limite).toBe(600);

    // El numero va en su propio span, asi que el aviso se lee entero.
    const aviso = (await screen.findByText(/Se están viendo los últimos/)).parentElement;
    expect(aviso?.textContent).toContain('600');
  });
});

describe('deshacer un ajuste', () => {
  it('solo ofrece deshacer en los movimientos que se pueden deshacer', async () => {
    await montar();

    // Dos movimientos, un solo boton: el de la venta no existe.
    expect(screen.getAllByRole('button', { name: /deshacer/i })).toHaveLength(1);
  });

  it('no lo ofrece a quien no puede ajustar el inventario', async () => {
    permiso.tiene = false;
    await montar();

    expect(screen.queryByRole('button', { name: /deshacer/i })).toBeNull();
  });

  it('exige un motivo antes de dejar deshacer', async () => {
    const usuario = await montar();
    const dialogo = await abrirDeshacer(usuario);

    const confirmar = within(dialogo).getByRole('button', { name: /deshacer el ajuste/i });
    expect(confirmar.hasAttribute('disabled')).toBe(true);

    await usuario.type(within(dialogo).getByLabelText(/motivo/i), '   ');
    expect(confirmar.hasAttribute('disabled')).toBe(true);

    await usuario.type(within(dialogo).getByLabelText(/motivo/i), 'me equivoqué');
    expect(confirmar.hasAttribute('disabled')).toBe(false);
  });

  it('recuerda qué decía el ajuste que se va a deshacer', async () => {
    const usuario = await montar();
    const dialogo = await abrirDeshacer(usuario);

    expect(within(dialogo).getByText(/Se rompieron en el estante/)).toBeTruthy();
    expect(within(dialogo).getByText(/-2/)).toBeTruthy();
  });

  it('manda el movimiento y el motivo sin espacios de sobra', async () => {
    const usuario = await montar();
    const dialogo = await abrirDeshacer(usuario);

    await usuario.type(within(dialogo).getByLabelText(/motivo/i), '  me equivoqué  ');
    await usuario.click(within(dialogo).getByRole('button', { name: /deshacer el ajuste/i }));

    expect(pedir).toHaveBeenCalledWith('deshacer_ajuste', {
      movimientoId: AJUSTE.id,
      motivo: 'me equivoqué',
      usuarioId: 7,
      rol: 'ADMINISTRADOR',
    });
  });

  it('avisa a la ficha con la existencia que quedó', async () => {
    const aviso = vi.fn();
    const usuario = await montar(aviso);
    const dialogo = await abrirDeshacer(usuario);

    await usuario.type(within(dialogo).getByLabelText(/motivo/i), 'me equivoqué');
    await usuario.click(within(dialogo).getByRole('button', { name: /deshacer el ajuste/i }));

    expect(aviso).toHaveBeenCalledWith(46);
  });

  it('vuelve a leer el historial, porque el núcleo le agregó un movimiento', async () => {
    const usuario = await montar();
    const lecturas = () =>
      pedir.mock.calls.filter(([c]) => c === 'reporte_kardex').length;
    const antes = lecturas();

    const dialogo = await abrirDeshacer(usuario);
    await usuario.type(within(dialogo).getByLabelText(/motivo/i), 'me equivoqué');
    await usuario.click(within(dialogo).getByRole('button', { name: /deshacer el ajuste/i }));

    expect(lecturas()).toBeGreaterThan(antes);
  });

  it('si el núcleo lo rechaza, el historial sigue en pantalla', async () => {
    pedir.mockImplementation((comando: string) => {
      if (comando === 'reporte_kardex') return Promise.resolve([VENTA, AJUSTE]);
      return Promise.reject(new Error('Ese ajuste ya se deshizo.'));
    });

    const usuario = await montar();
    const dialogo = await abrirDeshacer(usuario);
    await usuario.type(within(dialogo).getByLabelText(/motivo/i), 'me equivoqué');
    await usuario.click(within(dialogo).getByRole('button', { name: /deshacer el ajuste/i }));

    // El aviso sale, pero no se lleva por delante lo que se estaba mirando.
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Se rompieron en el estante')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('cancelar no toca nada', async () => {
    const usuario = await montar();
    const dialogo = await abrirDeshacer(usuario);

    await usuario.type(within(dialogo).getByLabelText(/motivo/i), 'me equivoqué');
    await usuario.click(within(dialogo).getByRole('button', { name: /cancelar/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pedir.mock.calls.some(([c]) => c === 'deshacer_ajuste')).toBe(false);
  });
});
