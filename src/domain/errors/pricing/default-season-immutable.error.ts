// Feature 009 · Modificar precio tarifa según temporada
import { DomainError } from '../domain.error';

// `Regular` es la temporada por defecto: no se puede retirar ni renombrar.
export class DefaultSeasonImmutableError extends DomainError {
  readonly errorCode = 'DEFAULT_SEASON_IMMUTABLE';

  constructor(action: 'retirar' | 'renombrar') {
    super(
      `No se puede ${action} la temporada por defecto "Regular"; ` +
        'solo se pueden cambiar su color y su ajuste.',
    );
  }
}
