// Feature 001 · Actualizar porcentaje de IVA
import { VatRate } from '../../../domain/model/billing/vat-rate';
import { VatRateValue } from '../../../domain/model/billing/vat-rate-value.vo';
import {
  UpdateVatRateCommand,
  UpdateVatRateUseCase,
} from '../../../domain/ports/in/billing/update-vat-rate.use-case';
import { VatRateRepositoryPort } from '../../../domain/ports/out/billing/vat-rate.repository.port';

// Sin decoradores de NestJS: la capa de aplicación solo depende del dominio.
// El wiring con su adaptador está en infrastructure/config/billing.module.ts.
export class UpdateVatRateService implements UpdateVatRateUseCase {
  constructor(private readonly vatRates: VatRateRepositoryPort) {}

  async update(command: UpdateVatRateCommand): Promise<VatRate> {
    // Valida antes de cualquier escritura: un valor inválido nunca toca el vigente (FR-002).
    const value = VatRateValue.of(command.value);

    // Sin responsable no hay trazabilidad, y sin trazabilidad no hay cambio (FR-005).
    if (!command.actorId?.trim()) {
      throw new Error('No se puede actualizar el IVA sin identificar al responsable del cambio.');
    }

    return this.vatRates.saveNew(value, command.actorId);
  }
}
