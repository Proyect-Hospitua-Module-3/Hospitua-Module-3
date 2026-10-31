import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AppRole, AuthenticatedUser } from './authenticated-user';
import { ROLES_KEY } from './roles.decorator';

// Valida el claim `role` contra @Roles(...). Va después de JwtAuthGuard.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowedRoles = this.reflector.getAllAndOverride<AppRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowedRoles || allowedRoles.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest<Request>().user as
      | AuthenticatedUser
      | undefined;
    if (!user) {
      throw new UnauthorizedException('Falta el token de acceso, o es inválido o expiró.');
    }
    if (!allowedRoles.includes(user.role)) {
      throw new ForbiddenException('Tu rol no tiene permiso para esta operación.');
    }
    return true;
  }
}
