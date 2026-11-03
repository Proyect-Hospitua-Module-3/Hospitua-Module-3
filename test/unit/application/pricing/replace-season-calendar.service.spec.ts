// Feature 011 · Revisar temporada del año
// T027, T028: publicación por reemplazo completo del año.
import { ReplaceSeasonCalendarService } from '../../../../src/application/services/pricing/replace-season-calendar.service';
import { ReviewSeasonCalendarService } from '../../../../src/application/services/pricing/review-season-calendar.service';
import { DuplicateSeasonExceptionError } from '../../../../src/domain/errors/pricing/duplicate-season-exception.error';
import { InvalidCalendarRangeError } from '../../../../src/domain/errors/pricing/invalid-calendar-range.error';
import { OverlappingSeasonCalendarError } from '../../../../src/domain/errors/pricing/overlapping-season-calendar.error';
import { SeasonCalendarConflictError } from '../../../../src/domain/errors/pricing/season-calendar-conflict.error';
import { UnknownSeasonReferenceError } from '../../../../src/domain/errors/pricing/unknown-season-reference.error';
import {
  ALTA_ID,
  EVENTO_ID,
  FakeSeasonCatalog,
  RETIRADA_ID,
} from '../../../support/pricing/fake-season-catalog';
import {
  InMemorySeasonCalendarRepository,
  steppingClock,
} from '../../../support/pricing/in-memory-season-calendar.repository';

const ADMIN = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';
const KEPT_ID = 'e6cfa8ed-8b7f-4cb4-bbf8-0678180d1f91';

const base = (startDate: string, endDate: string, seasonId = ALTA_ID) => ({
  seasonId,
  kind: 'BASE',
  startDate,
  endDate,
});
const exception = (date: string, seasonId = EVENTO_ID) => ({
  seasonId,
  kind: 'EXCEPTION',
  startDate: date,
  endDate: date,
});

describe('ReplaceSeasonCalendarService', () => {
  let catalog: FakeSeasonCatalog;
  let repository: InMemorySeasonCalendarRepository;
  let service: ReplaceSeasonCalendarService;

  beforeEach(() => {
    catalog = new FakeSeasonCatalog();
    repository = new InMemorySeasonCalendarRepository(steppingClock(), (ids) =>
      catalog.activeIds(ids),
    );
    let n = 0;
    service = new ReplaceSeasonCalendarService(
      repository,
      new ReviewSeasonCalendarService(repository, catalog),
      () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    );
  });

  function publish(year: unknown, entries: unknown, expectedRevision?: unknown) {
    return service.replace({ year, entries, expectedRevision, actorId: ADMIN });
  }

  it('publica la primera revisión y responde con el calendario efectivo', async () => {
    const view = await publish(
      2026,
      [base('2026-06-01', '2026-08-31'), exception('2026-07-04')],
      null,
    );

    expect(view).toMatchObject({ year: 2026, revision: 1, changedBy: ADMIN, conflicts: [] });
    expect(view.effectiveAt).toEqual(expect.any(Date));
    expect(view.entries).toEqual([
      expect.objectContaining({
        kind: 'BASE',
        startDate: '2026-06-01',
        endDate: '2026-08-31',
        season: expect.objectContaining({ seasonId: ALTA_ID, name: 'Temporada alta' }),
      }),
      expect.objectContaining({
        kind: 'EXCEPTION',
        startDate: '2026-07-04',
        season: expect.objectContaining({ seasonId: EVENTO_ID }),
      }),
    ]);
    expect(view.unclassifiedRanges).toEqual([
      { from: '2026-01-01', to: '2026-05-31', resolvedAs: 'DEFAULT' },
      { from: '2026-09-01', to: '2026-12-31', resolvedAs: 'DEFAULT' },
    ]);
  });

  it('reemplaza el año completo: lo que no se envía queda eliminado y la revisión anterior se conserva (FR-009)', async () => {
    await publish(2026, [
      { ...base('2026-06-01', '2026-08-31'), entryId: KEPT_ID },
      exception('2026-07-04'),
    ]);

    const view = await publish(
      2026,
      [{ ...base('2026-06-01', '2026-09-15'), entryId: KEPT_ID }],
      1,
    );

    expect(view.revision).toBe(2);
    expect(view.entries).toEqual([
      expect.objectContaining({ entryId: KEPT_ID, endDate: '2026-09-15' }),
    ]);
    const first = await repository.findByNumber(2026, 1);
    expect(first?.entries).toHaveLength(2);
    expect(repository.active(2026)?.revision).toBe(2);
  });

  it('acepta una lista vacía: el año queda sin clasificación propia', async () => {
    const view = await publish(2026, []);
    expect(view.entries).toEqual([]);
    expect(view.unclassifiedRanges).toEqual([
      { from: '2026-01-01', to: '2026-12-31', resolvedAs: 'DEFAULT' },
    ]);
  });

  it('rechaza un expectedRevision desactualizado y conserva la revisión ganadora', async () => {
    await publish(2026, [base('2026-06-01', '2026-08-31')], null);
    await publish(2026, [base('2026-06-01', '2026-07-31')], 1);

    await expect(publish(2026, [], 1)).rejects.toThrow(SeasonCalendarConflictError);
    await expect(publish(2026, [], null)).rejects.toThrow(SeasonCalendarConflictError);
    expect(repository.active(2026)?.revision).toBe(2);
  });

  it.each([
    ['inexistente', '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b'],
    ['retirada', RETIRADA_ID],
  ])('rechaza una temporada %s sin publicar nada (FR-010)', async (_case, seasonId) => {
    await expect(publish(2026, [base('2026-06-01', '2026-08-31', seasonId)])).rejects.toThrow(
      UnknownSeasonReferenceError,
    );
    expect(repository.stored).toHaveLength(0);
  });

  it('rechaza excepciones duplicadas y BASE solapados sin publicar nada', async () => {
    await expect(publish(2026, [exception('2026-07-04'), exception('2026-07-04')])).rejects.toThrow(
      DuplicateSeasonExceptionError,
    );
    await expect(
      publish(2026, [base('2026-06-01', '2026-06-30'), base('2026-06-15', '2026-07-15')]),
    ).rejects.toThrow(OverlappingSeasonCalendarError);
    expect(repository.stored).toHaveLength(0);
  });

  it('acepta una excepción sobre un BASE (T028)', async () => {
    await expect(
      publish(2026, [base('2026-06-01', '2026-08-31'), exception('2026-07-04')]),
    ).resolves.toMatchObject({ revision: 1 });
  });

  describe('solapes BASE entre años vecinos (T040)', () => {
    it('al publicar el año siguiente con un BASE incompatible con el heredado', async () => {
      await publish(2026, [base('2026-12-20', '2027-01-10')]);
      await expect(publish(2027, [base('2027-01-05', '2027-01-31')])).rejects.toThrow(
        OverlappingSeasonCalendarError,
      );
      await expect(publish(2027, [base('2027-01-11', '2027-01-31')])).resolves.toMatchObject({
        revision: 1,
      });
    });

    it('al publicar el año de inicio con un BASE que cruza sobre uno ya publicado', async () => {
      await publish(2027, [base('2027-01-05', '2027-01-31')]);
      await expect(publish(2026, [base('2026-12-20', '2027-01-10')])).rejects.toThrow(
        OverlappingSeasonCalendarError,
      );
      await expect(publish(2026, [base('2026-12-20', '2027-01-04')])).resolves.toMatchObject({
        revision: 1,
      });
    });
  });

  it('valida la forma antes de tocar el repositorio', async () => {
    const spy = jest.spyOn(repository, 'publish');
    await expect(publish(2026, [base('2025-12-31', '2026-01-10')])).rejects.toThrow(
      InvalidCalendarRangeError,
    );
    await expect(publish('20x6', [])).rejects.toThrow(InvalidCalendarRangeError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('no publica si no puede registrar quién hizo el cambio (NFR-004)', async () => {
    const spy = jest.spyOn(repository, 'publish');
    await expect(service.replace({ year: 2026, entries: [], actorId: ' ' })).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
