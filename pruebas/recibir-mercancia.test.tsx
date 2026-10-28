// @vitest-environment jsdom
/**
 * Recibir mercancía.
 *
 * Aquí se decide cuánto costó cada unidad, y de ahí sale la utilidad de
 * todo el negocio. Lo que se protege es que el costo sea el del empaque
 * que llegó y no el de la unidad —cinco canastas a $108.000 es el precio
 * de la canasta— y que se pueda dar de alta una forma que el producto no
 * tenía, porque el Excel del negocio solo trajo unidades y sixpacks.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Compras } from '@/modulos/compras/Compras';

const pedir = vi.hoisted(() => vi.fn());
const permiso = vi.hoisted(() => ({ negados: [] as string[] }));

vi.mock('@/nucleo/puente', () => ({
  pedir,
  mensajeDeError: (causa: unknown) => String(causa),
}));

const SESION = vi.hoisted(() => ({
  usuario: { id: 7, nombre: 'Camilo', rol: 'ADMINISTRADOR' },
  nombreNegocio: 'Licorera Demo',
  puede: (p: string) => !permiso.negados.includes(p),
}));

vi.mock('@/nucleo/sesion', () => ({ useSesion: () => SESION }));
vi.mock('@/modulos/reportes/imprimir', () => ({
  imprimir: vi.fn(),
  generarImpresion: vi.fn(() => '<html></html>'),
}));

/** Póker con las dos formas que trajo el Excel: unidad y six. */
interface EmpaqueCompra {
  id: number;
  nombre: string;
  factor: number;
  precio_venta: number | null;
}

const POKER: {
  id: number; codigo: string; nombre: string; categoria: string;
  presentacion: string; envase: string; existencia: number; precio_venta: number;
  busqueda: string; codigos_barras: string[];
  empaques: { id: number; nombre: string; factor: number; precio_venta: number;
              predeterminado: boolean }[];
  empaques_compra: EmpaqueCompra[];
} = {
  id: 1,
  codigo: 'CER-POKER-330B',
  nombre: 'PÓKER',
  categoria: 'Cervezas',
  presentacion: '330 ml',
  envase: 'BOTELLA',
  existencia: 38,
  precio_venta: 3_900,
  busqueda: 'poker 330 ml',
  codigos_barras: [],
  empaques: [
    { id: 10, nombre: 'Unidad', factor: 1, precio_venta: 3_900, predeterminado: true },
    { id: 11, nombre: 'Six', factor: 6, precio_venta: 25_000, predeterminado: false },
  ],
  empaques_compra: [
    { id: 10, nombre: 'Unidad', factor: 1, precio_venta: 3_900 },
    { id: 11, nombre: 'Six', factor: 6, precio_venta: 25_000 },
  ],
};

const AGUARDIENTE = {
  ...POKER,
  id: 2,
  codigo: 'LIC-AGUA-750B',
  nombre: 'AGUARDIENTE ANTIOQUEÑO',
  categoria: 'Licores',
  presentacion: '750 ml',
  existencia: 9,
  precio_venta: 52_000,
  busqueda: 'aguardiente antioqueño 750 ml',
  empaques: [
    { id: 20, nombre: 'Unidad', factor: 1, precio_venta: 52_000, predeterminado: true },
  ],
  empaques_compra: [
    { id: 20, nombre: 'Unidad', factor: 1, precio_venta: 52_000 },
    // Sin precio de venta: sirve para recibir pero todavía no para cobrar.
    { id: 21, nombre: 'Caja', factor: 12, precio_venta: null },
  ],
};

const PROVEEDORES = [
  { id: 1, nombre: 'Distribuidora Bavaria', productos: 12 },
  { id: 2, nombre: 'Surtimax Mayorista', productos: 4 },
];

/** El catálogo que responde el núcleo, mutable entre llamadas. */
let catalogo: unknown[] = [];

function nucleo(comando: string) {
  if (comando === 'listar_proveedores') return Promise.resolve(PROVEEDORES);
  if (comando === 'catalogo_venta') return Promise.resolve(catalogo);
  if (comando === 'listar_compras') return Promise.resolve([]);
  return Promise.resolve(undefined);
}

/** Monta la pantalla ya en la pestaña de recibir. */
async function montar() {
  pedir.mockImplementation(nucleo);
  render(<Compras />);
  const usuario = userEvent.setup();
  await screen.findByRole('button', { name: 'Recibir mercancía' });
  await usuario.click(screen.getByRole('button', { name: 'Recibir mercancía' }));
  await screen.findByLabelText('Buscar producto');
  return usuario;
}

/** Reemplaza lo que haya en un campo, en vez de escribir detrás. */
async function poner(
  usuario: ReturnType<typeof userEvent.setup>,
  etiqueta: string,
  valor: string,
) {
  const campo = screen.getByLabelText(etiqueta);
  await usuario.clear(campo);
  await usuario.type(campo, valor);
}

/** Despliega la lista y elige un producto por su nombre. */
async function elegir(usuario: ReturnType<typeof userEvent.setup>, nombre: string) {
  await usuario.click(screen.getByLabelText('Buscar producto'));
  const opcion = await screen.findByRole('button', { name: new RegExp(nombre) });
  await usuario.click(opcion);
}

beforeEach(() => {
  cleanup();
  permiso.negados = [];
  catalogo = [structuredClone(POKER), structuredClone(AGUARDIENTE)];
  pedir.mockReset();
});

afterEach(cleanup);

describe('elegir el producto', () => {
  it('con el campo enfocado y sin escribir sale el catálogo entero', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByLabelText('Buscar producto'));

    // Antes habia que saberse el nombre de memoria para que apareciera algo.
    expect(await screen.findByRole('button', { name: /PÓKER/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /AGUARDIENTE/ })).toBeTruthy();
  });

  it('escribir filtra, sin tildes y por categoría', async () => {
    const usuario = await montar();
    await usuario.type(screen.getByLabelText('Buscar producto'), 'antioqueno');

    expect(await screen.findByRole('button', { name: /AGUARDIENTE/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /PÓKER/ })).toBeNull();

    await usuario.clear(screen.getByLabelText('Buscar producto'));
    await usuario.type(screen.getByLabelText('Buscar producto'), 'licores');
    expect(await screen.findByRole('button', { name: /AGUARDIENTE/ })).toBeTruthy();
  });

  it('dice cuánto hay de cada uno, para no pedir de más', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByLabelText('Buscar producto'));

    const opcion = await screen.findByRole('button', { name: /PÓKER/ });
    expect(opcion.textContent).toContain('hay 38');
  });
});

describe('la forma en que llega', () => {
  it('propone la más grande, que es como llega del proveedor', async () => {
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');

    const lista = screen.getByLabelText('Empaque de PÓKER') as HTMLSelectElement;
    expect(lista.options[lista.selectedIndex]?.textContent).toContain('Six');
  });

  it('ofrece también las que no tienen precio de venta', async () => {
    const usuario = await montar();
    await elegir(usuario, 'AGUARDIENTE');

    // Una caja puede servir solo para recibir. Filtrarla por no tener
    // precio dejaria al dueño registrando cajas como si fueran botellas.
    const lista = screen.getByLabelText('Empaque de AGUARDIENTE ANTIOQUEÑO');
    expect(within(lista).getByText('Caja (×12)')).toBeTruthy();
  });

  it('el rótulo del costo dice de qué empaque es', async () => {
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');

    // «Costo c/u» se leia como el precio de la cerveza.
    expect(screen.getByLabelText('Costo de cada six de PÓKER')).toBeTruthy();
    expect(screen.getByText('por six')).toBeTruthy();
  });

  it('cambiar de empaque cambia el rótulo', async () => {
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');
    await usuario.selectOptions(screen.getByLabelText('Empaque de PÓKER'), '10');

    expect(screen.getByLabelText('Costo de cada unidad de PÓKER')).toBeTruthy();
  });
});

describe('la cuenta', () => {
  it('multiplica por el factor y saca el costo por unidad', async () => {
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');

    await poner(usuario, 'Cantidad de PÓKER', '5');
    await poner(usuario, 'Costo de cada six de PÓKER', '18000');

    const fila = screen.getByText('PÓKER').closest('tr') as HTMLElement;
    // 5 six son 30 botellas; 18.000 / 6 = 3.000 por botella.
    expect(within(fila).getByText('30')).toBeTruthy();
    expect(within(fila).getByText('$3.000')).toBeTruthy();
    // Se vende a 3.900: quedan 900, un 23 %.
    expect(within(fila).getByText(/23% de margen/)).toBeTruthy();
  });

  it('avisa cuando se está comprando más caro de lo que se vende', async () => {
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');
    await poner(usuario, 'Cantidad de PÓKER', '1');
    await poner(usuario, 'Costo de cada six de PÓKER', '30000');

    expect(screen.getByText(/se vende por debajo/)).toBeTruthy();
  });

  it('el total de la compra es cantidad por costo del empaque', async () => {
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');
    await poner(usuario, 'Cantidad de PÓKER', '5');
    await poner(usuario, 'Costo de cada six de PÓKER', '18000');

    expect(screen.getByLabelText('Total de la compra').textContent).toContain('$90.000');
  });
});

describe('dar de alta una forma que el producto no tenía', () => {
  /** Abre el formulario de forma nueva sobre el renglón que haya. */
  async function pedirFormaNueva(usuario: ReturnType<typeof userEvent.setup>) {
    await usuario.selectOptions(screen.getByLabelText('Empaque de PÓKER'), '__nueva__');
    return screen.findByText(/Una forma nueva para PÓKER/);
  }

  it('propone las que se repiten en cualquier licorera, sin repetir las que ya tiene',
    async () => {
      const usuario = await montar();
      await elegir(usuario, 'PÓKER');
      await pedirFormaNueva(usuario);

      expect(screen.getByRole('button', { name: 'Canasta ×30' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Media canasta ×15' })).toBeTruthy();
      // Póker ya tiene six: ofrecerlo otra vez solo estorba.
      expect(screen.queryByRole('button', { name: 'Six ×6' })).toBeNull();
    });

  it('exige nombre y cuántas unidades trae', async () => {
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');
    await pedirFormaNueva(usuario);

    const guardar = screen.getByRole('button', { name: /Guardar y usarla/ });
    expect(guardar.hasAttribute('disabled')).toBe(true);

    await usuario.type(screen.getByLabelText('Nombre de la forma'), 'Canasta');
    expect(guardar.hasAttribute('disabled')).toBe(true);

    await usuario.type(screen.getByLabelText('Unidades que trae'), '30');
    expect(guardar.hasAttribute('disabled')).toBe(false);
  });

  it('sin precio la manda para comprar y no para vender', async () => {
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');
    await pedirFormaNueva(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Canasta ×30' }));

    pedir.mockImplementation((comando: string) => {
      if (comando === 'agregar_empaque') {
        return Promise.resolve({ id: 12, nombre: 'Canasta', factor: 30 });
      }
      return nucleo(comando);
    });
    await usuario.click(screen.getByRole('button', { name: /Guardar y usarla/ }));

    expect(pedir).toHaveBeenCalledWith('agregar_empaque', {
      productoId: 1,
      nombre: 'Canasta',
      factor: 30,
      precioVenta: null,
      paraVenta: false,
      paraCompra: true,
      rol: 'ADMINISTRADOR',
    });
  });

  it('con precio la manda también para vender', async () => {
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');
    await pedirFormaNueva(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Canasta ×30' }));
    await usuario.type(screen.getByLabelText('Precio de venta de la forma'), '108000');

    pedir.mockImplementation((comando: string) => {
      if (comando === 'agregar_empaque') {
        return Promise.resolve({ id: 12, nombre: 'Canasta', factor: 30 });
      }
      return nucleo(comando);
    });
    await usuario.click(screen.getByRole('button', { name: /Guardar y usarla/ }));

    const llamada = pedir.mock.calls.find(([c]) => c === 'agregar_empaque');
    expect(llamada?.[1]).toMatchObject({ precioVenta: 108_000, paraVenta: true });
  });

  it('deja la forma nueva puesta en el renglón', async () => {
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');
    await pedirFormaNueva(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Canasta ×30' }));

    // El nucleo la guarda y el catalogo recargado ya la trae.
    pedir.mockImplementation((comando: string) => {
      if (comando === 'agregar_empaque') {
        return Promise.resolve({ id: 12, nombre: 'Canasta', factor: 30 });
      }
      if (comando === 'catalogo_venta') {
        const p = structuredClone(POKER);
        p.empaques_compra.push({ id: 12, nombre: 'Canasta', factor: 30, precio_venta: null });
        return Promise.resolve([p, structuredClone(AGUARDIENTE)]);
      }
      return nucleo(comando);
    });
    await usuario.click(screen.getByRole('button', { name: /Guardar y usarla/ }));

    // El renglon guardaba su propia copia del producto y no la veia.
    const lista = await screen.findByLabelText('Empaque de PÓKER') as HTMLSelectElement;
    expect(within(lista).getByText('Canasta (×30)')).toBeTruthy();
    expect(lista.options[lista.selectedIndex]?.textContent).toContain('Canasta');
    expect(screen.getByLabelText('Costo de cada canasta de PÓKER')).toBeTruthy();
  });

  it('no se lo ofrece a quien no puede editar productos', async () => {
    permiso.negados = ['producto.editar'];
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');

    const lista = screen.getByLabelText('Empaque de PÓKER');
    expect(within(lista).queryByText(/Otra forma/)).toBeNull();
  });

  it('si el núcleo la rechaza, lo dice y no pierde el renglón', async () => {
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');
    await pedirFormaNueva(usuario);
    await usuario.type(screen.getByLabelText('Nombre de la forma'), 'six');
    await usuario.type(screen.getByLabelText('Unidades que trae'), '12');

    pedir.mockImplementation((comando: string) => {
      if (comando === 'agregar_empaque') {
        return Promise.reject(new Error('Ese producto ya tiene una forma que se llama asi.'));
      }
      return nucleo(comando);
    });
    await usuario.click(screen.getByRole('button', { name: /Guardar y usarla/ }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('PÓKER')).toBeTruthy();
  });
});

describe('guardar la compra', () => {
  it('manda cada renglón con su empaque y su costo', async () => {
    const usuario = await montar();
    await elegir(usuario, 'PÓKER');
    await poner(usuario, 'Cantidad de PÓKER', '5');
    await poner(usuario, 'Costo de cada six de PÓKER', '18000');

    pedir.mockImplementation((comando: string) => {
      if (comando === 'registrar_compra') {
        return Promise.resolve({ numero: 'C-00046', total: 90_000, unidades: 30, items: [] });
      }
      return nucleo(comando);
    });
    await usuario.click(screen.getByRole('button', { name: /Registrar la entrada/ }));

    const llamada = pedir.mock.calls.find(([c]) => c === 'registrar_compra');
    expect((llamada?.[1] as { compra: { items: unknown[] } }).compra.items).toEqual([
      { producto_id: 1, empaque_id: 11, cantidad: 5, costo_empaque: 18_000 },
    ]);
  });
});
