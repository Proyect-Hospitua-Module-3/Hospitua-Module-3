// Cliente HTTP del backend de Módulo 3. Todas las respuestas de error del backend tienen
// la forma ApiError del plan base: { errorCode, message, timestamp, path }.

// En desarrollo Vite redirige /api al backend (vite.config.ts).
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api';

export const NETWORK_ERROR = 'NETWORK_ERROR';

export class ApiError extends Error {
  constructor(
    // 0 si ni siquiera hubo respuesta (backend apagado o sin red).
    readonly status: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(
      0,
      NETWORK_ERROR,
      'No se pudo conectar con Módulo 3. Verifica que el backend esté encendido.',
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw toApiError(response.status, payload);
  }
  return payload as T;
}

function toApiError(status: number, payload: unknown): ApiError {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { errorCode?: unknown }).errorCode === 'string'
  ) {
    const { errorCode, message } = payload as { errorCode: string; message?: unknown };
    return new ApiError(status, errorCode, typeof message === 'string' ? message : errorCode);
  }
  // Módulo 3 nunca responde 5xx (plan base): un 5xx sin ApiError viene del proxy de Vite o
  // de un gateway que no alcanzó el backend, así que se trata como backend apagado.
  if (status >= 500) {
    return new ApiError(
      0,
      NETWORK_ERROR,
      'No se pudo conectar con Módulo 3. Verifica que el backend esté encendido.',
    );
  }
  // Otro servidor que no es Módulo 3 respondió sin el formato ApiError.
  return new ApiError(status, 'UNEXPECTED_ERROR', `Módulo 3 respondió con un error (${status}).`);
}
