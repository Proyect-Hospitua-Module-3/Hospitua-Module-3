// Feature 005 · Consultar tarifa dinámica
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

// Solo llamadas internas de Módulo 2, que van por la red interna sin token. Cualquier
// solicitud con cabecera Authorization (OTA, Administrador o un token cualquiera) → 403.
// - POST /pricing/quotes: siempre (FR-016, BR-008).
// - GET /pricing/dynamic-rate: mientras no exista la HU4 (necesita el cliente de
//   Módulo 2 de 007), para que ninguna OTA consulte sin la restricción a sus reservas.
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
