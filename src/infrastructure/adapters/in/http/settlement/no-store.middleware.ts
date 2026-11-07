// Feature 002 · Consultar liquidación
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

// Las respuestas de GET /api/settlements llevan información financiera: ningún
// intermediario debe guardarlas (contrato GET-settlements.md, «Cómo interpreta cada
// respuesta»). Es un middleware y no un @Header porque corre antes que los guards: así la
// cabecera sale también en las respuestas 400, 401, 403 y 404.
@Injectable()
export class NoStoreMiddleware implements NestMiddleware {
  use(_request: Request, response: Response, next: NextFunction): void {
    response.setHeader('Cache-Control', 'no-store');
    next();
  }
}
