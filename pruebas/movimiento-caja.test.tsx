// @vitest-environment jsdom
/**
 * Pruebas del registro de entradas y salidas de dinero.
 *
 * Lo que se protege aqui es que la caja pueda cuadrar. Si sale plata para
 * un domicilio y no queda anotada, al cerrar va a faltar y nadie va a
 * saber por que -- y el cajero termina pagando de su bolsillo una
 * diferencia que no causo.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MovimientoCaja } from '@/modulos/pos/MovimientoCaja';

const onGuardar = vi.fn();
const onCerrar = vi.fn();

function montar(guardando = false, error: string | null = null) {
  cleanup();
  onGuardar.mockClear();
  onCerrar.mockClear();
  render(
    <MovimientoCaja
      guardando={guardando}
      error={error}
      onGuardar={onGuardar}
      onCerrar={onCerrar}
    />,
  );
  return userEvent.setup();
}

beforeEach(() => {
  cleanup();
});

describe('el caso de todos los dias', () => {
  it('arranca en salida, que es lo que mas pasa', () => {
    montar();
    expect(screen.getByRole('button', { name: /sale plata/i }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('un domicilio se registra en tres toques', async () => {
    const usuario = montar();

    await usuario.click(screen.getByRole('button', { name: 'Domicilio' }));
    await usuario.type(screen.getByLabelText(/cuanto|cuánto/i), '5000');
    await usuario.click(screen.getByRole('button', { name: /registrar/i }));

    expect(onGuardar).toHaveBeenCalledWith(false, 'Domicilio', 5000);
  });

  it('el campo del concepto recibe el foco al abrir', () => {
    montar();
    expect(screen.getByLabelText(/para que|para qué/i)).toHaveFocus();
  });
});

describe('el monto', () => {
  it('ignora letras', async () => {
    const usuario = montar();
    const campo = screen.getByLabelText(/cuanto|cuánto/i);

    await usuario.type(campo, '12a3b45');

    expect(campo).toHaveValue('12345');
  });

  it('se muestra formateado en pesos mientras se escribe', async () => {
    const usuario = montar();

    await usuario.type(screen.getByLabelText(/cuanto|cuánto/i), '25000');

    expect(screen.getByText(/\$\s?25\.000/)).toBeInTheDocument();
  });

  it('Enter registra sin tocar el mouse', async () => {
    const usuario = montar();

    await usuario.type(screen.getByLabelText(/para que|para qué/i), 'Mandado');
    await usuario.type(screen.getByLabelText(/cuanto|cuánto/i), '3000{Enter}');

    expect(onGuardar).toHaveBeenCalledWith(false, 'Mandado', 3000);
  });
});

describe('lo que no deja hacer', () => {
  it('no registra sin decir para que', async () => {
    const usuario = montar();

    await usuario.type(screen.getByLabelText(/cuanto|cuánto/i), '5000');

    expect(screen.getByRole('button', { name: /registrar/i })).toBeDisabled();
  });

  it('no registra un monto en cero', async () => {
    const usuario = montar();

    await usuario.type(screen.getByLabelText(/para que|para qué/i), 'Domicilio');
    await usuario.type(screen.getByLabelText(/cuanto|cuánto/i), '0');

    expect(screen.getByRole('button', { name: /registrar/i })).toBeDisabled();
  });

  it('Enter no hace nada si falta algo', async () => {
    const usuario = montar();

    await usuario.type(screen.getByLabelText(/cuanto|cuánto/i), '5000{Enter}');

    expect(onGuardar).not.toHaveBeenCalled();
  });
});

describe('entra o sale', () => {
  it('cambiar a entrada ofrece otros motivos', async () => {
    const usuario = montar();

    expect(screen.getByRole('button', { name: 'Domicilio' })).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: /entra plata/i }));

    expect(screen.queryByRole('button', { name: 'Domicilio' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Préstamo' })).toBeInTheDocument();
  });

  it('cambiar de tipo borra el concepto anterior', async () => {
    const usuario = montar();

    await usuario.click(screen.getByRole('button', { name: 'Domicilio' }));
    await usuario.click(screen.getByRole('button', { name: /entra plata/i }));

    expect(screen.getByLabelText(/para que|para qué/i)).toHaveValue('');
  });

  it('una entrada se guarda marcada como entrada', async () => {
    const usuario = montar();

    await usuario.click(screen.getByRole('button', { name: /entra plata/i }));
    await usuario.click(screen.getByRole('button', { name: 'Préstamo' }));
    await usuario.type(screen.getByLabelText(/cuanto|cuánto/i), '50000');
    await usuario.click(screen.getByRole('button', { name: /registrar/i }));

    expect(onGuardar).toHaveBeenCalledWith(true, 'Préstamo', 50000);
  });
});

describe('mientras guarda', () => {
  it('no deja registrar dos veces', async () => {
    montar(true);
    expect(screen.getByRole('button', { name: /guardando/i })).toBeDisabled();
  });

  it('no deja cerrar a medias', () => {
    montar(true);
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeDisabled();
  });
});

describe('si algo falla', () => {
  it('muestra el error donde se ve', () => {
    montar(false, 'La caja ya está cerrada.');

    const aviso = screen.getByRole('alert');
    expect(aviso).toHaveTextContent('La caja ya está cerrada.');
  });

  it('sin error no muestra ningun aviso', () => {
    montar();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('salir sin registrar', () => {
  it('Cancelar cierra', async () => {
    const usuario = montar();
    await usuario.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onCerrar).toHaveBeenCalled();
  });

  it('Escape cierra', async () => {
    const usuario = montar();
    await usuario.keyboard('{Escape}');
    expect(onCerrar).toHaveBeenCalled();
  });
});
