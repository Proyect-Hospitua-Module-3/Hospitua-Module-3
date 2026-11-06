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
  // Solo la OTA (HU4): reserva a la que pertenece la habitación. En una llamada interna
  // de Módulo 2 se ignora.
  reservationRef?: string;
}

// Quién consulta (contrato GET, "Autenticación y autorización"): Módulo 2 por la red
// interna, sin token, o una OTA con su otaId del token.
export type DynamicRateCaller = { kind: 'INTERNAL' } | { kind: 'OTA'; otaId: string };

export const INTERNAL_CALLER: DynamicRateCaller = Object.freeze({ kind: 'INTERNAL' });

export interface DynamicRateResult {
  roomId: string;
  currency: string;
  // Una por noche, en orden cronológico.
  nights: readonly DynamicRate[];
  total: Money;
}

// Solo lectura: no guarda nada (FR-007). Falla completa si cualquier noche falla (FR-006).
// La OTA solo consulta habitaciones de sus reservas (FR-010); el resultado no depende de
// quién consulta (FR-011).
export interface GetDynamicRateUseCase {
  execute(query: DynamicRateQuery, caller?: DynamicRateCaller): Promise<DynamicRateResult>;
}
