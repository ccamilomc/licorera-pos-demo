// @vitest-environment jsdom
/**
 * La ficha del producto.
 *
 * Es la pantalla por la que el dueño carga su inventario. El Excel del
 * negocio fue una guia de como estaba el local un dia, no el catalogo
 * definitivo: quien venda un vino, un cigarrillo o una garrafa tiene que
 * poder darlo de alta sin que el sistema se lo impida.
 *
 * Lo que mas se protege aqui es que ningun campo se pierda en el camino
 * al nucleo: como los campos nuevos tienen valor por omision en Rust,
 * olvidar uno no falla, solo lo descarta en silencio.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditarProducto } from '@/modulos/inventario/EditarProducto';
import type { ProductoFicha } from '@/modulos/inventario/EditarProducto';

const pedir = vi.hoisted(() => vi.fn());

vi.mock('@/nucleo/puente', () => ({
  pedir,
  mensajeDeError: (causa: unknown) => String(causa),
}));

vi.mock('@/nucleo/sesion', () => ({
  useSesion: () => ({
    usuario: { id: 1, nombre: 'Camilo', rol: 'ADMINISTRADOR' },
    puede: () => true,
  }),
}));

const FICHA_NUEVA: ProductoFicha = {
  id: null, codigo: '', nombre: '', categoria: '', marca: null,
  presentacion: '', volumen_ml: null, envase: null, unidad_base: 'UNIDAD',
  precio_venta: 0, stock_minimo: 3, stock_maximo: null, notas: null,
  empaques: [{
    id: null, nombre: 'Unidad', factor: 1, precio_venta: null,
    para_venta: true, para_compra: true, predeterminado: true,
  }],
};

function respuestasDelNucleo(comando: string) {
  if (comando === 'listar_categorias') return Promise.resolve(['Cervezas', 'Licores']);
  if (comando === 'listar_catalogo') return Promise.resolve([]);
  return Promise.resolve(undefined);
}

beforeEach(() => {
  cleanup();
  pedir.mockReset();
  pedir.mockImplementation((comando: string, args?: Record<string, unknown>) => {
    if (comando === 'listar_catalogo') {
      const tipo = args?.['tipo'];
      if (tipo === 'marcas') return Promise.resolve([{ nombre: 'Bavaria' }]);
      if (tipo === 'envases') {
        return Promise.resolve([{ nombre: 'BOTELLA' }, { nombre: 'GARRAFA' }]);
      }
      if (tipo === 'unidades') {
        return Promise.resolve([{ nombre: 'UNIDAD' }, { nombre: 'KILO' }]);
      }
    }
    return respuestasDelNucleo(comando);
  });
});

afterEach(cleanup);

async function montar(ficha: ProductoFicha = FICHA_NUEVA) {
  render(
    <EditarProducto
      ficha={ficha}
      onGuardado={vi.fn()}
      onRefrescar={vi.fn()}
      onCerrar={vi.fn()}
    />,
  );
  // Las listas llegan del nucleo: hay que esperar a que aparezcan.
  await screen.findByRole('combobox', { name: /categoría/i });
  return userEvent.setup();
}

/** Lo que se le mando al nucleo al guardar. */
function loEnviado() {
  const llamada = pedir.mock.calls.find(
    ([comando]) => comando === 'crear_producto' || comando === 'editar_producto',
  );
  return (llamada?.[1] as { producto: Record<string, unknown> } | undefined)?.producto;
}

describe('las listas se llenan desde el nucleo', () => {
  it('la categoría ofrece las que ya existen', async () => {
    await montar();
    const select = screen.getByRole('combobox', { name: /categoría/i });
    expect(within(select).getByRole('option', { name: 'Cervezas' })).toBeInTheDocument();
  });

  it('la marca, el envase y la unidad también', async () => {
    await montar();
    expect(
      within(screen.getByRole('combobox', { name: /marca/i }))
        .getByRole('option', { name: 'Bavaria' }),
    ).toBeInTheDocument();
    // Se muestran capitalizados aunque en la base vivan en mayuscula.
    const envase = within(screen.getByRole('combobox', { name: /envase/i }))
      .getByRole('option', { name: 'Garrafa' });
    expect(envase).toHaveValue('GARRAFA');
    const unidad = within(screen.getByRole('combobox', { name: /se cuenta en/i }))
      .getByRole('option', { name: 'Kilo' });
    expect(unidad).toHaveValue('KILO');
  });
});

describe('agregar una opción que no estaba', () => {
  it('la categoría nueva se puede escribir y queda elegida', async () => {
    const usuario = await montar();

    await usuario.selectOptions(
      screen.getByRole('combobox', { name: /categoría/i }),
      '__agregar__',
    );
    await usuario.type(
      screen.getByLabelText(/categoría: nombre nuevo/i),
      'Vinos{Enter}',
    );

    const select = await screen.findByRole('combobox', { name: /categoría/i });
    expect(select).toHaveValue('Vinos');
  });

  it('se puede desistir sin cambiar lo que había', async () => {
    const usuario = await montar();
    const antes = screen.getByRole('combobox', { name: /marca/i });
    expect(antes).toHaveValue('');

    await usuario.selectOptions(antes, '__agregar__');
    const campoNuevo = screen.getByLabelText(/marca: nombre nuevo/i);
    await usuario.click(
      within(campoNuevo.closest('label')!).getByRole('button', { name: 'Cancelar' }),
    );

    expect(await screen.findByRole('combobox', { name: /marca/i })).toHaveValue('');
  });
});

describe('los empaques de siempre, de un toque', () => {
  it('ofrece los habituales con su factor', async () => {
    await montar();
    expect(screen.getByRole('button', { name: /\+ Six×6/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Canasta×30/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Media canasta×15/ })).toBeInTheDocument();
  });

  it('agregarlo lo deja con su factor puesto, sin escribirlo', async () => {
    const usuario = await montar();

    await usuario.click(screen.getByRole('button', { name: /\+ Canasta×30/ }));

    const factores = screen.getAllByLabelText('Unidades');
    expect(
      factores.some((c) => (c as HTMLInputElement).value === '30'),
      'la canasta tiene que quedar con su factor 30 sin escribirlo',
    ).toBe(true);
  });

  it('el que ya está puesto deja de ofrecerse', async () => {
    const usuario = await montar();

    await usuario.click(screen.getByRole('button', { name: /\+ Six×6/ }));

    expect(screen.queryByRole('button', { name: /\+ Six×6/ })).not.toBeInTheDocument();
  });
});

describe('nada se pierde camino al núcleo', () => {
  it('manda todos los campos, incluidos los que tienen valor por omisión', async () => {
    const usuario = await montar({
      ...FICHA_NUEVA,
      codigo: 'VIN-CASILLERO-750',
      nombre: 'Casillero del Diablo',
      categoria: 'Licores',
      marca: 'Concha y Toro',
      presentacion: '750 ml',
      envase: 'BOTELLA',
      unidad_base: 'UNIDAD',
      precio_venta: 45_000,
      stock_minimo: 2,
      stock_maximo: 24,
      empaques: [{
        id: null, nombre: 'Unidad', factor: 1, precio_venta: 45_000,
        para_venta: true, para_compra: true, predeterminado: true,
      }],
    });

    await usuario.click(screen.getByRole('button', { name: /crear producto|guardar cambios/i }));

    const enviado = loEnviado();
    expect(enviado, 'no se llamó a crear_producto').toBeDefined();
    // Estos tres tienen `#[serde(default)]` en Rust: si el formulario no
    // los manda, el guardado no falla — se pierden calladamente.
    expect(enviado?.['marca']).toBe('Concha y Toro');
    expect(enviado?.['unidad_base']).toBe('UNIDAD');
    expect(enviado?.['stock_maximo']).toBe(24);
    // Y los de siempre, para que la prueba sirva de red completa.
    expect(enviado?.['codigo']).toBe('VIN-CASILLERO-750');
    expect(enviado?.['nombre']).toBe('Casillero del Diablo');
    expect(enviado?.['categoria']).toBe('Licores');
    expect(enviado?.['envase']).toBe('BOTELLA');
    expect(enviado?.['precio_venta']).toBe(45_000);
    expect(enviado?.['stock_minimo']).toBe(2);
  });

  it('una categoría recién escrita llega al núcleo', async () => {
    const usuario = await montar({
      ...FICHA_NUEVA,
      codigo: 'VIN-1', nombre: 'Vino de la casa', precio_venta: 30_000,
      empaques: [{
        id: null, nombre: 'Unidad', factor: 1, precio_venta: 30_000,
        para_venta: true, para_compra: true, predeterminado: true,
      }],
    });

    await usuario.selectOptions(
      screen.getByRole('combobox', { name: /categoría/i }), '__agregar__',
    );
    await usuario.type(screen.getByLabelText(/categoría: nombre nuevo/i), 'Vinos{Enter}');
    await usuario.click(screen.getByRole('button', { name: /crear producto|guardar cambios/i }));

    expect(loEnviado()?.['categoria']).toBe('Vinos');
  });
});

/**
 * El boton de guardar dice si se puede guardar.
 *
 * Antes se podia tocar con la ficha en blanco: el nucleo lo rechazaba,
 * pero el dueño se enteraba despues de guardar en vez de verlo en el
 * boton, como en todas las demas pantallas.
 */
describe('cuando la ficha todavia no se puede guardar', () => {
  /** El nombre del producto: hay otro «Nombre» en cada forma de venta. */
  const campoNombre = () => screen.getAllByLabelText('Nombre')[0] as HTMLElement;

  /** El precio de la primera forma de venta. */
  const campoPrecio = () => screen.getAllByLabelText('Precio')[0] as HTMLElement;

  /** El boton de crear o guardar, sea cual sea el texto. */
  function elBoton(): HTMLButtonElement {
    return screen.getByRole('button', {
      name: /Crear producto|Guardar cambios|Guardando/,
    }) as HTMLButtonElement;
  }

  it('con la ficha en blanco no deja tocarlo, y dice por qué', async () => {
    await montar();

    expect(elBoton().disabled).toBe(true);
    expect(screen.getByText('Ponle un nombre.')).toBeTruthy();
  });

  it('con nombre pero sin categoría sigue bloqueado', async () => {
    const usuario = await montar();
    await usuario.type(campoNombre(), 'VINO SANTA RITA');

    expect(elBoton().disabled).toBe(true);
    expect(screen.getByText('Elige una categoría.')).toBeTruthy();
  });

  it('sin una forma de venta con precio tampoco', async () => {
    const usuario = await montar();
    await usuario.type(campoNombre(), 'VINO SANTA RITA');
    await usuario.selectOptions(
      screen.getByRole('combobox', { name: /categoría/i }), 'Licores',
    );

    // Sin precio no se puede cobrar, que es lo unico que un producto
    // tiene que saber hacer.
    expect(elBoton().disabled).toBe(true);
    expect(screen.getByText(/al menos una forma de venta con precio/)).toBeTruthy();
  });

  it('con nombre, categoría y precio se puede guardar', async () => {
    const usuario = await montar();
    await usuario.type(campoNombre(), 'VINO SANTA RITA');
    await usuario.selectOptions(
      screen.getByRole('combobox', { name: /categoría/i }), 'Licores',
    );
    await usuario.type(campoPrecio(), '38000');

    expect(elBoton().disabled).toBe(false);
    expect(screen.queryByText('Ponle un nombre.')).toBeNull();
  });
});
