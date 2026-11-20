// Seguridad entre módulos · X-Internal-Key
import { createHash, timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

// Las rutas que otro módulo llama sin token exigen la clave compartida de ese módulo en la
// cabecera X-Internal-Key. Hay una clave por módulo que llama, para revocarlas por
// separado (acordado con Módulo 1 y Módulo 2):
// - INBOUND_KEY_MODULE1: Módulo 1 → GET /api/settlements.
// - INBOUND_KEY_MODULE2: Módulo 2 → POST /pricing/quotes, GET /pricing/dynamic-rate y
//   GET /ota-commission/{otaId}.
//
// Va después del guard de acceso de cada ruta:
// - Con cabecera Authorization pasa sin revisar la clave: es la OTA (o un rol rechazado) y
//   ya lo resolvieron OptionalJwtAuthGuard y el guard de acceso.
// - Sin Authorization es una llamada interna: si la variable de la clave está configurada,
//   la cabecera debe coincidir; si falta o no coincide → 401 UNAUTHENTICATED.
// - Si la variable está vacía, la clave aún no se exige. Así se activa al mismo tiempo que
//   el otro módulo empieza a enviarla, sin desplegar código.
export const INTERNAL_KEY_HEADER = 'x-internal-key';

abstract class InternalKeyGuard implements CanActivate {
  private readonly expectedDigest: Buffer | undefined;

  protected constructor(config: ConfigService, variable: string) {
    const key = config.get<string>(variable)?.trim();
    this.expectedDigest = key ? digest(key) : undefined;
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.expectedDigest === undefined) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.authorization !== undefined) return true;

    const received = request.headers[INTERNAL_KEY_HEADER];
    if (typeof received !== 'string' || !timingSafeEqual(digest(received), this.expectedDigest)) {
      throw new UnauthorizedException(
        'La llamada interna no trae una clave válida en la cabecera X-Internal-Key.',
      );
    }
    return true;
  }
}

// Se comparan los SHA-256 para que timingSafeEqual reciba siempre el mismo largo.
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

@Injectable()
export class Module1InternalKeyGuard extends InternalKeyGuard {
  constructor(config: ConfigService) {
    super(config, 'INBOUND_KEY_MODULE1');
  }
}

@Injectable()
export class Module2InternalKeyGuard extends InternalKeyGuard {
  constructor(config: ConfigService) {
    super(config, 'INBOUND_KEY_MODULE2');
  }
}
