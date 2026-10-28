/**
 * Historial de un producto: todo lo que le pasó, en orden.
 *
 * Responde la pregunta que se hace cuando el conteo físico no cuadra:
 * ¿de dónde salió esta existencia? Cada renglón dice qué pasó, cuánto
 * cambió, con qué quedó y quién lo hizo.
 */

import { useEffect, useState } from 'react';
import { History, Undo2 } from 'lucide-react';

import { fechaHoraCorta } from '@/compartido/utilidades/formato';
import { HayMasAtras } from '@/compartido/componentes/HayMasAtras';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';

interface Movimiento {
  readonly id: number;
  readonly fecha: string;
  readonly producto: string;
  readonly tipo: string;
  readonly cantidad: number;
  readonly existencia_despues: number;
  readonly motivo: string | null;
  readonly usuario: string;
  /** Solo los ajustes manuales, y solo si no se deshicieron ya. */
  readonly se_puede_deshacer: boolean;
}

interface Props {
  readonly productoId: number;
  /** Al deshacer cambia la existencia, y la ficha tiene que enterarse. */
  readonly onCambio?: (existencia: number) => void;
}

/** Cómo se llama cada tipo de movimiento en la pantalla. */
const NOMBRES: Readonly<Record<string, string>> = {
  VENTA: 'Venta',
  ANULACION: 'Anulación',
  COMPRA: 'Compra',
  AJUSTE: 'Ajuste',
  DEVOLUCION_PROVEEDOR: 'Devolución',
  BAJA: 'Baja',
  IMPORTACION: 'Carga inicial',
};

export function Kardex({ productoId, onCambio }: Props) {
  const { usuario, puede } = useSesion();
  const [movimientos, setMovimientos] = useState<readonly Movimiento[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  /** El ajuste que se está deshaciendo, con el motivo escrito. */
  const [deshaciendo, setDeshaciendo] = useState<Movimiento | null>(null);
  const [motivo, setMotivo] = useState('');
  /**
   * Aparte del error de carga: si falla el deshacer, el aviso va dentro
   * del diálogo. Reemplazar el historial entero por un renglón rojo
   * borraría de la pantalla justo lo que se está mirando.
   */
  const [errorDeshacer, setErrorDeshacer] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  /**
   * Cuantos movimientos se piden. Empieza en los ultimos 200 porque es
   * lo que se mira casi siempre; si el producto tiene mas, la pantalla
   * lo dice en vez de dejar creer que eso es todo lo que hubo.
   */
  const [tope, setTope] = useState(200);

  useEffect(() => {
    if (usuario === null) return;
    setCargando(true);
    pedir<Movimiento[]>('reporte_kardex', { productoId, limite: tope, rol: usuario.rol })
      .then(setMovimientos)
      .catch((causa: unknown) => setError(mensajeDeError(causa)))
      .finally(() => setCargando(false));
  }, [productoId, usuario, recarga, tope]);

  async function deshacer() {
    if (deshaciendo === null || usuario === null || motivo.trim() === '') return;
    setGuardando(true);
    try {
      const r = await pedir<{ existencia_despues: number }>('deshacer_ajuste', {
        movimientoId: deshaciendo.id,
        motivo: motivo.trim(),
        usuarioId: usuario.id,
        rol: usuario.rol,
      });
      setDeshaciendo(null);
      setMotivo('');
      setErrorDeshacer(null);
      setRecarga((n) => n + 1);
      onCambio?.(r.existencia_despues);
    } catch (causa) {
      setErrorDeshacer(mensajeDeError(causa));
    } finally {
      setGuardando(false);
    }
  }

  if (error !== null) {
    return (
      <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3 py-2
                                 text-sm text-grave">
        {error}
      </p>
    );
  }

  if (cargando) {
    return <p className="p-4 text-sm text-tinta-3">Cargando el historial…</p>;
  }

  if (movimientos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <History size={20} className="text-tinta-3" aria-hidden />
        <p className="text-sm text-tinta-3">
          Este producto todavía no tiene movimientos.
        </p>
      </div>
    );
  }

  // Si llegaron justo los que se pidieron, es que hay mas atras.
  const hayMas = movimientos.length === tope;

  return (
    <div className="overflow-x-auto rounded border border-linea">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-panel-2">
          <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
            <th className="px-3 py-2 font-semibold">Cuándo</th>
            <th className="px-3 py-2 font-semibold">Qué pasó</th>
            <th className="px-3 py-2 text-right font-semibold">Cambio</th>
            <th className="px-3 py-2 text-right font-semibold">Quedó en</th>
            <th className="px-3 py-2 font-semibold">Quién</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {movimientos.map((m) => (
            <tr key={m.id} className="border-t border-linea bg-panel">
              <td className="cifra px-3 py-2 text-[12px] text-tinta-3">{fechaHoraCorta(m.fecha)}</td>
              <td className="px-3 py-2">
                <span className="text-tinta-2">{NOMBRES[m.tipo] ?? m.tipo}</span>
                {m.motivo !== null && m.motivo !== '' &&
                 m.motivo !== NOMBRES[m.tipo] && (
                  <div className="text-[12px] text-tinta-3">{m.motivo}</div>
                )}
              </td>
              <td className={`cifra px-3 py-2 text-right font-semibold ${
                m.cantidad > 0 ? 'text-bien' : 'text-grave'}`}
              >
                {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
              </td>
              <td className="cifra px-3 py-2 text-right">{m.existencia_despues}</td>
              <td className="px-3 py-2 text-[13px] text-tinta-3">{m.usuario}</td>
              <td className="px-3 py-2 text-right">
                {m.se_puede_deshacer && puede('inventario.ajustar') && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeshaciendo(m);
                      setMotivo('');
                      setErrorDeshacer(null);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-linea-2
                               px-2 py-1 text-[12px] font-semibold text-tinta-3
                               hover:border-acento hover:text-acento"
                  >
                    <Undo2 size={12} aria-hidden />
                    Deshacer
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {hayMas && (
        <HayMasAtras
          viendo={tope}
          nombre="movimientos"
          onVerMas={() => setTope((n) => n + 400)}
        />
      )}

      {deshaciendo !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Deshacer el ajuste"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !guardando) setDeshaciendo(null);
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-linea bg-panel p-5 shadow-xl">
            <h3 className="text-base font-bold">
              Deshacer un ajuste de{' '}
              <span className="cifra">
                {deshaciendo.cantidad > 0 ? `+${deshaciendo.cantidad}` : deshaciendo.cantidad}
              </span>
            </h3>
            <p className="mt-1 text-[13px] text-tinta-2">
              La existencia vuelve a como estaba antes de ese ajuste. No se borra
              nada: quedan los dos movimientos en el historial, para que se vea
              qué pasó y por qué.
            </p>
            {deshaciendo.motivo !== null && deshaciendo.motivo !== '' && (
              <p className="mt-2 rounded border border-linea bg-panel-2 px-3 py-2
                            text-[12px] text-tinta-3">
                El ajuste decía: {deshaciendo.motivo}
              </p>
            )}

            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-tinta-2">
                ¿Por qué se deshace?
              </span>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && motivo.trim() !== '') {
                    e.preventDefault();
                    void deshacer();
                  }
                }}
                placeholder="me equivoqué de cantidad…"
                aria-label="Motivo para deshacer"
                autoFocus
                className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                           outline-none placeholder:text-[13px] focus:border-acento"
              />
            </label>

            {errorDeshacer !== null && (
              <p role="alert" className="mt-3 rounded border border-grave/30
                                          bg-grave-suave px-3 py-2 text-[13px] text-grave">
                {errorDeshacer}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { void deshacer(); }}
                disabled={motivo.trim() === '' || guardando}
                className="rounded bg-acento px-4 py-2 text-sm font-bold text-sobre-acento
                           hover:bg-acento-fuerte disabled:cursor-not-allowed
                           disabled:opacity-50"
              >
                {guardando ? 'Deshaciendo…' : 'Deshacer el ajuste'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeshaciendo(null);
                  setMotivo('');
                  setErrorDeshacer(null);
                }}
                disabled={guardando}
                className="rounded border border-linea-2 px-4 py-2 text-sm font-semibold
                           text-tinta-2 hover:bg-panel-2 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
