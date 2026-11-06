// Feature 005 · Consultar tarifa dinámica
import { DomainError } from '../domain.error';

// Código interno: el calendario de 011 clasificó la fecha con una temporada que no está
// en el snapshot de reglas de 009. No se elige otra temporada ni se supone ajuste cero
// (contratos de 009 y 011). Sale por HTTP como 422 UNEXPECTED_ERROR (plan 005).
export class SeasonConfigurationInconsistentError extends DomainError {
  readonly errorCode = 'SEASON_CONFIGURATION_INCONSISTENT';

  constructor(date: string, seasonId: string) {
    super(
      `El calendario asigna a ${date} la temporada ${seasonId}, que no está en el catálogo de temporadas vigente.`,
    );
  }
}
