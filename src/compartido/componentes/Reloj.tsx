/**
 * La fecha y la hora, siempre a la vista.
 *
 * En un mostrador se anota la hora todo el rato —cuándo entró un
 * domicilio, a qué hora se cerró la caja, de cuándo es el recibo que el
 * cliente reclama— y el reloj de Windows queda tapado cuando la
 * aplicación está a pantalla completa.
 *
 * Vive en la barra lateral. Al principio flotaba sobre el contenido,
 * arriba a la derecha, y ahí tapaba los botones de inventario y de
 * compras: un reloj no puede estorbar para trabajar.
 *
 * Se actualiza al empezar cada minuto, no cada segundo: los segundos
 * distraen y no le sirven a nadie aquí.
 */

import { useEffect, useState } from 'react';

const DIAS = [
  'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
] as const;

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

/** «jueves 21 de agosto» — como se dice, no como se escribe en un formulario. */
export function fechaLarga(f: Date): string {
  return `${DIAS[f.getDay()]} ${f.getDate()} de ${MESES[f.getMonth()]}`;
}

/** «3:45 p. m.», que es como se lee la hora aquí. */
export function horaCorta(f: Date): string {
  return f.toLocaleTimeString('es-CO', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function Reloj() {
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    let temporizador: number;

    // Se despierta justo al cambiar el minuto y de ahí en adelante cada
    // minuto exacto. Con un intervalo de 60 segundos a secas, el reloj se
    // iría atrasando respecto al minuto real.
    function programar() {
      const faltan = 60_000 - (Date.now() % 60_000);
      temporizador = window.setTimeout(() => {
        setAhora(new Date());
        programar();
      }, faltan);
    }
    programar();

    return () => window.clearTimeout(temporizador);
  }, []);

  return (
    <div className="flex flex-col leading-tight">
      <span className="cifra text-[13px] font-bold" aria-label="Hora">
        {horaCorta(ahora)}
      </span>
      <span className="text-[11px] text-tinta-3" aria-label="Fecha">
        {fechaLarga(ahora)}
      </span>
    </div>
  );
}
