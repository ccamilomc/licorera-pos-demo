/**
 * Cobro de la venta.
 *
 * El caso normal es efectivo con el monto justo, y ese caso se cierra con
 * un Enter. Todo lo demas -- pago mixto, calcular el vuelto -- esta a un
 * paso, pero no estorba al flujo de todos los dias.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, Check, Plus, X } from 'lucide-react';

import { pesos } from '@/compartido/utilidades/formato';

export interface MetodoPago {
  readonly id: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly es_efectivo: boolean;
}

/** El método con el que la venta queda debiendo. */
const FIADO = 'FIADO';

export interface PagoElegido {
  readonly metodo_pago_id: number;
  readonly monto: number;
  readonly recibido: number | null;
}

/** Lo que se cobra de más sobre la venta, con su motivo. */
export interface RecargoElegido {
  readonly concepto: string;
  readonly porcentaje: number | null;
  readonly monto: number;
}

interface Props {
  /** El total del carrito, antes del recargo. */
  readonly total: number;
  readonly metodos: readonly MetodoPago[];
  readonly cobrando: boolean;
  readonly error: string | null;
  /** Conceptos que aparecen como botones. Salen de Configuración. */
  readonly recargosSugeridos?: readonly string[];
  readonly onConfirmar: (
    pagos: PagoElegido[],
    recargo: RecargoElegido | null,
    /** A nombre de quién queda lo fiado, tal como se escribió. */
    cliente: string | null,
  ) => void;
  readonly onCancelar: () => void;
}

/** Billetes con los que se paga a diario en el local. */
const BILLETES = [5_000, 10_000, 20_000, 50_000, 100_000];

/** Porcentajes que se cobran de a un toque. */
const PORCENTAJES = [5, 10, 15, 20];

export function DialogoCobro({
  total: totalCarrito, metodos, cobrando, error, recargosSugeridos = [],
  onConfirmar, onCancelar,
}: Props) {
  const efectivo = useMemo(
    () => metodos.find((m) => m.es_efectivo) ?? metodos[0] ?? null,
    [metodos],
  );

  const [metodoId, setMetodoId] = useState<number | null>(efectivo?.id ?? null);
  const [recibido, setRecibido] = useState('');
  /**
   * A nombre de quién se fía. Texto libre a propósito: en el mostrador
   * se fía a «Don Jairo», «la señora del 302» o «el taller de la
   * esquina». Obligar a dar de alta un cliente antes de fiar hace que
   * nadie fíe por el sistema y todo vuelva al cuaderno.
   */
  const [aQuien, setAQuien] = useState('');
  const campo = useRef<HTMLInputElement>(null);

  // El recargo empieza cerrado: la venta normal no lleva, y un campo más
  // en el camino de cobrar estorba doscientas veces al día.
  const [cobrandoExtra, setCobrandoExtra] = useState(false);
  const [concepto, setConcepto] = useState('');
  const [porcentaje, setPorcentaje] = useState<number | null>(null);
  const [montoExtra, setMontoExtra] = useState('');

  useEffect(() => { campo.current?.focus(); }, []);

  const montoExtraNumero = Number(montoExtra.replace(/\D/g, '')) || 0;
  // Redondeo al peso más cercano, igual que el núcleo: truncar cobraría
  // un peso menos del que dice la pantalla.
  const recargoCalculado = porcentaje !== null
    ? Math.round((totalCarrito * porcentaje) / 100)
    : montoExtraNumero;
  const hayRecargo = cobrandoExtra && concepto.trim() !== '' && recargoCalculado > 0;
  const recargo = hayRecargo ? recargoCalculado : 0;
  const total = totalCarrito + recargo;

  const metodo = metodos.find((m) => m.id === metodoId) ?? efectivo;
  const esEfectivo = metodo?.es_efectivo ?? false;
  const esFiado = metodo?.codigo === FIADO;
  const recibidoNumero = Number(recibido.replace(/\D/g, ''));
  const hayRecibido = recibido.trim() !== '' && Number.isFinite(recibidoNumero);
  const vuelto = hayRecibido ? recibidoNumero - total : 0;
  const alcanza = !esEfectivo || !hayRecibido || recibidoNumero >= total;
  // Una deuda sin dueño no se puede cobrar despues.
  const listo = alcanza && (!esFiado || aQuien.trim() !== '');

  function confirmar() {
    if (metodo === undefined || metodo === null || cobrando || !listo) return;
    onConfirmar(
      [{
        metodo_pago_id: metodo.id,
        monto: total,
        recibido: esEfectivo && hayRecibido ? recibidoNumero : null,
      }],
      hayRecargo
        ? { concepto: concepto.trim(), porcentaje, monto: recargoCalculado }
        : null,
      esFiado ? aQuien.trim() : null,
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cobrar la venta"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => { if (e.key === 'Escape' && !cobrando) onCancelar(); }}
    >
      <div className="w-full max-w-md rounded-lg border border-linea bg-panel p-6 shadow-xl">
        <div className="mb-5 text-center">
          <div className="text-[13px] font-semibold uppercase tracking-wider text-tinta-3">
            Total a cobrar
          </div>
          <div
            aria-label="Total a cobrar"
            className="cifra mt-1 text-4xl font-extrabold tracking-tight"
          >
            {pesos(total)}
          </div>
          {/* Con recargo se muestra de dónde sale, para que el cliente
              pueda preguntarlo y el cajero sepa responder. */}
          {recargo > 0 && (
            <div className="cifra mt-1 text-[13px] text-tinta-3">
              {`${pesos(totalCarrito)} + ${pesos(recargo)} de `
                + `${concepto.trim().toLowerCase()}`
                + `${porcentaje !== null ? ` (${porcentaje} %)` : ''}`}
            </div>
          )}
        </div>

        {/* Cobrar algo de más: domicilio, servicio, lo que sea. */}
        {!cobrandoExtra ? (
          <button
            type="button"
            onClick={() => setCobrandoExtra(true)}
            className="mb-4 flex w-full items-center justify-center gap-1.5 rounded border
                       border-dashed border-linea-2 px-3 py-2 text-[13px] font-semibold
                       text-tinta-3 hover:border-acento hover:text-acento"
          >
            <Plus size={14} aria-hidden />
            Cobrar algo de más
          </button>
        ) : (
          <div className="mb-4 rounded border border-linea-2 bg-panel-2 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-tinta-2">
                ¿Por qué se cobra de más?
              </span>
              <button
                type="button"
                onClick={() => {
                  setCobrandoExtra(false);
                  setConcepto('');
                  setPorcentaje(null);
                  setMontoExtra('');
                }}
                aria-label="Quitar el recargo"
                className="rounded p-0.5 text-tinta-3 hover:text-tinta"
              >
                <X size={15} aria-hidden />
              </button>
            </div>

            <input
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="domicilio, servicio…"
              aria-label="Concepto del recargo"
              autoFocus
              className="mb-2 w-full rounded border border-linea-2 bg-panel px-2.5 py-2
                         text-sm outline-none focus:border-acento"
            />

            {recargosSugeridos.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {recargosSugeridos.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setConcepto(s)}
                    className="rounded border border-linea-2 px-2 py-0.5 text-[12px]
                               font-semibold text-tinta-2 hover:border-acento
                               hover:text-acento"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              {PORCENTAJES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setPorcentaje(porcentaje === p ? null : p);
                    setMontoExtra('');
                  }}
                  aria-pressed={porcentaje === p}
                  className={`rounded border px-2.5 py-1 text-[13px] font-semibold
                    ${porcentaje === p
                      ? 'border-acento bg-acento-suave text-acento'
                      : 'border-linea-2 text-tinta-2 hover:border-acento'}`}
                >
                  {p} %
                </button>
              ))}
              <span className="text-[12px] text-tinta-3">o</span>
              <input
                inputMode="numeric"
                value={montoExtra}
                onChange={(e) => {
                  setMontoExtra(e.target.value.replace(/\D/g, ''));
                  setPorcentaje(null);
                }}
                placeholder="monto"
                aria-label="Monto del recargo"
                className="cifra w-24 rounded border border-linea-2 bg-panel px-2 py-1
                           text-right text-sm outline-none focus:border-acento"
              />
            </div>

            {recargoCalculado > 0 && (
              <p className="cifra mt-2 text-[13px] font-semibold text-acento">
                + {pesos(recargoCalculado)}
              </p>
            )}
            {concepto.trim() === '' && recargoCalculado > 0 && (
              <p className="mt-1 text-[12px] text-alerta">
                Escribe para qué es, o no se cobra.
              </p>
            )}
          </div>
        )}

        <fieldset className="mb-4">
          <legend className="mb-2 text-[13px] font-semibold text-tinta-2">
            Forma de pago
          </legend>
          <div className="flex flex-wrap gap-2">
            {metodos.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetodoId(m.id)}
                aria-pressed={m.id === metodo?.id}
                className={`rounded border px-3 py-2 text-sm font-semibold
                  ${m.id === metodo?.id
                    ? 'border-acento bg-acento-suave text-acento'
                    : 'border-linea-2 text-tinta-2 hover:border-acento'}`}
              >
                {m.nombre}
              </button>
            ))}
          </div>
        </fieldset>

        {esFiado && (
          <div className="mb-4 rounded-lg border border-alerta/40 bg-alerta-suave p-3.5">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-tinta-2">
                ¿A nombre de quién queda?
              </span>
              <input
                value={aQuien}
                onChange={(e) => setAQuien(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
                }}
                placeholder="Don Jairo, la señora del 302, el taller de la esquina…"
                aria-label="A nombre de quién queda el fiado"
                autoFocus
                className="rounded border border-linea-2 bg-panel px-3 py-2.5 text-base
                           outline-none placeholder:text-[13px] focus:border-acento"
              />
            </label>
            <p className="mt-1.5 text-[12px] text-tinta-2">
              Escríbelo como lo digas tú. Si ya le has fiado con ese nombre, se le
              suma a la misma cuenta; si es la primera vez, se le abre una.
            </p>
          </div>
        )}

        {esEfectivo && (
          <div className="mb-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-tinta-2">
                ¿Con cuánto paga? <span className="font-normal text-tinta-3">(opcional)</span>
              </span>
              <input
                ref={campo}
                inputMode="numeric"
                value={recibido}
                onChange={(e) => setRecibido(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } }}
                placeholder="Déjalo vacío si paga justo"
                className="cifra rounded border border-linea-2 bg-panel px-3 py-2.5 text-lg
                           outline-none placeholder:text-[15px] placeholder:text-tinta-3
                           focus:border-acento"
              />
            </label>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {BILLETES.filter((b) => b >= total).slice(0, 4).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setRecibido(String(b))}
                  className="cifra rounded border border-linea-2 px-2.5 py-1 text-[13px]
                             font-semibold text-tinta-2 hover:border-acento hover:text-acento"
                >
                  {pesos(b)}
                </button>
              ))}
            </div>

            {hayRecibido && (
              <div
                className={`mt-3 flex items-center justify-between rounded px-3 py-2
                  ${alcanza ? 'bg-bien-suave' : 'bg-grave-suave'}`}
              >
                <span className="text-sm font-semibold text-tinta-2">
                  {alcanza ? 'Vuelto' : 'Falta'}
                </span>
                <span
                  aria-label={alcanza ? 'Vuelto' : 'Falta'}
                  className={`cifra text-xl font-bold ${alcanza ? 'text-bien' : 'text-grave'}`}
                >
                  {pesos(Math.abs(vuelto))}
                </span>
              </div>
            )}
          </div>
        )}

        {error !== null && (
          <p role="alert" className="mb-3 rounded border border-grave/30 bg-grave-suave
                                     px-3 py-2 text-sm text-grave">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={confirmar}
            disabled={cobrando || !listo || metodo === undefined}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded bg-acento
                       px-4 py-3 text-base font-bold text-sobre-acento hover:bg-acento-fuerte
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cobrando ? <Banknote size={17} className="animate-pulse" aria-hidden />
                      : <Check size={17} aria-hidden />}
            {cobrando ? 'Guardando…' : 'Confirmar'}
          </button>
          <button
            type="button"
            onClick={onCancelar}
            disabled={cobrando}
            className="inline-flex items-center gap-2 rounded border border-linea-2 px-4 py-3
                       text-sm font-semibold text-tinta-2 hover:bg-panel-2 disabled:opacity-50"
          >
            <X size={16} aria-hidden />
            Volver
          </button>
        </div>
      </div>
    </div>
  );
}
