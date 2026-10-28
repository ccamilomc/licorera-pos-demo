// @vitest-environment jsdom
/**
 * Pruebas del cobro. Aqui es donde se calcula el vuelto, asi que se
 * prueba con los billetes que se usan de verdad en el local.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DialogoCobro } from '@/modulos/pos/DialogoCobro';
import type { PagoElegido } from '@/modulos/pos/DialogoCobro';

const metodos = [
  { id: 1, codigo: 'EFECTIVO', nombre: 'Efectivo', es_efectivo: true },
  { id: 2, codigo: 'TRANSFERENCIA', nombre: 'Transferencia', es_efectivo: false },
  { id: 4, codigo: 'FIADO', nombre: 'Fiado', es_efectivo: false },
];

function montar(total: number) {
  const onConfirmar = vi.fn();
  const onCancelar = vi.fn();
  render(
    <DialogoCobro
      total={total}
      metodos={metodos}
      cobrando={false}
      error={null}
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
    />,
  );
  return { onConfirmar, onCancelar };
}

beforeEach(cleanup);

describe('el caso de todos los dias', () => {
  it('con el monto justo se confirma sin escribir nada', async () => {
    const usuario = userEvent.setup();
    const { onConfirmar } = montar(25_000);
    await usuario.click(screen.getByRole('button', { name: /Confirmar/ }));

    const pagos = onConfirmar.mock.calls[0]![0] as PagoElegido[];
    expect(pagos).toEqual([{ metodo_pago_id: 1, monto: 25_000, recibido: null }]);
  });

  it('arranca en efectivo, que es lo que mas se usa', () => {
    montar(25_000);
    expect(screen.getByRole('button', { name: 'Efectivo' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('el campo del monto recibe el foco al abrir', () => {
    montar(25_000);
    expect(screen.getByLabelText(/Con cuánto paga/)).toHaveFocus();
  });
});

describe('el vuelto', () => {
  it('se calcula bien', async () => {
    const usuario = userEvent.setup();
    montar(25_000);
    await usuario.type(screen.getByLabelText(/Con cuánto paga/), '50000');
    expect(screen.getByLabelText('Vuelto')).toHaveTextContent('$25.000');
  });

  it('es cero cuando paga justo', async () => {
    const usuario = userEvent.setup();
    montar(25_000);
    await usuario.type(screen.getByLabelText(/Con cuánto paga/), '25000');
    expect(screen.getByLabelText('Vuelto')).toHaveTextContent('$0');
  });

  it('avisa si el dinero no alcanza y no deja confirmar', async () => {
    const usuario = userEvent.setup();
    montar(25_000);
    await usuario.type(screen.getByLabelText(/Con cuánto paga/), '20000');

    expect(screen.getByLabelText('Falta')).toHaveTextContent('$5.000');
    expect(screen.getByRole('button', { name: /Confirmar/ })).toBeDisabled();
  });

  it('los botones de billete llenan el monto', async () => {
    const usuario = userEvent.setup();
    montar(25_000);
    await usuario.click(screen.getByRole('button', { name: '$50.000' }));
    expect(screen.getByLabelText('Vuelto')).toHaveTextContent('$25.000');
  });

  it('solo ofrece billetes que alcanzan', () => {
    montar(25_000);
    expect(screen.queryByRole('button', { name: '$10.000' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '$50.000' })).toBeInTheDocument();
  });

  it('el campo ignora letras', async () => {
    const usuario = userEvent.setup();
    montar(25_000);
    const campo = screen.getByLabelText(/Con cuánto paga/);
    await usuario.type(campo, 'ab50c000');
    expect(campo).toHaveValue('50000');
  });
});

describe('otras formas de pago', () => {
  it('la transferencia no pregunta por el vuelto', async () => {
    const usuario = userEvent.setup();
    montar(25_000);
    await usuario.click(screen.getByRole('button', { name: 'Transferencia' }));
    expect(screen.queryByLabelText(/Con cuánto paga/)).not.toBeInTheDocument();
  });

  it('la transferencia se registra sin monto recibido', async () => {
    const usuario = userEvent.setup();
    const { onConfirmar } = montar(25_000);
    await usuario.click(screen.getByRole('button', { name: 'Transferencia' }));
    await usuario.click(screen.getByRole('button', { name: /Confirmar/ }));

    const pagos = onConfirmar.mock.calls[0]![0] as PagoElegido[];
    expect(pagos[0]).toMatchObject({ metodo_pago_id: 2, recibido: null });
  });
});

describe('salir sin cobrar', () => {
  it('el boton de volver cancela', async () => {
    const usuario = userEvent.setup();
    const { onCancelar, onConfirmar } = montar(25_000);
    await usuario.click(screen.getByRole('button', { name: /Volver/ }));
    expect(onCancelar).toHaveBeenCalled();
    expect(onConfirmar).not.toHaveBeenCalled();
  });
});

describe('cobrar algo de más', () => {
  it('no estorba cuando no se necesita', () => {
    montar(47_800);
    // Empieza cerrado: la venta normal no lleva recargo y un campo de más
    // en el camino de cobrar estorba doscientas veces al día.
    expect(screen.queryByLabelText(/concepto del recargo/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cobrar algo de más/i })).toBeInTheDocument();
  });

  it('un domicilio por monto se suma al total', async () => {
    const usuario = userEvent.setup();
    const { onConfirmar } = montar(47_800);

    await usuario.click(screen.getByRole('button', { name: /cobrar algo de más/i }));
    await usuario.type(screen.getByLabelText(/concepto del recargo/i), 'Domicilio');
    await usuario.type(screen.getByLabelText(/monto del recargo/i), '3000');

    expect(screen.getByLabelText('Total a cobrar')).toHaveTextContent('$50.800');

    await usuario.click(screen.getByRole('button', { name: /^confirmar/i }));

    const [, recargo] = onConfirmar.mock.calls[0]!;
    expect(recargo).toEqual({ concepto: 'Domicilio', porcentaje: null, monto: 3_000 });
  });

  it('un porcentaje se calcula sobre el total del carrito', async () => {
    const usuario = userEvent.setup();
    const { onConfirmar } = montar(47_800);

    await usuario.click(screen.getByRole('button', { name: /cobrar algo de más/i }));
    await usuario.type(screen.getByLabelText(/concepto del recargo/i), 'Servicio');
    await usuario.click(screen.getByRole('button', { name: '10 %' }));

    // 10 % de 47.800 son 4.780.
    expect(screen.getByLabelText('Total a cobrar')).toHaveTextContent('$52.580');

    await usuario.click(screen.getByRole('button', { name: /^confirmar/i }));
    const [, recargo] = onConfirmar.mock.calls[0]!;
    expect(recargo).toEqual({ concepto: 'Servicio', porcentaje: 10, monto: 4_780 });
  });

  it('explica de dónde sale el total', async () => {
    const usuario = userEvent.setup();
    montar(47_800);

    await usuario.click(screen.getByRole('button', { name: /cobrar algo de más/i }));
    await usuario.type(screen.getByLabelText(/concepto del recargo/i), 'Domicilio');
    await usuario.click(screen.getByRole('button', { name: '10 %' }));

    // El cliente pregunta y el cajero tiene que poder responder.
    expect(screen.getByText(/\$47\.800 \+ \$4\.780 de domicilio \(10 %\)/)).toBeInTheDocument();
  });

  it('sin motivo no se cobra', async () => {
    const usuario = userEvent.setup();
    const { onConfirmar } = montar(47_800);

    await usuario.click(screen.getByRole('button', { name: /cobrar algo de más/i }));
    await usuario.type(screen.getByLabelText(/monto del recargo/i), '3000');

    expect(screen.getByText(/Escribe para qué es/)).toBeInTheDocument();
    expect(screen.getByLabelText('Total a cobrar')).toHaveTextContent('$47.800');

    await usuario.click(screen.getByRole('button', { name: /^confirmar/i }));
    expect(onConfirmar.mock.calls[0]![1]).toBeNull();
  });

  it('quitarlo devuelve el total de antes', async () => {
    const usuario = userEvent.setup();
    montar(47_800);

    await usuario.click(screen.getByRole('button', { name: /cobrar algo de más/i }));
    await usuario.type(screen.getByLabelText(/concepto del recargo/i), 'Domicilio');
    await usuario.click(screen.getByRole('button', { name: '10 %' }));
    await usuario.click(screen.getByRole('button', { name: /quitar el recargo/i }));

    expect(screen.getByLabelText('Total a cobrar')).toHaveTextContent('$47.800');
  });

  it('el vuelto cuenta el recargo', async () => {
    const usuario = userEvent.setup();
    montar(47_800);

    await usuario.click(screen.getByRole('button', { name: /cobrar algo de más/i }));
    await usuario.type(screen.getByLabelText(/concepto del recargo/i), 'Domicilio');
    await usuario.type(screen.getByLabelText(/monto del recargo/i), '3000');
    await usuario.type(screen.getByLabelText(/con cuánto paga/i), '60000');

    // 60.000 − 50.800, no 60.000 − 47.800.
    expect(screen.getByText('$9.200')).toBeInTheDocument();
  });
});
