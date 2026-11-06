// Feature 007 · Generar liquidación
import { InvalidCalendarRangeError } from '../../errors/pricing/invalid-calendar-range.error';
import { InvalidCheckoutDataError } from '../../errors/settlement/invalid-checkout-data.error';
import { CalendarDate } from '../pricing/calendar-date.vo';

// Mismo formato que aceptan 004 y 005: Módulo 1 usa ids que no siguen el RFC.
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CheckoutInput {
  eventId?: unknown;
  stayId?: unknown;
  reservationRef?: unknown;
  roomId?: unknown;
  categoryRoom?: unknown;
  checkInDate?: unknown;
  checkOutDate?: unknown;
}

// Datos de la estancia que llegan en el evento de check-out de Módulo 1, ya validados
// (BR-007). Las fechas son las reales; la salida el mismo día de la entrada es válida.
// Los UUID se guardan en minúsculas, como los devuelve PostgreSQL, para que la
// liquidación que se lee después sea idéntica a la que se crea.
export class CheckoutData {
  private constructor(
    readonly eventId: string,
    readonly stayId: string,
    readonly reservationRef: string,
    readonly roomId: string,
    readonly categoryRoom: string,
    readonly checkInDate: string,
    readonly checkOutDate: string,
  ) {
    Object.freeze(this);
  }

  // Lanza InvalidCheckoutDataError con el primer dato que falla.
  static of(input: CheckoutInput): CheckoutData {
    const checkIn = date(input.checkInDate, 'checkInDate');
    const checkOut = date(input.checkOutDate, 'checkOutDate');
    if (checkOut.isBefore(checkIn)) {
      throw new InvalidCheckoutDataError(
        `checkOutDate (${checkOut.toString()}) es anterior a checkInDate (${checkIn.toString()}).`,
      );
    }
    return new CheckoutData(
      uuid(input.eventId, 'eventId'),
      uuid(input.stayId, 'stayId'),
      text(input.reservationRef, 'reservationRef'),
      uuid(input.roomId, 'roomId'),
      text(input.categoryRoom, 'categoryRoom'),
      checkIn.toString(),
      checkOut.toString(),
    );
  }
}

function uuid(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !UUID_FORMAT.test(raw)) {
    throw new InvalidCheckoutDataError(`${field} es obligatorio y debe ser un UUID.`);
  }
  return raw.toLowerCase();
}

function text(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new InvalidCheckoutDataError(`${field} es obligatorio.`);
  }
  return raw;
}

function date(raw: unknown, field: string): CalendarDate {
  try {
    return CalendarDate.of(raw, field);
  } catch (error) {
    // CalendarDate es de 011 y lanza su propio código; aquí es un dato inválido del check-out.
    if (error instanceof InvalidCalendarRangeError) {
      throw new InvalidCheckoutDataError(
        `${field} es obligatorio y debe ser una fecha válida con formato YYYY-MM-DD.`,
      );
    }
    throw error;
  }
}
