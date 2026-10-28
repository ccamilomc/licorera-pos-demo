/**
 * Compras: recibir mercancía del proveedor.
 *
 * Es donde el sistema aprende cuánto cuestan las cosas. Se recibe en el
 * empaque en que llega —una canasta, un cartón— y el costo por unidad
 * sale solo, junto con el margen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Plus, Trash2, Truck } from 'lucide-react';

import { HayMasAtras } from '@/compartido/componentes/HayMasAtras';
import { fechaCorta, paraBuscar, pesos } from '@/compartido/utilidades/formato';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';
import { Proveedores } from './Proveedores';
import type { ProductoVenta } from '@/modulos/pos/carrito';

interface Proveedor {
  readonly id: number;
  readonly nombre: string;
  readonly productos: number;
}

interface CompraListada {
  readonly id: number;
  readonly numero: string;
  readonly fecha: string;
  readonly proveedor: string;
  readonly documento: string | null;
  readonly total: number;
  readonly anulada: boolean;
  readonly articulos: number;
}

interface ItemRecibido {
  readonly producto: string;
  readonly empaque: string;
  readonly cantidad: number;
  readonly unidades: number;
  readonly costo_unitario: number;
  readonly margen: number | null;
}

interface CompraGuardada {
  readonly numero: string;
  readonly total: number;
  readonly unidades: number;
  readonly items: readonly ItemRecibido[];
}

/** Valor del desplegable que abre el alta de una forma nueva. */
const NUEVA_FORMA = '__nueva__';

/** Las formas de mover mercancía que se repiten en cualquier licorera. */
const FORMAS_SUGERIDAS: readonly { nombre: string; factor: number }[] = [
  { nombre: 'Canasta', factor: 30 },
  { nombre: 'Media canasta', factor: 15 },
  { nombre: 'Cartón', factor: 24 },
  { nombre: 'Six', factor: 6 },
  { nombre: 'Docena', factor: 12 },
  { nombre: 'Paca', factor: 20 },
  { nombre: 'Display', factor: 12 },
];

/** Renglón que se está armando en la pantalla. */
interface LineaCompra {
  readonly clave: string;
  readonly producto: ProductoVenta;
  readonly empaqueId: number | null;
  readonly empaqueNombre: string;
  readonly factor: number;
  readonly cantidad: number;
  readonly costoEmpaque: number;
}

function hoyLocal(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

export function Compras() {
  const { usuario, puede } = useSesion();
  const [proveedores, setProveedores] = useState<readonly Proveedor[]>([]);
  const [viendoProveedores, setViendoProveedores] = useState(false);
  const [catalogo, setCatalogo] = useState<readonly ProductoVenta[]>([]);
  const [historial, setHistorial] = useState<readonly CompraListada[]>([]);
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultima, setUltima] = useState<CompraGuardada | null>(null);
  const [anulando, setAnulando] = useState<CompraListada | null>(null);
  const [motivoAnulacion, setMotivoAnulacion] = useState('');

  const [proveedorId, setProveedorId] = useState<number | null>(null);
  const [documento, setDocumento] = useState('');
  const [fecha, setFecha] = useState(hoyLocal());
  const [lineas, setLineas] = useState<readonly LineaCompra[]>([]);
  const [consulta, setConsulta] = useState('');
  const [guardando, setGuardando] = useState(false);
  /** Cuantas compras se traen del historial. */
  const [tope, setTope] = useState(40);
  const [desplegado, setDesplegado] = useState(false);
  /**
   * Si la mercancía llegó pero no se pagó. Pasa todo el tiempo: el
   * proveedor deja las canastas el martes y cobra el viernes.
   */
  const [quedaDebiendo, setQuedaDebiendo] = useState(false);
  const [vence, setVence] = useState('');
  /** Renglón al que se le está dando de alta una forma nueva. */
  const [creandoForma, setCreandoForma] = useState<string | null>(null);
  const [forma, setForma] = useState({ nombre: '', factor: '', precio: '' });
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [provs, productos, compras] = await Promise.all([
        pedir<Proveedor[]>('listar_proveedores'),
        pedir<ProductoVenta[]>('catalogo_venta'),
        pedir<CompraListada[]>('listar_compras', { limite: tope }),
      ]);
      setProveedores(provs);
      setCatalogo(productos);
      setHistorial(compras);
      setProveedorId((actual) => actual ?? provs[0]?.id ?? null);
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }, [tope]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function anular() {
    if (anulando === null || usuario === null || motivoAnulacion.trim() === '') return;
    try {
      await pedir('anular_compra', {
        compraId: anulando.id,
        motivo: motivoAnulacion,
        usuarioId: usuario.id,
        rol: usuario.rol,
      });
      setAnulando(null);
      setMotivoAnulacion('');
      setError(null);
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  // Con el campo enfocado y sin escribir nada sale el catalogo entero,
  // para ir bajando y elegir. Escribir filtra. Antes habia que saberse
  // el nombre de memoria para que apareciera algo.
  const resultados = useMemo(() => {
    const texto = paraBuscar(consulta);
    if (texto === '') return catalogo;
    return catalogo.filter((p) =>
      paraBuscar(`${p.nombre} ${p.presentacion} ${p.categoria}`).includes(texto));
  }, [catalogo, consulta]);

  const total = lineas.reduce((s, l) => s + l.cantidad * l.costoEmpaque, 0);

  function agregar(producto: ProductoVenta) {
    // Para comprar se propone el empaque más grande: es como llega la
    // mercancía del proveedor.
    const mayor = [...producto.empaques_compra].sort((a, b) => b.factor - a.factor)[0];
    setLineas((ls) => [...ls, {
      clave: `${producto.id}-${mayor?.id ?? 'base'}-${ls.length}`,
      producto,
      empaqueId: mayor?.id ?? null,
      empaqueNombre: mayor?.nombre ?? 'Unidad',
      factor: mayor?.factor ?? 1,
      cantidad: 1,
      costoEmpaque: 0,
    }]);
    setConsulta('');
  }

  /**
   * Da de alta la forma y la deja puesta en el renglón.
   *
   * Es el momento en que se sabe: llegaron cinco canastas y el producto
   * no tenía canasta. Mandar al dueño a la ficha a mitad de la compra es
   * la manera segura de que registre canastas como si fueran unidades.
   */
  async function crearForma() {
    const linea = lineas.find((l) => l.clave === creandoForma);
    if (linea === undefined || usuario === null) return;
    const factor = Number(forma.factor);
    if (forma.nombre.trim() === '' || !Number.isFinite(factor) || factor < 1) return;

    const precio = Number(forma.precio);
    setCreando(true);
    try {
      const nueva = await pedir<{ id: number; nombre: string; factor: number }>(
        'agregar_empaque',
        {
          productoId: linea.producto.id,
          nombre: forma.nombre.trim(),
          factor,
          precioVenta: Number.isFinite(precio) && precio > 0 ? precio : null,
          paraVenta: Number.isFinite(precio) && precio > 0,
          paraCompra: true,
          rol: usuario.rol,
        },
      );
      await cargar();
      actualizar(linea.clave, {
        empaqueId: nueva.id,
        empaqueNombre: nueva.nombre,
        factor: nueva.factor,
      });
      setCreandoForma(null);
      setForma({ nombre: '', factor: '', precio: '' });
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setCreando(false);
    }
  }

  function actualizar(clave: string, cambios: Partial<LineaCompra>) {
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)));
  }

  async function guardar() {
    if (usuario === null || proveedorId === null || lineas.length === 0) return;
    setGuardando(true);
    try {
      const guardada = await pedir<CompraGuardada>('registrar_compra', {
        compra: {
          proveedor_id: proveedorId,
          documento: documento.trim() === '' ? null : documento.trim(),
          fecha,
          a_credito: quedaDebiendo,
          vence: quedaDebiendo && vence !== '' ? vence : null,
          items: lineas.map((l) => ({
            producto_id: l.producto.id,
            empaque_id: l.empaqueId,
            cantidad: l.cantidad,
            costo_empaque: l.costoEmpaque,
          })),
          descuento: 0,
          usuario_id: usuario.id,
          notas: null,
        },
        rol: usuario.rol,
      });
      setUltima(guardada);
      setLineas([]);
      setQuedaDebiendo(false);
      setVence('');
      setDocumento('');
      setRegistrando(false);
      setError(null);
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setGuardando(false);
    }
  }

  if (registrando) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto">
        <header>
          <h2 className="text-xl font-bold tracking-tight">Recibir mercancía</h2>
          <p className="mt-0.5 text-sm text-tinta-2">
            Registra lo que llegó tal como viene: si son canastas, en canastas.
            El costo por unidad sale solo.
          </p>
        </header>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-tinta-2">Proveedor</span>
            <select
              value={proveedorId ?? ''}
              onChange={(e) => setProveedorId(Number(e.target.value))}
              className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                         focus:border-acento"
            >
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-tinta-2">Factura o remisión</span>
            <input
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              placeholder="opcional"
              className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                         placeholder:text-tinta-3 focus:border-acento"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-tinta-2">Fecha</span>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="cifra rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                         outline-none focus:border-acento"
            />
          </label>
        </div>

        <div className="relative">
          <input
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            onFocus={() => setDesplegado(true)}
            // Al soltar el foco hay que esperar: si se cierra de una, el
            // clic sobre un producto nunca llega a ocurrir.
            onBlur={() => window.setTimeout(() => setDesplegado(false), 150)}
            placeholder="Elige el producto que llegó, o escribe para buscarlo…"
            aria-label="Buscar producto"
            className="w-full rounded-lg border border-linea-2 bg-panel px-4 py-2.5 text-sm
                       outline-none placeholder:text-tinta-3 focus:border-acento"
          />
          {desplegado && resultados.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border
                           border-linea bg-panel shadow-lg">
              {resultados.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => agregar(p)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2
                               text-left text-sm hover:bg-panel-2"
                  >
                    <span className="min-w-0 truncate">
                      {p.nombre}
                      <span className="ml-2 text-[12px] text-tinta-3">
                        {p.presentacion} · {p.categoria}
                      </span>
                    </span>
                    <span className="cifra shrink-0 text-[12px] text-tinta-3">
                      hay {p.existencia}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {creandoForma !== null && (() => {
          const linea = lineas.find((l) => l.clave === creandoForma);
          if (linea === undefined) return null;
          const producto = catalogo.find((p) => p.id === linea.producto.id)
            ?? linea.producto;
          const yaTiene = new Set(
            producto.empaques_compra.map((e) => e.nombre.toLowerCase()),
          );
          const factor = Number(forma.factor);
          const listo = forma.nombre.trim() !== '' && Number.isFinite(factor) && factor >= 1;
          return (
            <div className="rounded-lg border-2 border-acento bg-panel p-4">
              <h3 className="text-sm font-bold">
                Una forma nueva para {producto.nombre}
              </h3>
              <p className="mt-1 text-[13px] text-tinta-2">
                Solo hay que decir cómo se llama y cuántas unidades trae. Queda
                guardada en el producto: la próxima vez ya aparece en la lista.
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {FORMAS_SUGERIDAS.filter((f) => !yaTiene.has(f.nombre.toLowerCase())).map((f) => (
                  <button
                    key={f.nombre}
                    type="button"
                    onClick={() => setForma((a) => ({
                      ...a, nombre: f.nombre, factor: String(f.factor),
                    }))}
                    className="rounded border border-linea-2 px-2 py-1 text-[12px]
                               font-semibold text-tinta-2 hover:border-acento
                               hover:text-acento"
                  >
                    {f.nombre} ×{f.factor}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-tinta-2">Se llama</span>
                  <input
                    value={forma.nombre}
                    onChange={(e) => setForma((a) => ({ ...a, nombre: e.target.value }))}
                    placeholder="Canasta"
                    aria-label="Nombre de la forma"
                    autoFocus
                    className="w-40 rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                               outline-none focus:border-acento"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-tinta-2">Trae</span>
                  <input
                    inputMode="numeric"
                    value={forma.factor}
                    onChange={(e) => setForma((a) => ({
                      ...a, factor: e.target.value.replace(/\D/g, ''),
                    }))}
                    placeholder="30"
                    aria-label="Unidades que trae"
                    className="cifra w-24 rounded border border-linea-2 bg-panel px-3 py-2
                               text-sm outline-none focus:border-acento"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-tinta-2">
                    Se vende a <span className="font-normal text-tinta-3">(opcional)</span>
                  </span>
                  <input
                    inputMode="numeric"
                    value={forma.precio}
                    onChange={(e) => setForma((a) => ({
                      ...a, precio: e.target.value.replace(/\D/g, ''),
                    }))}
                    placeholder="sin precio, solo para recibir"
                    aria-label="Precio de venta de la forma"
                    className="cifra w-56 rounded border border-linea-2 bg-panel px-3 py-2
                               text-sm outline-none placeholder:text-[12px]
                               focus:border-acento"
                  />
                </label>
              </div>

              <p className="mt-2 text-[12px] text-tinta-3">
                El precio no se calcula solo: seis {producto.nombre} sueltas y
                un six no valen lo mismo. Si lo dejas vacío, la forma sirve para
                recibir mercancía pero todavía no para cobrar.
              </p>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => { void crearForma(); }}
                  disabled={!listo || creando}
                  className="rounded bg-acento px-4 py-2 text-sm font-bold text-sobre-acento
                             hover:bg-acento-fuerte disabled:cursor-not-allowed
                             disabled:opacity-50"
                >
                  {creando ? 'Guardando…' : 'Guardar y usarla'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreandoForma(null);
                    setForma({ nombre: '', factor: '', precio: '' });
                  }}
                  className="rounded border border-linea-2 px-4 py-2 text-sm font-semibold
                             text-tinta-2 hover:bg-panel-2"
                >
                  Cancelar
                </button>
              </div>
            </div>
          );
        })()}

        {lineas.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-linea">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-panel-2">
                <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
                  <th className="px-3 py-2.5 font-semibold">Producto</th>
                  <th className="px-3 py-2.5 font-semibold">Llega en</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Cantidad</th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    Costo de cada uno
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">Unidades</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Por unidad</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  // Del catálogo y no de la copia que guardó el renglón:
                  // si se le acaba de agregar una forma, el renglón se
                  // quedaría sin verla y el desplegable saldría vacío.
                  const producto = catalogo.find((p) => p.id === l.producto.id)
                    ?? l.producto;
                  const unidades = l.cantidad * l.factor;
                  const porUnidad = l.factor > 0 ? Math.floor(l.costoEmpaque / l.factor) : 0;
                  const margen = producto.precio_venta > 0 && porUnidad > 0
                    ? Math.round(((producto.precio_venta - porUnidad) * 100)
                        / producto.precio_venta)
                    : null;
                  return (
                    <tr key={l.clave} className="border-t border-linea bg-panel">
                      <td className="px-3 py-2">
                        <div className="font-semibold">{producto.nombre}</div>
                        <div className="text-[12px] text-tinta-3">{producto.presentacion}</div>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={l.empaqueId ?? ''}
                          onChange={(e) => {
                            if (e.target.value === NUEVA_FORMA) {
                              setCreandoForma(l.clave);
                              return;
                            }
                            const id = Number(e.target.value);
                            const emp = producto.empaques_compra.find((x) => x.id === id);
                            actualizar(l.clave, {
                              empaqueId: id,
                              empaqueNombre: emp?.nombre ?? 'Unidad',
                              factor: emp?.factor ?? 1,
                            });
                          }}
                          aria-label={`Empaque de ${producto.nombre}`}
                          className="rounded border border-linea-2 bg-panel px-2 py-1 text-[13px]
                                     outline-none focus:border-acento"
                        >
                          {producto.empaques_compra.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.nombre} (×{e.factor})
                            </option>
                          ))}
                          {puede('producto.editar') && (
                            <option value={NUEVA_FORMA}>＋ Otra forma…</option>
                          )}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          inputMode="numeric"
                          value={l.cantidad || ''}
                          onChange={(e) => actualizar(l.clave, {
                            cantidad: Number(e.target.value.replace(/\D/g, '')) || 0,
                          })}
                          aria-label={`Cantidad de ${producto.nombre}`}
                          className="cifra w-16 rounded border border-linea-2 bg-panel px-2 py-1
                                     text-right outline-none focus:border-acento"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          inputMode="numeric"
                          value={l.costoEmpaque || ''}
                          onChange={(e) => actualizar(l.clave, {
                            costoEmpaque: Number(e.target.value.replace(/\D/g, '')) || 0,
                          })}
                          aria-label={`Costo de cada ${l.empaqueNombre.toLowerCase()} de `
                            + producto.nombre}
                          className="cifra w-24 rounded border border-linea-2 bg-panel px-2 py-1
                                     text-right outline-none focus:border-acento"
                        />
                        {/* Sin esto se presta a confusion: cinco canastas
                            a $108.000 es el precio de la canasta, no el de
                            la cerveza. */}
                        <div className="mt-0.5 text-[11px] text-tinta-3">
                          por {l.empaqueNombre.toLowerCase()}
                        </div>
                      </td>
                      <td className="cifra px-3 py-2 text-right font-semibold">{unidades}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="cifra">{pesos(porUnidad)}</div>
                        {margen !== null && (
                          <div className={`text-[11px] ${margen > 0 ? 'text-bien' : 'text-grave'}`}>
                            {margen > 0 ? `${margen}% de margen` : 'se vende por debajo'}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                          aria-label={`Quitar ${producto.nombre}`}
                          className="rounded p-1 text-tinta-3 hover:text-grave"
                        >
                          <Trash2 size={15} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {error !== null && (
          <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3 py-2
                                     text-sm text-grave">
            {error}
          </p>
        )}

        <label className="flex items-start gap-2.5 rounded-lg border border-linea
                          bg-panel p-3.5">
          <input
            type="checkbox"
            checked={quedaDebiendo}
            onChange={(e) => setQuedaDebiendo(e.target.checked)}
            aria-label="Quedé debiendo esta compra"
            className="mt-0.5"
          />
          <span>
            <span className="text-[13px] font-semibold text-tinta-2">
              Quedé debiendo esta compra
            </span>
            <span className="block text-[12px] text-tinta-3">
              Para cuando el proveedor deja la mercancía y cobra después. Queda en
              «A quién le debo» hasta que la pagues.
            </span>
          </span>
        </label>

        {quedaDebiendo && (
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-tinta-2">
              ¿Cuándo hay que pagarla?{' '}
              <span className="font-normal text-tinta-3">(opcional)</span>
            </span>
            <input
              type="date"
              value={vence}
              min={fecha}
              onChange={(e) => setVence(e.target.value)}
              aria-label="Cuándo vence la compra"
              className="cifra w-48 rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                         outline-none focus:border-acento"
            />
          </label>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-linea pt-4">
          <span className="text-sm font-semibold text-tinta-2">Total de la compra</span>
          <span aria-label="Total de la compra" className="cifra text-2xl font-extrabold">
            {pesos(total)}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => { void guardar(); }}
            disabled={guardando || lineas.length === 0 || total === 0}
            className="rounded bg-acento px-4 py-2.5 text-sm font-bold text-sobre-acento
                       hover:bg-acento-fuerte disabled:cursor-not-allowed disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Registrar la entrada'}
          </button>
          <button
            type="button"
            onClick={() => { setRegistrando(false); setLineas([]); setError(null); }}
            className="rounded border border-linea-2 px-4 py-2.5 text-sm font-semibold
                       text-tinta-2 hover:bg-panel-2"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (viendoProveedores) {
    return (
      <Proveedores onCerrar={() => { setViendoProveedores(false); void cargar(); }} />
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Compras</h2>
          <p className="mt-0.5 text-sm text-tinta-2">
            {proveedores.length} proveedores registrados
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setViendoProveedores(true)}
            className="inline-flex items-center gap-2 rounded border border-linea-2 px-3
                       py-2.5 text-sm font-semibold text-tinta-2 hover:border-acento
                       hover:text-acento"
          >
            <Truck size={16} aria-hidden />
            Proveedores
          </button>
          <button
            type="button"
            onClick={() => setRegistrando(true)}
            disabled={proveedores.length === 0}
            title={proveedores.length === 0
              ? 'Agrega un proveedor antes de registrar una compra'
              : undefined}
            className="inline-flex items-center gap-2 rounded bg-acento px-4 py-2.5 text-sm
                       font-semibold text-sobre-acento hover:bg-acento-fuerte
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={16} aria-hidden />
            Recibir mercancía
          </button>
        </div>
      </header>

      {proveedores.length === 0 && (
        <p className="rounded border border-alerta/30 bg-alerta-suave px-3 py-2 text-sm">
          Antes de registrar una compra hace falta al menos un proveedor.{' '}
          <button
            type="button"
            onClick={() => setViendoProveedores(true)}
            className="font-semibold underline hover:text-acento"
          >
            Agregar el primero
          </button>
        </p>
      )}

      {ultima !== null && (
        <div className="rounded-lg border border-bien/30 bg-bien-suave p-4">
          <p className="text-sm font-semibold">
            Compra {ultima.numero} registrada por {pesos(ultima.total)} ·{' '}
            <span className="cifra">{ultima.unidades}</span> unidades al inventario
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {ultima.items.map((i, n) => (
              <li key={n} className="text-[13px] text-tinta-2">
                {i.producto}: {i.cantidad} {i.empaque.toLowerCase()} ={' '}
                <span className="cifra">{i.unidades}</span> unidades a{' '}
                <span className="cifra">{pesos(i.costo_unitario)}</span> c/u
                {i.margen !== null && ` · ${i.margen}% de margen`}
              </li>
            ))}
          </ul>
        </div>
      )}

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
            Anular la compra {anulando.numero} de {pesos(anulando.total)}
          </h3>
          <p className="mt-2 text-[13px] text-tinta-2">
            La mercancía que había entrado sale del inventario. La compra no se borra:
            queda marcada como anulada con este motivo.
          </p>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-tinta-2">¿Por qué se anula?</span>
            <input
              value={motivoAnulacion}
              onChange={(e) => setMotivoAnulacion(e.target.value)}
              autoFocus
              placeholder="llegó en mal estado, se devolvió al proveedor…"
              className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                         placeholder:text-[13px] focus:border-grave"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => { void anular(); }}
              disabled={motivoAnulacion.trim() === ''}
              className="rounded bg-grave px-4 py-2 text-sm font-semibold text-sobre-grave
                         disabled:cursor-not-allowed disabled:opacity-50"
            >
              Anular la compra
            </button>
            <button
              type="button"
              onClick={() => { setAnulando(null); setMotivoAnulacion(''); }}
              className="rounded border border-linea-2 bg-panel px-4 py-2 text-sm
                         font-semibold text-tinta-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-linea">
        {historial.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Truck size={22} className="text-tinta-3" aria-hidden />
            <p className="text-sm text-tinta-2">
              Todavía no has registrado ninguna compra. Al recibir mercancía, el sistema
              aprende cuánto cuestan las cosas y puede calcular tu ganancia.
            </p>
          </div>
        ) : (
          <>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 bg-panel-2">
              <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
                <th className="px-3 py-2.5 font-semibold">Compra</th>
                <th className="px-3 py-2.5 font-semibold">Fecha</th>
                <th className="px-3 py-2.5 font-semibold">Proveedor</th>
                <th className="px-3 py-2.5 text-right font-semibold">Empaques</th>
                <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {historial.map((c) => (
                <tr key={c.id} className="border-t border-linea bg-panel">
                  <td className="cifra px-3 py-2.5 font-semibold">
                    {c.numero}
                    {c.anulada && (
                      <span className="ml-2 rounded bg-grave-suave px-1.5 py-0.5 text-[11px]
                                       font-semibold text-grave">
                        anulada
                      </span>
                    )}
                    {c.documento !== null && (
                      <div className="text-[12px] font-normal text-tinta-3">{c.documento}</div>
                    )}
                  </td>
                  <td className="cifra px-3 py-2.5 text-[13px] text-tinta-2">
                    {fechaCorta(c.fecha)}
                  </td>
                  <td className="px-3 py-2.5 text-tinta-2">{c.proveedor}</td>
                  <td className="cifra px-3 py-2.5 text-right text-tinta-2">{c.articulos}</td>
                  <td className={`cifra px-3 py-2.5 text-right font-semibold ${
                    c.anulada ? 'text-tinta-3 line-through' : ''}`}
                  >
                    {pesos(c.total)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {!c.anulada && puede('compra.anular') && (
                      <button
                        type="button"
                        onClick={() => { setAnulando(c); setMotivoAnulacion(''); }}
                        className="text-[13px] font-semibold text-tinta-3 hover:text-grave"
                      >
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {historial.length === tope && (
            <HayMasAtras
              viendo={tope}
              nombre="compras"
              onVerMas={() => setTope((n) => n + 60)}
            />
          )}
          </>
        )}
      </div>
    </div>
  );
}
