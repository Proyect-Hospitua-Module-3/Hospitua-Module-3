import { describe, expect, it, vi } from 'vitest';
import { getSeasonCalendar, publishSeasonCalendar } from './seasonCalendar';

function respond(body: unknown = { revision: 3 }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
}

describe('contrato HTTP del calendario 011', () => {
  it('consulta la ventana completa con JWT sin inventar filtros históricos', async () => {
    const fetchSpy = respond();
    await getSeasonCalendar('token-admin', { year: 2026, from: '2026-07-01', to: '2026-07-15' });
    const [url, init] = fetchSpy.mock.calls[0];
    const parsed = new URL(String(url), 'http://localhost');
    expect(parsed.pathname).toBe('/api/admin/season-calendar');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ year: '2026', from: '2026-07-01', to: '2026-07-15' });
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token-admin' });
    expect(init?.method).toBe('GET');
  });

  it.each([
    [{ year: 2026, revision: 2 }, { year: '2026', revision: '2' }],
    [{ year: 2026, asOf: '2026-07-04T05:00:00.000Z' }, { year: '2026', asOf: '2026-07-04T05:00:00.000Z' }],
  ])('preserva la selección histórica y la codifica en la URL', async (query, expected) => {
    const fetchSpy = respond();
    await getSeasonCalendar('admin', query);
    const parsed = new URL(String(fetchSpy.mock.calls[0][0]), 'http://localhost');
    expect(Object.fromEntries(parsed.searchParams)).toEqual(expected);
  });

  it('publica todas las entradas propias, conserva identidades y omite metadatos ajenos al contrato', async () => {
    const fetchSpy = respond({ year: 2026, revision: 4 });
    const entries = [
      { entryId: 'e6cfa8ed-8b7f-4cb4-bbf8-0678180d1f91', seasonId: 'alta', kind: 'BASE' as const, startDate: '2026-06-01', endDate: '2026-08-31', season: { name: 'No publicar', color: '#000000' }, changedBy: 'no-publicar' },
      { seasonId: 'evento', kind: 'EXCEPTION' as const, startDate: '2026-12-25', endDate: '2026-12-25', adjustmentPercent: '999' },
    ];
    await expect(publishSeasonCalendar('token-admin', 2026, entries, 3)).resolves.toEqual({ year: 2026, revision: 4 });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/admin/season-calendar/2026');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token-admin', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ expectedRevision: 3, entries: [
      { entryId: entries[0].entryId, seasonId: 'alta', kind: 'BASE', startDate: '2026-06-01', endDate: '2026-08-31' },
      { seasonId: 'evento', kind: 'EXCEPTION', startDate: '2026-12-25', endDate: '2026-12-25' },
    ] });
    expect(entries[0].changedBy).toBe('no-publicar');
  });

  it.each([null, 0])('permite publicar un año vacío con expectedRevision %s', async (revision) => {
    const fetchSpy = respond();
    await publishSeasonCalendar('admin', 2026, [], revision);
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({ expectedRevision: revision, entries: [] });
  });

  it('propaga el conflicto de revisión para que la página conserve el borrador', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ errorCode: 'SEASON_CALENDAR_CONFLICT', message: 'Otro Administrador publicó la revisión 4.' }), { status: 409 }));
    await expect(publishSeasonCalendar('admin', 2026, [], 3)).rejects.toMatchObject({ status: 409, errorCode: 'SEASON_CALENDAR_CONFLICT', message: 'Otro Administrador publicó la revisión 4.' });
  });
});
