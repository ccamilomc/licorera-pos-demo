/**
 * Modulo de caja: abrirla, vender y cerrarla.
 *
 * Orquesta las tres pantallas del turno y habla con el nucleo. La logica
 * del carrito y del cobro vive aparte, en piezas que se prueban solas.
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Copy, LockKeyhole, Printer, Wallet } from 'lucide-react';

import { pesos } from '@/compartido/utilidades/formato';
import { mensajeDeError, pedir } from '@/nucleo/puente';
import { useSesion } from '@/nucleo/sesion';
import { CierreCaja } from './CierreCaja';
import { MovimientoCaja } from './MovimientoCaja';
import type { ResumenCaja } from './CierreCaja';
import { DialogoCobro } from './DialogoCobro';
import type { MetodoPago, PagoElegido, RecargoElegido } from './DialogoCobro';
import { PantallaVenta } from './PantallaVenta';
import { paraRegistrar, totales } from './carrito';
import {
  copiarAlPortapapeles, generarRecibo, imprimirRecibo, reciboEnTexto,
} from './recibo';
import type { DatosNegocio, LineaRecibo } from './recibo';
import type { LineaCarrito, ProductoVenta } from './carrito';

interface CajaAbierta {
  readonly id: number;
  readonly base_inicial: number;
  readonly apertura: string;
}

interface VentaGuardada {
  readonly numero: number;
  readonly subtotal: number;
  readonly descuento: number;
  readonly recargo: number;
  readonly recargo_concepto: string | null;
  readonly impuesto: number;
  readonly total: number;
  readonly cambio: number;
  readonly con_faltante: boolean;
  readonly items: readonly LineaRecibo[];
}

/** Lo que hace falta del negocio para encabezar el recibo. */
interface Ajuste {
  readonly clave: string;
  readonly valor: string;
}

/**
 * Las formas de cobro salen del núcleo, no de aquí.
 *
 * Estaban escritas a mano con los ids 1, 2 y 3, y funcionaba de
 * casualidad: nada garantiza que la base les dé esos números, y una forma
 * nueva —fiado, sin ir más lejos— no aparecía hasta tocar este archivo.
 */

export function Caja() {
  const { usuario } = useSesion();
  const [caja, setCaja] = useState<CajaAbierta | null>(null);
  const [metodos, setMetodos] = useState<readonly MetodoPago[]>([]);
  /** Si el último intento de copiar el recibo funcionó. */
  const [copiado, setCopiado] = useState<'si' | 'no' | null>(null);
  const [catalogo, setCatalogo] = useState<readonly ProductoVenta[]>([]);
  const [lineas, setLineas] = useState<LineaCarrito[]>([]);
  const [cobrando, setCobrando] = useState(false);
  const [mostrandoCobro, setMostrandoCobro] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultima, setUltima] = useState<VentaGuardada | null>(null);
  /** Conceptos de recargo que el dueño dejó listos en Configuración. */
  const [recargosSugeridos, setRecargosSugeridos] = useState<readonly string[]>([]);
  const [nombreImpuesto, setNombreImpuesto] = useState('IVA');
  /**
   * El ultimo movimiento de dinero, para confirmarlo en pantalla.
   *
   * Sin aviso el dialogo desaparecia y ya: quien acaba de sacar plata
   * para un domicilio no sabia si quedo anotado, y ante la duda lo
   * registra otra vez. Dos veces anotado descuadra la caja igual que
   * ninguna, solo que al reves.
   */
  const [ultimoMovimiento, setUltimoMovimiento] =
    useState<{ esEntrada: boolean; concepto: string; monto: number } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [negocio, setNegocio] = useState<DatosNegocio | null>(null);
  const [ultimoPago, setUltimoPago] = useState<{
    metodo: string;
    recibido: number | null;
    /** A nombre de quién quedó, si se fió. */
    fiadoA: string | null;
  }>({ metodo: 'Efectivo', recibido: null, fiadoA: null });
  const [resumenCierre, setResumenCierre] = useState<ResumenCaja | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const [moviendoDinero, setMoviendoDinero] = useState(false);
  const [guardandoMovimiento, setGuardandoMovimiento] = useState(false);

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      const [abierta, productos, ajustes, formas] = await Promise.all([
        pedir<CajaAbierta | null>('caja_abierta'),
        pedir<ProductoVenta[]>('catalogo_venta'),
        pedir<Ajuste[]>('leer_configuracion'),
        pedir<MetodoPago[]>('metodos_de_pago'),
      ]);
      setCaja(abierta);
      setCatalogo(productos);
      setMetodos(formas);

      const valor = (clave: string) =>
        ajustes.find((a) => a.clave === clave)?.valor ?? '';
      setNegocio({
        nombre: valor('negocio.nombre'),
        nit: valor('negocio.nit'),
        direccion: valor('negocio.direccion'),
        telefono: valor('negocio.telefono'),
      });
      setNombreImpuesto(valor('impuesto.nombre') || 'IVA');
      setRecargosSugeridos(
        valor('venta.recargos_sugeridos')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== ''),
      );
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void recargar(); }, [recargar]);

  async function abrirCaja(base: number) {
    if (usuario === null) return;
    try {
      const nueva = await pedir<CajaAbierta>('abrir_caja', {
        datos: {
          usuario_id: usuario.id,
          rol: usuario.rol,
          base_inicial: base,
          observaciones: null,
        },
      });
      setCaja(nueva);
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function cobrar(
    pagos: PagoElegido[],
    recargo: RecargoElegido | null,
    cliente: string | null,
  ) {
    if (usuario === null) return;
    setCobrando(true);
    setError(null);
    try {
      const guardada = await pedir<VentaGuardada>('registrar_venta', {
        venta: {
          items: paraRegistrar(lineas),
          pagos,
          usuario_id: usuario.id,
          notas: null,
          recargo,
          cliente_nombre: cliente,
        },
        rol: usuario.rol,
      });

      const pago = pagos[0];
      setUltimoPago({
        metodo: metodos.find((m) => m.id === pago?.metodo_pago_id)?.nombre ?? 'Efectivo',
        recibido: pago?.recibido ?? null,
        fiadoA: cliente,
      });
      setUltima(guardada);
      setLineas([]);
      setMostrandoCobro(false);
      // El catalogo se refresca para que las existencias queden al dia.
      void recargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setCobrando(false);
    }
  }

  async function registrarMovimiento(esEntrada: boolean, concepto: string, monto: number) {
    if (caja === null || usuario === null) return;
    setGuardandoMovimiento(true);
    try {
      await pedir('movimiento_caja', {
        datos: {
          usuario_id: usuario.id,
          rol: usuario.rol,
          caja_id: caja.id,
          es_entrada: esEntrada,
          concepto,
          monto,
        },
      });
      setMoviendoDinero(false);
      setUltimoMovimiento({ esEntrada, concepto, monto });
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setGuardandoMovimiento(false);
    }
  }

  /** Los datos del comprobante, que sirven igual para papel y para texto. */
  function datosDelRecibo(venta: VentaGuardada) {
    return {
      numero: venta.numero,
      fecha: new Date(),
      cajero: usuario?.nombre ?? '',
      items: venta.items,
      subtotal: venta.subtotal,
      descuento: venta.descuento,
      recargo: venta.recargo,
      recargoConcepto: venta.recargo_concepto,
      impuesto: venta.impuesto,
      impuestoNombre: nombreImpuesto,
      total: venta.total,
      metodo: ultimoPago.metodo,
      recibido: ultimoPago.recibido,
      cambio: venta.cambio,
      fiadoA: ultimoPago.fiadoA,
    };
  }

  function imprimir(venta: VentaGuardada) {
    if (negocio === null || usuario === null) return;
    imprimirRecibo(generarRecibo(negocio, datosDelRecibo(venta)));
  }

  /**
   * Deja el recibo listo para pegar en WhatsApp.
   *
   * La mitad de los clientes no quiere el papel, quiere la cuenta en el
   * celular. Y a veces no hay ni impresora conectada.
   */
  async function copiar(venta: VentaGuardada) {
    if (negocio === null) return;
    const logrado = await copiarAlPortapapeles(
      reciboEnTexto(negocio, datosDelRecibo(venta)),
    );
    setCopiado(logrado ? 'si' : 'no');
    window.setTimeout(() => setCopiado(null), 2500);
  }

  async function pedirCierre() {
    if (caja === null) return;
    try {
      setResumenCierre(await pedir<ResumenCaja>('resumen_caja', { cajaId: caja.id }));
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  async function confirmarCierre(contado: number, observaciones: string | null) {
    if (caja === null || usuario === null) return;
    setCerrando(true);
    try {
      await pedir('cerrar_caja', {
        datos: {
          usuario_id: usuario.id,
          rol: usuario.rol,
          caja_id: caja.id,
          efectivo_contado: contado,
          observaciones,
        },
      });
      setResumenCierre(null);
      setLineas([]);
      setUltima(null);
      await recargar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      setCerrando(false);
    }
  }

  if (cargando) {
    return <p className="p-6 text-sm text-tinta-3">Cargando el catálogo…</p>;
  }

  if (resumenCierre !== null) {
    return (
      <div className="h-full overflow-y-auto p-2">
        <CierreCaja
          resumen={resumenCierre}
          cerrando={cerrando}
          error={error}
          onCerrar={(contado, obs) => { void confirmarCierre(contado, obs); }}
          onCancelar={() => { setResumenCierre(null); setError(null); }}
        />
      </div>
    );
  }

  if (caja === null) {
    return <AperturaCaja onAbrir={abrirCaja} error={error} />;
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-tinta-3">
          Caja abierta con base de{' '}
          <strong className="cifra text-tinta-2">{pesos(caja.base_inicial)}</strong>
        </p>
        <span className="flex gap-2">
          <button
            type="button"
            onClick={() => { setMoviendoDinero(true); setError(null); }}
            className="inline-flex items-center gap-1.5 rounded border border-linea-2 px-3 py-1.5
                       text-[13px] font-semibold text-tinta-2 hover:border-acento hover:text-acento"
          >
            <ArrowLeftRight size={14} aria-hidden />
            Entra o sale plata
          </button>
          <button
            type="button"
            onClick={() => { void pedirCierre(); }}
            className="inline-flex items-center gap-1.5 rounded border border-linea-2 px-3 py-1.5
                       text-[13px] font-semibold text-tinta-2 hover:border-acento hover:text-acento"
          >
            <LockKeyhole size={14} aria-hidden />
            Cerrar caja
          </button>
        </span>
      </div>

      {ultimoMovimiento !== null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg
                        border border-linea bg-panel-2 px-4 py-2.5">
          <p className="text-sm text-tinta-2">
            {ultimoMovimiento.esEntrada ? 'Entraron' : 'Salieron'}{' '}
            <strong className="cifra">{pesos(ultimoMovimiento.monto)}</strong>
            {' '}de la caja: {ultimoMovimiento.concepto.toLowerCase()}.
            {' '}Se descuenta del efectivo esperado al cerrar.
          </p>
          <button
            type="button"
            onClick={() => setUltimoMovimiento(null)}
            className="text-[13px] font-semibold text-tinta-3 hover:text-tinta"
          >
            Entendido
          </button>
        </div>
      )}

      {ultima !== null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg
                        border border-bien/30 bg-bien-suave px-4 py-2.5">
          <p className="text-sm text-tinta-2">
            Venta <strong className="cifra">#{ultima.numero}</strong> guardada
            por <strong className="cifra">{pesos(ultima.total)}</strong>.
            {ultima.cambio > 0 && (
              <> Vuelto: <strong className="cifra">{pesos(ultima.cambio)}</strong>.</>
            )}
          </p>
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => imprimir(ultima)}
              className="inline-flex items-center gap-1.5 rounded border border-linea-2
                         bg-panel px-2.5 py-1 text-[13px] font-semibold text-tinta-2
                         hover:border-acento hover:text-acento"
            >
              <Printer size={14} aria-hidden />
              Imprimir recibo
            </button>
            <button
              type="button"
              onClick={() => { void copiar(ultima); }}
              className="inline-flex items-center gap-1.5 rounded border border-linea-2
                         bg-panel px-2.5 py-1 text-[13px] font-semibold text-tinta-2
                         hover:border-acento hover:text-acento"
            >
              <Copy size={14} aria-hidden />
              Copiar para enviar
            </button>
            {copiado !== null && (
              <span
                role="status"
                className={`text-[12px] font-semibold ${
                  copiado === 'si' ? 'text-bien' : 'text-grave'}`}
              >
                {copiado === 'si'
                  ? 'Copiado: ya lo puedes pegar en WhatsApp'
                  : 'No se pudo copiar'}
              </span>
            )}
            <button
              type="button"
              onClick={() => setUltima(null)}
              className="text-[13px] font-semibold text-tinta-3 hover:text-tinta"
            >
              Cerrar
            </button>
          </span>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="rounded-lg border border-grave/30 bg-grave-suave
                                   px-4 py-2.5 text-sm text-grave">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1">
        <PantallaVenta
          catalogo={catalogo}
          lineas={lineas}
          onCambiar={setLineas}
          onCobrar={() => setMostrandoCobro(true)}
          cobrando={cobrando}
        />
      </div>

      {moviendoDinero && (
        <MovimientoCaja
          guardando={guardandoMovimiento}
          error={error}
          onGuardar={(entrada, concepto, monto) => {
            void registrarMovimiento(entrada, concepto, monto);
          }}
          onCerrar={() => { setMoviendoDinero(false); setError(null); }}
        />
      )}

      {mostrandoCobro && (
        <DialogoCobro
          total={totales(lineas).total}
          metodos={metodos}
          cobrando={cobrando}
          error={error}
          recargosSugeridos={recargosSugeridos}
          onConfirmar={(pagos, recargo, cliente) => {
            void cobrar(pagos, recargo, cliente);
          }}
          onCancelar={() => { setMostrandoCobro(false); setError(null); }}
        />
      )}
    </div>
  );
}

function AperturaCaja({
  onAbrir, error,
}: {
  readonly onAbrir: (base: number) => void;
  readonly error: string | null;
}) {
  const [base, setBase] = useState('');
  const monto = Number(base.replace(/\D/g, ''));

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={(e) => { e.preventDefault(); onAbrir(monto); }}
        className="w-full max-w-sm rounded-lg border border-linea bg-panel p-6"
      >
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center
                          rounded-xl bg-acento-suave">
            <Wallet size={22} className="text-acento" aria-hidden />
          </div>
          <h2 className="text-lg font-bold">Abrir la caja</h2>
          <p className="mt-1 text-sm text-tinta-2">
            Cuenta el dinero con el que empiezas el turno.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-tinta-2">Base inicial</span>
          <input
            inputMode="numeric"
            value={base}
            onChange={(e) => setBase(e.target.value.replace(/\D/g, ''))}
            placeholder="0"
            autoFocus
            className="cifra rounded border border-linea-2 bg-panel px-3 py-2.5 text-lg
                       outline-none focus:border-acento"
          />
          <span className="cifra text-[13px] text-tinta-3">{pesos(monto)}</span>
        </label>

        {error !== null && (
          <p role="alert" className="mt-3 rounded border border-grave/30 bg-grave-suave
                                     px-3 py-2 text-sm text-grave">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="mt-4 w-full rounded bg-acento px-4 py-3 text-sm font-bold text-sobre-acento
                     hover:bg-acento-fuerte"
        >
          Abrir caja y empezar
        </button>
      </form>
    </div>
  );
}
