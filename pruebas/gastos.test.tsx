// @vitest-environment jsdom
/**
 * La pantalla de gastos.
 *
 * Es la que decide si el estado de resultados dice la verdad, asi que lo
 * que se protege aqui es que un gasto sea un hecho con fecha: que no se
 * pueda guardar sin monto, que anular lo saque de la cuenta sin sacarlo
 * de la vista, y que corregir sea distinto de anular.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Gastos } from '@/modulos/reportes/Gastos';

const pedir = vi.hoisted(() => vi.fn());
const permiso = vi.hoisted(() => ({ tiene: true }));

vi.mock('@/nucleo/puente', () => ({
  pedir,
  mensajeDeError: (causa: unknown) => String(causa),
}));

const SESION = vi.hoisted(() => ({
  usuario: { id: 7, nombre: 'Camilo', rol: 'ADMINISTRADOR' },
  puede: () => permiso.tiene,
}));

vi.mock('@/nucleo/sesion', () => ({ useSesion: () => SESION }));

interface Fila {
  id: number;
  fecha: string;
  categoria_id: number | null;
  categoria: string | null;
  concepto: string;
  monto: number;
  nota: string | null;
  usuario: string | null;
  anulado: boolean;
  motivo_anulacion: string | null;
}

function gasto(cambios: Partial<Fila>): Fila {
  return {
    id: 1,
    fecha: '2026-08-01',
    categoria_id: 1,
    categoria: 'Arriendo',
    concepto: 'Arriendo del local',
    monto: 800_000,
    nota: null,
    usuario: 'Camilo',
    anulado: false,
    motivo_anulacion: null,
    ...cambios,
  };
}

const ARRIENDO = gasto({});
const BOLSAS = gasto({
  id: 2, fecha: '2026-08-17', categoria_id: 5, categoria: 'Bolsas y empaque',
  concepto: 'Bolsas', monto: 20_000,
});

const CATEGORIAS = [
  { id: 1, nombre: 'Arriendo', fijo: true, activo: true, en_uso: 3 },
  { id: 4, nombre: 'Sueldos', fijo: true, activo: true, en_uso: 0 },
  { id: 5, nombre: 'Bolsas y empaque', fijo: false, activo: true, en_uso: 2 },
  { id: 9, nombre: 'Domicilios', fijo: false, activo: false, en_uso: 1 },
];

/** Responde a los dos comandos que la pantalla pide al entrar. */
function nucleo(lista: readonly Fila[]) {
  return (comando: string) => {
    if (comando === 'listar_gastos') return Promise.resolve(lista);
    if (comando === 'categorias_de_gasto') return Promise.resolve(CATEGORIAS);
    if (comando === 'crear_categoria_gasto') return Promise.resolve(99);
    return Promise.resolve(undefined);
  };
}

async function montar(lista: readonly Fila[] = [ARRIENDO, BOLSAS]) {
  pedir.mockImplementation(nucleo(lista));
  render(<Gastos />);
  await screen.findByRole('heading', { name: 'Gastos' });
  if (lista.length > 0) await screen.findByText(lista[0]!.concepto);
  else await screen.findByText(/No hay gastos anotados/);
  return userEvent.setup();
}

/** Abre el formulario y llena lo indispensable. */
async function anotar(
  usuario: ReturnType<typeof userEvent.setup>,
  concepto: string,
  monto: string,
) {
  await usuario.click(screen.getByRole('button', { name: /Anotar un gasto/ }));
  await usuario.type(screen.getByLabelText('En qué se gastó'), concepto);
  await usuario.type(screen.getByLabelText('Cuánto se gastó'), monto);
}

beforeEach(() => {
  cleanup();
  permiso.tiene = true;
  pedir.mockReset();
});

afterEach(cleanup);

describe('lo que se ve al entrar', () => {
  it('muestra cada gasto con su fecha en colombiano y su categoría', async () => {
    await montar();

    const fila = screen.getByText('Arriendo del local').closest('tr');
    expect(within(fila as HTMLElement).getByText('01/08/2026')).toBeTruthy();
    expect(within(fila as HTMLElement).getByText('Arriendo')).toBeTruthy();
    expect(within(fila as HTMLElement).getByText('$800.000')).toBeTruthy();
  });

  it('suma solo lo que cuenta y dice cuántos gastos son', async () => {
    await montar();

    const total = screen.getByText(/gastos/).parentElement;
    expect(total?.textContent).toContain('$820.000');
    expect(total?.textContent).toContain('2');
  });

  it('deja claro que lo anulado no está sumado', async () => {
    await montar([
      ARRIENDO,
      gasto({ id: 3, concepto: 'Doble', monto: 500_000, anulado: true,
              motivo_anulacion: 'lo pagué dos veces' }),
    ]);

    // «anulado» sale tambien en la etiqueta de la fila: aqui interesa el pie.
    const pie = screen.getByText(/que no cuentan/);
    expect(pie.textContent).toContain('1 anulado');
    // El total no incluye el anulado: 800.000, no 1.300.000.
    expect(pie.parentElement?.textContent).toContain('$800.000');
    expect(pie.parentElement?.textContent).not.toContain('1.300.000');
  });

  it('el anulado sigue en la lista, tachado y con su motivo', async () => {
    await montar([
      gasto({ id: 3, concepto: 'Doble', monto: 500_000, anulado: true,
              motivo_anulacion: 'lo pagué dos veces' }),
    ]);

    // Esconderlo dejaria sin explicacion un total que no cuadra con lo
    // que alguien recuerda haber anotado.
    expect(screen.getByText('Doble').className).toContain('line-through');
    expect(screen.getByText('lo pagué dos veces')).toBeTruthy();
    expect(screen.getByText('anulado')).toBeTruthy();
  });

  it('no ofrece corregir ni anular lo que ya está anulado', async () => {
    await montar([gasto({ anulado: true, motivo_anulacion: 'ya está' })]);

    expect(screen.queryByRole('button', { name: /^Corregir/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Anular Arriendo/ })).toBeNull();
  });

  it('avisa cuando el período no tiene nada', async () => {
    await montar([]);
    expect(screen.getByText(/No hay gastos anotados en este período/)).toBeTruthy();
  });

  it('a quien no puede ver el fondo del negocio no le ofrece anotar nada', async () => {
    permiso.tiene = false;
    await montar();

    expect(screen.queryByRole('button', { name: /Anotar un gasto/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Corregir/ })).toBeNull();
  });
});

describe('anotar un gasto', () => {
  it('no deja guardar sin concepto ni sin monto', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: /Anotar un gasto/ }));

    const guardar = screen.getByRole('button', { name: 'Guardar' });
    expect(guardar.hasAttribute('disabled')).toBe(true);

    await usuario.type(screen.getByLabelText('En qué se gastó'), 'Sueldo');
    expect(guardar.hasAttribute('disabled')).toBe(true);

    await usuario.type(screen.getByLabelText('Cuánto se gastó'), '1400000');
    expect(guardar.hasAttribute('disabled')).toBe(false);
  });

  it('solo acepta números en el monto', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: /Anotar un gasto/ }));

    const campo = screen.getByLabelText('Cuánto se gastó') as HTMLInputElement;
    await usuario.type(campo, '1.400.000 pesos');

    expect(campo.value).toBe('1400000');
  });

  it('manda al núcleo lo escrito, sin espacios de sobra', async () => {
    const usuario = await montar();
    await anotar(usuario, '  Sueldo de Andrés  ', '1423500');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));

    const llamada = pedir.mock.calls.find(([c]) => c === 'registrar_gasto');
    expect(llamada?.[1]).toMatchObject({
      gasto: {
        id: null,
        concepto: 'Sueldo de Andrés',
        monto: 1_423_500,
        categoria_id: null,
        nota: null,
      },
      usuarioId: 7,
      rol: 'ADMINISTRADOR',
    });
  });

  it('manda la categoría elegida', async () => {
    const usuario = await montar();
    await anotar(usuario, 'Sueldo', '1400000');
    await usuario.selectOptions(screen.getByLabelText('Categoría del gasto'), '4');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));

    const llamada = pedir.mock.calls.find(([c]) => c === 'registrar_gasto');
    expect((llamada?.[1] as { gasto: { categoria_id: number } }).gasto.categoria_id).toBe(4);
  });

  it('un gasto puede no tener categoría', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: /Anotar un gasto/ }));

    // Arranca sin categoria, no en la primera de la lista: elegir una
    // por descuido cambia como se lee el estado de resultados.
    const lista = screen.getByLabelText('Categoría del gasto') as HTMLSelectElement;
    expect(lista.value).toBe('');
  });

  it('no ofrece las categorías desactivadas', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: /Anotar un gasto/ }));

    const lista = screen.getByLabelText('Categoría del gasto');
    expect(within(lista).getByText('Sueldos')).toBeTruthy();
    expect(within(lista).queryByText('Domicilios')).toBeNull();
  });

  it('vuelve a leer la lista después de guardar', async () => {
    const usuario = await montar();
    const lecturas = () => pedir.mock.calls.filter(([c]) => c === 'listar_gastos').length;
    const antes = lecturas();

    await anotar(usuario, 'Sueldo', '1400000');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(lecturas()).toBeGreaterThan(antes);
  });

  it('si el núcleo lo rechaza, lo dice y no cierra el formulario', async () => {
    const usuario = await montar();
    pedir.mockImplementation((comando: string) => {
      if (comando === 'registrar_gasto') {
        return Promise.reject(new Error('Elige una fecha válida.'));
      }
      return nucleo([ARRIENDO, BOLSAS])(comando);
    });

    await anotar(usuario, 'Sueldo', '1400000');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    // Lo escrito sigue ahí: volver a teclearlo todo seria el castigo
    // equivocado para un error del sistema.
    expect((screen.getByLabelText('En qué se gastó') as HTMLInputElement).value)
      .toBe('Sueldo');
  });
});

describe('corregir', () => {
  it('trae el gasto lleno y lo manda a editar, no a registrar de nuevo', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Corregir Arriendo del local' }));

    expect((screen.getByLabelText('En qué se gastó') as HTMLInputElement).value)
      .toBe('Arriendo del local');
    expect((screen.getByLabelText('Cuánto se gastó') as HTMLInputElement).value)
      .toBe('800000');
    expect((screen.getByLabelText('Fecha del gasto') as HTMLInputElement).value)
      .toBe('2026-08-01');

    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(pedir.mock.calls.some(([c]) => c === 'editar_gasto')).toBe(true);
    expect(pedir.mock.calls.some(([c]) => c === 'registrar_gasto')).toBe(false);
  });

  it('el título dice si se está anotando o corrigiendo', async () => {
    const usuario = await montar();

    await usuario.click(screen.getByRole('button', { name: /Anotar un gasto/ }));
    expect(screen.getByRole('heading', { level: 3, name: 'Anotar un gasto' })).toBeTruthy();

    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));
    await usuario.click(screen.getByRole('button', { name: 'Corregir Arriendo del local' }));
    expect(screen.getByRole('heading', { level: 3, name: 'Corregir el gasto' })).toBeTruthy();
  });
});

describe('anular', () => {
  it('exige un motivo', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Anular Arriendo del local' }));

    const confirmar = screen.getByRole('button', { name: 'Anular el gasto' });
    expect(confirmar.hasAttribute('disabled')).toBe(true);

    await usuario.type(screen.getByLabelText('Motivo de la anulación'), '   ');
    expect(confirmar.hasAttribute('disabled')).toBe(true);

    await usuario.type(screen.getByLabelText('Motivo de la anulación'), 'lo pagué dos veces');
    expect(confirmar.hasAttribute('disabled')).toBe(false);
  });

  it('manda el gasto y el motivo', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Anular Bolsas' }));
    await usuario.type(screen.getByLabelText('Motivo de la anulación'), '  no era de este mes  ');
    await usuario.click(screen.getByRole('button', { name: 'Anular el gasto' }));

    expect(pedir).toHaveBeenCalledWith('anular_gasto', {
      gastoId: BOLSAS.id,
      motivo: 'no era de este mes',
      usuarioId: 7,
      rol: 'ADMINISTRADOR',
    });
  });

  it('avisa que no se borra', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Anular Arriendo del local' }));

    expect(screen.getByText(/No se borra/)).toBeTruthy();
  });

  it('cancelar no anula nada', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Anular Arriendo del local' }));
    await usuario.type(screen.getByLabelText('Motivo de la anulación'), 'me arrepentí');
    await usuario.click(screen.getAllByRole('button', { name: 'Cancelar' })[0] as HTMLElement);

    expect(screen.queryByLabelText('Motivo de la anulación')).toBeNull();
    expect(pedir.mock.calls.some(([c]) => c === 'anular_gasto')).toBe(false);
  });
});

describe('las categorías', () => {
  it('se ven todas, y las desactivadas dicen que lo están', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Categorías' }));

    expect(screen.getByText('(desactivada)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quitar Arriendo' })).toBeTruthy();
    // La desactivada ya no se puede volver a quitar.
    expect(screen.queryByRole('button', { name: 'Quitar Domicilios' })).toBeNull();
  });

  it('crear una la manda al núcleo', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Categorías' }));
    await usuario.type(screen.getByLabelText('Nombre de la categoría'), 'Transporte');
    await usuario.click(screen.getByRole('button', { name: 'Agregar' }));

    expect(pedir).toHaveBeenCalledWith('crear_categoria_gasto', {
      nombre: 'Transporte', fijo: false, rol: 'ADMINISTRADOR',
    });
  });

  it('quitar una la manda al núcleo y recarga', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Categorías' }));
    await usuario.click(screen.getByRole('button', { name: 'Quitar Arriendo' }));

    expect(pedir).toHaveBeenCalledWith('quitar_categoria_gasto', {
      categoriaId: 1, rol: 'ADMINISTRADOR',
    });
  });

  it('dice cuántos gastos usa cada una, para que quitar no sea a ciegas', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Categorías' }));

    const arriendo = screen.getByText('Arriendo', { selector: 'li' });
    expect(arriendo.textContent).toContain('3');
  });
});
