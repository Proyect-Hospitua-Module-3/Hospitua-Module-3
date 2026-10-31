// Feature 001 · Actualizar porcentaje de IVA
import { VatRateNotConfiguredError } from '../../../domain/errors/billing/vat-rate-not-configured.error';
import { VatRateUnavailableError } from '../../../domain/errors/billing/vat-rate-unavailable.error';
import { VatRate } from '../../../domain/model/billing/vat-rate';
import { GetCurrentVatRateUseCase } from '../../../domain/ports/in/billing/get-current-vat-rate.use-case';
import { VatRateRepositoryPort } from '../../../domain/ports/out/billing/vat-rate.repository.port';

// Única vía por la que `billing` (incluida 006) obtiene el porcentaje vigente.
// Sin caché: cada lectura ve el último valor confirmado (NFR-003).
export class GetCurrentVatRateService implements GetCurrentVatRateUseCase {
  constructor(private readonly vatRates: VatRateRepositoryPort) {}

  async getCurrent(): Promise<VatRate> {
    let current: VatRate | null;
    try {
      current = await this.vatRates.getCurrent();
    } catch (cause) {
      throw new VatRateUnavailableError(cause);
    }

    // Nunca se asume 0 ni un valor por defecto (FR-003, BR-003).
    if (!current) {
      throw new VatRateNotConfiguredError();
    }
    return current;
  }
}
