import { DomainError } from '../domain.error';

export class Module1UnavailableError extends DomainError {
  readonly errorCode = 'MODULE1_UNAVAILABLE';

  constructor(readonly cause?: unknown) {
    super('Módulo 1 no está disponible para consultar la tarifa base.');
  }
}
