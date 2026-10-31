// Feature 001 · Actualizar porcentaje de IVA
import { VatRate } from '../../../src/domain/model/billing/vat-rate';
import { VatRateValue } from '../../../src/domain/model/billing/vat-rate-value.vo';
import { VatRateRepositoryPort } from '../../../src/domain/ports/out/billing/vat-rate.repository.port';

export interface VatRateHistoryEntry {
  valueBefore: string | null;
  valueAfter: string;
  changedBy: string;
}

// Doble de prueba del puerto: permite ejercitar los casos de uso y el endpoint sin PostgreSQL.
export class InMemoryVatRateRepository implements VatRateRepositoryPort {
  current: VatRate | null = null;
  readonly history: VatRateHistoryEntry[] = [];
  failWith: Error | null = null;

  async getCurrent(): Promise<VatRate | null> {
    if (this.failWith) throw this.failWith;
    return this.current;
  }

  async saveNew(value: VatRateValue, actorId: string): Promise<VatRate> {
    if (this.failWith) throw this.failWith;
    this.history.push({
      valueBefore: this.current?.value.toString() ?? null,
      valueAfter: value.toString(),
      changedBy: actorId,
    });
    this.current = new VatRate(value, actorId, new Date());
    return this.current;
  }
}
