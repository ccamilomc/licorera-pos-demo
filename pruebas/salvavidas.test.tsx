// @vitest-environment jsdom
/**
 * El salvavidas de cada pantalla.
 *
 * Sin el, un error en cualquier componente deja la ventana en blanco: ni
 * un mensaje ni un boton. Paso de verdad mientras se construia esto, por
 * un campo que el nucleo no mandaba, y la aplicacion entera desaparecio.
 *
 * En un mostrador eso es lo peor: el dueño no sabe si se dañó el
 * programa, si perdio los datos o si se le fue la luz.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Salvavidas } from '@/nucleo/Salvavidas';

/** Un componente que falla cuando se le dice. */
function Fragil({ roto, texto = 'todo bien' }: { roto: boolean; texto?: string }) {
  if (roto) throw new Error('falta el campo credito');
  return <p>{texto}</p>;
}

beforeEach(() => {
  cleanup();
  // React escribe el error en consola; aqui solo estorba.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('cuando la pantalla funciona', () => {
  it('no se nota que está ahí', () => {
    render(
      <Salvavidas nombre="Resumen">
        <Fragil roto={false} />
      </Salvavidas>,
    );

    expect(screen.getByText('todo bien')).toBeTruthy();
    expect(screen.queryByText(/Se dañó/)).toBeNull();
  });
});

describe('cuando la pantalla se rompe', () => {
  function montarRota(nombre = 'Resumen') {
    render(
      <Salvavidas nombre={nombre}>
        <Fragil roto />
      </Salvavidas>,
    );
  }

  it('dice qué pantalla fue, en vez de dejar todo en blanco', () => {
    montarRota('Créditos');

    expect(screen.getByText(/Se dañó la pantalla de Créditos/)).toBeTruthy();
  });

  it('tranquiliza sobre los datos', () => {
    montarRota();

    // El dueño no sabe si perdio el inventario de tres años.
    expect(screen.getByText(/No se perdió nada/)).toBeTruthy();
    expect(screen.getByText(/puedes seguir cobrando/)).toBeTruthy();
  });

  it('muestra el error, para poder decir qué pasó', () => {
    montarRota();

    expect(screen.getByText('falta el campo credito')).toBeTruthy();
  });

  it('ofrece volver a intentar', async () => {
    const usuario = userEvent.setup();

    // Falla mientras el problema siga, y funciona cuando se arregla.
    // No se cuenta cuantas veces se renderizo: React reintenta por su
    // cuenta al capturar el error y el contador se adelanta.
    const problema = { sigue: true };
    function Intermitente() {
      if (problema.sigue) throw new Error('la base estaba ocupada');
      return <p>ya cargó</p>;
    }

    render(
      <Salvavidas nombre="Reportes">
        <Intermitente />
      </Salvavidas>,
    );
    expect(screen.getByText(/Se dañó/)).toBeTruthy();

    problema.sigue = false;
    await usuario.click(screen.getByRole('button', { name: /Volver a intentar/ }));

    expect(screen.getByText('ya cargó')).toBeTruthy();
    expect(screen.queryByText(/Se dañó/)).toBeNull();
  });

  it('deja el rastro en la consola para poder revisarlo', () => {
    montarRota('Caja');

    const escrito = vi.mocked(console.error).mock.calls
      .map((c) => String(c[0]))
      .join(' ');
    expect(escrito).toContain('Se rompió Caja');
  });
});
