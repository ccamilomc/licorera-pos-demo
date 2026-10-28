/**
 * Punto de venta.
 *
 * Optimizada para el teclado: el foco vuelve solo al buscador despues de
 * cada producto y despues de cerrar cada venta, para que no haya que
 * tocar el mouse en toda la jornada.
 *
 * Una venta normal son tres teclas: escribir, Enter, F2.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Minus, Plus, Search, Trash2 } from 'lucide-react';

import { pesos } from '@/compartido/utilidades/formato';
import { distintivos } from '@/compartido/utilidades/homonimos';
import {
  agregar, buscar, cambiarCantidad, claveDe, empaquePorDefecto,
  lineasSinExistencia, precioDe, quitar, totales, unidadesDeProducto,
} from './carrito';
import type { EmpaqueVenta, LineaCarrito, ProductoVenta } from './carrito';

interface Props {
  readonly catalogo: readonly ProductoVenta[];
  readonly lineas: readonly LineaCarrito[];
  readonly onCambiar: (lineas: LineaCarrito[]) => void;
  readonly onCobrar: () => void;
  readonly cobrando: boolean;
}

const MAXIMO_RESULTADOS = 8;

export function PantallaVenta({
  catalogo, lineas, onCambiar, onCobrar, cobrando,
}: Props) {
  const [consulta, setConsulta] = useState('');
  const [resaltado, setResaltado] = useState(0);
  const buscador = useRef<HTMLInputElement>(null);

  const resultados = useMemo(
    () => buscar(catalogo, consulta, MAXIMO_RESULTADOS),
    [catalogo, consulta],
  );
  const resumen = useMemo(() => totales(lineas), [lineas]);
  const faltantes = useMemo(() => lineasSinExistencia(lineas), [lineas]);

  // Se calcula sobre el catalogo entero y no sobre lo que se esta viendo:
  // si "Margarita" tiene dos tamanos, hay que avisarlo aunque la busqueda
  // muestre uno solo. Al ver una sin marca uno creeria que no hay otra.
  const marcas = useMemo(() => distintivos(catalogo), [catalogo]);

  const enfocarBuscador = useCallback(() => {
    buscador.current?.focus();
    buscador.current?.select();
  }, []);

  const meterAlCarrito = useCallback((
    producto: ProductoVenta,
    empaque: EmpaqueVenta | null = empaquePorDefecto(producto),
  ) => {
    onCambiar(agregar(lineas, producto, empaque));
    setConsulta('');
    setResaltado(0);
    enfocarBuscador();
  }, [lineas, onCambiar, enfocarBuscador]);

  // Atajos de toda la pantalla. F2 cobra desde donde sea, que es lo que
  // permite cerrar una venta sin soltar el teclado.
  useEffect(() => {
    function alPulsar(evento: KeyboardEvent) {
      if (evento.key === 'F1') {
        evento.preventDefault();
        enfocarBuscador();
      }
      if (evento.key === 'F2' && lineas.length > 0 && !cobrando) {
        evento.preventDefault();
        onCobrar();
      }
      if (evento.key === 'F8' && lineas.length > 0) {
        evento.preventDefault();
        onCambiar([]);
        enfocarBuscador();
      }
    }
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [lineas, cobrando, onCobrar, onCambiar, enfocarBuscador]);

  function navegarResultados(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (resultados.length === 0) return;

    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      setResaltado((i) => (i + 1) % resultados.length);
    }
    if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setResaltado((i) => (i - 1 + resultados.length) % resultados.length);
    }
    if (evento.key === 'Enter') {
      evento.preventDefault();
      const elegido = resultados[resaltado] ?? resultados[0];
      if (elegido !== undefined) meterAlCarrito(elegido);
    }
    if (evento.key === 'Escape') {
      setConsulta('');
      setResaltado(0);
    }
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
      {/* Buscador y resultados */}
      <section className="flex min-h-0 flex-col gap-3">
        <div className="relative">
          <Search
            size={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tinta-3"
            aria-hidden
          />
          <input
            ref={buscador}
            value={consulta}
            onChange={(e) => { setConsulta(e.target.value); setResaltado(0); }}
            onKeyDown={navegarResultados}
            placeholder="Escanea o escribe el nombre del producto…"
            aria-label="Buscar producto"
            autoFocus
            className="w-full rounded-lg border border-linea-2 bg-panel py-3.5 pl-11 pr-4
                       text-[17px] outline-none placeholder:text-tinta-3 focus:border-acento"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {consulta.trim() !== '' && resultados.length === 0 && (
            <p className="rounded-lg border border-linea bg-panel p-4 text-sm text-tinta-2">
              No hay productos que coincidan con «{consulta}».
            </p>
          )}

          <ul className="flex flex-col gap-1.5">
            {resultados.map((p, indice) => {
              const enCarrito = unidadesDeProducto(lineas, p.id);
              const disponible = p.existencia - enCarrito;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => meterAlCarrito(p)}
                    onMouseEnter={() => setResaltado(indice)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left
                      ${indice === resaltado
                        ? 'border-acento bg-acento-suave'
                        : 'border-linea bg-panel hover:border-linea-2'}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="truncate font-semibold">{p.nombre}</span>
                        {marcas.has(p.id) && (
                          <span className="shrink-0 rounded bg-acento-suave px-1.5 py-0.5
                                           text-[11px] font-bold text-acento">
                            {marcas.get(p.id)}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[13px] text-tinta-3">
                        {/* Lo que ya esta marcado arriba no se repite aqui. */}
                        {!marcas.has(p.id) && (
                          <>
                            {p.presentacion}
                            {p.envase !== null && ` · ${p.envase.toLowerCase()}`}
                            {' · '}
                          </>
                        )}
                        <span className={disponible <= 0 ? 'font-semibold text-grave' : ''}>
                          {disponible <= 0 ? 'sin existencia' : `${disponible} disponibles`}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      {/* Las formas que existen pero todavia no se pueden
                          cobrar. Antes simplemente no aparecian, y el
                          dueño creia que el producto no tenia canasta
                          cuando lo que faltaba era ponerle el precio. */}
                      {p.empaques_compra
                        .filter((c) => !p.empaques.some((v) => v.id === c.id))
                        .map((c) => (
                          <span
                            key={`sin-precio-${c.id}`}
                            title={`${c.nombre} de ${c.factor}: falta ponerle precio `
                              + `en la ficha del producto para poder venderla`}
                            className="cifra rounded border border-dashed border-linea-2
                                       px-2 py-1 text-[12px] text-tinta-3"
                          >
                            {c.nombre} sin precio
                          </span>
                        ))}
                      {p.empaques.map((e) => (
                        <span
                          key={e.id}
                          role="button"
                          tabIndex={0}
                          onClick={(evento) => { evento.stopPropagation(); meterAlCarrito(p, e); }}
                          onKeyDown={(evento) => {
                            if (evento.key === 'Enter' || evento.key === ' ') {
                              evento.preventDefault();
                              evento.stopPropagation();
                              meterAlCarrito(p, e);
                            }
                          }}
                          className="cifra rounded border border-linea-2 bg-panel px-2 py-1
                                     text-[12px] font-semibold hover:border-acento hover:text-acento"
                        >
                          {e.nombre} {pesos(e.precio_venta)}
                        </span>
                      ))}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Carrito */}
      <section className="flex min-h-0 flex-col rounded-lg border border-linea bg-panel">
        <header className="flex items-baseline justify-between border-b border-linea px-4 py-3">
          <h2 className="font-bold">Venta</h2>
          <span className="cifra text-[13px] text-tinta-3">
            {resumen.unidades} {resumen.unidades === 1 ? 'unidad' : 'unidades'}
          </span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {lineas.length === 0 ? (
            <p className="p-6 text-center text-sm text-tinta-3">
              Busca un producto o escanea su código para empezar.
            </p>
          ) : (
            <ul className="divide-y divide-linea">
              {lineas.map((linea) => {
                const clave = claveDe(linea);
                return (
                  <li key={clave} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-1.5">
                          <span className="truncate text-sm font-semibold">
                            {linea.producto.nombre}
                          </span>
                          {marcas.has(linea.producto.id) && (
                            <span className="shrink-0 rounded bg-acento-suave px-1 py-0.5
                                             text-[10px] font-bold text-acento">
                              {marcas.get(linea.producto.id)}
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] text-tinta-3">
                          {linea.empaque?.nombre ?? 'Unidad'} · {pesos(precioDe(linea))}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onCambiar(quitar(lineas, clave))}
                        aria-label={`Quitar ${linea.producto.nombre}`}
                        className="rounded p-1 text-tinta-3 hover:text-grave"
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onCambiar(cambiarCantidad(lineas, clave, linea.cantidad - 1))}
                          aria-label="Quitar uno"
                          className="rounded border border-linea-2 p-1.5 hover:border-acento"
                        >
                          <Minus size={13} aria-hidden />
                        </button>
                        <span className="cifra w-10 text-center text-sm font-semibold">
                          {linea.cantidad}
                        </span>
                        <button
                          type="button"
                          onClick={() => onCambiar(cambiarCantidad(lineas, clave, linea.cantidad + 1))}
                          aria-label="Agregar uno"
                          className="rounded border border-linea-2 p-1.5 hover:border-acento"
                        >
                          <Plus size={13} aria-hidden />
                        </button>
                      </div>
                      <span className="cifra text-sm font-bold">
                        {pesos(precioDe(linea) * linea.cantidad - linea.descuento)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {faltantes.length > 0 && (
          <div className="flex items-start gap-2 border-t border-linea bg-alerta-suave px-4 py-2.5">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-alerta" aria-hidden />
            <p className="text-[12px] leading-snug text-tinta-2">
              Estás vendiendo más de lo que figura en existencia. Se puede cobrar igual;
              queda anotado para revisar el inventario.
            </p>
          </div>
        )}

        <footer className="border-t border-linea p-4">
          {resumen.descuento > 0 && (
            <div className="mb-1.5 flex justify-between text-[13px] text-tinta-2">
              <span>Descuento</span>
              <span className="cifra">−{pesos(resumen.descuento)}</span>
            </div>
          )}
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-tinta-2">Total</span>
            <span
              aria-label="Total a cobrar"
              className="cifra text-3xl font-extrabold tracking-tight"
            >
              {pesos(resumen.total)}
            </span>
          </div>

          <button
            type="button"
            onClick={onCobrar}
            disabled={lineas.length === 0 || cobrando}
            className="w-full rounded-lg bg-acento px-4 py-3.5 text-base font-bold text-sobre-acento
                       hover:bg-acento-fuerte disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cobrando ? 'Guardando…' : 'Cobrar'}
            <span className="ml-2 text-[13px] font-semibold opacity-80">F2</span>
          </button>

          <p className="mt-2.5 text-center text-[11px] text-tinta-3">
            F1 buscar · F2 cobrar · F8 cancelar
          </p>
        </footer>
      </section>
    </div>
  );
}
