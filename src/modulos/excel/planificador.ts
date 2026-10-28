/**
 * Decide que va a pasar en la base de datos, sin tocarla.
 *
 * Es lo que alimenta la vista previa: antes de escribir nada, el usuario
 * ve cuantos productos se crean, cuales se actualizan y que campo cambia
 * en cada uno. Nada se aplica hasta que acepte.
 *
 * Funcion pura: recibe lo leido del Excel y lo que ya hay en la base, y
 * devuelve un plan. No abre conexiones ni escribe archivos.
 */

import type { Incidencia } from './lector-inventario';
import type { EmpaqueNormalizado, ProductoNormalizado } from './normalizador';

/** Lo que la base ya tiene, para poder comparar. */
export interface ProductoExistente {
  readonly id: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly presentacion: string;
  readonly volumenMl: number | null;
  readonly envase: string | null;
  readonly existencia: number;
  readonly precioVenta: number;
  readonly empaques: readonly { nombre: string; factor: number; precioVenta: number | null }[];
}

export type CampoCambiado = 'precio' | 'existencia' | 'presentacion' | 'envase' | 'empaques';

export interface CambioCampo {
  readonly campo: CampoCambiado;
  readonly antes: string;
  readonly despues: string;
}

export interface ProductoACrear {
  readonly producto: ProductoNormalizado;
}

export interface ProductoAActualizar {
  readonly id: number;
  readonly producto: ProductoNormalizado;
  readonly existente: ProductoExistente;
  readonly cambios: readonly CambioCampo[];
}

export interface PlanImportacion {
  readonly crear: readonly ProductoACrear[];
  readonly actualizar: readonly ProductoAActualizar[];
  /** Estaban en la base y el Excel ya no los trae. No se borran nunca:
   *  solo se informan, por si hay que desactivarlos a mano. */
  readonly ausentes: readonly ProductoExistente[];
  readonly incidencias: readonly Incidencia[];
  readonly resumen: ResumenPlan;
}

export interface ResumenPlan {
  readonly aCrear: number;
  readonly aActualizar: number;
  readonly sinCambios: number;
  readonly ausentes: number;
  readonly errores: number;
  readonly avisos: number;
  readonly unidadesQueEntran: number;
  readonly valorQueEntra: number;
}

/** Identidad de un producto: nombre, volumen y envase. Es la misma clave
 *  que usa el armador, para que reimportar el mismo Excel no duplique. */
function claveIdentidad(
  nombre: string, volumenMl: number | null, envase: string | null,
): string {
  return `${nombre.trim().toUpperCase()}|${volumenMl ?? 'S'}|${envase ?? 'S'}`;
}

const pesos = (n: number): string => `$${n.toLocaleString('es-CO')}`;

function describirEmpaques(
  empaques: readonly { nombre: string; factor: number; precioVenta: number | null }[],
): string {
  if (empaques.length === 0) return 'ninguno';
  return [...empaques]
    .sort((a, b) => a.factor - b.factor)
    .map((e) => `${e.nombre} x${e.factor}${e.precioVenta !== null ? ` ${pesos(e.precioVenta)}` : ''}`)
    .join(', ');
}

function compararEmpaques(
  nuevos: readonly EmpaqueNormalizado[],
  viejos: readonly { nombre: string; factor: number; precioVenta: number | null }[],
): boolean {
  const norm = (
    lista: readonly { nombre: string; factor: number; precioVenta: number | null }[],
  ): string => [...lista]
    .sort((a, b) => a.factor - b.factor)
    .map((e) => `${e.nombre.toLowerCase()}|${e.factor}|${e.precioVenta ?? ''}`)
    .join(';');
  return norm(nuevos) !== norm(viejos);
}

/**
 * Compara lo que trae el Excel con lo que hay en la base.
 *
 * La existencia solo se propone cambiar si de verdad difiere: reimportar
 * el mismo archivo no debe generar movimientos de inventario fantasma.
 */
export function planificarImportacion(
  productos: readonly ProductoNormalizado[],
  existentes: readonly ProductoExistente[],
  incidencias: readonly Incidencia[] = [],
): PlanImportacion {
  // El emparejamiento va primero por codigo, que es unico. La clave de
  // nombre+volumen+envase no basta: los productos ambiguos (las dos
  // Margaritas) la comparten, y emparejar por ella haria que los dos
  // apuntaran al mismo registro y se pisaran entre si.
  const porCodigo = new Map<string, ProductoExistente>();
  const porIdentidad = new Map<string, ProductoExistente[]>();
  for (const e of existentes) {
    porCodigo.set(e.codigo.toUpperCase(), e);
    const k = claveIdentidad(e.nombre, e.volumenMl, e.envase);
    porIdentidad.set(k, [...(porIdentidad.get(k) ?? []), e]);
  }

  const crear: ProductoACrear[] = [];
  const actualizar: ProductoAActualizar[] = [];
  const emparejados = new Set<number>();
  let sinCambios = 0;

  for (const p of productos) {
    // Cada existente se consume una sola vez, para que dos productos del
    // Excel no terminen actualizando el mismo registro.
    const porSuCodigo = porCodigo.get(p.codigo.toUpperCase());
    const candidato = porSuCodigo !== undefined && !emparejados.has(porSuCodigo.id)
      ? porSuCodigo
      : (porIdentidad.get(claveIdentidad(p.nombre, p.volumenMl, p.envase)) ?? [])
        .find((e) => !emparejados.has(e.id));

    if (candidato === undefined) {
      crear.push({ producto: p });
      continue;
    }
    const existente = candidato;
    emparejados.add(existente.id);

    const cambios: CambioCampo[] = [];
    if (p.precioVenta !== existente.precioVenta) {
      cambios.push({
        campo: 'precio',
        antes: pesos(existente.precioVenta),
        despues: pesos(p.precioVenta),
      });
    }
    if (p.existencia !== existente.existencia) {
      cambios.push({
        campo: 'existencia',
        antes: `${existente.existencia}`,
        despues: `${p.existencia}`,
      });
    }
    if (p.presentacion !== existente.presentacion) {
      cambios.push({ campo: 'presentacion', antes: existente.presentacion, despues: p.presentacion });
    }
    if ((p.envase ?? null) !== (existente.envase ?? null)) {
      cambios.push({
        campo: 'envase',
        antes: existente.envase ?? 'sin definir',
        despues: p.envase ?? 'sin definir',
      });
    }
    if (compararEmpaques(p.empaques, existente.empaques)) {
      cambios.push({
        campo: 'empaques',
        antes: describirEmpaques(existente.empaques),
        despues: describirEmpaques(p.empaques),
      });
    }

    if (cambios.length === 0) { sinCambios += 1; continue; }
    actualizar.push({ id: existente.id, producto: p, existente, cambios });
  }

  const ausentes = existentes.filter((e) => !emparejados.has(e.id));

  const unidadesQueEntran = crear.reduce((s, c) => s + c.producto.existencia, 0)
    + actualizar.reduce((s, a) => s + (a.producto.existencia - a.existente.existencia), 0);
  const valorQueEntra = crear.reduce((s, c) => s + c.producto.existencia * c.producto.precioVenta, 0);

  return {
    crear, actualizar, ausentes, incidencias,
    resumen: {
      aCrear: crear.length,
      aActualizar: actualizar.length,
      sinCambios,
      ausentes: ausentes.length,
      errores: incidencias.filter((i) => i.severidad === 'ERROR').length,
      avisos: incidencias.filter((i) => i.severidad === 'AVISO').length,
      unidadesQueEntran,
      valorQueEntra,
    },
  };
}
