// Feature 004 · Consultar tarifa base
import { DomainError } from '../domain.error';

export class MalformedBaseRateResponseError extends DomainError {
  readonly errorCode = 'MODULE1_UNAVAILABLE';

  constructor(readonly cause?: unknown) {
    super('Módulo 1 devolvió una respuesta de tarifa base inválida.');
  }
}
