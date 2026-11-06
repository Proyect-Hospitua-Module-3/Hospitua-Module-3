// Feature 007 · Generar liquidación
import { DomainError } from '../domain.error';

// El comando de check-out llega con un dato obligatorio faltante o inconsistente (BR-007).
// 010 ya valida el evento, así que es un error del llamador; se rechaza antes de llamar a
// Módulo 2 o a la base de datos. Usa el mismo código con el que 010 manda un evento
// inválido a dead-letter.
export class InvalidCheckoutDataError extends DomainError {
  readonly errorCode = 'INVALID_CHECKOUT_EVENT';

  constructor(detail: string) {
    super(`Los datos del check-out no son válidos: ${detail}`);
  }
}
