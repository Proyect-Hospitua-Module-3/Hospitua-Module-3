// Feature 002 · Consultar liquidación
import { Settlement } from '../../../model/settlement/settlement';

export const SETTLEMENT_QUERY = Symbol('SettlementQueryPort');

// Lectura de liquidaciones Final para la consulta de la OTA (HU1). Solo lectura: el
// adaptador usa una transacción READ ONLY. La búsqueda de Módulo 1 por reserva y
// habitación no está aquí: reutiliza SettlementRepositoryPort.findByReservationAndRoom de 007.
export interface SettlementQueryPort {
  // Las Final de la reserva cuyo ota_id es el de la OTA, ordenadas por roomId. Una reserva
  // del canal directo (ota_id nulo) o de otra OTA no aparece. Ninguna → [] (no lanza error).
  findByReservationRefAndOtaId(reservationRef: string, otaId: string): Promise<Settlement[]>;
}
