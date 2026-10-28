// @vitest-environment jsdom
/**
 * El estado de resultados.
 *
 * Es la pantalla que se manda al contador y con la que se decide si el
 * negocio da o no da. Lo que se protege aqui es que los renglones cuadren
 * entre si —lo que se resta se ve restando— y que las advertencias no se
 * escondan: mientras haya ventas sin costo la utilidad sale inflada, y
 * mientras haya plata fiada una parte de esa utilidad no ha entrado.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EstadoResultados } from '@/modulos/reportes/EstadoResultados';

const pedir = vi.hoisted(() => vi.fn());
const imprimir = vi.hoisted(() => vi.fn());
const generarImpresion = vi.hoisted(() => vi.fn((_d: unknown) => '<html></html>'));

vi.mock('@/nucleo/puente', () => ({
  pedir,
  mensajeDeError: (causa: unknown) => String(causa),
}));

vi.mock('@/modulos/reportes/imprimir', () => ({ imprimir, generarImpresion }));

const SESION = vi.hoisted(() => ({
  usuario: { id: 1, nombre: 'Camilo', rol: 'ADMINISTRADOR' },
  nombreNegocio: 'Licorera Demo',
  puede: () => true,
}));

vi.mock('@/nucleo/sesion', () => ({ useSesion: () => SESION }));

const ESTADO = {
  desde: '2026-08-01',
  hasta: '2026-08-21',
  dias: 21,

  ventas_registradas: 5_054_000,
  descuentos: 54_000,
  anulaciones: 12_500,
  ventas_netas: 4_987_500,
  impuestos: 0,

  costo_de_ventas: 3_190_000,
  utilidad_bruta: 1_797_500,
  margen_bruto: 36,

  mermas: [
    { motivo: 'Se rompieron en el estante', unidades: 9, costo: 23_400 },
    { motivo: 'Vencidas', unidades: 4, costo: 16_800 },
  ],
  total_merma: 40_200,
  utilidad_bruta_ajustada: 1_757_300,

  gastos: [
    { concepto: 'Arriendo', del_periodo: 900_000, cuantos: 1 },
    { concepto: 'Sueldos', del_periodo: 2_800_000, cuantos: 2 },
  ],
  total_gastos: 3_700_000,
  utilidad_operacional: -1_942_700,
  margen_operacional: -39,

  por_categoria: [
    { categoria: 'Cervezas', ventas: 2_950_000, costo: 1_980_000,
      utilidad: 970_000, margen: 33, peso: 54 },
    { categoria: 'Licores', ventas: 1_120_000, costo: 810_000,
      utilidad: 310_000, margen: 28, peso: 17 },
  ],
  anterior: null,
  punto_de_equilibrio: 10_277_000,
  ventas_contadas: 612,
  unidades_vendidas: 1_840,
  ticket_promedio: 8_148,

  fiado_del_periodo: 0,
  fiado_sin_cobrar: 0,
  renglones_sin_costo: 0,
  ventas_sin_costo: 0,
};

async function montar(cambios: Record<string, unknown> = {}) {
  pedir.mockImplementation(() => Promise.resolve({ ...ESTADO, ...cambios }));
  render(<EstadoResultados />);
  await screen.findByLabelText('Utilidad operacional');
  return userEvent.setup();
}

beforeEach(() => {
  cleanup();
  pedir.mockReset();
  imprimir.mockReset();
  generarImpresion.mockClear();
});

afterEach(cleanup);

describe('los renglones cuadran entre sí', () => {
  it('lo que se resta se ve restando', async () => {
    await montar();

    // Un descuento que aparece sin signo se lee como plata que entró.
    expect(screen.getByText('−$54.000')).toBeTruthy();
    expect(screen.getByText('−$3.190.000')).toBeTruthy();
    expect(screen.getByText('−$3.700.000')).toBeTruthy();
  });

  it('la utilidad operacional es lo que queda después de todo', async () => {
    await montar();

    const dato = screen.getByLabelText('Utilidad operacional');
    // 1.797.500 de bruta − 40.200 de merma − 3.700.000 de gastos.
    expect(dato.textContent).toContain('$-1.942.700');
    expect(dato.textContent).toContain('-39 %');
  });

  it('pinta en rojo la pérdida y en verde la ganancia', async () => {
    await montar();
    expect(screen.getByLabelText('Utilidad operacional').className).toContain('text-grave');

    cleanup();
    await montar({ utilidad_operacional: 420_000, margen_operacional: 8 });
    expect(screen.getByLabelText('Utilidad operacional').className).toContain('text-bien');
  });
});

describe('las advertencias', () => {
  it('avisa de las ventas sin costo, que inflan la utilidad', async () => {
    await montar({ renglones_sin_costo: 4, ventas_sin_costo: 234_000 });

    const aviso = screen.getByText(/sin costo/i);
    expect(aviso).toBeTruthy();
    expect(document.body.textContent).toContain('$234.000');
  });

  it('no molesta con eso cuando todo tiene costo', async () => {
    await montar();
    expect(screen.queryByText(/sin costo registrado/i)).toBeNull();
  });

  it('dice cuánto se fio y cuánto sigue sin cobrarse', async () => {
    await montar({ fiado_del_periodo: 126_800, fiado_sin_cobrar: 101_800 });

    const aviso = screen.getByText(/De estas ventas/);
    expect(aviso.textContent).toContain('$126.800');
    expect(aviso.textContent).toContain('$101.800');
    // La utilidad los cuenta: la venta esta hecha. Pero no estan en caja.
    expect(aviso.textContent).toContain('no está en la caja');
  });

  it('lo dice distinto cuando ya se cobraron todos', async () => {
    await montar({ fiado_del_periodo: 126_800, fiado_sin_cobrar: 0 });

    expect(screen.getByText(/ya se cobraron todos/)).toBeTruthy();
  });

  it('sin fiados no dice nada', async () => {
    await montar();
    expect(screen.queryByText(/De estas ventas/)).toBeNull();
  });
});

describe('los gastos', () => {
  it('los lista con su categoría', async () => {
    await montar();

    expect(screen.getByText('Arriendo')).toBeTruthy();
    expect(screen.getByText('Sueldos')).toBeTruthy();
  });

  it('dice cuántos pagos son cuando hay más de uno', async () => {
    await montar();

    // «Sueldos 2.800.000» se lee distinto si son dos pagos que si son ocho.
    expect(screen.getByText('2 pagos')).toBeTruthy();
    expect(screen.queryByText('1 pagos')).toBeNull();
  });

  it('explica que es lo pagado y no una parte calculada', async () => {
    await montar();

    expect(screen.getByText(/no una parte\s+calculada de un valor mensual/)).toBeTruthy();
  });

  it('sin gastos anotados lo dice y manda a dónde anotarlos', async () => {
    await montar({ gastos: [], total_gastos: 0 });

    expect(screen.getByText(/No hay gastos anotados en este período/)).toBeTruthy();
    expect(screen.getByText(/Se anotan en Gastos/)).toBeTruthy();
  });
});

describe('la merma', () => {
  it('lista cada motivo con lo que costó', async () => {
    await montar();

    expect(screen.getByText('Se rompieron en el estante')).toBeTruthy();
    expect(screen.getByText('Vencidas')).toBeTruthy();
  });

  it('no ocupa espacio cuando no hubo', async () => {
    await montar({ mermas: [], total_merma: 0 });

    expect(screen.queryByText('Se rompieron en el estante')).toBeNull();
    // Ni el encabezado ni el renglón en cero: un «(−) Merma $0» no
    // significa nada y hace más largo un estado que se lee entero.
    expect(screen.queryByText('Pérdidas de inventario')).toBeNull();
    expect(screen.queryByText('(−) Merma')).toBeNull();
  });
});

describe('imprimir', () => {
  /** Lo que se le manda al generador del papel. */
  async function imprimirCon(cambios: Record<string, unknown> = {}) {
    const usuario = await montar(cambios);
    await usuario.click(screen.getByRole('button', { name: /Imprimir|PDF/ }));
    return generarImpresion.mock.calls[0]?.[0] as {
      negocio: string;
      filas: string[][];
      totales: string[];
    };
  }

  it('manda el estado con el nombre del negocio', async () => {
    const datos = await imprimirCon();

    expect(imprimir).toHaveBeenCalled();
    expect(datos.negocio).toBe('Licorera Demo');
  });

  it('imprime los mismos renglones que se ven, y con signo', async () => {
    const datos = await imprimirCon();
    const conceptos = datos.filas.map((f) => f[0]);

    expect(conceptos).toContain('(−) Costo de la mercancía vendida');
    expect(conceptos).toContain('(−) Arriendo');
    expect(conceptos).toContain('(−) Sueldos');
    expect(datos.filas.find((f) => f[0] === '(−) Sueldos')?.[1]).toBe('−$2.800.000');
    expect(datos.totales[1]).toBe('$-1.942.700');
  });

  it('no imprime en cero lo que no hubo', async () => {
    // Es el papel que va al contador: un «(−) Merma $0» y un «(−)
    // Descuentos $0» lo llenan de renglones que no dicen nada.
    const datos = await imprimirCon({
      mermas: [], total_merma: 0, descuentos: 0, anulaciones: 0,
    });
    const conceptos = datos.filas.map((f) => f[0]);

    expect(conceptos).not.toContain('(−) Merma de inventario');
    expect(conceptos).not.toContain('= Utilidad bruta ajustada');
    expect(conceptos).not.toContain('(−) Descuentos concedidos');
    expect(conceptos).not.toContain('(−) Ventas anuladas');
  });
});

describe('cuando el núcleo falla', () => {
  it('lo dice en vez de dejar la pantalla vacía', async () => {
    pedir.mockImplementation(() => Promise.reject(new Error('La base está ocupada.')));
    render(<EstadoResultados />);

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
