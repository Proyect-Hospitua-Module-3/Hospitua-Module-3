// Feature 005 · Consultar tarifa dinámica
// Contrato: features/005-consultar-tarifa-dinamica/2-technical/contracts/GET-pricing-dynamic-rate.md
import { DynamicRate } from '../../../model/pricing/dynamic-rate';
import { Money } from '../../../model/shared/money.vo';

export const GET_DYNAMIC_RATE_USE_CASE = Symbol('GetDynamicRateUseCase');

// Llega tal como viene en la query: `date` para una noche, o `checkInDate` +
// `checkOutDate` (salida exclusiva) para un rango. El servicio valida la combinación.
export interface DynamicRateQuery {
  roomId?: string;
  date?: string;
  checkInDate?: string;
  checkOutDate?: string;
}

export interface DynamicRateResult {
  roomId: string;
  currency: string;
  // Una por noche, en orden cronológico.
  nights: readonly DynamicRate[];
  total: Money;
}

// Solo lectura: no guarda nada (FR-007). Falla completa si cualquier noche falla (FR-006).
export interface GetDynamicRateUseCase {
  execute(query: DynamicRateQuery): Promise<DynamicRateResult>;
}
