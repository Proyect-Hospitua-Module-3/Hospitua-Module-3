// Feature 009 · Modificar precio tarifa según temporada
import { DomainError } from '../domain.error';

export class InvalidSeasonAdjustmentError extends DomainError {
  readonly errorCode = 'INVALID_SEASON_ADJUSTMENT';

  constructor() {
    super(
      'El ajuste debe ser un porcentaje decimal entre -100.00 y 100.00, con a lo sumo 2 decimales, ' +
        'enviado como texto (por ejemplo "20.00" o "-10.00").',
    );
  }
}
