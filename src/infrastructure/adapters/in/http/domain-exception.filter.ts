import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  HttpException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError } from '../../../../domain/errors/domain.error';
import { CORRELATION_ID_HEADER } from './correlation-id.middleware';

// Formato estándar de error del plan base.
export interface ApiError {
  errorCode: string;
  message: string;
  timestamp: string;
  path: string;
}

// Código HTTP de cada error de dominio que puede salir por HTTP. Los errores de
// dominio que no están aquí (p. ej. VAT_RATE_NOT_CONFIGURED, que es interno) se
// tratan como inesperados si llegan a un controller.
const HTTP_STATUS_BY_ERROR_CODE: Record<string, number> = {
  // billing — 001
  INVALID_VAT_RATE: 400,
  // pricing — 009
  INVALID_SEASON: 400,
  INVALID_SEASON_ADJUSTMENT: 400,
  SEASON_NOT_FOUND: 404,
  SEASON_NAME_CONFLICT: 409,
  DEFAULT_SEASON_IMMUTABLE: 409,
  SEASON_IN_USE: 409,
  SEASON_RULE_CONFLICT: 409,
};

// Errores HTTP del framework que no son de negocio (ruta inexistente, JSON mal formado).
const GENERIC_ERROR_CODE_BY_STATUS: Record<number, string> = {
  400: 'INVALID_REQUEST',
  404: 'NOT_FOUND',
};

const UNEXPECTED_ERROR_STATUS = 422;

// ExceptionFilter global: traduce cualquier error a `ApiError`. Nunca responde 5xx:
// lo inesperado se registra con el id de correlación y sale como 422 UNEXPECTED_ERROR.
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const { status, errorCode, message } = this.translate(exception, request);

    const body: ApiError = {
      errorCode,
      message,
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url,
    };
    response.status(status).json(body);
  }

  private translate(
    exception: unknown,
    request: Request,
  ): { status: number; errorCode: string; message: string } {
    if (exception instanceof DomainError) {
      const status = HTTP_STATUS_BY_ERROR_CODE[exception.errorCode];
      if (status) {
        return { status, errorCode: exception.errorCode, message: exception.message };
      }
    }
    if (exception instanceof UnauthorizedException) {
      return { status: 401, errorCode: 'UNAUTHENTICATED', message: exception.message };
    }
    if (exception instanceof ForbiddenException) {
      return { status: 403, errorCode: 'FORBIDDEN', message: exception.message };
    }
    if (exception instanceof HttpException) {
      const errorCode = GENERIC_ERROR_CODE_BY_STATUS[exception.getStatus()];
      if (errorCode) {
        return { status: exception.getStatus(), errorCode, message: exception.message };
      }
    }

    const correlationId = String(request.headers[CORRELATION_ID_HEADER] ?? 'sin-id');
    this.logger.error(
      `Error inesperado [${correlationId}] en ${request.method} ${request.originalUrl}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      status: UNEXPECTED_ERROR_STATUS,
      errorCode: 'UNEXPECTED_ERROR',
      message: `Ocurrió un error inesperado. Comunica este identificador a soporte: ${correlationId}.`,
    };
  }
}
