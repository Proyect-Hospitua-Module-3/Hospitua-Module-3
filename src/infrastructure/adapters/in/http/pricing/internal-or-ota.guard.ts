// Feature 005 · Consultar tarifa dinámica
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/authenticated-user';

// GET /pricing/dynamic-rate: Módulo 2 por la red interna sin token, o una OTA con JWT
// (FR-010, BR-002). Va después de OptionalJwtAuthGuard, que ya validó el token (401).
// Con token, solo el rol OTA pasa; cualquier otro rol → 403. No se usa RolesGuard porque
// rechaza con 401 las llamadas sin token, que aquí son las de Módulo 2. Que la OTA solo
// consulte sus reservas es una regla de negocio: la valida el caso de uso.
@Injectable()
export class InternalOrOtaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.authorization === undefined) {
      return true;
    }
    const user = request.user as AuthenticatedUser | undefined;
    if (user?.role !== 'OTA') {
      throw new ForbiddenException('Tu rol no tiene permiso para esta operación.');
    }
    return true;
  }
}
