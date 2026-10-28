/**
 * Un nucleo de mentira, para poder mirar la aplicacion en el navegador.
 *
 * En el navegador no existe `invoke`: sin esto la aplicacion se queda en
 * el ingreso y no hay forma de ver ninguna pantalla. Con esto se entra
 * directo como administrador y todo responde con datos en memoria.
 *
 * Sirve para revisar la INTERFAZ —que las pantallas se vean, que los
 * flujos se puedan recorrer, que el diseño funcione en claro y en
 * oscuro—, no para dar por bueno el nucleo: ese tiene sus propias
 * pruebas contra SQLite de verdad. Lo que aqui funcione puede estar roto
 * en Rust y al reves.
 *
 * NO LLEGA A LA APLICACION INSTALADA. Se carga solo cuando
 * `import.meta.env.DEV` es cierto y ademas no hay Tauri, de modo que el
 * empaquetado de produccion lo descarta entero. Hay una prueba que lo
 * comprueba en el bundle.
 */

import {
  CATEGORIAS, ENVASES, MARCAS, PRODUCTOS, PROVEEDORES, UNIDADES, nuevoId,
} from './datos';
import type { ProductoSim, ProveedorSim } from './datos';

const USUARIO_DEV = {
  id: 1,
  usuario: 'dev',
  nombre: 'Modo desarrollo',
  rol: 'Administrador' as const,
  activo: true,
  ultimo_ingreso: null,
};

/** Todos los permisos: en desarrollo se mira todo. */
const PERMISOS = [
  'venta.crear', 'venta.anular', 'venta.ver_todas', 'venta.descuento',
  'caja.abrir', 'caja.cerrar', 'caja.movimiento', 'caja.ver_todas',
  'producto.crear', 'producto.editar', 'producto.desactivar', 'producto.precio',
  'inventario.ajustar', 'inventario.ver',
  'compra.registrar', 'compra.anular', 'proveedor.gestionar',
  'costo.ver', 'utilidad.ver',
  'reporte.operacion', 'reporte.financiero',
  'usuario.gestionar', 'permiso.gestionar',
  'respaldo.crear', 'respaldo.restaurar', 'auditoria.ver', 'config.editar',
];

interface CajaSim {
  id: number;
  base_inicial: number;
  abierta: boolean;
  entradas: number;
  salidas: number;
  ventas_total: number;
  ventas_cantidad: number;
}

let caja: CajaSim | null = null;
interface RenglonSim {
  producto: string; empaque: string; cantidad: number; unidades: number;
  precio_unitario: number; total: number;
}

let ventas: {
  id: number; numero: string; fecha: string; total: number; anulada: boolean;
  usuario: string; metodo: string; articulos: number;
  renglones?: RenglonSim[];
  motivo?: string;
}[] = [
  { id: 1, numero: 'V-000124', fecha: hoy(-1), total: 47_800, anulada: false,
    usuario: 'Modo desarrollo', metodo: 'Efectivo', articulos: 7 },
  { id: 2, numero: 'V-000123', fecha: hoy(-1), total: 12_500, anulada: true,
    usuario: 'Modo desarrollo', metodo: 'Efectivo', articulos: 2 },
];
let compras: {
  id: number; numero: string; fecha: string; proveedor: string;
  documento: string | null; total: number; anulada: boolean; articulos: number;
  /** Que entro y cuanto, para devolverlo si se anula. */
  entradas?: { producto_id: number; unidades: number }[];
}[] = [
  { id: 1, numero: 'C-00045', fecha: '', proveedor: 'Distribuidora Bavaria',
    documento: 'F-8891', total: 640_000, anulada: false, articulos: 20 },
];

/**
 * Los catorce dias, con dos en cero: el local cerro esos dias. El nucleo
 * los devuelve igual para que la grafica muestre el hueco en vez de pegar
 * las barras vecinas.
 */
const TOTALES = [112_000, 98_400, 143_700, 121_500, 165_200, 0, 178_900,
                 154_300, 132_800, 176_800, 154_900, 0, 203_100, 187_400];
const CANTIDADES = [16, 14, 20, 17, 22, 0, 24, 21, 18, 22, 20, 0, 26, 23];

const VENTAS_POR_DIA = TOTALES.map((total, i) => ({
  fecha: '',
  total,
  cantidad: CANTIDADES[i]!,
  dias: 13 - i,
}));

const PRECIOS_ESPECIALES: {
  id: number; producto_id: number; producto: string;
  empaque_id: number | null; empaque: string | null;
  precio_normal: number; precio: number; motivo: string | null;
  desde: string; hasta: string; activo: boolean; vigente_hoy: boolean;
}[] = [];

const RESPALDOS: {
  archivo: string; ruta: string; tamano_bytes: number;
  creado: string; verificado: boolean;
}[] = [
  { archivo: 'tribuna-respaldo-1.db', ruta: 'C:\\…\\respaldos\\tribuna-respaldo-1.db',
    tamano_bytes: 2_310_144, creado: '', verificado: false },
  { archivo: 'tribuna-respaldo-2.db', ruta: 'C:\\…\\respaldos\\tribuna-respaldo-2.db',
    tamano_bytes: 2_290_688, creado: '', verificado: true },
];

/**
 * Solo la fecha, en hora local, como la devuelve el nucleo.
 *
 * No sale de `toISOString()`: eso da la fecha en UTC, y en Colombia
 * (UTC-5) despues de las siete de la noche ya es el dia siguiente alla.
 * Una promocion de «solo hoy» dejaria de aplicar a media tarde.
 */
function soloFecha(dias = 0): string {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  return [
    f.getFullYear(),
    String(f.getMonth() + 1).padStart(2, '0'),
    String(f.getDate()).padStart(2, '0'),
  ].join('-');
}

function hoy(dias = 0): string {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  return f.toISOString();
}

/**
 * Fecha y hora como las manda el nucleo: `strftime('%Y-%m-%d %H:%M')` en
 * hora local, no un ISO con Z. Si aqui se mandara ISO, la pantalla se
 * veria bien en el simulador y mal en la aplicacion —o al reves.
 */
function fechaHora(dias = 0): string {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())} `
    + `${dos(f.getHours())}:${dos(f.getMinutes())}`;
}

for (const v of VENTAS_POR_DIA) {
  (v as { fecha: string }).fecha = soloFecha(-v.dias);
}

compras[0]!.fecha = soloFecha(-3);

RESPALDOS[0]!.creado = hoy();
RESPALDOS[1]!.creado = hoy(-2);

/** Los ajustes del negocio. Se editan desde Configuración y se conservan. */
const CONFIGURACION: { clave: string; valor: string }[] = [
  { clave: 'negocio.nombre', valor: 'Licorera Demo' },
  { clave: 'negocio.nit', valor: '900.123.456-7' },
  { clave: 'negocio.direccion', valor: 'Carrera 30 #8-15' },
  { clave: 'negocio.telefono', valor: '318 555 0142' },
  { clave: 'inventario.stock_minimo_defecto', valor: '6' },
  { clave: 'sesion.minutos_inactividad', valor: '15' },
  { clave: 'respaldo.dias_alerta', valor: '3' },
  { clave: 'venta.recargos_sugeridos', valor: 'Domicilio,Servicio,Recargo nocturno' },
  { clave: 'impuesto.nombre', valor: 'IVA' },
  { clave: 'impuesto.activo', valor: '0' },
  { clave: 'impuesto.porcentaje', valor: '0' },
];

/**
 * Un ajuste numerico, como lo lee el nucleo: si falta o no es mayor que
 * cero, rige el valor por omision.
 */
function ajusteNumerico(clave: string, defecto: number): number {
  const fila = CONFIGURACION.find((c) => c.clave === clave);
  const numero = Number(fila?.valor ?? '');
  return Number.isInteger(numero) && numero > 0 ? numero : defecto;
}

/** De cuándo a cuándo pidió la pantalla. */
function rangoPedido(a: Record<string, unknown>): { desde: string; hasta: string } {
  const p = (a['periodo'] ?? {}) as { desde?: string; hasta?: string };
  return { desde: p.desde ?? soloFecha(-29), hasta: p.hasta ?? soloFecha(0) };
}

/** Los días de ejemplo que caen dentro de un rango. */
function diasEntreFechas(desde: string, hasta: string) {
  return VENTAS_POR_DIA.filter((v) => v.fecha >= desde && v.fecha <= hasta);
}

/**
 * Qué tanto del movimiento de ejemplo cae dentro del rango, de 0 a 1.
 *
 * Las cifras de los reportes son fijas, pero tienen que responder al
 * filtro: si «hoy» y «30 días» muestran lo mismo, el modo desarrollo
 * miente sobre lo único que esa pantalla hace.
 */
function porcion(desde: string, hasta: string): number {
  const todo = VENTAS_POR_DIA.reduce((s, v) => s + v.total, 0);
  if (todo === 0) return 0;
  return diasEntreFechas(desde, hasta).reduce((s, v) => s + v.total, 0) / todo;
}

/** Días del período, contando las dos puntas, como los cuenta el núcleo. */
function diasEntre(desde: string, hasta: string): number {
  const a = new Date(`${desde}T00:00:00`);
  const b = new Date(`${hasta}T00:00:00`);
  const dias = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  return dias > 0 ? dias : 1;
}

/** La misma fecha corrida tantos días. */
function correr(fecha: string, dias: number): string {
  const f = new Date(`${fecha}T00:00:00`);
  f.setDate(f.getDate() + dias);
  return [
    f.getFullYear(),
    String(f.getMonth() + 1).padStart(2, '0'),
    String(f.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Espera corta, para que se noten los estados de «cargando». */
const respirar = () => new Promise((r) => setTimeout(r, 60));

function catalogoVenta() {
  return PRODUCTOS.filter((p) => p.activo).map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    categoria: p.categoria,
    presentacion: p.presentacion,
    envase: p.envase,
    existencia: p.existencia,
    precio_venta: p.precio_venta,
    busqueda: `${p.nombre} ${p.presentacion} ${p.codigo}`.toLowerCase(),
    codigos_barras: p.codigos_barras,
    empaques: p.empaques.filter((e) => e.para_venta && e.precio_venta !== null),
    // Para comprar sirve cualquier forma marcada, con precio o sin el.
    empaques_compra: p.empaques
      .filter((e) => e.para_compra)
      .map((e) => ({
        id: e.id, nombre: e.nombre, factor: e.factor, precio_venta: e.precio_venta,
      })),
  }));
}

interface GastoSimulado {
  id: number;
  fecha: string;
  categoria_id: number | null;
  categoria: string | null;
  concepto: string;
  monto: number;
  nota: string | null;
  usuario: string | null;
  anulado: boolean;
  motivo_anulacion: string | null;
}

const CATEGORIAS_GASTO = [
  { id: 1, nombre: 'Arriendo', fijo: true, activo: true, en_uso: 1 },
  { id: 2, nombre: 'Servicios públicos', fijo: true, activo: true, en_uso: 1 },
  { id: 3, nombre: 'Internet y teléfono', fijo: true, activo: true, en_uso: 1 },
  { id: 4, nombre: 'Sueldos', fijo: true, activo: true, en_uso: 1 },
  { id: 5, nombre: 'Bolsas y empaque', fijo: false, activo: true, en_uso: 1 },
  { id: 6, nombre: 'Seguridad social', fijo: true, activo: true, en_uso: 0 },
  { id: 7, nombre: 'Aseo', fijo: true, activo: true, en_uso: 0 },
  { id: 8, nombre: 'Impuestos y trámites', fijo: false, activo: true, en_uso: 0 },
  { id: 9, nombre: 'Mantenimiento', fijo: false, activo: true, en_uso: 0 },
  { id: 10, nombre: 'Transporte', fijo: false, activo: true, en_uso: 0 },
  { id: 11, nombre: 'Otros', fijo: false, activo: true, en_uso: 0 },
];

const GASTOS: GastoSimulado[] = [
  { id: 5, fecha: fechaHora(-1).slice(0, 10), categoria_id: 5,
    categoria: 'Bolsas y empaque', concepto: 'Bolsas', monto: 22_000,
    nota: null, usuario: 'Modo desarrollo', anulado: false, motivo_anulacion: null },
  { id: 4, fecha: fechaHora(-9).slice(0, 10), categoria_id: 4, categoria: 'Sueldos',
    concepto: 'Sueldo de Andrés', monto: 1_423_500, nota: 'quincena',
    usuario: 'Modo desarrollo', anulado: false, motivo_anulacion: null },
  { id: 3, fecha: fechaHora(-14).slice(0, 10), categoria_id: 3,
    categoria: 'Internet y teléfono', concepto: 'Internet', monto: 80_000,
    nota: null, usuario: 'Modo desarrollo', anulado: false, motivo_anulacion: null },
  { id: 2, fecha: fechaHora(-18).slice(0, 10), categoria_id: 2,
    categoria: 'Servicios públicos', concepto: 'Energía', monto: 220_000,
    nota: 'factura 88231', usuario: 'Modo desarrollo', anulado: false,
    motivo_anulacion: null },
  { id: 1, fecha: fechaHora(-20).slice(0, 10), categoria_id: 1, categoria: 'Arriendo',
    concepto: 'Arriendo del local', monto: 900_000, nota: null,
    usuario: 'Modo desarrollo', anulado: false, motivo_anulacion: null },
];

const CLIENTES = [
  { id: 1, nombre: 'Don Jairo', telefono: '3104567890', documento: null,
    nota: 'el de la esquina', cupo: 0, activo: true },
  { id: 2, nombre: 'la señora del 302', telefono: null, documento: null,
    nota: null, cupo: 100_000, activo: true },
  { id: 3, nombre: 'Taller de la esquina', telefono: null, documento: null,
    nota: null, cupo: 0, activo: true },
];

const CUENTAS = [
  { id: 1, cliente_id: 1, venta_id: 120, venta_numero: 120,
    fecha: fechaHora(-6), monto: 39_000, abonado: 0 },
  { id: 2, cliente_id: 1, venta_id: 124, venta_numero: 124,
    fecha: fechaHora(-2), monto: 25_000, abonado: 10_000 },
  { id: 3, cliente_id: 2, venta_id: 126, venta_numero: 126,
    fecha: fechaHora(-1), monto: 47_800, abonado: 0 },
];

const DEUDAS = [
  { compra_id: 1, numero: 'C-00045', proveedor_id: 1,
    proveedor: 'Distribuidora Bavaria', documento: 'F-8891',
    fecha: fechaHora(-3).slice(0, 10), vence: fechaHora(-1).slice(0, 10),
    total: 640_000, pagado: 200_000, vencida_hace: 1 },
  { compra_id: 2, numero: 'C-00046', proveedor_id: 2,
    proveedor: 'Surtimax Mayorista', documento: null,
    fecha: fechaHora(-1).slice(0, 10), vence: fechaHora(5).slice(0, 10),
    total: 320_000, pagado: 0, vencida_hace: -5 },
];

function itemsCatalogo(tipo: string) {
  const nombres = tipo === 'categorias' ? CATEGORIAS
    : tipo === 'marcas' ? MARCAS
      : tipo === 'envases' ? ENVASES
        : UNIDADES;
  return nombres.map((nombre, i) => ({
    id: i + 1,
    nombre,
    activo: true,
    en_uso: PRODUCTOS.filter((p) => (
      tipo === 'categorias' ? p.categoria === nombre
        : tipo === 'marcas' ? p.marca === nombre
          : tipo === 'envases' ? p.envase === nombre
            : p.unidad_base === nombre
    )).length,
  }));
}

function guardarProducto(entrada: Record<string, unknown>): number {
  const p = entrada as unknown as ProductoSim & { id: number | null };
  const empaques = (p.empaques ?? []).map((e) => ({
    ...e, id: e.id ?? nuevoId(),
  }));

  // Las mismas negativas del nucleo. Aceptar aqui lo que alla se rechaza
  // hace que en modo desarrollo todo parezca funcionar y la aplicacion
  // instalada falle: ya paso cinco veces.
  if (p.nombre === undefined || p.nombre.trim() === '') {
    throw { mensaje: 'El nombre no puede quedar vacio.', detalle: 'simulador' };
  }
  if (!empaques.some((e) => e.para_venta && (e.precio_venta ?? 0) > 0)) {
    throw {
      mensaje: 'El producto necesita al menos una forma de venta con precio.',
      detalle: 'simulador',
    };
  }

  if (p.id === null || p.id === undefined) {
    const id = nuevoId();
    PRODUCTOS.push({
      ...p, id, existencia: 0, activo: true, revisar: false,
      revisar_motivo: null, codigos_barras: [], empaques,
      costo_promedio: p.costo_promedio ?? null,
    });
    if (!CATEGORIAS.includes(p.categoria)) CATEGORIAS.push(p.categoria);
    if (p.marca !== null && p.marca !== undefined && !MARCAS.includes(p.marca)) {
      MARCAS.push(p.marca);
    }
    return id;
  }

  const i = PRODUCTOS.findIndex((x) => x.id === p.id);
  if (i >= 0) {
    const anterior = PRODUCTOS[i]!;
    PRODUCTOS[i] = {
      ...anterior, ...p, id: anterior.id, existencia: anterior.existencia,
      revisar: false, revisar_motivo: null, empaques,
    };
    if (!CATEGORIAS.includes(p.categoria)) CATEGORIAS.push(p.categoria);
  }
  return p.id;
}

/** Lo que responde cada comando. */
const RESPUESTAS: Record<string, (a: Record<string, unknown>) => unknown> = {
  estado_arranque: () => ({
    tiene_usuarios: true,
    nombre_negocio: CONFIGURACION.find((c) => c.clave === 'negocio.nombre')?.valor ?? '',
    minutos_inactividad: ajusteNumerico('sesion.minutos_inactividad', 15),
    stock_minimo_defecto: ajusteNumerico('inventario.stock_minimo_defecto', 3),
  }),
  iniciar_sesion: () => ({ usuario: USUARIO_DEV, permisos: PERMISOS }),
  cerrar_sesion: () => undefined,
  crear_primer_administrador: () => ({ usuario: USUARIO_DEV, permisos: PERMISOS }),

  listar_gastos: (a) => GASTOS.filter(
    (g) => g.fecha >= String(a['desde']) && g.fecha <= String(a['hasta']),
  ),
  categorias_de_gasto: () => CATEGORIAS_GASTO,

  registrar_gasto: (a) => {
    const g = a['gasto'] as Record<string, unknown>;
    const id = Math.max(0, ...GASTOS.map((x) => x.id)) + 1;
    const cat = CATEGORIAS_GASTO.find((c) => c.id === g['categoria_id']);
    GASTOS.unshift({
      id,
      fecha: String(g['fecha']),
      categoria_id: (g['categoria_id'] as number | null) ?? null,
      categoria: cat?.nombre ?? null,
      concepto: String(g['concepto']),
      monto: Number(g['monto']),
      nota: (g['nota'] as string | null) ?? null,
      usuario: 'Modo desarrollo',
      anulado: false,
      motivo_anulacion: null,
    });
    return id;
  },

  editar_gasto: (a) => {
    const g = a['gasto'] as Record<string, unknown>;
    const viejo = GASTOS.find((x) => x.id === g['id']);
    if (viejo !== undefined) {
      const cat = CATEGORIAS_GASTO.find((c) => c.id === g['categoria_id']);
      viejo.fecha = String(g['fecha']);
      viejo.categoria_id = (g['categoria_id'] as number | null) ?? null;
      viejo.categoria = cat?.nombre ?? null;
      viejo.concepto = String(g['concepto']);
      viejo.monto = Number(g['monto']);
      viejo.nota = (g['nota'] as string | null) ?? null;
    }
    return undefined;
  },

  anular_gasto: (a) => {
    const g = GASTOS.find((x) => x.id === a['gastoId']);
    if (g !== undefined) {
      g.anulado = true;
      g.motivo_anulacion = String(a['motivo']);
    }
    return undefined;
  },

  crear_categoria_gasto: (a) => {
    const id = Math.max(0, ...CATEGORIAS_GASTO.map((c) => c.id)) + 1;
    CATEGORIAS_GASTO.push({
      id, nombre: String(a['nombre']), fijo: Boolean(a['fijo']), activo: true, en_uso: 0,
    });
    return id;
  },

  quitar_categoria_gasto: (a) => {
    const i = CATEGORIAS_GASTO.findIndex((c) => c.id === a['categoriaId']);
    if (i >= 0) CATEGORIAS_GASTO.splice(i, 1);
    return undefined;
  },

  // --- Fiados y deudas ---------------------------------------------
  clientes_con_saldo: () => CLIENTES.map((c) => {
    const suyas = CUENTAS.filter((u) => u.cliente_id === c.id);
    const fiado = suyas.reduce((s, u) => s + u.monto, 0);
    const abonado = suyas.reduce((s, u) => s + u.abonado, 0);
    return { ...c, fiado, abonado, saldo: fiado - abonado, cuentas: suyas.length };
  }),

  cuentas_del_cliente: (a) => CUENTAS
    .filter((u) => u.cliente_id === a['clienteId'])
    .filter((u) => a['soloPendientes'] !== true || u.monto > u.abonado)
    .map((u) => ({ ...u, saldo: u.monto - u.abonado })),

  abonar: (a) => {
    const cuenta = CUENTAS.find((u) => u.id === a['cuentaId']);
    const monto = Number(a['monto']);
    if (cuenta !== undefined) cuenta.abonado += monto;
    const suyas = CUENTAS.filter((u) => u.cliente_id === cuenta?.cliente_id);
    return {
      abono_id: 1,
      saldo_cuenta: (cuenta?.monto ?? 0) - (cuenta?.abonado ?? 0),
      saldo_cliente: suyas.reduce((s, u) => s + (u.monto - u.abonado), 0),
      entro_a_caja: a['metodoPagoId'] === 1,
    };
  },

  compras_por_pagar: () => DEUDAS.filter((d) => d.total > d.pagado)
    .map((d) => ({ ...d, saldo: d.total - d.pagado })),

  pagar_compra: (a) => {
    const p = a['pago'] as Record<string, unknown>;
    const d = DEUDAS.find((x) => x.compra_id === p['compra_id']);
    if (d !== undefined) d.pagado += Number(p['monto']);
    return 1;
  },

  saldos_por_proveedor: () => {
    const por = new Map<number, { proveedor_id: number; nombre: string;
                                  saldo: number; compras: number }>();
    for (const d of DEUDAS) {
      if (d.total <= d.pagado) continue;
      const antes = por.get(d.proveedor_id);
      por.set(d.proveedor_id, {
        proveedor_id: d.proveedor_id,
        nombre: d.proveedor,
        saldo: (antes?.saldo ?? 0) + (d.total - d.pagado),
        compras: (antes?.compras ?? 0) + 1,
      });
    }
    return [...por.values()];
  },

  pagos_de_compra: (a) => (a['compraId'] === 1
    ? [{ id: 1, compra_id: 1, fecha: fechaHora(-2).slice(0, 10), monto: 200_000,
         metodo: 'Efectivo', usuario: 'Modo desarrollo', nota: null, anulado: false }]
    : []),

  anular_pago_compra: () => undefined,

  abonos_de_cuenta: (a) => (a['cuentaId'] === 2
    ? [{ id: 1, cuenta_id: 2, fecha: fechaHora(-1), monto: 10_000,
         metodo: 'Efectivo', usuario: 'Modo desarrollo', nota: null, anulado: false }]
    : []),

  anular_abono: () => undefined,
  guardar_cliente: (a) => Number((a['cliente'] as Record<string, unknown>)['id'] ?? 9),
  desactivar_cliente: () => undefined,
  reactivar_cliente: () => undefined,

  metodos_de_pago: () => [
    { id: 1, codigo: 'EFECTIVO', nombre: 'Efectivo', es_efectivo: true },
    { id: 2, codigo: 'TRANSFERENCIA', nombre: 'Transferencia', es_efectivo: false },
    { id: 3, codigo: 'TARJETA', nombre: 'Tarjeta', es_efectivo: false },
    { id: 4, codigo: 'FIADO', nombre: 'Fiado', es_efectivo: false },
  ],

  catalogo_venta: () => catalogoVenta(),

  agregar_empaque: (a) => {
    const p = PRODUCTOS.find((x) => x.id === a['productoId']);
    const id = Math.max(0, ...PRODUCTOS.flatMap((x) => x.empaques.map((e) => e.id))) + 1;
    const precio = a['precioVenta'] as number | null;
    const nueva = {
      id,
      nombre: String(a['nombre']),
      factor: Number(a['factor']),
      precio_venta: precio,
      para_venta: precio !== null,
      para_compra: true,
      predeterminado: false,
    };
    p?.empaques.push(nueva);
    return { id, nombre: nueva.nombre, factor: nueva.factor,
             precio_venta: precio, para_venta: nueva.para_venta, para_compra: true };
  },

  caja_abierta: () => (caja === null ? null : {
    id: caja.id, base_inicial: caja.base_inicial, abierta_por: 'Modo desarrollo',
    abierta_en: hoy(),
  }),

  abrir_caja: (a) => {
    const d = a['datos'] as { base_inicial?: number } | undefined;
    caja = {
      id: nuevoId(), base_inicial: Number(d?.base_inicial ?? 0), abierta: true,
      entradas: 0, salidas: 0, ventas_total: 0, ventas_cantidad: 0,
    };
    return {
      id: caja.id, base_inicial: caja.base_inicial,
      abierta_por: 'Modo desarrollo', abierta_en: hoy(),
    };
  },

  resumen_caja: () => {
    const c = caja ?? {
      base_inicial: 100_000, entradas: 0, salidas: 15_000,
      ventas_total: 57_800, ventas_cantidad: 12, id: 1,
    };
    return {
      caja_id: c.id,
      base_inicial: c.base_inicial,
      ventas_total: c.ventas_total,
      ventas_cantidad: c.ventas_cantidad,
      entradas: c.entradas,
      salidas: c.salidas,
      efectivo_esperado: c.base_inicial + c.ventas_total + c.entradas - c.salidas,
      por_metodo: [
        { metodo: 'Efectivo', es_efectivo: true, total: c.ventas_total, cantidad: c.ventas_cantidad },
      ],
    };
  },

  movimiento_caja: (a) => {
    if (caja === null) throw { mensaje: 'No hay una caja abierta.', detalle: 'sim' };
    // Los datos llegan anidados, como los manda la pantalla.
    const d = a['datos'] as { es_entrada: boolean; monto: number } | undefined;
    const monto = Number(d?.monto ?? 0);
    if (d?.es_entrada === true) caja.entradas += monto;
    else caja.salidas += monto;
    return undefined;
  },

  cerrar_caja: (a) => {
    const d = a['datos'] as { efectivo_contado?: number } | undefined;
    const esperado = caja === null ? 0
      : caja.base_inicial + caja.ventas_total + caja.entradas - caja.salidas;
    const contado = Number(d?.efectivo_contado ?? 0);
    caja = null;
    return { efectivo_esperado: esperado, efectivo_contado: contado,
             diferencia: contado - esperado };
  },

  registrar_venta: (a) => {
    const entrante = a['venta'] as {
      items?: { producto_id: number; empaque_id: number | null;
                cantidad: number; descuento: number }[];
      pagos?: { metodo_pago_id: number; monto: number; recibido: number | null }[];
      recargo?: { concepto: string; porcentaje: number | null; monto: number } | null;
    };
    const items = entrante.items ?? [];

    // Se calcula igual que el nucleo: el precio sale del empaque, y las
    // unidades que salen del inventario son cantidad x factor.
    const renglones = items.map((it) => {
      const p = PRODUCTOS.find((x) => x.id === it.producto_id);
      const emp = p?.empaques.find((e) => e.id === it.empaque_id);
      const precio = emp?.precio_venta ?? p?.precio_venta ?? 0;
      const factor = emp?.factor ?? 1;
      if (p !== undefined) p.existencia -= it.cantidad * factor;
      return {
        producto: `${p?.nombre ?? '?'} ${p?.presentacion ?? ''}`.trim(),
        empaque: emp?.nombre ?? 'Unidad',
        cantidad: it.cantidad,
        unidades: it.cantidad * factor,
        precio_unitario: precio,
        total: precio * it.cantidad - it.descuento,
      };
    });

    const subtotal = renglones.reduce((s, r) => s + r.total, 0);
    // El recargo se cobra sobre lo que quedo, igual que en el nucleo.
    const rec = entrante.recargo;
    const recargo = rec === null || rec === undefined ? 0
      : rec.porcentaje !== null && rec.porcentaje !== undefined && rec.porcentaje > 0
        ? Math.round((subtotal * rec.porcentaje) / 100)
        : Math.max(0, rec.monto);
    const numero = `V-${String(125 + ventas.length).padStart(6, '0')}`;
    const metodo = (entrante.pagos ?? [])[0]?.metodo_pago_id === 1
      ? 'Efectivo' : 'Transferencia';

    ventas = [{
      id: nuevoId(), numero, fecha: hoy(), total: subtotal + recargo,
      anulada: false, usuario: 'Modo desarrollo', metodo,
      articulos: items.length, renglones,
    }, ...ventas];

    if (caja !== null) {
      caja.ventas_cantidad += 1;
      if (metodo === 'Efectivo') caja.ventas_total += subtotal + recargo;
    }
    const pagado = (entrante.pagos ?? [])[0];
    return {
      id: ventas[0]!.id, numero: 125 + ventas.length, fecha: hoy(),
      usuario: 'Modo desarrollo',
      subtotal, descuento: 0,
      recargo,
      recargo_concepto: recargo > 0 ? (rec?.concepto ?? null) : null,
      impuesto: 0,
      total: subtotal + recargo,
      cambio: Math.max(0, (pagado?.recibido ?? 0) - (subtotal + recargo)),
      metodos: metodo,
      items: renglones,
    };
  },

  anular_venta: (a) => {
    const d = a['datos'] as { venta_id?: number; motivo?: string } | undefined;
    const v = ventas.find((x) => x.id === Number(d?.venta_id));
    if (v === undefined) {
      throw { mensaje: 'Esa venta no existe.', detalle: 'sim' };
    }
    if (v.anulada) {
      throw { mensaje: 'Esta venta ya estaba anulada.', detalle: 'sim' };
    }
    v.anulada = true;
    v.motivo = d?.motivo ?? '';
    // La mercancia vuelve y la plata sale de la caja, como en el nucleo.
    for (const r of v.renglones ?? []) {
      const p = PRODUCTOS.find((x) => `${x.nombre} ${x.presentacion}`.trim() === r.producto);
      if (p !== undefined) p.existencia += r.unidades;
    }
    if (caja !== null && v.metodo === 'Efectivo') caja.ventas_total -= v.total;
    return undefined;
  },

  // Filtra por el mismo dia que se muestra en pantalla, y respeta el
  // tope: sin esto, «hoy» listaba las ventas de ayer.
  historial_ventas: (a) => ventas.filter((v) => {
    const { desde, hasta } = rangoPedido(a);
    const dia = v.fecha.slice(0, 10);
    return dia >= desde && dia <= hasta;
  }).slice(0, Number(a['limite'] ?? 200)).map((v) => ({
    id: v.id,
    numero: Number(v.numero.replace(/\D/g, '')),
    // Como lo manda el nucleo: «2026-08-20 20:31», no ISO.
    fecha: `${v.fecha.slice(0, 10)} ${v.fecha.slice(11, 16)}`,
    usuario: v.usuario,
    subtotal: v.total,
    descuento: 0,
    total: v.total,
    anulada: v.anulada,
    motivo_anulacion: v.anulada ? (v.motivo ?? 'El cliente se arrepintió') : null,
    con_faltante: false,
    metodos: v.metodo,
    items: v.renglones ?? [
      { producto: 'PÓKER 330 ml', empaque: 'Six', cantidad: 1, unidades: 6,
        precio_unitario: 25_000, total: 25_000 },
      { producto: 'MARLBORO MEDIO', empaque: 'Unidad', cantidad: 3, unidades: 3,
        precio_unitario: 7_500, total: 22_500 },
    ],
  })),

  listar_productos: () => PRODUCTOS.filter((p) => p.activo),

  resumen_inventario: () => ({
    productos: PRODUCTOS.filter((p) => p.activo).length,
    unidades: PRODUCTOS.reduce((s, p) => s + p.existencia, 0),
    valorizado_costo: PRODUCTOS.reduce((s, p) => s + (p.costo_promedio ?? 0) * p.existencia, 0),
    valorizado_venta: PRODUCTOS.reduce((s, p) => s + p.precio_venta * p.existencia, 0),
    agotados: PRODUCTOS.filter((p) => p.existencia <= 0).length,
    bajo_minimo: PRODUCTOS.filter((p) => p.existencia > 0 && p.existencia <= p.stock_minimo).length,
    por_revisar: PRODUCTOS.filter((p) => p.revisar).length,
  }),

  listar_categorias: () => CATEGORIAS,

  listar_precios_especiales: (a) => {
    const id = Number(a['productoId']);
    return PRECIOS_ESPECIALES.filter((p) => p.producto_id === id);
  },

  poner_precio_especial: (a) => {
    const p = a['precio'] as {
      producto_id: number; empaque_id: number | null; precio: number;
      motivo: string | null; desde: string; hasta: string;
    };
    const prod = PRODUCTOS.find((x) => x.id === p.producto_id);
    const emp = prod?.empaques.find((e) => e.id === p.empaque_id);
    const id = nuevoId();
    const hoyStr = soloFecha(0);
    PRECIOS_ESPECIALES.unshift({
      id,
      producto_id: p.producto_id,
      producto: prod?.nombre ?? '',
      empaque_id: p.empaque_id,
      empaque: emp?.nombre ?? null,
      precio_normal: emp?.precio_venta ?? prod?.precio_venta ?? 0,
      precio: p.precio,
      motivo: p.motivo,
      desde: p.desde,
      hasta: p.hasta,
      activo: true,
      vigente_hoy: p.desde <= hoyStr && hoyStr <= p.hasta,
    });
    return id;
  },

  quitar_precio_especial: (a) => {
    const id = Number(a['precioId']);
    const i = PRECIOS_ESPECIALES.findIndex((p) => p.id === id);
    if (i >= 0) PRECIOS_ESPECIALES.splice(i, 1);
    return undefined;
  },
  listar_catalogo: (a) => itemsCatalogo(String(a['tipo'])),

  guardar_catalogo: (a) => {
    const tipo = String(a['tipo']);
    const nombre = String(a['nombre']);
    const destino = tipo === 'categorias' ? CATEGORIAS
      : tipo === 'marcas' ? MARCAS : tipo === 'envases' ? ENVASES : UNIDADES;
    const id = a['id'];
    if (id === null || id === undefined) {
      if (destino.includes(nombre)) {
        throw { mensaje: `«${nombre}» ya está en la lista.`, detalle: 'sim' };
      }
      destino.push(nombre);
    } else {
      destino[Number(id) - 1] = nombre;
    }
    return destino.length;
  },

  desactivar_catalogo: () => undefined,

  crear_producto: (a) => guardarProducto(a['producto'] as Record<string, unknown>),
  editar_producto: (a) => { guardarProducto(a['producto'] as Record<string, unknown>); },

  desactivar_producto: (a) => {
    const p = PRODUCTOS.find((x) => x.id === Number(a['productoId']));
    if (p !== undefined) p.activo = false;
    return undefined;
  },

  ajustar_existencia: (a) => {
    const ajuste = a['ajuste'] as { producto_id: number; cantidad: number };
    const p = PRODUCTOS.find((x) => x.id === ajuste.producto_id);
    if (p === undefined) throw { mensaje: 'Ese producto no existe.', detalle: 'sim' };
    const antes = p.existencia;
    p.existencia += ajuste.cantidad;
    return { producto: p.nombre, existencia_antes: antes, existencia_despues: p.existencia };
  },

  asociar_codigo_barras: (a) => {
    const p = PRODUCTOS.find((x) => x.id === Number(a['productoId']));
    if (p !== undefined) p.codigos_barras.push(String(a['codigo']));
    return undefined;
  },
  quitar_codigo_barras: (a) => {
    const p = PRODUCTOS.find((x) => x.id === Number(a['productoId']));
    if (p !== undefined) {
      p.codigos_barras = p.codigos_barras.filter((c) => c !== String(a['codigo']));
    }
    return undefined;
  },

  listar_proveedores: () => PROVEEDORES.filter((p) => p.activo),

  guardar_proveedor: (a) => {
    const p = a['proveedor'] as Partial<ProveedorSim> & { id: number | null };
    if (p.id === null || p.id === undefined) {
      const id = nuevoId();
      PROVEEDORES.push({
        id, nombre: p.nombre ?? '', nit: p.nit ?? null, telefono: p.telefono ?? null,
        contacto: p.contacto ?? null, direccion: p.direccion ?? null,
        notas: p.notas ?? null, activo: true, productos: 0,
      });
      return id;
    }
    const i = PROVEEDORES.findIndex((x) => x.id === p.id);
    if (i >= 0) PROVEEDORES[i] = { ...PROVEEDORES[i]!, ...p } as ProveedorSim;
    return p.id;
  },

  desactivar_proveedor: (a) => {
    const p = PROVEEDORES.find((x) => x.id === Number(a['proveedorId']));
    if (p !== undefined) p.activo = a['activo'] === true;
    return undefined;
  },

  listar_compras: () => compras,

  registrar_compra: (a) => {
    const compra = a['compra'] as {
      proveedor_id?: number;
      documento?: string | null;
      items?: { producto_id: number; empaque_id: number | null;
                cantidad: number; costo_empaque: number }[];
    };
    const items = compra.items ?? [];

    // Recibir una canasta suma 30, no 1: es la regla central del modelo.
    const recibidos = items.map((it) => {
      const p = PRODUCTOS.find((x) => x.id === it.producto_id);
      const emp = p?.empaques.find((e) => e.id === it.empaque_id);
      const factor = emp?.factor ?? 1;
      const unidades = it.cantidad * factor;
      if (p !== undefined) {
        p.existencia += unidades;
        // El costo promedio se pondera por unidades, como en el nucleo.
        const costoUnitario = Math.floor(it.costo_empaque / factor);
        const antes = p.costo_promedio ?? costoUnitario;
        const existiaAntes = Math.max(0, p.existencia - unidades);
        p.costo_promedio = existiaAntes + unidades === 0 ? costoUnitario
          : Math.round((antes * existiaAntes + costoUnitario * unidades)
                       / (existiaAntes + unidades));
      }
      return {
        producto: p?.nombre ?? '?',
        empaque: emp?.nombre ?? 'Unidad',
        cantidad: it.cantidad,
        unidades,
        costo_unitario: Math.floor(it.costo_empaque / factor),
        margen: p !== undefined && p.precio_venta > 0
          ? Math.round(((p.precio_venta - it.costo_empaque / factor) / p.precio_venta) * 100)
          : null,
      };
    });

    const total = items.reduce((s, it) => s + it.cantidad * it.costo_empaque, 0);
    const unidades = recibidos.reduce((s, r) => s + r.unidades, 0);
    const numero = `C-${String(46 + compras.length).padStart(5, '0')}`;
    const proveedor = PROVEEDORES.find((p) => p.id === compra.proveedor_id);

    compras = [{
      id: nuevoId(), numero, fecha: soloFecha(0),
      proveedor: proveedor?.nombre ?? 'Sin proveedor',
      documento: compra.documento ?? null, total, anulada: false,
      articulos: items.reduce((s, it) => s + it.cantidad, 0),
      entradas: items.map((it, i) => ({
        producto_id: it.producto_id, unidades: recibidos[i]!.unidades,
      })),
    }, ...compras];

    return {
      id: compras[0]!.id, numero, subtotal: total, descuento: 0, total,
      unidades, items: recibidos,
    };
  },

  anular_compra: (a) => {
    const c = compras.find((x) => x.id === Number(a['compraId']));
    if (c === undefined) {
      throw { mensaje: 'Esa compra no existe.', detalle: 'sim' };
    }
    if (c.anulada) {
      throw { mensaje: 'Esta compra ya estaba anulada.', detalle: 'sim' };
    }
    c.anulada = true;
    // La mercancia que habia entrado sale del inventario.
    for (const e of c.entradas ?? []) {
      const p = PRODUCTOS.find((x) => x.id === e.producto_id);
      if (p !== undefined) p.existencia -= e.unidades;
    }
    return undefined;
  },

  precios_de_producto: () => [
    { proveedor: 'Depósito La 30', empaque: 'Canasta', precio: 60_000,
      precio_unitario: 2_000, fecha: hoy(-5), mejor: true },
    { proveedor: 'Distribuidora Bavaria', empaque: 'Six', precio: 13_200,
      precio_unitario: 2_200, fecha: hoy(-2), mejor: false },
    { proveedor: 'Surtimax Mayorista', empaque: 'Unidad', precio: 2_400,
      precio_unitario: 2_400, fecha: hoy(-9), mejor: false },
  ],

  tablero: () => ({
    hoy: {
      total: 187_400, cantidad: 23, ticket_promedio: 8_148,
      total_semana_pasada: 154_900, unidades: 61,
    },
    // Catorce dias como los pide el nucleo, y con dos huecos a proposito:
    // el nucleo agrupa las ventas que existen, asi que un dia cerrado no
    // llega en la lista. Conviene ver que hace la grafica con eso.
    ultimos_dias: VENTAS_POR_DIA,
    mas_vendidos: PRODUCTOS.slice(0, 5).map((p, i) => ({
      nombre: p.nombre, presentacion: p.presentacion,
      unidades: 40 - i * 6, total: (40 - i * 6) * p.precio_venta,
    })),
    ventas_recientes: ventas.slice(0, 5).map((v) => ({
      id: v.id, numero: Number(v.numero.replace(/\D/g, '')), total: v.total,
      // El nucleo manda solo la hora, no la fecha entera.
      hora: v.fecha.slice(11, 16), usuario: v.usuario,
      anulada: v.anulada, articulos: v.articulos,
    })),
    alertas: PRODUCTOS
      .filter((p) => p.existencia <= p.stock_minimo)
      .map((p) => ({
        id: p.id, nombre: p.nombre, presentacion: p.presentacion,
        existencia: p.existencia, stock_minimo: p.stock_minimo,
        agotado: p.existencia <= 0,
      })),
    agotados: PRODUCTOS.filter((p) => p.existencia <= 0).length,
    bajo_minimo: PRODUCTOS.filter(
      (p) => p.existencia > 0 && p.existencia <= p.stock_minimo).length,
    utilidad_estimada: 1_630_000,
    credito: {
      fiado_hoy: 47_800,
      por_cobrar: CUENTAS.reduce((s, c) => s + (c.monto - c.abonado), 0),
      por_cobrar_viejo: 39_000,
      deudores: new Set(
        CUENTAS.filter((c) => c.monto > c.abonado).map((c) => c.cliente_id),
      ).size,
      por_pagar: DEUDAS.reduce((s, d) => s + (d.total - d.pagado), 0),
      por_pagar_vencido: DEUDAS.filter((d) => d.vencida_hace > 0)
        .reduce((s, d) => s + (d.total - d.pagado), 0),
      compras_vencidas: DEUDAS.filter((d) => d.vencida_hace > 0).length,
    },
  }),

  leer_configuracion: () => CONFIGURACION.map((a) => ({ ...a })),

  // Se guarda de verdad. Devolver `undefined` y olvidarlo hacia que
  // guardar pareciera funcionar y al volver a entrar estuviera todo como
  // antes, que es peor que no dejar guardar.
  guardar_configuracion: (a) => {
    const cambios = (a['cambios'] ?? []) as { clave: string; valor: string }[];
    for (const { clave, valor } of cambios) {
      const fila = CONFIGURACION.find((c) => c.clave === clave);
      if (fila === undefined) CONFIGURACION.push({ clave, valor });
      else fila.valor = valor;
    }
    return undefined;
  },

  listar_usuarios: () => [
    { ...USUARIO_DEV },
    { id: 2, usuario: 'maria', nombre: 'María', rol: 'Cajero',
      activo: true, ultimo_ingreso: hoy(-1) },
  ],
  crear_usuario: () => undefined,
  desactivar_usuario: () => undefined,
  restablecer_contrasena: () => undefined,

  // El nucleo devuelve el campo como `usuario`, no `usuario_nombre`: asi
  // se llama en la struct de Rust aunque la columna sea la otra.
  leer_auditoria: () => [
    { id: 3, fecha: fechaHora(), usuario: 'Modo desarrollo', accion: 'CREAR_PRODUCTO',
      entidad: 'productos', entidad_id: 11, descripcion: 'Alta de HIELO Bolsa' },
    { id: 2, fecha: fechaHora(-1), usuario: 'Modo desarrollo', accion: 'ANULAR_VENTA',
      entidad: 'ventas', entidad_id: 2, descripcion: 'Anulada: cliente se arrepintió' },
    { id: 1, fecha: fechaHora(-3), usuario: 'Modo desarrollo', accion: 'REGISTRAR_COMPRA',
      // En pesos, como lo escribe el nucleo desde que la auditoria
      // formatea el dinero en vez de soltar el entero.
      entidad: 'compras', entidad_id: 1, descripcion: 'Compra C-00045 por $640.000' },
  ],

  listar_respaldos: () => RESPALDOS,
  estado_respaldos: () => ({
    total: RESPALDOS.length,
    ultimo: RESPALDOS[0] ?? null,
    dias_sin_respaldo: 1,
    necesita_respaldo: false,
    carpeta: 'C:\\Users\\…\\AppData\\Roaming\\PuntoDeVenta\\respaldos',
  }),
  crear_respaldo: () => {
    const nuevo = {
      archivo: `tribuna-${soloFecha(0)}.db`,
      ruta: `C:\\…\\respaldos\\tribuna-${soloFecha(0)}.db`,
      tamano_bytes: 2_310_144, creado: hoy(), verificado: false,
    };
    RESPALDOS.unshift(nuevo);
    return nuevo;
  },
  // Devuelve un booleano pelado, como el nucleo.
  verificar_respaldo: (a) => {
    const r = RESPALDOS.find((x) => x.ruta === String(a['ruta']));
    if (r !== undefined) r.verificado = true;
    return true;
  },
  restaurar_respaldo: () => undefined,

  deshacer_ajuste: () => {
    // El kardex simulado trae un solo ajuste, de -2. Deshacerlo devuelve
    // esas dos unidades a la existencia.
    const p = PRODUCTOS[0];
    if (p !== undefined) p.existencia += 2;
    return { producto: p?.nombre ?? '', cantidad_devuelta: 2 };
  },

  // El primer dia con movimiento: en el simulador, la carga inicial.
  // El dia mas viejo con movimiento, como lo saca el nucleo, y no una
  // fecha inventada: si arranca despues de la primera venta, «Todo»
  // muestra menos que «30 dias» y se lee como si el filtro fallara.
  primer_dia_con_movimiento: () => [
    ...VENTAS_POR_DIA.filter((v) => v.total > 0).map((v) => v.fecha),
    ...compras.map((c) => c.fecha),
  ].sort()[0] ?? soloFecha(0),

  historial_de_precios: (a) => {
    const p = PRODUCTOS.find((x) => x.id === a['productoId']) ?? PRODUCTOS[0];
    if (a['productoId'] !== undefined && a['productoId'] !== 1) return [];
    return [
      { id: 3, fecha: fechaHora(-2), producto: p?.nombre ?? '', empaque: 'Six',
        precio_anterior: 25_000, precio_nuevo: 26_000, variacion: 4,
        motivo: 'Cambio manual', usuario: 'Modo desarrollo' },
      { id: 2, fecha: fechaHora(-20), producto: p?.nombre ?? '', empaque: null,
        precio_anterior: 3_000, precio_nuevo: 3_900, variacion: 30,
        motivo: 'Cambio manual', usuario: 'Modo desarrollo' },
      { id: 1, fecha: fechaHora(-60), producto: p?.nombre ?? '', empaque: null,
        precio_anterior: 2_700, precio_nuevo: 3_000, variacion: 11,
        motivo: 'Cambio manual', usuario: 'Modo desarrollo' },
    ];
  },

  reporte_kardex: (a) => {
    const p = PRODUCTOS.find((x) => x.id === Number(a['productoId']));
    if (p === undefined) return [];
    // De lo mas nuevo a lo mas viejo, como lo devuelve el nucleo.
    // `se_puede_deshacer` solo en los ajustes manuales, como en el nucleo.
    return [
      { id: 4, fecha: fechaHora(), producto: p.nombre, tipo: 'VENTA', cantidad: -6,
        existencia_despues: p.existencia, motivo: 'Venta 128',
        usuario: 'Modo desarrollo', se_puede_deshacer: false },
      { id: 3, fecha: fechaHora(-1), producto: p.nombre, tipo: 'AJUSTE', cantidad: -2,
        existencia_despues: p.existencia + 6, motivo: 'Se rompieron en el estante',
        usuario: 'Modo desarrollo', se_puede_deshacer: true },
      { id: 2, fecha: fechaHora(-3), producto: p.nombre, tipo: 'COMPRA', cantidad: 60,
        existencia_despues: p.existencia + 8, motivo: 'Compra C-00045',
        usuario: 'Modo desarrollo', se_puede_deshacer: false },
      { id: 1, fecha: fechaHora(-9), producto: p.nombre, tipo: 'IMPORTACION', cantidad: 38,
        existencia_despues: 38, motivo: 'Carga inicial',
        usuario: 'Modo desarrollo', se_puede_deshacer: false },
    ];
  },
  estado_de_resultados: (a) => {
    const { desde, hasta } = rangoPedido(a);
    const dias = diasEntre(desde, hasta);
    // Las cifras de ejemplo son fijas; el filtro es lo que manda, asi
    // que se reparten segun lo que caiga dentro del periodo.
    const parte = porcion(desde, hasta);
    const repartir = (n: number) => Math.round(n * parte);

    // Se parte de todo lo que paso por caja, para que la cascada cierre:
    // registradas - descuentos - anuladas = netas.
    const descuentos = repartir(86_000);
    const anulaciones = repartir(234_000);
    const ventasNetas = repartir(5_054_000);
    const ventasRegistradas = ventasNetas + descuentos + anulaciones;
    const costo = repartir(3_190_000);
    const utilidadBruta = ventasNetas - costo;
    const mermas = [
      { motivo: 'Se rompieron en el estante', unidades: 9, costo: 23_400 },
      { motivo: 'Vencidas', unidades: 4, costo: 16_800 },
      { motivo: 'Conteo físico', unidades: 3, costo: 7_800 },
    ]
      .map((m) => ({
        ...m, unidades: repartir(m.unidades), costo: repartir(m.costo),
      }))
      .filter((m) => m.costo > 0);
    const totalMerma = mermas.reduce((s, m) => s + m.costo, 0);
    const ajustada = utilidadBruta - totalMerma;
    // Agrupados por categoria, como los manda el nucleo desde que los
    // gastos son registros con fecha y no cifras mensuales. Solo los del
    // periodo: un arriendo de marzo no es gasto de esta semana.
    const gastos = GASTOS.filter(
      (g) => !g.anulado && g.fecha >= desde && g.fecha <= hasta,
    ).reduce<
      { concepto: string; del_periodo: number; cuantos: number }[]
    >((acc, g) => {
      const nombre = g.categoria ?? 'Sin categoría';
      const fila = acc.find((f) => f.concepto === nombre);
      if (fila === undefined) acc.push({ concepto: nombre, del_periodo: g.monto, cuantos: 1 });
      else { fila.del_periodo += g.monto; fila.cuantos += 1; }
      return acc;
    }, []);
    const totalGastos = gastos.reduce((s, g) => s + g.del_periodo, 0);
    const operacional = ajustada - totalGastos;

    const categorias = [
      { categoria: 'Cervezas', ventas: 2_950_000, costo: 1_980_000 },
      { categoria: 'Licores', ventas: 1_120_000, costo: 810_000 },
      { categoria: 'Mecato', ventas: 430_000, costo: 260_000 },
      { categoria: 'Gaseosas', ventas: 320_000, costo: 140_000 },
      { categoria: 'Cigarrillos', ventas: 234_000, costo: 0 },
    ]
      .map((c) => ({
        ...c, ventas: repartir(c.ventas), costo: repartir(c.costo),
      }))
      .filter((c) => c.ventas > 0);
    const utilidadTotal = categorias.reduce((s, c) => s + (c.ventas - c.costo), 0);
    /** Sin ventas no hay margen: cero, nunca `NaN` en la pantalla. */
    const sobre = (parcial: number, total: number) =>
      total === 0 ? 0 : Math.round((parcial / total) * 100);
    const ventasContadas = repartir(312);

    return {
      desde,
      hasta,
      dias,

      ventas_registradas: ventasRegistradas,
      descuentos,
      anulaciones,
      ventas_netas: ventasNetas,
      impuestos: 0,

      costo_de_ventas: costo,
      utilidad_bruta: utilidadBruta,
      margen_bruto: sobre(utilidadBruta, ventasNetas),

      mermas,
      total_merma: totalMerma,
      utilidad_bruta_ajustada: ajustada,

      gastos,
      total_gastos: totalGastos,
      utilidad_operacional: operacional,
      margen_operacional: sobre(operacional, ventasNetas),

      por_categoria: categorias.map((c) => ({
        ...c,
        utilidad: c.ventas - c.costo,
        margen: sobre(c.ventas - c.costo, c.ventas),
        peso: sobre(c.ventas - c.costo, utilidadTotal),
      })),
      // El mismo número de días, justo antes: es contra eso que se compara.
      anterior: {
        desde: correr(desde, -dias),
        hasta: correr(desde, -1),
        ventas_netas: Math.round(
          5_054_000 * porcion(correr(desde, -dias), correr(desde, -1))),
        utilidad_bruta: Math.round(
          1_864_000 * porcion(correr(desde, -dias), correr(desde, -1))),
        utilidad_operacional: Math.round(
          292_000 * porcion(correr(desde, -dias), correr(desde, -1))),
      },
      punto_de_equilibrio: utilidadBruta === 0 ? 0 : Math.round(
        ((totalGastos + totalMerma) * ventasNetas) / utilidadBruta),
      ventas_contadas: ventasContadas,
      unidades_vendidas: repartir(1_847),
      ticket_promedio: ventasContadas === 0
        ? 0
        : Math.round(ventasNetas / ventasContadas),

      fiado_del_periodo: repartir(101_800 + 25_000),
      fiado_sin_cobrar: CUENTAS.reduce((s, c) => s + (c.monto - c.abonado), 0),
      renglones_sin_costo: repartir(4),
      ventas_sin_costo: repartir(234_000),
    };
  },

  importar_productos: () => ({ creados: 0, actualizados: 0 }),
};

/**
 * Filas de ejemplo para poder mirar cada reporte con datos dentro.
 *
 * Todas responden al período: es lo único que estas pantallas hacen, y
 * un simulador que devuelve lo mismo para «hoy» y para «30 días» hace
 * creer que el filtro está roto cuando el que no filtra es él.
 */
const REPORTES: Record<string, (a: Record<string, unknown>) => unknown[]> = {
  reporte_ventas_por_dia: (a) => {
    const { desde, hasta } = rangoPedido(a);
    return diasEntreFechas(desde, hasta)
      .filter((v) => v.total > 0)
      .map((v) => ({
        fecha: v.fecha,
        ventas: v.cantidad,
        unidades: v.cantidad * 3,
        total: v.total,
      }));
  },

  reporte_ventas_por_producto: (a) => {
    const { desde, hasta } = rangoPedido(a);
    const parte = porcion(desde, hasta);
    return PRODUCTOS.slice(0, 8)
      .map((p, i) => {
        const unidades = Math.round((64 - i * 7) * parte);
        return {
          producto: p.nombre,
          presentacion: p.presentacion,
          categoria: p.categoria,
          unidades,
          total: unidades * p.precio_venta,
          utilidad: Math.round(unidades * (p.precio_venta - (p.costo_promedio ?? 0))),
        };
      })
      .filter((f) => f.unidades > 0);
  },

  reporte_ventas_por_categoria: (a) => {
    const { desde, hasta } = rangoPedido(a);
    const parte = porcion(desde, hasta);
    const filas = [
      { categoria: 'Cervezas', unidades: 742, total: 2_950_000 },
      { categoria: 'Licores', unidades: 38, total: 1_120_000 },
      { categoria: 'Mecato', unidades: 121, total: 430_000 },
      { categoria: 'Gaseosas', unidades: 58, total: 320_000 },
      { categoria: 'Cigarrillos', unidades: 31, total: 234_000 },
    ]
      .map((f) => ({
        ...f,
        unidades: Math.round(f.unidades * parte),
        total: Math.round(f.total * parte),
      }))
      .filter((f) => f.total > 0);
    const suma = filas.reduce((s, f) => s + f.total, 0);
    return filas.map((f) => ({
      ...f,
      participacion: suma === 0 ? 0 : Math.round((f.total / suma) * 100),
    }));
  },

  reporte_ventas_por_usuario: (a) => {
    const { desde, hasta } = rangoPedido(a);
    const parte = porcion(desde, hasta);
    return [
      { usuario: 'Modo desarrollo', ventas: 214, total: 3_480_000, anuladas: 2 },
      { usuario: 'María', ventas: 98, total: 1_574_000, anuladas: 1 },
    ]
      .map((u) => ({
        ...u,
        ventas: Math.round(u.ventas * parte),
        total: Math.round(u.total * parte),
        anuladas: Math.round(u.anuladas * parte),
      }))
      .filter((u) => u.ventas > 0);
  },

  reporte_cierres_de_caja: (a) => {
    const { desde, hasta } = rangoPedido(a);
    return [0, 1, 2, 3]
      .map((d) => ({
        apertura: soloFecha(-d),
        usuario: d % 2 === 0 ? 'Modo desarrollo' : 'María',
        base_inicial: 100_000,
        observaciones: d === 1 ? 'Faltó plata del domicilio' : null,
        ventas: [187_400, 203_100, 154_900, 176_800][d]!,
        esperado: 100_000 + [187_400, 203_100, 154_900, 176_800][d]!,
        contado: 100_000 + [187_400, 203_100, 154_900, 176_800][d]! + [0, -2_000, 0, 5_000][d]!,
        diferencia: [0, -2_000, 0, 5_000][d]!,
      }))
      .filter((c) => c.apertura >= desde && c.apertura <= hasta);
  },
};

export async function pedirSimulado<T>(
  comando: string,
  argumentos?: Record<string, unknown>,
): Promise<T> {
  await respirar();

  const reporte = REPORTES[comando];
  if (reporte !== undefined) return reporte(argumentos ?? {}) as T;

  const responder = RESPUESTAS[comando];
  if (responder === undefined) {
    console.warn(`[simulador] «${comando}» no está simulado; devuelvo null.`);
    return null as T;
  }
  return responder(argumentos ?? {}) as T;
}

/** La sesión que el modo desarrollo abre sin preguntar. */
export const SESION_DEV = { usuario: USUARIO_DEV, permisos: PERMISOS };
