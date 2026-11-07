// Feature 001 · Actualizar porcentaje de IVA
import { VatRateOverview } from '../../../domain/model/billing/vat-rate-overview';
import { GetVatRateOverviewUseCase } from '../../../domain/ports/in/billing/get-vat-rate-overview.use-case';
import { VatRateOverviewQueryPort } from '../../../domain/ports/out/billing/vat-rate-overview.query.port';

// Entradas del historial que ve la pantalla. Los cambios de IVA son pocos (unos cuantos
// por año), así que 100 cubre años de historia sin traer la tabla entera.
export const VAT_RATE_HISTORY_LIMIT = 100;

// Sin decoradores de NestJS: la capa de aplicación solo depende del dominio.
export class GetVatRateOverviewService implements GetVatRateOverviewUseCase {
  constructor(private readonly overview: VatRateOverviewQueryPort) {}

  getOverview(): Promise<VatRateOverview> {
    return this.overview.getOverview(VAT_RATE_HISTORY_LIMIT);
  }
}
