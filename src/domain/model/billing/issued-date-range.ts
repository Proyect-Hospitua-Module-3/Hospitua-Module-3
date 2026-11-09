// Feature 008 · Gestionar facturación
// Rango de fechas de emisión y zona horaria de referencia (NFR-006, plan 008 «Zona horaria»).
import { InvalidInvoiceQueryError } from '../../errors/billing/invalid-invoice-query.error';
import { InvalidIssuedDateRangeError } from '../../errors/billing/invalid-issued-date-range.error';

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Días de calendario YYYY-MM-DD, ya validados: issuedFrom <= issuedTo, ambos inclusive.
export interface IssuedDateRange {
  readonly issuedFrom: string;
  readonly issuedTo: string;
}

// El mismo rango como instantes: [issuedFrom 00:00, issuedTo + 1 día 00:00) en la zona de
// referencia. Semiabierto para que una factura de las 23:59:59.999 entre y una de las 00:00
// del día siguiente no.
export interface IssuedInterval {
  readonly from: Date;
  readonly before: Date;
}

// Valida el par de fechas (FR-013). Una fecha mal escrita o inexistente (2026-02-30) es un
// error de formato; si falta una de las dos o están invertidas, el rango es inválido.
// required: el resumen exige el rango; en la búsqueda es opcional (undefined = sin rango).
export function parseIssuedDateRange(
  issuedFrom: string | undefined,
  issuedTo: string | undefined,
  required: boolean,
): IssuedDateRange | undefined {
  if (issuedFrom !== undefined) assertCalendarDate('issuedFrom', issuedFrom);
  if (issuedTo !== undefined) assertCalendarDate('issuedTo', issuedTo);

  if (issuedFrom === undefined && issuedTo === undefined) {
    if (!required) return undefined;
    throw new InvalidIssuedDateRangeError(
      'Envía issuedFrom e issuedTo (YYYY-MM-DD): el rango de fechas de emisión es obligatorio.',
    );
  }
  if (issuedFrom === undefined || issuedTo === undefined) {
    throw new InvalidIssuedDateRangeError(
      'Envía issuedFrom e issuedTo juntos: el rango de fechas de emisión necesita las dos fechas.',
    );
  }
  // YYYY-MM-DD válidos se comparan bien como texto.
  if (issuedFrom > issuedTo) {
    throw new InvalidIssuedDateRangeError(
      `La fecha de inicio (${issuedFrom}) es posterior a la fecha de fin (${issuedTo}).`,
    );
  }
  return { issuedFrom, issuedTo };
}

// Convierte el rango a instantes en la zona de referencia (NFR-006). Funciona con cualquier
// zona IANA; America/Bogota no tiene horario de verano, así que siempre es UTC−5.
export function issuedIntervalOf(range: IssuedDateRange, timeZone: string): IssuedInterval {
  return {
    from: startOfDay(range.issuedFrom, timeZone),
    before: startOfDay(nextDay(range.issuedTo), timeZone),
  };
}

// Zona IANA reconocida por el runtime (p. ej. America/Bogota).
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function assertCalendarDate(name: string, value: string): void {
  if (!isIssuedCalendarDate(value)) {
    throw new InvalidInvoiceQueryError(
      `${name} debe ser una fecha real con formato YYYY-MM-DD, por ejemplo 2026-12-01.`,
    );
  }
}

// Compartida por los rangos y el instante asOf: Date normaliza días inexistentes.
export function isIssuedCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  return (
    match !== null &&
    (() => {
      const [year, month, day] = match.slice(1).map(Number);
      const date = utcDate(year, month, day);
      return (
        year >= 1 &&
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    })()
  );
}

function nextDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(utcDate(year, month, date).getTime() + DAY_MS);
  return `${String(next.getUTCFullYear()).padStart(4, '0')}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

// Las 00:00 de ese día en la zona. Se corrige dos veces con el desfase de la zona para
// cubrir los días con cambio de horario.
function startOfDay(day: string, timeZone: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  const wallClock = utcDate(year, month, date).getTime();
  const firstGuess = wallClock - offsetOf(wallClock, timeZone);
  return new Date(wallClock - offsetOf(firstGuess, timeZone));
}

// Desfase de la zona respecto de UTC en ese instante, en milisegundos (Bogotá: −5 h).
function offsetOf(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  const asUtc = utcDate(
    part('year'),
    part('month'),
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  ).getTime();
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// Date.UTC interpreta 1..99 como 1901..1999. setUTCFullYear conserva el año civil.
function utcDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  result.setUTCHours(hour, minute, second, 0);
  return result;
}
