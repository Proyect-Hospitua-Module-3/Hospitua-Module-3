// Feature 011 · Revisar temporada del año
import { InvalidCalendarRangeError } from '../../errors/pricing/invalid-calendar-range.error';
import { CalendarDate } from './calendar-date.vo';

// Rango de fechas civiles, inclusivo en los dos extremos (como en el API). Un solo día
// es un rango válido (start = end).
export class CalendarDateRange {
  private constructor(
    readonly start: CalendarDate,
    readonly end: CalendarDate,
  ) {}

  static of(start: CalendarDate, end: CalendarDate, what = 'El rango'): CalendarDateRange {
    if (end.isBefore(start)) {
      throw new InvalidCalendarRangeError(
        `${what} termina (${end.toString()}) antes de empezar (${start.toString()}).`,
      );
    }
    return new CalendarDateRange(start, end);
  }

  contains(date: CalendarDate): boolean {
    return !date.isBefore(this.start) && !date.isAfter(this.end);
  }

  // Días en común con otro rango, o null si no comparten ninguno.
  intersection(other: CalendarDateRange): CalendarDateRange | null {
    const start = this.start.isAfter(other.start) ? this.start : other.start;
    const end = this.end.isBefore(other.end) ? this.end : other.end;
    return end.isBefore(start) ? null : new CalendarDateRange(start, end);
  }

  // Recorre cada día del rango, en orden.
  *days(): Generator<CalendarDate> {
    for (let day = this.start.epochDay; day <= this.end.epochDay; day++) {
      yield CalendarDate.fromEpochDay(day);
    }
  }

  toString(): string {
    return this.start.equals(this.end)
      ? this.start.toString()
      : `${this.start.toString()} a ${this.end.toString()}`;
  }
}
