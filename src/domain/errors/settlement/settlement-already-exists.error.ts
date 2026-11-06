// Feature 007 · Generar liquidación
import { DomainError } from '../domain.error';

// Ya existe la liquidación Final de la estancia y el nuevo intento trae datos de check-out
// distintos. La original se conserva sin cambios (FR-010, HU3 escenario 2).
export class SettlementAlreadyExistsError extends DomainError {
  readonly errorCode = 'SETTLEMENT_ALREADY_EXISTS';

  constructor(stayId: string, differentFields: readonly string[]) {
    super(
      `La estancia ${stayId} ya tiene una liquidación Final y este check-out trae datos distintos (${differentFields.join(', ')}). Se conserva la liquidación original.`,
    );
  }
}
