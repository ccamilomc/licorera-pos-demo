/**
 * Cuándo cambió de precio este producto, y de cuánto a cuánto.
 *
 * Responde la pregunta que uno se hace mirando el margen: «¿yo cuándo
 * subí la Póker?». Cada cambio queda anotado con el precio anterior,
 * quién lo hizo y qué día.
 *
 * **Lo vendido no se toca.** Cada venta guarda el precio con el que se
 * cobró, así que subir el precio hoy no reescribe lo de ayer: el reporte
 * de la semana pasada sigue diciendo lo mismo. Esto es la historia del
 * precio de lista, que es otra cosa.
 */

import { useCallback, useEffect, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';

import { fechaHoraCorta, pesos } from '@/compartido/utilidades/formato';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';

interface Cambio {
  readonly id: number;
  readonly fecha: string;
  readonly producto: string;
  /** Cuál forma de venta. `null` es el precio principal del producto. */
  readonly empaque: string | null;
  readonly precio_anterior: number | null;
  readonly precio_nuevo: number;
  readonly variacion: number | null;
  readonly motivo: string | null;
  readonly usuario: string;
}

export function HistorialPrecios({ productoId }: { readonly productoId: number }) {
  const { usuario } = useSesion();
  const [cambios, setCambios] = useState<readonly Cambio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    if (usuario === null) return;
    setCargando(true);
    try {
      setCambios(await pedir<Cambio[]>('historial_de_precios', {
        productoId, limite: 50, rol: usuario.rol,
      }));
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setCargando(false);
    }
  }, [productoId, usuario]);

  useEffect(() => { void cargar(); }, [cargar]);

  if (error !== null) {
    return (
      <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3 py-2
                                 text-sm text-grave">
        {error}
      </p>
    );
  }

  if (cargando) {
    return <p className="p-4 text-sm text-tinta-3">Consultando…</p>;
  }

  if (cambios.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-tinta-3">
        Nunca le has cambiado el precio. Cuando lo hagas queda anotado aquí,
        con el precio que tenía antes.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-linea">
      <table className="w-full min-w-[520px] text-sm">
        <caption className="px-3 py-2 text-left text-[12px] text-tinta-3">
          Lo que ya se vendió no cambia: cada venta guarda el precio con el que se
          cobró. Esto es solo la historia del precio de lista.
        </caption>
        <thead className="bg-panel-2">
          <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
            <th className="px-3 py-2 font-semibold">Cuándo</th>
            <th className="px-3 py-2 font-semibold">Qué</th>
            <th className="px-3 py-2 text-right font-semibold">Estaba en</th>
            <th className="px-3 py-2 text-right font-semibold">Quedó en</th>
            <th className="px-3 py-2 font-semibold">Quién</th>
          </tr>
        </thead>
        <tbody>
          {cambios.map((c) => (
            <tr key={c.id} className="border-t border-linea bg-panel">
              <td className="cifra px-3 py-2 text-[12px] text-tinta-3">
                {fechaHoraCorta(c.fecha)}
              </td>
              <td className="px-3 py-2 text-tinta-2">
                {c.empaque ?? 'Precio del producto'}
              </td>
              <td className="cifra px-3 py-2 text-right text-tinta-3">
                {c.precio_anterior === null ? '—' : pesos(c.precio_anterior)}
              </td>
              <td className="px-3 py-2 text-right">
                <span className="cifra font-semibold">{pesos(c.precio_nuevo)}</span>
                {c.variacion !== null && c.variacion !== 0 && (
                  <span className={`ml-1.5 inline-flex items-center gap-0.5 text-[11px]
                                    font-semibold ${
                                      c.variacion > 0 ? 'text-bien' : 'text-grave'}`}
                  >
                    {c.variacion > 0
                      ? <TrendingUp size={11} aria-hidden />
                      : <TrendingDown size={11} aria-hidden />}
                    {Math.abs(c.variacion)}%
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-[13px] text-tinta-3">{c.usuario}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
