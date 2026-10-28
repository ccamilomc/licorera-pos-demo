/**
 * Ficha de producto: crear, editar, ajustar existencia y capturar el
 * código de barras.
 *
 * La existencia no se edita como un campo más. Se ajusta aparte y con
 * motivo, porque un stock que cambia sin dejar rastro es justo lo que
 * después nadie puede explicar.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Barcode, Check, History, Package, Plus, Scale, Trash2, TrendingDown, TrendingUp,
  Truck, X,
} from 'lucide-react';

import { pesos } from '@/compartido/utilidades/formato';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { SelectConAlta } from './SelectConAlta';
import { useSesion } from '@/nucleo/sesion';
import { Kardex } from './Kardex';
import { HistorialPrecios } from './HistorialPrecios';
import { PrecioEspecial } from './PrecioEspecial';
import { PreciosProveedor } from './PreciosProveedor';

export interface EmpaqueFicha {
  readonly id: number | null;
  readonly nombre: string;
  readonly factor: number;
  readonly precio_venta: number | null;
  readonly para_venta: boolean;
  readonly para_compra: boolean;
  readonly predeterminado: boolean;
}

export interface ProductoFicha {
  readonly id: number | null;
  readonly codigo: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly marca: string | null;
  readonly presentacion: string;
  readonly volumen_ml: number | null;
  readonly envase: string | null;
  readonly unidad_base: string;
  readonly precio_venta: number;
  readonly stock_minimo: number;
  readonly stock_maximo: number | null;
  readonly empaques: readonly EmpaqueFicha[];
  readonly notas: string | null;
  /** Solo informativo: se cambia desde el ajuste, no editando. */
  readonly existencia?: number;
  readonly revisar_motivo?: string | null;
  readonly codigos_barras?: readonly string[];
}

interface Props {
  readonly ficha: ProductoFicha;
  readonly onGuardado: () => void;
  /** Cambió la existencia pero la ficha sigue abierta: solo refrescar. */
  readonly onRefrescar: () => void;
  readonly onCerrar: () => void;
}

/** «BOTELLA» grita; «Botella» se lee. El valor guardado no cambia. */
const comoNombre = (v: string) =>
  v.charAt(0) + v.slice(1).toLowerCase();

/** Las formas de mover mercancia que se repiten en cualquier licorera. */
const EMPAQUES_SUGERIDOS: readonly { nombre: string; factor: number }[] = [
  { nombre: 'Six', factor: 6 },
  { nombre: 'Docena', factor: 12 },
  { nombre: 'Cartón', factor: 24 },
  { nombre: 'Media canasta', factor: 15 },
  { nombre: 'Canasta', factor: 30 },
  { nombre: 'Paca', factor: 20 },
  { nombre: 'Display', factor: 12 },
];

const EMPAQUE_NUEVO: EmpaqueFicha = {
  id: null, nombre: '', factor: 1, precio_venta: null,
  para_venta: true, para_compra: true, predeterminado: false,
};

export function EditarProducto({ ficha, onGuardado, onRefrescar, onCerrar }: Props) {
  const { usuario, puede } = useSesion();
  const esNuevo = ficha.id === null;

  const [datos, setDatos] = useState<ProductoFicha>(ficha);
  const [categorias, setCategorias] = useState<readonly string[]>([]);
  const [marcas, setMarcas] = useState<readonly string[]>([]);
  const [envases, setEnvases] = useState<readonly string[]>([]);
  const [unidades, setUnidades] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [ajuste, setAjuste] = useState({ cantidad: '', motivo: '', mostrando: false });
  const [codigo, setCodigo] = useState('');
  const [verHistorial, setVerHistorial] = useState(false);
  const [confirmandoBaja, setConfirmandoBaja] = useState(false);
  const [verPrecios, setVerPrecios] = useState(false);
  const [verPreciosViejos, setVerPreciosViejos] = useState(false);
  const campoCodigo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Las listas que el dueño administra. Si alguna falla se sigue: el
    // desplegable queda con lo que haya y siempre se puede agregar.
    interface ItemCatalogo { readonly nombre: string }
    const lista = (tipo: string) =>
      pedir<ItemCatalogo[]>('listar_catalogo', { tipo, incluirInactivos: false })
        .then((items) => items.map((i) => i.nombre))
        .catch(() => []);

    void lista('marcas').then(setMarcas);
    void lista('envases').then(setEnvases);
    void lista('unidades').then(setUnidades);

    pedir<string[]>('listar_categorias')
      .then(setCategorias)
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  }, []);

  function cambiar<C extends keyof ProductoFicha>(campo: C, valor: ProductoFicha[C]) {
    setDatos((d) => ({ ...d, [campo]: valor }));
  }

  function cambiarEmpaque(indice: number, cambios: Partial<EmpaqueFicha>) {
    setDatos((d) => ({
      ...d,
      empaques: d.empaques.map((e, i) => (i === indice ? { ...e, ...cambios } : e)),
    }));
  }

  async function guardar() {
    if (usuario === null) return;
    setGuardando(true);
    setError(null);
    try {
      const producto = {
        id: datos.id,
        codigo: datos.codigo,
        nombre: datos.nombre,
        categoria: datos.categoria,
        marca: datos.marca,
        presentacion: datos.presentacion,
        volumen_ml: datos.volumen_ml,
        envase: datos.envase,
        unidad_base: datos.unidad_base,
        precio_venta: datos.precio_venta,
        stock_minimo: datos.stock_minimo,
        stock_maximo: datos.stock_maximo,
        notas: datos.notas,
        empaques: datos.empaques.map((e) => ({
          id: e.id,
          nombre: e.nombre,
          factor: e.factor,
          precio_venta: e.precio_venta,
          para_venta: e.para_venta,
          para_compra: e.para_compra,
          predeterminado: e.predeterminado,
        })),
      };

      await pedir(esNuevo ? 'crear_producto' : 'editar_producto', {
        producto, rol: usuario.rol, usuarioId: usuario.id,
      });
      onGuardado();
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setGuardando(false);
    }
  }

  async function aplicarAjuste() {
    if (usuario === null || datos.id === null) return;
    const cantidad = Number(ajuste.cantidad);
    if (!Number.isFinite(cantidad) || cantidad === 0) return;

    try {
      await pedir('ajustar_existencia', {
        ajuste: {
          producto_id: datos.id,
          cantidad,
          motivo: ajuste.motivo,
          usuario_id: usuario.id,
        },
        rol: usuario.rol,
      });
      setAjuste({ cantidad: '', motivo: '', mostrando: false });
      onGuardado();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function quitarCodigo(codigo: string) {
    if (usuario === null) return;
    try {
      await pedir('quitar_codigo_barras', { codigo, rol: usuario.rol });
      onGuardado();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function desactivar() {
    if (usuario === null || datos.id === null) return;
    try {
      await pedir('desactivar_producto', {
        productoId: datos.id, rol: usuario.rol, usuarioId: usuario.id,
      });
      onGuardado();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function escanear() {
    if (usuario === null || datos.id === null || codigo.trim() === '') return;
    try {
      await pedir('asociar_codigo_barras', {
        productoId: datos.id, codigo, rol: usuario.rol, usuarioId: usuario.id,
      });
      setCodigo('');
      onGuardado();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  /**
   * Lo mismo que exige el núcleo, comprobado aquí.
   *
   * Antes el botón se podía tocar con la ficha en blanco: el núcleo lo
   * rechazaba, pero el dueño se enteraba después de guardar en vez de
   * verlo en el botón, como en todas las demás pantallas.
   */
  const sinNombre = datos.nombre.trim() === '';
  const sinCategoria = datos.categoria.trim() === '';
  const sinFormaDeVenta = !datos.empaques.some(
    (e) => e.para_venta && (e.precio_venta ?? 0) > 0,
  );
  const falta = sinNombre || sinCategoria || sinFormaDeVenta;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {esNuevo ? 'Nuevo producto' : datos.nombre}
          </h2>
          {datos.revisar_motivo != null && (
            <p className="mt-1 max-w-prose rounded border border-alerta/40 bg-alerta-suave
                          px-3 py-2 text-[13px] text-tinta-2">
              {datos.revisar_motivo} — al guardar, la marca de revisión desaparece.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="rounded p-1.5 text-tinta-3 hover:bg-panel-2 hover:text-tinta"
        >
          <X size={18} aria-hidden />
        </button>
      </header>

      {error !== null && (
        <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3 py-2
                                   text-sm text-grave">
          {error}
        </p>
      )}

      <div className="grid max-w-3xl gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-linea bg-panel p-5">
          <h3 className="mb-4 text-sm font-bold">Qué es</h3>
          <div className="flex flex-col gap-3.5">
            <Campo etiqueta="Nombre" valor={datos.nombre}
                   onChange={(v) => cambiar('nombre', v)} autoFocus />

            <SelectConAlta
              etiqueta="Categoría"
              valor={datos.categoria === '' ? null : datos.categoria}
              opciones={categorias}
              onChange={(v) => cambiar('categoria', v ?? '')}
              textoAgregar="Nueva categoría…"
            />

            <SelectConAlta
              etiqueta="Marca"
              valor={datos.marca}
              opciones={marcas}
              onChange={(v) => cambiar('marca', v)}
              vacio="Sin marca"
              textoAgregar="Nueva marca…"
              ayuda="Opcional. Sirve para buscar y para agrupar en los reportes."
            />

            <Campo
              etiqueta="Presentación"
              valor={datos.presentacion}
              onChange={(v) => cambiar('presentacion', v)}
              ayuda="Lo que distingue este producto de otro con el mismo nombre: 750 ml, familiar, media."
            />

            <SelectConAlta
              etiqueta="Envase"
              valor={datos.envase}
              opciones={envases}
              onChange={(v) => cambiar('envase', v)}
              vacio="Sin definir"
              textoAgregar="Nuevo envase…"
              etiquetaDe={comoNombre}
              ayuda="El envase distingue el producto: una lata y una botella son cosas distintas."
            />

            <SelectConAlta
              etiqueta="Se cuenta en"
              valor={datos.unidad_base}
              opciones={unidades}
              onChange={(v) => cambiar('unidad_base', v ?? 'UNIDAD')}
              textoAgregar="Nueva unidad…"
              etiquetaDe={comoNombre}
              ayuda="Casi todo se cuenta de a uno. El hielo se vende por kilo."
            />

            <Campo etiqueta="Código interno" valor={datos.codigo}
                   onChange={(v) => cambiar('codigo', v)} />
          </div>
        </section>

        <section className="rounded-lg border border-linea bg-panel p-5">
          <h3 className="mb-4 text-sm font-bold">Cuánto vale</h3>
          <div className="flex flex-col gap-3.5">
            <CampoNumero
              etiqueta="Precio de una unidad"
              valor={datos.precio_venta}
              onChange={(v) => cambiar('precio_venta', v)}
              soloLectura={!esNuevo && !puede('producto.precio')}
              ayuda={!esNuevo && !puede('producto.precio')
                ? 'Solo un administrador puede cambiar precios.' : undefined}
            />
            <CampoNumero
              etiqueta="Stock mínimo"
              valor={datos.stock_minimo}
              onChange={(v) => cambiar('stock_minimo', v)}
              ayuda="Por debajo de esta cantidad aparece la alerta."
            />
            <CampoNumero
              etiqueta="Stock máximo"
              valor={datos.stock_maximo ?? 0}
              onChange={(v) => cambiar('stock_maximo', v === 0 ? null : v)}
              ayuda="Opcional: cuánto es demasiado, para no sobrecomprar lo que rota lento."
            />
          </div>

          {!esNuevo && (
            <div className="mt-5 border-t border-linea pt-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-tinta-2">
                  Existencia actual
                </span>
                <span className="cifra text-xl font-bold">{datos.existencia ?? 0}</span>
              </div>

              {puede('inventario.ajustar') && !ajuste.mostrando && (
                <button
                  type="button"
                  onClick={() => setAjuste((a) => ({ ...a, mostrando: true }))}
                  className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold
                             text-tinta-3 hover:text-acento"
                >
                  <Scale size={14} aria-hidden />
                  Ajustar existencia
                </button>
              )}

              {ajuste.mostrando && (
                <div className="mt-3 flex flex-col gap-2.5 rounded border border-linea-2 p-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold text-tinta-2">
                      Cuánto entra o sale
                    </span>
                    <input
                      value={ajuste.cantidad}
                      onChange={(e) => setAjuste((a) => ({
                        ...a, cantidad: e.target.value.replace(/[^\d-]/g, ''),
                      }))}
                      placeholder="12 para sumar, -3 para restar"
                      autoFocus
                      className="cifra rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                                 outline-none placeholder:text-[12px] focus:border-acento"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold text-tinta-2">Por qué</span>
                    <input
                      value={ajuste.motivo}
                      onChange={(e) => setAjuste((a) => ({ ...a, motivo: e.target.value }))}
                      placeholder="conteo físico, rotura, vencido…"
                      className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                                 outline-none placeholder:text-[12px] focus:border-acento"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { void aplicarAjuste(); }}
                      disabled={ajuste.motivo.trim() === '' || ajuste.cantidad === ''}
                      className="rounded bg-acento px-3 py-1.5 text-[13px] font-semibold
                                 text-sobre-acento disabled:opacity-50"
                    >
                      Aplicar ajuste
                    </button>
                    <button
                      type="button"
                      onClick={() => setAjuste({ cantidad: '', motivo: '', mostrando: false })}
                      className="rounded border border-linea-2 px-3 py-1.5 text-[13px]
                                 font-semibold text-tinta-2"
                    >
                      Cancelar
                    </button>
                  </div>
                  <p className="text-[12px] text-tinta-3">
                    Queda registrado con tu nombre, la hora y el motivo.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="max-w-3xl rounded-lg border border-linea bg-panel p-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-bold">Formas de venta</h3>
          <button
            type="button"
            onClick={() => setDatos((d) => ({ ...d, empaques: [...d.empaques, EMPAQUE_NUEVO] }))}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-tinta-3
                       hover:text-acento"
          >
            <Plus size={14} aria-hidden />
            Agregar
          </button>
        </div>
        <p className="mb-3 text-[13px] text-tinta-3">
          Unidad, six, canasta, cartón. Cada una con su precio: el six no vale seis
          veces la unidad.
        </p>

        {/* Las de siempre, de un toque y con su factor puesto. Escribir
            «Media canasta, 15» a mano en cada producto es donde se cuelan
            los errores que despues descuadran el inventario. */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {EMPAQUES_SUGERIDOS
            .filter((s) => !datos.empaques.some(
              (e) => e.nombre.trim().toLowerCase() === s.nombre.toLowerCase()))
            .map((s) => (
              <button
                key={s.nombre}
                type="button"
                onClick={() => setDatos((d) => ({
                  ...d,
                  empaques: [...d.empaques, {
                    ...EMPAQUE_NUEVO, nombre: s.nombre, factor: s.factor,
                  }],
                }))}
                className="rounded border border-linea-2 px-2.5 py-1 text-[12px]
                           font-semibold text-tinta-2 hover:border-acento
                           hover:text-acento"
              >
                + {s.nombre}
                <span className="ml-1 text-tinta-3">×{s.factor}</span>
              </button>
            ))}
        </div>

        <div className="flex flex-col gap-2">
          {datos.empaques.map((e, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded border
                                    border-linea-2 p-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-tinta-3">Nombre</span>
                <input
                  value={e.nombre}
                  onChange={(ev) => cambiarEmpaque(i, { nombre: ev.target.value })}
                  placeholder="Six"
                  className="w-28 rounded border border-linea-2 bg-panel px-2 py-1.5 text-sm
                             outline-none focus:border-acento"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-tinta-3">Unidades</span>
                <input
                  value={e.factor || ''}
                  onChange={(ev) => cambiarEmpaque(i, {
                    factor: Number(ev.target.value.replace(/\D/g, '')) || 1,
                  })}
                  className="cifra w-16 rounded border border-linea-2 bg-panel px-2 py-1.5
                             text-right text-sm outline-none focus:border-acento"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-tinta-3">Precio</span>
                <input
                  value={e.precio_venta ?? ''}
                  onChange={(ev) => cambiarEmpaque(i, {
                    precio_venta: ev.target.value === ''
                      ? null : Number(ev.target.value.replace(/\D/g, '')),
                  })}
                  className="cifra w-24 rounded border border-linea-2 bg-panel px-2 py-1.5
                             text-right text-sm outline-none focus:border-acento"
                />
              </label>

              <label className="flex items-center gap-1.5 pb-2 text-[12px] text-tinta-2">
                <input
                  type="checkbox"
                  checked={e.para_venta}
                  onChange={(ev) => cambiarEmpaque(i, { para_venta: ev.target.checked })}
                />
                Se vende
              </label>
              <label className="flex items-center gap-1.5 pb-2 text-[12px] text-tinta-2">
                <input
                  type="radio"
                  name="predeterminado"
                  checked={e.predeterminado}
                  onChange={() => setDatos((d) => ({
                    ...d,
                    empaques: d.empaques.map((x, j) => ({ ...x, predeterminado: i === j })),
                  }))}
                />
                Por defecto
              </label>

              <span className="flex-1" />
              {e.precio_venta !== null && e.factor > 0 && (
                <span className="cifra pb-2 text-[12px] text-tinta-3">
                  {pesos(Math.round(e.precio_venta / e.factor))} por unidad
                </span>
              )}
              <button
                type="button"
                onClick={() => setDatos((d) => ({
                  ...d, empaques: d.empaques.filter((_, j) => j !== i),
                }))}
                aria-label={`Quitar ${e.nombre || 'forma de venta'}`}
                className="rounded p-1.5 text-tinta-3 hover:text-grave"
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </div>
          ))}

          {datos.empaques.length === 0 && (
            <p className="rounded border border-dashed border-linea-2 p-4 text-center
                          text-[13px] text-tinta-3">
              Agrega al menos una forma de venta con precio.
            </p>
          )}
        </div>
      </section>

      {!esNuevo && (
        <section className="max-w-3xl rounded-lg border border-linea bg-panel p-5">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
            <Barcode size={16} aria-hidden />
            Códigos de barras
          </h3>
          <p className="mb-3 text-[13px] text-tinta-3">
            Pasa el lector por el producto una sola vez y queda asociado. Después el
            escáner lo encuentra solo en la caja.
          </p>

          <div className="flex flex-wrap gap-2">
            {(datos.codigos_barras ?? []).map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 rounded border
                                       border-linea-2 py-1 pl-2 pr-1 text-[12px] text-tinta-2">
                <span className="cifra">{c}</span>
                <button
                  type="button"
                  onClick={() => { void quitarCodigo(c); }}
                  aria-label={`Quitar el codigo ${c}`}
                  className="rounded p-0.5 text-tinta-3 hover:text-grave"
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              ref={campoCodigo}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void escanear(); } }}
              placeholder="Pasa el lector aquí…"
              aria-label="Código de barras"
              className="cifra flex-1 rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                         outline-none placeholder:font-sans placeholder:text-[13px]
                         focus:border-acento"
            />
            <button
              type="button"
              onClick={() => { void escanear(); }}
              disabled={codigo.trim() === ''}
              className="rounded border border-linea-2 px-3 py-2 text-[13px] font-semibold
                         text-tinta-2 hover:border-acento disabled:opacity-50"
            >
              Asociar
            </button>
          </div>
        </section>
      )}

      {!esNuevo && datos.id !== null && puede('costo.ver') && (
        <section className="max-w-3xl rounded-lg border border-linea bg-panel p-5">
          <button
            type="button"
            onClick={() => setVerPrecios((v) => !v)}
            aria-expanded={verPrecios}
            className="flex items-center gap-2 text-sm font-bold hover:text-acento"
          >
            <Truck size={16} aria-hidden />
            Precios de proveedor
          </button>
          <p className="mt-1 text-[13px] text-tinta-3">
            A cuánto te lo vende cada uno, con el más barato marcado. Se llena solo
            al registrar compras.
          </p>
          {verPrecios && (
            <div className="mt-3">
              <PreciosProveedor productoId={datos.id} />
            </div>
          )}
        </section>
      )}

      {!esNuevo && datos.id !== null && puede('producto.precio') && (
        <section className="max-w-3xl rounded-lg border border-linea bg-panel p-5">
          <h3 className="text-sm font-bold">Precio por unos días</h3>
          <p className="mb-3 mt-0.5 text-[13px] text-tinta-3">
            Para una promoción o un alza temporal. El precio de siempre no se toca:
            cuando la fecha pase, vuelve solo.
          </p>
          <PrecioEspecial
            productoId={datos.id}
            precioNormal={datos.precio_venta}
            empaques={datos.empaques.map((e) => ({
              id: e.id,
              nombre: e.nombre,
              precio_venta: e.precio_venta,
            }))}
          />
        </section>
      )}

      {!esNuevo && datos.id !== null && (
        <section className="max-w-3xl rounded-lg border border-linea bg-panel p-5">
          <button
            type="button"
            onClick={() => setVerHistorial((v) => !v)}
            aria-expanded={verHistorial}
            className="flex items-center gap-2 text-sm font-bold hover:text-acento"
          >
            <History size={16} aria-hidden />
            Historial de este producto
          </button>
          <p className="mt-1 text-[13px] text-tinta-3">
            Todo lo que le pasó: ventas, compras, ajustes. Es donde se ve de dónde
            salió la existencia cuando el conteo no cuadra.
          </p>
          {verHistorial && (
            <div className="mt-3">
              <Kardex
                productoId={datos.id}
                onCambio={(existencia) => {
                  setDatos((d) => ({ ...d, existencia }));
                  onRefrescar();
                }}
              />
            </div>
          )}
        </section>
      )}

      {datos.id !== null && (
        <section className="max-w-3xl rounded-lg border border-linea bg-panel p-5">
          <button
            type="button"
            onClick={() => setVerPreciosViejos((v) => !v)}
            aria-expanded={verPreciosViejos}
            className="flex items-center gap-2 text-sm font-bold hover:text-acento"
          >
            <TrendingUp size={16} aria-hidden />
            Cómo ha cambiado el precio
          </button>
          <p className="mt-1 text-[13px] text-tinta-3">
            Cuándo lo subiste o lo bajaste, y de cuánto a cuánto. Lo que ya se
            vendió no cambia: cada venta guarda el precio con el que se cobró.
          </p>
          {verPreciosViejos && (
            <div className="mt-3">
              <HistorialPrecios productoId={datos.id} />
            </div>
          )}
        </section>
      )}

      <footer className="flex max-w-3xl flex-wrap gap-2 border-t border-linea pt-4">
        <button
          type="button"
          onClick={() => { void guardar(); }}
          disabled={guardando || falta}
          className="inline-flex items-center gap-2 rounded bg-acento px-4 py-2.5 text-sm
                     font-bold text-sobre-acento hover:bg-acento-fuerte
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          {guardando ? <Package size={16} className="animate-pulse" aria-hidden />
                     : <Check size={16} aria-hidden />}
          {guardando ? 'Guardando…' : esNuevo ? 'Crear producto' : 'Guardar cambios'}
        </button>

        {/* Un botón apagado sin explicación deja al dueño tocándolo sin
            entender: dice qué falta. */}
        {falta && (
          <span className="self-center text-[12px] text-tinta-3">
            {sinNombre ? 'Ponle un nombre.'
              : sinCategoria ? 'Elige una categoría.'
                : 'Necesita al menos una forma de venta con precio.'}
          </span>
        )}

        <button
          type="button"
          onClick={onCerrar}
          className="rounded border border-linea-2 px-4 py-2.5 text-sm font-semibold
                     text-tinta-2 hover:bg-panel-2"
        >
          Cancelar
        </button>

        {!esNuevo && puede('producto.desactivar') && (
          <>
            <span className="flex-1" />
            {confirmandoBaja ? (
              <span className="flex items-center gap-2">
                <span className="text-[13px] text-tinta-2">
                  Dejará de aparecer en la caja. ¿Seguro?
                </span>
                <button
                  type="button"
                  onClick={() => { void desactivar(); }}
                  className="rounded bg-grave px-3 py-2 text-[13px] font-semibold text-sobre-grave"
                >
                  Sí, desactivar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmandoBaja(false)}
                  className="text-[13px] font-semibold text-tinta-3 hover:text-tinta"
                >
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmandoBaja(true)}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold
                           text-tinta-3 hover:text-grave"
              >
                <TrendingDown size={14} aria-hidden />
                Desactivar producto
              </button>
            )}
          </>
        )}
      </footer>
    </div>
  );
}

function Campo({
  etiqueta, valor, onChange, ayuda, autoFocus = false,
}: {
  readonly etiqueta: string;
  readonly valor: string;
  readonly onChange: (valor: string) => void;
  readonly ayuda?: string;
  readonly autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-tinta-2">{etiqueta}</span>
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                   focus:border-acento"
      />
      {ayuda !== undefined && <span className="text-[12px] text-tinta-3">{ayuda}</span>}
    </label>
  );
}

function CampoNumero({
  etiqueta, valor, onChange, ayuda, soloLectura = false,
}: {
  readonly etiqueta: string;
  readonly valor: number;
  readonly onChange: (valor: number) => void;
  // `| undefined` explicito: con exactOptionalPropertyTypes activo, pasar
  // undefined a una prop opcional no es lo mismo que omitirla.
  readonly ayuda?: string | undefined;
  readonly soloLectura?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-tinta-2">{etiqueta}</span>
      <span className="flex items-center gap-2">
        <input
          inputMode="numeric"
          value={valor || ''}
          readOnly={soloLectura}
          onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
          className={`cifra w-32 rounded border border-linea-2 px-3 py-2 text-right text-sm
                      outline-none focus:border-acento ${
                        soloLectura ? 'bg-panel-2 text-tinta-3' : 'bg-panel'}`}
        />
        <span className="cifra text-[13px] text-tinta-3">{pesos(valor)}</span>
      </span>
      {ayuda !== undefined && <span className="text-[12px] text-tinta-3">{ayuda}</span>}
    </label>
  );
}
