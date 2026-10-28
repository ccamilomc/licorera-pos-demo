/**
 * Las listas del negocio: categorias, marcas, envases y unidades.
 *
 * El sistema arranco con lo que traia el Excel, que era una foto de como
 * estaba el local un dia. Aqui el dueño manda: agrega lo que le falte,
 * corrige un nombre mal escrito y retira lo que ya no maneja.
 *
 * Nada se borra. Retirar una categoria que tiene productos dejaria esos
 * productos apuntando al vacio y los reportes viejos sin explicacion, asi
 * que se desactiva y deja de ofrecerse; lo que ya estaba sigue.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Plus, RotateCcw, X } from 'lucide-react';

import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';

interface ItemCatalogo {
  readonly id: number;
  readonly nombre: string;
  readonly activo: boolean;
  /** Cuántos productos lo usan. */
  readonly en_uso: number;
}

type Tipo = 'categorias' | 'marcas' | 'envases' | 'unidades';

const PESTANAS: readonly { tipo: Tipo; nombre: string; ayuda: string }[] = [
  { tipo: 'categorias', nombre: 'Categorías',
    ayuda: 'Cómo agrupas lo que vendes: cervezas, licores, mecato, cigarrillos.' },
  { tipo: 'marcas', nombre: 'Marcas',
    ayuda: 'Quién lo fabrica. Es opcional en cada producto.' },
  { tipo: 'envases', nombre: 'Envases',
    ayuda: 'Botella, lata, garrafa. El envase distingue el producto: una lata y una botella son cosas distintas.' },
  { tipo: 'unidades', nombre: 'Unidades',
    ayuda: 'En qué se cuenta la existencia. Casi todo se cuenta de a uno.' },
];

export function Listas() {
  const { usuario } = useSesion();
  const [tipo, setTipo] = useState<Tipo>('categorias');
  const [items, setItems] = useState<readonly ItemCatalogo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const [editando, setEditando] = useState<number | null>(null);
  const [texto, setTexto] = useState('');
  const [creando, setCreando] = useState(false);

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      setItems(await pedir<ItemCatalogo[]>('listar_catalogo', {
        tipo, incluirInactivos: true,
      }));
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setCargando(false);
    }
  }, [tipo]);

  useEffect(() => { void recargar(); }, [recargar]);

  async function guardar(id: number | null) {
    if (usuario === null || texto.trim() === '') return;
    try {
      await pedir('guardar_catalogo', {
        tipo, id, nombre: texto.trim(), usuarioId: usuario.id, rol: usuario.rol,
      });
      setEditando(null);
      setCreando(false);
      setTexto('');
      await recargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function cambiarActivo(item: ItemCatalogo) {
    if (usuario === null) return;
    try {
      await pedir('desactivar_catalogo', {
        tipo, id: item.id, activo: !item.activo,
        usuarioId: usuario.id, rol: usuario.rol,
      });
      await recargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  const actual = PESTANAS.find((p) => p.tipo === tipo)!;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h3 className="text-sm font-bold">Listas</h3>
        <p className="mt-0.5 text-[13px] text-tinta-2">
          Lo que aparece en los desplegables al crear un producto. Agrega lo que
          te falte: el sistema no sabe qué vendes tú.
        </p>
      </div>

      <div role="tablist" aria-label="Tipo de lista" className="flex flex-wrap gap-1.5">
        {PESTANAS.map((p) => (
          <button
            key={p.tipo}
            type="button"
            role="tab"
            aria-selected={p.tipo === tipo}
            onClick={() => { setTipo(p.tipo); setEditando(null); setCreando(false); }}
            className={`rounded px-3 py-1.5 text-[13px] font-semibold ${p.tipo === tipo
              ? 'bg-acento-suave text-acento'
              : 'text-tinta-2 hover:bg-panel-2'}`}
          >
            {p.nombre}
          </button>
        ))}
      </div>

      <p className="text-[12px] text-tinta-3">{actual.ayuda}</p>

      {error !== null && (
        <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3 py-2
                                   text-sm text-grave">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="text-sm text-tinta-3">Cargando…</p>
      ) : (
        <ul className="flex flex-col gap-1 rounded-lg border border-linea bg-panel p-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded px-2 py-1.5
                                         hover:bg-panel-2">
              {editando === item.id ? (
                <>
                  <input
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void guardar(item.id); }
                      if (e.key === 'Escape') { setEditando(null); setTexto(''); }
                    }}
                    aria-label={`Nuevo nombre de ${item.nombre}`}
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-acento bg-panel px-2
                               py-1 text-sm outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => { void guardar(item.id); }}
                    aria-label={`Guardar ${item.nombre}`}
                    className="rounded p-1 text-bien hover:bg-panel-2"
                  >
                    <Check size={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditando(null); setTexto(''); }}
                    aria-label={`Descartar el cambio de ${item.nombre}`}
                    className="rounded p-1 text-tinta-3 hover:bg-panel-2"
                  >
                    <X size={15} aria-hidden />
                  </button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-sm ${item.activo
                    ? 'font-semibold' : 'text-tinta-3 line-through'}`}>
                    {item.nombre}
                  </span>

                  <span className="text-[12px] text-tinta-3">
                    {item.en_uso === 0
                      ? 'sin usar'
                      : `${item.en_uso} ${item.en_uso === 1 ? 'producto' : 'productos'}`}
                  </span>

                  <button
                    type="button"
                    onClick={() => { setEditando(item.id); setTexto(item.nombre); }}
                    aria-label={`Cambiar el nombre de ${item.nombre}`}
                    className="rounded p-1 text-tinta-3 hover:text-acento"
                  >
                    <Pencil size={14} aria-hidden />
                  </button>

                  <button
                    type="button"
                    onClick={() => { void cambiarActivo(item); }}
                    aria-label={item.activo
                      ? `Retirar ${item.nombre} de la lista`
                      : `Volver a usar ${item.nombre}`}
                    className="rounded p-1 text-tinta-3 hover:text-acento"
                  >
                    {item.activo
                      ? <X size={14} aria-hidden />
                      : <RotateCcw size={14} aria-hidden />}
                  </button>
                </>
              )}
            </li>
          ))}

          {creando ? (
            <li className="flex items-center gap-2 px-2 py-1.5">
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void guardar(null); }
                  if (e.key === 'Escape') { setCreando(false); setTexto(''); }
                }}
                placeholder={`Nombre de ${actual.nombre.toLowerCase().replace(/s$/, '')}`}
                aria-label={`Agregar a ${actual.nombre}`}
                autoFocus
                className="min-w-0 flex-1 rounded border border-acento bg-panel px-2 py-1
                           text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => { void guardar(null); }}
                disabled={texto.trim() === ''}
                aria-label="Agregar"
                className="rounded p-1 text-bien hover:bg-panel-2 disabled:opacity-40"
              >
                <Check size={15} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => { setCreando(false); setTexto(''); }}
                aria-label="Descartar"
                className="rounded p-1 text-tinta-3 hover:bg-panel-2"
              >
                <X size={15} aria-hidden />
              </button>
            </li>
          ) : (
            <li>
              <button
                type="button"
                onClick={() => { setCreando(true); setTexto(''); }}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-[13px]
                           font-semibold text-tinta-3 hover:bg-panel-2 hover:text-acento"
              >
                <Plus size={14} aria-hidden />
                Agregar a {actual.nombre.toLowerCase()}
              </button>
            </li>
          )}
        </ul>
      )}

      <p className="text-[12px] text-tinta-3">
        Lo que retiras deja de ofrecerse al crear productos, pero los que ya lo
        usaban siguen igual. Nada se borra.
      </p>
    </div>
  );
}
