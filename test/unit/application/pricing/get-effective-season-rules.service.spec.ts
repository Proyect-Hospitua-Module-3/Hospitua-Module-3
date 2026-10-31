// Feature 009 · Modificar precio tarifa según temporada
import { GetEffectiveSeasonRulesService } from '../../../../src/application/services/pricing/get-effective-season-rules.service';
import { ModifySeasonRuleService } from '../../../../src/application/services/pricing/modify-season-rule.service';
import { SeasonCatalogInconsistentError } from '../../../../src/domain/errors/pricing/season-catalog-inconsistent.error';
import { SeasonRulesUnavailableError } from '../../../../src/domain/errors/pricing/season-rules-unavailable.error';
import {
  InMemorySeasonRuleRepository,
  REGULAR_ID,
} from '../../../support/pricing/in-memory-season-rule.repository';

const ADMIN = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';

// T021: el snapshot por asOf toma la versión vigente en ese instante, sin mezclar.
describe('GetEffectiveSeasonRulesService', () => {
  let repository: InMemorySeasonRuleRepository;
  let admin: ModifySeasonRuleService;
  let port: GetEffectiveSeasonRulesService;

  beforeEach(() => {
    repository = new InMemorySeasonRuleRepository();
    admin = new ModifySeasonRuleService(repository, { isReferencedByActiveRevision: async () => false });
    port = new GetEffectiveSeasonRulesService(repository);
  });

  it('un asOf anterior a un cambio ve el ajuste anterior; uno posterior, el nuevo', async () => {
    const before = repository.tick();
    await admin.update({ seasonId: REGULAR_ID, adjustmentPercent: '10', actorId: ADMIN });
    const after = repository.tick();

    expect((await port.getAll(before)).seasons[0].adjustmentPercent).toBe('0.00');
    expect((await port.getAll(after)).seasons[0].adjustmentPercent).toBe('10.00');
  });

  it('una temporada creada después de asOf no aparece', async () => {
    const before = repository.tick();
    await admin.create({ name: 'Alta', color: '#E67E22', adjustmentPercent: '20', actorId: ADMIN });

    const snapshot = await port.getAll(before);

    expect(snapshot.seasons.map((s) => s.name)).toEqual(['Regular']);
  });

  it('incluye las temporadas retiradas con archivedAt y su última regla', async () => {
    const alta = await admin.create({ name: 'Alta', color: '#E67E22', adjustmentPercent: '20', actorId: ADMIN });
    await admin.retire({ seasonId: alta.id, actorId: ADMIN });

    const snapshot = await port.getAll(repository.tick());

    const retired = snapshot.seasons.find((s) => s.seasonId === alta.id);
    expect(retired).toMatchObject({ adjustmentPercent: '20.00', archivedAt: expect.any(String) });
  });

  it('identifica la temporada por defecto', async () => {
    const snapshot = await port.getAll(repository.tick());

    expect(snapshot.defaultSeasonId).toBe(REGULAR_ID);
  });

  it('si la lectura falla lanza SeasonRulesUnavailableError', async () => {
    jest.spyOn(repository, 'findEffectiveAt').mockRejectedValue(new Error('conexión perdida'));

    await expect(port.getAll(new Date())).rejects.toThrow(SeasonRulesUnavailableError);
  });

  it('si no hay exactamente una temporada por defecto falla, sin devolver un snapshot parcial', async () => {
    jest.spyOn(repository, 'findEffectiveAt').mockResolvedValue([]);

    await expect(port.getAll(new Date())).rejects.toThrow(SeasonCatalogInconsistentError);
  });

  it('rechaza un asOf inválido', async () => {
    await expect(port.getAll(new Date('no es fecha'))).rejects.toThrow();
  });
});
