/**
 * Reportes.
 *
 * Un solo lugar con todos: se elige cuál y el período, y sale la tabla.
 * Cualquiera se exporta a Excel con el mismo botón, porque todos
 * comparten la misma forma de columnas y filas.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { Download, FileBarChart, Printer } from 'lucide-react';

import { Periodo, hoyLocal, inicioDeMes } from '@/compartido/componentes/Periodo';
import { fechaCorta, pesos } from '@/compartido/utilidades/formato';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';
import { generarExcel, nombreArchivo } from './exportar';
import type { ColumnaExportable } from './exportar';
import { generarImpresion, imprimir } from './imprimir';

interface DefinicionReporte {
  readonly id: string;
  readonly nombre: string;
  readonly comando: string;
  readonly columnas: readonly ColumnaExportable[];
  /** Permiso que hace falta. */
  readonly permiso: string;
}

const REPORTES: readonly DefinicionReporte[] = [
  {
    id: 'dia', nombre: 'Ventas por día', comando: 'reporte_ventas_por_dia',
    permiso: 'reporte.operacion',
    columnas: [
      { clave: 'fecha', titulo: 'Fecha' },
      { clave: 'ventas', titulo: 'Ventas', esNumero: true },
      { clave: 'unidades', titulo: 'Unidades', esNumero: true },
      { clave: 'total', titulo: 'Total', esDinero: true },
    ],
  },
  {
    id: 'producto', nombre: 'Ventas por producto', comando: 'reporte_ventas_por_producto',
    permiso: 'reporte.operacion',
    columnas: [
      { clave: 'producto', titulo: 'Producto' },
      { clave: 'presentacion', titulo: 'Presentación' },
      { clave: 'categoria', titulo: 'Categoría' },
      { clave: 'unidades', titulo: 'Unidades', esNumero: true },
      { clave: 'total', titulo: 'Total', esDinero: true },
      { clave: 'utilidad', titulo: 'Utilidad', esDinero: true },
    ],
  },
  {
    id: 'categoria', nombre: 'Ventas por categoría', comando: 'reporte_ventas_por_categoria',
    permiso: 'reporte.operacion',
    columnas: [
      { clave: 'categoria', titulo: 'Categoría' },
      { clave: 'unidades', titulo: 'Unidades', esNumero: true },
      { clave: 'total', titulo: 'Total', esDinero: true },
      { clave: 'participacion', titulo: '% del total', esNumero: true },
    ],
  },
  {
    id: 'usuario', nombre: 'Ventas por usuario', comando: 'reporte_ventas_por_usuario',
    permiso: 'reporte.operacion',
    columnas: [
      { clave: 'usuario', titulo: 'Usuario' },
      { clave: 'ventas', titulo: 'Ventas', esNumero: true },
      { clave: 'total', titulo: 'Total', esDinero: true },
      { clave: 'anuladas', titulo: 'Anuladas', esNumero: true },
    ],
  },
  {
    id: 'cierres', nombre: 'Cierres de caja', comando: 'reporte_cierres_de_caja',
    permiso: 'caja.ver_todas',
    columnas: [
      { clave: 'apertura', titulo: 'Apertura' },
      { clave: 'usuario', titulo: 'Responsable' },
      { clave: 'base_inicial', titulo: 'Base', esDinero: true },
      { clave: 'esperado', titulo: 'Esperado', esDinero: true },
      { clave: 'contado', titulo: 'Contado', esDinero: true },
      { clave: 'diferencia', titulo: 'Diferencia', esDinero: true },
      { clave: 'observaciones', titulo: 'Observaciones' },
    ],
  },
];

export function Reportes() {
  const { usuario, puede, nombreNegocio } = useSesion();
  const disponibles = useMemo(
    () => REPORTES.filter((r) => puede(r.permiso)),
    [puede],
  );

  const [elegido, setElegido] = useState(disponibles[0]?.id ?? 'dia');
  const [desde, setDesde] = useState(inicioDeMes());
  const [hasta, setHasta] = useState(hoyLocal());
  const [filas, setFilas] = useState<readonly Record<string, unknown>[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const definicion = disponibles.find((r) => r.id === elegido) ?? disponibles[0];

  const consultar = useCallback(async () => {
    if (definicion === undefined || usuario === null) return;
    setCargando(true);
    setAviso(null);
    try {
      setFilas(await pedir<Record<string, unknown>[]>(definicion.comando, {
        periodo: { desde, hasta, rol: usuario.rol },
      }));
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }, [definicion, desde, hasta, usuario]);

  useEffect(() => { void consultar(); }, [consultar]);

  async function exportar() {
    if (definicion === undefined || filas.length === 0) return;
    setAviso(null);
    try {
      const ruta = await save({
        defaultPath: nombreArchivo(definicion.nombre, desde, hasta),
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (ruta === null) return;

      await writeFile(ruta, await generarExcel(definicion.nombre, definicion.columnas, filas));
      setAviso(`Se guardó en ${ruta}`);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  function imprimirReporte() {
    if (definicion === undefined || filas.length === 0) return;
    imprimir(generarImpresion({
      negocio: nombreNegocio,
      reporte: definicion.nombre,
      desde,
      hasta,
      columnas: definicion.columnas.map((c) => ({
        titulo: c.titulo,
        ...(c.esDinero === true ? { esDinero: true } : {}),
        ...(c.esNumero === true ? { esNumero: true } : {}),
      })),
      filas: filas.map((f) => definicion.columnas.map((c) => celda(c, f[c.clave]))),
    }));
  }

  /** Las columnas de dinero se muestran con formato; el resto tal cual. */
  function celda(columna: ColumnaExportable, valor: unknown) {
    if (valor === null || valor === undefined || valor === '') return '—';

    if (columna.esDinero === true && typeof valor === 'number') {
      // El signo va antes del peso: «$-2.000» se lee como un error de
      // impresion, y en la columna de diferencias es justo donde importa.
      return valor < 0 ? `−${pesos(Math.abs(valor))}` : pesos(valor);
    }

    if (columna.clave === 'participacion') return `${String(valor)} %`;

    // Las fechas llegan del nucleo como «2026-08-08» y aqui se leen como
    // en el resto del programa. Ademas evita el desfase de un dia: ese
    // formato lo interpreta JavaScript como medianoche UTC.
    if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      return fechaCorta(valor);
    }

    return String(valor);
  }

  if (definicion === undefined) {
    return <p className="p-6 text-sm text-tinta-2">No tienes reportes disponibles.</p>;
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <header>
        <h2 className="text-xl font-bold tracking-tight">Reportes</h2>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-tinta-2">Reporte</span>
          <select
            value={elegido}
            onChange={(e) => setElegido(e.target.value)}
            className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                       focus:border-acento"
          >
            {disponibles.map((r) => (
              <option key={r.id} value={r.id}>{r.nombre}</option>
            ))}
          </select>
        </label>

        <Periodo
          desde={desde}
          hasta={hasta}
          onCambio={(r) => { setDesde(r.desde); setHasta(r.hasta); }}
        />

        <button
          type="button"
          onClick={() => { void exportar(); }}
          disabled={filas.length === 0}
          className="inline-flex items-center gap-2 rounded border border-linea-2 px-3 py-2
                     text-sm font-semibold text-tinta-2 hover:border-acento hover:text-acento
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={15} aria-hidden />
          Exportar a Excel
        </button>

        <button
          type="button"
          onClick={imprimirReporte}
          disabled={filas.length === 0}
          className="inline-flex items-center gap-2 rounded border border-linea-2 px-3 py-2
                     text-sm font-semibold text-tinta-2 hover:border-acento hover:text-acento
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Printer size={15} aria-hidden />
          Imprimir o guardar en PDF
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="rounded-lg border border-grave/30 bg-grave-suave px-4 py-2.5
                                   text-sm text-grave">
          {error}
        </p>
      )}
      {aviso !== null && (
        <p className="rounded-lg border border-bien/30 bg-bien-suave px-4 py-2.5 text-sm
                      text-tinta-2">
          {aviso}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-linea">
        {cargando ? (
          <p className="p-6 text-sm text-tinta-3">Consultando…</p>
        ) : filas.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <FileBarChart size={22} className="text-tinta-3" aria-hidden />
            <p className="text-sm text-tinta-2">
              No hay movimientos en este período.
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 bg-panel-2">
              <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
                {definicion.columnas.map((c) => (
                  <th
                    key={c.clave}
                    className={`px-3 py-2.5 font-semibold ${
                      c.esDinero === true || c.esNumero === true ? 'text-right' : ''}`}
                  >
                    {c.titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => (
                <tr key={i} className="border-t border-linea bg-panel">
                  {definicion.columnas.map((c) => (
                    <td
                      key={c.clave}
                      className={`px-3 py-2 ${
                        c.esDinero === true || c.esNumero === true
                          ? 'cifra text-right' : 'text-tinta-2'}`}
                    >
                      {celda(c, fila[c.clave])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {filas.length > 0 && (
        <p className="text-[12px] text-tinta-3">
          <span className="cifra">{filas.length}</span>{' '}
          {filas.length === 1 ? 'fila' : 'filas'}
        </p>
      )}
    </div>
  );
}
