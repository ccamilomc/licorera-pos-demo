// @vitest-environment jsdom
/**
 * La pantalla de ingreso.
 *
 * Es la primera que ve alguien que estrena el programa, y la unica que ve
 * si se equivoca de contraseña. Lo que se protege aqui es que la primera
 * vez pida lo indispensable —cuenta, contraseña y como se llama el
 * local—, que no deje crear una cuenta con dos contraseñas distintas, y
 * que un intento fallido no obligue a escribirlo todo de nuevo.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PantallaIngreso } from '@/modulos/usuarios/PantallaIngreso';

const entrar = vi.hoisted(() => vi.fn());
const crearPrimerAdministrador = vi.hoisted(() => vi.fn());
const sesion = vi.hoisted(() => ({ hayUsuarios: true, nombreNegocio: '' }));

vi.mock('@/nucleo/puente', () => ({
  mensajeDeError: (causa: unknown) => String(causa),
}));

vi.mock('@/nucleo/sesion', () => ({
  useSesion: () => ({
    entrar,
    crearPrimerAdministrador,
    hayUsuarios: sesion.hayUsuarios,
    nombreNegocio: sesion.nombreNegocio,
  }),
}));

function montar() {
  render(<PantallaIngreso />);
  return userEvent.setup();
}

beforeEach(() => {
  cleanup();
  sesion.hayUsuarios = true;
  sesion.nombreNegocio = '';
  entrar.mockReset();
  entrar.mockResolvedValue(undefined);
  crearPrimerAdministrador.mockReset();
  crearPrimerAdministrador.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('el encabezado', () => {
  it('saluda con el nombre del local cuando ya lo pusieron', () => {
    sesion.nombreNegocio = 'Licorera Demo';
    montar();

    expect(screen.getByRole('heading', { name: 'Licorera Demo' })).toBeTruthy();
  });

  it('usa el del programa solo mientras el local no tenga nombre', () => {
    montar();

    // Poner «Punto de Venta» cuando el local sí tiene nombre sería
    // saludar con el nombre equivocado.
    expect(screen.getByRole('heading', { name: 'Punto de Venta' })).toBeTruthy();
  });
});

describe('la primera vez que se abre el sistema', () => {
  beforeEach(() => { sesion.hayUsuarios = false; });

  it('pide crear la cuenta en vez de un usuario que no existe', () => {
    montar();

    expect(screen.getByText(/Crea tu cuenta de administrador/)).toBeTruthy();
    expect(screen.getByLabelText('Tu nombre')).toBeTruthy();
    expect(screen.getByLabelText('Cómo se llama el negocio')).toBeTruthy();
    expect(screen.getByLabelText('Repite la contraseña')).toBeTruthy();
  });

  it('crea la cuenta con el nombre del negocio', async () => {
    const usuario = montar();

    await usuario.type(screen.getByLabelText('Usuario'), 'camilo');
    await usuario.type(screen.getByLabelText('Tu nombre'), 'Camilo');
    await usuario.type(
      screen.getByLabelText('Cómo se llama el negocio'), 'Licorera Demo',
    );
    await usuario.type(screen.getByLabelText('Contraseña'), 'secreta123');
    await usuario.type(screen.getByLabelText('Repite la contraseña'), 'secreta123');
    await usuario.click(screen.getByRole('button', { name: /Crear/ }));

    expect(crearPrimerAdministrador).toHaveBeenCalledWith(
      'camilo', 'Camilo', 'secreta123', 'Licorera Demo',
    );
  });

  it('no deja crear la cuenta con dos contraseñas distintas', async () => {
    const usuario = montar();

    await usuario.type(screen.getByLabelText('Usuario'), 'camilo');
    await usuario.type(screen.getByLabelText('Tu nombre'), 'Camilo');
    await usuario.type(screen.getByLabelText('Cómo se llama el negocio'), 'Demo');
    await usuario.type(screen.getByLabelText('Contraseña'), 'secreta123');
    await usuario.type(screen.getByLabelText('Repite la contraseña'), 'secreta124');
    await usuario.click(screen.getByRole('button', { name: /Crear/ }));

    // Quedarse fuera del propio sistema el primer dia, por una letra.
    expect(screen.getByRole('alert').textContent).toContain('no coinciden');
    expect(crearPrimerAdministrador).not.toHaveBeenCalled();
  });
});

describe('el ingreso de todos los días', () => {
  it('no pide el nombre ni el negocio, que ya están', () => {
    montar();

    expect(screen.getByLabelText('Usuario')).toBeTruthy();
    expect(screen.queryByLabelText('Tu nombre')).toBeNull();
    expect(screen.queryByLabelText('Cómo se llama el negocio')).toBeNull();
    expect(screen.queryByLabelText('Repite la contraseña')).toBeNull();
  });

  it('entra con usuario y contraseña', async () => {
    const usuario = montar();

    await usuario.type(screen.getByLabelText('Usuario'), 'camilo');
    await usuario.type(screen.getByLabelText('Contraseña'), 'secreta123');
    await usuario.click(screen.getByRole('button', { name: /Entrar/ }));

    expect(entrar).toHaveBeenCalledWith('camilo', 'secreta123');
  });

  it('muestra el error y deja el usuario escrito', async () => {
    entrar.mockRejectedValue(new Error('Usuario o contraseña incorrectos.'));
    const usuario = montar();

    await usuario.type(screen.getByLabelText('Usuario'), 'camilo');
    await usuario.type(screen.getByLabelText('Contraseña'), 'malaclave');
    await usuario.click(screen.getByRole('button', { name: /Entrar/ }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    // El usuario se queda: volver a escribirlo todo por una letra mal
    // es el castigo equivocado.
    expect((screen.getByLabelText('Usuario') as HTMLInputElement).value).toBe('camilo');
    // La contraseña sí se borra: es lo que hay que volver a intentar.
    expect((screen.getByLabelText('Contraseña') as HTMLInputElement).value).toBe('');
  });
});

describe('la contraseña', () => {
  it('va tapada y se puede destapar', async () => {
    const usuario = montar();
    const campo = screen.getByLabelText('Contraseña');

    expect(campo.getAttribute('type')).toBe('password');

    await usuario.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(campo.getAttribute('type')).toBe('text');

    await usuario.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(campo.getAttribute('type')).toBe('password');
  });

  it('exige un mínimo de largo', () => {
    montar();

    expect(screen.getByLabelText('Contraseña').getAttribute('minLength')).toBe('6');
  });
});
