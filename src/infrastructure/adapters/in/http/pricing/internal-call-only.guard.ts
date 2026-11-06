// Feature 005 · Consultar tarifa dinámica
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

// Solo llamadas internas de Módulo 2, que van por la red interna sin token. Cualquier
// solicitud con cabecera Authorization (OTA, Administrador o un token cualquiera) → 403.
// Lo usa POST /pricing/quotes (FR-016, BR-008). GET /pricing/dynamic-rate usa
// InternalOrOtaGuard, porque también lo consulta la OTA (HU4).
@Injectable()
export class InternalCallOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.authorization !== undefined) {
      throw new ForbiddenException(
        'Esta operación solo la puede llamar Módulo 2 por la red interna, sin token.',
      );
    }
    return true;
  }
}
