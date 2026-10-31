// Feature 001 · Actualizar porcentaje de IVA
import { VatRate } from '../../../model/billing/vat-rate';

export const UPDATE_VAT_RATE_USE_CASE = Symbol('UpdateVatRateUseCase');

export interface UpdateVatRateCommand {
  // Tal como llega del Administrador; lo valida `VatRateValue`.
  value: unknown;
  // `sub` del JWT: quién hace el cambio (FR-005).
  actorId: string;
}

// PUT /admin/vat-rate: registra o actualiza el porcentaje de IVA vigente.
export interface UpdateVatRateUseCase {
  update(command: UpdateVatRateCommand): Promise<VatRate>;
}
