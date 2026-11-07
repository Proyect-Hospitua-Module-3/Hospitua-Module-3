// Feature 001 · Actualizar porcentaje de IVA
import { VatRateOverview } from '../../../model/billing/vat-rate-overview';

export const VAT_RATE_OVERVIEW_QUERY = Symbol('VatRateOverviewQueryPort');

// Solo lectura del vigente y de las últimas `historyLimit` entradas del historial, con el
// nombre de usuario de quien hizo cada cambio, leídos en una misma instantánea.
export interface VatRateOverviewQueryPort {
  getOverview(historyLimit: number): Promise<VatRateOverview>;
}
