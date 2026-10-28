// @vitest-environment jsdom
/**
 * La ayuda dentro del programa.
 *
 * Lo que se protege es que sirva estando parado en la caja: encontrar en
 * segundos lo que uno necesita, sin salir del programa ni saber en que
 * seccion del manual quedo escrito.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Ayuda } from '@/modulos/ayuda/Ayuda';

beforeEach(cleanup);

function montar() {
  render(<Ayuda />);
  return userEvent.setup();
}

describe('el manual llego completo', () => {
  it('el indice lista las secciones', () => {
    montar();
    const indice = screen.getByRole('navigation', { name: /secciones/i });

    expect(within(indice).getByRole('button', { name: 'El día normal' }))
      .toBeInTheDocument();
    expect(within(indice).getByRole('button', { name: 'Copias de seguridad' }))
      .toBeInTheDocument();
  });

  it('abre en la primera seccion, sin dejar la pantalla en blanco', () => {
    montar();
    // El aside tambien lleva un h2 ("Ayuda"): lo que importa es que
    // ademas haya contenido.
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(1);
  });

  it('las tablas del manual se ven como tablas', async () => {
    const usuario = montar();

    await usuario.click(screen.getByRole('button', { name: 'Los tres roles' }));

    const tabla = screen.getByRole('table');
    expect(within(tabla).getByText('Administrador')).toBeInTheDocument();
  });
});

describe('moverse por el indice', () => {
  it('tocar una seccion la muestra', async () => {
    const usuario = montar();

    await usuario.click(screen.getByRole('button', { name: 'Copias de seguridad' }));

    expect(screen.getByRole('heading', { level: 2, name: 'Copias de seguridad' }))
      .toBeInTheDocument();
    expect(screen.getByText(/memoria USB/i)).toBeInTheDocument();
  });

  it('marca cual esta abierta', async () => {
    const usuario = montar();

    const boton = screen.getByRole('button', { name: 'Los tres roles' });
    await usuario.click(boton);

    expect(boton).toHaveAttribute('aria-current', 'true');
  });
});

describe('buscar', () => {
  it('encuentra por una palabra suelta', async () => {
    const usuario = montar();

    await usuario.type(screen.getByLabelText('Buscar en el manual'), 'domicilio');

    expect(screen.getByText(/habla|hablan/)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
  });

  it('dice claramente cuando no hay nada', async () => {
    const usuario = montar();

    await usuario.type(screen.getByLabelText('Buscar en el manual'), 'bitcoin');

    expect(screen.getByText(/Nada del manual habla de/)).toBeInTheDocument();
  });

  it('busca sin importar mayusculas', async () => {
    const usuario = montar();

    await usuario.type(screen.getByLabelText('Buscar en el manual'), 'DOMICILIO');

    expect(screen.queryByText(/Nada del manual habla de/)).not.toBeInTheDocument();
  });

  it('la equis limpia la busqueda y devuelve el indice', async () => {
    const usuario = montar();
    const campo = screen.getByLabelText('Buscar en el manual');

    await usuario.type(campo, 'domicilio');
    await usuario.click(screen.getByRole('button', { name: /limpiar/i }));

    expect(campo).toHaveValue('');
    expect(screen.queryByText(/habla de/)).not.toBeInTheDocument();
  });

  it('encuentra lo que uno buscaria de verdad en la caja', async () => {
    const usuario = montar();
    const campo = screen.getByLabelText('Buscar en el manual');

    // Un cajero al que no le cuadra la caja no busca "arqueo".
    await usuario.type(campo, 'falta plata');

    expect(screen.queryByText(/Nada del manual habla de/)).not.toBeInTheDocument();
  });
});
