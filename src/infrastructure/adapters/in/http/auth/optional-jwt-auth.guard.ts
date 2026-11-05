// Feature 005 · Consultar tarifa dinámica
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from './jwt-auth.guard';

// Para rutas que aceptan llamadas internas sin token (Módulo 2) y también usuarios con
// JWT (plan base, "Autorización por rol"). Sin cabecera Authorization deja pasar sin
// usuario; con ella exige un JWT válido igual que JwtAuthGuard (si no, 401).
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.authorization === undefined) {
      return true;
    }
    return super.canActivate(context);
  }
}
