import { describe, expect, it } from 'vitest';
import type {
  CalendarEntry,
  CalendarEntryInput,
  CalendarSeason,
  CarriedInEntry,
  SeasonCalendar,
} from '../api/seasonCalendar';
import {
  calendarDefaultRanges,
  calendarEntriesToDraft,
  calendarMonthDays,
  calendarWeekday,
  calendarYearBounds,
  draftCalendarEntries,
  formatCalendarDate,
  isCalendarDate,
  parseCalendarQuery,
  resolveCalendarDate,
  validateCalendarDraft,
  validateCalendarEntry,
} from './seasonCalendar';

const REGULAR: CalendarSeason = {
  seasonId: 'regular', name: 'Regular', color: '#808080', adjustmentPercent: '-2.50',
};
const ALTA: CalendarSeason = {
  seasonId: 'alta', name: 'Alta', color: '#E67E22', adjustmentPercent: '20.00',
};
const EVENTO: CalendarSeason = {
  seasonId: 'evento', name: 'Evento', color: '#8E44AD', adjustmentPercent: '50.00',
};
const SEASONS = [REGULAR, ALTA, EVENTO];
const ENTRY_ID = 'e6cfa8ed-8b7f-4cb4-bbf8-0678180d1f91';
const OTHER_ID = '27c4d2a6-f4ec-42db-b143-8c817bdb8e98';

function base(overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    entryId: ENTRY_ID, kind: 'BASE', startDate: '2026-06-01', endDate: '2026-08-31',
    season: ALTA, ...overrides,
  };
}

function input(overrides: Partial<CalendarEntryInput> = {}): CalendarEntryInput {
  return { seasonId: 'alta', kind: 'BASE', startDate: '2026-06-01', endDate: '2026-08-31', ...overrides };
}

function inherited(overrides: Partial<CarriedInEntry> = {}): CarriedInEntry {
  return {
    ...base({ startDate: '2025-12-20', endDate: '2026-01-10' }),
    ownerYear: 2025, ownerRevision: 3, ...overrides,
  };
}

const QUERY = { year: '2026', from: '', to: '', mode: 'current' as const, revision: '', asOf: '' };

describe('fechas civiles del calendario 011', () => {
  it.each([
    ['2024-02-29', true], ['2000-02-29', true], ['1900-02-29', false],
    ['2026-02-29', false], ['2026-04-31', false], ['0001-01-01', true],
    ['0099-12-31', true], ['0000-01-01', false], ['2026-13-01', false],
    ['2026-1-01', false], ['2026-01-00', false], ['10000-01-01', false],
  ])('valida %s sin normalizar fechas inexistentes', (date, valid) => {
    expect(isCalendarDate(date)).toBe(valid);
  });

  it('genera el 29 de febrero únicamente en años bisiestos', () => {
    expect(calendarMonthDays(2024, 2)).toHaveLength(29);
    expect(calendarMonthDays(2026, 2)).toHaveLength(28);
    expect(calendarMonthDays(2000, 2).at(-1)).toBe('2000-02-29');
    expect(calendarMonthDays(1900, 2).at(-1)).toBe('1900-02-28');
  });

  it('conserva los años 1 a 99 y su día gregoriano sin convertirlos al siglo XX', () => {
    expect(calendarYearBounds(1)).toEqual({ from: '0001-01-01', to: '0001-12-31' });
    expect(calendarMonthDays(99, 1)[0]).toBe('0099-01-01');
    expect(calendarWeekday('0001-01-01')).toBe(0); // Lunes.
    expect(calendarWeekday('0099-01-01')).toBe(3); // Jueves.
    expect(formatCalendarDate('0099-01-01')).toBe('01 ene 0099');
    expect(() => calendarYearBounds(0)).toThrow(RangeError);
  });
});

describe('consulta actual o histórica del calendario', () => {
  it('la vista vigente ignora los campos de historial que no están seleccionados', () => {
    expect(parseCalendarQuery({ ...QUERY, revision: '8', asOf: '2026-07-04T00:00' })).toEqual({
      ok: true, query: { year: 2026 },
    });
  });

  it('envía revisión y omite asOf aunque el otro campo conserve un valor', () => {
    expect(parseCalendarQuery({ ...QUERY, mode: 'revision', revision: '3', asOf: '2026-07-04T00:00' })).toEqual({
      ok: true, query: { year: 2026, revision: 3 },
    });
  });

  it('convierte la hora de Colombia a UTC y omite revision', () => {
    expect(parseCalendarQuery({ ...QUERY, mode: 'asOf', revision: '3', asOf: '2026-12-31T23:30' })).toEqual({
      ok: true, query: { year: 2026, asOf: '2027-01-01T04:30:00.000Z' },
    });
  });

  it('acepta una ventana inclusiva de un día en el año consultado', () => {
    expect(parseCalendarQuery({ ...QUERY, from: '2026-07-04', to: '2026-07-04' })).toEqual({
      ok: true, query: { year: 2026, from: '2026-07-04', to: '2026-07-04' },
    });
  });

  it.each([
    [{ year: '0' }, 'year'],
    [{ year: '2026.5' }, 'year'],
    [{ from: '2026-06-01' }, 'to'],
    [{ to: '2026-06-01' }, 'from'],
    [{ from: '2026-07-02', to: '2026-07-01' }, 'to'],
    [{ from: '2025-12-31', to: '2026-01-01' }, 'from'],
    [{ from: '2026-12-31', to: '2027-01-01' }, 'to'],
    [{ from: '2026-02-30', to: '2026-03-01' }, 'from'],
    [{ mode: 'revision' as const, revision: '0' }, 'revision'],
    [{ mode: 'revision' as const, revision: '1.5' }, 'revision'],
    [{ mode: 'asOf' as const, asOf: '2026-02-30T12:00' }, 'asOf'],
    [{ mode: 'asOf' as const, asOf: '2026-07-04T24:00' }, 'asOf'],
  ])('rechaza una consulta inválida sin resultado parcial: %j', (patch, field) => {
    const parsed = parseCalendarQuery({ ...QUERY, ...patch });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors).toHaveProperty(field);
    expect(parsed).not.toHaveProperty('query');
  });
});

describe('clasificación visible por fecha', () => {
  it('resuelve EXCEPTION sobre BASE y distingue Regular explícita de DEFAULT', () => {
    const exception = base({ entryId: OTHER_ID, kind: 'EXCEPTION', startDate: '2026-07-04', endDate: '2026-07-04', season: EVENTO });
    const entries = [base(), exception, base({ entryId: 'regular-base', startDate: '2026-09-01', endDate: '2026-09-02', season: REGULAR })];
    expect(resolveCalendarDate('2026-07-04', entries, [], REGULAR)).toMatchObject({ source: 'EXCEPTION', season: EVENTO, entry: exception });
    expect(resolveCalendarDate('2026-06-01', entries, [], REGULAR)).toMatchObject({ source: 'BASE', season: ALTA });
    expect(resolveCalendarDate('2026-08-31', entries, [], REGULAR).source).toBe('BASE');
    expect(resolveCalendarDate('2026-09-01', entries, [], REGULAR)).toMatchObject({ source: 'BASE', season: REGULAR });
    expect(resolveCalendarDate('2026-09-03', entries, [], REGULAR)).toMatchObject({ source: 'DEFAULT', season: REGULAR, entry: null });
  });

  it('hereda el BASE anterior hasta su último día y admite una excepción propia', () => {
    const previous = inherited();
    const exception = base({ kind: 'EXCEPTION', startDate: '2026-01-04', endDate: '2026-01-04', season: EVENTO });
    expect(resolveCalendarDate('2026-01-10', [], [previous], REGULAR)).toMatchObject({ source: 'BASE', inherited: true, entry: previous });
    expect(resolveCalendarDate('2026-01-04', [exception], [previous], REGULAR)).toMatchObject({ source: 'EXCEPTION', inherited: false, season: EVENTO });
    expect(resolveCalendarDate('2026-01-11', [], [previous], REGULAR).source).toBe('DEFAULT');
  });

  it('dos BASE siguen siendo conflicto aunque una excepción cubra ese día', () => {
    const entries = [base(), base({ entryId: 'second-base' }), base({ entryId: 'exception', kind: 'EXCEPTION', startDate: '2026-07-04', endDate: '2026-07-04', season: EVENTO })];
    const resolved = resolveCalendarDate('2026-07-04', entries, [], REGULAR);
    expect(resolved).toMatchObject({ source: 'CONFLICT', season: null, entry: null });
    expect(resolved.conflicts).toContainEqual(expect.objectContaining({ code: 'OVERLAPPING_SEASON_CALENDAR', blocking: true }));
  });

  it('dos excepciones y una referencia inexistente nunca caen a DEFAULT', () => {
    const first = base({ kind: 'EXCEPTION', startDate: '2026-07-04', endDate: '2026-07-04' });
    expect(resolveCalendarDate('2026-07-04', [first, { ...first, entryId: OTHER_ID }], [], REGULAR).conflicts).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_SEASON_EXCEPTION' }));
    const missing = base({ season: { seasonId: 'retirada', name: null, color: null, adjustmentPercent: null } });
    expect(resolveCalendarDate('2026-07-04', [missing], [], REGULAR)).toMatchObject({ source: 'CONFLICT', season: null });
  });

  it('respeta los conflictos del servidor únicamente en las fechas señaladas', () => {
    const conflict = { code: 'OVERLAPPING_SEASON_CALENDAR' as const, blocking: true as const, dates: { from: '2026-07-04', to: '2026-07-05' }, entryIds: [ENTRY_ID], message: 'Datos inconsistentes' };
    expect(resolveCalendarDate('2026-07-04', [base()], [], REGULAR, [conflict]).source).toBe('CONFLICT');
    expect(resolveCalendarDate('2026-07-06', [base()], [], REGULAR, [conflict]).source).toBe('BASE');
  });

  it('agrupa huecos DEFAULT excluyendo heredados, bases y excepciones', () => {
    const exception = base({ kind: 'EXCEPTION', startDate: '2026-01-15', endDate: '2026-01-15' });
    const own = base({ startDate: '2026-01-20', endDate: '2026-12-31' });
    expect(calendarDefaultRanges(2026, [exception, own], [inherited()], REGULAR)).toEqual([
      { from: '2026-01-11', to: '2026-01-14', resolvedAs: 'DEFAULT' },
      { from: '2026-01-16', to: '2026-01-19', resolvedAs: 'DEFAULT' },
    ]);
  });
});

describe('validación de la revisión completa antes de publicar', () => {
  it('acepta bases hasta el año siguiente y excepciones sobre bases propias o heredadas', () => {
    const entries = [input({ startDate: '2026-12-20', endDate: '2027-01-10' }), input({ kind: 'EXCEPTION', startDate: '2026-12-25', endDate: '2026-12-25' }), input({ kind: 'EXCEPTION', startDate: '2026-01-04', endDate: '2026-01-04' })];
    expect(validateCalendarDraft(2026, entries, [inherited()], SEASONS)).toEqual([]);
    expect(validateCalendarDraft(2026, [], [inherited()], SEASONS)).toEqual([]);
  });

  it.each([
    [{ seasonId: 'retirada' }, 'seasonId'],
    [{ startDate: '2025-12-31' }, 'startDate'],
    [{ startDate: '2026-02-30' }, 'startDate'],
    [{ endDate: '2026-05-31' }, 'endDate'],
    [{ endDate: '2028-01-01' }, 'endDate'],
    [{ kind: 'EXCEPTION' as const }, 'endDate'],
  ])('señala el campo inválido de una asignación: %j', (patch, field) => {
    expect(validateCalendarEntry(2026, input(patch), SEASONS)).toHaveProperty(field);
  });

  it('considera solapamiento compartir un único día, incluso con la misma temporada', () => {
    const issues = validateCalendarDraft(2026, [input(), input({ startDate: '2026-08-31', endDate: '2026-09-01' })], [], SEASONS);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'OVERLAPPING_SEASON_CALENDAR', dates: { from: '2026-08-31', to: '2026-08-31' }, entryIndexes: [0, 1] }));
  });

  it('detecta conflictos con heredados y dos excepciones para el mismo día', () => {
    const issues = validateCalendarDraft(2026, [input({ startDate: '2026-01-10', endDate: '2026-01-12' }), input({ kind: 'EXCEPTION', startDate: '2026-07-04', endDate: '2026-07-04' }), input({ kind: 'EXCEPTION', seasonId: 'evento', startDate: '2026-07-04', endDate: '2026-07-04' })], [inherited()], SEASONS);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'OVERLAPPING_SEASON_CALENDAR', entryIndexes: [0] }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_SEASON_EXCEPTION', entryIndexes: [1, 2] }));
  });

  it('rechaza identidades duplicadas o inválidas antes de enviar la revisión', () => {
    expect(validateCalendarDraft(2026, [input({ entryId: ENTRY_ID }), input({ entryId: ENTRY_ID.toUpperCase(), startDate: '2026-09-01', endDate: '2026-09-02' })], [], SEASONS)).toContainEqual(expect.objectContaining({ code: 'INVALID_CALENDAR_RANGE', entryIndexes: [0, 1] }));
    expect(validateCalendarDraft(2026, [input({ entryId: 'draft-0' })], [], SEASONS)).toContainEqual(expect.objectContaining({ code: 'INVALID_CALENDAR_RANGE' }));
  });

  it('conserva todas las entradas propias e identidades al crear el borrador y excluye heredadas', () => {
    const own = [base(), base({ entryId: OTHER_ID, startDate: '2026-12-20', endDate: '2027-01-10' })];
    const calendar: SeasonCalendar = { year: 2026, asOf: '2026-11-01T00:00:00.000Z', revision: 2, effectiveAt: null, changedAt: null, changedBy: null, defaultSeason: REGULAR, entries: own, carriedInEntries: [inherited()], unclassifiedRanges: [], conflicts: [] };
    const draft = calendarEntriesToDraft(calendar);
    expect(draft).toEqual([
      { entryId: ENTRY_ID, seasonId: 'alta', kind: 'BASE', startDate: '2026-06-01', endDate: '2026-08-31' },
      { entryId: OTHER_ID, seasonId: 'alta', kind: 'BASE', startDate: '2026-12-20', endDate: '2027-01-10' },
    ]);
    expect(draftCalendarEntries(draft, SEASONS)).toEqual(own);
    draft[0].startDate = '2026-06-02';
    expect(calendar.entries[0].startDate).toBe('2026-06-01');
  });

  it('una temporada ausente conserva la referencia y se destaca como conflicto en la vista previa', () => {
    const [preview] = draftCalendarEntries([input({ seasonId: 'retirada' })], SEASONS);
    expect(preview.season).toEqual({ seasonId: 'retirada', name: null, color: null, adjustmentPercent: null });
    expect(resolveCalendarDate('2026-07-04', [preview], [], REGULAR).source).toBe('CONFLICT');
  });
});
