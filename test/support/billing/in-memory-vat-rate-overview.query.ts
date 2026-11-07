// Feature 001 · Actualizar porcentaje de IVA
import { VatRateOverview } from '../../../src/domain/model/billing/vat-rate-overview';
import { VatRateOverviewQueryPort } from '../../../src/domain/ports/out/billing/vat-rate-overview.query.port';
import { InMemoryVatRateRepository } from './in-memory-vat-rate.repository';

// Doble de la consulta de la pantalla de IVA: lee el mismo estado que el repositorio en
// memoria, así un PUT se ve en el GET siguiente. Los nombres salen de `usernames`.
export class InMemoryVatRateOverviewQuery implements VatRateOverviewQueryPort {
  constructor(
    private readonly repository: InMemoryVatRateRepository,
    private readonly usernames: Record<string, string> = {},
  ) {}

  async getOverview(historyLimit: number): Promise<VatRateOverview> {
    const current = this.repository.current;
    return {
      current: current && {
        value: current.value.toString(),
        updatedBy: current.updatedBy,
        updatedByUsername: this.usernames[current.updatedBy] ?? null,
        updatedAt: current.updatedAt,
      },
      history: [...this.repository.history]
        .reverse()
        .slice(0, historyLimit)
        .map((entry) => ({
          ...entry,
          changedByUsername: this.usernames[entry.changedBy] ?? null,
        })),
    };
  }
}
