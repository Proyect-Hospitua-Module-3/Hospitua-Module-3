// Feature 009 · Modificar precio tarifa según temporada
import { DomainError } from '../domain.error';

export class SeasonInUseError extends DomainError {
  readonly errorCode = 'SEASON_IN_USE';

  constructor() {
    super(
      'La temporada está asignada en el calendario vigente: retírala primero del calendario.',
    );
  }
}
