import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Exige un JWT válido; sin token, inválido o expirado → 401 UNAUTHENTICATED.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(error: unknown, user: TUser | false): TUser {
    if (error || !user) {
      throw new UnauthorizedException('Falta el token de acceso, o es inválido o expiró.');
    }
    return user;
  }
}
