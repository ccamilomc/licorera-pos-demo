/**
 * Tablero del negocio.
 *
 * Responde una sola pregunta: ¿cómo va el negocio en este momento? Todo
 * lo que no responda eso vive en Reportes.
 *
 * La franja de alertas desaparece cuando no hay nada que atender. El
 * espacio vacío ya dice que todo está bien, y así lo que aparece ahí
 * siempre significa algo.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, PackageX } from 'lucide-react';

import { fechaCorta, pesos } from '@/compartido/utilidades/formato';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';

interface ResumenDia {
  readonly total: number;
  readonly cantidad: number;
  readonly ticket_promedio: number;
  readonly total_semana_pasada: number;
  readonly unidades: number;
}

interface VentaPorDia {
  readonly fecha: string;
  readonly total: number;
  readonly cantidad: number;
}

interface ProductoVendido {
  readonly nombre: string;
  readonly presentacion: string;
  readonly unidades: number;
  readonly total: number;
}

interface VentaReciente {
  readonly id: number;
  readonly numero: number;
  readonly total: number;
  readonly hora: string;
  readonly usuario: string;
  readonly anulada: boolean;
  readonly articulos: number;
}

interface AlertaInventario {
  readonly id: number;
  readonly nombre: string;
  readonly presentacion: string;
  readonly existencia: number;
  readonly stock_minimo: number;
  readonly agotado: boolean;
}

interface Credito {
  readonly fiado_hoy: number;
  readonly por_cobrar: number;
  readonly por_cobrar_viejo: number;
  readonly deudores: number;
  readonly por_pagar: number;
  readonly por_pagar_vencido: number;
  readonly compras_vencidas: number;
}

interface DatosTablero {
  readonly hoy: ResumenDia;
  readonly ultimos_dias: readonly VentaPorDia[];
  readonly mas_vendidos: readonly ProductoVendido[];
  readonly ventas_recientes: readonly VentaReciente[];
  readonly alertas: readonly AlertaInventario[];
  readonly agotados: number;
  readonly bajo_minimo: number;
  readonly utilidad_estimada: number | null;
  readonly credito: Credito;
}

export function Tablero() {
  const { usuario } = useSesion();
  const [datos, setDatos] = useState<DatosTablero | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (usuario === null) return;
    try {
      setDatos(await pedir<DatosTablero>('tablero', { rol: usuario.rol }));
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }, [usuario]);

  useEffect(() => { void cargar(); }, [cargar]);

  if (error !== null) {
    return (
      <p role="alert" className="rounded-lg border border-grave/30 bg-grave-suave px-4 py-3
                                 text-sm text-grave">
        {error}
      </p>
    );
  }

  if (datos === null) {
    return <p className="p-6 text-sm text-tinta-3">Cargando el resumen…</p>;
  }

  const { hoy } = datos;
  const hayAlertas = datos.alertas.length > 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <header>
        <h2 className="text-xl font-bold tracking-tight">Hoy</h2>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta rotulo="Ventas de hoy" valor={pesos(hoy.total)}>
          <Comparacion actual={hoy.total} anterior={hoy.total_semana_pasada} />
          {/* Sin esto, «se vendió $340.000» se lee como plata que está en
              el cajón, y una parte se fue fiada. */}
          {datos.credito.fiado_hoy > 0 && (
            <span className="mt-1 block text-[12px] font-semibold text-alerta">
              {pesos(datos.credito.fiado_hoy)} se fiaron
            </span>
          )}
        </Tarjeta>
        <Tarjeta rotulo="Número de ventas" valor={`${hoy.cantidad}`}>
          <span className="text-[12px] text-tinta-3">
            {hoy.unidades} {hoy.unidades === 1 ? 'unidad vendida' : 'unidades vendidas'}
          </span>
        </Tarjeta>
        <Tarjeta rotulo="Ticket promedio" valor={pesos(hoy.ticket_promedio)}>
          <span className="text-[12px] text-tinta-3">por venta</span>
        </Tarjeta>
        {datos.utilidad_estimada !== null && (
          <Tarjeta rotulo="Utilidad del mes" valor={pesos(datos.utilidad_estimada)}>
            <span className="text-[12px] text-tinta-3">
              solo de productos con costo registrado
            </span>
          </Tarjeta>
        )}
      </div>

      {(datos.credito.por_cobrar > 0 || datos.credito.por_pagar > 0) && (
        <section aria-label="Créditos" className="grid gap-3 sm:grid-cols-2">
          {datos.credito.por_cobrar > 0 && (
            <div className="rounded-lg border border-linea bg-panel p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider
                              text-tinta-3">
                Te deben
              </div>
              <div className="cifra mt-1.5 text-2xl font-extrabold tracking-tight">
                {pesos(datos.credito.por_cobrar)}
              </div>
              <div className="mt-1 text-[12px] text-tinta-3">
                {datos.credito.deudores}{' '}
                {datos.credito.deudores === 1 ? 'persona' : 'personas'}
                {datos.credito.por_cobrar_viejo > 0 && (
                  <span className="font-semibold text-alerta">
                    {' · '}{pesos(datos.credito.por_cobrar_viejo)} de hace más de un mes
                  </span>
                )}
              </div>
            </div>
          )}
          {datos.credito.por_pagar > 0 && (
            <div className="rounded-lg border border-linea bg-panel p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider
                              text-tinta-3">
                Debes a proveedores
              </div>
              <div className="cifra mt-1.5 text-2xl font-extrabold tracking-tight">
                {pesos(datos.credito.por_pagar)}
              </div>
              <div className="mt-1 text-[12px] text-tinta-3">
                {datos.credito.compras_vencidas > 0 ? (
                  <span className="font-semibold text-grave">
                    {datos.credito.compras_vencidas}{' '}
                    {datos.credito.compras_vencidas === 1 ? 'compra vencida' : 'compras vencidas'}
                    {' '}por {pesos(datos.credito.por_pagar_vencido)}
                  </span>
                ) : 'nada vencido todavía'}
              </div>
            </div>
          )}
        </section>
      )}

      {hayAlertas && (
        <section className="rounded-lg border border-alerta/40 bg-alerta-suave p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-tinta">
            <AlertTriangle size={16} className="text-alerta" aria-hidden />
            {datos.agotados > 0 && `${datos.agotados} agotados`}
            {datos.agotados > 0 && datos.bajo_minimo > 0 && ' · '}
            {datos.bajo_minimo > 0 && `${datos.bajo_minimo} bajo el mínimo`}
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {datos.alertas.map((a) => (
              <li
                key={a.id}
                className={`rounded border px-2 py-1 text-[12px] ${
                  a.agotado
                    ? 'border-grave/40 bg-grave-suave text-grave'
                    : 'border-linea-2 bg-panel text-tinta-2'}`}
              >
                {a.nombre} {a.presentacion}
                <span className="cifra ml-1.5 font-semibold">
                  {a.agotado ? 'agotado' : a.existencia}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel titulo="Ventas de los últimos 14 días">
          <GraficaDias dias={datos.ultimos_dias} />
        </Panel>

        <Panel titulo="Más vendidos este mes">
          {datos.mas_vendidos.length === 0 ? (
            <Vacio mensaje="Todavía no hay ventas este mes." />
          ) : (
            <ol className="flex flex-col gap-1.5">
              {datos.mas_vendidos.map((p, i) => (
                <li key={`${p.nombre}-${i}`} className="flex items-baseline gap-3">
                  <span className="cifra w-5 shrink-0 text-right text-[12px] text-tinta-3">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {p.nombre}
                    <span className="ml-1.5 text-[12px] text-tinta-3">{p.presentacion}</span>
                  </span>
                  <span className="cifra shrink-0 text-[12px] text-tinta-3">
                    {p.unidades} u
                  </span>
                  <span className="cifra shrink-0 text-sm font-semibold">
                    {pesos(p.total)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <Panel titulo="Últimas ventas">
        {datos.ventas_recientes.length === 0 ? (
          <Vacio mensaje="Aún no se ha registrado ninguna venta." />
        ) : (
          <ul className="flex flex-col divide-y divide-linea">
            {datos.ventas_recientes.map((v) => (
              <li key={v.id} className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0">
                <span className="cifra w-12 shrink-0 text-[12px] text-tinta-3">{v.hora}</span>
                <span className="cifra w-12 shrink-0 text-[13px] font-semibold">
                  #{v.numero}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-tinta-2">
                  {v.usuario}
                  {v.anulada && (
                    <span className="ml-2 rounded bg-grave-suave px-1.5 py-0.5 text-[11px]
                                     font-semibold text-grave">
                      anulada
                    </span>
                  )}
                </span>
                <span className={`cifra shrink-0 text-sm font-semibold ${
                  v.anulada ? 'text-tinta-3 line-through' : ''}`}
                >
                  {pesos(v.total)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Tarjeta({
  rotulo, valor, children,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-linea bg-panel p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-tinta-3">
        {rotulo}
      </div>
      <div className="cifra mt-1.5 text-2xl font-extrabold tracking-tight">{valor}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Compara contra el mismo día de la semana pasada, no contra ayer: un
 * martes se parece a un martes, no al domingo anterior.
 */
function Comparacion({ actual, anterior }: { readonly actual: number; readonly anterior: number }) {
  if (anterior === 0) {
    return <span className="text-[12px] text-tinta-3">sin dato de la semana pasada</span>;
  }
  const cambio = Math.round(((actual - anterior) / anterior) * 100);
  const Icono = cambio > 0 ? ArrowUpRight : cambio < 0 ? ArrowDownRight : Minus;
  const color = cambio > 0 ? 'text-bien' : cambio < 0 ? 'text-grave' : 'text-tinta-3';

  return (
    <span className={`flex items-center gap-1 text-[12px] font-semibold ${color}`}>
      <Icono size={13} aria-hidden />
      <span className="cifra">{Math.abs(cambio)}%</span>
      <span className="font-normal text-tinta-3">vs. mismo día la semana pasada</span>
    </span>
  );
}

function GraficaDias({ dias }: { readonly dias: readonly VentaPorDia[] }) {
  if (dias.length === 0) return <Vacio mensaje="Todavía no hay ventas que mostrar." />;

  const maximo = Math.max(...dias.map((d) => d.total), 1);

  return (
    // `items-stretch` y no `items-end`: con items-end cada columna se
    // encoge a su contenido, el `flex-1` de adentro se queda sin altura
    // que repartir y todas las barras salen del mismo tamaño -- es decir,
    // ninguna. La barra se alinea abajo en el div de adentro, no aquí.
    <div className="flex h-40 items-stretch gap-1.5" role="img"
         aria-label={`Ventas de los últimos ${dias.length} días`}>
      {dias.map((d) => {
        const altura = Math.max(2, Math.round((d.total / maximo) * 100));
        const dia = d.fecha.slice(8);
        return (
          <div key={d.fecha} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="relative flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-acento"
                style={{ height: `${altura}%` }}
                title={`${fechaCorta(d.fecha)}: ${pesos(d.total)} en ${d.cantidad} ventas`}
              />
            </div>
            <span className="cifra text-[10px] text-tinta-3">{dia}</span>
          </div>
        );
      })}
    </div>
  );
}

function Panel({
  titulo, children,
}: {
  readonly titulo: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-linea bg-panel p-4">
      <h3 className="mb-3 text-sm font-bold">{titulo}</h3>
      {children}
    </section>
  );
}

function Vacio({ mensaje }: { readonly mensaje: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-8 text-center">
      <PackageX size={20} className="text-tinta-3" aria-hidden />
      <p className="text-sm text-tinta-3">{mensaje}</p>
    </div>
  );
}
