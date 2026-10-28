/**
 * El carrito de la venta en curso.
 *
 * Logica pura, sin React ni pantalla, para poder probarla a fondo: es lo
 * que decide cuanto se le cobra al cliente.
 *
 * Regla central: un mismo producto puede estar en el carrito varias veces
 * si es en formas distintas (dos botellas sueltas y un six). Lo que se
 * agrupa es producto + empaque, no el producto solo.
 */

export interface EmpaqueVenta {
  readonly id: number;
  readonly nombre: string;
  readonly factor: number;
  readonly precio_venta: number;
  readonly predeterminado: boolean;
}

/**
 * Una forma con la que llega mercancia. Puede no tener precio de venta:
 * una canasta sirve para recibir aunque todavia no se haya decidido a
 * como se vende.
 */
export interface EmpaqueCompra {
  readonly id: number;
  readonly nombre: string;
  readonly factor: number;
  readonly precio_venta: number | null;
}

export interface ProductoVenta {
  readonly id: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly presentacion: string;
  readonly envase: string | null;
  readonly existencia: number;
  readonly precio_venta: number;
  readonly busqueda: string;
  readonly codigos_barras: readonly string[];
  readonly empaques: readonly EmpaqueVenta[];
  readonly empaques_compra: readonly EmpaqueCompra[];
}

export interface LineaCarrito {
  readonly producto: ProductoVenta;
  readonly empaque: EmpaqueVenta | null;
  readonly cantidad: number;
  readonly descuento: number;
}

export interface TotalesCarrito {
  readonly subtotal: number;
  readonly descuento: number;
  readonly total: number;
  readonly unidades: number;
}

/** Identidad de una linea: mismo producto y misma forma de venta. */
export function claveLinea(productoId: number, empaqueId: number | null): string {
  return `${productoId}:${empaqueId ?? 'base'}`;
}

export function claveDe(linea: LineaCarrito): string {
  return claveLinea(linea.producto.id, linea.empaque?.id ?? null);
}

export function precioDe(linea: LineaCarrito): number {
  return linea.empaque?.precio_venta ?? linea.producto.precio_venta;
}

export function factorDe(linea: LineaCarrito): number {
  return linea.empaque?.factor ?? 1;
}

export function totalLinea(linea: LineaCarrito): number {
  return precioDe(linea) * linea.cantidad - linea.descuento;
}

/** Unidades fisicas que salen del inventario. Un six son seis botellas. */
export function unidadesLinea(linea: LineaCarrito): number {
  return linea.cantidad * factorDe(linea);
}

/** El empaque con el que se propone vender: el marcado por omision. */
export function empaquePorDefecto(producto: ProductoVenta): EmpaqueVenta | null {
  return producto.empaques.find((e) => e.predeterminado)
    ?? producto.empaques[0]
    ?? null;
}

export function agregar(
  lineas: readonly LineaCarrito[],
  producto: ProductoVenta,
  empaque: EmpaqueVenta | null = empaquePorDefecto(producto),
  cantidad = 1,
): LineaCarrito[] {
  if (cantidad <= 0) return [...lineas];

  const clave = claveLinea(producto.id, empaque?.id ?? null);
  const existente = lineas.findIndex((l) => claveDe(l) === clave);

  if (existente === -1) {
    return [...lineas, { producto, empaque, cantidad, descuento: 0 }];
  }
  return lineas.map((l, i) =>
    i === existente ? { ...l, cantidad: l.cantidad + cantidad } : l,
  );
}

/** Fija la cantidad. En cero o menos, la linea sale del carrito. */
export function cambiarCantidad(
  lineas: readonly LineaCarrito[],
  clave: string,
  cantidad: number,
): LineaCarrito[] {
  if (cantidad <= 0) return quitar(lineas, clave);
  return lineas.map((l) => (claveDe(l) === clave ? { ...l, cantidad } : l));
}

/** El descuento nunca puede dejar el renglon en negativo. */
export function cambiarDescuento(
  lineas: readonly LineaCarrito[],
  clave: string,
  descuento: number,
): LineaCarrito[] {
  return lineas.map((l) => {
    if (claveDe(l) !== clave) return l;
    const maximo = precioDe(l) * l.cantidad;
    return { ...l, descuento: Math.min(Math.max(0, Math.round(descuento)), maximo) };
  });
}

export function quitar(
  lineas: readonly LineaCarrito[],
  clave: string,
): LineaCarrito[] {
  return lineas.filter((l) => claveDe(l) !== clave);
}

export function totales(lineas: readonly LineaCarrito[]): TotalesCarrito {
  const subtotal = lineas.reduce((s, l) => s + precioDe(l) * l.cantidad, 0);
  const descuento = lineas.reduce((s, l) => s + l.descuento, 0);
  return {
    subtotal,
    descuento,
    total: subtotal - descuento,
    unidades: lineas.reduce((s, l) => s + unidadesLinea(l), 0),
  };
}

/**
 * Unidades de un producto comprometidas en todo el carrito, sumando sus
 * distintas formas de venta. Es lo que hay que comparar con la existencia
 * para avisar de un faltante: dos botellas mas un six son ocho, no dos.
 */
export function unidadesDeProducto(
  lineas: readonly LineaCarrito[],
  productoId: number,
): number {
  return lineas
    .filter((l) => l.producto.id === productoId)
    .reduce((s, l) => s + unidadesLinea(l), 0);
}

/** Lineas que piden mas de lo que hay en existencia. */
export function lineasSinExistencia(
  lineas: readonly LineaCarrito[],
): LineaCarrito[] {
  return lineas.filter(
    (l) => unidadesDeProducto(lineas, l.producto.id) > l.producto.existencia,
  );
}

/**
 * Busca en el catalogo. Un codigo de barras exacto gana siempre: si el
 * cajero escaneo, no hay nada que elegir.
 */
export function buscar(
  catalogo: readonly ProductoVenta[],
  texto: string,
  limite = 40,
): ProductoVenta[] {
  const consulta = texto.trim().toLowerCase();
  if (consulta === '') return [];

  const porCodigo = catalogo.find((p) => p.codigos_barras.includes(consulta));
  if (porCodigo !== undefined) return [porCodigo];

  const terminos = consulta.split(/\s+/);
  return catalogo
    .filter((p) => terminos.every((t) => p.busqueda.includes(t)))
    .slice(0, limite);
}

/** Lo que espera el nucleo para registrar la venta. */
export function paraRegistrar(lineas: readonly LineaCarrito[]) {
  return lineas.map((l) => ({
    producto_id: l.producto.id,
    empaque_id: l.empaque?.id ?? null,
    cantidad: l.cantidad,
    descuento: l.descuento,
  }));
}
