// @vitest-environment jsdom
/**
 * La pantalla que hay antes de importar.
 *
 * Es lo unico que separa al dueño de escribir sobre su inventario con lo
 * que traiga un Excel. Lo que se protege aqui es que diga la verdad antes
 * de tocar nada: cuantos se crean, cuantos cambian y de que a que, que
 * las filas rotas se vean, y que los productos que el Excel ya no trae se
 * informen sin borrarse.
 *
 * Tambien que no se pueda importar cuando no hay nada que importar: ese
 * boton hace una copia de seguridad y reescribe el catalogo, y correrlo
 * para nada es puro riesgo.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { VistaPreviaImportacion } from '@/modulos/excel/componentes/VistaPreviaImportacion';
import type { PlanImportacion } from '@/modulos/excel/planificador';

const RESUMEN_VACIO = {
  aCrear: 0, aActualizar: 0, sinCambios: 0, ausentes: 0,
  errores: 0, avisos: 0, unidadesQueEntran: 0, valorQueEntra: 0,
};

const PLAN_VACIO: PlanImportacion = {
  crear: [], actualizar: [], ausentes: [], incidencias: [], resumen: RESUMEN_VACIO,
};

/** Un plan con lo que se quiera cambiar encima del vacío. */
function plan(parcial: Partial<PlanImportacion> = {}): PlanImportacion {
  return {
    ...PLAN_VACIO,
    ...parcial,
    resumen: { ...RESUMEN_VACIO, ...(parcial.resumen ?? {}) },
  };
}

function montar(p: PlanImportacion, aplicando = false) {
  const onAplicar = vi.fn();
  const onCancelar = vi.fn();
  render(
    <VistaPreviaImportacion
      plan={p}
      aplicando={aplicando}
      onAplicar={onAplicar}
      onCancelar={onCancelar}
    />,
  );
  return { onAplicar, onCancelar, usuario: userEvent.setup() };
}

/** El botón que aplica la importación, diga lo que diga en ese momento. */
function importar(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Importar|Importando/ }) as HTMLButtonElement;
}

beforeEach(cleanup);
afterEach(cleanup);

describe('lo que promete antes de tocar nada', () => {
  it('deja claro que todavía no se guardó nada', async () => {
    montar(plan({ resumen: { ...RESUMEN_VACIO, aCrear: 3 } }));

    expect(screen.getByText(/Todavía no se ha guardado nada/)).toBeTruthy();
    expect(screen.getByText(/tu archivo de Excel\s+no se modifica/)).toBeTruthy();
  });

  it('avisa que se respalda antes de aplicar', async () => {
    montar(plan({ resumen: { ...RESUMEN_VACIO, aCrear: 3 } }));

    expect(screen.getByText(/copia de seguridad antes de aplicar/)).toBeTruthy();
  });
});

describe('las cifras', () => {
  it('separa lo que se crea de lo que se actualiza y lo que queda igual', async () => {
    montar(plan({
      resumen: { ...RESUMEN_VACIO, aCrear: 12, aActualizar: 5, sinCambios: 137 },
    }));

    const esperado: readonly (readonly [string, string])[] = [
      ['Se crean', '12'], ['Se actualizan', '5'], ['Sin cambios', '137'],
    ];
    for (const [rotulo, valor] of esperado) {
      // El recuadro es el padre del rótulo, no un ancestro cualquiera:
      // buscar más arriba encontraría el número de otra cifra.
      const caja = screen.getByText(rotulo).parentElement as HTMLElement;
      expect(within(caja).getByText(valor)).toBeTruthy();
    }
  });

  it('el botón dice cuántos productos va a tocar', async () => {
    montar(plan({ resumen: { ...RESUMEN_VACIO, aCrear: 12, aActualizar: 5 } }));

    // Doce y cinco son diecisiete: los que quedan igual no se cuentan.
    expect(importar().textContent).toContain('Importar 17 productos');
  });

  it('dice cuánta mercancía entra y por cuánto', async () => {
    montar(plan({
      resumen: {
        ...RESUMEN_VACIO, aCrear: 2, unidadesQueEntran: 240, valorQueEntra: 1_872_000,
      },
    }));

    expect(screen.getByText('240')).toBeTruthy();
    expect(screen.getByText('$1.872.000')).toBeTruthy();
  });
});

describe('cuando no hay nada que hacer', () => {
  it('no deja importar y explica por qué', async () => {
    montar(plan({ resumen: { ...RESUMEN_VACIO, sinCambios: 154 } }));

    // Aplicar para nada respalda y reescribe el catalogo sin motivo.
    expect(importar().disabled).toBe(true);
    expect(screen.getByText(/ya está al día con este archivo/)).toBeTruthy();
  });
});

describe('lo que sale mal', () => {
  const ERROR = {
    hoja: 'INVENTARIO', fila: 42, severidad: 'ERROR' as const,
    mensaje: 'La fila no tiene nombre de producto.',
    accion: 'Se salta esta fila.',
  };

  const AVISO = {
    hoja: 'PRECIOS VENTA', fila: 88, severidad: 'AVISO' as const,
    mensaje: 'Hay dos MARGARITA con precio distinto.',
    accion: 'Se importan separadas y quedan marcadas para revisar.',
  };

  it('muestra las filas que no se pueden importar con dónde están', async () => {
    montar(plan({ incidencias: [ERROR], resumen: { ...RESUMEN_VACIO, aCrear: 1, errores: 1 } }));

    expect(screen.getByText(/1 fila no se puede importar/)).toBeTruthy();
    expect(screen.getByText(/INVENTARIO, fila 42/)).toBeTruthy();
    expect(screen.getByText('La fila no tiene nombre de producto.')).toBeTruthy();
  });

  it('los avisos no impiden importar, pero se ven', async () => {
    montar(plan({ incidencias: [AVISO], resumen: { ...RESUMEN_VACIO, aCrear: 2, avisos: 1 } }));

    expect(screen.getByText(/1 cosas que conviene mirar/)).toBeTruthy();
    expect(screen.getByText(/quedan marcados dentro del sistema/)).toBeTruthy();
    expect(importar().disabled).toBe(false);
  });

  it('el plural del encabezado concuerda', async () => {
    montar(plan({
      incidencias: [ERROR, { ...ERROR, fila: 43 }],
      resumen: { ...RESUMEN_VACIO, aCrear: 1, errores: 2 },
    }));

    expect(screen.getByText(/2 filas no se pueden importar/)).toBeTruthy();
  });
});

describe('lo que cambia en los que ya existían', () => {
  const ACTUALIZAR = {
    id: 1,
    producto: { nombre: 'PÓKER', presentacion: '330 ml' },
    cambios: [
      { campo: 'precio', antes: '$2.700', despues: '$3.000' },
      { campo: 'existencia', antes: '12', despues: '38' },
    ],
  };

  it('dice de cuánto a cuánto, campo por campo', async () => {
    montar(plan({
      actualizar: [ACTUALIZAR] as unknown as PlanImportacion['actualizar'],
      resumen: { ...RESUMEN_VACIO, aActualizar: 1 },
    }));

    expect(screen.getByText('Qué cambia en los que ya existían')).toBeTruthy();
    const fila = screen.getByText('$3.000').closest('tr') as HTMLElement;
    expect(within(fila).getByText('$2.700')).toBeTruthy();
    expect(within(fila).getByText('precio')).toBeTruthy();
  });
});

describe('los que el Excel ya no trae', () => {
  it('se informan pero se dice que no se borran', async () => {
    montar(plan({
      ausentes: [
        { id: 9, nombre: 'RON VIEJO', presentacion: 'Media' },
      ] as unknown as PlanImportacion['ausentes'],
      resumen: { ...RESUMEN_VACIO, aCrear: 1, ausentes: 1 },
    }));

    // Que falten del archivo no significa que el dueño los quiera fuera.
    expect(screen.getByText(/No se borran ni se tocan/)).toBeTruthy();
    expect(screen.getByText(/RON VIEJO/)).toBeTruthy();
  });
});

describe('los botones', () => {
  it('aplicar y cancelar avisan a quien corresponde', async () => {
    const { onAplicar, onCancelar, usuario } = montar(
      plan({ resumen: { ...RESUMEN_VACIO, aCrear: 3 } }),
    );

    await usuario.click(importar());
    expect(onAplicar).toHaveBeenCalled();

    await usuario.click(screen.getByRole('button', { name: /Cancelar/ }));
    expect(onCancelar).toHaveBeenCalled();
  });

  it('mientras importa no se puede volver a pulsar ni cancelar a medias', async () => {
    montar(plan({ resumen: { ...RESUMEN_VACIO, aCrear: 3 } }), true);

    // Importar dos veces duplicaria el catalogo; cancelar a medias
    // dejaria la operacion sin saber en que quedo.
    expect(importar().disabled).toBe(true);
    expect(screen.getByText(/Importando/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Cancelar/ }) as HTMLButtonElement).disabled)
      .toBe(true);
  });
});
