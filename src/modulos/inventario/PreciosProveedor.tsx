/**
 * A cuánto vende cada proveedor este producto.
 *
 * Reemplaza la matriz de proveedores que el negocio tenía en el Excel, y
 * responde la pregunta que uno hace de verdad antes de pedir: quién lo
 * tiene más barato hoy.
 *
 * Se llena solo al registrar compras: cada vez que se recibe mercancía,
 * el sistema anota a qué precio la vendió ese proveedor.
 */

import { useEffect, useState } from 'react';
import { Truck } from 'lucide-react';

import { fechaCorta, pesos } from '@/compartido/utilidades/formato';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';

interface PrecioProveedor {
  readonly proveedor: string;
  readonly empaque: string | null;
  /** Lo que cobra por el empaque completo. */
  readonly precio: number;
  /** Lo que sale cada unidad. Es lo que se compara. */
  readonly precio_unitario: number;
  readonly fecha: string;
  /** El más barato por unidad. Puede haber varios si empatan. */
  readonly mejor: boolean;
}

export function PreciosProveedor({ productoId }: { readonly productoId: number }) {
  const { usuario } = useSesion();
  const [precios, setPrecios] = useState<readonly PrecioProveedor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (usuario === null) return;
    setCargando(true);
    pedir<PrecioProveedor[]>('precios_de_producto', { productoId, rol: usuario.rol })
      .then(setPrecios)
      .catch((causa: unknown) => setError(mensajeDeError(causa)))
      .finally(() => setCargando(false));
  }, [productoId, usuario]);

  if (error !== null) {
    return (
      <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3 py-2
                                 text-sm text-grave">
        {error}
      </p>
    );
  }

  if (cargando) {
    return <p className="p-4 text-sm text-tinta-3">Consultando…</p>;
  }

  if (precios.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Truck size={20} className="text-tinta-3" aria-hidden />
        <p className="max-w-xs text-sm text-tinta-3">
          Todavía no hay precios de proveedor. Se van llenando solos cada vez que
          registras una compra.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-linea">
      <table className="w-full min-w-[520px] text-sm">
        <caption className="px-3 py-2 text-left text-[12px] text-tinta-3">
          Se compara por lo que sale cada unidad, no por el precio del empaque:
          una canasta siempre va a costar más que una botella suelta.
        </caption>
        <thead className="bg-panel-2">
          <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
            <th className="px-3 py-2 font-semibold">Proveedor</th>
            <th className="px-3 py-2 font-semibold">Empaque</th>
            <th className="px-3 py-2 text-right font-semibold">Precio</th>
            <th className="px-3 py-2 text-right font-semibold">Cada unidad</th>
            <th className="px-3 py-2 font-semibold">Última compra</th>
          </tr>
        </thead>
        <tbody>
          {precios.map((p, i) => (
            <tr
              key={`${p.proveedor}-${i}`}
              className={`border-t border-linea ${p.mejor ? 'bg-bien-suave' : 'bg-panel'}`}
            >
              <td className="px-3 py-2 font-semibold">
                {p.proveedor}
                {p.mejor && (
                  <span className="ml-2 rounded bg-bien px-1.5 py-0.5 text-[10px]
                                   font-semibold uppercase tracking-wide text-sobre-bien">
                    más barato
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-tinta-2">{p.empaque ?? 'Unidad'}</td>
              <td className="cifra px-3 py-2 text-right text-tinta-2">{pesos(p.precio)}</td>
              <td className="cifra px-3 py-2 text-right font-semibold">
                {pesos(p.precio_unitario)}
              </td>
              <td className="cifra px-3 py-2 text-[12px] text-tinta-3">
                {fechaCorta(p.fecha)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
