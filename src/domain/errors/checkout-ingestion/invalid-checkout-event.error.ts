// Feature 010 · Registrar Check-out
import { DomainError } from '../domain.error';

// Evento de check-out reconocible (JSON con un eventId UUID) al que le falta un dato
// obligatorio o lo trae inválido. Es un código de auditoría, no un error HTTP: el evento
// va a la DLQ y su registro queda REJECTED.
export class InvalidCheckoutEventError extends DomainError {
  readonly errorCode = 'INVALID_CHECKOUT_EVENT';

  constructor(message: string) {
    super(message);
  }
}
