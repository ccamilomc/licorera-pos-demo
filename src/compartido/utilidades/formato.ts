/**
 * Formato de textos y cifras.
 *
 * Un solo sitio para esto: si el simbolo o la separacion cambian, cambian
 * en toda la aplicacion a la vez.
 */

/**
 * Pesos colombianos. Sin decimales, porque el peso no usa centavos y
 * porque todo el dinero se guarda como entero para que las sumas cuadren.
 */
/**
 * JavaScript distingue `-0` de `0` y lo imprime «-0». Pasa seguido:
 * la pantalla escribe `-total` para mostrar lo que se resta, y un
 * periodo sin gastos ni merma deja un total en cero. Cero es cero.
 */
function sinCeroNegativo(valor: number): number {
  const redondeado = Math.round(valor);
  return redondeado === 0 ? 0 : redondeado;
}

export function pesos(valor: number): string {
  return `$${sinCeroNegativo(valor).toLocaleString('es-CO')}`;
}

/** Igual que `pesos` pero sin el simbolo, para columnas de tabla. */
export function cifra(valor: number): string {
  return sinCeroNegativo(valor).toLocaleString('es-CO');
}

export function unidades(cantidad: number, singular = 'unidad', plural = 'unidades'): string {
  return `${cifra(cantidad)} ${cantidad === 1 ? singular : plural}`;
}

/** '19 de agosto de 2026, 3:45 p. m.' */
export function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function fechaCorta(iso: string): string {
  return aFechaLocal(iso).toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/**
 * Convierte lo que manda el nucleo en una fecha, sin correr el dia.
 *
 * Una fecha de calendario llega como «2026-08-20», y `new Date` con ese
 * formato la lee como medianoche UTC. Aqui, cinco horas atras, esa
 * medianoche es el dia anterior a las siete de la tarde: el 20 se
 * mostraria como 19, y el primero de enero como 31 de diciembre del año
 * pasado. Por eso se arma a mano, en hora local.
 *
 * Las marcas de tiempo completas —las que traen hora— si se convierten:
 * esas son un instante, no un dia, y corresponde mostrarlas en la hora
 * de aqui.
 */
export function aFechaLocal(iso: string): Date {
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (soloFecha === null) return new Date(iso);

  const [, año, mes, dia] = soloFecha;
  return new Date(Number(año), Number(mes) - 1, Number(dia));
}

/**
 * Quita tildes y pasa a minusculas, para buscar sin que importe como se
 * escriba. En una caja, escribir 'nectar' tiene que encontrar 'Néctar'.
 */
export function paraBuscar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Fecha y hora como se leen aqui: «21/08/2026 3:45 p. m.».
 *
 * El nucleo las manda como «2026-08-21 15:45» —legible, pero no es el
 * formato que usa el resto del programa ni el que la gente escribe.
 */
export function fechaHoraCorta(texto: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(texto.trim());
  if (partes === null) return texto;

  const [, año, mes, dia, hora, minuto] = partes;
  const f = new Date(
    Number(año), Number(mes) - 1, Number(dia), Number(hora), Number(minuto),
  );
  return `${dia}/${mes}/${año} ${f.toLocaleTimeString('es-CO', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })}`;
}
