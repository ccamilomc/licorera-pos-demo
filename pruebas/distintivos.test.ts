/**
 * Que poner al lado del nombre cuando dos productos se llaman igual.
 *
 * Los casos son los del Excel real del negocio: las dos Margaritas que
 * comparten nombre con precio distinto, las cervezas que existen en lata
 * y en botella, las gaseosas de litro. En la caja se lee el nombre; si la
 * diferencia esta solo en la letra chica, se cobra la equivocada.
 */

import { describe, expect, it } from 'vitest';

import { distintivos } from '@/compartido/utilidades/homonimos';
import type { ProductoVenta } from '@/modulos/pos/carrito';

function producto(p: Partial<ProductoVenta> & { id: number; nombre: string }): ProductoVenta {
  return {
    codigo: `C${p.id}`,
    categoria: 'Cervezas',
    presentacion: '',
    envase: null,
    existencia: 10,
    precio_venta: 3_000,
    busqueda: p.nombre.toLowerCase(),
    codigos_barras: [],
    empaques_compra: [],
    empaques: [],
    ...p,
  };
}

describe('cuando no hay confusion posible', () => {
  it('un nombre unico no lleva marca', () => {
    const marca = distintivos([
      producto({ id: 1, nombre: 'Póker', presentacion: '330 ml' }),
      producto({ id: 2, nombre: 'Águila', presentacion: '330 ml' }),
    ]);

    expect(marca.size).toBe(0);
  });

  it('una lista vacia no rompe nada', () => {
    expect(distintivos([]).size).toBe(0);
  });
});

describe('mismo nombre, distinto tamano', () => {
  it('distingue por el volumen', () => {
    const marca = distintivos([
      producto({ id: 1, nombre: 'Póker', presentacion: '330 ml' }),
      producto({ id: 2, nombre: 'Póker', presentacion: '700 ml' }),
    ]);

    expect(marca.get(1)).toBe('330 ml');
    expect(marca.get(2)).toBe('700 ml');
  });

  it('la gaseosa de litro queda separada de la pequena', () => {
    const marca = distintivos([
      producto({ id: 1, nombre: 'Coca-Cola', presentacion: '400 ml' }),
      producto({ id: 2, nombre: 'Coca-Cola', presentacion: '1 L' }),
    ]);

    expect(marca.get(2)).toBe('1 L');
  });

  it('no marca al que no comparte nombre con nadie', () => {
    const marca = distintivos([
      producto({ id: 1, nombre: 'Póker', presentacion: '330 ml' }),
      producto({ id: 2, nombre: 'Póker', presentacion: '700 ml' }),
      producto({ id: 3, nombre: 'Club Colombia', presentacion: '330 ml' }),
    ]);

    expect(marca.has(3)).toBe(false);
  });
});

describe('mismo nombre y mismo tamano', () => {
  it('distingue por el envase, que es lo que se ve', () => {
    const marca = distintivos([
      producto({ id: 1, nombre: 'Corona', presentacion: '330 ml', envase: 'LATA' }),
      producto({ id: 2, nombre: 'Corona', presentacion: '330 ml', envase: 'BOTELLA' }),
    ]);

    expect(marca.get(1)).toBe('lata');
    expect(marca.get(2)).toBe('botella');
  });

  it('usa volumen y envase juntos cuando ninguno alcanza solo', () => {
    const marca = distintivos([
      producto({ id: 1, nombre: 'Corona', presentacion: '330 ml', envase: 'LATA' }),
      producto({ id: 2, nombre: 'Corona', presentacion: '330 ml', envase: 'BOTELLA' }),
      producto({ id: 3, nombre: 'Corona', presentacion: '269 ml', envase: 'LATA' }),
    ]);

    expect(marca.get(1)).toBe('330 ml lata');
    expect(marca.get(2)).toBe('330 ml botella');
    expect(marca.get(3)).toBe('269 ml lata');
  });
});

describe('los que el Excel nunca alcanzo a distinguir', () => {
  /** Las dos Margaritas: mismo nombre, sin tamano, precio distinto. */
  it('cae al precio cuando no hay tamano ni envase', () => {
    const marca = distintivos([
      producto({ id: 1, nombre: 'Margarita', precio_venta: 3_500 }),
      producto({ id: 2, nombre: 'Margarita', precio_venta: 10_000 }),
    ]);

    expect(marca.get(1)).toBe('$3.500');
    expect(marca.get(2)).toBe('$10.000');
  });

  it('no inventa una marca cuando de verdad son iguales', () => {
    const marca = distintivos([
      producto({ id: 1, nombre: 'De Todito', precio_venta: 2_000 }),
      producto({ id: 2, nombre: 'De Todito', precio_venta: 2_000 }),
    ]);

    expect(marca.size).toBe(0);
  });
});

describe('detalles que confunden si se pasan por alto', () => {
  it('el nombre se compara sin importar mayusculas ni espacios', () => {
    const marca = distintivos([
      producto({ id: 1, nombre: 'Póker', presentacion: '330 ml' }),
      producto({ id: 2, nombre: '  póker ', presentacion: '700 ml' }),
    ]);

    expect(marca.size).toBe(2);
  });

  it('tres del mismo nombre se distinguen los tres', () => {
    const marca = distintivos([
      producto({ id: 1, nombre: 'Águila', presentacion: '269 ml' }),
      producto({ id: 2, nombre: 'Águila', presentacion: '330 ml' }),
      producto({ id: 3, nombre: 'Águila', presentacion: '750 ml' }),
    ]);

    expect([...marca.values()]).toEqual(['269 ml', '330 ml', '750 ml']);
  });

  it('un grupo donde solo dos comparten tamano no usa el volumen a medias', () => {
    // Si el volumen no separa a los tres, no se usa para ninguno: dejar
    // uno con volumen y otros con envase se lee como tres cosas distintas.
    const marca = distintivos([
      producto({ id: 1, nombre: 'Póker', presentacion: '330 ml', envase: 'LATA' }),
      producto({ id: 2, nombre: 'Póker', presentacion: '330 ml', envase: 'BOTELLA' }),
      producto({ id: 3, nombre: 'Póker', presentacion: '750 ml', envase: 'BOTELLA' }),
    ]);

    expect(marca.get(1)).toBe('330 ml lata');
    expect(marca.get(3)).toBe('750 ml botella');
  });
});
