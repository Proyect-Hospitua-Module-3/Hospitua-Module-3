// Feature 003 · Consultar porcentaje de comisión OTA
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/authenticated-user';

// GET /ota-commission/{otaId}: Módulo 2 por la red interna sin token, o una OTA con JWT
// (FR-007, SC-005). Va después de OptionalJwtAuthGuard, que ya validó el token (inválido o
// expirado → 401).
// - Sin cabecera Authorization: pasa (llamada interna de un módulo).
// - Con token de un rol distinto de OTA (p. ej. Administrador): 403 FORBIDDEN.
// - Con token OTA sin claim otaId: 401 UNAUTHENTICATED, igual que en 002.
// Que la OTA consulte solo su propio otaId es una regla de negocio: la valida el caso de uso
// antes de leer (regla 9 del plan base). No se usa RolesGuard porque rechaza con 401 las
// llamadas sin token, que aquí son las de Módulo 2.
@Injectable()
export class OtaCommissionAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.authorization === undefined) {
      return true;
    }
    const user = request.user as AuthenticatedUser | undefined;
    if (user?.role !== 'OTA') {
      throw new ForbiddenException('Tu rol no tiene permiso para consultar comisiones de OTA.');
    }
    if (typeof user.otaId !== 'string' || user.otaId.trim() === '') {
      throw new UnauthorizedException(
        'Tu token de OTA no trae la identidad de la OTA (otaId). Inicia sesión de nuevo con un usuario OTA.',
      );
    }
    return true;
  }
}
