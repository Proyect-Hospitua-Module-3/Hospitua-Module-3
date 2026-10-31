// Feature 009 · Modificar precio tarifa según temporada
import { DomainError } from '../domain.error';

// Código interno: el catálogo no tiene exactamente una temporada por defecto.
// No es reintentable; nunca se devuelve un snapshot parcial (contrato PORT-get-season-rules).
export class SeasonCatalogInconsistentError extends DomainError {
  readonly errorCode = 'SEASON_CATALOG_INCONSISTENT';

  constructor(defaultCount: number) {
    super(
      `El catálogo de temporadas debe tener exactamente una temporada por defecto y tiene ${defaultCount}.`,
    );
  }
}
