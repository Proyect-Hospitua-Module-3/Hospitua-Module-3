// Feature 001 · Actualizar porcentaje de IVA
// Contrato: features/001-actualizar-porcentaje-iva/2-technical/contracts/GET-admin-vat-rate.md
import { VatRateOverview } from '../../../model/billing/vat-rate-overview';

export const GET_VAT_RATE_OVERVIEW_USE_CASE = Symbol('GetVatRateOverviewUseCase');

// Lo que ve el Administrador en la pantalla de IVA: el vigente y el historial. Solo
// lectura. A diferencia de GetCurrentVatRateUseCase (que usa 006), no falla si todavía no
// hay porcentaje: devuelve current = null para que la pantalla pida configurarlo.
export interface GetVatRateOverviewUseCase {
  getOverview(): Promise<VatRateOverview>;
}
