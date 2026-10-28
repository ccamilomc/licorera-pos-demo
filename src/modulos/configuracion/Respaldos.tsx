/**
 * Copias de seguridad.
 *
 * Un disco dañado sin respaldo es el negocio completo perdido, así que
 * esta pantalla insiste hasta que exista una copia reciente.
 *
 * Restaurar pide confirmación escrita: es la única acción del sistema que
 * reemplaza datos actuales por otros más viejos.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Check, HardDriveDownload, RotateCcw, ShieldCheck, X,
} from 'lucide-react';

import { fechaHora } from '@/compartido/utilidades/formato';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';

interface Respaldo {
  readonly archivo: string;
  readonly ruta: string;
  readonly tamano_bytes: number;
  readonly creado: string;
  readonly verificado: boolean;
}

interface EstadoRespaldos {
  readonly total: number;
  readonly ultimo: Respaldo | null;
  readonly dias_sin_respaldo: number | null;
  readonly necesita_respaldo: boolean;
  readonly carpeta: string;
}

/** Confirmación escrita para restaurar. Escribirla obliga a leerla. */
const PALABRA_CONFIRMACION = 'RESTAURAR';

function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Respaldos() {
  const { puede, usuario } = useSesion();
  const [estado, setEstado] = useState<EstadoRespaldos | null>(null);
  const [copias, setCopias] = useState<readonly Respaldo[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState<Respaldo | null>(null);
  const [confirmacion, setConfirmacion] = useState('');
  // Resultado de comprobar cada copia, por ruta.
  const [comprobadas, setComprobadas] = useState<Record<string, boolean>>({});

  const cargar = useCallback(async () => {
    try {
      const [resumen, lista] = await Promise.all([
        pedir<EstadoRespaldos>('estado_respaldos'),
        pedir<Respaldo[]>('listar_respaldos'),
      ]);
      setEstado(resumen);
      setCopias(lista);
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function crear() {
    setOcupado(true);
    setAviso(null);
    try {
      const copia = await pedir<Respaldo>('crear_respaldo', { rol: usuario?.rol });
      setAviso(`Copia creada y verificada: ${copia.archivo}`);
      setError(null);
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setOcupado(false);
    }
  }

  async function comprobar(copia: Respaldo) {
    try {
      const sirve = await pedir<boolean>('verificar_respaldo', { ruta: copia.ruta });
      setComprobadas((c) => ({ ...c, [copia.ruta]: sirve }));
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function restaurar() {
    if (restaurando === null || confirmacion !== PALABRA_CONFIRMACION) return;
    setOcupado(true);
    try {
      await pedir('restaurar_respaldo', {
        ruta: restaurando.ruta, rol: usuario?.rol,
      });
      setAviso(
        'Se restauró la copia. Lo que había antes quedó guardado por si acaso. '
        + 'Cierra y vuelve a abrir el programa para ver los datos restaurados.',
      );
      setError(null);
      setRestaurando(null);
      setConfirmacion('');
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {estado?.necesita_respaldo === true && (
        <div className="flex items-start gap-2.5 rounded-lg border border-alerta/40
                        bg-alerta-suave p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-alerta" aria-hidden />
          <div>
            <p className="text-sm font-bold">
              {estado.total === 0
                ? 'Nunca has hecho una copia de seguridad'
                : `Hace ${estado.dias_sin_respaldo ?? 0} días que no haces una copia`}
            </p>
            <p className="mt-0.5 text-[13px] text-tinta-2">
              Si el disco de este computador falla, se pierde todo: inventario, ventas e
              historial. Hacer una copia toma un segundo.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => { void crear(); }}
          disabled={ocupado}
          className="inline-flex items-center gap-2 rounded bg-acento px-4 py-2.5 text-sm
                     font-semibold text-sobre-acento hover:bg-acento-fuerte disabled:opacity-50"
        >
          <HardDriveDownload size={16} aria-hidden />
          {ocupado ? 'Trabajando…' : 'Hacer una copia ahora'}
        </button>

        {estado?.ultimo != null && (
          <span className="text-[13px] text-tinta-3">
            Última: {fechaHora(estado.ultimo.creado)}
          </span>
        )}
      </div>

      {error !== null && (
        <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3 py-2
                                   text-sm text-grave">
          {error}
        </p>
      )}
      {aviso !== null && (
        <p className="rounded border border-bien/30 bg-bien-suave px-3 py-2 text-sm text-tinta-2">
          {aviso}
        </p>
      )}

      {estado !== null && (
        <p className="text-[12px] text-tinta-3">
          Las copias se guardan en <code className="text-tinta-2">{estado.carpeta}</code>.
          Conviene copiar alguna a una USB de vez en cuando: una copia en el mismo disco
          no protege si el disco es el que falla.
        </p>
      )}

      {restaurando !== null && (
        <div className="rounded-lg border-2 border-grave bg-grave-suave p-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-grave">
            <RotateCcw size={16} aria-hidden />
            Restaurar {restaurando.archivo}
          </h3>
          <p className="mt-2 text-[13px] text-tinta-2">
            {/* Sin punto tras la fecha: «p. m.» ya trae el suyo y salían dos. */}
            Los datos actuales se reemplazan por los de esa copia, del{' '}
            <strong>{fechaHora(restaurando.creado)}</strong> Todo lo que se haya
            registrado después de esa fecha desaparece de la vista.
          </p>
          <p className="mt-1.5 text-[13px] text-tinta-2">
            Antes de restaurar se guarda automáticamente una copia de lo que hay ahora,
            así que esto se puede deshacer.
          </p>

          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-tinta-2">
              Escribe <strong>{PALABRA_CONFIRMACION}</strong> para confirmar
            </span>
            <input
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value.toUpperCase())}
              autoFocus
              className="w-48 rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                         outline-none focus:border-grave"
            />
          </label>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => { void restaurar(); }}
              disabled={ocupado || confirmacion !== PALABRA_CONFIRMACION}
              className="rounded bg-grave px-4 py-2 text-sm font-semibold text-sobre-grave
                         disabled:cursor-not-allowed disabled:opacity-50"
            >
              Restaurar esta copia
            </button>
            <button
              type="button"
              onClick={() => { setRestaurando(null); setConfirmacion(''); }}
              className="rounded border border-linea-2 bg-panel px-4 py-2 text-sm
                         font-semibold text-tinta-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-linea">
        {copias.length === 0 ? (
          <p className="p-6 text-center text-sm text-tinta-3">
            Todavía no hay ninguna copia.
          </p>
        ) : (
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-panel-2">
              <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
                <th className="px-3 py-2.5 font-semibold">Copia</th>
                <th className="px-3 py-2.5 font-semibold">Fecha</th>
                <th className="px-3 py-2.5 text-right font-semibold">Tamaño</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {copias.map((c) => (
                <tr key={c.ruta} className="border-t border-linea bg-panel">
                  <td className="px-3 py-2.5">
                    <span className="cifra text-[13px]">{c.archivo}</span>
                    {c.archivo.includes('antes-de') && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded
                                       bg-dato-suave px-1.5 py-0.5 text-[11px] font-semibold
                                       text-dato">
                        <ShieldCheck size={11} aria-hidden />
                        de seguridad
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-tinta-3">
                    {fechaHora(c.creado)}
                  </td>
                  <td className="cifra px-3 py-2.5 text-right text-[12px] text-tinta-3">
                    {tamano(c.tamano_bytes)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="flex items-center justify-end gap-3">
                      {comprobadas[c.ruta] === undefined ? (
                        <button
                          type="button"
                          onClick={() => { void comprobar(c); }}
                          className="text-[13px] font-semibold text-tinta-3 hover:text-acento"
                        >
                          Comprobar
                        </button>
                      ) : comprobadas[c.ruta] === true ? (
                        <span className="inline-flex items-center gap-1 text-[12px]
                                         font-semibold text-bien">
                          <Check size={13} aria-hidden />
                          sirve
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[12px]
                                         font-semibold text-grave">
                          <X size={13} aria-hidden />
                          dañada
                        </span>
                      )}

                      {puede('respaldo.restaurar') && (
                        <button
                          type="button"
                          onClick={() => { setRestaurando(c); setConfirmacion(''); }}
                          disabled={comprobadas[c.ruta] === false}
                          className="text-[13px] font-semibold text-tinta-3 hover:text-acento
                                     disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Restaurar
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
