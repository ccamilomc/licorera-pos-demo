/**
 * Vista previa de la importacion.
 *
 * Es la pantalla que hace segura toda la operacion: muestra exactamente
 * que va a pasar antes de que se escriba nada, y deja cancelar. Nada de
 * lo que se ve aqui esta guardado todavia.
 */

import { AlertTriangle, ArrowRight, Check, Info, Package, X } from 'lucide-react';

import { pesos } from '@/compartido/utilidades/formato';
import type { Incidencia, SeveridadIncidencia } from '../lector-inventario';
import type { PlanImportacion } from '../planificador';

interface Props {
  readonly plan: PlanImportacion;
  readonly aplicando: boolean;
  readonly onAplicar: () => void;
  readonly onCancelar: () => void;
}

const ESTILO_SEVERIDAD: Record<SeveridadIncidencia, { fondo: string; texto: string; etiqueta: string }> = {
  ERROR: { fondo: 'bg-grave-suave', texto: 'text-grave', etiqueta: 'No se importa' },
  AVISO: { fondo: 'bg-alerta-suave', texto: 'text-alerta', etiqueta: 'Revisar' },
  INFO: { fondo: 'bg-dato-suave', texto: 'text-dato', etiqueta: 'Aviso' },
};

function Cifra({ valor, rotulo, detalle, tono = 'normal' }: {
  valor: string; rotulo: string; detalle?: string;
  tono?: 'normal' | 'bien' | 'alerta' | 'grave';
}) {
  const color = {
    normal: 'text-tinta', bien: 'text-bien',
    alerta: 'text-alerta', grave: 'text-grave',
  }[tono];
  return (
    <div className="bg-panel p-4">
      <div className="text-[11px] uppercase tracking-wider text-tinta-3">{rotulo}</div>
      <div className={`cifra mt-1.5 text-2xl font-bold ${color}`}>{valor}</div>
      {detalle !== undefined && <div className="mt-1 text-xs text-tinta-3">{detalle}</div>}
    </div>
  );
}

function ListaIncidencias({ incidencias }: { readonly incidencias: readonly Incidencia[] }) {
  if (incidencias.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {incidencias.map((i, indice) => {
        const estilo = ESTILO_SEVERIDAD[i.severidad];
        return (
          <li key={`${i.hoja}-${i.fila}-${indice}`}
              className="rounded border border-linea bg-panel p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${estilo.fondo} ${estilo.texto}`}>
                {estilo.etiqueta}
              </span>
              <span className="text-xs text-tinta-3">
                {i.hoja}, fila {i.fila}
              </span>
            </div>
            <p className="mt-1.5 text-tinta-2">{i.mensaje}</p>
            <p className="mt-1 text-[13px] text-tinta-3">{i.accion}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function VistaPreviaImportacion({ plan, aplicando, onAplicar, onCancelar }: Props) {
  const { resumen } = plan;
  const hayErrores = resumen.errores > 0;
  const noHayNadaQueHacer = resumen.aCrear === 0 && resumen.aActualizar === 0;

  const errores = plan.incidencias.filter((i) => i.severidad === 'ERROR');
  const avisos = plan.incidencias.filter((i) => i.severidad === 'AVISO');

  return (
    <div className="flex h-full flex-col gap-5">
      <header>
        <h2 className="text-xl font-bold tracking-tight">Antes de importar</h2>
        <p className="mt-1 max-w-prose text-sm text-tinta-2">
          Esto es lo que va a pasar. Todavía no se ha guardado nada, y tu archivo de Excel
          no se modifica en ningún caso.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-linea bg-linea sm:grid-cols-4">
        <Cifra rotulo="Se crean" valor={`${resumen.aCrear}`} detalle="productos nuevos" tono="bien" />
        <Cifra rotulo="Se actualizan" valor={`${resumen.aActualizar}`} detalle="ya existían" />
        <Cifra rotulo="Sin cambios" valor={`${resumen.sinCambios}`} detalle="quedan igual" />
        <Cifra
          rotulo="Necesitan revisión"
          valor={`${resumen.avisos}`}
          detalle="se importan igual"
          tono={resumen.avisos > 0 ? 'alerta' : 'normal'}
        />
      </div>

      {resumen.unidadesQueEntran !== 0 && (
        <p className="text-sm text-tinta-2">
          Entran <strong className="cifra">{resumen.unidadesQueEntran}</strong> unidades
          al inventario, por un valor de{' '}
          <strong className="cifra">{pesos(resumen.valorQueEntra)}</strong>.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {hayErrores && (
          <section className="mb-5">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
              <AlertTriangle size={16} className="text-grave" aria-hidden />
              {errores.length} {errores.length === 1 ? 'fila no se puede importar' : 'filas no se pueden importar'}
            </h3>
            <ListaIncidencias incidencias={errores} />
          </section>
        )}

        {plan.actualizar.length > 0 && (
          <section className="mb-5">
            <h3 className="mb-2 text-sm font-bold">Qué cambia en los que ya existían</h3>
            <div className="overflow-x-auto rounded border border-linea">
              <table className="w-full min-w-[540px] text-sm">
                <thead>
                  <tr className="bg-panel-2 text-left text-[11px] uppercase tracking-wider text-tinta-3">
                    <th className="px-3 py-2 font-semibold">Producto</th>
                    <th className="px-3 py-2 font-semibold">Campo</th>
                    <th className="px-3 py-2 font-semibold">Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.actualizar.flatMap((a) =>
                    a.cambios.map((c, i) => (
                      <tr key={`${a.id}-${c.campo}`} className="border-t border-linea bg-panel">
                        <td className="px-3 py-2 font-medium">
                          {i === 0 ? `${a.producto.nombre} ${a.producto.presentacion}` : ''}
                        </td>
                        <td className="px-3 py-2 capitalize text-tinta-2">{c.campo}</td>
                        <td className="px-3 py-2 text-tinta-2">
                          <span className="cifra">{c.antes}</span>
                          <ArrowRight size={13} className="mx-2 inline text-tinta-3" aria-label="cambia a" />
                          <span className="cifra font-medium text-tinta">{c.despues}</span>
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {plan.ausentes.length > 0 && (
          <section className="mb-5">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
              <Info size={16} className="text-dato" aria-hidden />
              {plan.ausentes.length} productos están en el sistema pero no en este Excel
            </h3>
            <p className="mb-2 text-sm text-tinta-2">
              No se borran ni se tocan. Si ya no los vendes, desactívalos desde Inventario.
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {plan.ausentes.map((a) => (
                <li key={a.id} className="rounded border border-linea bg-panel px-2 py-1 text-xs text-tinta-2">
                  {a.nombre} {a.presentacion}
                </li>
              ))}
            </ul>
          </section>
        )}

        {avisos.length > 0 && (
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
              <AlertTriangle size={16} className="text-alerta" aria-hidden />
              {avisos.length} cosas que conviene mirar
            </h3>
            <p className="mb-2 text-sm text-tinta-2">
              Estos productos se importan igual y quedan marcados dentro del sistema para
              que los revises cuando quieras.
            </p>
            <ListaIncidencias incidencias={avisos} />
          </section>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-linea pt-4">
        <button
          type="button"
          onClick={onAplicar}
          disabled={aplicando || noHayNadaQueHacer}
          className="inline-flex items-center gap-2 rounded bg-acento px-4 py-2.5 text-sm font-semibold text-sobre-acento
                     hover:bg-acento-fuerte disabled:cursor-not-allowed disabled:opacity-50"
        >
          {aplicando ? <Package size={16} className="animate-pulse" aria-hidden /> : <Check size={16} aria-hidden />}
          {aplicando ? 'Importando…' : `Importar ${resumen.aCrear + resumen.aActualizar} productos`}
        </button>

        <button
          type="button"
          onClick={onCancelar}
          disabled={aplicando}
          className="inline-flex items-center gap-2 rounded border border-linea-2 px-4 py-2.5 text-sm font-semibold
                     text-tinta-2 hover:bg-panel-2 disabled:opacity-50"
        >
          <X size={16} aria-hidden />
          Cancelar
        </button>

        <p className="text-xs text-tinta-3">
          {noHayNadaQueHacer
            ? 'No hay nada que importar: el sistema ya está al día con este archivo.'
            : 'Se hace una copia de seguridad antes de aplicar los cambios.'}
        </p>
      </footer>
    </div>
  );
}
