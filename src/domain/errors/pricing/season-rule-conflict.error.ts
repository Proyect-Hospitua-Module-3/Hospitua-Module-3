// Feature 009 · Modificar precio tarifa según temporada
import { DomainError } from '../domain.error';

// `expectedVersion` no coincide: otro Administrador cambió la temporada entretanto.
export class SeasonRuleConflictError extends DomainError {
  readonly errorCode = 'SEASON_RULE_CONFLICT';

  constructor(currentVersion: number) {
    super(
      `La temporada cambió mientras la editabas (versión actual ${currentVersion}). ` +
        'Consulta el valor vigente y vuelve a intentarlo.',
    );
  }
}
