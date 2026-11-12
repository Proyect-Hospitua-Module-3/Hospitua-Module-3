// Feature 003 · Consultar porcentaje de comisión OTA
import { OtaCommissionReference } from '../../../model/ota-commission/ota-commission-reference';

export const OTA_COMMISSION_QUERY = Symbol('OtaCommissionQueryPort');

// Lectura sobre settlement (tabla de 007), sin escribir nunca: el puerto no tiene ningún
// método para crear, actualizar ni corregir porcentajes (FR-005, SC-004). Puerto propio de
// 003 (plan base): no depende del repositorio de settlement.
export interface OtaCommissionQueryPort {
  // La liquidación del canal OTA con ese ota_id y el generated_at más reciente. Las del
  // canal directo nunca salen. Ninguna → null (no lanza error).
  findLatestByOtaId(otaId: string): Promise<OtaCommissionReference | null>;
}
