/**
 * Historial de ventas, con el detalle de cada una y la anulación.
 *
 * Una venta nunca se borra: se anula, y queda con quién, cuándo y por
 * qué. Por eso la anulación pide un motivo escrito.
 *
 * Un cajero solo ve sus propias ventas. Quien puede ver todas es quien
 * tiene el permiso, y eso se decide en el núcleo, no aquí.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, ChevronDown, ChevronRight, Receipt } from 'lucide-react';

import { HayMasAtras } from '@/compartido/componentes/HayMasAtras';
import { Periodo, hoyLocal } from '@/compartido/componentes/Periodo';
import { fechaHoraCorta, pesos } from '@/compartido/utilidades/formato';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';

interface RenglonVenta {
  readonly producto: string;
  readonly empaque: string;
  readonly cantidad: number;
  readonly unidades: number;
  readonly precio_unitario: number;
  readonly total: number;
}

interface VentaDetallada {
  readonly id: number;
  readonly numero: number;
  readonly fecha: string;
  readonly usuario: string;
  readonly subtotal: number;
  readonly descuento: number;
  readonly total: number;
  readonly anulada: boolean;
  readonly motivo_anulacion: string | null;
  readonly con_faltante: boolean;
  readonly metodos: string;
  readonly items: readonly RenglonVenta[];
}

export function HistorialVentas() {
  const { usuario, puede } = useSesion();
  // Arranca en el ultimo mes y no solo en hoy: quien entra a Ventas
  // suele venir buscando una venta que ya paso, no la de hace un rato.
  const [desde, setDesde] = useState(hoyLocal(-29));
  const [hasta, setHasta] = useState(hoyLocal());
  const [ventas, setVentas] = useState<readonly VentaDetallada[]>([]);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  /** Cuantas ventas se traen del período elegido. */
  const [tope, setTope] = useState(200);

  const [anulando, setAnulando] = useState<VentaDetallada | null>(null);
  const [motivo, setMotivo] = useState('');
  const [procesando, setProcesando] = useState(false);

  const cargar = useCallback(async () => {
    if (usuario === null) return;
    setCargando(true);
    try {
      setVentas(await pedir<VentaDetallada[]>('historial_ventas', {
        periodo: { desde, hasta, rol: usuario.rol },
        usuarioId: usuario.id,
        limite: tope,
      }));
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setCargando(false);
    }
  }, [usuario, desde, hasta, tope]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function anular() {
    if (anulando === null || usuario === null || motivo.trim() === '') return;
    setProcesando(true);
    try {
      await pedir('anular_venta', {
        datos: {
          venta_id: anulando.id,
          // Recortado aqui como en el resto de la app. El nucleo lo
          // recorta igual, pero que dependa de eso hace que dos
          // pantallas parecidas se comporten distinto.
          motivo: motivo.trim(),
          usuario_id: usuario.id,
          rol: usuario.rol,
          autorizado_por: null,
        },
      });
      setAnulando(null);
      setMotivo('');
      setError(null);
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <header>
        <h2 className="text-xl font-bold tracking-tight">Ventas</h2>
        {!puede('venta.ver_todas') && (
          <p className="mt-0.5 text-[13px] text-tinta-3">
            Estás viendo solo tus ventas.
          </p>
        )}
      </header>

      <Periodo
        desde={desde}
        hasta={hasta}
        onCambio={(r) => { setDesde(r.desde); setHasta(r.hasta); }}
      />

      {error !== null && (
        <p role="alert" className="rounded-lg border border-grave/30 bg-grave-suave px-4 py-2.5
                                   text-sm text-grave">
          {error}
        </p>
      )}

      {anulando !== null && (
        <div className="rounded-lg border-2 border-grave bg-grave-suave p-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-grave">
            <Ban size={16} aria-hidden />
            Anular la venta #{anulando.numero} de {pesos(anulando.total)}
          </h3>
          <p className="mt-2 text-[13px] text-tinta-2">
            La mercancía vuelve al inventario y el efectivo sale de la caja abierta.
            La venta no se borra: queda marcada como anulada, con tu nombre y este motivo.
          </p>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-tinta-2">
              ¿Por qué se anula?
            </span>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              autoFocus
              placeholder="el cliente se arrepintió, se cobró de más…"
              className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                         placeholder:text-[13px] focus:border-grave"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => { void anular(); }}
              disabled={procesando || motivo.trim() === ''}
              className="rounded bg-grave px-4 py-2 text-sm font-semibold text-sobre-grave
                         disabled:cursor-not-allowed disabled:opacity-50"
            >
              {procesando ? 'Anulando…' : 'Anular la venta'}
            </button>
            <button
              type="button"
              onClick={() => { setAnulando(null); setMotivo(''); }}
              className="rounded border border-linea-2 bg-panel px-4 py-2 text-sm
                         font-semibold text-tinta-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-linea">
        {cargando ? (
          <p className="p-6 text-sm text-tinta-3">Consultando…</p>
        ) : ventas.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Receipt size={22} className="text-tinta-3" aria-hidden />
            <p className="text-sm text-tinta-2">No hay ventas en este período.</p>
          </div>
        ) : (
          <ul className="divide-y divide-linea">
            {ventas.map((v) => {
              const expandida = abierta === v.id;
              return (
                <li key={v.id} className="bg-panel">
                  <button
                    type="button"
                    onClick={() => setAbierta(expandida ? null : v.id)}
                    aria-expanded={expandida}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-panel-2"
                  >
                    {expandida
                      ? <ChevronDown size={15} className="shrink-0 text-tinta-3" aria-hidden />
                      : <ChevronRight size={15} className="shrink-0 text-tinta-3" aria-hidden />}

                    <span className="cifra w-14 shrink-0 text-sm font-bold">#{v.numero}</span>
                    <span className="cifra w-32 shrink-0 text-[12px] text-tinta-3">
                      {fechaHoraCorta(v.fecha)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-tinta-2">
                      {v.usuario}
                      {v.metodos !== '' && (
                        <span className="ml-2 text-tinta-3">· {v.metodos}</span>
                      )}
                      {v.anulada && (
                        <span className="ml-2 rounded bg-grave-suave px-1.5 py-0.5 text-[11px]
                                         font-semibold text-grave">
                          anulada
                        </span>
                      )}
                      {v.con_faltante && !v.anulada && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded
                                         bg-alerta-suave px-1.5 py-0.5 text-[11px]
                                         font-semibold text-alerta">
                          <AlertTriangle size={10} aria-hidden />
                          faltante
                        </span>
                      )}
                    </span>
                    <span className={`cifra shrink-0 text-sm font-bold ${
                      v.anulada ? 'text-tinta-3 line-through' : ''}`}
                    >
                      {pesos(v.total)}
                    </span>
                  </button>

                  {expandida && (
                    <div className="border-t border-linea bg-panel-2 px-4 py-3">
                      <ul className="flex flex-col gap-1">
                        {v.items.map((i, n) => (
                          <li key={n} className="flex items-baseline gap-3 text-[13px]">
                            <span className="cifra w-10 shrink-0 text-right text-tinta-3">
                              {i.cantidad}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {i.producto}
                              <span className="ml-1.5 text-[12px] text-tinta-3">
                                {i.empaque.toLowerCase()}
                                {i.unidades !== i.cantidad && ` · ${i.unidades} unidades`}
                              </span>
                            </span>
                            <span className="cifra shrink-0 text-tinta-3">
                              {pesos(i.precio_unitario)}
                            </span>
                            <span className="cifra w-20 shrink-0 text-right font-semibold">
                              {pesos(i.total)}
                            </span>
                          </li>
                        ))}
                      </ul>

                      {v.descuento > 0 && (
                        <div className="mt-2 flex justify-end gap-3 text-[13px] text-tinta-2">
                          <span>Descuento</span>
                          <span className="cifra w-20 text-right">−{pesos(v.descuento)}</span>
                        </div>
                      )}

                      {v.anulada && v.motivo_anulacion !== null && (
                        <p className="mt-2 rounded border border-grave/30 bg-grave-suave px-3
                                      py-1.5 text-[12px] text-tinta-2">
                          Anulada: {v.motivo_anulacion}
                        </p>
                      )}

                      {!v.anulada && puede('venta.anular') && (
                        <button
                          type="button"
                          onClick={() => { setAnulando(v); setMotivo(''); }}
                          className="mt-2 inline-flex items-center gap-1.5 text-[13px]
                                     font-semibold text-tinta-3 hover:text-grave"
                        >
                          <Ban size={13} aria-hidden />
                          Anular esta venta
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {ventas.length === tope && (
          <HayMasAtras
            viendo={tope}
            nombre="ventas"
            onVerMas={() => setTope((n) => n + 300)}
          />
        )}
      </div>

      {ventas.length > 0 && (
        <p className="text-[12px] text-tinta-3">
          <span className="cifra">{ventas.length}</span> ventas ·{' '}
          <span className="cifra">
            {pesos(ventas.filter((v) => !v.anulada).reduce((s, v) => s + v.total, 0))}
          </span>{' '}
          sin contar las anuladas
        </p>
      )}
    </div>
  );
}
