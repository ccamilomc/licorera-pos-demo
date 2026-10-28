/**
 * Elegir de cuándo a cuándo.
 *
 * Las dos casillas de fecha estaban en cuatro pantallas, cada una con su
 * copia de «hoy» y su propio arranque. Además obligaban a escribir dos
 * fechas para la pregunta que más se hace —«¿cómo va la semana?»—, así
 * que aquí van también los atajos.
 *
 * «Todo» arranca en el primer día con movimiento, no en una fecha
 * inventada: si el negocio abrió en marzo, no tiene sentido ofrecer enero.
 */

import { useEffect, useState } from 'react';

import { pedir } from '@/nucleo/puente';

export interface Rango {
  readonly desde: string;
  readonly hasta: string;
}

/** `2026-08-21`, en hora local. Nunca `toISOString`, que corre el día. */
export function enFecha(f: Date): string {
  return [
    f.getFullYear(),
    String(f.getMonth() + 1).padStart(2, '0'),
    String(f.getDate()).padStart(2, '0'),
  ].join('-');
}

export function hoyLocal(dias = 0): string {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  return enFecha(f);
}

export function inicioDeMes(): string {
  const f = new Date();
  return enFecha(new Date(f.getFullYear(), f.getMonth(), 1));
}

/** Los atajos, en el orden en que se usan en el mostrador. */
function atajos(inicio: string): readonly { nombre: string; rango: Rango }[] {
  const hoy = hoyLocal();
  return [
    { nombre: 'Hoy', rango: { desde: hoy, hasta: hoy } },
    { nombre: 'Ayer', rango: { desde: hoyLocal(-1), hasta: hoyLocal(-1) } },
    { nombre: '7 días', rango: { desde: hoyLocal(-6), hasta: hoy } },
    { nombre: '30 días', rango: { desde: hoyLocal(-29), hasta: hoy } },
    { nombre: 'Este mes', rango: { desde: inicioDeMes(), hasta: hoy } },
    { nombre: 'Todo', rango: { desde: inicio, hasta: hoy } },
  ];
}

interface Props {
  readonly desde: string;
  readonly hasta: string;
  readonly onCambio: (rango: Rango) => void;
}

export function Periodo({ desde, hasta, onCambio }: Props) {
  // El primer día con movimiento. Mientras no llegue, «Todo» no se
  // ofrece: es preferible que falte el botón un instante a que arranque
  // en una fecha inventada.
  const [inicio, setInicio] = useState<string | null>(null);

  useEffect(() => {
    pedir<string | null>('primer_dia_con_movimiento')
      .then((d) => setInicio(d))
      .catch(() => setInicio(null));
  }, []);

  const opciones = atajos(inicio ?? hoyLocal())
    .filter((a) => a.nombre !== 'Todo' || inicio !== null);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Períodos rápidos">
        {opciones.map(({ nombre, rango }) => {
          const puesto = rango.desde === desde && rango.hasta === hasta;
          return (
            <button
              key={nombre}
              type="button"
              onClick={() => onCambio(rango)}
              aria-pressed={puesto}
              className={`rounded border px-2.5 py-1.5 text-[13px] font-semibold ${
                puesto
                  ? 'border-acento bg-acento-suave text-acento'
                  : 'border-linea-2 text-tinta-2 hover:border-acento hover:text-acento'}`}
            >
              {nombre}
            </button>
          );
        })}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-tinta-2">Desde</span>
        <input
          type="date"
          value={desde}
          max={hasta}
          onChange={(e) => onCambio({ desde: e.target.value, hasta })}
          className="cifra rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                     outline-none focus:border-acento"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-tinta-2">Hasta</span>
        <input
          type="date"
          value={hasta}
          min={desde}
          onChange={(e) => onCambio({ desde, hasta: e.target.value })}
          className="cifra rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                     outline-none focus:border-acento"
        />
      </label>
    </div>
  );
}
