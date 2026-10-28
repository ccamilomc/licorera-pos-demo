// @vitest-environment jsdom
/**
 * La pantalla de créditos.
 *
 * Es donde se ve la plata que esta afuera, de los dos lados. Lo que se
 * protege aqui es que no se pueda mover plata a ciegas: que un abono diga
 * si entra al cajon o no, que no se pueda abonar cero, y que buscar filtre
 * la lista sin tocar los totales -- si al buscar «jairo» el encabezado
 * dijera 54.000, se leeria como que eso es todo lo que hay afuera.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Creditos } from '@/modulos/creditos/Creditos';

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

const CLIENTES = [
  {
    id: 1, nombre: 'Don Jairo', telefono: '3104567890', cupo: 0, activo: true,
    fiado: 64_000, abonado: 10_000, saldo: 54_000, cuentas: 2,
  },
  {
    id: 2, nombre: 'la señora del 302', telefono: null, cupo: 100_000, activo: true,
    fiado: 47_800, abonado: 0, saldo: 47_800, cuentas: 1,
  },
  // Ya pagó: no debe salir en la lista.
  {
    id: 3, nombre: 'Ana', telefono: null, cupo: 0, activo: true,
    fiado: 20_000, abonado: 20_000, saldo: 0, cuentas: 1,
  },
];

const CUENTAS = [
  {
    id: 10, venta_id: 120, venta_numero: 120, fecha: '2026-08-15 19:24',
    monto: 39_000, abonado: 0, saldo: 39_000,
  },
  {
    id: 11, venta_id: 124, venta_numero: 124, fecha: '2026-08-19 19:24',
    monto: 25_000, abonado: 10_000, saldo: 15_000,
  },
];

const DEUDAS = [
  {
    compra_id: 1, numero: 'C-00045', proveedor: 'Distribuidora Bavaria',
    documento: 'F-8891', fecha: '2026-08-18', vence: '2026-08-20',
    total: 640_000, pagado: 200_000, saldo: 440_000, vencida_hace: 1,
  },
  {
    compra_id: 2, numero: 'C-00046', proveedor: 'Surtimax Mayorista',
    documento: null, fecha: '2026-08-20', vence: '2026-08-26',
    total: 320_000, pagado: 0, saldo: 320_000, vencida_hace: -5,
  },
];

const METODOS = [
  { id: 1, codigo: 'EFECTIVO', nombre: 'Efectivo', es_efectivo: true },
  { id: 2, codigo: 'TRANSFERENCIA', nombre: 'Transferencia', es_efectivo: false },
  { id: 4, codigo: 'FIADO', nombre: 'Fiado', es_efectivo: false },
];

function nucleo(comando: string) {
  if (comando === 'clientes_con_saldo') return Promise.resolve(CLIENTES);
  if (comando === 'compras_por_pagar') return Promise.resolve(DEUDAS);
  if (comando === 'metodos_de_pago') return Promise.resolve(METODOS);
  if (comando === 'saldos_por_proveedor') {
    return Promise.resolve([
      { proveedor_id: 1, nombre: 'Distribuidora Bavaria', saldo: 440_000, compras: 1 },
      { proveedor_id: 2, nombre: 'Surtimax Mayorista', saldo: 320_000, compras: 1 },
    ]);
  }
  if (comando === 'cuentas_del_cliente') return Promise.resolve(CUENTAS);
  if (comando === 'abonos_de_cuenta') {
    return Promise.resolve([{
      id: 50, cuenta_id: 11, fecha: '2026-08-20 10:00', monto: 10_000,
      metodo: 'Efectivo', usuario: 'Camilo', nota: null, anulado: false,
    }]);
  }
  if (comando === 'pagos_de_compra') {
    return Promise.resolve([{
      id: 60, compra_id: 1, fecha: '2026-08-19', monto: 200_000,
      metodo: 'Efectivo', usuario: 'Camilo', nota: null, anulado: false,
    }]);
  }
  if (comando === 'abonar') {
    return Promise.resolve({ abono_id: 1, saldo_cuenta: 0, saldo_cliente: 15_000, entro_a_caja: true });
  }
  return Promise.resolve(undefined);
}

async function montar() {
  pedir.mockImplementation(nucleo);
  render(<Creditos />);
  await screen.findByText('Don Jairo');
  return userEvent.setup();
}

/** Pasa a la pestaña de proveedores. */
async function verDeudas(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(screen.getByRole('tab', { name: /le debo/ }));
  await screen.findByRole('table');
}

/**
 * La fila de una compra.
 *
 * Por la tabla y no por `getByText`: el nombre del proveedor sale también
 * en el resumen de arriba, y ahí habría dos coincidencias.
 */
function filaDe(proveedor: string): HTMLElement {
  const tabla = screen.getByRole('table');
  const fila = within(tabla).getByText(proveedor).closest('tr');
  return fila as HTMLElement;
}

beforeEach(() => {
  cleanup();
  permisos.negados = [];
  pedir.mockReset();
});

afterEach(cleanup);

describe('lo que se ve al entrar', () => {
  it('muestra los dos lados con su total', async () => {
    await montar();

    expect(screen.getByRole('tab', { name: /Me deben/ }).textContent)
      .toContain('$101.800');
    expect(screen.getByRole('tab', { name: /le debo/ }).textContent)
      .toContain('$760.000');
  });

  it('no lista a quien ya pagó', async () => {
    await montar();

    expect(screen.getByText('Don Jairo')).toBeTruthy();
    // Ana debía y ya abonó todo: sacarla es el punto de la lista.
    expect(screen.queryByText('Ana')).toBeNull();
  });

  it('dice de cada quien cuántas ventas fiadas tiene y cuánto ha abonado', async () => {
    await montar();

    const fila = screen.getByText('Don Jairo').closest('button');
    expect(fila?.textContent).toContain('2 ventas fiadas');
    expect(fila?.textContent).toContain('ha abonado $10.000');
    expect(fila?.textContent).toContain('$54.000');
  });

  it('muestra el cupo de quien lo tiene', async () => {
    await montar();

    const fila = screen.getByText('la señora del 302').closest('button');
    expect(fila?.textContent).toContain('cupo $100.000');
  });

  it('a quien no registra compras no le ofrece el lado de proveedores', async () => {
    permisos.negados = ['compra.registrar'];
    await montar();

    expect(screen.queryByRole('tab', { name: /le debo/ })).toBeNull();
  });
});

describe('buscar', () => {
  it('filtra los deudores sin tildes ni mayúsculas', async () => {
    const usuario = await montar();
    await usuario.type(screen.getByLabelText('Buscar'), 'SENORA');

    expect(screen.getByText('la señora del 302')).toBeTruthy();
    expect(screen.queryByText('Don Jairo')).toBeNull();
  });

  it('no toca los totales de arriba', async () => {
    const usuario = await montar();
    await usuario.type(screen.getByLabelText('Buscar'), 'jairo');

    // Si dijera 54.000 se leería como que eso es todo lo que hay afuera.
    expect(screen.getByRole('tab', { name: /Me deben/ }).textContent)
      .toContain('$101.800');
  });

  it('distingue «no hay nada» de «no encontré eso»', async () => {
    const usuario = await montar();
    await usuario.type(screen.getByLabelText('Buscar'), 'pedro');

    expect(screen.getByText(/Nadie que se llame «pedro» debe algo/)).toBeTruthy();
    expect(screen.queryByText(/Todo cobrado/)).toBeNull();
  });

  it('del lado de proveedores busca por nombre y por número de compra', async () => {
    const usuario = await montar();
    await verDeudas(usuario);

    await usuario.type(screen.getByLabelText('Buscar'), 'surtimax');
    let tabla = screen.getByRole('table');
    expect(within(tabla).getByText('Surtimax Mayorista')).toBeTruthy();
    expect(within(tabla).queryByText('Distribuidora Bavaria')).toBeNull();

    await usuario.clear(screen.getByLabelText('Buscar'));
    await usuario.type(screen.getByLabelText('Buscar'), 'C-00045');
    tabla = screen.getByRole('table');
    expect(within(tabla).getByText('Distribuidora Bavaria')).toBeTruthy();
    expect(within(tabla).queryByText('Surtimax Mayorista')).toBeNull();
  });

  it('se puede limpiar de un toque', async () => {
    const usuario = await montar();
    await usuario.type(screen.getByLabelText('Buscar'), 'jairo');
    expect(screen.queryByText('la señora del 302')).toBeNull();

    await usuario.click(screen.getByRole('button', { name: 'Limpiar la búsqueda' }));

    expect(screen.getByText('la señora del 302')).toBeTruthy();
  });
});

describe('recibir un abono', () => {
  /** Abre a Don Jairo y pide recibirle un abono. */
  async function pedirAbono(usuario: ReturnType<typeof userEvent.setup>) {
    await usuario.click(screen.getByText('Don Jairo'));
    await screen.findAllByRole('button', { name: 'Recibir abono' });
    const botones = screen.getAllByRole('button', { name: 'Recibir abono' });
    await usuario.click(botones[0] as HTMLElement);
  }

  it('dice de qué venta es y cuánto se debe', async () => {
    const usuario = await montar();
    await pedirAbono(usuario);

    expect(screen.getByText(/Abono de Don Jairo/)).toBeTruthy();
    expect(screen.getByText(/Debe \$39\.000 de la venta #120/)).toBeTruthy();
  });

  it('«Todo» llena el saldo de esa venta', async () => {
    const usuario = await montar();
    await pedirAbono(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Todo' }));

    expect((screen.getByLabelText('Cuánto') as HTMLInputElement).value).toBe('39000');
  });

  it('no deja recibir cero', async () => {
    const usuario = await montar();
    await pedirAbono(usuario);

    const confirmar = screen.getByRole('button', { name: 'Recibir el abono' });
    expect(confirmar.hasAttribute('disabled')).toBe(true);

    await usuario.type(screen.getByLabelText('Cuánto'), '20000');
    expect(confirmar.hasAttribute('disabled')).toBe(false);
  });

  it('avisa si esa plata entra al cajón o no', async () => {
    const usuario = await montar();
    await pedirAbono(usuario);

    // En efectivo, que es lo que viene marcado.
    expect(screen.getByText(/entra a la caja abierta/)).toBeTruthy();

    await usuario.click(screen.getByRole('button', { name: 'Transferencia' }));
    expect(screen.getByText(/no pasa por la caja/i)).toBeTruthy();
  });

  it('manda la cuenta, el monto y la forma de pago', async () => {
    const usuario = await montar();
    await pedirAbono(usuario);
    await usuario.type(screen.getByLabelText('Cuánto'), '20000');
    await usuario.click(screen.getByRole('button', { name: 'Recibir el abono' }));

    expect(pedir).toHaveBeenCalledWith('abonar', {
      cuentaId: 10,
      monto: 20_000,
      metodoPagoId: 1,
      usuarioId: 7,
      nota: null,
      rol: 'ADMINISTRADOR',
    });
  });

  it('después dice cuánto le queda debiendo', async () => {
    const usuario = await montar();
    await pedirAbono(usuario);
    await usuario.type(screen.getByLabelText('Cuánto'), '20000');
    await usuario.click(screen.getByRole('button', { name: 'Recibir el abono' }));

    const aviso = await screen.findByText(/Abono de \$20\.000 de Don Jairo/);
    expect(aviso.textContent).toContain('Le quedan debiendo $15.000');
    expect(aviso.textContent).toContain('Entró a la caja');
  });

  it('no ofrece fiado como forma de pagar un fiado', async () => {
    const usuario = await montar();
    await pedirAbono(usuario);

    expect(screen.getByRole('button', { name: 'Efectivo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fiado' })).toBeNull();
  });

  it('si el núcleo lo rechaza, lo dice', async () => {
    const usuario = await montar();
    await pedirAbono(usuario);
    await usuario.type(screen.getByLabelText('Cuánto'), '90000');

    pedir.mockImplementation((comando: string) => {
      if (comando === 'abonar') {
        return Promise.reject(new Error('De esa venta solo deben $39000.'));
      }
      return nucleo(comando);
    });
    await usuario.click(screen.getByRole('button', { name: 'Recibir el abono' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('los abonos ya hechos', () => {
  it('solo se ofrecen donde hubo alguno', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByText('Don Jairo'));
    await screen.findAllByRole('button', { name: 'Recibir abono' });

    // La venta 120 no tiene abonos; la 124 sí.
    expect(screen.getAllByRole('button', { name: 'Ver abonos' })).toHaveLength(1);
  });

  it('se pueden anular y la plata vuelve al cajón', async () => {
    const usuario = await montar();
    await usuario.click(screen.getByText('Don Jairo'));
    await usuario.click(await screen.findByRole('button', { name: 'Ver abonos' }));

    await usuario.click(
      await screen.findByRole('button', { name: /Anular el abono de \$10\.000/ }),
    );

    expect(pedir.mock.calls.some(([c]) => c === 'anular_abono')).toBe(true);
    expect(await screen.findByText(/La plata volvió al cajón/)).toBeTruthy();
  });

  it('a quien no puede anular ventas no se le ofrece', async () => {
    permisos.negados = ['venta.anular'];
    const usuario = await montar();
    await usuario.click(screen.getByText('Don Jairo'));
    await usuario.click(await screen.findByRole('button', { name: 'Ver abonos' }));

    expect(screen.queryByRole('button', { name: /Anular el abono/ })).toBeNull();
  });
});

describe('a quién le debo', () => {
  it('marca en rojo lo vencido y dice cuántos días lleva', async () => {
    const usuario = await montar();
    await verDeudas(usuario);

    expect(within(filaDe('Distribuidora Bavaria')).getByText(/vencida hace 1 día/))
      .toBeTruthy();
  });

  it('dice cuánto falta para lo que todavía no vence', async () => {
    const usuario = await montar();
    await verDeudas(usuario);

    expect(within(filaDe('Surtimax Mayorista')).getByText(/faltan 5 días/)).toBeTruthy();
  });

  it('muestra lo ya abonado de cada compra', async () => {
    const usuario = await montar();
    await verDeudas(usuario);

    const fila = filaDe('Distribuidora Bavaria');
    expect(fila.textContent).toContain('abonado $200.000 de $640.000');
    expect(fila.textContent).toContain('$440.000');
  });

  it('resume cuánto se le debe a cada proveedor', async () => {
    const usuario = await montar();
    await verDeudas(usuario);

    const resumen = screen.getAllByRole('listitem')
      .map((l) => l.textContent ?? '')
      .filter((t) => t.includes('en 1 compra'));
    expect(resumen).toHaveLength(2);
  });

  it('pagar manda la compra, el monto y la fecha de hoy', async () => {
    const usuario = await montar();
    await verDeudas(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Pagar la compra C-00045' }));
    await usuario.type(screen.getByLabelText('Cuánto'), '140000');
    await usuario.click(screen.getByRole('button', { name: 'Registrar el pago' }));

    const llamada = pedir.mock.calls.find(([c]) => c === 'pagar_compra');
    expect((llamada?.[1] as { pago: { compra_id: number; monto: number } }).pago)
      .toMatchObject({ compra_id: 1, monto: 140_000 });
  });

  it('avisa que el efectivo sale del cajón', async () => {
    const usuario = await montar();
    await verDeudas(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Pagar la compra C-00045' }));

    expect(screen.getByText(/sale de la caja abierta/)).toBeTruthy();
  });

  it('los pagos hechos se ven y se pueden anular', async () => {
    const usuario = await montar();
    await verDeudas(usuario);
    await usuario.click(
      screen.getByRole('button', { name: 'Ver los pagos de la compra C-00045' }),
    );

    await usuario.click(
      await screen.findByRole('button', { name: /Anular el pago de \$200\.000/ }),
    );

    expect(pedir.mock.calls.some(([c]) => c === 'anular_pago_compra')).toBe(true);
  });
});
