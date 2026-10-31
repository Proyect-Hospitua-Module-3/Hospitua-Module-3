// Feature 011 · Revisar temporada del año
// T019: contrato PORT-resolve-season-by-date.md (proveedor 011, consumidor 005).
import { ReplaceSeasonCalendarService } from '../../../src/application/services/pricing/replace-season-calendar.service';
import { ResolveSeasonByDateService } from '../../../src/application/services/pricing/resolve-season-by-date.service';
import { ReviewSeasonCalendarService } from '../../../src/application/services/pricing/review-season-calendar.service';
import { ResolveSeasonByDateUseCase } from '../../../src/domain/ports/in/pricing/resolve-season-by-date.use-case';
import {
  ALTA_ID,
  BAJA_ID,
  EVENTO_ID,
  FakeSeasonCatalog,
} from '../../support/pricing/fake-season-catalog';
import {
  InMemorySeasonCalendarRepository,
  steppingClock,
} from '../../support/pricing/in-memory-season-calendar.repository';
import { REGULAR_ID } from '../../support/pricing/in-memory-season-rule.repository';

const ADMIN = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';
const NAVIDAD = '7995b0b5-14b6-4d37-9827-40246f45e1c2';
const VERANO = 'e6cfa8ed-8b7f-4cb4-bbf8-0678180d1f91';
const CUATRO_JULIO = '27c4d2a6-f4ec-42db-b143-8c817bdb8e98';

describe('Contrato ResolveSeasonByDateUseCase (011 → 005)', () => {
  let repository: InMemorySeasonCalendarRepository;
  let port: ResolveSeasonByDateUseCase;
  let publisher: ReplaceSeasonCalendarService;

  beforeEach(() => {
    const catalog = new FakeSeasonCatalog();
    repository = new InMemorySeasonCalendarRepository(steppingClock(), (ids) =>
      catalog.activeIds(ids),
    );
    port = new ResolveSeasonByDateService(repository, catalog);
    publisher = new ReplaceSeasonCalendarService(
      repository,
      new ReviewSeasonCalendarService(repository, catalog),
    );
  });

  const publish = (year: number, entries: object[], expectedRevision?: number) =>
    publisher.replace({ year, entries, expectedRevision, actorId: ADMIN });

  async function publishExample() {
    await publish(2025, [
      {
        entryId: NAVIDAD,
        seasonId: ALTA_ID,
        kind: 'BASE',
        startDate: '2025-12-20',
        endDate: '2026-01-10',
      },
    ]);
    await publish(2026, [
      {
        entryId: VERANO,
        seasonId: BAJA_ID,
        kind: 'BASE',
        startDate: '2026-06-01',
        endDate: '2026-08-31',
      },
      {
        entryId: CUATRO_JULIO,
        seasonId: EVENTO_ID,
        kind: 'EXCEPTION',
        startDate: '2026-07-04',
        endDate: '2026-07-04',
      },
    ]);
    return new Date(Date.UTC(2030, 0, 1));
  }

  it('EXCEPTION: devuelve la temporada de la excepción con su revisión (ejemplo del contrato)', async () => {
    const asOf = await publishExample();
    const own = repository.active(2026)!;

    expect(await port.resolve({ date: '2026-07-04', asOf })).toEqual({
      date: '2026-07-04',
      seasonId: EVENTO_ID,
      source: 'EXCEPTION',
      entryId: CUATRO_JULIO,
      calendarYear: 2026,
      revision: 1,
      calendarEffectiveAt: own.effectiveAt.toISOString(),
      entryOwnerYear: 2026,
      entryOwnerRevision: 1,
      entryOwnerEffectiveAt: own.effectiveAt.toISOString(),
    });
  });

  it('BASE propio', async () => {
    const asOf = await publishExample();
    expect(await port.resolve({ date: '2026-08-31', asOf })).toMatchObject({
      seasonId: BAJA_ID,
      source: 'BASE',
      entryId: VERANO,
    });
  });

  it('BASE heredado del año anterior: calendarYear/revision son del año de la fecha y entryOwner* del año dueño', async () => {
    const asOf = await publishExample();
    const previous = repository.active(2025)!;

    expect(await port.resolve({ date: '2026-01-05', asOf })).toMatchObject({
      seasonId: ALTA_ID,
      source: 'BASE',
      entryId: NAVIDAD,
      calendarYear: 2026,
      revision: 1,
      entryOwnerYear: 2025,
      entryOwnerRevision: 1,
      entryOwnerEffectiveAt: previous.effectiveAt.toISOString(),
    });
  });

  it('DEFAULT: el defaultSeasonId de 009, con entryId y entryOwner* en null', async () => {
    const asOf = await publishExample();
    expect(await port.resolve({ date: '2026-03-15', asOf })).toMatchObject({
      seasonId: REGULAR_ID,
      source: 'DEFAULT',
      entryId: null,
      calendarYear: 2026,
      revision: 1,
      entryOwnerYear: null,
      entryOwnerRevision: null,
      entryOwnerEffectiveAt: null,
    });
  });

  it('sin revisión propia: revision 0 y calendarEffectiveAt null, pero sigue mirando el año anterior', async () => {
    await publish(2026, [
      {
        entryId: NAVIDAD,
        seasonId: ALTA_ID,
        kind: 'BASE',
        startDate: '2026-12-20',
        endDate: '2027-01-10',
      },
    ]);
    const asOf = new Date(Date.UTC(2030, 0, 1));

    expect(await port.resolve({ date: '2027-01-02', asOf })).toMatchObject({
      source: 'BASE',
      calendarYear: 2027,
      revision: 0,
      calendarEffectiveAt: null,
      entryOwnerYear: 2026,
    });
    expect(await port.resolve({ date: '2027-02-02', asOf })).toMatchObject({
      source: 'DEFAULT',
      revision: 0,
    });
  });

  it('un asOf anterior a una publicación no la ve: no se mezclan revisiones (NFR-003)', async () => {
    await publish(2026, [
      { seasonId: ALTA_ID, kind: 'BASE', startDate: '2026-06-01', endDate: '2026-08-31' },
    ]);
    const beforeChange = new Date(repository.active(2026)!.effectiveAt.getTime() + 500);
    await publish(
      2026,
      [{ seasonId: BAJA_ID, kind: 'BASE', startDate: '2026-06-01', endDate: '2026-08-31' }],
      1,
    );

    expect(await port.resolve({ date: '2026-07-01', asOf: beforeChange })).toMatchObject({
      seasonId: ALTA_ID,
      revision: 1,
    });
    expect(
      await port.resolve({ date: '2026-07-01', asOf: new Date(Date.UTC(2030, 0, 1)) }),
    ).toMatchObject({
      seasonId: BAJA_ID,
      revision: 2,
    });
  });

  it('es determinista: misma fecha y mismo asOf dan el mismo resultado', async () => {
    const asOf = await publishExample();
    const first = await port.resolve({ date: '2026-07-04', asOf });
    expect(await port.resolve({ date: '2026-07-04', asOf })).toEqual(first);
  });
});
