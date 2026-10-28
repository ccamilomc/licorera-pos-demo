import { describe, expect, it } from 'vitest';
import {
  cifra, fechaCorta, paraBuscar, pesos, unidades,
} from '../src/compartido/utilidades/formato';

describe('pesos colombianos', () => {
  it('usa punto de miles y no muestra decimales', () => {
    expect(pesos(25000)).toBe('$25.000');
    expect(pesos(1190000)).toBe('$1.190.000');
    expect(pesos(700)).toBe('$700');
  });
  it('redondea en vez de arrastrar centavos', () => {
    expect(pesos(3899.6)).toBe('$3.900');
  });
  it('el cero se muestra, no se esconde', () => {
    expect(pesos(0)).toBe('$0');
    expect(cifra(0)).toBe('0');
  });
  it('no existe el cero negativo', () => {
    // El estado de resultados escribe `-total` para mostrar lo que se
    // resta. Un periodo sin gastos daba «$-0» en pantalla.
    const totalGastos = 0;
    expect(pesos(-totalGastos)).toBe('$0');
    expect(cifra(-totalGastos)).toBe('0');
    expect(pesos(-0.4)).toBe('$0');
  });
});

describe('unidades', () => {
  it('concuerda el singular y el plural', () => {
    expect(unidades(1)).toBe('1 unidad');
    expect(unidades(38)).toBe('38 unidades');
    expect(unidades(0)).toBe('0 unidades');
  });
});

describe('busqueda sin tildes', () => {
  it('encuentra igual con tilde o sin ella', () => {
    expect(paraBuscar('Néctar Azul')).toBe('nectar azul');
    expect(paraBuscar('  CHAMPAÑA  ')).toBe('champana');
    expect(paraBuscar('Águila')).toBe('aguila');
  });
});

/**
 * El nucleo manda las fechas de calendario como texto —«2026-08-20»— y
 * JavaScript interpreta ese formato como medianoche UTC. En Colombia,
 * cinco horas atras, esa medianoche cae el dia anterior a las siete de
 * la tarde: una promocion de hoy se leeria como si hubiera sido ayer, y
 * un reporte de enero como de diciembre del año pasado.
 */
describe('fechas de calendario', () => {
  it('se muestran el dia que dicen, no el anterior', () => {
    expect(fechaCorta('2026-08-20')).toBe('20/08/2026');
  });

  it('el primero de enero no se va al año pasado', () => {
    expect(fechaCorta('2026-01-01')).toBe('01/01/2026');
  });

  it('el 29 de febrero de un año bisiesto se respeta', () => {
    expect(fechaCorta('2028-02-29')).toBe('29/02/2028');
  });
});

describe('marcas de tiempo', () => {
  it('si se convierten a la hora de aqui', () => {
    // Estas son un instante, no un dia del calendario: a las 2 de la
    // mañana UTC del 20, aqui son las 9 de la noche del 19.
    expect(fechaCorta('2026-08-20T02:00:00Z')).toBe('19/08/2026');
  });
});
