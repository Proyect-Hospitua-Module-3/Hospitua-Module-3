// Sesión del usuario: el JWT de POST /auth/login y lo que se lee de él.
// Se guarda en sessionStorage: se cierra al cerrar la pestaña.

export type Role = 'Administrador' | 'OTA' | string;

export interface Session {
  token: string;
  // El token no trae el nombre: se guarda el que se escribió al entrar.
  username: string;
  userId: string;
  role: Role;
  // Milisegundos desde 1970; después de esto el backend responde 401.
  expiresAt: number;
}

const STORAGE_KEY = 'hospitua.m3.session';

// Lee los claims del JWT (sub, role, exp) sin verificar la firma: eso lo hace el backend.
export function sessionFromToken(token: string, username: string, expiresIn: number): Session {
  const claims = decodeClaims(token);
  return {
    token,
    username,
    userId: typeof claims.sub === 'string' ? claims.sub : '',
    role: typeof claims.role === 'string' ? claims.role : '',
    expiresAt: typeof claims.exp === 'number' ? claims.exp * 1000 : Date.now() + expiresIn * 1000,
  };
}

function decodeClaims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) return {};
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      Array.from(
        atob(base64),
        (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
      ).join(''),
    );
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function isExpired(session: Session, now = Date.now()): boolean {
  return now >= session.expiresAt;
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    return session.token && !isExpired(session) ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sin almacenamiento (modo privado estricto): la sesión vive solo en memoria.
  }
}
