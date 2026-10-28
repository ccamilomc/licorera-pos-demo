/**
 * Pruebas del carrito. Es lo que decide cuanto se le cobra al cliente,
 * asi que se prueba con los productos y precios reales del negocio.
 */

import { describe, expect, it } from 'vitest';
import {
  agregar, buscar, cambiarCantidad, cambiarDescuento, claveLinea,
  empaquePorDefecto, lineasSinExistencia, quitar, totales,
  unidadesDeProducto, unidadesLinea,
} from '../src/modulos/pos/carrito';
import type { LineaCarrito, ProductoVenta } from '../src/modulos/pos/carrito';

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

const nectar: ProductoVenta = {
  id: 2, codigo: 'AGU-NECTARAZUL-750B', nombre: 'NECTAR AZUL', categoria: 'Aguardiente',
  presentacion: '750 ml', envase: 'BOTELLA', existencia: 4, precio_venta: 62000,
  busqueda: 'nectar azul 750 ml agu-nectarazul-750b', codigos_barras: [],
    empaques_compra: [],
  empaques: [
    { id: 3, nombre: 'Unidad', factor: 1, precio_venta: 62000, predeterminado: true },
  ],
};

const six = poker.empaques[1]!;
const unidad = poker.empaques[0]!;

describe('agregar al carrito', () => {
  it('usa la forma de venta por defecto si no se indica otra', () => {
    const c = agregar([], poker);
    expect(c[0]!.empaque?.nombre).toBe('Unidad');
    expect(empaquePorDefecto(poker)?.nombre).toBe('Unidad');
  });

  it('suma cantidades cuando es el mismo producto y la misma forma', () => {
    let c = agregar([], poker, unidad, 2);
    c = agregar(c, poker, unidad, 3);
    expect(c).toHaveLength(1);
    expect(c[0]!.cantidad).toBe(5);
  });

  it('mantiene renglones aparte para unidad y six del mismo producto', () => {
    let c = agregar([], poker, unidad, 2);
    c = agregar(c, poker, six, 1);
    expect(c).toHaveLength(2);
    expect(totales(c).total).toBe(2 * 3900 + 25000);
  });

  it('ignora cantidades en cero o negativas', () => {
    expect(agregar([], poker, unidad, 0)).toHaveLength(0);
    expect(agregar([], poker, unidad, -3)).toHaveLength(0);
  });
});

describe('unidades que salen del inventario', () => {
  it('un six son seis botellas', () => {
    const c = agregar([], poker, six, 1);
    expect(unidadesLinea(c[0]!)).toBe(6);
  });

  it('suma las unidades de todas las formas del mismo producto', () => {
    let c = agregar([], poker, unidad, 2);
    c = agregar(c, poker, six, 1);
    expect(unidadesDeProducto(c, poker.id)).toBe(8);
    expect(totales(c).unidades).toBe(8);
  });
});

describe('totales', () => {
  it('el precio del six no se calcula desde el unitario', () => {
    const c = agregar([], poker, six, 1);
    expect(totales(c).total).toBe(25000);
    expect(totales(c).total).not.toBe(3900 * 6);
  });

  it('resta los descuentos', () => {
    let c = agregar([], nectar, nectar.empaques[0]!, 1);
    c = cambiarDescuento(c, claveLinea(nectar.id, 3), 2000);
    expect(totales(c)).toMatchObject({ subtotal: 62000, descuento: 2000, total: 60000 });
  });

  it('un carrito vacio suma cero', () => {
    expect(totales([])).toMatchObject({ subtotal: 0, descuento: 0, total: 0, unidades: 0 });
  });
});

describe('descuentos', () => {
  it('nunca dejan el renglon en negativo', () => {
    let c = agregar([], poker, unidad, 2);
    c = cambiarDescuento(c, claveLinea(poker.id, 1), 999_999);
    expect(totales(c).total).toBe(0);
    expect(c[0]!.descuento).toBe(7800);
  });

  it('un descuento negativo se toma como cero', () => {
    let c = agregar([], poker, unidad, 1);
    c = cambiarDescuento(c, claveLinea(poker.id, 1), -5000);
    expect(c[0]!.descuento).toBe(0);
  });
});

describe('cantidades', () => {
  it('poner la cantidad en cero quita el renglon', () => {
    const c = cambiarCantidad(agregar([], poker, unidad, 3), claveLinea(poker.id, 1), 0);
    expect(c).toHaveLength(0);
  });

  it('quitar solo afecta al renglon indicado', () => {
    let c = agregar([], poker, unidad, 1);
    c = agregar(c, poker, six, 1);
    const quedan = quitar(c, claveLinea(poker.id, 1));
    expect(quedan).toHaveLength(1);
    expect(quedan[0]!.empaque?.nombre).toBe('Six');
  });
});

describe('aviso de faltante', () => {
  it('avisa cuando el carrito pide mas de lo que hay', () => {
    const c = agregar([], nectar, nectar.empaques[0]!, 5); // solo hay 4
    expect(lineasSinExistencia(c)).toHaveLength(1);
  });

  it('cuenta las dos formas juntas antes de avisar', () => {
    // 38 botellas: 2 sueltas + 6 six son 38 justas, todavia alcanza.
    let c = agregar([], poker, unidad, 2);
    c = agregar(c, poker, six, 6);
    expect(unidadesDeProducto(c, poker.id)).toBe(38);
    expect(lineasSinExistencia(c)).toHaveLength(0);

    // Una botella mas ya no alcanza.
    c = agregar(c, poker, unidad, 1);
    expect(lineasSinExistencia(c).length).toBeGreaterThan(0);
  });

  it('no avisa cuando alcanza de sobra', () => {
    const c = agregar([], poker, unidad, 1);
    expect(lineasSinExistencia(c)).toHaveLength(0);
  });
});

describe('busqueda', () => {
  const catalogo = [poker, nectar];

  it('encuentra por nombre', () => {
    expect(buscar(catalogo, 'poker')).toHaveLength(1);
  });

  it('encuentra sin tildes y sin mayusculas', () => {
    expect(buscar(catalogo, 'NECTAR')[0]?.nombre).toBe('NECTAR AZUL');
  });

  it('acepta varias palabras en cualquier orden', () => {
    expect(buscar(catalogo, 'azul nectar')).toHaveLength(1);
  });

  it('un codigo de barras exacto devuelve un solo producto', () => {
    const r = buscar(catalogo, '7702004003515');
    expect(r).toHaveLength(1);
    expect(r[0]?.nombre).toBe('POKER');
  });

  it('con la busqueda vacia no devuelve nada', () => {
    expect(buscar(catalogo, '   ')).toHaveLength(0);
  });

  it('no inventa resultados', () => {
    expect(buscar(catalogo, 'whisky japones')).toHaveLength(0);
  });
});

describe('formato para el nucleo', () => {
  it('manda el id del empaque, no el factor', () => {
    const c: LineaCarrito[] = agregar([], poker, six, 2);
    const [item] = c.map((l) => ({
      producto_id: l.producto.id,
      empaque_id: l.empaque?.id ?? null,
      cantidad: l.cantidad,
    }));
    expect(item).toEqual({ producto_id: 1, empaque_id: 2, cantidad: 2 });
  });
});
