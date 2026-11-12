// Feature 003 · Consultar porcentaje de comisión OTA
import { CommissionNotApplicableError } from '../../errors/ota-commission/commission-not-applicable.error';
import { InvalidOtaCommissionQueryError } from '../../errors/ota-commission/invalid-ota-commission-query.error';

// Valor reservado que identifica al canal directo en {otaId} (plan 003, «Notes»): es el
// mismo valor del campo channel de settlement. El canal directo no es una OTA (FR-006).
export const DIRECT_CHANNEL_ID = 'DIRECT';

// Quién consulta. Sin token es una llamada interna de un módulo (Módulo 2); con token, una
// OTA identificada por el claim otaId (plan base, «Autorización»).
export type OtaCommissionCaller =
  | { readonly kind: 'INTERNAL' }
  | { readonly kind: 'OTA'; readonly otaId: string };

export const INTERNAL_OTA_COMMISSION_CALLER: OtaCommissionCaller = Object.freeze({
  kind: 'INTERNAL',
});

// Valida el {otaId} tal como llega en la ruta:
// - vacío o solo espacios → INVALID_QUERY_PARAMS;
// - el canal directo (DIRECT, sin distinguir mayúsculas) → INVALID_QUERY_PARAMS, sin
//   devolver nunca 0% como si fuera una comisión OTA (FR-006, NFR-004).
// Devuelve el valor sin modificar: se compara exacto con settlement.ota_id.
export function parseOtaId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new InvalidOtaCommissionQueryError('Indica el identificador de la OTA (otaId).');
  }
  if (raw.trim().toUpperCase() === DIRECT_CHANNEL_ID) {
    throw new CommissionNotApplicableError();
  }
  return raw;
}
