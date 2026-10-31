// Feature 009 · Modificar precio tarifa según temporada
import { GetEffectiveSeasonRulesService } from '../../../src/application/services/pricing/get-effective-season-rules.service';
import { ModifySeasonRuleService } from '../../../src/application/services/pricing/modify-season-rule.service';
import { GetEffectiveSeasonRulesUseCase } from '../../../src/domain/ports/in/pricing/get-effective-season-rules.use-case';
import {
  InMemorySeasonRuleRepository,
  REGULAR_ID,
} from '../../support/pricing/in-memory-season-rule.repository';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// T022: contrato PORT-get-season-rules.md que consumirán 005 y 011.
describe('Contrato GetEffectiveSeasonRulesUseCase (009 → 005, 011)', () => {
  let repository: InMemorySeasonRuleRepository;
  let port: GetEffectiveSeasonRulesUseCase;

  beforeEach(async () => {
    repository = new InMemorySeasonRuleRepository();
    const admin = new ModifySeasonRuleService(repository, { isReferencedByActiveRevision: async () => false });
    await admin.create({ name: 'Festival', color: '#c0392b', adjustmentPercent: '25', actorId: 'admin' });
    await admin.update({ seasonId: REGULAR_ID, adjustmentPercent: '-2.5', actorId: 'admin' });
    port = new GetEffectiveSeasonRulesService(repository);
  });

  it('devuelve asOf, defaultSeasonId y seasons[] con los campos del contrato', async () => {
    const snapshot = await port.getAll(repository.tick());

    expect(Object.keys(snapshot).sort()).toEqual(['asOf', 'defaultSeasonId', 'seasons']);
    expect(snapshot.asOf).toMatch(ISO_UTC);
    expect(snapshot.defaultSeasonId).toBe(REGULAR_ID);
    for (const season of snapshot.seasons) {
      expect(Object.keys(season).sort()).toEqual(
        ['adjustmentPercent', 'archivedAt', 'color', 'isDefault', 'name', 'seasonId', 'validFrom'].sort(),
      );
      expect(season.validFrom).toMatch(ISO_UTC);
    }
  });

  it('expresa el ajuste como decimal exacto en texto, con 2 decimales y signo', async () => {
    const snapshot = await port.getAll(repository.tick());

    expect(snapshot.seasons.map((s) => s.adjustmentPercent)).toEqual(['25.00', '-2.50']);
    snapshot.seasons.forEach((s) => expect(typeof s.adjustmentPercent).toBe('string'));
  });

  it('expresa el color como #RRGGBB en mayúsculas', async () => {
    const snapshot = await port.getAll(repository.tick());

    expect(snapshot.seasons.map((s) => s.color)).toEqual(['#C0392B', '#808080']);
  });

  it('marca exactamente una temporada como predeterminada', async () => {
    const snapshot = await port.getAll(repository.tick());

    expect(snapshot.seasons.filter((s) => s.isDefault)).toHaveLength(1);
  });

  it('ordena por nombre normalizado de forma determinista', async () => {
    const first = await port.getAll(repository.tick());
    const second = await port.getAll(new Date(first.asOf));

    expect(first.seasons.map((s) => s.name)).toEqual(['Festival', 'Regular']);
    expect(second).toEqual(first);
  });

  it('las temporadas activas tienen archivedAt nulo', async () => {
    const snapshot = await port.getAll(repository.tick());

    snapshot.seasons.forEach((s) => expect(s.archivedAt).toBeNull());
  });
});
