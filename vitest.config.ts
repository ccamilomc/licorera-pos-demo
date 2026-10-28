import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['pruebas/**/*.test.ts', 'pruebas/**/*.test.tsx'],
    // Las de logica corren en node; las de pantalla declaran jsdom con
    // la directiva `@vitest-environment` en su primera linea.
    environment: 'node',
    setupFiles: ['./pruebas/preparacion.ts'],

    // Las pruebas del importador cargan ExcelJS, que pesa cerca de un
    // megabyte. Con varios archivos arrancando a la vez, el import se
    // pasaba de los 10 segundos por omision y el archivo fallaba al
    // cargar -- un fallo intermitente que parecia contencion y no lo era.
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
