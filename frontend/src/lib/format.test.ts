import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatDateTimeShort, formatPercent, NBSP } from './format';

describe('formatPercent', () => {
  it.each([
    ['19.00', `19${NBSP}%`],
    ['16.50', `16,5${NBSP}%`],
    ['0.00', `0${NBSP}%`],
    ['100.00', `100${NBSP}%`],
    ['12.25', `12,25${NBSP}%`],
  ])('%s → %s', (value, expected) => {
    expect(formatPercent(value)).toBe(expected);
  });
});

describe('fechas en la hora del hotel (Colombia, UTC−5)', () => {
  // 2026-01-01T05:00Z es la medianoche del 1 de enero en Bogotá.
  const NEW_YEAR = '2026-01-01T05:00:00.000Z';

  it('formatDate: "01 ene 2026"', () => {
    expect(formatDate(NEW_YEAR)).toBe('01 ene 2026');
  });

  it('formatDateTime: "01 ene 2026 · 00:00" (tabla de historial)', () => {
    expect(formatDateTime(NEW_YEAR)).toBe('01 ene 2026 · 00:00');
  });

  it('formatDateTimeShort: "23 sep 2026, 11:52" (aviso de guardado)', () => {
    expect(formatDateTimeShort('2026-09-23T16:52:00.000Z')).toBe('23 sep 2026, 11:52');
  });

  it('usa la fecha de Colombia aunque en UTC ya sea otro día', () => {
    expect(formatDate('2026-07-16T03:00:00.000Z')).toBe('15 jul 2026');
  });
});
