// Feature 008 · Gestionar facturación
import { DomainError } from '../domain.error';

// Un parámetro de la consulta de facturas tiene formato inválido (contratos de 008,
// «Errores»): UUID o fecha mal escritos, pageSize fuera de 1–100, asOf futuro, otaId sin
// channel=OTA o PARTIAL con menos de 3 caracteres. Mismo código que el resto del proyecto.
export class InvalidInvoiceQueryError extends DomainError {
  readonly errorCode = 'INVALID_QUERY_PARAMS';

  constructor(message: string) {
    super(message);
  }
}
