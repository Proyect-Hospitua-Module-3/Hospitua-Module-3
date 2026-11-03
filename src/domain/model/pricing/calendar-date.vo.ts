// Feature 011 · Revisar temporada del año
import { InvalidCalendarRangeError } from '../../errors/pricing/invalid-calendar-range.error';

const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

// Fecha civil del hotel (YYYY-MM-DD). No es un instante: nunca se convierte por zona
// horaria (plan 011, "Modelo de dominio y representación temporal").
//
// Internamente es un número de día (días desde 1970-01-01) calculado con aritmética
// entera, sin `Date`: así no hay desfases por zona horaria ni el problema de `Date` con
// los años 0..99. Los años válidos en la entrada son 1..9999.
export class CalendarDate {
  private constructor(readonly epochDay: number) {}

  // `field` solo se usa para el mensaje de error ("startDate", "from"…).
  static of(raw: unknown, field = 'fecha'): CalendarDate {
    const match = typeof raw === 'string' ? DATE_FORMAT.exec(raw) : null;
    if (!match) {
      throw new InvalidCalendarRangeError(`${field} debe ser una fecha con formato YYYY-MM-DD.`);
    }
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = CalendarDate.fromParts(year, month, day);
    const [y, m, d] = civilFromDays(date.epochDay);
    if (year < 1 || month < 1 || month > 12 || y !== year || m !== month || d !== day) {
      throw new InvalidCalendarRangeError(`${field} no es una fecha válida: ${String(raw)}.`);
    }
    return date;
  }

  static fromParts(year: number, month: number, day: number): CalendarDate {
    return new CalendarDate(daysFromCivil(year, month, day));
  }

  static fromEpochDay(epochDay: number): CalendarDate {
    return new CalendarDate(epochDay);
  }

  get year(): number {
    return civilFromDays(this.epochDay)[0];
  }

  addDays(days: number): CalendarDate {
    return new CalendarDate(this.epochDay + days);
  }

  isBefore(other: CalendarDate): boolean {
    return this.epochDay < other.epochDay;
  }

  isAfter(other: CalendarDate): boolean {
    return this.epochDay > other.epochDay;
  }

  equals(other: CalendarDate): boolean {
    return this.epochDay === other.epochDay;
  }

  toString(): string {
    const [y, m, d] = civilFromDays(this.epochDay);
    return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Algoritmos "days_from_civil" / "civil_from_days" (calendario gregoriano proléptico).
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(epochDay: number): [number, number, number] {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return [year, month, day];
}
