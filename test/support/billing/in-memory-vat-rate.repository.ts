// Feature 001 · Actualizar porcentaje de IVA
import { VatRate } from '../../../src/domain/model/billing/vat-rate';
import { VatRateValue } from '../../../src/domain/model/billing/vat-rate-value.vo';
import { VatRateRepositoryPort } from '../../../src/domain/ports/out/billing/vat-rate.repository.port';

export interface VatRateHistoryEntry {
  valueBefore: string | null;
  valueAfter: string;
  changedBy: string;
  // Igual al updatedAt del vigente que deja, como en la base real.
  changedAt: Date;
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
    const changedAt = new Date();
    this.history.push({
      valueBefore: this.current?.value.toString() ?? null,
      valueAfter: value.toString(),
      changedBy: actorId,
      changedAt,
    });
    this.current = new VatRate(value, actorId, changedAt);
    return this.current;
  }
}
