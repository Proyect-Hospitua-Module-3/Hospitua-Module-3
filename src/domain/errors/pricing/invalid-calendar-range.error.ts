// Feature 011 · Revisar temporada del año
import { DomainError } from '../domain.error';

// Año, fecha, ventana o entrada del calendario mal formados: año fuera de 1..9999,
// fecha que no existe, ventana fuera del año, inicio fuera del año propietario, BASE
// que pasa del año siguiente, EXCEPTION de más de un día o cuerpo con otra forma.
export class InvalidCalendarRangeError extends DomainError {
  readonly errorCode = 'INVALID_CALENDAR_RANGE';

  constructor(message: string) {
    super(message);
  }
}
