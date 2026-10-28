/**
 * Estado de resultados.
 *
 * Sigue el orden de un estado de resultados de verdad, y cada renglón sale
 * de un dato registrado, no de una estimación. Lo que se busca es que el
 * dueño pueda seguir la cuenta de arriba abajo sin que ningún peso
 * aparezca o desaparezca por el camino: si un renglón no cuadra con el
 * siguiente, deja de creerle al reporte entero —y con razón.
 *
 * Dos renglones que casi ningún sistema muestra y aquí sí: las ventas
 * anuladas, para poder cuadrar esto contra el historial, y la merma, que
 * es plata perdida igual que un gasto aunque solo se vea como existencia
 * que falta.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Printer, TrendingDown, TrendingUp } from 'lucide-react';

import { pesos } from '@/compartido/utilidades/formato';
import { Periodo, hoyLocal, inicioDeMes } from '@/compartido/componentes/Periodo';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';
import { generarImpresion, imprimir } from './imprimir';

interface GastoFijo {
  readonly concepto: string;
  readonly cuantos: number;
  readonly del_periodo: number;
}

interface Merma {
  readonly motivo: string;
  readonly unidades: number;
  readonly costo: number;
}

interface UtilidadPorCategoria {
  readonly categoria: string;
  readonly ventas: number;
  readonly costo: number;
  readonly utilidad: number;
  readonly margen: number;
  readonly peso: number;
}

interface PeriodoAnterior {
  readonly desde: string;
  readonly hasta: string;
  readonly ventas_netas: number;
  readonly utilidad_bruta: number;
  readonly utilidad_operacional: number;
}

interface Estado {
  readonly desde: string;
  readonly hasta: string;
  readonly dias: number;

  readonly ventas_registradas: number;
  readonly descuentos: number;
  readonly anulaciones: number;
  readonly ventas_netas: number;
  readonly impuestos: number;

  readonly costo_de_ventas: number;
  readonly utilidad_bruta: number;
  readonly margen_bruto: number;

  readonly mermas: readonly Merma[];
  readonly total_merma: number;
  readonly utilidad_bruta_ajustada: number;

  readonly gastos: readonly GastoFijo[];
  readonly total_gastos: number;
  readonly utilidad_operacional: number;
  readonly margen_operacional: number;

  readonly por_categoria: readonly UtilidadPorCategoria[];
  readonly anterior: PeriodoAnterior | null;
  readonly punto_de_equilibrio: number;
  readonly ventas_contadas: number;
  readonly unidades_vendidas: number;
  readonly ticket_promedio: number;

  readonly fiado_del_periodo: number;
  readonly fiado_sin_cobrar: number;
  readonly renglones_sin_costo: number;
  readonly ventas_sin_costo: number;
}

/** Cuánto cambió algo respecto al período anterior, en porcentaje. */
function variacion(ahora: number, antes: number): number | null {
  if (antes === 0) return null;
  return Math.round(((ahora - antes) / Math.abs(antes)) * 100);
}

export function EstadoResultados() {
  const { usuario, nombreNegocio } = useSesion();
  const [desde, setDesde] = useState(inicioDeMes());
  const [hasta, setHasta] = useState(hoyLocal());
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (usuario === null) return;
    try {
      setEstado(await pedir<Estado>('estado_de_resultados', {
        periodo: { desde, hasta, rol: usuario.rol },
      }));
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
      setEstado(null);
    }
  }, [usuario, desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  function imprimirEstado() {
    if (estado === null) return;
    const filas: string[][] = [
      ['Ventas registradas', pesos(estado.ventas_registradas)],
      ...(estado.descuentos > 0
        ? [['(−) Descuentos concedidos', `−${pesos(estado.descuentos)}`]] : []),
      ...(estado.anulaciones > 0
        ? [['(−) Ventas anuladas', `−${pesos(estado.anulaciones)}`]] : []),
      ['= Ventas netas', pesos(estado.ventas_netas)],
      ['(−) Costo de la mercancía vendida', `−${pesos(estado.costo_de_ventas)}`],
      [`= Utilidad bruta (${estado.margen_bruto} %)`, pesos(estado.utilidad_bruta)],
      ...(estado.total_merma > 0
        ? [['(−) Merma de inventario', `−${pesos(estado.total_merma)}`],
           ['= Utilidad bruta ajustada', pesos(estado.utilidad_bruta_ajustada)]]
        : []),
      ...estado.gastos.map((g) => [`(−) ${g.concepto}`, `−${pesos(g.del_periodo)}`]),
      ['(−) Total gastos de operación', `−${pesos(estado.total_gastos)}`],
    ];
    imprimir(generarImpresion({
      negocio: nombreNegocio,
      reporte: 'Estado de resultados',
      desde, hasta,
      columnas: [{ titulo: 'Concepto' }, { titulo: 'Valor', esDinero: true }],
      filas,
      totales: [
        `= Utilidad operacional (${estado.margen_operacional} %)`,
        pesos(estado.utilidad_operacional),
      ],
    }));
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <header>
        <h2 className="text-xl font-bold tracking-tight">Estado de resultados</h2>
        <p className="mt-0.5 text-sm text-tinta-2">
          Cuánto entró, cuánto costó, qué se perdió y qué quedó.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <Periodo
          desde={desde}
          hasta={hasta}
          onCambio={(r) => { setDesde(r.desde); setHasta(r.hasta); }}
        />
        <button
          type="button"
          onClick={imprimirEstado}
          disabled={estado === null}
          className="inline-flex items-center gap-2 rounded border border-linea-2 px-3 py-2
                     text-sm font-semibold text-tinta-2 hover:border-acento hover:text-acento
                     disabled:opacity-50"
        >
          <Printer size={15} aria-hidden />
          Imprimir o guardar en PDF
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="rounded-lg border border-grave/30 bg-grave-suave px-4 py-2.5
                                   text-sm text-grave">
          {error}
        </p>
      )}

      {estado !== null && (
        <>
          {estado.renglones_sin_costo > 0 && (
            <div className="flex max-w-3xl items-start gap-2.5 rounded-lg border
                            border-alerta/40 bg-alerta-suave p-4">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-alerta" aria-hidden />
              <div>
                <p className="text-sm font-bold">Esta utilidad está inflada</p>
                <p className="mt-0.5 text-[13px] text-tinta-2">
                  Hay <strong className="cifra">{pesos(estado.ventas_sin_costo)}</strong> en
                  ventas —{estado.renglones_sin_costo}{' '}
                  {estado.renglones_sin_costo === 1 ? 'renglón' : 'renglones'}— sin costo
                  registrado, así que el costo de ventas sale más bajo de lo que fue. Al
                  registrar las compras de esos productos el número se corrige solo.
                </p>
              </div>
            </div>
          )}

          <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* La cascada */}
            <section className="rounded-lg border border-linea bg-panel p-5">
              <dl className="flex flex-col text-sm">
                <Grupo titulo="Ingresos" />
                <Linea
                  rotulo="Ventas registradas"
                  valor={estado.ventas_registradas}
                  ayuda="Todo lo que pasó por la caja, incluido lo que después se anuló."
                />
                {estado.descuentos > 0 && (
                  <Linea
                    rotulo="(−) Descuentos concedidos"
                    valor={-estado.descuentos}
                    ayuda="Rebajas hechas en el mostrador."
                  />
                )}
                {estado.anulaciones > 0 && (
                  <Linea
                    rotulo="(−) Ventas anuladas"
                    valor={-estado.anulaciones}
                    ayuda="Se cobraron y se devolvieron. No son ingreso."
                  />
                )}
                {estado.impuestos > 0 && (
                  <Linea rotulo="(−) Impuesto cobrado" valor={-estado.impuestos} />
                )}
                <Subtotal rotulo="= Ventas netas" valor={estado.ventas_netas} />

                <Grupo titulo="Costo de lo vendido" />
                <Linea
                  rotulo="(−) Costo de la mercancía vendida"
                  valor={-estado.costo_de_ventas}
                  ayuda="Lo que te costó a ti lo que vendiste, al costo del día que lo compraste."
                />
                <Subtotal
                  rotulo="= Utilidad bruta"
                  valor={estado.utilidad_bruta}
                  nota={`${estado.margen_bruto} % de las ventas netas`}
                />

                {estado.total_merma > 0 && (
                  <>
                    <Grupo titulo="Pérdidas de inventario" />
                    <Linea
                      rotulo="(−) Merma"
                      valor={-estado.total_merma}
                      ayuda="Existencia que salió sin venderse: rota, vencida o descuadrada."
                    />
                    {estado.mermas.map((m) => (
                      <Detalle
                        key={m.motivo}
                        rotulo={m.motivo}
                        valor={m.costo}
                        nota={`${m.unidades} ${m.unidades === 1 ? 'unidad' : 'unidades'}`}
                      />
                    ))}
                    <Subtotal
                      rotulo="= Utilidad bruta ajustada"
                      valor={estado.utilidad_bruta_ajustada}
                    />
                  </>
                )}

                {estado.fiado_del_periodo > 0 && (
                  <p className="mt-2 rounded border border-alerta/40 bg-alerta-suave
                                px-3 py-2 text-[12px] text-tinta-2">
                    De estas ventas,{' '}
                    <strong className="cifra">{pesos(estado.fiado_del_periodo)}</strong>{' '}
                    se fiaron
                    {estado.fiado_sin_cobrar > 0 ? (
                      <>
                        {' '}y{' '}
                        <strong className="cifra">
                          {pesos(estado.fiado_sin_cobrar)}
                        </strong>{' '}
                        siguen sin cobrarse.
                      </>
                    ) : ' y ya se cobraron todos.'}
                    {' '}La utilidad los cuenta —la venta está hecha— pero esa plata
                    no está en la caja.
                  </p>
                )}

                <Grupo titulo="Gastos de operación" />
                <Linea rotulo="(−) Total gastos" valor={-estado.total_gastos} />
                {estado.gastos.length === 0 ? (
                  <p className="px-3 py-2 text-[13px] text-tinta-3">
                    No hay gastos anotados en este período. Se anotan en Gastos.
                  </p>
                ) : estado.gastos.map((g) => (
                  <Detalle
                    key={g.concepto}
                    rotulo={g.concepto}
                    valor={g.del_periodo}
                    // «Sueldos 2.800.000» se lee distinto si son dos pagos
                    // que si son ocho.
                    nota={g.cuantos === 1 ? undefined
                      : `${g.cuantos} pagos`}
                  />
                ))}

                <div className={`mt-4 flex items-baseline justify-between rounded px-3 py-3 ${
                  estado.utilidad_operacional >= 0 ? 'bg-bien-suave' : 'bg-grave-suave'}`}
                >
                  <dt className="font-bold">= Utilidad operacional</dt>
                  <dd
                    aria-label="Utilidad operacional"
                    className={`cifra text-2xl font-extrabold ${
                      estado.utilidad_operacional >= 0 ? 'text-bien' : 'text-grave'}`}
                  >
                    {pesos(estado.utilidad_operacional)}
                    <span className="ml-2 text-[12px] font-semibold">
                      {estado.margen_operacional} %
                    </span>
                  </dd>
                </div>
              </dl>

              {estado.gastos.length > 0 && (
                <p className="mt-3 text-[12px] text-tinta-3">
                  Es lo que se pagó dentro de estos{' '}
                  <strong className="cifra">{estado.dias}</strong> días, no una parte
                  calculada de un valor mensual. Un arriendo que se paga el primero
                  no aparece en un período que no lo incluya.
                </p>
              )}
            </section>

            {/* Lo que ayuda a leer el número */}
            <aside className="flex flex-col gap-4">
              {estado.anterior !== null && (
                <Tarjeta titulo="Contra el período anterior">
                  <p className="mb-2 text-[12px] text-tinta-3">
                    {estado.anterior.desde} a {estado.anterior.hasta}
                  </p>
                  <Comparacion
                    rotulo="Ventas netas"
                    ahora={estado.ventas_netas}
                    antes={estado.anterior.ventas_netas}
                  />
                  <Comparacion
                    rotulo="Utilidad bruta"
                    ahora={estado.utilidad_bruta}
                    antes={estado.anterior.utilidad_bruta}
                  />
                  <Comparacion
                    rotulo="Utilidad operacional"
                    ahora={estado.utilidad_operacional}
                    antes={estado.anterior.utilidad_operacional}
                  />
                </Tarjeta>
              )}

              <Tarjeta titulo="Cuánto hay que vender">
                {estado.punto_de_equilibrio > 0 ? (
                  <>
                    <p className="cifra text-xl font-bold">
                      {pesos(estado.punto_de_equilibrio)}
                    </p>
                    <p className="mt-1 text-[12px] text-tinta-2">
                      es lo que hay que vender en {estado.dias}{' '}
                      {estado.dias === 1 ? 'día' : 'días'} para no perder plata, con el
                      margen que estás logrando. Vendiste{' '}
                      <strong className="cifra">{pesos(estado.ventas_netas)}</strong>.
                    </p>
                    {estado.ventas_netas >= estado.punto_de_equilibrio ? (
                      <p className="mt-2 text-[12px] font-semibold text-bien">
                        Lo pasaste por {pesos(estado.ventas_netas - estado.punto_de_equilibrio)}.
                      </p>
                    ) : (
                      <p className="mt-2 text-[12px] font-semibold text-alerta">
                        Faltaron {pesos(estado.punto_de_equilibrio - estado.ventas_netas)}.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[13px] text-tinta-2">
                    Sin margen no hay cuenta que dé: por mucho que vendas, no alcanza a
                    cubrir los gastos. Revisa los precios o los costos.
                  </p>
                )}
              </Tarjeta>

              <Tarjeta titulo="El período">
                <Dato rotulo="Ventas hechas" valor={String(estado.ventas_contadas)} />
                <Dato rotulo="Unidades vendidas" valor={String(estado.unidades_vendidas)} />
                <Dato rotulo="Ticket promedio" valor={pesos(estado.ticket_promedio)} />
                <Dato
                  rotulo="Venta diaria promedio"
                  valor={pesos(Math.round(estado.ventas_netas / Math.max(1, estado.dias)))}
                />
              </Tarjeta>
            </aside>
          </div>

          {estado.por_categoria.length > 0 && (
            <section className="max-w-5xl rounded-lg border border-linea bg-panel p-5">
              <h3 className="mb-1 text-sm font-bold">Qué línea deja la plata</h3>
              <p className="mb-3 text-[12px] text-tinta-3">
                Vender mucho y ganar poco es posible: lo que importa no es cuánto sale por
                la puerta sino cuánto queda de cada venta.
              </p>
              <div className="overflow-x-auto rounded border border-linea">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-panel-2">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
                      <th className="px-3 py-2 font-semibold">Categoría</th>
                      <th className="px-3 py-2 text-right font-semibold">Vendido</th>
                      <th className="px-3 py-2 text-right font-semibold">Costó</th>
                      <th className="px-3 py-2 text-right font-semibold">Quedó</th>
                      <th className="px-3 py-2 text-right font-semibold">Margen</th>
                      <th className="px-3 py-2 text-right font-semibold">De la utilidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estado.por_categoria.map((c) => (
                      <tr key={c.categoria} className="border-t border-linea">
                        <td className="px-3 py-2 font-semibold">{c.categoria}</td>
                        <td className="cifra px-3 py-2 text-right text-tinta-2">
                          {pesos(c.ventas)}
                        </td>
                        <td className="cifra px-3 py-2 text-right text-tinta-2">
                          {pesos(c.costo)}
                        </td>
                        <td className="cifra px-3 py-2 text-right font-semibold">
                          {pesos(c.utilidad)}
                        </td>
                        <td className="cifra px-3 py-2 text-right text-tinta-2">
                          {c.margen} %
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="cifra text-[12px] text-tinta-2">{c.peso} %</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Grupo({ titulo }: { readonly titulo: string }) {
  return (
    <dt className="mt-3 border-b border-linea pb-1 text-[11px] font-bold uppercase
                   tracking-wider text-tinta-3 first:mt-0">
      {titulo}
    </dt>
  );
}

function Linea({
  rotulo, valor, ayuda,
}: {
  readonly rotulo: string;
  readonly valor: number;
  readonly ayuda?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="min-w-0 text-tinta-2">
        {rotulo}
        {ayuda !== undefined && (
          <span className="block text-[11px] text-tinta-3">{ayuda}</span>
        )}
      </dt>
      <dd className="cifra shrink-0 font-semibold">
        {valor < 0 ? `−${pesos(Math.abs(valor))}` : pesos(valor)}
      </dd>
    </div>
  );
}

/** Renglón de desglose: va debajo de su total, en pequeño. */
function Detalle({
  rotulo, valor, nota,
}: {
  readonly rotulo: string;
  readonly valor: number;
  readonly nota?: string | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5 pl-4 text-[13px]">
      <dt className="min-w-0 truncate text-tinta-3">{rotulo}</dt>
      <dd className="cifra shrink-0 text-tinta-3">
        {pesos(valor)}
        {nota !== undefined && <span className="ml-1.5 text-[11px]">{nota}</span>}
      </dd>
    </div>
  );
}

function Subtotal({
  rotulo, valor, nota,
}: {
  readonly rotulo: string;
  readonly valor: number;
  readonly nota?: string;
}) {
  return (
    <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-linea-2
                    pt-2">
      <dt className="font-bold">{rotulo}</dt>
      <dd className="cifra shrink-0 font-bold">
        {pesos(valor)}
        {nota !== undefined && (
          <span className="ml-2 text-[12px] font-normal text-tinta-3">{nota}</span>
        )}
      </dd>
    </div>
  );
}

function Tarjeta({
  titulo, children,
}: {
  readonly titulo: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-linea bg-panel p-4">
      <h3 className="mb-2 text-[13px] font-bold">{titulo}</h3>
      {children}
    </section>
  );
}

function Comparacion({
  rotulo, ahora, antes,
}: {
  readonly rotulo: string;
  readonly ahora: number;
  readonly antes: number;
}) {
  const cambio = variacion(ahora, antes);
  const mejora = ahora >= antes;
  const Icono = mejora ? TrendingUp : TrendingDown;

  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
      <span className="text-tinta-2">{rotulo}</span>
      <span className="flex shrink-0 items-baseline gap-2">
        <span className="cifra text-tinta-3">{pesos(antes)}</span>
        <span
          className={`inline-flex items-center gap-1 font-semibold ${
            mejora ? 'text-bien' : 'text-grave'}`}
        >
          <Icono size={12} aria-hidden />
          <span className="cifra">
            {cambio === null ? '—' : `${cambio > 0 ? '+' : ''}${cambio} %`}
          </span>
        </span>
      </span>
    </div>
  );
}

function Dato({ rotulo, valor }: { readonly rotulo: string; readonly valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
      <span className="text-tinta-2">{rotulo}</span>
      <span className="cifra font-semibold">{valor}</span>
    </div>
  );
}
