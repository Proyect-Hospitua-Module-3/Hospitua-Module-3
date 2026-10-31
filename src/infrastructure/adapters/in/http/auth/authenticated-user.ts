export const APP_ROLES = ['Administrador', 'OTA'] as const;
export type AppRole = (typeof APP_ROLES)[number];

// Claims del JWT de usuario emitido por Módulo 3 (plan base, "Autenticación").
export interface AuthenticatedUser {
  sub: string;
  role: AppRole;
  // Obligatorio si role = OTA.
  otaId?: string;
}
