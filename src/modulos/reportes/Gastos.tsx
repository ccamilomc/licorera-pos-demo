/**
 * Los gastos del negocio.
 *
 * Un gasto es un hecho con fecha: qué se pagó, cuándo y cuánto. Antes
 * eran cinco cifras fijas en la configuración —arriendo, energía,
 * internet, aseo, bolsas— que el estado de resultados repartía por días.
 * Con eso no había dónde anotar un sueldo ni una reparación, y subir el
 * arriendo reescribía también los meses anteriores.
 *
 * Aquí se anota, se corrige y se anula. Nada se borra: un gasto anulado
 * sigue en la lista con su motivo, porque alguien lo vio en un reporte y
 * va a preguntar por él.
 */

import { useCallback, useEffect, useState } from 'react';
import { Ban, Pencil, Plus, Tags, Wallet, X } from 'lucide-react';

import { Periodo, hoyLocal, inicioDeMes } from '@/compartido/componentes/Periodo';
import { fechaCorta, pesos } from '@/compartido/utilidades/formato';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';

interface Gasto {
  readonly id: number;
  readonly fecha: string;
  readonly categoria_id: number | null;
  readonly categoria: string | null;
  readonly concepto: string;
  readonly monto: number;
  readonly nota: string | null;
  readonly usuario: string | null;
  readonly anulado: boolean;
  readonly motivo_anulacion: string | null;
}

interface Categoria {
  readonly id: number;
  readonly nombre: string;
  readonly fijo: boolean;
  readonly activo: boolean;
  readonly en_uso: number;
}

/** Lo que se está escribiendo en el formulario. */
interface Borrador {
  readonly id: number | null;
  readonly fecha: string;
  readonly categoriaId: string;
  readonly concepto: string;
  readonly monto: string;
  readonly nota: string;
}

const VACIO: Borrador = {
  id: null, fecha: hoyLocal(), categoriaId: '', concepto: '', monto: '', nota: '',
};

const NUEVA_CATEGORIA = '__nueva__';

export function Gastos() {
  const { usuario, puede } = useSesion();
  const [desde, setDesde] = useState(inicioDeMes());
  const [hasta, setHasta] = useState(hoyLocal());
  const [gastos, setGastos] = useState<readonly Gasto[]>([]);
  const [categorias, setCategorias] = useState<readonly Categoria[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [anulando, setAnulando] = useState<Gasto | null>(null);
  const [motivo, setMotivo] = useState('');
  const [nuevaCategoria, setNuevaCategoria] = useState('');
  const [verCategorias, setVerCategorias] = useState(false);

  const cargar = useCallback(async () => {
    if (usuario === null) return;
    setCargando(true);
    try {
      const [lista, cats] = await Promise.all([
        pedir<Gasto[]>('listar_gastos', { desde, hasta, rol: usuario.rol }),
        pedir<Categoria[]>('categorias_de_gasto', { rol: usuario.rol }),
      ]);
      setGastos(lista);
      setCategorias(cats);
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setCargando(false);
    }
  }, [usuario, desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar() {
    if (borrador === null || usuario === null) return;
    const monto = Number(borrador.monto);
    if (borrador.concepto.trim() === '' || !Number.isFinite(monto) || monto <= 0) return;

    setGuardando(true);
    try {
      const gasto = {
        id: borrador.id,
        fecha: borrador.fecha,
        categoria_id: borrador.categoriaId === '' ? null : Number(borrador.categoriaId),
        concepto: borrador.concepto.trim(),
        monto,
        nota: borrador.nota.trim() === '' ? null : borrador.nota.trim(),
      };
      await pedir(borrador.id === null ? 'registrar_gasto' : 'editar_gasto', {
        gasto, usuarioId: usuario.id, rol: usuario.rol,
      });
      setBorrador(null);
      setError(null);
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setGuardando(false);
    }
  }

  async function anular() {
    if (anulando === null || usuario === null || motivo.trim() === '') return;
    setGuardando(true);
    try {
      await pedir('anular_gasto', {
        gastoId: anulando.id, motivo: motivo.trim(),
        usuarioId: usuario.id, rol: usuario.rol,
      });
      setAnulando(null);
      setMotivo('');
      setError(null);
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setGuardando(false);
    }
  }

  async function crearCategoria() {
    if (usuario === null || nuevaCategoria.trim() === '') return;
    try {
      const id = await pedir<number>('crear_categoria_gasto', {
        nombre: nuevaCategoria.trim(), fijo: false, rol: usuario.rol,
      });
      setNuevaCategoria('');
      await cargar();
      setBorrador((b) => (b === null ? b : { ...b, categoriaId: String(id) }));
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function quitarCategoria(c: Categoria) {
    if (usuario === null) return;
    try {
      await pedir('quitar_categoria_gasto', { categoriaId: c.id, rol: usuario.rol });
      setError(null);
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  const vigentes = gastos.filter((g) => !g.anulado);
  const total = vigentes.reduce((s, g) => s + g.monto, 0);
  const puedeEditar = puede('reporte.financiero');

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Gastos</h2>
          <p className="mt-0.5 text-[13px] text-tinta-3">
            Lo que salió del negocio y no fue mercancía. Cada pago con su fecha:
            el arriendo de julio se queda en julio aunque en agosto suba.
          </p>
        </div>
        {puedeEditar && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setVerCategorias((v) => !v)}
              aria-expanded={verCategorias}
              className="inline-flex items-center gap-2 rounded border border-linea-2 px-3 py-2.5
                         text-sm font-semibold text-tinta-2 hover:border-acento
                         hover:text-acento"
            >
              <Tags size={16} aria-hidden />
              Categorías
            </button>
            <button
              type="button"
              onClick={() => { setBorrador({ ...VACIO, fecha: hoyLocal() }); }}
              className="inline-flex items-center gap-2 rounded bg-acento px-4 py-2.5 text-sm
                         font-bold text-sobre-acento hover:bg-acento-fuerte"
            >
              <Plus size={16} aria-hidden />
              Anotar un gasto
            </button>
          </div>
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

      {verCategorias && (
        <div className="rounded-lg border border-linea bg-panel p-4">
          <h3 className="text-sm font-bold">Categorías de gasto</h3>
          <p className="mt-1 text-[13px] text-tinta-2">
            Sirven para agrupar en el estado de resultados. La que ya tiene gastos
            detrás no se borra: se desactiva, para que un reporte viejo siga
            diciendo lo que decía.
          </p>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {categorias.map((c) => (
              <li
                key={c.id}
                className={`inline-flex items-center gap-1.5 rounded border px-2 py-1
                            text-[12px] ${c.activo
                              ? 'border-linea-2 text-tinta-2'
                              : 'border-dashed border-linea-2 text-tinta-3'}`}
              >
                {c.nombre}
                {!c.activo && <span className="text-tinta-3">(desactivada)</span>}
                {c.en_uso > 0 && (
                  <span className="cifra text-tinta-3">{c.en_uso}</span>
                )}
                {c.activo && (
                  <button
                    type="button"
                    onClick={() => { void quitarCategoria(c); }}
                    aria-label={`Quitar ${c.nombre}`}
                    className="rounded text-tinta-3 hover:text-grave"
                  >
                    <X size={13} aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-tinta-2">
                Agregar una categoría
              </span>
              <input
                value={nuevaCategoria.trim() === '' ? '' : nuevaCategoria}
                onChange={(e) => setNuevaCategoria(e.target.value)}
                placeholder="Domicilios"
                aria-label="Nombre de la categoría"
                className="w-56 rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                           outline-none focus:border-acento"
              />
            </label>
            <button
              type="button"
              onClick={() => { void crearCategoria(); }}
              disabled={nuevaCategoria.trim() === ''}
              className="rounded border border-linea-2 px-3 py-2 text-sm font-semibold
                         text-tinta-2 hover:border-acento hover:text-acento
                         disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
        </div>
      )}

      {borrador !== null && (
        <div className="rounded-lg border-2 border-acento bg-panel p-5">
          <h3 className="text-sm font-bold">
            {borrador.id === null ? 'Anotar un gasto' : 'Corregir el gasto'}
          </h3>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-tinta-2">Cuándo</span>
              <input
                type="date"
                value={borrador.fecha}
                onChange={(e) => setBorrador((b) => (b && { ...b, fecha: e.target.value }))}
                aria-label="Fecha del gasto"
                className="cifra rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                           outline-none focus:border-acento"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-tinta-2">En qué</span>
              <input
                value={borrador.concepto}
                onChange={(e) => setBorrador((b) => (b && { ...b, concepto: e.target.value }))}
                placeholder="Sueldo de Andrés, arriendo de agosto…"
                aria-label="En qué se gastó"
                autoFocus
                className="w-72 rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                           outline-none placeholder:text-[13px] focus:border-acento"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-tinta-2">Cuánto</span>
              <input
                inputMode="numeric"
                value={borrador.monto}
                onChange={(e) => setBorrador((b) => (
                  b && { ...b, monto: e.target.value.replace(/\D/g, '') }))}
                placeholder="0"
                aria-label="Cuánto se gastó"
                className="cifra w-32 rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                           text-right outline-none focus:border-acento"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-tinta-2">Categoría</span>
              <select
                value={borrador.categoriaId}
                onChange={(e) => {
                  if (e.target.value === NUEVA_CATEGORIA) {
                    setNuevaCategoria(' ');
                    return;
                  }
                  setBorrador((b) => (b && { ...b, categoriaId: e.target.value }));
                }}
                aria-label="Categoría del gasto"
                className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                           outline-none focus:border-acento"
              >
                <option value="">Sin categoría</option>
                {categorias.filter((c) => c.activo).map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.nombre}</option>
                ))}
                <option value={NUEVA_CATEGORIA}>＋ Nueva categoría…</option>
              </select>
            </label>
          </div>

          {nuevaCategoria !== '' && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-tinta-2">
                  Cómo se llama la categoría
                </span>
                <input
                  value={nuevaCategoria.trim() === '' ? '' : nuevaCategoria}
                  onChange={(e) => setNuevaCategoria(e.target.value)}
                  placeholder="Domicilios"
                  aria-label="Nombre de la categoría nueva"
                  autoFocus
                  className="w-56 rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                             outline-none focus:border-acento"
                />
              </label>
              <button
                type="button"
                onClick={() => { void crearCategoria(); }}
                disabled={nuevaCategoria.trim() === ''}
                className="rounded border border-linea-2 px-3 py-2 text-sm font-semibold
                           text-tinta-2 hover:border-acento hover:text-acento
                           disabled:opacity-50"
              >
                Agregar
              </button>
              <button
                type="button"
                onClick={() => setNuevaCategoria('')}
                className="rounded p-2 text-tinta-3 hover:text-grave"
                aria-label="Cancelar la categoría nueva"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
          )}

          <label className="mt-3 flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-tinta-2">
              Nota <span className="font-normal text-tinta-3">(opcional)</span>
            </span>
            <input
              value={borrador.nota}
              onChange={(e) => setBorrador((b) => (b && { ...b, nota: e.target.value }))}
              placeholder="número de factura, a quién se le pagó…"
              aria-label="Nota del gasto"
              className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                         placeholder:text-[13px] focus:border-acento"
            />
          </label>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => { void guardar(); }}
              disabled={
                guardando
                || borrador.concepto.trim() === ''
                || Number(borrador.monto) <= 0
              }
              className="rounded bg-acento px-4 py-2 text-sm font-bold text-sobre-acento
                         hover:bg-acento-fuerte disabled:cursor-not-allowed
                         disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={() => { setBorrador(null); setNuevaCategoria(''); }}
              className="rounded border border-linea-2 px-4 py-2 text-sm font-semibold
                         text-tinta-2 hover:bg-panel-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {anulando !== null && (
        <div className="rounded-lg border-2 border-grave bg-grave-suave p-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-grave">
            <Ban size={16} aria-hidden />
            Anular {anulando.concepto} de {pesos(anulando.monto)}
          </h3>
          <p className="mt-2 text-[13px] text-tinta-2">
            Deja de contar en el estado de resultados. No se borra: queda en la
            lista con este motivo, porque puede que ya haya salido en un reporte.
          </p>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-tinta-2">¿Por qué se anula?</span>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="lo anoté dos veces, no era de este mes…"
              aria-label="Motivo de la anulación"
              autoFocus
              className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                         placeholder:text-[13px] focus:border-grave"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => { void anular(); }}
              disabled={guardando || motivo.trim() === ''}
              className="rounded bg-grave px-4 py-2 text-sm font-semibold text-sobre-grave
                         disabled:cursor-not-allowed disabled:opacity-50"
            >
              {guardando ? 'Anulando…' : 'Anular el gasto'}
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

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-linea">
        {cargando ? (
          <p className="p-6 text-sm text-tinta-3">Consultando…</p>
        ) : gastos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Wallet size={22} className="text-tinta-3" aria-hidden />
            <p className="text-sm text-tinta-2">No hay gastos anotados en este período.</p>
          </div>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-panel-2">
              <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
                <th className="px-3 py-2.5 font-semibold">Cuándo</th>
                <th className="px-3 py-2.5 font-semibold">En qué</th>
                <th className="px-3 py-2.5 font-semibold">Categoría</th>
                <th className="px-3 py-2.5 text-right font-semibold">Cuánto</th>
                <th className="px-3 py-2.5 font-semibold">Quién lo anotó</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {gastos.map((g) => (
                <tr key={g.id} className="border-t border-linea bg-panel">
                  <td className="cifra px-3 py-2.5 text-[13px] text-tinta-3">
                    {fechaCorta(g.fecha)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={g.anulado ? 'text-tinta-3 line-through' : ''}>
                      {g.concepto}
                    </span>
                    {g.anulado && (
                      <span className="ml-2 rounded bg-grave-suave px-1.5 py-0.5 text-[11px]
                                       font-semibold text-grave">
                        anulado
                      </span>
                    )}
                    {g.nota !== null && (
                      <div className="text-[12px] text-tinta-3">{g.nota}</div>
                    )}
                    {g.anulado && g.motivo_anulacion !== null && (
                      <div className="text-[12px] text-grave">{g.motivo_anulacion}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-tinta-2">
                    {g.categoria ?? <span className="text-tinta-3">sin categoría</span>}
                  </td>
                  <td className={`cifra px-3 py-2.5 text-right font-semibold ${
                    g.anulado ? 'text-tinta-3 line-through' : ''}`}
                  >
                    {pesos(g.monto)}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-tinta-3">{g.usuario ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right">
                    {!g.anulado && puedeEditar && (
                      <span className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setBorrador({
                            id: g.id,
                            fecha: g.fecha,
                            categoriaId: g.categoria_id === null ? '' : String(g.categoria_id),
                            concepto: g.concepto,
                            monto: String(g.monto),
                            nota: g.nota ?? '',
                          })}
                          aria-label={`Corregir ${g.concepto}`}
                          className="rounded p-1 text-tinta-3 hover:text-acento"
                        >
                          <Pencil size={15} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAnulando(g); setMotivo(''); }}
                          aria-label={`Anular ${g.concepto}`}
                          className="rounded p-1 text-tinta-3 hover:text-grave"
                        >
                          <Ban size={15} aria-hidden />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {vigentes.length > 0 && (
        <p className="text-[13px] text-tinta-2">
          <span className="cifra font-bold">{pesos(total)}</span> en{' '}
          <span className="cifra">{vigentes.length}</span>{' '}
          {vigentes.length === 1 ? 'gasto' : 'gastos'}
          {gastos.length !== vigentes.length && (
            <span className="text-tinta-3">
              {' '}· {gastos.length - vigentes.length} anulado
              {gastos.length - vigentes.length === 1 ? '' : 's'}, que no cuentan
            </span>
          )}
        </p>
      )}
    </div>
  );
}
