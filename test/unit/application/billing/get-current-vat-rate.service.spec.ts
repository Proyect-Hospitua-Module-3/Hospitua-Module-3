// Feature 001 · Actualizar porcentaje de IVA
import { GetCurrentVatRateService } from '../../../../src/application/services/billing/get-current-vat-rate.service';
import { VatRateNotConfiguredError } from '../../../../src/domain/errors/billing/vat-rate-not-configured.error';
import { VatRateUnavailableError } from '../../../../src/domain/errors/billing/vat-rate-unavailable.error';
import { VatRate } from '../../../../src/domain/model/billing/vat-rate';
import { VatRateValue } from '../../../../src/domain/model/billing/vat-rate-value.vo';
import { InMemoryVatRateRepository } from '../../../support/billing/in-memory-vat-rate.repository';

// T016: devuelve el vigente, o falla; nunca 0 ni un valor por defecto (FR-003, BR-003).
describe('GetCurrentVatRateService', () => {
  let repository: InMemoryVatRateRepository;
  let service: GetCurrentVatRateService;

  beforeEach(() => {
    repository = new InMemoryVatRateRepository();
    service = new GetCurrentVatRateService(repository);
  });

  it('devuelve el porcentaje vigente', async () => {
    repository.current = new VatRate(VatRateValue.of('19.00'), 'admin', new Date());

    const current = await service.getCurrent();

    expect(current.value.toString()).toBe('19.00');
  });

  it('sin porcentaje configurado lanza VatRateNotConfiguredError', async () => {
    await expect(service.getCurrent()).rejects.toThrow(VatRateNotConfiguredError);
  });

  it('si la lectura falla lanza VatRateUnavailableError', async () => {
    repository.failWith = new Error('conexión perdida');

    await expect(service.getCurrent()).rejects.toThrow(VatRateUnavailableError);
  });
});
