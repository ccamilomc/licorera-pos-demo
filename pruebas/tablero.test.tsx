// @vitest-environment jsdom
/**
 * El tablero.
 *
 * Es lo primero que se ve al abrir el programa, asi que se mira de reojo
 * y se cree sin verificar. Por eso lo que se protege aqui son las dos
 * cosas que pueden mentir sin que nadie lo note: la comparacion contra la
 * semana pasada (un signo al reves y un mal dia parece bueno) y la altura
 * de las barras, que ya una vez salieron todas iguales.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

import { Tablero } from '@/modulos/dashboard/Tablero';

const pedir = vi.hoisted(() => vi.fn());

vi.mock('@/nucleo/puente', () => ({
  pedir,
  mensajeDeError: (causa: unknown) => String(causa),
}));

const SESION = vi.hoisted(() => ({
  usuario: { id: 1, nombre: 'Camilo', rol: 'ADMINISTRADOR' },
  puede: () => true,
}));

vi.mock('@/nucleo/sesion', () => ({ useSesion: () => SESION }));

const VACIO = {
  hoy: {
    total: 0, cantidad: 0, ticket_promedio: 0,
    total_semana_pasada: 0, unidades: 0,
  },
  ultimos_dias: [],
  mas_vendidos: [],
  ventas_recientes: [],
  alertas: [],
  agotados: 0,
  bajo_minimo: 0,
  utilidad_estimada: null,
  credito: {
    fiado_hoy: 0, por_cobrar: 0, por_cobrar_viejo: 0, deudores: 0,
    por_pagar: 0, por_pagar_vencido: 0, compras_vencidas: 0,
  },
};

/** Monta el tablero con los datos indicados y espera a que cargue. */
async function montar(cambios: Record<string, unknown> = {}) {
  const datos = { ...VACIO, ...cambios };
  pedir.mockImplementation(() => Promise.resolve(datos));
  render(<Tablero />);
  await screen.findByRole('heading', { name: 'Hoy' });
}

beforeEach(() => {
  cleanup();
  pedir.mockReset();
});

afterEach(cleanup);

describe('comparación contra la semana pasada', () => {
  it('marca la subida con su porcentaje', async () => {
    await montar({ hoy: { ...VACIO.hoy, total: 120_000, total_semana_pasada: 100_000 } });

    expect(screen.getByText('20%')).toBeTruthy();
    expect(screen.getByText(/vs\. mismo día la semana pasada/)).toBeTruthy();
  });

  it('marca la bajada con el porcentaje en positivo, no en negativo', async () => {
    await montar({ hoy: { ...VACIO.hoy, total: 80_000, total_semana_pasada: 100_000 } });

    // La flecha dice el sentido; el numero no repite el signo.
    expect(screen.getByText('20%')).toBeTruthy();
    expect(screen.queryByText('-20%')).toBeNull();
  });

  it('pinta de rojo la bajada y de verde la subida', async () => {
    await montar({ hoy: { ...VACIO.hoy, total: 80_000, total_semana_pasada: 100_000 } });
    const bajada = screen.getByText('20%').parentElement;
    expect(bajada?.className).toContain('text-grave');

    cleanup();
    await montar({ hoy: { ...VACIO.hoy, total: 120_000, total_semana_pasada: 100_000 } });
    const subida = screen.getByText('20%').parentElement;
    expect(subida?.className).toContain('text-bien');
  });

  it('no inventa un porcentaje cuando la semana pasada no hubo nada', async () => {
    await montar({ hoy: { ...VACIO.hoy, total: 120_000, total_semana_pasada: 0 } });

    expect(screen.getByText(/sin dato de la semana pasada/)).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});

describe('la gráfica de los últimos días', () => {
  /** Las alturas de las barras, en el orden en que salen. */
  function alturas() {
    const grafica = screen.getByRole('img', { name: /últimos/i });
    return [...grafica.querySelectorAll<HTMLElement>('[style*="height"]')]
      .map((b) => b.style.height);
  }

  it('da a cada barra una altura proporcional a su venta', async () => {
    await montar({
      ultimos_dias: [
        { fecha: '2026-08-19', total: 200_000, cantidad: 10 },
        { fecha: '2026-08-20', total: 100_000, cantidad: 5 },
        { fecha: '2026-08-21', total: 50_000, cantidad: 3 },
      ],
    });

    expect(alturas()).toEqual(['100%', '50%', '25%']);
  });

  it('deja ver el día sin ventas en vez de borrarlo', async () => {
    await montar({
      ultimos_dias: [
        { fecha: '2026-08-20', total: 200_000, cantidad: 10 },
        { fecha: '2026-08-21', total: 0, cantidad: 0 },
      ],
    });

    // Un dia en cero sigue siendo un dia: la barra queda al ras, pero esta.
    expect(alturas()).toEqual(['100%', '2%']);
  });

  it('no se divide por cero cuando todos los días están en cero', async () => {
    await montar({
      ultimos_dias: [
        { fecha: '2026-08-20', total: 0, cantidad: 0 },
        { fecha: '2026-08-21', total: 0, cantidad: 0 },
      ],
    });

    expect(alturas()).toEqual(['2%', '2%']);
  });

  it('dice en el título de cada barra cuánto se vendió ese día', async () => {
    await montar({
      ultimos_dias: [{ fecha: '2026-08-21', total: 187_400, cantidad: 12 }],
    });

    const grafica = screen.getByRole('img', { name: /últimos/i });
    const barra = grafica.querySelector('[title]');
    // En colombiano, no en el «2026-08-21» con que lo manda el nucleo.
    expect(barra?.getAttribute('title')).toBe('21/08/2026: $187.400 en 12 ventas');
  });
});

describe('la plata que está en la calle', () => {
  const CREDITO = {
    fiado_hoy: 0, por_cobrar: 0, por_cobrar_viejo: 0, deudores: 0,
    por_pagar: 0, por_pagar_vencido: 0, compras_vencidas: 0,
  };

  it('dice cuánto de lo vendido hoy se fio', async () => {
    await montar({
      hoy: { ...VACIO.hoy, total: 340_000 },
      credito: { ...CREDITO, fiado_hoy: 78_000 },
    });

    // «Se vendio $340.000» se lee como plata en el cajon, y una parte
    // se fue fiada.
    expect(screen.getByText('$340.000')).toBeTruthy();
    expect(screen.getByText(/78\.000 se fiaron/)).toBeTruthy();
  });

  it('no molesta con eso cuando no se fio nada', async () => {
    await montar({ hoy: { ...VACIO.hoy, total: 340_000 } });
    expect(screen.queryByText(/se fiaron/)).toBeNull();
  });

  it('muestra cuánto deben y cuántas personas son', async () => {
    await montar({ credito: { ...CREDITO, por_cobrar: 340_000, deudores: 4 } });

    const tarjeta = screen.getByText('Te deben').parentElement;
    expect(tarjeta?.textContent).toContain('$340.000');
    expect(tarjeta?.textContent).toContain('4 personas');
  });

  it('separa lo que lleva más de un mes sin cobrarse', async () => {
    await montar({
      credito: {
        ...CREDITO, por_cobrar: 340_000, por_cobrar_viejo: 120_000, deudores: 4,
      },
    });

    expect(screen.getByText(/120\.000 de hace más de un mes/)).toBeTruthy();
  });

  it('avisa de las compras vencidas y de cuánto son', async () => {
    await montar({
      credito: {
        ...CREDITO, por_pagar: 800_000, por_pagar_vencido: 500_000,
        compras_vencidas: 2,
      },
    });

    const tarjeta = screen.getByText('Debes a proveedores').parentElement;
    expect(tarjeta?.textContent).toContain('$800.000');
    expect(tarjeta?.textContent).toContain('2 compras vencidas');
    expect(tarjeta?.textContent).toContain('$500.000');
  });

  it('lo dice también cuando se debe pero nada está vencido', async () => {
    await montar({ credito: { ...CREDITO, por_pagar: 800_000 } });

    expect(screen.getByText(/nada vencido todavía/)).toBeTruthy();
  });

  it('sin créditos no ocupa espacio', async () => {
    await montar();

    expect(screen.queryByText('Te deben')).toBeNull();
    expect(screen.queryByText('Debes a proveedores')).toBeNull();
    // Ni siquiera el recuadro vacío: dejaría un hueco entre las tarjetas
    // y la gráfica que no significa nada.
    expect(screen.queryByRole('region', { name: 'Créditos' })).toBeNull();
  });
});

describe('la franja de alertas', () => {
  const AGOTADO = {
    id: 1, nombre: 'RON VIEJO DE CALDAS', presentacion: 'Media',
    existencia: 0, stock_minimo: 3, agotado: true,
  };
  const BAJO = {
    id: 2, nombre: 'ÁGUILA', presentacion: '330 ml',
    existencia: 4, stock_minimo: 12, agotado: false,
  };

  it('no ocupa espacio cuando no hay nada que atender', async () => {
    await montar();

    expect(screen.queryByText(/agotados/)).toBeNull();
    expect(screen.queryByText(/bajo el mínimo/)).toBeNull();
  });

  it('cuenta agotados y bajo mínimo por separado', async () => {
    await montar({ alertas: [AGOTADO, BAJO], agotados: 1, bajo_minimo: 1 });

    const titulo = screen.getByRole('heading', { level: 3, name: /agotados/ });
    expect(titulo.textContent).toContain('1 agotados');
    expect(titulo.textContent).toContain('1 bajo el mínimo');
  });

  it('dice «agotado» en vez de un cero que se lee como precio', async () => {
    await montar({ alertas: [AGOTADO, BAJO], agotados: 1, bajo_minimo: 1 });

    const item = screen.getByText(/RON VIEJO DE CALDAS/).closest('li');
    expect(item?.textContent).toContain('agotado');
    expect(within(item as HTMLElement).queryByText('0')).toBeNull();

    // El que solo esta bajo minimo si muestra cuantos quedan.
    const otro = screen.getByText(/ÁGUILA/).closest('li');
    expect(otro?.textContent).toContain('4');
  });
});

describe('lo demás del tablero', () => {
  it('esconde la utilidad cuando el núcleo no la pudo calcular', async () => {
    await montar({ utilidad_estimada: null });
    expect(screen.queryByText(/Utilidad del mes/i)).toBeNull();

    cleanup();
    await montar({ utilidad_estimada: 340_000 });
    expect(screen.getByText(/Utilidad del mes/i)).toBeTruthy();
    expect(screen.getByText('$340.000')).toBeTruthy();
  });

  it('concuerda singular y plural en las unidades vendidas', async () => {
    await montar({ hoy: { ...VACIO.hoy, unidades: 1 } });
    expect(screen.getByText('1 unidad vendida')).toBeTruthy();

    cleanup();
    await montar({ hoy: { ...VACIO.hoy, unidades: 12 } });
    expect(screen.getByText('12 unidades vendidas')).toBeTruthy();
  });

  it('tacha la venta anulada para que no se sume de vista', async () => {
    await montar({
      ventas_recientes: [
        { id: 1, numero: 128, total: 25_000, hora: '02:15 p. m.',
          usuario: 'Camilo', anulada: false, articulos: 3 },
        { id: 2, numero: 129, total: 40_000, hora: '02:40 p. m.',
          usuario: 'Camilo', anulada: true, articulos: 2 },
      ],
    });

    expect(screen.getByText('anulada')).toBeTruthy();
    expect(screen.getByText('$40.000').className).toContain('line-through');
    expect(screen.getByText('$25.000').className).not.toContain('line-through');
  });

  it('avisa cuando no hay ventas, en vez de dejar el hueco en blanco', async () => {
    await montar();

    expect(screen.getByText(/no hay ventas que mostrar/i)).toBeTruthy();
    expect(screen.getByText(/no hay ventas este mes/i)).toBeTruthy();
    expect(screen.getByText(/no se ha registrado ninguna venta/i)).toBeTruthy();
  });

  it('muestra el error del núcleo en vez de una pantalla vacía', async () => {
    pedir.mockImplementation(() => Promise.reject(new Error('La base está ocupada.')));
    render(<Tablero />);

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
