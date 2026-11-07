// Feature 002 · Consultar liquidación
// Contrato: features/002-consultar-liquidacion/2-technical/contracts/GET-settlements.md
import { SettlementCaller, SettlementQuery } from '../../../model/settlement/settlement-query';
import { GetSettlementResult } from '../../../model/settlement/settlement-query-result';

export const GET_SETTLEMENT_USE_CASE = Symbol('GetSettlementUseCase');

// Solo lectura: nunca crea, modifica ni recalcula una liquidación Final ni su factura, y no
// guarda la informativa (FR-004, FR-011, BR-001).
// - Módulo 1 (INTERNAL): la FINAL de (reservationRef, roomId) o, si no existe, una
//   INFORMATIVE calculada con la reserva y su cotización (FR-009).
// - OTA: las FINAL de su reserva, ordenadas por roomId; si no ve ninguna,
//   SETTLEMENT_NOT_FOUND (FR-002, FR-005, FR-006).
// El servicio valida los parámetros según quién consulta (parseSettlementQuery).
export interface GetSettlementUseCase {
  execute(query: SettlementQuery, caller: SettlementCaller): Promise<GetSettlementResult>;
}
