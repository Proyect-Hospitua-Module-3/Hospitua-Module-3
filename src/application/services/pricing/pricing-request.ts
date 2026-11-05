// Feature 005 · Consultar tarifa dinámica
// Validación de la entrada de GET /pricing/dynamic-rate y POST /pricing/quotes, antes
// de llamar a cualquier puerto (contratos GET y POST, regla 1).
import { InvalidCalendarRangeError } from '../../../domain/errors/pricing/invalid-calendar-range.error';
import { InvalidPricingRequestError } from '../../../domain/errors/pricing/invalid-pricing-request.error';
import { CalendarDate } from '../../../domain/model/pricing/calendar-date.vo';
import { StayRange } from '../../../domain/model/pricing/stay-range';

// Mismo formato que acepta 004: Módulo 1 usa ids que no siguen el RFC.
const ROOM_ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoomId(raw: unknown): string {
  if (typeof raw !== 'string' || !ROOM_ID_FORMAT.test(raw)) {
    throw new InvalidPricingRequestError('roomId es obligatorio y debe ser un UUID.');
  }
  return raw;
}

export function parseDate(raw: unknown, field: string): CalendarDate {
  if (raw === undefined) {
    throw new InvalidPricingRequestError(`${field} es obligatorio (YYYY-MM-DD).`);
  }
  try {
    return CalendarDate.of(raw, field);
  } catch (error) {
    // CalendarDate es de 011 y lanza su propio código; aquí es un parámetro inválido.
    if (error instanceof InvalidCalendarRangeError) {
      throw new InvalidPricingRequestError(
        `${field} debe ser una fecha válida con formato YYYY-MM-DD.`,
      );
    }
    throw error;
  }
}

// Lanza InvalidDateRangeError si la salida es igual o anterior a la entrada.
export function parseStay(checkInDate: unknown, checkOutDate: unknown): StayRange {
  return StayRange.of(
    parseDate(checkInDate, 'checkInDate'),
    parseDate(checkOutDate, 'checkOutDate'),
  );
}
