/// <reference types="vite/client" />

interface ImportMetaEnv {
  // URL base del backend de Módulo 3. Por defecto "/api", que Vite redirige en desarrollo.
  readonly VITE_API_BASE_URL?: string;
}
