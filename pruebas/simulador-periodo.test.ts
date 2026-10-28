/**
 * El simulador tiene que responder al filtro de fechas.
 *
 * No es una prueba del negocio: es una prueba contra las mentiras del
 * modo desarrollo. Los reportes devolvian las mismas cifras para «hoy» y
 * para «30 dias», asi que al probar la aplicacion parecia que los
 * filtros estaban rotos cuando el nucleo filtraba bien. Un simulador que
 * no se mueve al mover el periodo esconde justo lo unico que esas
 * pantallas hacen.
 */

import { describe, expect, it } from 'vitest';

import { pedirSimulado } from '../src/nucleo/simulador';

/** Una fecha corrida tantos dias, como las manda la pantalla. */
function dia(dias: number): string {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  return [
    f.getFullYear(),
    String(f.getMonth() + 1).padStart(2, '0'),
    String(f.getDate()).padStart(2, '0'),
  ].join('-');
}

const HOY = { periodo: { desde: dia(0), hasta: dia(0), rol: 'ADMINISTRADOR' } };
const MES = { periodo: { desde: dia(-29), hasta: dia(0), rol: 'ADMINISTRADOR' } };

interface FilaConTotal { readonly total: number }

/** Lo que sumo un reporte en un periodo. */
async function suma(comando: string, args: unknown): Promise<number> {
  const filas = await pedirSimulado<FilaConTotal[]>(
    comando, args as Record<string, unknown>,
  );
  return filas.reduce((s, f) => s + f.total, 0);
}

describe('los reportes se mueven con el periodo', () => {
  const reportes = [
    'reporte_ventas_por_dia',
    'reporte_ventas_por_producto',
    'reporte_ventas_por_categoria',
    'reporte_ventas_por_usuario',
  ];

  for (const comando of reportes) {
    it(`${comando} da menos en un dia que en un mes`, async () => {
      const unDia = await suma(comando, HOY);
      const unMes = await suma(comando, MES);

      expect(unMes).toBeGreaterThan(0);
      expect(unDia).toBeLessThan(unMes);
    });
  }

  it('ventas por dia devuelve solo los dias pedidos', async () => {
    const filas = await pedirSimulado<{ fecha: string }[]>(
      'reporte_ventas_por_dia', HOY,
    );

    expect(filas.every((f) => f.fecha === dia(0))).toBe(true);
  });

  it('los cierres de caja de ayer no aparecen en los de hoy', async () => {
    const hoy = await pedirSimulado<{ apertura: string }[]>(
      'reporte_cierres_de_caja', HOY,
    );
    const mes = await pedirSimulado<{ apertura: string }[]>(
      'reporte_cierres_de_caja', MES,
    );

    expect(hoy).toHaveLength(1);
    expect(mes.length).toBeGreaterThan(hoy.length);
  });
});

describe('el historial de ventas', () => {
  const pedirVentas = (args: unknown) =>
    pedirSimulado<{ fecha: string }[]>(
      'historial_ventas', args as Record<string, unknown>,
    );

  it('no lista las de ayer cuando se pide hoy', async () => {
    const hoy = await pedirVentas({ ...HOY, limite: 200 });
    const mes = await pedirVentas({ ...MES, limite: 200 });

    expect(mes.length).toBeGreaterThan(0);
    expect(hoy.every((v) => v.fecha.startsWith(dia(0)))).toBe(true);
  });

  it('respeta el tope de cuantas se traen', async () => {
    const pocas = await pedirVentas({ ...MES, limite: 1 });

    expect(pocas).toHaveLength(1);
  });
});

describe('el estado de resultados', () => {
  interface Estado {
    readonly desde: string;
    readonly hasta: string;
    readonly dias: number;
    readonly ventas_netas: number;
    readonly total_gastos: number;
    readonly gastos: readonly unknown[];
    readonly anterior: { readonly desde: string; readonly hasta: string } | null;
  }

  const estado = (args: unknown) =>
    pedirSimulado<Estado>('estado_de_resultados', args as Record<string, unknown>);

  it('contesta con el periodo que le pidieron, no con el suyo', async () => {
    const e = await estado(HOY);

    // Devolvia siempre los ultimos 30 dias, dijera lo que dijera la
    // pantalla: el encabezado contradecia a las casillas de fecha.
    expect(e.desde).toBe(dia(0));
    expect(e.hasta).toBe(dia(0));
    expect(e.dias).toBe(1);
  });

  it('vende menos en un dia que en un mes', async () => {
    expect((await estado(HOY)).ventas_netas)
      .toBeLessThan((await estado(MES)).ventas_netas);
  });

  it('solo cuenta los gastos del periodo', async () => {
    // Un arriendo pagado hace veinte dias no es gasto de hoy.
    const hoy = await estado(HOY);
    const mes = await estado(MES);

    expect(hoy.gastos).toHaveLength(0);
    expect(hoy.total_gastos).toBe(0);
    expect(mes.total_gastos).toBeGreaterThan(0);
  });

  it('compara contra un tramo igual de largo, justo antes', async () => {
    const e = await estado(HOY);

    expect(e.anterior?.desde).toBe(dia(-1));
    expect(e.anterior?.hasta).toBe(dia(-1));
  });
});

describe('el primer dia con movimiento', () => {
  it('no arranca despues de la venta mas vieja', async () => {
    // Si «Todo» empieza tarde muestra menos que «30 dias», y eso se lee
    // como si el filtro estuviera al reves.
    const inicio = await pedirSimulado<string>('primer_dia_con_movimiento', {});
    const todo = await pedirSimulado<{ fecha: string }[]>(
      'reporte_ventas_por_dia',
      { periodo: { desde: inicio, hasta: dia(0), rol: 'ADMINISTRADOR' } },
    );
    const mes = await pedirSimulado<{ fecha: string }[]>(
      'reporte_ventas_por_dia', MES,
    );

    expect(todo.length).toBe(mes.length);
  });
});
