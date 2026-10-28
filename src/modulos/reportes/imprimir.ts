/**
 * Impresión de reportes.
 *
 * Se manda al diálogo del sistema, que en Windows incluye «Microsoft Print
 * to PDF». Así el mismo botón sirve para sacarlo en papel y para guardarlo
 * como PDF, sin traer una librería que genere PDF por su cuenta.
 *
 * En hoja carta y no en 72 mm como el recibo: un reporte se lee en la
 * mesa, no se corta en la caja.
 */

export interface ColumnaImprimible {
  readonly titulo: string;
  readonly esDinero?: boolean;
  readonly esNumero?: boolean;
}

export interface DatosImpresion {
  readonly negocio: string;
  readonly reporte: string;
  readonly desde: string;
  readonly hasta: string;
  readonly columnas: readonly ColumnaImprimible[];
  readonly filas: readonly (readonly string[])[];
  /** Pie con los totales, si el reporte los tiene. */
  readonly totales?: readonly string[];
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fechaLegible(iso: string): string {
  const [anio, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${anio}`;
}

export function generarImpresion(datos: DatosImpresion): string {
  const periodo = datos.desde === datos.hasta
    ? fechaLegible(datos.desde)
    : `${fechaLegible(datos.desde)} al ${fechaLegible(datos.hasta)}`;

  const encabezado = datos.columnas
    .map((c) => {
      const alineado = c.esDinero === true || c.esNumero === true ? ' class="num"' : '';
      return `<th${alineado}>${escapar(c.titulo)}</th>`;
    })
    .join('');

  const cuerpo = datos.filas
    .map((fila) => {
      const celdas = fila
        .map((valor, i) => {
          const c = datos.columnas[i];
          const alineado = c?.esDinero === true || c?.esNumero === true ? ' class="num"' : '';
          return `<td${alineado}>${escapar(valor)}</td>`;
        })
        .join('');
      return `<tr>${celdas}</tr>`;
    })
    .join('');

  const pie = datos.totales !== undefined
    ? `<tfoot><tr>${datos.totales
        .map((valor, i) => {
          const c = datos.columnas[i];
          const alineado = c?.esDinero === true || c?.esNumero === true ? ' class="num"' : '';
          return `<td${alineado}>${escapar(valor)}</td>`;
        })
        .join('')}</tr></tfoot>`
    : '';

  const impreso = new Date().toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapar(datos.reporte)}</title>
<style>
  @page { size: letter; margin: 18mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 10.5pt;
    color: #000;
    background: #fff;
  }
  header { border-bottom: 1.5pt solid #000; padding-bottom: 6pt; margin-bottom: 10pt; }
  .negocio { font-size: 14pt; font-weight: 700; }
  .reporte { font-size: 12pt; margin-top: 2pt; }
  .periodo { font-size: 9.5pt; margin-top: 1pt; }
  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: .04em;
    border-bottom: 1pt solid #000;
    padding: 4pt 5pt;
  }
  td { padding: 3.5pt 5pt; border-bottom: .5pt solid #999; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { border-top: 1pt solid #000; border-bottom: 0; font-weight: 700; padding-top: 5pt; }
  /* Que el encabezado se repita si el reporte ocupa varias hojas. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  footer {
    margin-top: 10pt;
    padding-top: 5pt;
    border-top: .5pt solid #999;
    font-size: 8.5pt;
  }
</style>
</head>
<body>
  <header>
    <div class="negocio">${escapar(datos.negocio)}</div>
    <div class="reporte">${escapar(datos.reporte)}</div>
    <div class="periodo">${periodo}</div>
  </header>

  <table>
    <thead><tr>${encabezado}</tr></thead>
    <tbody>${cuerpo}</tbody>
    ${pie}
  </table>

  <footer>
    ${datos.filas.length} ${datos.filas.length === 1 ? 'registro' : 'registros'}
    &middot; Impreso el ${impreso}
  </footer>
</body>
</html>`;
}

/**
 * Abre el diálogo de impresión.
 *
 * Igual que el recibo: iframe oculto en vez de ventana nueva, para no
 * sacar al usuario de donde estaba.
 */
export function imprimir(html: string): void {
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

  marco.onload = () => {
    marco.contentWindow?.focus();
    marco.contentWindow?.print();
    window.setTimeout(() => marco.remove(), 1000);
  };
}
