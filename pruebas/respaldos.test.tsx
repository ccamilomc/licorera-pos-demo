// @vitest-environment jsdom
/**
 * Copias de seguridad.
 *
 * Restaurar es la unica accion del programa que reemplaza datos buenos por
 * otros mas viejos, asi que lo que se protege aqui es que no se dispare
 * sola: que exija la palabra escrita, que no se ofrezca sobre una copia
 * que ya se sabe dañada y que solo la vea quien tiene el permiso.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Respaldos } from '@/modulos/configuracion/Respaldos';

const pedir = vi.hoisted(() => vi.fn());
const permisos = vi.hoisted(() => ({ negados: [] as string[] }));

vi.mock('@/nucleo/puente', () => ({
  pedir,
  mensajeDeError: (causa: unknown) => String(causa),
}));

const SESION = vi.hoisted(() => ({
  usuario: { id: 1, nombre: 'Camilo', rol: 'ADMINISTRADOR' },
  puede: (permiso: string) => !permisos.negados.includes(permiso),
}));

vi.mock('@/nucleo/sesion', () => ({ useSesion: () => SESION }));

const COPIA = {
  archivo: 'tribuna-2026-08-20-1430.db',
  ruta: 'C:/respaldos/tribuna-2026-08-20-1430.db',
  tamano_bytes: 2_411_724,
  creado: '2026-08-20T14:30:00',
  verificado: true,
};

const ANTES_DE = {
  ...COPIA,
  archivo: 'antes-de-restaurar-2026-08-21.db',
  ruta: 'C:/respaldos/antes-de-restaurar-2026-08-21.db',
};

const AL_DIA = {
  total: 3,
  ultimo: COPIA,
  dias_sin_respaldo: 0,
  necesita_respaldo: false,
  carpeta: 'C:/Users/Camilo/AppData/Roaming/PuntoDeVenta/respaldos',
};

/** Responde a los comandos de la pantalla con los datos indicados. */
function nucleo(resumen: Record<string, unknown>, lista: readonly unknown[]) {
  return (comando: string) => {
    if (comando === 'estado_respaldos') return Promise.resolve(resumen);
    if (comando === 'listar_respaldos') return Promise.resolve(lista);
    if (comando === 'verificar_respaldo') return Promise.resolve(true);
    if (comando === 'crear_respaldo') return Promise.resolve(COPIA);
    return Promise.resolve(undefined);
  };
}

async function montar(
  resumen: Record<string, unknown> = AL_DIA,
  lista: readonly unknown[] = [COPIA],
) {
  pedir.mockImplementation(nucleo(resumen, lista));
  render(<Respaldos />);
  await screen.findByText(/Las copias se guardan en/);
  return userEvent.setup();
}

beforeEach(() => {
  cleanup();
  permisos.negados = [];
  pedir.mockReset();
});

afterEach(cleanup);

describe('la insistencia en respaldar', () => {
  it('avisa distinto si nunca se hizo una copia que si hace días', async () => {
    await montar({ ...AL_DIA, total: 0, ultimo: null, necesita_respaldo: true }, []);
    expect(screen.getByText(/Nunca has hecho una copia/)).toBeTruthy();

    cleanup();
    await montar({ ...AL_DIA, dias_sin_respaldo: 9, necesita_respaldo: true });
    expect(screen.getByText(/Hace 9 días que no haces una copia/)).toBeTruthy();
  });

  it('no molesta cuando la copia está al día', async () => {
    await montar();

    expect(screen.queryByText(/Nunca has hecho/)).toBeNull();
    expect(screen.queryByText(/que no haces una copia/)).toBeNull();
  });

  it('recuerda que una copia en el mismo disco no salva del disco dañado', async () => {
    await montar();

    expect(screen.getByText(/una copia en el mismo disco/)).toBeTruthy();
  });
});

describe('hacer una copia', () => {
  it('avisa con el nombre del archivo que quedó', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: /Hacer una copia/ }));

    // El nombre tambien esta en la tabla: aqui interesa el del aviso.
    const aviso = await screen.findByText(/Copia creada y verificada/);
    expect(aviso.textContent).toContain(COPIA.archivo);
  });

  it('vuelve a leer la lista, porque acaba de agregarle una', async () => {
    const usuario = await montar();
    const lecturas = () =>
      pedir.mock.calls.filter(([c]) => c === 'listar_respaldos').length;
    const antes = lecturas();

    await usuario.click(screen.getByRole('button', { name: /Hacer una copia/ }));
    await screen.findByText(/Copia creada/);

    expect(lecturas()).toBeGreaterThan(antes);
  });

  it('muestra el error si el núcleo no la pudo hacer', async () => {
    const usuario = await montar();
    pedir.mockImplementation((comando: string) => {
      if (comando === 'crear_respaldo') {
        return Promise.reject(new Error('No hay espacio en el disco.'));
      }
      return nucleo(AL_DIA, [COPIA])(comando);
    });

    await usuario.click(screen.getByRole('button', { name: /Hacer una copia/ }));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('comprobar una copia', () => {
  it('dice si sirve o si está dañada', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Comprobar' }));

    expect(await screen.findByText('sirve')).toBeTruthy();

    cleanup();
    pedir.mockImplementation((comando: string) => {
      if (comando === 'verificar_respaldo') return Promise.resolve(false);
      return nucleo(AL_DIA, [COPIA])(comando);
    });
    render(<Respaldos />);
    const otro = userEvent.setup();
    await otro.click(await screen.findByRole('button', { name: 'Comprobar' }));

    expect(await screen.findByText('dañada')).toBeTruthy();
  });

  it('no deja restaurar una copia que se comprobó dañada', async () => {
    pedir.mockImplementation((comando: string) => {
      if (comando === 'verificar_respaldo') return Promise.resolve(false);
      return nucleo(AL_DIA, [COPIA])(comando);
    });
    render(<Respaldos />);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Comprobar' }));
    await screen.findByText('dañada');

    expect(screen.getByRole('button', { name: 'Restaurar' }).hasAttribute('disabled'))
      .toBe(true);
  });
});

describe('restaurar', () => {
  it('solo se lo ofrece a quien tiene el permiso', async () => {
    permisos.negados = ['respaldo.restaurar'];
    await montar();

    expect(screen.queryByRole('button', { name: 'Restaurar' })).toBeNull();
    // Comprobar si lo puede hacer cualquiera: no cambia nada.
    expect(screen.getByRole('button', { name: 'Comprobar' })).toBeTruthy();
  });

  it('no restaura hasta que se escriba la palabra completa', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Restaurar' }));

    const confirmar = screen.getByRole('button', { name: /Restaurar esta copia/ });
    expect(confirmar.hasAttribute('disabled')).toBe(true);

    const campo = screen.getByRole('textbox');
    await usuario.type(campo, 'RESTAUR');
    expect(confirmar.hasAttribute('disabled')).toBe(true);

    await usuario.type(campo, 'AR');
    expect(confirmar.hasAttribute('disabled')).toBe(false);
  });

  it('acepta la palabra en minúsculas, que igual hubo que escribirla', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Restaurar' }));
    await usuario.type(screen.getByRole('textbox'), 'restaurar');

    expect(screen.getByRole('button', { name: /Restaurar esta copia/ })
      .hasAttribute('disabled')).toBe(false);
  });

  it('dice de cuándo es la copia y que lo de después se pierde de vista', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Restaurar' }));

    expect(screen.getByText(/Todo lo que se haya\s+registrado después/)).toBeTruthy();
    expect(screen.getByText(/se guarda automáticamente una copia de lo que hay ahora/))
      .toBeTruthy();
  });

  it('manda la ruta de la copia elegida y pide reabrir el programa', async () => {
    const usuario = await montar(AL_DIA, [COPIA, ANTES_DE]);

    // La segunda de la lista, para que no valga acertar por casualidad.
    const filas = screen.getAllByRole('row');
    await usuario.click(
      within(filas[2] as HTMLElement).getByRole('button', { name: 'Restaurar' }),
    );
    await usuario.type(screen.getByRole('textbox'), 'RESTAURAR');
    await usuario.click(screen.getByRole('button', { name: /Restaurar esta copia/ }));

    expect(pedir).toHaveBeenCalledWith('restaurar_respaldo', {
      ruta: ANTES_DE.ruta, rol: 'ADMINISTRADOR',
    });
    expect(await screen.findByText(/Cierra y vuelve a abrir el programa/)).toBeTruthy();
  });

  it('cancelar cierra el aviso sin tocar nada', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('button', { name: 'Restaurar' }));
    await usuario.type(screen.getByRole('textbox'), 'RESTAURAR');
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(pedir.mock.calls.some(([c]) => c === 'restaurar_respaldo')).toBe(false);
  });

  it('al cambiar de copia hay que volver a escribir la palabra', async () => {
    const usuario = await montar(AL_DIA, [COPIA, ANTES_DE]);
    const restaurar = (fila: number) =>
      within(screen.getAllByRole('row')[fila] as HTMLElement)
        .getByRole('button', { name: 'Restaurar' });

    await usuario.click(restaurar(1));
    await usuario.type(screen.getByRole('textbox'), 'RESTAURAR');

    // Se cambia de opinion y se elige la otra copia. Si lo escrito
    // sobreviviera, el boton quedaria armado sobre una copia que nadie
    // confirmo: un clic de distancia de restaurar la equivocada.
    await usuario.click(restaurar(2));

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /Restaurar esta copia/ })
      .hasAttribute('disabled')).toBe(true);
  });
});

describe('la lista de copias', () => {
  it('distingue la copia que el propio programa guardó antes de restaurar', async () => {
    await montar(AL_DIA, [COPIA, ANTES_DE]);

    const filas = screen.getAllByRole('row');
    expect(within(filas[1] as HTMLElement).queryByText('de seguridad')).toBeNull();
    expect(within(filas[2] as HTMLElement).getByText('de seguridad')).toBeTruthy();
  });

  it('escribe el tamaño en la unidad que se lee de un vistazo', async () => {
    await montar(AL_DIA, [
      { ...COPIA, ruta: 'a', tamano_bytes: 800 },
      { ...COPIA, ruta: 'b', tamano_bytes: 40_960 },
      { ...COPIA, ruta: 'c', tamano_bytes: 2_411_724 },
    ]);

    expect(screen.getByText('800 B')).toBeTruthy();
    expect(screen.getByText('40 KB')).toBeTruthy();
    expect(screen.getByText('2.3 MB')).toBeTruthy();
  });

  it('lo dice cuando todavía no hay ninguna', async () => {
    await montar({ ...AL_DIA, total: 0, ultimo: null }, []);

    expect(screen.getByText(/Todavía no hay ninguna copia/)).toBeTruthy();
  });
});
