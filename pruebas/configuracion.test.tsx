// @vitest-environment jsdom
/**
 * Los ajustes del negocio.
 *
 * Lo que se protege aqui es que un ajuste haga lo que promete. La
 * pantalla ofrece «minutos para bloquear la sesion» y «stock minimo para
 * los productos nuevos»: los dos se guardaban y ninguno se leia, asi que
 * eran decoracion. Tambien se protege que no se pueda dejar el negocio
 * sin nombre —sale en cada recibo— ni poner ceros donde el cero rompe lo
 * que el ajuste ofrece.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Configuracion, comoSeLee } from '@/modulos/configuracion/Configuracion';

const pedir = vi.hoisted(() => vi.fn());
const recargarAjustes = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/nucleo/puente', () => ({
  pedir,
  mensajeDeError: (causa: unknown) => String(causa),
}));

const SESION = vi.hoisted(() => ({
  usuario: { id: 7, nombre: 'Camilo', rol: 'ADMINISTRADOR' },
  puede: () => true,
  recargarAjustes,
  stockMinimoDefecto: 3,
}));

vi.mock('@/nucleo/sesion', () => ({ useSesion: () => SESION }));

const AJUSTES = [
  { clave: 'negocio.nombre', valor: 'Licorera Demo' },
  { clave: 'negocio.nit', valor: '900.123.456-7' },
  { clave: 'negocio.direccion', valor: 'Carrera 30 #8-15' },
  { clave: 'negocio.telefono', valor: '318 555 0142' },
  { clave: 'inventario.stock_minimo_defecto', valor: '6' },
  { clave: 'sesion.minutos_inactividad', valor: '15' },
  { clave: 'respaldo.dias_alerta', valor: '3' },
  { clave: 'venta.recargos_sugeridos', valor: 'Domicilio' },
  { clave: 'impuesto.nombre', valor: 'IVA' },
  { clave: 'impuesto.activo', valor: '0' },
  { clave: 'impuesto.porcentaje', valor: '0' },
];

function nucleo(lista: readonly unknown[] = AJUSTES) {
  return (comando: string) => {
    if (comando === 'leer_configuracion') return Promise.resolve(lista);
    return Promise.resolve(undefined);
  };
}

async function montar(lista: readonly unknown[] = AJUSTES) {
  pedir.mockImplementation(nucleo(lista));
  render(<Configuracion />);
  await screen.findByLabelText('Nombre del negocio');
  return userEvent.setup();
}

/** El botón de guardar, se llame como se llame en ese momento. */
function guardar(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Guardar cambios|Guardando/ }) as HTMLButtonElement;
}

/** Reemplaza lo que hay escrito en un campo. */
async function escribir(
  usuario: ReturnType<typeof userEvent.setup>,
  etiqueta: string,
  texto: string,
) {
  const campo = screen.getByLabelText(etiqueta);
  await usuario.clear(campo);
  if (texto !== '') await usuario.type(campo, texto);
}

beforeEach(() => {
  cleanup();
  pedir.mockReset();
  recargarAjustes.mockClear();
});

afterEach(cleanup);

describe('lo que no se puede guardar', () => {
  it('el negocio no se queda sin nombre', async () => {
    const usuario = await montar();
    await escribir(usuario, 'Nombre del negocio', '   ');

    // Sale en cada recibo: un recibo sin encabezado no dice de quien es.
    expect(guardar().disabled).toBe(true);
    expect(screen.getByText(/Ponle nombre al negocio/)).toBeTruthy();
  });

  it('cero minutos no bloquea el mostrador a cada rato', async () => {
    const usuario = await montar();
    await escribir(usuario, 'Minutos para bloquear la sesión', '0');

    expect(guardar().disabled).toBe(true);
    expect(screen.getByText(/Minutos para bloquear la sesión.*mayor que cero/)).toBeTruthy();
  });

  it('tampoco un stock mínimo negativo', async () => {
    const usuario = await montar();
    await escribir(usuario, 'Stock mínimo sugerido', '-5');

    expect(guardar().disabled).toBe(true);
  });

  it('ni días sin respaldo en cero', async () => {
    const usuario = await montar();
    await escribir(usuario, 'Días sin respaldo antes de avisar', '0');

    expect(guardar().disabled).toBe(true);
  });

  it('un impuesto encendido necesita porcentaje y nombre', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByRole('checkbox'));

    // Encenderlo con el porcentaje en cero pondria una linea de impuesto
    // que siempre dice cero.
    expect(guardar().disabled).toBe(true);
    expect(screen.getByText(/entre 1 y 99/)).toBeTruthy();

    await escribir(usuario, 'Porcentaje', '19');
    expect(guardar().disabled).toBe(false);

    await escribir(usuario, 'Cómo se llama', '');
    expect(guardar().disabled).toBe(true);
  });
});

describe('guardar', () => {
  it('manda todos los ajustes con quien los cambió', async () => {
    const usuario = await montar();
    await escribir(usuario, 'Nombre del negocio', 'Tienda Doña Marta');
    await usuario.click(guardar());

    const llamada = pedir.mock.calls.find(([c]) => c === 'guardar_configuracion');
    const enviado = (llamada?.[1] as { cambios: { clave: string; valor: string }[] }).cambios;
    expect(enviado.find((c) => c.clave === 'negocio.nombre')?.valor)
      .toBe('Tienda Doña Marta');
    expect(llamada?.[1]).toMatchObject({ usuarioId: 7, rol: 'ADMINISTRADOR' });
  });

  it('vuelve a leer los ajustes para que rijan sin reiniciar', async () => {
    const usuario = await montar();
    await escribir(usuario, 'Minutos para bloquear la sesión', '5');
    await usuario.click(guardar());

    // Sin esto el nombre nuevo seguiria saliendo viejo en la barra y el
    // bloqueo seguiria en los minutos de antes hasta cerrar la app.
    expect(recargarAjustes).toHaveBeenCalled();
    expect(await screen.findByText('Guardado')).toBeTruthy();
  });

  it('si el núcleo falla lo dice y no canta victoria', async () => {
    const usuario = await montar();

    pedir.mockImplementation((comando: string) => {
      if (comando === 'guardar_configuracion') {
        return Promise.reject(new Error('La base está ocupada.'));
      }
      return nucleo()(comando);
    });
    await usuario.click(guardar());

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Guardado')).toBeNull();
    expect(recargarAjustes).not.toHaveBeenCalled();
  });
});

describe('la auditoría, en español', () => {
  it('traduce el código con que se guarda cada acción', () => {
    // El registro se guarda con códigos porque son estables; el dueño
    // no tiene por qué leer «CAMBIAR_CONTRASENA».
    expect(comoSeLee('CAMBIAR_CONTRASENA')).toBe('Cambió una contraseña');
    expect(comoSeLee('REGISTRAR_COMPRA')).toBe('Registró una compra');
    expect(comoSeLee('ABRIR_CAJA')).toBe('Abrió la caja');
  });

  it('una acción que nadie tradujo igual se lee', () => {
    // Al agregar una acción nueva en el núcleo, lo peor que puede pasar
    // es que salga sin guiones bajos y no a gritos.
    expect(comoSeLee('DEVOLVER_MERCANCIA')).toBe('Devolver mercancia');
    expect(comoSeLee('ALGO')).toBe('Algo');
  });
});
