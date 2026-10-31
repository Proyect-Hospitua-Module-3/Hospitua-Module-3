// Feature 009 · Modificar precio tarifa según temporada
import { ModifySeasonRuleService } from '../../../../src/application/services/pricing/modify-season-rule.service';
import { DefaultSeasonImmutableError } from '../../../../src/domain/errors/pricing/default-season-immutable.error';
import { InvalidSeasonAdjustmentError } from '../../../../src/domain/errors/pricing/invalid-season-adjustment.error';
import { InvalidSeasonError } from '../../../../src/domain/errors/pricing/invalid-season.error';
import { SeasonInUseError } from '../../../../src/domain/errors/pricing/season-in-use.error';
import { SeasonNameConflictError } from '../../../../src/domain/errors/pricing/season-name-conflict.error';
import { SeasonNotFoundError } from '../../../../src/domain/errors/pricing/season-not-found.error';
import { SeasonRuleConflictError } from '../../../../src/domain/errors/pricing/season-rule-conflict.error';
import { SeasonCalendarReferencePort } from '../../../../src/domain/ports/out/pricing/season-calendar-reference.port';
import {
  InMemorySeasonRuleRepository,
  REGULAR_ID,
} from '../../../support/pricing/in-memory-season-rule.repository';

const ADMIN = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';
const UNKNOWN_ID = '5dca644e-7a6a-4d2e-a9a5-1943188c4710';

// T014: alta, cambios, no-op, versión esperada, Regular protegida y retiro.
describe('ModifySeasonRuleService', () => {
  let repository: InMemorySeasonRuleRepository;
  let inUse: Set<string>;
  let service: ModifySeasonRuleService;

  beforeEach(() => {
    repository = new InMemorySeasonRuleRepository();
    inUse = new Set();
    const calendar: SeasonCalendarReferencePort = {
      isReferencedByActiveRevision: async (id) => inUse.has(id),
    };
    service = new ModifySeasonRuleService(repository, calendar);
  });

  async function createFestival() {
    return service.create({ name: 'Festival', color: '#C0392B', adjustmentPercent: '25.00', actorId: ADMIN });
  }

  describe('create', () => {
    it('crea la temporada con su primera regla e historial', async () => {
      const festival = await createFestival();

      expect(festival.name.value).toBe('Festival');
      expect(festival.currentRule.adjustmentPercent.toString()).toBe('25.00');
      expect(festival.version).toBe(1);
      expect(festival.isDefault).toBe(false);
      expect(repository.history.at(-1)).toMatchObject({ changeType: 'CREATE', newAdjustment: '25.00' });
    });

    it('rechaza un nombre ya usado, sin distinguir mayúsculas', async () => {
      await createFestival();

      await expect(
        service.create({ name: 'FESTIVAL', color: '#000000', adjustmentPercent: '5', actorId: ADMIN }),
      ).rejects.toThrow(SeasonNameConflictError);
    });

    it('rechaza crear otra temporada llamada Regular', async () => {
      await expect(
        service.create({ name: 'regular', color: '#000000', adjustmentPercent: '5', actorId: ADMIN }),
      ).rejects.toThrow(SeasonNameConflictError);
    });

    it.each([
      ['un ajuste fuera de rango', { adjustmentPercent: '100.01' }, InvalidSeasonAdjustmentError],
      ['un color inválido', { color: 'rojo' }, InvalidSeasonError],
      ['un nombre vacío', { name: '  ' }, InvalidSeasonError],
    ])('rechaza %s sin escribir nada', async (_case, override, error) => {
      const before = repository.history.length;

      await expect(
        service.create({ name: 'Alta', color: '#E67E22', adjustmentPercent: '20', actorId: ADMIN, ...override }),
      ).rejects.toThrow(error);
      expect(repository.history).toHaveLength(before);
    });
  });

  describe('update', () => {
    it('cambia el ajuste: nueva versión, regla nueva e historial', async () => {
      const festival = await createFestival();

      const updated = await service.update({ seasonId: festival.id, adjustmentPercent: '-10', actorId: ADMIN });

      expect(updated.currentRule.adjustmentPercent.toString()).toBe('-10.00');
      expect(updated.version).toBe(2);
      expect(repository.history.at(-1)).toMatchObject({
        changeType: 'UPDATE',
        previousAdjustment: '25.00',
        newAdjustment: '-10.00',
      });
    });

    it('cambia nombre y color sin tocar el ajuste', async () => {
      const festival = await createFestival();

      const updated = await service.update({ seasonId: festival.id, name: 'Feria', color: '#8e44ad', actorId: ADMIN });

      expect(updated.name.value).toBe('Feria');
      expect(updated.color.value).toBe('#8E44AD');
      expect(updated.currentRule.adjustmentPercent.toString()).toBe('25.00');
    });

    it('con valores idénticos es un no-op: misma versión y sin historial', async () => {
      const festival = await createFestival();
      const before = repository.history.length;

      const same = await service.update({ seasonId: festival.id, adjustmentPercent: '25', actorId: ADMIN });

      expect(same.version).toBe(1);
      expect(repository.history).toHaveLength(before);
    });

    it('rechaza una expectedVersion desactualizada sin cambiar nada', async () => {
      const festival = await createFestival();
      await service.update({ seasonId: festival.id, adjustmentPercent: '30', actorId: ADMIN });

      await expect(
        service.update({ seasonId: festival.id, adjustmentPercent: '40', expectedVersion: 1, actorId: ADMIN }),
      ).rejects.toThrow(SeasonRuleConflictError);
    });

    it('permite cambiar el ajuste de Regular, pero no su nombre', async () => {
      const regular = await service.update({ seasonId: REGULAR_ID, adjustmentPercent: '-2.50', actorId: ADMIN });
      expect(regular.currentRule.adjustmentPercent.toString()).toBe('-2.50');

      await expect(
        service.update({ seasonId: REGULAR_ID, name: 'Normal', actorId: ADMIN }),
      ).rejects.toThrow(DefaultSeasonImmutableError);
    });

    it('rechaza un cuerpo sin campos para cambiar', async () => {
      await expect(
        service.update({ seasonId: REGULAR_ID, expectedVersion: 1, actorId: ADMIN }),
      ).rejects.toThrow(InvalidSeasonError);
    });

    it.each([
      ['inexistente', UNKNOWN_ID],
      ['con formato inválido', 'no-es-un-uuid'],
    ])('responde SeasonNotFound para un id %s', async (_case, id) => {
      await expect(
        service.update({ seasonId: id, adjustmentPercent: '5', actorId: ADMIN }),
      ).rejects.toThrow(SeasonNotFoundError);
    });
  });

  describe('retire', () => {
    it('retira la temporada sin borrar su historial y libera su nombre', async () => {
      const festival = await createFestival();

      await service.retire({ seasonId: festival.id, actorId: ADMIN });

      const catalog = await service.list();
      expect(catalog.seasons.map((s) => s.name.value)).toEqual(['Regular']);
      expect(repository.history.filter((h) => h.seasonId === festival.id).map((h) => h.changeType)).toEqual([
        'CREATE',
        'RETIRE',
      ]);
      await expect(createFestival()).resolves.toBeDefined();
    });

    it('una temporada retirada ya no se puede modificar ni retirar', async () => {
      const festival = await createFestival();
      await service.retire({ seasonId: festival.id, actorId: ADMIN });

      await expect(
        service.update({ seasonId: festival.id, adjustmentPercent: '5', actorId: ADMIN }),
      ).rejects.toThrow(SeasonNotFoundError);
      await expect(service.retire({ seasonId: festival.id, actorId: ADMIN })).rejects.toThrow(
        SeasonNotFoundError,
      );
    });

    it('no retira Regular', async () => {
      await expect(service.retire({ seasonId: REGULAR_ID, actorId: ADMIN })).rejects.toThrow(
        DefaultSeasonImmutableError,
      );
    });

    it('no retira una temporada asignada en el calendario vigente', async () => {
      const festival = await createFestival();
      inUse.add(festival.id);

      await expect(service.retire({ seasonId: festival.id, actorId: ADMIN })).rejects.toThrow(SeasonInUseError);
      expect((await service.list()).seasons).toHaveLength(2);
    });
  });

  it('lista las temporadas activas ordenadas por nombre', async () => {
    await service.create({ name: 'Baja', color: '#3498DB', adjustmentPercent: '-15', actorId: ADMIN });
    await service.create({ name: 'alta', color: '#E67E22', adjustmentPercent: '20', actorId: ADMIN });

    const catalog = await service.list();

    expect(catalog.seasons.map((s) => s.name.value)).toEqual(['alta', 'Baja', 'Regular']);
  });
});
