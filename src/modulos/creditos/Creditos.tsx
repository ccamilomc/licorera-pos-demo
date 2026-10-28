/**
 * Quién me debe y a quién le debo.
 *
 * Las dos mitades del crédito de barrio en un solo lugar, porque son la
 * misma pregunta desde los dos lados: al final del mes hay que saber
 * cuánta plata está afuera y cuánta hay que sacar.
 *
 * Lo fiado no está en la caja. Antes esa venta se registraba como
 * cualquier otra y el arqueo esperaba encontrar en el cajón una plata que
 * nadie había entregado.
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, HandCoins, Pencil, Search, Truck, X } from 'lucide-react';

import { fechaCorta, fechaHoraCorta, paraBuscar, pesos } from '@/compartido/utilidades/formato';
import { hoyLocal } from '@/compartido/componentes/Periodo';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';

interface Cliente {
  readonly id: number;
  readonly nombre: string;
  readonly telefono: string | null;
  readonly cupo: number;
  readonly activo: boolean;
  readonly fiado: number;
  readonly abonado: number;
  readonly saldo: number;
  readonly cuentas: number;
}

interface Cuenta {
  readonly id: number;
  readonly venta_id: number;
  readonly venta_numero: number;
  readonly fecha: string;
  readonly monto: number;
  readonly abonado: number;
  readonly saldo: number;
}

interface Deuda {
  readonly compra_id: number;
  readonly numero: string;
  readonly proveedor: string;
  readonly documento: string | null;
  readonly fecha: string;
  readonly vence: string | null;
  readonly total: number;
  readonly pagado: number;
  readonly saldo: number;
  readonly vencida_hace: number | null;
}

interface Abono {
  readonly id: number;
  readonly cuenta_id: number;
  readonly fecha: string;
  readonly monto: number;
  readonly metodo: string;
  readonly usuario: string;
  readonly nota: string | null;
  readonly anulado: boolean;
}

interface SaldoProveedor {
  readonly proveedor_id: number;
  readonly nombre: string;
  readonly saldo: number;
  readonly compras: number;
}

interface MetodoPago {
  readonly id: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly es_efectivo: boolean;
}

type Lado = 'deben' | 'debo';

export function Creditos() {
  const { usuario, puede } = useSesion();
  const [lado, setLado] = useState<Lado>('deben');
  /**
   * A quién se está buscando. Con cuarenta fiados la lista no cabe en la
   * pantalla, y el dueño llega sabiendo a quién quiere cobrarle.
   */
  const [consulta, setConsulta] = useState('');
  const [clientes, setClientes] = useState<readonly Cliente[]>([]);
  const [deudas, setDeudas] = useState<readonly Deuda[]>([]);
  const [metodos, setMetodos] = useState<readonly MetodoPago[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /** El cliente abierto, con sus cuentas. */
  const [abierto, setAbierto] = useState<number | null>(null);
  const [cuentas, setCuentas] = useState<readonly Cuenta[]>([]);
  /** Los abonos de la cuenta que se esté mirando. */
  const [verAbonos, setVerAbonos] = useState<number | null>(null);
  const [abonos, setAbonos] = useState<readonly Abono[]>([]);
  const [saldosProveedor, setSaldosProveedor] = useState<readonly SaldoProveedor[]>([]);
  /** Los pagos ya hechos a la compra que se esté mirando. */
  const [verPagos, setVerPagos] = useState<number | null>(null);
  const [pagos, setPagos] = useState<readonly Abono[]>([]);

  /** El cliente que se está editando: teléfono, cupo, baja. */
  const [editando, setEditando] = useState<Cliente | null>(null);
  const [ficha, setFicha] = useState({ nombre: '', telefono: '', cupo: '' });

  /** Lo que se está cobrando o pagando. */
  const [movimiento, setMovimiento] = useState<
    { tipo: 'abono'; cuenta: Cuenta; cliente: string }
    | { tipo: 'pago'; deuda: Deuda }
    | null
  >(null);
  const [monto, setMonto] = useState('');
  const [metodoId, setMetodoId] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    if (usuario === null) return;
    try {
      const [cs, ds, ms, sp] = await Promise.all([
        pedir<Cliente[]>('clientes_con_saldo', { rol: usuario.rol }),
        puede('compra.registrar')
          ? pedir<Deuda[]>('compras_por_pagar', { rol: usuario.rol })
          : Promise.resolve([]),
        pedir<MetodoPago[]>('metodos_de_pago'),
        puede('compra.registrar')
          ? pedir<SaldoProveedor[]>('saldos_por_proveedor', { rol: usuario.rol })
          : Promise.resolve([]),
      ]);
      setClientes(cs);
      setDeudas(ds);
      setMetodos(ms);
      setSaldosProveedor(sp);
      setMetodoId((a) => a ?? ms.find((m) => m.es_efectivo)?.id ?? null);
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }, [usuario, puede]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function abrirCliente(id: number) {
    if (usuario === null) return;
    if (abierto === id) { setAbierto(null); return; }
    try {
      setCuentas(await pedir<Cuenta[]>('cuentas_del_cliente', {
        clienteId: id, soloPendientes: true, rol: usuario.rol,
      }));
      setAbierto(id);
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function confirmar() {
    if (movimiento === null || usuario === null) return;
    const valor = Number(monto);
    if (!Number.isFinite(valor) || valor <= 0) return;

    setGuardando(true);
    try {
      if (movimiento.tipo === 'abono') {
        const r = await pedir<{ saldo_cliente: number; entro_a_caja: boolean }>('abonar', {
          cuentaId: movimiento.cuenta.id,
          monto: valor,
          metodoPagoId: metodoId,
          usuarioId: usuario.id,
          nota: null,
          rol: usuario.rol,
        });
        setAviso(
          `Abono de ${pesos(valor)} de ${movimiento.cliente}. `
          + `${r.saldo_cliente > 0 ? `Le quedan debiendo ${pesos(r.saldo_cliente)}.` : 'Quedó al día.'}`
          + `${r.entro_a_caja ? ' Entró a la caja.' : ''}`,
        );
        await abrirCliente(movimiento.cuenta.id === 0 ? 0 : abierto ?? 0);
      } else {
        await pedir('pagar_compra', {
          pago: {
            compra_id: movimiento.deuda.compra_id,
            monto: valor,
            fecha: hoyLocal(),
            metodo_pago_id: metodoId,
            nota: null,
          },
          usuarioId: usuario.id,
          rol: usuario.rol,
        });
        setAviso(
          `Pago de ${pesos(valor)} a ${movimiento.deuda.proveedor}, `
          + `compra ${movimiento.deuda.numero}.`,
        );
      }
      setMovimiento(null);
      setMonto('');
      setError(null);
      await cargar();
      if (abierto !== null) {
        const id = abierto;
        setAbierto(null);
        await abrirCliente(id);
      }
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setGuardando(false);
    }
  }

  async function abrirAbonos(cuentaId: number) {
    if (usuario === null) return;
    if (verAbonos === cuentaId) { setVerAbonos(null); return; }
    try {
      setAbonos(await pedir<Abono[]>('abonos_de_cuenta', {
        cuentaId, rol: usuario.rol,
      }));
      setVerAbonos(cuentaId);
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function deshacerAbono(abono: Abono) {
    if (usuario === null) return;
    const motivo = 'Se anuló desde Créditos';
    try {
      await pedir('anular_abono', {
        abonoId: abono.id, motivo, usuarioId: usuario.id, rol: usuario.rol,
      });
      setAviso(`Se anuló el abono de ${pesos(abono.monto)}. La plata volvió al cajón.`);
      setError(null);
      await cargar();
      if (abierto !== null) { const id = abierto; setAbierto(null); await abrirCliente(id); }
      setVerAbonos(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function abrirPagos(compraId: number) {
    if (usuario === null) return;
    if (verPagos === compraId) { setVerPagos(null); return; }
    try {
      setPagos(await pedir<Abono[]>('pagos_de_compra', {
        compraId, rol: usuario.rol,
      }));
      setVerPagos(compraId);
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function deshacerPago(pago: Abono) {
    if (usuario === null) return;
    try {
      await pedir('anular_pago_compra', {
        pagoId: pago.id,
        motivo: 'Se anuló desde Créditos',
        usuarioId: usuario.id,
        rol: usuario.rol,
      });
      setAviso(`Se anuló el pago de ${pesos(pago.monto)}. La plata volvió al cajón.`);
      setError(null);
      setVerPagos(null);
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function guardarFicha() {
    if (editando === null || usuario === null || ficha.nombre.trim() === '') return;
    try {
      await pedir('guardar_cliente', {
        cliente: {
          id: editando.id,
          nombre: ficha.nombre.trim(),
          telefono: ficha.telefono.trim() === '' ? null : ficha.telefono.trim(),
          documento: null,
          nota: null,
          cupo: Number(ficha.cupo) || 0,
        },
        rol: usuario.rol,
      });
      setEditando(null);
      setError(null);
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function cambiarEstado(cliente: Cliente) {
    if (usuario === null) return;
    try {
      await pedir(cliente.activo ? 'desactivar_cliente' : 'reactivar_cliente', {
        clienteId: cliente.id, rol: usuario.rol,
      });
      setAviso(cliente.activo
        ? `${cliente.nombre} queda dado de baja: no se le puede volver a fiar.`
        : `${cliente.nombre} vuelve a estar activo.`);
      setError(null);
      await cargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  const totalDeben = clientes.reduce((s, c) => s + c.saldo, 0);
  const totalDebo = deudas.reduce((s, d) => s + d.saldo, 0);

  // Los totales de arriba son de todo, no de lo filtrado: si al buscar
  // «jairo» el encabezado dijera 54.000, se leería como que eso es todo
  // lo que hay afuera.
  const texto = paraBuscar(consulta);
  const conSaldo = clientes
    .filter((c) => c.saldo > 0)
    .filter((c) => texto === '' || paraBuscar(c.nombre).includes(texto));
  const deudasVisibles = deudas
    .filter((d) => texto === ''
      || paraBuscar(`${d.proveedor} ${d.numero} ${d.documento ?? ''}`).includes(texto));

  return (
    <div className="flex h-full flex-col gap-4">
      <header>
        <h2 className="text-xl font-bold tracking-tight">Créditos</h2>
        <p className="mt-0.5 text-[13px] text-tinta-3">
          Lo fiado no está en la caja, y lo que se debe tampoco salió todavía.
          Aquí está de un lado y del otro.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Lados del crédito">
        <button
          type="button"
          role="tab"
          aria-selected={lado === 'deben'}
          onClick={() => setLado('deben')}
          className={`inline-flex items-center gap-2 rounded border px-3.5 py-2 text-sm
            font-semibold ${lado === 'deben'
              ? 'border-acento bg-acento-suave text-acento'
              : 'border-linea-2 text-tinta-2 hover:border-acento'}`}
        >
          <HandCoins size={16} aria-hidden />
          Me deben
          <span className="cifra">{pesos(totalDeben)}</span>
        </button>
        {puede('compra.registrar') && (
          <button
            type="button"
            role="tab"
            aria-selected={lado === 'debo'}
            onClick={() => setLado('debo')}
            className={`inline-flex items-center gap-2 rounded border px-3.5 py-2 text-sm
              font-semibold ${lado === 'debo'
                ? 'border-acento bg-acento-suave text-acento'
                : 'border-linea-2 text-tinta-2 hover:border-acento'}`}
          >
            <Truck size={16} aria-hidden />
            A quién le debo
            <span className="cifra">{pesos(totalDebo)}</span>
          </button>
        )}
      </div>

      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2
                     text-tinta-3"
          aria-hidden
        />
        <input
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder={lado === 'deben'
            ? 'Buscar a quién le fiaste…'
            : 'Buscar por proveedor o número de compra…'}
          aria-label="Buscar"
          className="w-full rounded-lg border border-linea-2 bg-panel py-2.5 pl-9 pr-9
                     text-sm outline-none placeholder:text-tinta-3 focus:border-acento"
        />
        {consulta !== '' && (
          <button
            type="button"
            onClick={() => setConsulta('')}
            aria-label="Limpiar la búsqueda"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1
                       text-tinta-3 hover:text-tinta"
          >
            <X size={15} aria-hidden />
          </button>
        )}
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

      {editando !== null && (
        <div className="rounded-lg border border-linea bg-panel p-5">
          <h3 className="text-sm font-bold">Datos de {editando.nombre}</h3>
          <p className="mt-1 text-[13px] text-tinta-2">
            El nombre es el que se escribe al fiar. Cambiarlo aquí no separa las
            ventas que ya están a su cuenta.
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-tinta-2">Se llama</span>
              <input
                value={ficha.nombre}
                onChange={(e) => setFicha((f) => ({ ...f, nombre: e.target.value }))}
                aria-label="Nombre del cliente"
                className="w-56 rounded border border-linea-2 bg-panel px-3 py-2 text-sm
                           outline-none focus:border-acento"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-tinta-2">
                Teléfono <span className="font-normal text-tinta-3">(opcional)</span>
              </span>
              <input
                value={ficha.telefono}
                onChange={(e) => setFicha((f) => ({ ...f, telefono: e.target.value }))}
                placeholder="para cobrarle"
                aria-label="Teléfono del cliente"
                className="cifra w-44 rounded border border-linea-2 bg-panel px-3 py-2
                           text-sm outline-none placeholder:text-[12px]
                           focus:border-acento"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-tinta-2">
                Hasta cuánto se le fía
              </span>
              <input
                inputMode="numeric"
                value={ficha.cupo}
                onChange={(e) => setFicha((f) => ({
                  ...f, cupo: e.target.value.replace(/[^0-9]/g, ''),
                }))}
                placeholder="sin tope"
                aria-label="Cupo del cliente"
                className="cifra w-40 rounded border border-linea-2 bg-panel px-3 py-2
                           text-sm text-right outline-none placeholder:text-[12px]
                           focus:border-acento"
              />
            </label>
          </div>

          <p className="mt-2 text-[12px] text-tinta-3">
            Con un tope puesto, la venta se frena cuando se pasa. Vacío es sin tope,
            que es lo normal al empezar.
          </p>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => { void guardarFicha(); }}
              disabled={ficha.nombre.trim() === ''}
              className="rounded bg-acento px-4 py-2 text-sm font-bold text-sobre-acento
                         hover:bg-acento-fuerte disabled:cursor-not-allowed
                         disabled:opacity-50"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setEditando(null)}
              className="rounded border border-linea-2 px-4 py-2 text-sm font-semibold
                         text-tinta-2 hover:bg-panel-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {movimiento !== null && (
        <div className="rounded-lg border-2 border-acento bg-panel p-5">
          <h3 className="text-sm font-bold">
            {movimiento.tipo === 'abono'
              ? `Abono de ${movimiento.cliente}`
              : `Pago a ${movimiento.deuda.proveedor}`}
          </h3>
          <p className="mt-1 text-[13px] text-tinta-2">
            {movimiento.tipo === 'abono'
              ? `Debe ${pesos(movimiento.cuenta.saldo)} de la venta `
                + `#${movimiento.cuenta.venta_numero}.`
              : `Quedan debiendo ${pesos(movimiento.deuda.saldo)} de la compra `
                + `${movimiento.deuda.numero}.`}
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-tinta-2">Cuánto</span>
              <input
                inputMode="numeric"
                value={monto}
                onChange={(e) => setMonto(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void confirmar(); }
                }}
                aria-label="Cuánto"
                autoFocus
                className="cifra w-36 rounded border border-linea-2 bg-panel px-3 py-2.5
                           text-lg text-right outline-none focus:border-acento"
              />
            </label>
            <button
              type="button"
              onClick={() => setMonto(String(
                movimiento.tipo === 'abono'
                  ? movimiento.cuenta.saldo
                  : movimiento.deuda.saldo,
              ))}
              className="rounded border border-linea-2 px-3 py-2 text-[13px] font-semibold
                         text-tinta-2 hover:border-acento hover:text-acento"
            >
              Todo
            </button>

            <fieldset>
              <legend className="mb-1 text-[12px] font-semibold text-tinta-2">
                {movimiento.tipo === 'abono' ? 'Cómo paga' : 'Con qué se paga'}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {metodos.filter((m) => m.codigo !== 'FIADO').map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMetodoId(m.id)}
                    aria-pressed={m.id === metodoId}
                    className={`rounded border px-2.5 py-1.5 text-[13px] font-semibold
                      ${m.id === metodoId
                        ? 'border-acento bg-acento-suave text-acento'
                        : 'border-linea-2 text-tinta-2 hover:border-acento'}`}
                  >
                    {m.nombre}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <p className="mt-2 text-[12px] text-tinta-3">
            {metodos.find((m) => m.id === metodoId)?.es_efectivo === true
              ? movimiento.tipo === 'abono'
                ? 'En efectivo entra a la caja abierta, y el arqueo lo cuenta.'
                : 'En efectivo sale de la caja abierta, y el arqueo lo descuenta.'
              : 'No pasa por la caja, así que el arqueo no lo toca.'}
          </p>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => { void confirmar(); }}
              disabled={guardando || Number(monto) <= 0}
              className="rounded bg-acento px-4 py-2 text-sm font-bold text-sobre-acento
                         hover:bg-acento-fuerte disabled:cursor-not-allowed
                         disabled:opacity-50"
            >
              {guardando ? 'Guardando…'
                : movimiento.tipo === 'abono' ? 'Recibir el abono' : 'Registrar el pago'}
            </button>
            <button
              type="button"
              onClick={() => { setMovimiento(null); setMonto(''); }}
              className="rounded border border-linea-2 px-4 py-2 text-sm font-semibold
                         text-tinta-2 hover:bg-panel-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-linea">
        {lado === 'deben' ? (
          conSaldo.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <HandCoins size={22} className="text-tinta-3" aria-hidden />
              <p className="text-sm text-tinta-2">
                {consulta === ''
                  ? 'Nadie debe nada. Todo cobrado.'
                  : `Nadie que se llame «${consulta}» debe algo.`}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-linea">
              {conSaldo.map((c) => (
                <li key={c.id} className="bg-panel">
                  <button
                    type="button"
                    onClick={() => { void abrirCliente(c.id); }}
                    aria-expanded={abierto === c.id}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left
                               hover:bg-panel-2"
                  >
                    {abierto === c.id
                      ? <ChevronDown size={16} className="shrink-0 text-tinta-3" aria-hidden />
                      : <ChevronRight size={16} className="shrink-0 text-tinta-3" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{c.nombre}</span>
                      {c.telefono !== null && (
                        <span className="ml-2 cifra text-[12px] text-tinta-3">{c.telefono}</span>
                      )}
                      <span className="block text-[12px] text-tinta-3">
                        {c.cuentas} {c.cuentas === 1 ? 'venta fiada' : 'ventas fiadas'}
                        {c.abonado > 0 && ` · ha abonado ${pesos(c.abonado)}`}
                        {c.cupo > 0 && ` · cupo ${pesos(c.cupo)}`}
                      </span>
                    </span>
                    <span className="cifra shrink-0 text-lg font-bold">{pesos(c.saldo)}</span>
                  </button>

                  {abierto === c.id && (
                    <div className="border-t border-linea bg-panel-2 px-4 py-3">
                      <div className="mb-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditando(c);
                            setFicha({
                              nombre: c.nombre,
                              telefono: c.telefono ?? '',
                              cupo: c.cupo === 0 ? '' : String(c.cupo),
                            });
                          }}
                          className="inline-flex items-center gap-1.5 rounded border
                                     border-linea-2 bg-panel px-2.5 py-1 text-[12px]
                                     font-semibold text-tinta-2 hover:border-acento
                                     hover:text-acento"
                        >
                          <Pencil size={12} aria-hidden />
                          Datos y cupo
                        </button>
                        {puede('producto.editar') && (
                          <button
                            type="button"
                            onClick={() => { void cambiarEstado(c); }}
                            className="rounded border border-linea-2 bg-panel px-2.5 py-1
                                       text-[12px] font-semibold text-tinta-3
                                       hover:text-grave"
                          >
                            {c.activo ? 'Dar de baja' : 'Reactivar'}
                          </button>
                        )}
                      </div>

                      <ul className="flex flex-col gap-2">
                        {cuentas.map((cu) => (
                          <li key={cu.id} className="flex flex-wrap items-center gap-3">
                            <span className="cifra text-[12px] text-tinta-3">
                              {fechaHoraCorta(cu.fecha)}
                            </span>
                            <span className="cifra text-[13px] font-semibold">
                              #{cu.venta_numero}
                            </span>
                            <span className="text-[13px] text-tinta-2">
                              debe <span className="cifra font-semibold">{pesos(cu.saldo)}</span>
                              {cu.abonado > 0 && (
                                <span className="text-tinta-3">
                                  {' '}de {pesos(cu.monto)}
                                </span>
                              )}
                            </span>
                            <span className="flex-1" />
                            {cu.abonado > 0 && (
                              <button
                                type="button"
                                onClick={() => { void abrirAbonos(cu.id); }}
                                aria-expanded={verAbonos === cu.id}
                                className="rounded border border-linea-2 bg-panel px-2.5 py-1
                                           text-[12px] font-semibold text-tinta-3
                                           hover:border-acento hover:text-acento"
                              >
                                Ver abonos
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setMovimiento({ tipo: 'abono', cuenta: cu, cliente: c.nombre });
                                setMonto('');
                              }}
                              className="rounded border border-linea-2 bg-panel px-2.5 py-1
                                         text-[12px] font-semibold text-tinta-2
                                         hover:border-acento hover:text-acento"
                            >
                              Recibir abono
                            </button>

                            {verAbonos === cu.id && (
                              <ul className="w-full border-l-2 border-linea-2 pl-3">
                                {abonos.map((ab) => (
                                  <li
                                    key={ab.id}
                                    className="flex flex-wrap items-center gap-2 py-1"
                                  >
                                    <span className="cifra text-[12px] text-tinta-3">
                                      {fechaHoraCorta(ab.fecha)}
                                    </span>
                                    <span className={`cifra text-[13px] font-semibold ${
                                      ab.anulado ? 'text-tinta-3 line-through' : ''}`}
                                    >
                                      {pesos(ab.monto)}
                                    </span>
                                    <span className="text-[12px] text-tinta-3">{ab.metodo}</span>
                                    {ab.anulado && (
                                      <span className="rounded bg-grave-suave px-1.5 py-0.5
                                                       text-[11px] font-semibold text-grave">
                                        anulado
                                      </span>
                                    )}
                                    <span className="flex-1" />
                                    {!ab.anulado && puede('venta.anular') && (
                                      <button
                                        type="button"
                                        onClick={() => { void deshacerAbono(ab); }}
                                        aria-label={`Anular el abono de ${pesos(ab.monto)}`}
                                        className="text-[12px] font-semibold text-tinta-3
                                                   hover:text-grave"
                                      >
                                        Anular
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : deudasVisibles.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Truck size={22} className="text-tinta-3" aria-hidden />
            <p className="text-sm text-tinta-2">
              {consulta === ''
                ? 'No le debes nada a nadie.'
                : `Ninguna compra pendiente coincide con «${consulta}».`}
            </p>
          </div>
        ) : (
          <>
          {saldosProveedor.length > 1 && (
            <ul className="flex flex-wrap gap-2 border-b border-linea bg-panel-2 px-3 py-2.5">
              {saldosProveedor.map((p) => (
                <li
                  key={p.proveedor_id}
                  className="rounded border border-linea-2 bg-panel px-2.5 py-1 text-[12px]"
                >
                  {p.nombre}{' '}
                  <span className="cifra font-bold">{pesos(p.saldo)}</span>
                  <span className="text-tinta-3">
                    {' '}en {p.compras} {p.compras === 1 ? 'compra' : 'compras'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-panel-2">
              <tr className="text-left text-[11px] uppercase tracking-wider text-tinta-3">
                <th className="px-3 py-2.5 font-semibold">Proveedor</th>
                <th className="px-3 py-2.5 font-semibold">Compra</th>
                <th className="px-3 py-2.5 font-semibold">Vence</th>
                <th className="px-3 py-2.5 text-right font-semibold">Debe</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {deudasVisibles.flatMap((d) => [
                <tr key={d.compra_id} className="border-t border-linea bg-panel">
                  <td className="px-3 py-2.5 font-semibold">{d.proveedor}</td>
                  <td className="px-3 py-2.5 text-[13px] text-tinta-2">
                    <span className="cifra">{d.numero}</span>
                    {d.documento !== null && (
                      <span className="ml-2 text-tinta-3">{d.documento}</span>
                    )}
                    <div className="cifra text-[12px] text-tinta-3">
                      {fechaCorta(d.fecha)}
                      {d.pagado > 0 && ` · abonado ${pesos(d.pagado)} de ${pesos(d.total)}`}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[13px]">
                    {d.vence === null ? (
                      <span className="text-tinta-3">sin fecha</span>
                    ) : (
                      <>
                        <span className="cifra text-tinta-2">{fechaCorta(d.vence)}</span>
                        {d.vencida_hace !== null && d.vencida_hace > 0 && (
                          <div className="text-[12px] font-semibold text-grave">
                            vencida hace {d.vencida_hace}{' '}
                            {d.vencida_hace === 1 ? 'día' : 'días'}
                          </div>
                        )}
                        {d.vencida_hace !== null && d.vencida_hace <= 0 && (
                          <div className="text-[12px] text-tinta-3">
                            {d.vencida_hace === 0
                              ? 'vence hoy'
                              : `faltan ${-d.vencida_hace} días`}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="cifra px-3 py-2.5 text-right text-lg font-bold">
                    {pesos(d.saldo)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      {d.pagado > 0 && (
                        <button
                          type="button"
                          onClick={() => { void abrirPagos(d.compra_id); }}
                          aria-expanded={verPagos === d.compra_id}
                          aria-label={`Ver los pagos de la compra ${d.numero}`}
                          className="rounded border border-linea-2 px-2.5 py-1 text-[12px]
                                     font-semibold text-tinta-3 hover:border-acento
                                     hover:text-acento"
                        >
                          Ver pagos
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setMovimiento({ tipo: 'pago', deuda: d });
                          setMonto('');
                        }}
                        aria-label={`Pagar la compra ${d.numero}`}
                        className="rounded border border-linea-2 px-2.5 py-1 text-[12px]
                                   font-semibold text-tinta-2 hover:border-acento
                                   hover:text-acento"
                      >
                        Pagar
                      </button>
                    </span>
                  </td>
                </tr>,
                verPagos === d.compra_id && (
                  <tr key={`pagos-${d.compra_id}`} className="border-t border-linea bg-panel-2">
                    <td colSpan={5} className="px-4 py-2.5">
                      <ul className="flex flex-col gap-1">
                        {pagos.map((p) => (
                          <li key={p.id} className="flex flex-wrap items-center gap-2">
                            <span className="cifra text-[12px] text-tinta-3">
                              {fechaCorta(p.fecha)}
                            </span>
                            <span className={`cifra text-[13px] font-semibold ${
                              p.anulado ? 'text-tinta-3 line-through' : ''}`}
                            >
                              {pesos(p.monto)}
                            </span>
                            <span className="text-[12px] text-tinta-3">
                              {p.metodo ?? 'sin forma anotada'}
                            </span>
                            {p.anulado && (
                              <span className="rounded bg-grave-suave px-1.5 py-0.5
                                               text-[11px] font-semibold text-grave">
                                anulado
                              </span>
                            )}
                            <span className="flex-1" />
                            {!p.anulado && (
                              <button
                                type="button"
                                onClick={() => { void deshacerPago(p); }}
                                aria-label={`Anular el pago de ${pesos(p.monto)}`}
                                className="text-[12px] font-semibold text-tinta-3
                                           hover:text-grave"
                              >
                                Anular
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ),
              ])}
            </tbody>
          </table>
          </>
        )}
      </div>
    </div>
  );
}
