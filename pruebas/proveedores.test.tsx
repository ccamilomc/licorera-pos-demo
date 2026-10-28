// @vitest-environment jsdom
/**
 * Los proveedores.
 *
 * Es la libreta de a quien se le compra: el telefono al que se marca para
 * pedir y quien atiende. Lo que se protege aqui es que no se pueda
 * guardar uno sin nombre —un proveedor sin nombre no sirve para nada— y
 * que retirar a uno sea reversible, porque las compras viejas siguen
 * siendo suyas.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Proveedores } from '@/modulos/compras/Proveedores';

const pedir = vi.hoisted(() => vi.fn());
const permisos = vi.hoisted(() => ({ negados: [] as string[] }));

vi.mock('@/nucleo/puente', () => ({
  pedir,
  mensajeDeError: (causa: unknown) => String(causa),
}));

const SESION = vi.hoisted(() => ({
  usuario: { id: 7, nombre: 'Camilo', rol: 'ADMINISTRADOR' },
  puede: (p: string) => !permisos.negados.includes(p),
}));

vi.mock('@/nucleo/sesion', () => ({ useSesion: () => SESION }));

const BAVARIA = {
  id: 1, nombre: 'Distribuidora Bavaria', nit: '900123456-1',
  telefono: '3104567890', contacto: 'Wilson', direccion: 'Calle 30 # 45-12',
  notas: 'Pasa los martes', activo: true, productos: 12,
};

const RETIRADO = {
  id: 2, nombre: 'Surtimax Mayorista', nit: null, telefono: null,
  contacto: null, direccion: null, notas: null, activo: false, productos: 0,
};

function nucleo(lista: readonly unknown[]) {
  return (comando: string) => {
    if (comando === 'listar_proveedores') return Promise.resolve(lista);
    return Promise.resolve(undefined);
  };
}

async function montar(lista: readonly unknown[] = [BAVARIA, RETIRADO]) {
  pedir.mockImplementation(nucleo(lista));
  render(<Proveedores onCerrar={vi.fn()} />);
  if (lista.length > 0) await screen.findByText('Distribuidora Bavaria');
  return userEvent.setup();
}

beforeEach(() => {
  cleanup();
  permisos.negados = [];
  pedir.mockReset();
});

afterEach(cleanup);

describe('la lista', () => {
  it('muestra el teléfono y quién atiende, que es para lo que se abre', async () => {
    await montar();

    expect(screen.getByText('3104567890')).toBeTruthy();
    expect(screen.getByText('Wilson')).toBeTruthy();
  });

  it('dice cuántos productos se le compran', async () => {
    await montar();

    expect(screen.getByText('12 productos')).toBeTruthy();
    expect(screen.getByText('sin compras registradas')).toBeTruthy();
  });

  it('a quien no gestiona proveedores no le ofrece tocarlos', async () => {
    permisos.negados = ['proveedor.gestionar'];
    await montar();

    // Ni dar de alta ni editar: son dos permisos comprobados por
    // separado y hay que mirar los dos.
    expect(screen.queryByRole('button', { name: /Nuevo proveedor/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retirar a/ })).toBeNull();
  });
});

describe('dar de alta uno nuevo', () => {
  it('no deja guardar sin nombre', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: /Nuevo proveedor/ }));

    const guardar = screen.getByRole('button', { name: 'Guardar' });
    expect(guardar.hasAttribute('disabled')).toBe(true);

    await usuario.type(screen.getByLabelText('Nombre'), '   ');
    expect(guardar.hasAttribute('disabled')).toBe(true);

    await usuario.type(screen.getByLabelText('Nombre'), 'La Nacional');
    expect(guardar.hasAttribute('disabled')).toBe(false);
  });

  it('manda lo que se escribió', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: /Nuevo proveedor/ }));
    await usuario.type(screen.getByLabelText('Nombre'), 'La Nacional');
    await usuario.type(screen.getByLabelText(/^Teléfono/), '3009998877');
    await usuario.type(screen.getByLabelText('Quién te atiende'), 'Marta');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));

    const llamada = pedir.mock.calls.find(([c]) => c === 'guardar_proveedor');
    expect(llamada?.[1]).toMatchObject({
      proveedor: {
        id: null, nombre: 'La Nacional', telefono: '3009998877', contacto: 'Marta',
      },
      usuarioId: 7,
    });
  });

  it('el título distingue el alta de la edición', async () => {
    const usuario = await montar();

    await usuario.click(screen.getByRole('button', { name: /Nuevo proveedor/ }));
    expect(screen.getByRole('heading', { name: 'Nuevo proveedor' })).toBeTruthy();

    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));
    await usuario.click(screen.getAllByRole('button', { name: 'Editar' })[0] as HTMLElement);
    expect(screen.getByRole('heading', { name: 'Datos del proveedor' })).toBeTruthy();
  });
});

describe('editar uno que ya está', () => {
  it('trae los datos llenos y guarda con su id', async () => {
    const usuario = await montar();
    await usuario.click(screen.getAllByRole('button', { name: 'Editar' })[0] as HTMLElement);

    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value)
      .toBe('Distribuidora Bavaria');
    expect((screen.getByLabelText('Quién te atiende') as HTMLInputElement).value)
      .toBe('Wilson');

    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));

    const llamada = pedir.mock.calls.find(([c]) => c === 'guardar_proveedor');
    expect((llamada?.[1] as { proveedor: { id: number } }).proveedor.id).toBe(1);
  });

  it('los campos vacíos llegan como texto vacío, no como «null»', async () => {
    const usuario = await montar();
    // El retirado no tiene ni telefono ni contacto.
    await usuario.click(screen.getAllByRole('button', { name: 'Editar' })[1] as HTMLElement);

    // Sin esto el campo mostraria la palabra «null» y el dueño la
    // guardaria sin darse cuenta.
    expect((screen.getByLabelText(/^Teléfono/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('NIT o documento') as HTMLInputElement).value).toBe('');
  });

  it('cancelar no guarda nada', async () => {
    const usuario = await montar();
    await usuario.click(screen.getAllByRole('button', { name: 'Editar' })[0] as HTMLElement);
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByText('Distribuidora Bavaria')).toBeTruthy();
    expect(pedir.mock.calls.some(([c]) => c === 'guardar_proveedor')).toBe(false);
  });
});

describe('retirar y volver a trabajar con alguien', () => {
  it('retirar no borra: se puede deshacer', async () => {
    const usuario = await montar();

    await usuario.click(
      screen.getByRole('button', { name: 'Retirar a Distribuidora Bavaria' }),
    );

    expect(pedir).toHaveBeenCalledWith('desactivar_proveedor', {
      proveedorId: 1, activo: false, usuarioId: 7, rol: 'ADMINISTRADOR',
    });
  });

  it('al retirado se le ofrece volver, no retirarlo otra vez', async () => {
    const usuario = await montar();

    await usuario.click(
      screen.getByRole('button', { name: 'Volver a trabajar con Surtimax Mayorista' }),
    );

    // Las compras viejas siguen siendo suyas: por eso se reactiva en vez
    // de crearlo de nuevo.
    expect(pedir).toHaveBeenCalledWith('desactivar_proveedor', {
      proveedorId: 2, activo: true, usuarioId: 7, rol: 'ADMINISTRADOR',
    });
  });

  it('vuelve a leer la lista después de cambiarlo', async () => {
    const usuario = await montar();
    const lecturas = () =>
      pedir.mock.calls.filter(([c]) => c === 'listar_proveedores').length;
    const antes = lecturas();

    await usuario.click(
      screen.getByRole('button', { name: 'Retirar a Distribuidora Bavaria' }),
    );

    expect(lecturas()).toBeGreaterThan(antes);
  });
});

describe('cuando el núcleo falla', () => {
  it('lo dice sin perder lo escrito', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: /Nuevo proveedor/ }));
    await usuario.type(screen.getByLabelText('Nombre'), 'La Nacional');

    pedir.mockImplementation((comando: string) => {
      if (comando === 'guardar_proveedor') {
        return Promise.reject(new Error('Ya hay un proveedor con ese nombre.'));
      }
      return nucleo([BAVARIA, RETIRADO])(comando);
    });
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value)
      .toBe('La Nacional');
  });
});
