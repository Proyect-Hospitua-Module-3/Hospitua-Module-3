// Feature 002 · Consultar liquidación
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/authenticated-user';

// GET /api/settlements: Módulo 1 por la red interna sin token, o una OTA con JWT (FR-013,
// BR-006). Va después de OptionalJwtAuthGuard, que ya validó el token (inválido → 401).
// - Sin cabecera Authorization: pasa (Módulo 1); los parámetros los valida el caso de uso.
// - Con token de un rol distinto de OTA: 403 FORBIDDEN.
// - Con token OTA sin claim otaId: 401 UNAUTHENTICATED (plan 002, «Errores»).
// No se usa RolesGuard porque rechaza con 401 las llamadas sin token, que aquí son las de
// Módulo 1, ni InternalOrOtaGuard de 005, que no exige otaId.
@Injectable()
export class SettlementAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.authorization === undefined) {
      return true;
    }
    const user = request.user as AuthenticatedUser | undefined;
    if (user?.role !== 'OTA') {
      throw new ForbiddenException('Tu rol no tiene permiso para consultar liquidaciones.');
    }
    if (typeof user.otaId !== 'string' || user.otaId.trim() === '') {
      throw new UnauthorizedException(
        'Tu token de OTA no trae la identidad de la OTA (otaId). Inicia sesión de nuevo con un usuario OTA.',
      );
    }
    return true;
  }
}
