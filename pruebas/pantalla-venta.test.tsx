// @vitest-environment jsdom
/**
 * Pruebas de la pantalla de venta.
 *
 * Se prueba lo que hace el cajero de verdad: escribir, elegir con las
 * flechas, confirmar con Enter y cobrar con F2, sin tocar el mouse.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PantallaVenta } from '@/modulos/pos/PantallaVenta';
import { agregar } from '@/modulos/pos/carrito';
import type { LineaCarrito, ProductoVenta } from '@/modulos/pos/carrito';

const poker: ProductoVenta = {
  id: 1, codigo: 'CER-POKER-330B', nombre: 'POKER', categoria: 'Cervezas',
  presentacion: '330 ml', envase: 'BOTELLA', existencia: 38, precio_venta: 3900,
  busqueda: 'poker 330 ml cer-poker-330b', codigos_barras: ['7702004003515'],
    empaques_compra: [],
  empaques: [
    { id: 1, nombre: 'Unidad', factor: 1, precio_venta: 3900, predeterminado: true },
    { id: 2, nombre: 'Six', factor: 6, precio_venta: 25000, predeterminado: false },
  ],
};

const aguila: ProductoVenta = {
  id: 2, codigo: 'CER-AGUILA-330B', nombre: 'AGUILA ORIGINAL', categoria: 'Cervezas',
  presentacion: '330 ml', envase: 'BOTELLA', existencia: 2, precio_venta: 3900,
  busqueda: 'aguila original 330 ml cer-aguila-330b', codigos_barras: [],
    empaques_compra: [],
  empaques: [
    { id: 3, nombre: 'Unidad', factor: 1, precio_venta: 3900, predeterminado: true },
  ],
};

const catalogo = [poker, aguila];

function montar(lineas: readonly LineaCarrito[] = []) {
  const onCambiar = vi.fn();
  const onCobrar = vi.fn();
  render(
    <PantallaVenta
      catalogo={catalogo}
      lineas={lineas}
      onCambiar={onCambiar}
      onCobrar={onCobrar}
      cobrando={false}
    />,
  );
  return { onCambiar, onCobrar };
}

beforeEach(cleanup);

describe('busqueda', () => {
  it('el buscador toma el foco al abrir, sin tocar el mouse', () => {
    montar();
    expect(screen.getByLabelText('Buscar producto')).toHaveFocus();
  });

  it('muestra los productos que coinciden con lo escrito', async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.type(screen.getByLabelText('Buscar producto'), 'poker');
    expect(screen.getByText('POKER')).toBeInTheDocument();
    expect(screen.queryByText('AGUILA ORIGINAL')).not.toBeInTheDocument();
  });

  it('dice cuando no hay coincidencias', async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.type(screen.getByLabelText('Buscar producto'), 'whisky japones');
    expect(screen.getByText(/No hay productos que coincidan/)).toBeInTheDocument();
  });

  it('muestra las formas de venta con su precio', async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.type(screen.getByLabelText('Buscar producto'), 'poker');
    expect(screen.getByText('Unidad $3.900')).toBeInTheDocument();
    expect(screen.getByText('Six $25.000')).toBeInTheDocument();
  });

  it('avisa cuando un producto esta sin existencia disponible', async () => {
    const usuario = userEvent.setup();
    // Las 2 unidades de Aguila ya estan en el carrito.
    montar(agregar([], aguila, aguila.empaques[0]!, 2));
    await usuario.type(screen.getByLabelText('Buscar producto'), 'aguila');
    expect(screen.getByText('sin existencia')).toBeInTheDocument();
  });
});

describe('agregar con el teclado', () => {
  it('Enter agrega el producto resaltado', async () => {
    const usuario = userEvent.setup();
    const { onCambiar } = montar();

    await usuario.type(screen.getByLabelText('Buscar producto'), 'poker');
    await usuario.keyboard('{Enter}');

    expect(onCambiar).toHaveBeenCalledTimes(1);
    const nuevas = onCambiar.mock.calls[0]![0] as LineaCarrito[];
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0]!.producto.nombre).toBe('POKER');
    expect(nuevas[0]!.empaque?.nombre).toBe('Unidad');
  });

  it('las flechas cambian el producto resaltado', async () => {
    const usuario = userEvent.setup();
    const { onCambiar } = montar();

    await usuario.type(screen.getByLabelText('Buscar producto'), '330');
    await usuario.keyboard('{ArrowDown}{Enter}');

    const nuevas = onCambiar.mock.calls[0]![0] as LineaCarrito[];
    expect(nuevas[0]!.producto.nombre).toBe('AGUILA ORIGINAL');
  });

  it('un codigo de barras deja un solo resultado', async () => {
    const usuario = userEvent.setup();
    const { onCambiar } = montar();

    await usuario.type(screen.getByLabelText('Buscar producto'), '7702004003515');
    await usuario.keyboard('{Enter}');

    const nuevas = onCambiar.mock.calls[0]![0] as LineaCarrito[];
    expect(nuevas[0]!.producto.nombre).toBe('POKER');
  });

  it('Escape limpia la busqueda', async () => {
    const usuario = userEvent.setup();
    montar();
    const campo = screen.getByLabelText('Buscar producto');
    await usuario.type(campo, 'poker');
    await usuario.keyboard('{Escape}');
    expect(campo).toHaveValue('');
  });
});

describe('el carrito', () => {
  it('sin nada muestra como empezar', () => {
    montar();
    expect(screen.getByText(/Busca un producto o escanea/)).toBeInTheDocument();
  });

  it('muestra el total en grande', () => {
    montar(agregar([], poker, poker.empaques[1]!, 2));
    expect(screen.getByLabelText('Total a cobrar')).toHaveTextContent('$50.000');
  });

  it('distingue la unidad del six en renglones separados', () => {
    let lineas = agregar([], poker, poker.empaques[0]!, 2);
    lineas = agregar(lineas, poker, poker.empaques[1]!, 1);
    montar(lineas);

    expect(screen.getByText('Unidad · $3.900')).toBeInTheDocument();
    expect(screen.getByText('Six · $25.000')).toBeInTheDocument();
    expect(screen.getByLabelText('Total a cobrar')).toHaveTextContent('$32.800');
  });

  it('cuenta las unidades fisicas, no los renglones', () => {
    montar(agregar([], poker, poker.empaques[1]!, 2));
    expect(screen.getByText('12 unidades')).toBeInTheDocument();
  });

  it('avisa si se vende mas de lo que hay, sin impedirlo', () => {
    montar(agregar([], aguila, aguila.empaques[0]!, 5));
    expect(screen.getByText(/más de lo que figura en existencia/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cobrar/ })).toBeEnabled();
  });
});

describe('cobrar', () => {
  it('no se puede cobrar un carrito vacio', () => {
    montar();
    expect(screen.getByRole('button', { name: /Cobrar/ })).toBeDisabled();
  });

  it('F2 cobra sin tocar el mouse', async () => {
    const usuario = userEvent.setup();
    const { onCobrar } = montar(agregar([], poker));
    await usuario.keyboard('{F2}');
    expect(onCobrar).toHaveBeenCalledTimes(1);
  });

  it('F2 no hace nada con el carrito vacio', async () => {
    const usuario = userEvent.setup();
    const { onCobrar } = montar();
    await usuario.keyboard('{F2}');
    expect(onCobrar).not.toHaveBeenCalled();
  });

  it('F8 cancela la venta entera', async () => {
    const usuario = userEvent.setup();
    const { onCambiar } = montar(agregar([], poker));
    await usuario.keyboard('{F8}');
    expect(onCambiar).toHaveBeenCalledWith([]);
  });

  it('los atajos quedan a la vista', () => {
    montar();
    expect(screen.getByText(/F1 buscar · F2 cobrar · F8 cancelar/)).toBeInTheDocument();
  });
});

describe('productos que se llaman igual', () => {
  const margaritaChica: ProductoVenta = {
    id: 3, codigo: 'MEC-MARGARITA-1', nombre: 'MARGARITA', categoria: 'Mecato',
    presentacion: '', envase: null, existencia: 12, precio_venta: 3500,
    busqueda: 'margarita mec-margarita-1', codigos_barras: [],
    empaques_compra: [],
    empaques: [
      { id: 10, nombre: 'Unidad', factor: 1, precio_venta: 3500, predeterminado: true },
    ],
  };

  const margaritaGrande: ProductoVenta = {
    ...margaritaChica,
    id: 4, codigo: 'MEC-MARGARITA-2', precio_venta: 10_000,
    busqueda: 'margarita mec-margarita-2',
    empaques: [
      { id: 11, nombre: 'Unidad', factor: 1, precio_venta: 10_000, predeterminado: true },
    ],
  };

  const pokerGrande: ProductoVenta = {
    ...poker, id: 5, codigo: 'CER-POKER-750B', presentacion: '750 ml',
    precio_venta: 7_500, busqueda: 'poker 750 ml cer-poker-750b', codigos_barras: [],
    empaques_compra: [],
    empaques: [
      { id: 12, nombre: 'Unidad', factor: 1, precio_venta: 7_500, predeterminado: true },
    ],
  };

  function montarCon(extra: readonly ProductoVenta[]) {
    render(
      <PantallaVenta
        catalogo={[...catalogo, ...extra]}
        lineas={[]}
        onCambiar={vi.fn()}
        onCobrar={vi.fn()}
        cobrando={false}
      />,
    );
    return userEvent.setup();
  }

  it('el tamano se ve al lado del nombre, no en la letra chica', async () => {
    const usuario = montarCon([pokerGrande]);

    await usuario.type(screen.getByLabelText('Buscar producto'), 'poker');

    expect(screen.getByText('330 ml')).toBeInTheDocument();
    expect(screen.getByText('750 ml')).toBeInTheDocument();
  });

  it('las dos que no tienen tamano se distinguen por el precio', async () => {
    const usuario = montarCon([margaritaChica, margaritaGrande]);

    await usuario.type(screen.getByLabelText('Buscar producto'), 'margarita');

    expect(screen.getByText('$3.500')).toBeInTheDocument();
    expect(screen.getByText('$10.000')).toBeInTheDocument();
  });

  it('un producto sin homonimos no lleva marca', async () => {
    const usuario = montarCon([pokerGrande]);

    await usuario.type(screen.getByLabelText('Buscar producto'), 'aguila');

    expect(screen.getByText(/AGUILA ORIGINAL/)).toBeInTheDocument();
    expect(screen.queryByText('330 ml')).not.toBeInTheDocument();
  });

  it('la marca sigue al producto hasta el carrito', () => {
    // El renglon del carrito es la ultima oportunidad de ver que se
    // agrego la Margarita equivocada antes de cobrarla.
    const conLaChica = agregar([], margaritaChica, margaritaChica.empaques[0]!);

    render(
      <PantallaVenta
        catalogo={[...catalogo, margaritaChica, margaritaGrande]}
        lineas={conLaChica}
        onCambiar={vi.fn()}
        onCobrar={vi.fn()}
        cobrando={false}
      />,
    );

    const renglon = screen.getByText('MARGARITA').closest('li')!;
    // Dentro del renglon: la marca junto al nombre y el precio de la linea.
    expect(within(renglon).getAllByText('$3.500')).toHaveLength(2);
    expect(screen.queryByText('$10.000')).not.toBeInTheDocument();
  });
});
