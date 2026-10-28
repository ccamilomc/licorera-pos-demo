/**
 * Que poner al lado del nombre cuando dos productos se llaman igual.
 *
 * En la caja uno lee el nombre, no la letra chica de abajo. Si hay dos
 * "Margarita" y la unica diferencia esta en gris pequeno, se cobra la
 * equivocada. Esto devuelve, para los que comparten nombre, el dato mas
 * corto que alcanza para distinguirlos.
 *
 * Vive aqui y no dentro del punto de venta porque el mismo problema
 * aparece en el inventario y al recibir mercancia.
 */

/** Lo minimo que hace falta para distinguir dos productos homonimos. */
export interface Distinguible {
  readonly id: number;
  readonly nombre: string;
  readonly presentacion: string;
  readonly envase: string | null;
  readonly precio_venta: number;
}

// De mas claro a menos: el volumen es lo que la gente dice ("la de
// litro"), el envase lo que ve, y el precio el ultimo recurso para los
// que el Excel nunca alcanzo a distinguir.
const CRITERIOS: readonly ((p: Distinguible) => string | null)[] = [
  (p) => (p.presentacion.trim() === '' ? null : p.presentacion.trim()),
  (p) => (p.envase === null || p.envase.trim() === '' ? null : p.envase.toLowerCase()),
  (p) => {
    const volumen = p.presentacion.trim();
    const envase = p.envase?.trim().toLowerCase() ?? '';
    const junto = `${volumen} ${envase}`.trim();
    return junto === '' ? null : junto;
  },
  (p) => (p.precio_venta > 0 ? `$${p.precio_venta.toLocaleString('es-CO')}` : null),
];

/**
 * Se elige un solo criterio para todo el grupo: mezclar "Poker 330 ml"
 * con "Poker botella" en la misma lista confunde mas de lo que aclara.
 */
export function distintivos(
  productos: readonly Distinguible[],
): ReadonlyMap<number, string> {
  const marca = new Map<number, string>();

  const grupos = new Map<string, Distinguible[]>();
  for (const p of productos) {
    const clave = p.nombre.trim().toLowerCase();
    const grupo = grupos.get(clave);
    if (grupo === undefined) grupos.set(clave, [p]);
    else grupo.push(p);
  }

  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;

    for (const criterio of CRITERIOS) {
      const valores = grupo.map(criterio);
      const sirve =
        valores.every((v) => v !== null) && new Set(valores).size === grupo.length;
      if (sirve) {
        grupo.forEach((p, i) => marca.set(p.id, valores[i]!));
        break;
      }
    }
    // Si ningun criterio los separa son indistinguibles de verdad, y
    // ponerles una marca inventada seria peor que no poner nada.
  }

  return marca;
}
