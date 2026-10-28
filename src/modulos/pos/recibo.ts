/**
 * Comprobante de venta.
 *
 * Se arma como HTML y se manda a imprimir con el diálogo del sistema, que
 * es lo que hace que funcione igual con una impresora térmica de 80 mm
 * que con una de hojas: cada una recorta el papel a su manera y el
 * sistema operativo ya sabe cómo hablarle a la suya.
 *
 * El ancho se fija en 72 mm porque una térmica de 80 mm imprime sobre
 * unos 72; el resto es margen que la máquina no alcanza.
 */

export interface DatosNegocio {
  readonly nombre: string;
  readonly nit: string;
  readonly direccion: string;
  readonly telefono: string;
}

export interface LineaRecibo {
  readonly producto: string;
  readonly empaque: string;
  readonly cantidad: number;
  readonly precio_unitario: number;
  readonly total: number;
}

export interface DatosRecibo {
  readonly numero: number;
  readonly fecha: Date;
  readonly cajero: string;
  readonly items: readonly LineaRecibo[];
  readonly subtotal: number;
  readonly descuento: number;
  /** Lo que se cobro de mas, con su motivo. Cero si no hubo. */
  readonly recargo?: number;
  readonly recargoConcepto?: string | null;
  /** Lo que del total es impuesto, cuando el negocio lo separa. */
  readonly impuesto?: number;
  readonly impuestoNombre?: string;
  readonly total: number;
  readonly metodo: string;
  readonly recibido: number | null;
  readonly cambio: number;
  /**
   * A nombre de quién quedó, cuando se fió. Es lo más útil de mandarle el
   * recibo a alguien: que quede por escrito cuánto debe y de qué.
   */
  readonly fiadoA?: string | null;
}

const ANCHO_MM = 72;

function pesos(valor: number): string {
  return `$${Math.round(valor).toLocaleString('es-CO')}`;
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fechaLarga(fecha: Date): string {
  return fecha.toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * HTML del comprobante.
 *
 * Todo va en blanco y negro y sin fondos: una térmica no imprime color, y
 * los fondos oscuros salen como manchas que gastan papel.
 */
export function generarRecibo(negocio: DatosNegocio, venta: DatosRecibo): string {
  const lineas = venta.items
    .map((i) => {
      const detalle = i.cantidad > 1 || i.empaque.toLowerCase() !== 'unidad'
        ? `<div class="detalle">${i.cantidad} ${escapar(i.empaque.toLowerCase())} × ${pesos(i.precio_unitario)}</div>`
        : '';
      return `
        <div class="linea">
          <div class="fila">
            <span class="nombre">${escapar(i.producto)}</span>
            <span class="valor">${pesos(i.total)}</span>
          </div>
          ${detalle}
        </div>`;
    })
    .join('');

  const vuelto = venta.recibido !== null && venta.cambio > 0
    ? `<div class="fila"><span>Recibido</span><span>${pesos(venta.recibido)}</span></div>
       <div class="fila"><span>Cambio</span><span>${pesos(venta.cambio)}</span></div>`
    : '';

  // El recargo va con su motivo: un cobro de mas sin explicacion en el
  // recibo es una discusion en el mostrador.
  const recargo = (venta.recargo ?? 0) > 0
    ? `<div class="fila"><span>${escapar(venta.recargoConcepto ?? 'Recargo')}</span>`
      + `<span>${pesos(venta.recargo ?? 0)}</span></div>`
    : '';

  const impuesto = (venta.impuesto ?? 0) > 0
    ? `<div class="fila"><span>${escapar(venta.impuestoNombre ?? 'Impuesto')} incluido</span>`
      + `<span>${pesos(venta.impuesto ?? 0)}</span></div>`
    : '';

  // Cuando se fia, el recibo dice a nombre de quien quedo. Es el papel
  // que despues zanja la discusion de cuanto era.
  const nombreFiado = venta.fiadoA?.trim() ?? '';
  const fiado = nombreFiado !== ''
    ? `<hr><div class="centro"><strong>QUEDA DEBIENDO</strong><br>`
      + `${escapar(nombreFiado)}<br>${pesos(venta.total)}</div>`
    : '';

  const descuento = venta.descuento > 0
    ? `<div class="fila"><span>Descuento</span><span>−${pesos(venta.descuento)}</span></div>`
    : '';

  const datosNegocio = [
    negocio.nit !== '' ? `NIT ${escapar(negocio.nit)}` : '',
    escapar(negocio.direccion),
    escapar(negocio.telefono),
  ]
    .filter((t) => t !== '')
    .map((t) => `<div>${t}</div>`)
    .join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Recibo ${venta.numero}</title>
<style>
  @page { size: ${ANCHO_MM}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body {
    width: ${ANCHO_MM}mm;
    margin: 0;
    padding: 4mm 3mm;
    font-family: "Cascadia Mono", "Consolas", monospace;
    font-size: 11px;
    line-height: 1.45;
    color: #000;
    background: #fff;
  }
  .centro { text-align: center; }
  .negocio { font-size: 14px; font-weight: 700; letter-spacing: .02em; }
  .chico { font-size: 10px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
  .fila { display: flex; justify-content: space-between; gap: 3mm; }
  .nombre { flex: 1; }
  .valor { white-space: nowrap; }
  .detalle { padding-left: 2mm; font-size: 10px; }
  .linea { margin-bottom: 1mm; }
  .total { font-size: 15px; font-weight: 700; margin: 1.5mm 0; }
  .pie { margin-top: 3mm; font-size: 10px; }
</style>
</head>
<body>
  <div class="centro">
    <div class="negocio">${escapar(negocio.nombre)}</div>
    <div class="chico">${datosNegocio}</div>
  </div>

  <hr>

  <div class="fila"><span>Recibo</span><span>N° ${venta.numero}</span></div>
  <div class="fila"><span>Fecha</span><span>${fechaLarga(venta.fecha)}</span></div>
  <div class="fila"><span>Atendió</span><span>${escapar(venta.cajero)}</span></div>

  <hr>

  ${lineas}

  <hr>

  <div class="fila"><span>Subtotal</span><span>${pesos(venta.subtotal)}</span></div>
  ${descuento}
  ${recargo}
  <div class="fila total"><span>TOTAL</span><span>${pesos(venta.total)}</span></div>
  ${impuesto}
  <div class="fila"><span>${escapar(venta.metodo)}</span><span>${pesos(venta.total)}</span></div>
  ${vuelto}
  ${fiado}

  <hr>

  <div class="centro pie">
    ¡Gracias por su compra!<br>
    Este documento no es una factura electrónica.
  </div>
</body>
</html>`;
}

/**
 * Abre el diálogo de impresión con el recibo.
 *
 * Se usa un iframe oculto y no una ventana nueva: una ventana emergente
 * roba el foco y deja al cajero fuera de la caja, que es justo lo que no
 * se quiere entre una venta y la siguiente.
 */
export function imprimirRecibo(html: string): void {
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  marco.style.position = 'fixed';
  marco.style.right = '0';
  marco.style.bottom = '0';
  marco.style.width = '0';
  marco.style.height = '0';
  marco.style.border = '0';

  document.body.appendChild(marco);

  const documento = marco.contentWindow?.document;
  if (documento === undefined) {
    marco.remove();
    return;
  }

  documento.open();
  documento.write(html);
  documento.close();

  // Se imprime cuando el contenido ya está listo, si no sale en blanco.
  marco.onload = () => {
    marco.contentWindow?.focus();
    marco.contentWindow?.print();
    // Se retira después de imprimir; el diálogo ya tiene su copia.
    window.setTimeout(() => marco.remove(), 1000);
  };
}

/**
 * El mismo recibo, en texto plano para mandar por WhatsApp.
 *
 * La mitad de los clientes no quiere el papel: quiere que le manden la
 * cuenta al celular. Mandar la foto del recibo impreso obliga a
 * imprimirlo primero, y a veces ni siquiera hay impresora conectada.
 *
 * Se arma con espacios y no con tabuladores, porque WhatsApp los come y
 * las columnas se descuadran.
 */
export function reciboEnTexto(negocio: DatosNegocio, venta: DatosRecibo): string {
  const renglones: string[] = [];
  const linea = (izquierda: string, derecha: string) => {
    const hueco = Math.max(1, 32 - izquierda.length - derecha.length);
    return izquierda + ' '.repeat(hueco) + derecha;
  };

  if (negocio.nombre.trim() !== '') renglones.push(negocio.nombre.trim());
  if (negocio.direccion !== null && negocio.direccion.trim() !== '') {
    renglones.push(negocio.direccion.trim());
  }
  if (negocio.telefono !== null && negocio.telefono.trim() !== '') {
    renglones.push(`Tel. ${negocio.telefono.trim()}`);
  }

  renglones.push('');
  renglones.push(`Venta #${venta.numero}`);
  renglones.push(fechaLarga(venta.fecha));
  renglones.push('-'.repeat(32));

  for (const i of venta.items) {
    renglones.push(`${i.cantidad} x ${i.producto}${
      i.empaque !== '' && i.empaque.toLowerCase() !== 'unidad' ? ` (${i.empaque})` : ''}`);
    renglones.push(linea(`   ${pesos(i.precio_unitario)} c/u`, pesos(i.total)));
  }

  renglones.push('-'.repeat(32));
  if (venta.descuento > 0) {
    renglones.push(linea('Subtotal', pesos(venta.subtotal)));
    renglones.push(linea('Descuento', `-${pesos(venta.descuento)}`));
  }
  if (venta.recargo !== undefined && venta.recargo > 0) {
    renglones.push(linea(venta.recargoConcepto ?? 'Recargo', pesos(venta.recargo)));
  }
  renglones.push(linea('TOTAL', pesos(venta.total)));

  if (venta.impuesto !== undefined && venta.impuesto > 0) {
    renglones.push(linea(
      `Incluye ${venta.impuestoNombre ?? 'IVA'}`, pesos(venta.impuesto),
    ));
  }

  renglones.push('');
  renglones.push(linea('Pago', venta.metodo));
  if (venta.recibido !== null) {
    renglones.push(linea('Recibido', pesos(venta.recibido)));
    renglones.push(linea('Cambio', pesos(venta.cambio)));
  }

  if (venta.fiadoA !== undefined && venta.fiadoA !== null && venta.fiadoA.trim() !== '') {
    renglones.push('');
    renglones.push(`QUEDA DEBIENDO: ${venta.fiadoA.trim()}`);
    renglones.push(linea('Saldo de esta venta', pesos(venta.total)));
  }

  renglones.push('');
  renglones.push('¡Gracias por su compra!');
  return renglones.join('\n');
}

/**
 * Deja el texto listo para pegar.
 *
 * `navigator.clipboard` no está disponible fuera de un contexto seguro ni
 * en algunas webviews, así que hay un camino de respaldo con un textarea
 * escondido. Devuelve si lo logró: la pantalla tiene que poder decir la
 * verdad cuando no se pudo.
 */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Se intenta el camino viejo antes de darse por vencido.
  }

  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const logrado = document.execCommand('copy');
    area.remove();
    return logrado;
  } catch {
    return false;
  }
}
