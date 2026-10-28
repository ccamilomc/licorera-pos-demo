/**
 * Aviso de que la lista está cortada.
 *
 * Una tabla que trae los últimos N y no lo dice se lee como si eso fuera
 * todo lo que hubo. Justo cuando alguien busca por qué no cuadra algo,
 * esa diferencia es la que importa.
 *
 * Va debajo de la tabla, dentro del mismo recuadro: si fuera afuera se
 * leería como un pie de página y no como parte de lo que se está viendo.
 */

interface Props {
  /** Cuántos se están viendo. */
  readonly viendo: number;
  /** Cómo se llaman en plural: «movimientos», «compras», «registros». */
  readonly nombre: string;
  readonly onVerMas: () => void;
}

export function HayMasAtras({ viendo, nombre, onVerMas }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linea
                    bg-panel-2 px-3 py-2">
      <span className="text-[12px] text-tinta-3">
        Se están viendo los últimos <span className="cifra">{viendo}</span>{' '}
        {nombre}. Hay más atrás.
      </span>
      <button
        type="button"
        onClick={onVerMas}
        className="rounded border border-linea-2 px-2.5 py-1 text-[12px] font-semibold
                   text-tinta-2 hover:border-acento hover:text-acento"
      >
        Ver más
      </button>
    </div>
  );
}
