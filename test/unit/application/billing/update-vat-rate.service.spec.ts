// Feature 001 · Actualizar porcentaje de IVA
import { UpdateVatRateService } from '../../../../src/application/services/billing/update-vat-rate.service';
import { InvalidVatRateError } from '../../../../src/domain/errors/billing/invalid-vat-rate.error';
import { InMemoryVatRateRepository } from '../../../support/billing/in-memory-vat-rate.repository';

const ADMIN_ID = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';

// T005 y T023: valida con el VO y solo entonces escribe; cada actualización queda trazada.
describe('UpdateVatRateService', () => {
  let repository: InMemoryVatRateRepository;
  let service: UpdateVatRateService;

  beforeEach(() => {
    repository = new InMemoryVatRateRepository();
    service = new UpdateVatRateService(repository);
  });

  it('registra el primer porcentaje con valor anterior nulo', async () => {
    const saved = await service.update({ value: '19.00', actorId: ADMIN_ID });

    expect(saved.value.toString()).toBe('19.00');
    expect(saved.updatedBy).toBe(ADMIN_ID);
    expect(repository.history).toEqual([
      { valueBefore: null, valueAfter: '19.00', changedBy: ADMIN_ID },
    ]);
  });

  it('actualiza el vigente y conserva el anterior en el historial', async () => {
    await service.update({ value: '19', actorId: ADMIN_ID });
    await service.update({ value: '5', actorId: ADMIN_ID });

    expect(repository.current?.value.toString()).toBe('5.00');
    expect(repository.history[1]).toEqual({
      valueBefore: '19.00',
      valueAfter: '5.00',
      changedBy: ADMIN_ID,
    });
  });

  it('acepta un valor idéntico al vigente y también lo traza', async () => {
    await service.update({ value: '19.00', actorId: ADMIN_ID });
    await service.update({ value: '19', actorId: ADMIN_ID });

    expect(repository.current?.value.toString()).toBe('19.00');
    expect(repository.history).toHaveLength(2);
  });

  it('rechaza un valor inválido sin escribir nada', async () => {
    await service.update({ value: '19.00', actorId: ADMIN_ID });
    const saveNew = jest.spyOn(repository, 'saveNew');

    await expect(service.update({ value: '120.00', actorId: ADMIN_ID })).rejects.toThrow(
      InvalidVatRateError,
    );
    expect(saveNew).not.toHaveBeenCalled();
    expect(repository.current?.value.toString()).toBe('19.00');
  });

  it('no actualiza si no puede registrar quién hizo el cambio', async () => {
    const saveNew = jest.spyOn(repository, 'saveNew');

    await expect(service.update({ value: '19.00', actorId: '  ' })).rejects.toThrow();
    expect(saveNew).not.toHaveBeenCalled();
  });
});
