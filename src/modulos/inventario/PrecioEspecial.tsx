/**
 * Precios que rigen solo por un tiempo.
 *
 * Para subir o bajar el precio de algo por un día, un fin de semana o una
 * temporada, sin perder el precio de siempre. Cuando la fecha pasa, el
 * producto vuelve solo a su precio de lista: nadie tiene que acordarse de
 * devolverlo, que es donde se queda la plata en la práctica.
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Plus, X } from 'lucide-react';

import { fechaCorta, pesos } from '@/compartido/utilidades/formato';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';

interface PrecioVigencia {
  readonly id: number;
  readonly producto_id: number;
  readonly producto: string;
  readonly empaque_id: number | null;
  readonly empaque: string | null;
  readonly precio_normal: number;
  readonly precio: number;
  readonly motivo: string | null;
  readonly desde: string;
  readonly hasta: string;
  readonly activo: boolean;
  readonly vigente_hoy: boolean;
}

interface EmpaqueDisponible {
  readonly id: number | null;
  readonly nombre: string;
  readonly precio_venta: number | null;
}

interface Props {
  readonly productoId: number;
  readonly precioNormal: number;
  readonly empaques: readonly EmpaqueDisponible[];
}

function hoyLocal(dias = 0): string {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  return [
    f.getFullYear(),
    String(f.getMonth() + 1).padStart(2, '0'),
    String(f.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Rangos que se piden de verdad, para no escribir fechas a mano. */
const ATAJOS: readonly { texto: string; dias: number }[] = [
  { texto: 'Solo hoy', dias: 0 },
  { texto: 'Hoy y mañana', dias: 1 },
  { texto: 'Una semana', dias: 6 },
  { texto: 'Un mes', dias: 29 },
];

export function PrecioEspecial({ productoId, precioNormal, empaques }: Props) {
  const { usuario, puede } = useSesion();
  const [lista, setLista] = useState<readonly PrecioVigencia[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const [creando, setCreando] = useState(false);
  const [precio, setPrecio] = useState('');
  const [empaqueId, setEmpaqueId] = useState<number | null>(null);
  const [desde, setDesde] = useState(hoyLocal());
  const [hasta, setHasta] = useState(hoyLocal());
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  const recargar = useCallback(async () => {
    if (usuario === null) return;
    setCargando(true);
    try {
      setLista(await pedir<PrecioVigencia[]>('listar_precios_especiales', {
        productoId, rol: usuario.rol,
      }));
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setCargando(false);
    }
  }, [productoId, usuario]);

  useEffect(() => { void recargar(); }, [recargar]);

  const precioNumero = Number(precio.replace(/\D/g, '')) || 0;
  const listo = precioNumero > 0 && desde !== '' && hasta !== '' && hasta >= desde;

  /** El precio de lista de lo que se está cambiando, para comparar. */
  const base = empaqueId === null
    ? precioNormal
    : empaques.find((e) => e.id === empaqueId)?.precio_venta ?? precioNormal;
  const diferencia = precioNumero - base;

  async function guardar() {
    if (usuario === null || !listo) return;
    setGuardando(true);
    try {
      await pedir('poner_precio_especial', {
        precio: {
          producto_id: productoId,
          empaque_id: empaqueId,
          precio: precioNumero,
          motivo: motivo.trim() === '' ? null : motivo.trim(),
          desde,
          hasta,
        },
        usuarioId: usuario.id,
        rol: usuario.rol,
      });
      setCreando(false);
      setPrecio('');
      setMotivo('');
      await recargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(id: number) {
    if (usuario === null) return;
    try {
      await pedir('quitar_precio_especial', {
        precioId: id, usuarioId: usuario.id, rol: usuario.rol,
      });
      await recargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  if (!puede('producto.precio')) return null;

  const vigentes = lista.filter((p) => p.vigente_hoy);
  const otros = lista.filter((p) => !p.vigente_hoy && p.activo);

  return (
    <div className="flex flex-col gap-3">
      {error !== null && (
        <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3 py-2
                                   text-sm text-grave">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="text-sm text-tinta-3">Consultando…</p>
      ) : (
        <>
          {vigentes.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {vigentes.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded border border-acento/40
                             bg-acento-suave px-3 py-2"
                >
                  <CalendarClock size={15} className="shrink-0 text-acento" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      <span className="cifra">{pesos(p.precio)}</span>
                      {p.empaque !== null && (
                        <span className="font-normal text-tinta-2"> el {p.empaque.toLowerCase()}</span>
                      )}
                      <span className="ml-2 text-[12px] font-normal text-tinta-2">
                        en vez de <span className="cifra">{pesos(p.precio_normal)}</span>
                      </span>
                    </p>
                    <p className="text-[12px] text-tinta-3">
                      hasta el {fechaCorta(p.hasta)}
                      {p.motivo !== null && ` · ${p.motivo}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void quitar(p.id); }}
                    aria-label={`Quitar el precio especial de ${pesos(p.precio)}`}
                    className="rounded p-1 text-tinta-3 hover:text-grave"
                  >
                    <X size={15} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {otros.length > 0 && (
            <details className="text-[13px]">
              <summary className="cursor-pointer text-tinta-3 hover:text-tinta-2">
                {otros.length} {otros.length === 1 ? 'programado o vencido' : 'programados o vencidos'}
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1">
                {otros.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-1">
                    <span className="text-tinta-3">
                      <span className="cifra">{pesos(p.precio)}</span>
                      {' · '}{fechaCorta(p.desde)} a {fechaCorta(p.hasta)}
                    </span>
                    <button
                      type="button"
                      onClick={() => { void quitar(p.id); }}
                      aria-label={`Quitar el precio de ${fechaCorta(p.desde)}`}
                      className="rounded p-0.5 text-tinta-3 hover:text-grave"
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {creando ? (
            <div className="flex flex-col gap-2.5 rounded border border-linea-2 bg-panel-2 p-3">
              <div className="flex flex-wrap items-end gap-2.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-tinta-2">Precio</span>
                  <input
                    inputMode="numeric"
                    value={precio}
                    onChange={(e) => setPrecio(e.target.value.replace(/\D/g, ''))}
                    aria-label="Precio especial"
                    autoFocus
                    className="cifra w-28 rounded border border-linea-2 bg-panel px-2 py-1.5
                               text-right text-sm outline-none focus:border-acento"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-tinta-2">¿De qué?</span>
                  <select
                    value={empaqueId ?? ''}
                    onChange={(e) => setEmpaqueId(
                      e.target.value === '' ? null : Number(e.target.value))}
                    aria-label="A qué forma de venta se le pone"
                    className="rounded border border-linea-2 bg-panel px-2 py-1.5 text-sm
                               outline-none focus:border-acento"
                  >
                    <option value="">Todo el producto</option>
                    {empaques
                      .filter((e) => e.id !== null)
                      .map((e) => (
                        <option key={e.id} value={e.id!}>{e.nombre}</option>
                      ))}
                  </select>
                </label>

                {precioNumero > 0 && (
                  <p className={`pb-1.5 text-[13px] font-semibold ${
                    diferencia < 0 ? 'text-bien' : diferencia > 0 ? 'text-alerta' : 'text-tinta-3'}`}
                  >
                    {diferencia === 0
                      ? 'igual al de siempre'
                      : `${diferencia < 0 ? 'baja' : 'sube'} ${pesos(Math.abs(diferencia))}`}
                    <span className="ml-1 font-normal text-tinta-3">
                      (de {pesos(base)})
                    </span>
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {ATAJOS.map((a) => (
                  <button
                    key={a.texto}
                    type="button"
                    onClick={() => { setDesde(hoyLocal()); setHasta(hoyLocal(a.dias)); }}
                    aria-pressed={desde === hoyLocal() && hasta === hoyLocal(a.dias)}
                    className={`rounded border px-2.5 py-1 text-[12px] font-semibold
                      ${desde === hoyLocal() && hasta === hoyLocal(a.dias)
                        ? 'border-acento bg-acento-suave text-acento'
                        : 'border-linea-2 text-tinta-2 hover:border-acento'}`}
                  >
                    {a.texto}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-2.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-tinta-2">Desde</span>
                  <input
                    type="date" value={desde} max={hasta}
                    onChange={(e) => setDesde(e.target.value)}
                    className="cifra rounded border border-linea-2 bg-panel px-2 py-1.5
                               text-sm outline-none focus:border-acento"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-tinta-2">Hasta</span>
                  <input
                    type="date" value={hasta} min={desde}
                    onChange={(e) => setHasta(e.target.value)}
                    className="cifra rounded border border-linea-2 bg-panel px-2 py-1.5
                               text-sm outline-none focus:border-acento"
                  />
                </label>
                <label className="flex min-w-[140px] flex-1 flex-col gap-1">
                  <span className="text-[12px] font-semibold text-tinta-2">¿Por qué?</span>
                  <input
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="promoción, día de la madre…"
                    aria-label="Motivo del precio especial"
                    className="rounded border border-linea-2 bg-panel px-2 py-1.5 text-sm
                               outline-none placeholder:text-[12px] focus:border-acento"
                  />
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { void guardar(); }}
                  disabled={!listo || guardando}
                  className="rounded bg-acento px-3 py-1.5 text-[13px] font-bold
                             text-sobre-acento hover:bg-acento-fuerte
                             disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {guardando ? 'Guardando…' : 'Poner este precio'}
                </button>
                <button
                  type="button"
                  onClick={() => { setCreando(false); setPrecio(''); setMotivo(''); }}
                  className="rounded border border-linea-2 px-3 py-1.5 text-[13px]
                             font-semibold text-tinta-2 hover:bg-panel"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCreando(true);
                setDesde(hoyLocal());
                setHasta(hoyLocal());
              }}
              className="flex items-center gap-1.5 self-start rounded border border-dashed
                         border-linea-2 px-3 py-2 text-[13px] font-semibold text-tinta-2
                         hover:border-acento hover:text-acento"
            >
              <Plus size={14} aria-hidden />
              Poner un precio por unos días
            </button>
          )}

          <p className="text-[12px] text-tinta-3">
            El precio de siempre no se toca. Cuando la fecha pase, el producto vuelve
            solo a <span className="cifra">{pesos(precioNormal)}</span>.
          </p>
        </>
      )}
    </div>
  );
}
