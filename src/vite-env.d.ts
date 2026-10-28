/// <reference types="vite/client" />

/**
 * El manual se importa como texto para que la pantalla de ayuda lo lea
 * del mismo archivo que se edita, sin copias que puedan discrepar.
 */
declare module '*.md?raw' {
  const contenido: string;
  export default contenido;
}
