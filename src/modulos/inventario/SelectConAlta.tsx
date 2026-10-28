/**
 * Una lista desplegable a la que se le pueden agregar opciones.
 *
 * El sistema arranco con las listas que traia el Excel del negocio, y esa
 * era una foto de como estaba el local un dia, no el catalogo definitivo.
 * Quien vende algo que ese archivo no tenia —un vino, un cigarrillo, una
 * garrafa— tiene que poder agregarlo sin llamar a nadie.
 *
 * La opcion de agregar va al final y no arriba: lo normal es elegir de la
 * lista, y una opcion de crear en primer lugar invita a crear duplicados
 * de lo que ya existe.
 */

import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';

interface Props {
  readonly etiqueta: string;
  readonly valor: string | null;
  readonly opciones: readonly string[];
  readonly onChange: (valor: string | null) => void;
  /** Texto de la opcion vacia. Si no se pasa, el campo es obligatorio. */
  readonly vacio?: string;
  readonly ayuda?: string;
  readonly textoAgregar?: string;
  readonly autoFocus?: boolean;
  /**
   * Como mostrar cada opcion. El valor que se guarda no cambia: los
   * envases viven en mayuscula en la base, pero «BOTELLA» en pantalla
   * grita y «Botella» se lee.
   */
  readonly etiquetaDe?: (valor: string) => string;
}

/** Valor centinela de la opcion de crear. Sin espacios al borde: un
 *  valor asi no sobrevive intacto al DOM. */
const AGREGAR = '__agregar__';

export function SelectConAlta({
  etiqueta, valor, opciones, onChange, vacio, ayuda, textoAgregar, autoFocus,
  etiquetaDe,
}: Props) {
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState('');

  function confirmar() {
    const limpio = nuevo.trim();
    if (limpio === '') return;
    onChange(limpio);
    setNuevo('');
    setCreando(false);
  }

  function cancelar() {
    setNuevo('');
    setCreando(false);
  }

  // Lo que se acaba de escribir todavía no está en la lista que vino de
  // la base, así que se suma para poder mostrarlo elegido.
  const lista = valor !== null && valor !== '' && !opciones.includes(valor)
    ? [...opciones, valor]
    : opciones;

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-tinta-2">{etiqueta}</span>

      {creando ? (
        <div className="flex gap-1.5">
          <input
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
              if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
            }}
            placeholder={`Nombre de ${etiqueta.toLowerCase()}`}
            aria-label={`${etiqueta}: nombre nuevo`}
            autoFocus
            className="min-w-0 flex-1 rounded border border-acento bg-panel px-3 py-2
                       text-sm outline-none"
          />
          <button
            type="button"
            onClick={confirmar}
            disabled={nuevo.trim() === ''}
            aria-label="Confirmar"
            className="rounded border border-linea-2 px-2.5 text-bien
                       hover:bg-panel-2 disabled:opacity-40"
          >
            <Check size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={cancelar}
            aria-label="Cancelar"
            className="rounded border border-linea-2 px-2.5 text-tinta-3 hover:bg-panel-2"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      ) : (
        <select
          value={valor ?? ''}
          autoFocus={autoFocus}
          onChange={(e) => {
            if (e.target.value === AGREGAR) { setCreando(true); return; }
            onChange(e.target.value === '' ? null : e.target.value);
          }}
          className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                     outline-none focus:border-acento"
        >
          {vacio !== undefined && <option value="">{vacio}</option>}
          {lista.map((o) => (
            <option key={o} value={o}>{etiquetaDe?.(o) ?? o}</option>
          ))}
          <option value={AGREGAR}>
            ＋ {textoAgregar ?? `Agregar ${etiqueta.toLowerCase()}…`}
          </option>
        </select>
      )}

      {ayuda !== undefined && (
        <span className="text-[12px] text-tinta-3">{ayuda}</span>
      )}
    </label>
  );
}

/** Botón suelto para agregar, cuando no hay ninguna opción todavía. */
export function BotonAgregar({
  texto, onClick,
}: { readonly texto: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded border border-dashed border-linea-2
                 px-3 py-2 text-[13px] font-semibold text-tinta-2
                 hover:border-acento hover:text-acento"
    >
      <Plus size={14} aria-hidden />
      {texto}
    </button>
  );
}
