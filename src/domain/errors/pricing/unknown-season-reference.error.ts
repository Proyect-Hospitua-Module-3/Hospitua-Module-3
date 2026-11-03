// Feature 011 · Revisar temporada del año
import { DomainError } from '../domain.error';

// Una entrada del cuerpo apunta a una temporada que no existe en el catálogo de 009 o
// que ya fue retirada (FR-010). No es SEASON_NOT_FOUND: la ruta es válida y lo que
// falla es una referencia dentro del cuerpo.
export class UnknownSeasonReferenceError extends DomainError {
  readonly errorCode = 'UNKNOWN_SEASON_REFERENCE';

  constructor(seasonIds: string[]) {
    super(
      'Solo se pueden asignar temporadas existentes y no retiradas del catálogo; ' +
        `no son válidas: ${seasonIds.join(', ')}.`,
    );
  }
}
