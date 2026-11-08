// Feature 008 · Gestionar facturación
import { DomainError } from '../domain.error';

// La búsqueda no trae ningún criterio: nunca se devuelven todas las facturas sin control
// (FR-002). page, pageSize, asOf y customerMatch no cuentan como criterio.
export class MissingSearchCriteriaError extends DomainError {
  readonly errorCode = 'MISSING_SEARCH_CRITERIA';

  constructor() {
    super(
      'Debe indicar al menos un criterio de búsqueda: estancia, reserva, cliente, canal o rango de fechas de emisión.',
    );
  }
}
