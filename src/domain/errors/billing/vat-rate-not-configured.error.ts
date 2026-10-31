// Feature 001 · Actualizar porcentaje de IVA
import { DomainError } from '../domain.error';

// Nunca se registró un porcentaje de IVA. No se resuelve reintentando (contrato
// PORT-get-current-vat-rate.md de 006): 010 envía el evento directo a la DLQ.
export class VatRateNotConfiguredError extends DomainError {
  readonly errorCode = 'VAT_RATE_NOT_CONFIGURED';

  constructor() {
    super('No hay un porcentaje de IVA configurado: el Administrador debe registrar el primero.');
  }
}
