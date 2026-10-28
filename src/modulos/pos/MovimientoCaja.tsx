/**
 * Entradas y salidas de dinero de la caja.
 *
 * Un domicilio, un mandado, un préstamo al proveedor: si el dinero sale y
 * no queda registrado, al cerrar va a faltar plata y nadie va a saber por
 * qué. Este es el registro que hace que el arqueo signifique algo.
 */

import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, X } from 'lucide-react';

import { pesos } from '@/compartido/utilidades/formato';

interface Props {
  readonly guardando: boolean;
  readonly error: string | null;
  readonly onGuardar: (esEntrada: boolean, concepto: string, monto: number) => void;
  readonly onCerrar: () => void;
}

/** Motivos habituales, para no tener que escribirlos cada vez. */
const CONCEPTOS_SALIDA = ['Domicilio', 'Mandado', 'Compra menor', 'Retiro'];
const CONCEPTOS_ENTRADA = ['Préstamo', 'Base adicional', 'Devolución'];

export function MovimientoCaja({ guardando, error, onGuardar, onCerrar }: Props) {
  const [esEntrada, setEsEntrada] = useState(false);
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');

  const valor = Number(monto.replace(/\D/g, '')) || 0;
  const listo = concepto.trim() !== '' && valor > 0;
  const sugerencias = esEntrada ? CONCEPTOS_ENTRADA : CONCEPTOS_SALIDA;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Registrar movimiento de dinero"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => { if (e.key === 'Escape' && !guardando) onCerrar(); }}
    >
      <div className="w-full max-w-md rounded-lg border border-linea bg-panel p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold tracking-tight">Movimiento de dinero</h3>
            <p className="mt-0.5 text-[13px] text-tinta-2">
              Si sale plata de la caja y no queda anotada, al cerrar va a faltar.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded p-1 text-tinta-3 hover:text-tinta"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => { setEsEntrada(false); setConcepto(''); }}
            aria-pressed={!esEntrada}
            className={`flex flex-1 items-center justify-center gap-2 rounded border px-3 py-2.5
              text-sm font-semibold ${!esEntrada
                ? 'border-grave bg-grave-suave text-grave'
                : 'border-linea-2 text-tinta-2 hover:border-acento'}`}
          >
            <ArrowUpRight size={16} aria-hidden />
            Sale plata
          </button>
          <button
            type="button"
            onClick={() => { setEsEntrada(true); setConcepto(''); }}
            aria-pressed={esEntrada}
            className={`flex flex-1 items-center justify-center gap-2 rounded border px-3 py-2.5
              text-sm font-semibold ${esEntrada
                ? 'border-bien bg-bien-suave text-bien'
                : 'border-linea-2 text-tinta-2 hover:border-acento'}`}
          >
            <ArrowDownLeft size={16} aria-hidden />
            Entra plata
          </button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-tinta-2">¿Para qué?</span>
          <input
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            autoFocus
            placeholder={esEntrada ? 'préstamo, base adicional…' : 'domicilio, mandado…'}
            className="rounded border border-linea-2 bg-panel px-3 py-2.5 text-sm outline-none
                       placeholder:text-[13px] placeholder:text-tinta-3 focus:border-acento"
          />
        </label>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {sugerencias.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setConcepto(s)}
              className="rounded border border-linea-2 px-2.5 py-1 text-[12px] font-semibold
                         text-tinta-2 hover:border-acento hover:text-acento"
            >
              {s}
            </button>
          ))}
        </div>

        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-tinta-2">¿Cuánto?</span>
          <input
            inputMode="numeric"
            value={monto}
            onChange={(e) => setMonto(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && listo) {
                e.preventDefault();
                onGuardar(esEntrada, concepto, valor);
              }
            }}
            placeholder="0"
            className="cifra rounded border border-linea-2 bg-panel px-3 py-2.5 text-xl
                       outline-none focus:border-acento"
          />
          <span className="cifra text-[13px] text-tinta-3">{pesos(valor)}</span>
        </label>

        {error !== null && (
          <p role="alert" className="mt-3 rounded border border-grave/30 bg-grave-suave px-3
                                     py-2 text-sm text-grave">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onGuardar(esEntrada, concepto, valor)}
            disabled={!listo || guardando}
            className="flex-1 rounded bg-acento px-4 py-2.5 text-sm font-bold text-sobre-acento
                       hover:bg-acento-fuerte disabled:cursor-not-allowed disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Registrar'}
          </button>
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="rounded border border-linea-2 px-4 py-2.5 text-sm font-semibold
                       text-tinta-2 hover:bg-panel-2 disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>

        <p className="mt-2.5 text-center text-[12px] text-tinta-3">
          Queda registrado con tu nombre y la hora.
        </p>
      </div>
    </div>
  );
}
