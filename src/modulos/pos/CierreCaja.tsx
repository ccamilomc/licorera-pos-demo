/**
 * Cierre de caja: arqueo ciego.
 *
 * El cajero cuenta el efectivo y digita lo que conto **antes** de que el
 * sistema le muestre lo esperado. Si viera el numero primero, el conteo
 * dejaria de ser un control y se volveria un tramite de confirmar.
 *
 * Por eso esta pantalla tiene dos pasos que no se pueden saltar.
 */

import { useMemo, useState } from 'react';
import { ArrowRight, Calculator, Check } from 'lucide-react';

import { pesos } from '@/compartido/utilidades/formato';

export interface TotalPorMetodo {
  readonly metodo: string;
  readonly es_efectivo: boolean;
  readonly total: number;
  readonly cantidad: number;
}

export interface ResumenCaja {
  readonly caja_id: number;
  readonly base_inicial: number;
  readonly ventas_total: number;
  readonly ventas_cantidad: number;
  readonly entradas: number;
  readonly salidas: number;
  readonly efectivo_esperado: number;
  readonly por_metodo: readonly TotalPorMetodo[];
}

interface Props {
  readonly resumen: ResumenCaja;
  readonly cerrando: boolean;
  readonly error: string | null;
  readonly onCerrar: (contado: number, observaciones: string | null) => void;
  readonly onCancelar: () => void;
}

/** Denominaciones que circulan en el local, para contar sin calculadora. */
const DENOMINACIONES = [100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100];

export function CierreCaja({ resumen, cerrando, error, onCerrar, onCancelar }: Props) {
  const [paso, setPaso] = useState<'contar' | 'comparar'>('contar');
  const [conteo, setConteo] = useState<Record<number, string>>({});
  const [manual, setManual] = useState('');
  const [usarDetalle, setUsarDetalle] = useState(true);
  const [observaciones, setObservaciones] = useState('');

  const contadoDetalle = useMemo(
    () => DENOMINACIONES.reduce(
      (suma, valor) => suma + valor * (Number(conteo[valor] ?? 0) || 0),
      0,
    ),
    [conteo],
  );

  const contado = usarDetalle ? contadoDetalle : Number(manual.replace(/\D/g, '')) || 0;
  const diferencia = contado - resumen.efectivo_esperado;
  const faltaExplicar = diferencia !== 0 && observaciones.trim() === '';

  if (paso === 'contar') {
    return (
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-5">
          <h2 className="text-xl font-bold tracking-tight">Cuenta el dinero</h2>
          <p className="mt-1 text-sm text-tinta-2">
            Cuenta el efectivo que hay en la caja y anótalo aquí. Después te muestro
            cuánto debería haber.
          </p>
        </header>

        <div className="rounded-lg border border-linea bg-panel p-5">
          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => setUsarDetalle(true)}
              aria-pressed={usarDetalle}
              className={`flex-1 rounded border px-3 py-2 text-sm font-semibold ${
                usarDetalle ? 'border-acento bg-acento-suave text-acento'
                            : 'border-linea-2 text-tinta-2'}`}
            >
              Contar por billete
            </button>
            <button
              type="button"
              onClick={() => setUsarDetalle(false)}
              aria-pressed={!usarDetalle}
              className={`flex-1 rounded border px-3 py-2 text-sm font-semibold ${
                !usarDetalle ? 'border-acento bg-acento-suave text-acento'
                             : 'border-linea-2 text-tinta-2'}`}
            >
              Escribir el total
            </button>
          </div>

          {usarDetalle ? (
            <ul className="flex flex-col gap-1.5">
              {DENOMINACIONES.map((valor) => (
                <li key={valor} className="flex items-center gap-3">
                  <span className="cifra w-20 shrink-0 text-right text-sm font-semibold
                                   text-tinta-2">
                    {pesos(valor)}
                  </span>
                  <input
                    inputMode="numeric"
                    aria-label={`Cantidad de ${pesos(valor)}`}
                    value={conteo[valor] ?? ''}
                    onChange={(e) => setConteo((c) => ({
                      ...c, [valor]: e.target.value.replace(/\D/g, ''),
                    }))}
                    placeholder="0"
                    className="cifra w-20 rounded border border-linea-2 bg-panel px-2 py-1.5
                               text-center outline-none focus:border-acento"
                  />
                  <span className="cifra flex-1 text-right text-sm text-tinta-3">
                    {pesos(valor * (Number(conteo[valor] ?? 0) || 0))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-tinta-2">
                Total contado
              </span>
              <input
                inputMode="numeric"
                value={manual}
                onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))}
                autoFocus
                placeholder="0"
                className="cifra rounded border border-linea-2 bg-panel px-3 py-2.5 text-xl
                           outline-none focus:border-acento"
              />
            </label>
          )}

          <div className="mt-4 flex items-baseline justify-between border-t border-linea pt-3">
            <span className="text-sm font-semibold text-tinta-2">Contaste</span>
            <span aria-label="Suma contada" className="cifra text-2xl font-extrabold">
              {pesos(contado)}
            </span>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setPaso('comparar')}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded bg-acento
                       px-4 py-3 text-sm font-bold text-sobre-acento hover:bg-acento-fuerte"
          >
            Continuar
            <ArrowRight size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onCancelar}
            className="rounded border border-linea-2 px-4 py-3 text-sm font-semibold text-tinta-2
                       hover:bg-panel-2"
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <header className="mb-5">
        <h2 className="text-xl font-bold tracking-tight">Cierre del turno</h2>
      </header>

      <div className="rounded-lg border border-linea bg-panel p-5">
        <dl className="flex flex-col gap-2 text-sm">
          <Fila rotulo="Base inicial" valor={resumen.base_inicial} />
          {resumen.por_metodo
            .filter((m) => m.total > 0)
            .map((m) => (
              <Fila
                key={m.metodo}
                rotulo={`Ventas en ${m.metodo.toLowerCase()}`}
                valor={m.total}
                detalle={!m.es_efectivo ? 'no entra al cajón' : undefined}
              />
            ))}
          {resumen.entradas > 0 && <Fila rotulo="Entradas de dinero" valor={resumen.entradas} />}
          {resumen.salidas > 0 && <Fila rotulo="Salidas de dinero" valor={-resumen.salidas} />}
        </dl>

        <div className="mt-4 flex items-baseline justify-between border-t border-linea pt-3">
          <span className="text-sm font-semibold text-tinta-2">Debería haber</span>
          <span aria-label="Efectivo esperado" className="cifra text-xl font-bold">
            {pesos(resumen.efectivo_esperado)}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="text-sm font-semibold text-tinta-2">Contaste</span>
          <span className="cifra text-xl font-bold">{pesos(contado)}</span>
        </div>

        <div className={`mt-3 flex items-baseline justify-between rounded px-3 py-2.5 ${
          diferencia === 0 ? 'bg-bien-suave'
                           : diferencia > 0 ? 'bg-alerta-suave' : 'bg-grave-suave'}`}
        >
          <span className="text-sm font-bold text-tinta-2">
            {diferencia === 0 ? 'Cuadra' : diferencia > 0 ? 'Sobra' : 'Falta'}
          </span>
          <span
            aria-label="Diferencia"
            className={`cifra text-2xl font-extrabold ${
              diferencia === 0 ? 'text-bien' : diferencia > 0 ? 'text-alerta' : 'text-grave'}`}
          >
            {pesos(Math.abs(diferencia))}
          </span>
        </div>

        {diferencia !== 0 && (
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-tinta-2">
              ¿Por qué hay diferencia?
            </span>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
              autoFocus
              placeholder="Por ejemplo: se pagó un domicilio sin registrar"
              className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                         placeholder:text-tinta-3 focus:border-acento"
            />
          </label>
        )}

        {error !== null && (
          <p role="alert" className="mt-3 rounded border border-grave/30 bg-grave-suave
                                     px-3 py-2 text-sm text-grave">
            {error}
          </p>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onCerrar(contado, observaciones.trim() === '' ? null : observaciones)}
          disabled={cerrando || faltaExplicar}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded bg-acento
                     px-4 py-3 text-sm font-bold text-sobre-acento hover:bg-acento-fuerte
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cerrando ? <Calculator size={16} className="animate-pulse" aria-hidden />
                    : <Check size={16} aria-hidden />}
          {cerrando ? 'Cerrando…' : 'Cerrar la caja'}
        </button>
        <button
          type="button"
          onClick={() => setPaso('contar')}
          disabled={cerrando}
          className="rounded border border-linea-2 px-4 py-3 text-sm font-semibold text-tinta-2
                     hover:bg-panel-2 disabled:opacity-50"
        >
          Volver a contar
        </button>
      </div>

      {faltaExplicar && (
        <p className="mt-2 text-center text-[12px] text-tinta-3">
          Escribe el motivo de la diferencia para poder cerrar.
        </p>
      )}
    </div>
  );
}

function Fila({
  rotulo, valor, detalle,
}: {
  readonly rotulo: string;
  readonly valor: number;
  // `| undefined` explicito: con exactOptionalPropertyTypes activo, pasar
  // undefined a una prop opcional no es lo mismo que omitirla.
  readonly detalle?: string | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-tinta-2">
        {rotulo}
        {detalle !== undefined && (
          <span className="ml-1.5 text-[12px] text-tinta-3">({detalle})</span>
        )}
      </dt>
      <dd className="cifra font-semibold">
        {valor < 0 ? `−${pesos(Math.abs(valor))}` : pesos(valor)}
      </dd>
    </div>
  );
}
