/**
 * El manual, dentro del programa.
 *
 * Vive aqui y no en una carpeta suelta porque quien lo necesita esta
 * parado en la caja con un cliente esperando. Un archivo que hay que ir a
 * buscar al computador es un archivo que nadie abre.
 *
 * El texto sale del mismo `docs/MANUAL.md` de siempre, no de una copia:
 * dos versiones del manual terminan diciendo cosas distintas.
 */

import { useMemo, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';

import { paraBuscar } from '@/compartido/utilidades/formato';
import fuenteDelManual from '../../../docs/MANUAL.md?raw';
import { aSecciones } from './markdown';
import type { Bloque, Seccion, Trozo } from './markdown';

const SECCIONES = aSecciones(fuenteDelManual).map((s) => ({
  ...s,
  // Sin tildes, para que «cuanto» encuentre «cuánto».
  buscable: paraBuscar(s.texto),
}));

function Trocitos({ trozos }: { readonly trozos: readonly Trozo[] }) {
  return (
    <>
      {trozos.map((t, i) => {
        if (t.tipo === 'fuerte') return <strong key={i} className="font-bold">{t.texto}</strong>;
        if (t.tipo === 'enfasis') {
          return (
            <em key={i} className="rounded bg-acento-suave px-1 py-0.5 not-italic
                                   font-semibold text-acento">
              {t.texto}
            </em>
          );
        }
        if (t.tipo === 'codigo') {
          return (
            <code key={i} className="cifra rounded bg-panel-2 px-1.5 py-0.5 text-[13px]">
              {t.texto}
            </code>
          );
        }
        return <span key={i}>{t.texto}</span>;
      })}
    </>
  );
}

function Pieza({ bloque }: { readonly bloque: Bloque }) {
  switch (bloque.tipo) {
    case 'titulo':
      return (
        <h3 className={bloque.nivel === 3
          ? 'mt-5 text-[15px] font-bold'
          : 'mt-6 text-lg font-bold'}>
          {bloque.texto}
        </h3>
      );

    case 'parrafo':
      return (
        <p className="mt-2.5 text-[15px] leading-relaxed text-tinta-2">
          <Trocitos trozos={bloque.trozos} />
        </p>
      );

    case 'lista':
      return (
        <ul className="mt-2.5 flex list-disc flex-col gap-1.5 pl-5 text-[15px]
                       leading-relaxed text-tinta-2">
          {bloque.puntos.map((punto, i) => (
            <li key={i}><Trocitos trozos={punto} /></li>
          ))}
        </ul>
      );

    case 'cita':
      return (
        <p className="mt-3 border-l-2 border-acento bg-acento-suave px-3 py-2
                      text-[14px] leading-relaxed text-tinta-2">
          <Trocitos trozos={bloque.trozos} />
        </p>
      );

    case 'codigo':
      return (
        <pre className="cifra mt-3 overflow-x-auto rounded border border-linea bg-panel-2
                        px-3 py-2 text-[13px]">
          {bloque.texto}
        </pre>
      );

    case 'tabla':
      return (
        <div className="mt-3 overflow-x-auto rounded border border-linea">
          <table className="w-full text-[14px]">
            <thead className="bg-panel-2">
              <tr>
                {bloque.cabecera.map((celda, i) => (
                  <th key={i} className="px-3 py-2 text-left font-semibold">
                    <Trocitos trozos={celda} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bloque.filas.map((fila, i) => (
                <tr key={i} className="border-t border-linea">
                  {fila.map((celda, j) => (
                    <td key={j} className="px-3 py-2 align-top text-tinta-2">
                      <Trocitos trozos={celda} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'separador':
      return <hr className="mt-6 border-linea" />;
  }
}

export function Ayuda() {
  const [consulta, setConsulta] = useState('');
  const [abierta, setAbierta] = useState<string>(SECCIONES[0]?.id ?? '');

  const texto = paraBuscar(consulta);

  // Todas las palabras, en cualquier orden y no como frase exacta: quien
  // escribe «falta plata» esta buscando lo que el manual dice como «al
  // cerrar va a faltar plata», y con frase exacta no encontraria nada.
  const encontradas = useMemo(() => {
    if (texto === '') return SECCIONES;
    const palabras = texto.split(/\s+/);
    return SECCIONES.filter((s) => palabras.every((p) => s.buscable.includes(p)));
  }, [texto]);

  // Buscando se muestran todas las coincidencias seguidas; sin buscar, la
  // seccion elegida en el indice.
  const aMostrar: readonly Seccion[] = texto !== ''
    ? encontradas
    : SECCIONES.filter((s) => s.id === abierta);

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
      <aside className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center gap-2">
          <BookOpen size={18} className="text-acento" aria-hidden />
          <h2 className="text-lg font-bold tracking-tight">Ayuda</h2>
        </div>

        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tinta-3"
            aria-hidden
          />
          <input
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscar en el manual…"
            aria-label="Buscar en el manual"
            className="w-full rounded-lg border border-linea-2 bg-panel py-2.5 pl-9 pr-8
                       text-sm outline-none placeholder:text-tinta-3 focus:border-acento"
          />
          {consulta !== '' && (
            <button
              type="button"
              onClick={() => setConsulta('')}
              aria-label="Limpiar la búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1
                         text-tinta-3 hover:text-tinta"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </div>

        <nav aria-label="Secciones del manual" className="min-h-0 flex-1 overflow-y-auto">
          <ul className="flex flex-col gap-0.5">
            {SECCIONES.map((s) => {
              const coincide = texto === '' || encontradas.includes(s);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => { setConsulta(''); setAbierta(s.id); }}
                    aria-current={texto === '' && s.id === abierta ? 'true' : undefined}
                    className={`w-full rounded px-3 py-2 text-left text-[13px] font-semibold
                      ${texto === '' && s.id === abierta
                        ? 'bg-acento-suave text-acento'
                        : coincide
                          ? 'text-tinta-2 hover:bg-panel-2'
                          : 'text-tinta-3 opacity-40'}`}
                  >
                    {s.titulo}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <section className="min-h-0 overflow-y-auto rounded-lg border border-linea bg-panel p-6">
        {texto !== '' && (
          <p className="mb-4 text-[13px] text-tinta-3">
            {encontradas.length === 0
              ? `Nada del manual habla de «${consulta}».`
              : `${encontradas.length} ${encontradas.length === 1
                  ? 'sección habla' : 'secciones hablan'} de «${consulta}».`}
          </p>
        )}

        {aMostrar.map((s) => (
          <article key={s.id} className="mb-8 last:mb-0">
            <h2 className="text-xl font-bold tracking-tight">{s.titulo}</h2>
            {s.bloques.map((b, i) => <Pieza key={i} bloque={b} />)}
          </article>
        ))}
      </section>
    </div>
  );
}
