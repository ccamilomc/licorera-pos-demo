// @vitest-environment jsdom
/**
 * La pantalla de reportes.
 *
 * Lo que sale aqui se imprime, se manda al contador y se archiva, asi que
 * un numero mal formateado no es un detalle: ya paso una vez que las
 * fechas se corrieran un dia y que un descuadre negativo se leyera como
 * un error de impresion. Eso es lo que se protege.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Reportes } from '@/modulos/reportes/Reportes';

const pedir = vi.hoisted(() => vi.fn());
const guardar = vi.hoisted(() => vi.fn());
const escribir = vi.hoisted(() => vi.fn());
const imprimir = vi.hoisted(() => vi.fn());
const generarImpresion = vi.hoisted(() => vi.fn((_datos: unknown) => '<html></html>'));
const generarExcel = vi.hoisted(() => vi.fn(() => Promise.resolve(new Uint8Array([1]))));
const permisos = vi.hoisted(() => ({ negados: [] as string[] }));

vi.mock('@/nucleo/puente', () => ({
  pedir,
  mensajeDeError: (causa: unknown) => String(causa),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: guardar }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: escribir }));
vi.mock('@/modulos/reportes/imprimir', () => ({ imprimir, generarImpresion }));

// Armar el libro de Excel de verdad tarda casi un segundo y ya tiene su
// propia prueba en exportar.test.ts. Aqui lo que importa es el cableado:
// que se pregunte donde guardar y se escriba lo que salga.
vi.mock('@/modulos/reportes/exportar', async () => ({
  ...await vi.importActual<Record<string, unknown>>('@/modulos/reportes/exportar'),
  generarExcel,
}));

const SESION = vi.hoisted(() => ({
  usuario: { id: 1, nombre: 'Camilo', rol: 'ADMINISTRADOR' },
  nombreNegocio: 'Licorera Demo',
  puede: (permiso: string) => !permisos.negados.includes(permiso),
}));

vi.mock('@/nucleo/sesion', () => ({ useSesion: () => SESION }));

const POR_DIA = [
  { fecha: '2026-08-01', ventas: 12, unidades: 48, total: 187_400 },
  { fecha: '2026-08-02', ventas: 3, unidades: 9, total: 42_000 },
];

/** Monta la pantalla y espera a que la primera consulta termine. */
async function montar(filas: readonly Record<string, unknown>[] = POR_DIA) {
  pedir.mockImplementation(() => Promise.resolve(filas));
  render(<Reportes />);
  await screen.findByRole('heading', { name: 'Reportes' });
  // La tabla o el aviso de vacio, lo que corresponda.
  await screen.findByText(filas.length === 0 ? /No hay movimientos/ : 'Fecha');
  return userEvent.setup();
}

beforeEach(() => {
  cleanup();
  permisos.negados = [];
  pedir.mockReset();
  guardar.mockReset();
  escribir.mockReset();
  imprimir.mockReset();
  generarImpresion.mockClear();
  generarExcel.mockClear();
});

afterEach(cleanup);

describe('cómo se muestran los números', () => {
  it('escribe la fecha como se lee en Colombia, sin correrla un día', async () => {
    await montar();

    // El nucleo manda «2026-08-01». Interpretado como UTC daria el 31/07.
    expect(screen.getByText('01/08/2026')).toBeTruthy();
    expect(screen.queryByText('31/07/2026')).toBeNull();
  });

  it('pone el signo del negativo antes del peso, no después', async () => {
    permisos.negados = [];
    pedir.mockImplementation(() => Promise.resolve([{
      apertura: '2026-08-01', usuario: 'Camilo', base_inicial: 50_000,
      esperado: 237_400, contado: 235_000, diferencia: -2_400,
      observaciones: null,
    }]));
    render(<Reportes />);
    const usuario = userEvent.setup();
    await screen.findByRole('heading', { name: 'Reportes' });
    await usuario.selectOptions(screen.getByLabelText('Reporte'), 'cierres');
    await screen.findByText('Diferencia');

    // «$-2.400» se lee como un error de impresion.
    expect(screen.getByText('−$2.400')).toBeTruthy();
    expect(screen.queryByText('$-2.400')).toBeNull();
  });

  it('marca con una raya lo que no tiene valor, para no dejar el hueco', async () => {
    pedir.mockImplementation(() => Promise.resolve([{
      apertura: '2026-08-01', usuario: 'Camilo', base_inicial: 50_000,
      esperado: 100_000, contado: 100_000, diferencia: 0, observaciones: null,
    }]));
    render(<Reportes />);
    const usuario = userEvent.setup();
    await screen.findByRole('heading', { name: 'Reportes' });
    await usuario.selectOptions(screen.getByLabelText('Reporte'), 'cierres');
    await screen.findByText('Observaciones');

    expect(screen.getByText('—')).toBeTruthy();
  });

  it('le pone el % a la participación, que si no se lee como pesos', async () => {
    pedir.mockImplementation(() => Promise.resolve([
      { categoria: 'Cervezas', unidades: 40, total: 156_000, participacion: 62 },
    ]));
    render(<Reportes />);
    const usuario = userEvent.setup();
    await screen.findByRole('heading', { name: 'Reportes' });
    await usuario.selectOptions(screen.getByLabelText('Reporte'), 'categoria');
    await screen.findByText('% del total');

    expect(screen.getByText('62 %')).toBeTruthy();
  });

  it('alinea a la derecha lo que es cifra y a la izquierda lo que es texto', async () => {
    await montar();

    const encabezados = screen.getAllByRole('columnheader');
    const fecha = encabezados.find((e) => e.textContent === 'Fecha');
    const total = encabezados.find((e) => e.textContent === 'Total');
    expect(fecha?.className).not.toContain('text-right');
    expect(total?.className).toContain('text-right');
  });

  it('cuenta las filas concordando singular y plural', async () => {
    await montar();
    expect(screen.getByText(/filas/).textContent).toContain('2');

    cleanup();
    await montar([POR_DIA[0] as Record<string, unknown>]);
    expect(screen.getByText(/fila/).textContent).toContain('1');
  });
});

describe('qué reportes se ofrecen', () => {
  it('esconde los cierres de caja a quien no puede ver todas las cajas', async () => {
    permisos.negados = ['caja.ver_todas'];
    await montar();

    const lista = screen.getByLabelText('Reporte');
    expect(within(lista).queryByText('Cierres de caja')).toBeNull();
    expect(within(lista).getByText('Ventas por día')).toBeTruthy();
  });

  it('lo dice claro cuando no hay ninguno disponible', async () => {
    permisos.negados = ['caja.ver_todas', 'reporte.operacion'];
    pedir.mockImplementation(() => Promise.resolve([]));
    render(<Reportes />);

    expect(await screen.findByText(/No tienes reportes disponibles/)).toBeTruthy();
  });

  it('consulta el comando del reporte que se eligió', async () => {
    const usuario = await montar();
    await usuario.selectOptions(screen.getByLabelText('Reporte'), 'producto');

    expect(pedir.mock.calls.some(([c]) => c === 'reporte_ventas_por_producto')).toBe(true);
  });
});

describe('el período', () => {
  it('arranca en el primer día del mes y termina hoy', async () => {
    await montar();

    const hoy = new Date();
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const dia = String(hoy.getDate()).padStart(2, '0');
    expect((screen.getByLabelText('Desde') as HTMLInputElement).value)
      .toBe(`${hoy.getFullYear()}-${mes}-01`);
    expect((screen.getByLabelText('Hasta') as HTMLInputElement).value)
      .toBe(`${hoy.getFullYear()}-${mes}-${dia}`);
  });

  it('no deja elegir un período al revés', async () => {
    await montar();

    const desde = screen.getByLabelText('Desde') as HTMLInputElement;
    const hasta = screen.getByLabelText('Hasta') as HTMLInputElement;
    expect(desde.max).toBe(hasta.value);
    expect(hasta.min).toBe(desde.value);
  });

  it('vuelve a consultar cuando cambia la fecha', async () => {
    await montar();
    const antes = pedir.mock.calls.length;

    const desde = screen.getByLabelText('Desde') as HTMLInputElement;
    desde.focus();
    await userEvent.setup().clear(desde);
    // El input de fecha solo dispara el cambio con una fecha completa.
    await userEvent.setup().type(desde, '2026-07-01');

    expect(pedir.mock.calls.length).toBeGreaterThan(antes);
    const ultima = pedir.mock.calls.at(-1);
    expect((ultima?.[1] as { periodo: { desde: string } }).periodo.desde).toBe('2026-07-01');
  });
});

describe('exportar e imprimir', () => {
  it('no deja exportar ni imprimir una tabla vacía', async () => {
    await montar([]);

    expect(screen.getByRole('button', { name: /Exportar/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Imprimir/ }).hasAttribute('disabled')).toBe(true);
  });

  it('guarda el archivo donde el usuario diga y lo avisa', async () => {
    guardar.mockResolvedValue('D:/respaldos/ventas.xlsx');
    const usuario = await montar();

    await usuario.click(screen.getByRole('button', { name: /Exportar/ }));

    // Generar el Excel de verdad tarda: primero el aviso, despues el
    // archivo, que para entonces ya se escribio.
    expect(await screen.findByText(/Se guardó en/)).toBeTruthy();
    expect(escribir).toHaveBeenCalled();
  });

  it('no escribe nada si se cancela el diálogo de guardar', async () => {
    guardar.mockResolvedValue(null);
    const usuario = await montar();

    await usuario.click(screen.getByRole('button', { name: /Exportar/ }));

    // Exportar es asincrono: mirar enseguida no prueba nada, porque
    // todavia no habria escrito ni en el caso bueno. Se exporta otra vez,
    // ahora aceptando, y se espera el aviso de esa ruta en concreto:
    // para cuando aparece, la exportacion cancelada ya termino.
    guardar.mockResolvedValue('D:/respaldos/ventas.xlsx');
    await usuario.click(screen.getByRole('button', { name: /Exportar/ }));
    await screen.findByText(/ventas\.xlsx/);

    expect(escribir.mock.calls.map(([r]) => r)).toEqual(['D:/respaldos/ventas.xlsx']);
  });

  it('manda a imprimir las filas ya formateadas, no los números crudos', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: /Imprimir/ }));

    expect(imprimir).toHaveBeenCalled();
    const datos = generarImpresion.mock.calls[0]?.[0] as {
      negocio: string;
      filas: string[][];
    };
    expect(datos.negocio).toBe('Licorera Demo');
    expect(datos.filas[0]).toEqual(['01/08/2026', '12', '48', '$187.400']);
  });
});

describe('cuando el núcleo falla', () => {
  it('muestra el error en vez de dejar la pantalla vacía sin explicación', async () => {
    pedir.mockImplementation(() => Promise.reject(new Error('La base está ocupada.')));
    render(<Reportes />);

    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('borra la tabla anterior, que si no se queda engañando', async () => {
    const usuario = await montar();
    expect(screen.getByText('01/08/2026')).toBeTruthy();

    // Con datos en pantalla, el siguiente reporte falla.
    pedir.mockImplementation(() => Promise.reject(new Error('La base está ocupada.')));
    await usuario.selectOptions(screen.getByLabelText('Reporte'), 'producto');

    expect(await screen.findByRole('alert')).toBeTruthy();
    // Los numeros del reporte anterior no pueden seguir ahi bajo un
    // titulo que ya no es el suyo.
    expect(screen.queryByText('01/08/2026')).toBeNull();
    expect(screen.getByText(/No hay movimientos en este período/)).toBeTruthy();
  });
});
