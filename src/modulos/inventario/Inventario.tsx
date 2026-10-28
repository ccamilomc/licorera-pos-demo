/**
 * Inventario: el catalogo del negocio y la carga desde Excel.
 *
 * Aqui es donde el dueño ve lo que tiene, encuentra lo que se esta
 * acabando y atiende los productos que la importacion dejo señalados.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { AlertTriangle, FileSpreadsheet, PackageX, Plus, Search } from 'lucide-react';

import { paraBuscar, pesos } from '@/compartido/utilidades/formato';
import { distintivos } from '@/compartido/utilidades/homonimos';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';
import { VistaPreviaImportacion } from '@/modulos/excel/componentes/VistaPreviaImportacion';
import { planParaNucleo, prepararImportacion } from '@/modulos/excel/importador';
import type { PlanImportacion, ProductoExistente } from '@/modulos/excel/planificador';
import { EditarProducto } from './EditarProducto';
import type { ProductoFicha } from './EditarProducto';

interface ProductoEnLista {
  readonly id: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly marca: string | null;
  readonly presentacion: string;
  readonly volumen_ml: number | null;
  readonly envase: string | null;
  readonly unidad_base: string;
  readonly existencia: number;
  readonly precio_venta: number;
  readonly stock_minimo: number;
  readonly stock_maximo: number | null;
  readonly revisar: boolean;
  readonly revisar_motivo: string | null;
  readonly empaques: readonly {
    id: number; nombre: string; factor: number;
    precio_venta: number | null; predeterminado: boolean;
  }[];
  readonly codigos_barras: readonly string[];
}

/**
 * Ficha en blanco para dar de alta un producto.
 *
 * El stock mínimo sale de Configuración: ahí se ofrece como «se aplica a
 * los productos nuevos», y antes era un tres fijo que ignoraba lo que el
 * dueño hubiera puesto.
 */
function fichaNueva(stockMinimo: number): ProductoFicha {
  return {
    id: null, codigo: '', nombre: '', categoria: '', marca: null,
    presentacion: '', volumen_ml: null, envase: null, unidad_base: 'UNIDAD',
    precio_venta: 0, stock_minimo: stockMinimo, stock_maximo: null, notas: null,
    empaques: [{
      id: null, nombre: 'Unidad', factor: 1, precio_venta: null,
      para_venta: true, para_compra: true, predeterminado: true,
    }],
  };
}

interface Resumen {
  readonly productos: number;
  readonly unidades: number;
  /** Solo llega a quien puede ver costos. */
  readonly valorizado_costo: number | null;
  readonly valorizado_venta: number;
  readonly agotados: number;
  readonly bajo_minimo: number;
  readonly por_revisar: number;
}

type Filtro = 'todos' | 'agotados' | 'bajo_minimo' | 'revisar';

export function Inventario() {
  const { usuario, puede, stockMinimoDefecto } = useSesion();
  const [productos, setProductos] = useState<readonly ProductoEnLista[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [consulta, setConsulta] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const [plan, setPlan] = useState<PlanImportacion | null>(null);
  const [editando, setEditando] = useState<ProductoFicha | null>(null);
  const [importando, setImportando] = useState(false);

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      const [lista, totales] = await Promise.all([
        pedir<ProductoEnLista[]>('listar_productos'),
        pedir<Resumen>('resumen_inventario', { rol: usuario?.rol }),
      ]);
      setProductos(lista);
      setResumen(totales);
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void recargar(); }, [recargar]);

  async function elegirExcel() {
    setError(null);
    try {
      const ruta = await open({
        multiple: false,
        filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }],
      });
      if (ruta === null || Array.isArray(ruta)) return;

      const datos = await readFile(ruta);
      const existentes: ProductoExistente[] = productos.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        categoria: p.categoria,
        presentacion: p.presentacion,
        volumenMl: p.volumen_ml,
        envase: p.envase,
        existencia: p.existencia,
        precioVenta: p.precio_venta,
        empaques: p.empaques.map((e) => ({
          nombre: e.nombre, factor: e.factor, precioVenta: e.precio_venta,
        })),
      }));

      setPlan(await prepararImportacion(
        datos.buffer.slice(
          datos.byteOffset, datos.byteOffset + datos.byteLength,
        ) as ArrayBuffer,
        existentes,
      ));
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function aplicarImportacion() {
    if (plan === null || usuario === null) return;
    setImportando(true);
    try {
      await pedir('importar_productos', {
        plan: planParaNucleo(plan),
        usuarioId: usuario.id,
        rol: usuario.rol,
      });
      setPlan(null);
      await recargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setImportando(false);
    }
  }

  function abrirFicha(p: ProductoEnLista) {
    setEditando({
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      categoria: p.categoria,
      marca: p.marca,
      presentacion: p.presentacion,
      volumen_ml: p.volumen_ml,
      envase: p.envase,
      unidad_base: p.unidad_base,
      precio_venta: p.precio_venta,
      stock_minimo: p.stock_minimo,
      stock_maximo: p.stock_maximo,
      notas: null,
      existencia: p.existencia,
      revisar_motivo: p.revisar ? p.revisar_motivo : null,
      codigos_barras: p.codigos_barras,
      empaques: p.empaques.map((e) => ({
        id: e.id, nombre: e.nombre, factor: e.factor,
        precio_venta: e.precio_venta, para_venta: e.precio_venta !== null,
        para_compra: true, predeterminado: e.predeterminado,
      })),
    });
  }

  const visibles = useMemo(() => {
    const texto = paraBuscar(consulta);
    return productos.filter((p) => {
      if (filtro === 'agotados' && p.existencia > 0) return false;
      if (filtro === 'bajo_minimo'
          && !(p.stock_minimo > 0 && p.existencia > 0 && p.existencia <= p.stock_minimo)) {
        return false;
      }
      if (filtro === 'revisar' && !p.revisar) return false;
      if (texto === '') return true;
      return paraBuscar(`${p.nombre} ${p.presentacion} ${p.categoria} ${p.codigo}`)
        .includes(texto);
    });
  }, [productos, consulta, filtro]);

  // Sobre la lista completa y no sobre la filtrada: al ver una sola
  // Margarita sin marca uno creeria que no hay otra.
  const marcas = useMemo(() => distintivos(productos), [productos]);

  if (editando !== null) {
    return (
      <EditarProducto
        ficha={editando}
        onGuardado={() => { setEditando(null); void recargar(); }}
        onRefrescar={() => { void recargar(); }}
        onCerrar={() => setEditando(null)}
      />
    );
  }

  if (plan !== null) {
    return (
      <div className="h-full overflow-y-auto">
        <VistaPreviaImportacion
          plan={plan}
          aplicando={importando}
          onAplicar={() => { void aplicarImportacion(); }}
          onCancelar={() => setPlan(null)}
        />
      </div>
    );
  }

  if (cargando) {
    return <p className="p-6 text-sm text-tinta-3">Cargando el inventario…</p>;
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Inventario</h2>
          {resumen !== null && (
            <p className="mt-0.5 text-sm text-tinta-2">
              <span className="cifra">{resumen.productos}</span> productos ·{' '}
              <span className="cifra">{resumen.unidades}</span> unidades ·{' '}
              <span className="cifra">{pesos(resumen.valorizado_venta)}</span> a precio
              de venta
              {resumen.valorizado_costo !== null && (
                <>
                  {' · '}
                  <span className="cifra">{pesos(resumen.valorizado_costo)}</span> de costo
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
        {puede('producto.crear') && (
          <button
            type="button"
            onClick={() => setEditando(fichaNueva(stockMinimoDefecto))}
            className="inline-flex items-center gap-2 rounded bg-acento px-3 py-2 text-sm
                       font-semibold text-sobre-acento hover:bg-acento-fuerte"
          >
            <Plus size={16} aria-hidden />
            Nuevo producto
          </button>
        )}
        {puede('excel.importar') && (
          <button
            type="button"
            onClick={() => { void elegirExcel(); }}
            className="inline-flex items-center gap-2 rounded border border-linea-2 px-3 py-2
                       text-sm font-semibold text-tinta-2 hover:border-acento hover:text-acento"
          >
            <FileSpreadsheet size={16} aria-hidden />
            Importar desde Excel
          </button>
        )}
        </div>
      </header>

      {error !== null && (
        <p role="alert" className="rounded-lg border border-grave/30 bg-grave-suave px-4 py-2.5
                                   text-sm text-grave">
          {error}
        </p>
      )}

      {resumen !== null && (
        <div className="flex flex-wrap gap-2">
          <Pestana activo={filtro === 'todos'} onClick={() => setFiltro('todos')}>
            Todos <span className="cifra">{resumen.productos}</span>
          </Pestana>
          {resumen.agotados > 0 && (
            <Pestana activo={filtro === 'agotados'} onClick={() => setFiltro('agotados')} tono="grave">
              Agotados <span className="cifra">{resumen.agotados}</span>
            </Pestana>
          )}
          {resumen.bajo_minimo > 0 && (
            <Pestana activo={filtro === 'bajo_minimo'} onClick={() => setFiltro('bajo_minimo')} tono="alerta">
              Bajo mínimo <span className="cifra">{resumen.bajo_minimo}</span>
            </Pestana>
          )}
          {resumen.por_revisar > 0 && (
            <Pestana activo={filtro === 'revisar'} onClick={() => setFiltro('revisar')} tono="alerta">
              Por revisar <span className="cifra">{resumen.por_revisar}</span>
            </Pestana>
          )}
        </div>
      )}

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2
                                     -translate-y-1/2 text-tinta-3" aria-hidden />
        <input
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="Buscar por nombre, categoría o código…"
          aria-label="Buscar en el inventario"
          className="w-full rounded-lg border border-linea-2 bg-panel py-2.5 pl-10 pr-4 text-sm
                     outline-none placeholder:text-tinta-3 focus:border-acento"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-linea">
        {visibles.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <PackageX size={24} className="text-tinta-3" aria-hidden />
            <p className="text-sm text-tinta-2">
              {productos.length === 0
                ? 'Todavía no hay productos. Importa tu Excel para cargarlos.'
                : 'Ningún producto coincide con la búsqueda.'}
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-panel-2">
              <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
                <th className="px-3 py-2.5 font-semibold">Producto</th>
                <th className="px-3 py-2.5 font-semibold">Categoría</th>
                <th className="px-3 py-2.5 text-right font-semibold">Existencia</th>
                <th className="px-3 py-2.5 text-right font-semibold">Precio</th>
                <th className="px-3 py-2.5 font-semibold">Formas de venta</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => abrirFicha(p)}
                  className="cursor-pointer border-t border-linea bg-panel hover:bg-panel-2"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-semibold">{p.nombre}</span>
                      {marcas.has(p.id) && (
                        <span className="shrink-0 rounded bg-acento-suave px-1.5 py-0.5
                                         text-[11px] font-bold text-acento">
                          {marcas.get(p.id)}
                        </span>
                      )}
                    </div>
                    {/* Lo que la marca ya dice no se repite abajo. */}
                    <div className="text-[12px] text-tinta-3">
                      {!marcas.get(p.id)?.includes(p.presentacion) && p.presentacion}
                      {p.envase !== null
                        && !marcas.get(p.id)?.includes(p.envase.toLowerCase())
                        /* «Bolsa · bolsa» se lee como un error del sistema. */
                        && p.envase.toLowerCase() !== p.presentacion.toLowerCase()
                        && `${marcas.has(p.id) ? '' : ' · '}${p.envase.toLowerCase()}`}
                    </div>
                    {p.revisar && p.revisar_motivo !== null && (
                      <div className="mt-1 flex items-start gap-1.5 text-[12px] text-alerta">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
                        <span>{p.revisar_motivo}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-tinta-2">{p.categoria}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`cifra font-semibold ${
                      p.existencia <= 0 ? 'text-grave'
                        : p.stock_minimo > 0 && p.existencia <= p.stock_minimo ? 'text-alerta'
                        : ''}`}
                    >
                      {p.existencia}
                    </span>
                  </td>
                  <td className="cifra px-3 py-2.5 text-right">{pesos(p.precio_venta)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {p.empaques.map((e) => (
                        <span key={e.id} className="cifra rounded border border-linea px-1.5 py-0.5
                                                    text-[11px] text-tinta-2">
                          {e.nombre} ×{e.factor}
                          {e.precio_venta !== null && ` ${pesos(e.precio_venta)}`}
                        </span>
                      ))}
                    </div>
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

function Pestana({
  activo, onClick, children, tono = 'normal',
}: {
  readonly activo: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly tono?: 'normal' | 'alerta' | 'grave';
}) {
  const color = activo
    ? tono === 'grave' ? 'border-grave bg-grave-suave text-grave'
      : tono === 'alerta' ? 'border-alerta bg-alerta-suave text-alerta'
      : 'border-acento bg-acento-suave text-acento'
    : 'border-linea-2 text-tinta-2 hover:border-acento';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`rounded border px-3 py-1.5 text-[13px] font-semibold ${color}`}
    >
      {children}
    </button>
  );
}
