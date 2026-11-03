// Feature 011 · Revisar temporada del año
import { InvalidCalendarRangeError } from '../../errors/pricing/invalid-calendar-range.error';
import { CalendarDate } from './calendar-date.vo';

export const CALENDAR_YEAR_MIN = 1;
export const CALENDAR_YEAR_MAX = 9999;

const YEAR_FORMAT = /^\d{1,4}$/;

// Año civil del calendario (plan 011): entero entre 1 y 9999. Determina el intervalo
// [YYYY-01-01, YYYY-12-31] de las fechas que le pertenecen.
export class CalendarYear {
  private constructor(readonly value: number) {}

  // Acepta número o texto (en la ruta y en la query llega como texto).
  static of(raw: unknown): CalendarYear {
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && YEAR_FORMAT.test(raw)
          ? Number(raw)
          : NaN;
    if (!Number.isInteger(value) || value < CALENDAR_YEAR_MIN || value > CALENDAR_YEAR_MAX) {
      throw new InvalidCalendarRangeError(
        `El año debe ser un entero entre ${CALENDAR_YEAR_MIN} y ${CALENDAR_YEAR_MAX}.`,
      );
    }
    return new CalendarYear(value);
  }

  firstDay(): CalendarDate {
    return CalendarDate.fromParts(this.value, 1, 1);
  }

  lastDay(): CalendarDate {
    return CalendarDate.fromParts(this.value, 12, 31);
  }

  // Último día al que puede llegar un período BASE de este año (BR-006): el 31 de
  // diciembre del año siguiente.
  lastDayOfNextYear(): CalendarDate {
    return CalendarDate.fromParts(this.value + 1, 12, 31);
  }

  contains(date: CalendarDate): boolean {
    return date.year === this.value;
  }
}
