/**
 * Puente con el nucleo.
 *
 * Un solo punto de paso hacia Rust. Todo comando pasa por aqui, asi que
 * el manejo de errores se escribe una vez: el usuario nunca ve un error
 * tecnico en crudo, y el detalle queda registrado para diagnostico.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * En el navegador no hay Tauri y `invoke` no existe, asi que sin esto no
 * se puede ver ninguna pantalla. Cuando falta, y solo en desarrollo, se
 * usa un nucleo de mentira con datos en memoria.
 *
 * Las dos condiciones importan. `import.meta.env.DEV` es false al
 * empaquetar, de modo que el simulador ni siquiera entra al archivo
 * final; y aunque entrara, dentro de la aplicacion real hay Tauri y esta
 * rama no se toma nunca.
 */
export const MODO_SIMULADO =
  import.meta.env.DEV
  && typeof window !== 'undefined'
  && !('__TAURI_INTERNALS__' in window);

/** Forma en que el nucleo devuelve un fallo. */
interface ErrorDelNucleo {
  readonly mensaje: string;
  readonly detalle: string;
}

/**
 * Error listo para mostrarse.
 *
 * `message` es lo que ve el usuario, en palabras que se entienden.
 * `detalle` es para el registro tecnico y nunca se muestra en pantalla.
 */
export class ErrorNucleo extends Error {
  constructor(
    message: string,
    readonly detalle: string,
  ) {
    super(message);
    this.name = 'ErrorNucleo';
  }
}

function esErrorDelNucleo(valor: unknown): valor is ErrorDelNucleo {
  return (
    typeof valor === 'object' && valor !== null
    && 'mensaje' in valor && typeof (valor as ErrorDelNucleo).mensaje === 'string'
  );
}

const MENSAJE_GENERICO =
  'No fue posible completar la operacion. No se modifico ningun dato; intentalo de nuevo.';

/**
 * Llama a un comando del nucleo.
 *
 * Cualquier fallo sale como ErrorNucleo con un mensaje presentable. Un
 * error inesperado tambien: preferimos un mensaje generico y claro antes
 * que filtrar a la pantalla el texto de un fallo de SQLite.
 */
export async function pedir<T>(
  comando: string,
  argumentos?: Record<string, unknown>,
): Promise<T> {
  try {
    // `import.meta.env.DEV` va repetido aqui, aunque MODO_SIMULADO ya lo
    // incluya: al empaquetar se sustituye por `false` y la rama entera se
    // borra con su `import()`. Se comprobo que la constante sola tambien
    // basta hoy, pero eso depende de que el empaquetador propague su
    // valor; escrito asi la garantia no depende de eso. Quien la vigila
    // de verdad es `pruebas/modo-desarrollo.test.ts`, que compila para
    // produccion y revisa el archivo que iria dentro del instalador.
    if (import.meta.env.DEV && MODO_SIMULADO) {
      const { pedirSimulado } = await import('./simulador');
      return await pedirSimulado<T>(comando, argumentos);
    }
    return await invoke<T>(comando, argumentos);
  } catch (causa) {
    if (esErrorDelNucleo(causa)) {
      console.error(`[${comando}] ${causa.detalle}`);
      throw new ErrorNucleo(causa.mensaje, causa.detalle);
    }
    const detalle = causa instanceof Error ? causa.message : String(causa);
    console.error(`[${comando}] ${detalle}`);
    throw new ErrorNucleo(MENSAJE_GENERICO, detalle);
  }
}

/** Mensaje presentable de cualquier cosa que se haya lanzado. */
export function mensajeDeError(causa: unknown): string {
  if (causa instanceof ErrorNucleo) return causa.message;
  if (causa instanceof Error) return causa.message;
  return MENSAJE_GENERICO;
}
