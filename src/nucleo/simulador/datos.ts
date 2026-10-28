/**
 * Datos de mentira para el modo de desarrollo.
 *
 * Se parecen a los de la licorera —cervezas por six y por canasta, mecato
 * sin volumen, dos productos con el mismo nombre— porque un simulador con
 * datos comodos esconde justo los problemas que uno quiere encontrar
 * mirando la pantalla.
 *
 * NADA de esto llega a la aplicacion instalada: el modulo entero se
 * excluye del build de produccion.
 */

export interface EmpaqueSim {
  id: number;
  nombre: string;
  factor: number;
  precio_venta: number | null;
  para_venta: boolean;
  para_compra: boolean;
  predeterminado: boolean;
}

export interface ProductoSim {
  id: number;
  codigo: string;
  nombre: string;
  categoria: string;
  marca: string | null;
  presentacion: string;
  volumen_ml: number | null;
  envase: string | null;
  unidad_base: string;
  existencia: number;
  precio_venta: number;
  costo_promedio: number | null;
  stock_minimo: number;
  stock_maximo: number | null;
  revisar: boolean;
  revisar_motivo: string | null;
  empaques: EmpaqueSim[];
  codigos_barras: string[];
  activo: boolean;
}

let siguienteId = 100;
export const nuevoId = () => (siguienteId += 1);

function producto(p: Partial<ProductoSim> & {
  id: number; codigo: string; nombre: string; categoria: string;
  precio_venta: number; existencia: number;
}): ProductoSim {
  return {
    marca: null,
    presentacion: '',
    volumen_ml: null,
    envase: null,
    unidad_base: 'UNIDAD',
    costo_promedio: null,
    stock_minimo: 6,
    stock_maximo: null,
    revisar: false,
    revisar_motivo: null,
    codigos_barras: [],
    activo: true,
    empaques: [{
      id: nuevoId(), nombre: 'Unidad', factor: 1,
      precio_venta: p.precio_venta, para_venta: true, para_compra: true,
      predeterminado: true,
    }],
    ...p,
  };
}

function conSix(p: ProductoSim, precioSix: number, precioCanasta?: number): ProductoSim {
  p.empaques.push({
    id: nuevoId(), nombre: 'Six', factor: 6, precio_venta: precioSix,
    para_venta: true, para_compra: true, predeterminado: false,
  });
  if (precioCanasta !== undefined) {
    p.empaques.push({
      id: nuevoId(), nombre: 'Canasta', factor: 30, precio_venta: precioCanasta,
      para_venta: true, para_compra: true, predeterminado: false,
    });
  }
  return p;
}

export const PRODUCTOS: ProductoSim[] = [
  conSix(producto({
    id: 1, codigo: 'CER-POKER-330B', nombre: 'PÓKER', categoria: 'Cervezas',
    marca: 'Bavaria', presentacion: '330 ml', volumen_ml: 330, envase: 'BOTELLA',
    precio_venta: 3_900, costo_promedio: 2_600, existencia: 38, stock_minimo: 30,
    codigos_barras: ['7702004003515'],
  }), 25_000, 108_000),

  conSix(producto({
    id: 2, codigo: 'CER-AGUILA-330B', nombre: 'ÁGUILA', categoria: 'Cervezas',
    marca: 'Bavaria', presentacion: '330 ml', volumen_ml: 330, envase: 'BOTELLA',
    precio_venta: 3_900, costo_promedio: 2_600, existencia: 4, stock_minimo: 30,
  }), 23_400),

  conSix(producto({
    id: 3, codigo: 'CER-CORONA-330B', nombre: 'CORONA', categoria: 'Cervezas',
    marca: 'Grupo Modelo', presentacion: '330 ml', volumen_ml: 330, envase: 'BOTELLA',
    precio_venta: 6_500, costo_promedio: 4_800, existencia: 24, stock_minimo: 12,
  }), 38_000),

  producto({
    id: 4, codigo: 'CER-CORONA-269L', nombre: 'CORONA', categoria: 'Cervezas',
    marca: 'Grupo Modelo', presentacion: '269 ml', volumen_ml: 269, envase: 'LATA',
    precio_venta: 5_500, costo_promedio: 4_100, existencia: 18, stock_minimo: 12,
  }),

  producto({
    id: 5, codigo: 'LIC-AGUARDIENTE-750', nombre: 'AGUARDIENTE ANTIOQUEÑO',
    categoria: 'Licores', marca: 'FLA', presentacion: '750 ml', volumen_ml: 750,
    envase: 'BOTELLA', precio_venta: 52_000, costo_promedio: 41_000,
    existencia: 9, stock_minimo: 4,
  }),

  producto({
    id: 6, codigo: 'LIC-RON-MEDIA', nombre: 'RON VIEJO DE CALDAS',
    categoria: 'Licores', marca: 'ILC', presentacion: 'Media', volumen_ml: 375,
    envase: 'BOTELLA', precio_venta: 32_000, costo_promedio: 24_500,
    existencia: 0, stock_minimo: 3,
  }),

  // Las dos del Excel que comparten nombre: aqui se ven distinguidas por
  // el precio, que es lo unico que las separa.
  producto({
    id: 7, codigo: 'MEC-MARGARITA-1', nombre: 'MARGARITA', categoria: 'Mecato',
    precio_venta: 3_500, existencia: 14, stock_minimo: 10,
    revisar: true, revisar_motivo: 'Dos productos con el mismo nombre y precio distinto',
  }),
  producto({
    id: 8, codigo: 'MEC-MARGARITA-2', nombre: 'MARGARITA', categoria: 'Mecato',
    precio_venta: 10_000, existencia: 6, stock_minimo: 5,
    revisar: true, revisar_motivo: 'Dos productos con el mismo nombre y precio distinto',
  }),

  producto({
    id: 9, codigo: 'CIG-MARLBORO-MEDIO', nombre: 'MARLBORO', categoria: 'Cigarrillos',
    marca: 'Philip Morris', presentacion: 'MEDIO', precio_venta: 7_500,
    costo_promedio: 6_200, existencia: 22, stock_minimo: 10,
  }),

  producto({
    id: 10, codigo: 'GAS-COCACOLA-1500', nombre: 'COCA-COLA', categoria: 'Gaseosas',
    marca: 'Coca-Cola', presentacion: '1.5 L', volumen_ml: 1_500, envase: 'BOTELLA',
    precio_venta: 5_800, costo_promedio: 4_300, existencia: 11, stock_minimo: 6,
  }),

  producto({
    id: 11, codigo: 'HIE-HIELO-KILO', nombre: 'HIELO', categoria: 'Otros',
    presentacion: '2 kg', unidad_base: 'KILO', envase: 'BOLSA',
    precio_venta: 4_000, costo_promedio: 1_800, existencia: 40, stock_minimo: 20,
  }),
];

export const CATEGORIAS = [
  'Cervezas', 'Licores', 'Mecato', 'Cigarrillos', 'Gaseosas', 'Otros',
];
export const MARCAS = [
  'Bavaria', 'Grupo Modelo', 'FLA', 'ILC', 'Philip Morris', 'Coca-Cola',
];
export const ENVASES = [
  'BOTELLA', 'LATA', 'TETRAPAK', 'GARRAFA', 'CAJA', 'BOLSA', 'PAQUETE',
  'SOBRE', 'BARRIL', 'VASO', 'NINGUNO',
];
export const UNIDADES = ['UNIDAD', 'GRAMO', 'KILO', 'ML', 'LITRO'];

export interface ProveedorSim {
  id: number;
  nombre: string;
  nit: string | null;
  telefono: string | null;
  contacto: string | null;
  direccion: string | null;
  notas: string | null;
  activo: boolean;
  productos: number;
}

export const PROVEEDORES: ProveedorSim[] = [
  {
    id: 1, nombre: 'Distribuidora Bavaria', nit: '860005224-6',
    telefono: '318 555 0142', contacto: 'Don Jairo', direccion: 'Calle 45 #12-30',
    notas: 'Pasa los martes y viernes en la mañana.', activo: true, productos: 2,
  },
  {
    id: 2, nombre: 'Surtimax Mayorista', nit: null,
    telefono: '310 444 8890', contacto: 'Marcela', direccion: null,
    notas: null, activo: true, productos: 4,
  },
  {
    id: 3, nombre: 'Depósito La 30', nit: null, telefono: '312 777 1020',
    contacto: null, direccion: 'Carrera 30 #8-15', notas: 'Más barato en canasta.',
    activo: true, productos: 3,
  },
];
