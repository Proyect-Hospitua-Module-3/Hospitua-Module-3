/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// En desarrollo, todas las llamadas a /api/* van al backend NestJS de Módulo 3 (sin el
// prefijo /api). Así el navegador ve un solo origen y el backend no necesita CORS.
export default defineConfig(({ mode }) => {
  // '.' es la carpeta desde donde corre Vite; evita depender de los tipos de Node en tsc.
  const env = loadEnv(mode, '.', '');
  const backend = env.BACKEND_URL || 'http://localhost:3000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: backend,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: { modules: { classNameStrategy: 'non-scoped' } },
    },
  };
});
