/**
 * Configuración: datos del negocio, parámetros, usuarios, respaldos y
 * auditoría.
 *
 * Se agrupa por lo que el dueño quiere hacer, no por cómo está guardado:
 * las claves de configuración viven en una sola tabla, pero aquí aparecen
 * repartidas donde tienen sentido.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ClipboardList, HardDriveDownload, ListTree, Save, Store, UserPlus, Users,
} from 'lucide-react';

import { HayMasAtras } from '@/compartido/componentes/HayMasAtras';
import { fechaHora, fechaHoraCorta } from '@/compartido/utilidades/formato';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';
import { Listas } from './Listas';
import type { Rol } from '@/nucleo/sesion';
import { Respaldos } from './Respaldos';

interface Ajuste {
  readonly clave: string;
  readonly valor: string;
  readonly tipo: string;
  readonly descripcion: string | null;
}

interface UsuarioListado {
  readonly id: number;
  readonly usuario: string;
  readonly nombre: string;
  readonly rol: Rol;
  readonly activo: boolean;
  readonly ultimo_ingreso: string | null;
}

interface RegistroAuditoria {
  readonly id: number;
  readonly fecha: string;
  readonly usuario: string;
  readonly accion: string;
  readonly entidad: string;
  readonly descripcion: string;
}

type Seccion = 'negocio' | 'listas' | 'usuarios' | 'respaldos' | 'auditoria';

/** Claves que se editan en la sección del negocio, en su orden natural. */
const CAMPOS_NEGOCIO: readonly { clave: string; etiqueta: string; ayuda?: string }[] = [
  { clave: 'negocio.nombre', etiqueta: 'Nombre del negocio' },
  { clave: 'negocio.nit', etiqueta: 'NIT o documento' },
  { clave: 'negocio.direccion', etiqueta: 'Dirección' },
  { clave: 'negocio.telefono', etiqueta: 'Teléfono' },
];

const CAMPOS_OPERACION: readonly { clave: string; etiqueta: string; ayuda?: string }[] = [
  {
    clave: 'inventario.stock_minimo_defecto',
    etiqueta: 'Stock mínimo sugerido',
    ayuda: 'Se aplica a los productos nuevos. Por debajo de esa cantidad aparece la alerta.',
  },
  {
    clave: 'sesion.minutos_inactividad',
    etiqueta: 'Minutos para bloquear la sesión',
    ayuda: 'Si nadie toca el equipo durante ese tiempo, se cierra la sesión sola.',
  },
  {
    clave: 'respaldo.dias_alerta',
    etiqueta: 'Días sin respaldo antes de avisar',
    ayuda: 'El sistema insiste en el resumen hasta que hagas una copia.',
  },
];

export function Configuracion() {
  const { usuario, puede } = useSesion();
  const [seccion, setSeccion] = useState<Seccion>('negocio');

  const pestanas: readonly { id: Seccion; nombre: string; icono: typeof Store }[] = [
    { id: 'negocio', nombre: 'El negocio', icono: Store },
    ...(puede('producto.editar')
      ? [{ id: 'listas' as const, nombre: 'Listas', icono: ListTree }] : []),
    ...(puede('usuario.gestionar')
      ? [{ id: 'usuarios' as const, nombre: 'Usuarios', icono: Users }] : []),
    ...(puede('respaldo.crear')
      ? [{ id: 'respaldos' as const, nombre: 'Copias de seguridad', icono: HardDriveDownload }] : []),
    ...(puede('auditoria.ver')
      ? [{ id: 'auditoria' as const, nombre: 'Auditoría', icono: ClipboardList }] : []),
  ];

  if (usuario === null) return null;

  return (
    <div className="flex h-full flex-col gap-4">
      <header>
        <h2 className="text-xl font-bold tracking-tight">Configuración</h2>
      </header>

      <div className="flex flex-wrap gap-2">
        {pestanas.map(({ id, nombre, icono: Icono }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSeccion(id)}
            aria-pressed={seccion === id}
            className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-[13px]
              font-semibold ${seccion === id
                ? 'border-acento bg-acento-suave text-acento'
                : 'border-linea-2 text-tinta-2 hover:border-acento'}`}
          >
            <Icono size={14} aria-hidden />
            {nombre}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {seccion === 'negocio' && <DatosNegocio />}
        {seccion === 'listas' && <Listas />}
        {seccion === 'usuarios' && <GestionUsuarios />}
        {seccion === 'respaldos' && <Respaldos />}
        {seccion === 'auditoria' && <Auditoria />}
      </div>
    </div>
  );
}

/**
 * Los ajustes que tienen que ser un número mayor que cero.
 *
 * Cero minutos para bloquear la sesión dejaría el mostrador cerrándose
 * solo a cada rato; cero días sin respaldo, avisando siempre. No son
 * valores raros: son valores que rompen lo que el ajuste promete.
 */
const MINIMO_UNO: readonly string[] = [
  'inventario.stock_minimo_defecto',
  'sesion.minutos_inactividad',
  'respaldo.dias_alerta',
];

/** Qué está mal en lo que hay escrito, o null si se puede guardar. */
function loQueFalta(ajustes: Record<string, string>): string | null {
  if ((ajustes['negocio.nombre'] ?? '').trim() === '') {
    return 'Ponle nombre al negocio: es el que sale en cada recibo.';
  }
  for (const clave of MINIMO_UNO) {
    const escrito = (ajustes[clave] ?? '').trim();
    const numero = Number(escrito);
    if (escrito === '' || !Number.isInteger(numero) || numero < 1) {
      const etiqueta = [...CAMPOS_OPERACION].find((c) => c.clave === clave)?.etiqueta
        ?? clave;
      return `«${etiqueta}» tiene que ser un número entero mayor que cero.`;
    }
  }
  const porcentaje = (ajustes['impuesto.porcentaje'] ?? '').trim();
  if ((ajustes['impuesto.activo'] ?? '0') === '1') {
    const numero = Number(porcentaje);
    if (porcentaje === '' || Number.isNaN(numero) || numero <= 0 || numero >= 100) {
      return 'El porcentaje del impuesto tiene que estar entre 1 y 99.';
    }
    if ((ajustes['impuesto.nombre'] ?? '').trim() === '') {
      return 'Ponle nombre al impuesto: es lo que aparece en el recibo.';
    }
  }
  return null;
}

function DatosNegocio() {
  const { usuario, recargarAjustes } = useSesion();
  const [ajustes, setAjustes] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    pedir<Ajuste[]>('leer_configuracion')
      .then((lista) => {
        setAjustes(Object.fromEntries(lista.map((a) => [a.clave, a.valor])));
      })
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  }, []);

  async function guardar() {
    if (usuario === null) return;
    setGuardando(true);
    setGuardado(false);
    try {
      await pedir('guardar_configuracion', {
        cambios: Object.entries(ajustes).map(([clave, valor]) => ({ clave, valor })),
        rol: usuario.rol,
        usuarioId: usuario.id,
      });
      // Sin esto el nombre nuevo seguiria saliendo viejo en la barra y en
      // el recibo, y los minutos nuevos no regirian, hasta reiniciar.
      await recargarAjustes();
      setError(null);
      setGuardado(true);
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setGuardando(false);
    }
  }

  const falta = loQueFalta(ajustes);

  // La ayuda va fuera de la etiqueta y enlazada con `aria-describedby`:
  // dentro, el nombre del campo pasaba a ser la etiqueta mas el parrafo
  // entero, y eso es lo que oye quien usa lector de pantalla.
  const campo = (clave: string, etiqueta: string, ayuda?: string) => (
    <div key={clave} className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-tinta-2">{etiqueta}</span>
        <input
          value={ajustes[clave] ?? ''}
          {...(ayuda !== undefined ? { 'aria-describedby': `ayuda-${clave}` } : {})}
          onChange={(e) => {
            setAjustes((a) => ({ ...a, [clave]: e.target.value }));
            setGuardado(false);
          }}
          className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                     focus:border-acento"
        />
      </label>
      {ayuda !== undefined && (
        <span id={`ayuda-${clave}`} className="text-[12px] text-tinta-3">{ayuda}</span>
      )}
    </div>
  );

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <section className="rounded-lg border border-linea bg-panel p-5">
        <h3 className="mb-4 text-sm font-bold">Datos del negocio</h3>
        <div className="flex flex-col gap-3.5">
          {CAMPOS_NEGOCIO.map((c) => campo(c.clave, c.etiqueta, c.ayuda))}
        </div>
      </section>

      <section className="rounded-lg border border-linea bg-panel p-5">
        <h3 className="mb-4 text-sm font-bold">Cómo trabaja el sistema</h3>
        <div className="flex flex-col gap-3.5">
          {CAMPOS_OPERACION.map((c) => campo(c.clave, c.etiqueta, c.ayuda))}
        </div>
      </section>

      <section className="rounded-lg border border-linea bg-panel p-5">
        <h3 className="mb-1 text-sm font-bold">Cobros e impuestos</h3>
        <p className="mb-4 text-[13px] text-tinta-3">
          Lo que el sistema ofrece al cobrar, y si separa impuesto en el recibo.
        </p>
        <div className="flex flex-col gap-3.5">
          {campo(
            'venta.recargos_sugeridos',
            'Recargos de a un toque',
            'Separados por coma. Aparecen como botones al cobrar algo de más: '
              + 'domicilio, servicio, lo que uses.',
          )}

          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={(ajustes['impuesto.activo'] ?? '0') === '1'}
              onChange={(e) => {
                setAjustes((a) => ({
                  ...a, 'impuesto.activo': e.target.checked ? '1' : '0',
                }));
                setGuardado(false);
              }}
              className="mt-0.5"
            />
            <span>
              <span className="text-[13px] font-semibold text-tinta-2">
                Separar un impuesto en el recibo
              </span>
              <span className="block text-[12px] text-tinta-3">
                Apagado, tus precios son precio final y el recibo no menciona
                impuestos. Es lo normal en el mostrador.
              </span>
            </span>
          </label>

          {/* Los detalles solo estorban si no se va a usar. */}
          {(ajustes['impuesto.activo'] ?? '0') === '1' && (
            <div className="flex flex-col gap-3.5 border-l-2 border-linea-2 pl-4">
              {campo('impuesto.nombre', 'Cómo se llama',
                     'Lo que aparece en el recibo: IVA, INC, impuesto al consumo.')}
              {campo('impuesto.porcentaje', 'Porcentaje',
                     'Solo el número. El sistema no supone ninguna tasa: la pones tú, '
                       + 'porque depende de tu régimen.')}
              <p className="rounded border border-linea bg-panel-2 px-3 py-2 text-[12px]
                            text-tinta-2">
                Tus precios se toman como <strong>precio final</strong>: el total no
                sube, el recibo solo dice cuánto de ese total era impuesto.
              </p>
            </div>
          )}
        </div>
      </section>

      {error !== null && (
        <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3 py-2
                                   text-sm text-grave">
          {error}
        </p>
      )}

      {falta !== null && (
        <p className="rounded border border-alerta/30 bg-alerta-suave px-3 py-2
                      text-[13px] text-alerta">
          {falta}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => { void guardar(); }}
          disabled={guardando || falta !== null}
          className="inline-flex items-center gap-2 rounded bg-acento px-4 py-2.5 text-sm
                     font-semibold text-sobre-acento hover:bg-acento-fuerte disabled:opacity-50"
        >
          <Save size={16} aria-hidden />
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {guardado && (
          <span className="text-[13px] font-semibold text-bien">Guardado</span>
        )}
      </div>
    </div>
  );
}

function GestionUsuarios() {
  const { usuario } = useSesion();
  const [lista, setLista] = useState<readonly UsuarioListado[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({
    usuario: '', nombre: '', contrasena: '', rol: 'Cajero' as Rol,
  });
  const [restableciendo, setRestableciendo] = useState<UsuarioListado | null>(null);
  const [claveNueva, setClaveNueva] = useState('');

  const cargar = useCallback(async () => {
    if (usuario === null) return;
    try {
      setLista(await pedir<UsuarioListado[]>('listar_usuarios', { rol: usuario.rol }));
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }, [usuario]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function crear() {
    if (usuario === null) return;
    try {
      await pedir('crear_usuario', {
        datos: {
          ...nuevo,
          solicitante: usuario.rol,
          solicitante_id: usuario.id,
        },
      });
      setNuevo({ usuario: '', nombre: '', contrasena: '', rol: 'Cajero' });
      setCreando(false);
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function restablecer() {
    if (restableciendo === null || usuario === null) return;
    try {
      await pedir('restablecer_contrasena', {
        datos: {
          usuario_id: restableciendo.id,
          nueva: claveNueva,
          solicitante: usuario.rol,
          solicitante_id: usuario.id,
        },
      });
      setRestableciendo(null);
      setClaveNueva('');
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function desactivar(id: number) {
    if (usuario === null) return;
    try {
      await pedir('desactivar_usuario', {
        usuarioId: id, rol: usuario.rol, solicitanteId: usuario.id,
      });
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {error !== null && (
        <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3 py-2
                                   text-sm text-grave">
          {error}
        </p>
      )}

      {creando ? (
        <form
          onSubmit={(e) => { e.preventDefault(); void crear(); }}
          className="flex flex-col gap-3 rounded-lg border border-linea bg-panel p-5"
        >
          <h3 className="text-sm font-bold">Nuevo usuario</h3>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-tinta-2">Usuario</span>
            <input
              value={nuevo.usuario}
              onChange={(e) => setNuevo((n) => ({ ...n, usuario: e.target.value }))}
              required autoFocus
              className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                         focus:border-acento"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-tinta-2">Nombre</span>
            <input
              value={nuevo.nombre}
              onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))}
              required
              className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                         focus:border-acento"
            />
          </label>

          {/* La ayuda fuera de la etiqueta: dentro, el nombre del campo
              pasaba a ser «Contraseña» mas el parrafo entero. */}
          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-tinta-2">Contraseña</span>
              <input
                type="password"
                value={nuevo.contrasena}
                onChange={(e) => setNuevo((n) => ({ ...n, contrasena: e.target.value }))}
                required minLength={6}
                aria-describedby="ayuda-contrasena-nueva"
                className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                           focus:border-acento"
              />
            </label>
            <span id="ayuda-contrasena-nueva" className="text-[12px] text-tinta-3">
              Mínimo 6 caracteres. Se guarda cifrada: si se olvida se restablece, no se recupera.
            </span>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-tinta-2">Rol</span>
            <select
              value={nuevo.rol}
              onChange={(e) => setNuevo((n) => ({ ...n, rol: e.target.value as Rol }))}
              className="rounded border border-linea-2 bg-panel px-3 py-2 text-sm outline-none
                         focus:border-acento"
            >
              <option value="Cajero">Cajero — vende y cuadra su caja</option>
              <option value="Encargado">Encargado — opera el local, no ve costos</option>
              <option value="Administrador">Administrador — acceso total</option>
            </select>
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded bg-acento px-4 py-2 text-sm font-semibold text-sobre-acento
                         hover:bg-acento-fuerte"
            >
              Crear usuario
            </button>
            <button
              type="button"
              onClick={() => setCreando(false)}
              className="rounded border border-linea-2 px-4 py-2 text-sm font-semibold
                         text-tinta-2 hover:bg-panel-2"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreando(true)}
          className="inline-flex w-fit items-center gap-2 rounded border border-linea-2 px-3 py-2
                     text-sm font-semibold text-tinta-2 hover:border-acento hover:text-acento"
        >
          <UserPlus size={16} aria-hidden />
          Crear usuario
        </button>
      )}

      {restableciendo !== null && (
        <form
          onSubmit={(e) => { e.preventDefault(); void restablecer(); }}
          className="flex flex-col gap-3 rounded-lg border border-acento bg-acento-suave p-5"
        >
          <h3 className="text-sm font-bold">
            Nueva contraseña para {restableciendo.nombre}
          </h3>
          <p className="text-[13px] text-tinta-2">
            La anterior deja de servir. Si la cuenta estaba bloqueada por intentos
            fallidos, esto también la desbloquea.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-tinta-2">Contraseña</span>
            <input
              type="password"
              value={claveNueva}
              onChange={(e) => setClaveNueva(e.target.value)}
              required minLength={6} autoFocus
              className="w-64 rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                         outline-none focus:border-acento"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded bg-acento px-4 py-2 text-sm font-semibold text-sobre-acento
                         hover:bg-acento-fuerte"
            >
              Cambiar contraseña
            </button>
            <button
              type="button"
              onClick={() => { setRestableciendo(null); setClaveNueva(''); }}
              className="rounded border border-linea-2 bg-panel px-4 py-2 text-sm
                         font-semibold text-tinta-2"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-linea">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-panel-2">
            <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
              <th className="px-3 py-2.5 font-semibold">Usuario</th>
              <th className="px-3 py-2.5 font-semibold">Rol</th>
              <th className="px-3 py-2.5 font-semibold">Último ingreso</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id} className="border-t border-linea bg-panel">
                <td className="px-3 py-2.5">
                  <div className="font-semibold">{u.nombre}</div>
                  <div className="text-[12px] text-tinta-3">{u.usuario}</div>
                </td>
                <td className="px-3 py-2.5 text-tinta-2">{u.rol}</td>
                <td className="px-3 py-2.5 text-[12px] text-tinta-3">
                  {u.ultimo_ingreso === null ? 'nunca' : fechaHora(u.ultimo_ingreso)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {u.activo ? (
                    <span className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => { setRestableciendo(u); setClaveNueva(''); }}
                        className="text-[13px] font-semibold text-tinta-3 hover:text-acento"
                      >
                        Cambiar contraseña
                      </button>
                      {u.id !== usuario?.id && (
                        <button
                          type="button"
                          onClick={() => { void desactivar(u.id); }}
                          className="text-[13px] font-semibold text-tinta-3 hover:text-grave"
                        >
                          Desactivar
                        </button>
                      )}
                    </span>
                  ) : (
                    <span className="rounded bg-panel-2 px-2 py-0.5 text-[11px] font-semibold
                                     text-tinta-3">
                      inactivo
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Cómo se lee cada acción.
 *
 * En la tabla salía el código con que se guarda —«CAMBIAR_CONTRASENA»—,
 * que es como hablan las bases de datos, no como habla el dueño de una
 * tienda. El código guardado no cambia: esto es solo cómo se muestra.
 */
const NOMBRE_ACCION: Record<string, string> = {
  ABRIR_CAJA: 'Abrió la caja',
  AJUSTAR_INVENTARIO: 'Ajustó existencias',
  ANULAR_COMPRA: 'Anuló una compra',
  ANULAR_GASTO: 'Anuló un gasto',
  ANULAR_VENTA: 'Anuló una venta',
  CAMBIAR_CONTRASENA: 'Cambió una contraseña',
  CERRAR_CAJA: 'Cerró la caja',
  CODIGO_BARRAS: 'Cambió un código de barras',
  CONFIGURAR: 'Cambió la configuración',
  CREAR_CATALOGO: 'Agregó a una lista',
  CREAR_PRODUCTO: 'Creó un producto',
  CREAR_PROVEEDOR: 'Creó un proveedor',
  CREAR_USUARIO: 'Creó un usuario',
  DESACTIVAR_PRODUCTO: 'Dio de baja un producto',
  DESACTIVAR_USUARIO: 'Desactivó un usuario',
  EDITAR_CATALOGO: 'Cambió una lista',
  EDITAR_GASTO: 'Cambió un gasto',
  EDITAR_PRODUCTO: 'Cambió un producto',
  EDITAR_PROVEEDOR: 'Cambió un proveedor',
  FIADO: 'Fió una venta',
  IMPORTAR: 'Importó desde Excel',
  INGRESO: 'Entró al sistema',
  PRECIO_ESPECIAL: 'Puso un precio especial',
  REGISTRAR_COMPRA: 'Registró una compra',
  REGISTRAR_GASTO: 'Anotó un gasto',
};

/**
 * El nombre de una acción, y si es una que nadie tradujo todavía, al
 * menos algo legible en vez del código crudo.
 */
export function comoSeLee(accion: string): string {
  const nombre = NOMBRE_ACCION[accion];
  if (nombre !== undefined) return nombre;
  const suelto = accion.toLowerCase().replace(/_/g, ' ');
  return suelto.charAt(0).toUpperCase() + suelto.slice(1);
}

function Auditoria() {
  const { usuario } = useSesion();
  const [registros, setRegistros] = useState<readonly RegistroAuditoria[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * Cuantos se traen. Cortar en 300 y no decirlo es peor aqui que en
   * ninguna otra pantalla: a la auditoria se entra sospechando, y una
   * lista cortada en silencio hace creer que no hay nada mas.
   */
  const [tope, setTope] = useState(300);

  useEffect(() => {
    if (usuario === null) return;
    pedir<RegistroAuditoria[]>('leer_auditoria', { rol: usuario.rol, limite: tope })
      .then(setRegistros)
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  }, [usuario, tope]);

  if (error !== null) {
    return (
      <p role="alert" className="rounded border border-grave/30 bg-grave-suave px-3 py-2
                                 text-sm text-grave">
        {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-tinta-2">
        Todo lo que pasa en el sistema queda aquí. Este registro no se puede editar ni
        borrar, ni siquiera desde una cuenta de administrador.
      </p>

      <div className="overflow-x-auto rounded-lg border border-linea">
        {registros.length === 0 ? (
          <p className="p-6 text-center text-sm text-tinta-3">
            Todavía no hay nada registrado.
          </p>
        ) : (
        <>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 bg-panel-2">
            <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
              <th className="px-3 py-2.5 font-semibold">Fecha</th>
              <th className="px-3 py-2.5 font-semibold">Usuario</th>
              <th className="px-3 py-2.5 font-semibold">Acción</th>
              <th className="px-3 py-2.5 font-semibold">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {registros.map((r) => (
              <tr key={r.id} className="border-t border-linea bg-panel">
                <td className="cifra px-3 py-2 text-[12px] text-tinta-3">
                  {fechaHoraCorta(r.fecha)}
                </td>
                <td className="px-3 py-2 text-tinta-2">{r.usuario}</td>
                <td className="px-3 py-2">
                  <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] font-semibold
                                   text-tinta-2">
                    {comoSeLee(r.accion)}
                  </span>
                </td>
                <td className="px-3 py-2 text-tinta-2">{r.descripcion}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {registros.length === tope && (
          <HayMasAtras
            viendo={tope}
            nombre="registros"
            onVerMas={() => setTope((n) => n + 700)}
          />
        )}
        </>
        )}
      </div>
    </div>
  );
}
