// Feature 001 · Actualizar porcentaje de IVA
import { GetCurrentVatRateService } from '../../../src/application/services/billing/get-current-vat-rate.service';
import { UpdateVatRateService } from '../../../src/application/services/billing/update-vat-rate.service';
import { GetCurrentVatRateUseCase } from '../../../src/domain/ports/in/billing/get-current-vat-rate.use-case';
import { InMemoryVatRateRepository } from '../../support/billing/in-memory-vat-rate.repository';

// T017: contrato PORT-get-current-vat-rate.md de 006 (consumidor) que implementa 001.
describe('Contrato GetCurrentVatRateUseCase (001 → 006)', () => {
  let repository: InMemoryVatRateRepository;
  let port: GetCurrentVatRateUseCase;

  beforeEach(() => {
    repository = new InMemoryVatRateRepository();
    port = new GetCurrentVatRateService(repository);
  });

  it('getCurrent() no recibe argumentos', () => {
    expect(port.getCurrent.length).toBe(0);
  });

  it('devuelve el valor como decimal exacto con 2 decimales ("19.00")', async () => {
    await new UpdateVatRateService(repository).update({ value: '19', actorId: 'admin' });

    const vatRate = await port.getCurrent();

    expect(vatRate.value.toString()).toBe('19.00');
    expect(vatRate.value.toDecimal().toFixed(2)).toBe('19.00');
  });

  it('el nuevo valor está disponible en la siguiente lectura, sin caché', async () => {
    const update = new UpdateVatRateService(repository);
    await update.update({ value: '19', actorId: 'admin' });
    await update.update({ value: '5', actorId: 'admin' });

    expect((await port.getCurrent()).value.toString()).toBe('5.00');
  });

  it('sin porcentaje configurado: VAT_RATE_NOT_CONFIGURED (no reintentable)', async () => {
    await expect(port.getCurrent()).rejects.toMatchObject({ errorCode: 'VAT_RATE_NOT_CONFIGURED' });
  });

  it('lectura fallida: VAT_RATE_UNAVAILABLE (reintentable)', async () => {
    repository.failWith = new Error('timeout');

    await expect(port.getCurrent()).rejects.toMatchObject({ errorCode: 'VAT_RATE_UNAVAILABLE' });
  });
});
