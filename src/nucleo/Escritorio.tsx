/**
 * Estructura de la aplicacion con sesion iniciada.
 *
 * Barra lateral con los modulos, barra superior con quien esta dentro, y
 * el contenido en el centro. Siempre igual en todas las pantallas: el
 * usuario nunca deberia sentir que cambio de aplicacion.
 */

import { useState } from 'react';
import {
  BarChart3, Boxes, Calculator, CircleHelp, LayoutDashboard, LogOut, Receipt,
  HandCoins, Settings, ShoppingCart, Truck, Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Caja } from '@/modulos/pos/Caja';
import { Inventario } from '@/modulos/inventario/Inventario';
import { Tablero } from '@/modulos/dashboard/Tablero';
import { Reportes } from '@/modulos/reportes/Reportes';
import { Configuracion } from '@/modulos/configuracion/Configuracion';
import { Compras } from '@/modulos/compras/Compras';
import { Creditos } from '@/modulos/creditos/Creditos';
import { HistorialVentas } from '@/modulos/reportes/HistorialVentas';
import { Gastos } from '@/modulos/reportes/Gastos';
import { EstadoResultados } from '@/modulos/reportes/EstadoResultados';
import { useSesion } from './sesion';
import { Salvavidas } from './Salvavidas';
import { Reloj } from '@/compartido/componentes/Reloj';
import { Ayuda } from '@/modulos/ayuda/Ayuda';

type Modulo =
  | 'tablero' | 'caja' | 'ventas' | 'inventario'
  | 'compras' | 'creditos' | 'reportes' | 'resultados' | 'gastos'
  | 'configuracion' | 'ayuda';

/** Cómo se llama cada módulo cuando hay que nombrarlo en un aviso. */
const NOMBRE_MODULO: Readonly<Record<Modulo, string>> = {
  tablero: 'Resumen',
  caja: 'Caja',
  ventas: 'Ventas',
  inventario: 'Inventario',
  compras: 'Compras',
  creditos: 'Créditos',
  reportes: 'Reportes',
  resultados: 'Resultados',
  gastos: 'Gastos',
  configuracion: 'Configuración',
  ayuda: 'Ayuda',
};

interface EntradaMenu {
  readonly id: Modulo;
  readonly nombre: string;
  readonly icono: LucideIcon;
  /** Permiso que hace falta para verlo. */
  readonly permiso: string;
}

const MENU: readonly EntradaMenu[] = [
  { id: 'tablero', nombre: 'Resumen', icono: LayoutDashboard, permiso: 'reporte.operacion' },
  { id: 'caja', nombre: 'Caja', icono: ShoppingCart, permiso: 'venta.crear' },
  { id: 'ventas', nombre: 'Ventas', icono: Receipt, permiso: 'venta.crear' },
  { id: 'inventario', nombre: 'Inventario', icono: Boxes, permiso: 'inventario.ver' },
  { id: 'compras', nombre: 'Compras', icono: Truck, permiso: 'compra.registrar' },
  { id: 'creditos', nombre: 'Créditos', icono: HandCoins, permiso: 'venta.crear' },
  { id: 'reportes', nombre: 'Reportes', icono: BarChart3, permiso: 'reporte.operacion' },
  { id: 'resultados', nombre: 'Resultados', icono: Calculator, permiso: 'reporte.financiero' },
  { id: 'gastos', nombre: 'Gastos', icono: Wallet, permiso: 'reporte.financiero' },
  { id: 'configuracion', nombre: 'Configuración', icono: Settings, permiso: 'config.editar' },
];

export function Escritorio() {
  const { usuario, nombreNegocio, puede, salir } = useSesion();
  // El cajero entra directo a la caja; quien ve reportes entra al resumen.
  const [activo, setActivo] = useState<Modulo>(
    puede('reporte.operacion') ? 'tablero' : 'caja',
  );

  const visibles = MENU.filter((m) => puede(m.permiso));

  return (
    <div className="grid h-full grid-cols-[210px_1fr] bg-fondo">
      <nav aria-label="Módulos" className="flex flex-col border-r border-linea bg-panel">
        <div className="border-b border-linea px-4 py-4">
          <div className="truncate font-bold tracking-tight">{nombreNegocio}</div>
          <div className="mt-0.5 truncate text-[12px] text-tinta-3">
            {usuario?.nombre} · {usuario?.rol}
          </div>
          {/* Aqui y no flotando sobre el contenido: alla tapaba los
              botones de arriba a la derecha de inventario y compras. La
              barra tiene su propia columna y nunca se cruza con nada. */}
          <div className="mt-3 border-t border-linea pt-2.5">
            <Reloj />
          </div>
        </div>

        <ul className="flex flex-1 flex-col gap-0.5 p-2">
          {visibles.map(({ id, nombre, icono: Icono }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setActivo(id)}
                aria-current={activo === id ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded px-3 py-2.5 text-sm
                  font-semibold ${activo === id
                    ? 'bg-acento-suave text-acento'
                    : 'text-tinta-2 hover:bg-panel-2'}`}
              >
                <Icono size={17} aria-hidden />
                {nombre}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-0.5 border-t border-linea p-2">
          <button
            type="button"
            onClick={() => setActivo('ayuda')}
            aria-current={activo === 'ayuda' ? 'page' : undefined}
            className={`flex w-full items-center gap-2.5 rounded px-3 py-2.5 text-sm
                       font-semibold ${activo === 'ayuda'
                         ? 'bg-acento-suave text-acento'
                         : 'text-tinta-2 hover:bg-panel-2'}`}
          >
            <CircleHelp size={17} aria-hidden />
            Ayuda
          </button>

          <button
            type="button"
            onClick={() => { void salir(); }}
            className="flex w-full items-center gap-2.5 rounded px-3 py-2.5 text-sm
                       font-semibold text-tinta-2 hover:bg-panel-2"
          >
            <LogOut size={17} aria-hidden />
            Salir
          </button>
        </div>
      </nav>

      {/* Cada módulo va dentro de su propio salvavidas y no todos bajo
          uno solo: si se rompe Reportes, la caja tiene que seguir
          cobrando. La clave hace que cambiar de módulo empiece de cero,
          en vez de arrastrar el error del anterior. */}
      <main className="min-h-0 overflow-hidden p-4">
        <Salvavidas key={activo} nombre={NOMBRE_MODULO[activo]}>
          {activo === 'tablero' && <Tablero />}
          {activo === 'caja' && <Caja />}
          {activo === 'ventas' && <HistorialVentas />}
          {activo === 'inventario' && <Inventario />}
          {activo === 'reportes' && <Reportes />}
          {activo === 'resultados' && <EstadoResultados />}
          {activo === 'gastos' && <Gastos />}
          {activo === 'configuracion' && <Configuracion />}
          {activo === 'compras' && <Compras />}
          {activo === 'creditos' && <Creditos />}
          {activo === 'ayuda' && <Ayuda />}
        </Salvavidas>
      </main>
    </div>
  );
}
