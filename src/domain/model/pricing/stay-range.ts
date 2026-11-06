// Feature 005 · Consultar tarifa dinámica
import { InvalidDateRangeError } from '../../errors/pricing/invalid-date-range.error';
import { CalendarDate } from './calendar-date.vo';

// Estadía [checkInDate, checkOutDate): la fecha de salida es exclusiva, así que el rango
// tiene al menos una noche (FR-008). Se valida antes de llamar a cualquier puerto.
export class StayRange {
  private constructor(
    readonly checkInDate: CalendarDate,
    readonly checkOutDate: CalendarDate,
  ) {
    Object.freeze(this);
  }

  // Lanza InvalidDateRangeError si la salida es igual o anterior a la entrada.
  static of(checkInDate: CalendarDate, checkOutDate: CalendarDate): StayRange {
    if (!checkInDate.isBefore(checkOutDate)) {
      throw new InvalidDateRangeError();
    }
    return new StayRange(checkInDate, checkOutDate);
  }

  // Consulta de una sola noche con `date`: equivale a salida = date + 1 día.
  static singleNight(date: CalendarDate): StayRange {
    return new StayRange(date, date.addDays(1));
  }

  get nightCount(): number {
    return this.checkOutDate.epochDay - this.checkInDate.epochDay;
  }

  // Noches en orden, desde la entrada hasta el día anterior a la salida.
  nights(): CalendarDate[] {
    return Array.from({ length: this.nightCount }, (_, index) => this.checkInDate.addDays(index));
  }
}
