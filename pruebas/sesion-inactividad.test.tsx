// @vitest-environment jsdom
/**
 * El bloqueo por inactividad.
 *
 * En un mostrador el equipo queda solo: el cajero sale a la bodega y la
 * sesion abierta queda a la vista de cualquiera. Lo que se protege aqui
 * es que ese bloqueo exista, que se reinicie mientras haya alguien
 * delante, y que respete los minutos configurados —eran quince fijos en
 * el codigo mientras Configuracion ofrecia cambiarlos.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

import { ProveedorSesion, useSesion } from '@/nucleo/sesion';

const pedir = vi.hoisted(() => vi.fn());
const SIMULADO = vi.hoisted(() => ({ activo: true }));

vi.mock('@/nucleo/puente', () => ({
  pedir,
  get MODO_SIMULADO() { return SIMULADO.activo; },
  mensajeDeError: (causa: unknown) => String(causa),
}));

const USUARIO = {
  id: 1, usuario: 'dev', nombre: 'Modo desarrollo',
  rol: 'Administrador' as const, activo: true, ultimo_ingreso: null,
};

vi.mock('@/nucleo/simulador', () => ({
  SESION_DEV: { usuario: USUARIO, permisos: ['venta.crear'] },
}));

/** Deja ver por pantalla lo que el contexto expone. */
function Sonda() {
  const { usuario, stockMinimoDefecto } = useSesion();
  return (
    <p>
      {usuario === null ? 'fuera' : `dentro:${usuario.nombre}`}
      {` stock:${stockMinimoDefecto}`}
    </p>
  );
}

/** Monta la sesión con los ajustes que devolvería el núcleo. */
async function montar(minutos = 15, stockMinimo = 3) {
  pedir.mockImplementation((comando: string) => {
    if (comando === 'estado_arranque') {
      return Promise.resolve({
        tiene_usuarios: true,
        nombre_negocio: 'Licorera Demo',
        minutos_inactividad: minutos,
        stock_minimo_defecto: stockMinimo,
      });
    }
    return Promise.resolve(undefined);
  });

  // Se monta dentro de `act` y no se espera con `findBy*`: con el reloj
  // detenido, esperar por sondeo no avanza nunca. `act` vacia la cola de
  // promesas, que es lo unico que falta para que la sesion entre.
  await act(async () => {
    render(<ProveedorSesion><Sonda /></ProveedorSesion>);
  });
  expect(screen.getByText(/dentro:Modo desarrollo/)).toBeTruthy();
}

/**
 * Deja pasar el tiempo como si nadie tocara el equipo.
 *
 * Es asincrona porque cerrar la sesion avisa al nucleo, y sin vaciar la
 * cola de promesas la pantalla se queda como estaba.
 */
async function pasan(minutos: number) {
  await act(async () => { vi.advanceTimersByTime(minutos * 60_000); });
}

beforeEach(() => {
  cleanup();
  pedir.mockReset();
  SIMULADO.activo = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('cuando el equipo queda solo', () => {
  it('cierra la sesión al pasar los minutos configurados', async () => {
    await montar(5);

    await pasan(6);

    expect(screen.getByText(/fuera/)).toBeTruthy();
  });

  it('antes de esos minutos no cierra nada', async () => {
    await montar(5);

    await pasan(4);

    // Cerrar antes de tiempo es peor que no cerrar: deja al cajero
    // volviendo a entrar a mitad de una venta.
    expect(screen.getByText(/dentro:/)).toBeTruthy();
  });

  it('avisa al núcleo que fue por inactividad y no por salir', async () => {
    await montar(5);
    await pasan(6);

    // El registro distingue las dos cosas: una sesión que se cerró sola
    // no es alguien que se fue.
    expect(pedir).toHaveBeenCalledWith('cerrar_sesion', {
      usuarioId: 1, porInactividad: true,
    });
  });

  it('los minutos salen de Configuración, no de un número fijo', async () => {
    // Con los quince de antes horneados, a los once seguiría dentro.
    await montar(10);

    await pasan(11);
    expect(screen.getByText(/fuera/)).toBeTruthy();
  });
});

describe('cuando hay alguien delante', () => {
  it('cualquier señal de vida reinicia la cuenta', async () => {
    await montar(10);

    await pasan(8);
    act(() => { window.dispatchEvent(new Event('keydown')); });
    await pasan(8);

    // Dieciséis minutos en total, pero nunca diez seguidos sin tocar
    // nada: sigue dentro.
    expect(screen.getByText(/dentro:/)).toBeTruthy();
  });
});

describe('lo que el resto de la aplicación lee de aquí', () => {
  it('expone el stock mínimo para los productos nuevos', async () => {
    await montar(15, 12);

    expect(screen.getByText(/stock:12/)).toBeTruthy();
  });
});
