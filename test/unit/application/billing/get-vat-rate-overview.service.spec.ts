// Feature 001 · Actualizar porcentaje de IVA
import {
  GetVatRateOverviewService,
  VAT_RATE_HISTORY_LIMIT,
} from '../../../../src/application/services/billing/get-vat-rate-overview.service';
import { VatRateValue } from '../../../../src/domain/model/billing/vat-rate-value.vo';
import { InMemoryVatRateOverviewQuery } from '../../../support/billing/in-memory-vat-rate-overview.query';
import { InMemoryVatRateRepository } from '../../../support/billing/in-memory-vat-rate.repository';

const ADMIN_ID = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';

describe('GetVatRateOverviewService', () => {
  it('sin porcentaje registrado devuelve current = null y sin historial, sin fallar (FR-003)', async () => {
    const service = new GetVatRateOverviewService(
      new InMemoryVatRateOverviewQuery(new InMemoryVatRateRepository()),
    );

    await expect(service.getOverview()).resolves.toEqual({ current: null, history: [] });
  });

  it('devuelve el vigente y el historial del más reciente al más antiguo (FR-005)', async () => {
    const repository = new InMemoryVatRateRepository();
    await repository.saveNew(VatRateValue.of('19'), ADMIN_ID);
    await repository.saveNew(VatRateValue.of('16'), ADMIN_ID);
    const service = new GetVatRateOverviewService(
      new InMemoryVatRateOverviewQuery(repository, { [ADMIN_ID]: 'admin' }),
    );

    const overview = await service.getOverview();

    expect(overview.current).toMatchObject({ value: '16.00', updatedByUsername: 'admin' });
    expect(overview.history.map((change) => [change.valueBefore, change.valueAfter])).toEqual([
      ['19.00', '16.00'],
      [null, '19.00'],
    ]);
  });

  it(`pide como máximo ${VAT_RATE_HISTORY_LIMIT} entradas de historial`, async () => {
    const query = { getOverview: jest.fn().mockResolvedValue({ current: null, history: [] }) };

    await new GetVatRateOverviewService(query).getOverview();

    expect(query.getOverview).toHaveBeenCalledWith(VAT_RATE_HISTORY_LIMIT);
  });
});
