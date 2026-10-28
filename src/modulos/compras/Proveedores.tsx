/**
 * Los proveedores del negocio.
 *
 * Faltaba por completo: se podia comprarles y ver sus precios, pero no
 * habia forma de dar de alta uno nuevo. Quien estrena el programa no
 * tiene ninguno, y sin proveedor no se puede registrar una compra.
 */

import { useCallback, useEffect, useState } from 'react';
import { Phone, Plus, RotateCcw, Truck, User, X } from 'lucide-react';

import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';

interface Proveedor {
  readonly id: number;
  readonly nombre: string;
  readonly nit: string | null;
  readonly telefono: string | null;
  readonly contacto: string | null;
  readonly direccion: string | null;
  readonly notas: string | null;
  readonly activo: boolean;
  readonly productos: number;
}

const EN_BLANCO = {
  id: null as number | null,
  nombre: '', nit: '', telefono: '', contacto: '', direccion: '', notas: '',
};

type Formulario = typeof EN_BLANCO;

function Campo({
  etiqueta, valor, onChange, ayuda, autoFocus,
}: {
  readonly etiqueta: string;
  readonly valor: string;
  readonly onChange: (v: string) => void;
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

export function Proveedores({ onCerrar }: { readonly onCerrar: () => void }) {
  const { usuario, puede } = useSesion();
  const [lista, setLista] = useState<readonly Proveedor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [formulario, setFormulario] = useState<Formulario | null>(null);
  const [guardando, setGuardando] = useState(false);

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      setLista(await pedir<Proveedor[]>('listar_proveedores'));
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void recargar(); }, [recargar]);

  async function guardar() {
    if (formulario === null || usuario === null) return;
    setGuardando(true);
    try {
      await pedir('guardar_proveedor', {
        proveedor: {
          id: formulario.id,
          nombre: formulario.nombre,
          nit: formulario.nit,
          telefono: formulario.telefono,
          contacto: formulario.contacto,
          direccion: formulario.direccion,
          notas: formulario.notas,
        },
        usuarioId: usuario.id,
        rol: usuario.rol,
      });
      setFormulario(null);
      await recargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarActivo(p: Proveedor) {
    if (usuario === null) return;
    try {
      await pedir('desactivar_proveedor', {
        proveedorId: p.id, activo: !p.activo,
        usuarioId: usuario.id, rol: usuario.rol,
      });
      await recargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  if (formulario !== null) {
    const cambiar = (campo: keyof Formulario, valor: string) =>
      setFormulario((f) => (f === null ? f : { ...f, [campo]: valor }));

    return (
      <div className="flex max-w-xl flex-col gap-4">
        <h2 className="text-lg font-bold tracking-tight">
          {formulario.id === null ? 'Nuevo proveedor' : 'Datos del proveedor'}
        </h2>

        {error !== null && (
          <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3
                                     py-2 text-sm text-grave">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3.5 rounded-lg border border-linea bg-panel p-5">
          <Campo etiqueta="Nombre" valor={formulario.nombre} autoFocus
                 onChange={(v) => cambiar('nombre', v)} />
          <Campo etiqueta="Teléfono" valor={formulario.telefono}
                 onChange={(v) => cambiar('telefono', v)}
                 ayuda="El que marcas para hacer el pedido." />
          <Campo etiqueta="Quién te atiende" valor={formulario.contacto}
                 onChange={(v) => cambiar('contacto', v)} />
          <Campo etiqueta="NIT o documento" valor={formulario.nit}
                 onChange={(v) => cambiar('nit', v)} />
          <Campo etiqueta="Dirección" valor={formulario.direccion}
                 onChange={(v) => cambiar('direccion', v)} />
          <Campo etiqueta="Notas" valor={formulario.notas}
                 onChange={(v) => cambiar('notas', v)}
                 ayuda="Días que pasa, condiciones de pago, lo que sea útil recordar." />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { void guardar(); }}
            disabled={formulario.nombre.trim() === '' || guardando}
            className="rounded bg-acento px-4 py-2.5 text-sm font-bold text-sobre-acento
                       hover:bg-acento-fuerte disabled:cursor-not-allowed disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            onClick={() => { setFormulario(null); setError(null); }}
            disabled={guardando}
            className="rounded border border-linea-2 px-4 py-2.5 text-sm font-semibold
                       text-tinta-2 hover:bg-panel-2 disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Proveedores</h2>
          <p className="mt-0.5 text-[13px] text-tinta-2">
            A quién le compras. Hacen falta para registrar una compra.
          </p>
        </div>
        <div className="flex gap-2">
          {puede('proveedor.gestionar') && (
            <button
              type="button"
              onClick={() => { setFormulario({ ...EN_BLANCO }); setError(null); }}
              className="inline-flex items-center gap-1.5 rounded bg-acento px-3 py-2
                         text-[13px] font-bold text-sobre-acento hover:bg-acento-fuerte"
            >
              <Plus size={15} aria-hidden />
              Nuevo proveedor
            </button>
          )}
          <button
            type="button"
            onClick={onCerrar}
            className="rounded border border-linea-2 px-3 py-2 text-[13px] font-semibold
                       text-tinta-2 hover:bg-panel-2"
          >
            Volver
          </button>
        </div>
      </header>

      {error !== null && (
        <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3 py-2
                                   text-sm text-grave">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="text-sm text-tinta-3">Cargando…</p>
      ) : lista.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed
                        border-linea-2 py-12 text-center">
          <Truck size={22} className="text-tinta-3" aria-hidden />
          <p className="max-w-sm text-sm text-tinta-2">
            Todavía no tienes proveedores. Agrega el primero para poder registrar
            las compras y saber quién te vende más barato.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5 overflow-y-auto">
          {lista.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-lg border border-linea bg-panel p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.nombre}</div>
                <div className="mt-0.5 flex flex-wrap gap-3 text-[12px] text-tinta-3">
                  {p.telefono !== null && (
                    <span className="inline-flex items-center gap-1">
                      <Phone size={11} aria-hidden />{p.telefono}
                    </span>
                  )}
                  {p.contacto !== null && (
                    <span className="inline-flex items-center gap-1">
                      <User size={11} aria-hidden />{p.contacto}
                    </span>
                  )}
                  <span>
                    {p.productos === 0
                      ? 'sin compras registradas'
                      : `${p.productos} ${p.productos === 1 ? 'producto' : 'productos'}`}
                  </span>
                </div>
              </div>

              {puede('proveedor.gestionar') && (
                <>
                  <button
                    type="button"
                    onClick={() => setFormulario({
                      id: p.id, nombre: p.nombre, nit: p.nit ?? '',
                      telefono: p.telefono ?? '', contacto: p.contacto ?? '',
                      direccion: p.direccion ?? '', notas: p.notas ?? '',
                    })}
                    className="rounded border border-linea-2 px-2.5 py-1 text-[12px]
                               font-semibold text-tinta-2 hover:border-acento
                               hover:text-acento"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => { void cambiarActivo(p); }}
                    aria-label={p.activo
                      ? `Retirar a ${p.nombre}`
                      : `Volver a trabajar con ${p.nombre}`}
                    className="rounded p-1.5 text-tinta-3 hover:text-acento"
                  >
                    {p.activo
                      ? <X size={15} aria-hidden />
                      : <RotateCcw size={15} aria-hidden />}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
