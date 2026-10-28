// @vitest-environment jsdom
/**
 * Pruebas del cierre de caja.
 *
 * Lo que se protege aqui es el arqueo ciego: que el cajero no vea lo
 * esperado antes de contar. Si lo viera, el conteo dejaria de servir.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CierreCaja } from '@/modulos/pos/CierreCaja';
import type { ResumenCaja } from '@/modulos/pos/CierreCaja';

const resumen: ResumenCaja = {
  caja_id: 1,
  base_inicial: 100_000,
  ventas_total: 57_800,
  ventas_cantidad: 12,
  entradas: 0,
  salidas: 15_000,
  efectivo_esperado: 127_800,
  por_metodo: [
    { metodo: 'Efectivo', es_efectivo: true, total: 42_800, cantidad: 9 },
    { metodo: 'Transferencia', es_efectivo: false, total: 15_000, cantidad: 3 },
  ],
};

function montar() {
  const onCerrar = vi.fn();
  const onCancelar = vi.fn();
  render(
    <CierreCaja
      resumen={resumen}
      cerrando={false}
      error={null}
      onCerrar={onCerrar}
      onCancelar={onCancelar}
    />,
  );
  return { onCerrar, onCancelar };
}

async function contarYSeguir(usuario: ReturnType<typeof userEvent.setup>, total: string) {
  await usuario.click(screen.getByRole('button', { name: 'Escribir el total' }));
  await usuario.type(screen.getByLabelText('Total contado'), total);
  await usuario.click(screen.getByRole('button', { name: /Continuar/ }));
}

beforeEach(cleanup);

describe('arqueo ciego', () => {
  it('no muestra lo esperado antes de contar', () => {
    montar();
    expect(screen.queryByLabelText('Efectivo esperado')).not.toBeInTheDocument();
    expect(screen.queryByText('$127.800')).not.toBeInTheDocument();
  });

  it('pide contar primero y solo despues compara', async () => {
    const usuario = userEvent.setup();
    montar();
    expect(screen.getByText('Cuenta el dinero')).toBeInTheDocument();

    await contarYSeguir(usuario, '127800');
    expect(screen.getByLabelText('Efectivo esperado')).toHaveTextContent('$127.800');
  });
});

describe('conteo por billete', () => {
  it('suma las denominaciones', async () => {
    const usuario = userEvent.setup();
    montar();

    await usuario.type(screen.getByLabelText('Cantidad de $50.000'), '2');
    await usuario.type(screen.getByLabelText('Cantidad de $20.000'), '1');
    await usuario.type(screen.getByLabelText('Cantidad de $5.000'), '1');

    expect(screen.getByLabelText('Suma contada')).toHaveTextContent('$125.000');
  });
});

describe('la diferencia', () => {
  it('dice que cuadra cuando coincide', async () => {
    const usuario = userEvent.setup();
    montar();
    await contarYSeguir(usuario, '127800');

    expect(screen.getByText('Cuadra')).toBeInTheDocument();
    expect(screen.getByLabelText('Diferencia')).toHaveTextContent('$0');
  });

  it('dice cuanto falta', async () => {
    const usuario = userEvent.setup();
    montar();
    await contarYSeguir(usuario, '122800');

    expect(screen.getByText('Falta')).toBeInTheDocument();
    expect(screen.getByLabelText('Diferencia')).toHaveTextContent('$5.000');
  });

  it('dice cuanto sobra', async () => {
    const usuario = userEvent.setup();
    montar();
    await contarYSeguir(usuario, '130800');

    expect(screen.getByText('Sobra')).toBeInTheDocument();
    expect(screen.getByLabelText('Diferencia')).toHaveTextContent('$3.000');
  });
});

describe('explicar la diferencia', () => {
  it('un cierre cuadrado no pide explicacion', async () => {
    const usuario = userEvent.setup();
    const { onCerrar } = montar();
    await contarYSeguir(usuario, '127800');

    expect(screen.queryByText(/Por qué hay diferencia/)).not.toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: /Cerrar la caja/ }));
    expect(onCerrar).toHaveBeenCalledWith(127_800, null);
  });

  it('una diferencia sin explicar no deja cerrar', async () => {
    const usuario = userEvent.setup();
    montar();
    await contarYSeguir(usuario, '122800');

    expect(screen.getByText(/Por qué hay diferencia/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cerrar la caja/ })).toBeDisabled();
  });

  it('con la explicacion escrita si cierra', async () => {
    const usuario = userEvent.setup();
    const { onCerrar } = montar();
    await contarYSeguir(usuario, '122800');

    await usuario.type(
      screen.getByLabelText(/Por qué hay diferencia/),
      'se pago un domicilio sin registrar',
    );
    await usuario.click(screen.getByRole('button', { name: /Cerrar la caja/ }));

    expect(onCerrar).toHaveBeenCalledWith(122_800, 'se pago un domicilio sin registrar');
  });
});

describe('el desglose', () => {
  it('separa lo que entra al cajon de lo que no', async () => {
    const usuario = userEvent.setup();
    montar();
    await contarYSeguir(usuario, '127800');

    expect(screen.getByText(/Ventas en transferencia/)).toBeInTheDocument();
    expect(screen.getByText(/no entra al cajón/)).toBeInTheDocument();
  });

  it('muestra las salidas en negativo', async () => {
    const usuario = userEvent.setup();
    montar();
    await contarYSeguir(usuario, '127800');
    expect(screen.getByText('−$15.000')).toBeInTheDocument();
  });
});

describe('volver atras', () => {
  it('se puede volver a contar', async () => {
    const usuario = userEvent.setup();
    montar();
    await contarYSeguir(usuario, '100000');
    await usuario.click(screen.getByRole('button', { name: /Volver a contar/ }));
    expect(screen.getByText('Cuenta el dinero')).toBeInTheDocument();
  });
});
