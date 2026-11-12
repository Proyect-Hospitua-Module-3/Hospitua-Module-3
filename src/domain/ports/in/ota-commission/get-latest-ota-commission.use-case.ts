// Feature 003 · Consultar porcentaje de comisión OTA
// Contrato: features/003-consultar-porcentaje-comision-ota/2-technical/contracts/GET-ota-commission-otaid.md
import { OtaCommissionCaller } from '../../../model/ota-commission/ota-commission-query';
import { OtaCommissionResult } from '../../../model/ota-commission/ota-commission-reference';

export const GET_LATEST_OTA_COMMISSION_USE_CASE = Symbol('GetLatestOtaCommissionUseCase');

// Arquitectura (T005, BR-001, BR-004): esta consulta es CONSUMIDORA de settlement, nunca al
// revés. Generar liquidación (007) obtiene el porcentaje solo de la reserva que informa
// Módulo 2 y no puede importar este puerto ni nada de ota-commission; lo verifica
// test/architecture/ota-commission-dependencies.spec.ts.
//
// Solo lectura (FR-005, BR-002): devuelve el porcentaje de la liquidación Final más reciente
// de la OTA, o NO_HISTORY si no hay ninguna (FR-004). Valida otaId (canal directo →
// INVALID_QUERY_PARAMS) y el alcance de la OTA (otra OTA → FORBIDDEN) antes de leer.
export interface GetLatestOtaCommissionUseCase {
  execute(otaId: unknown, caller: OtaCommissionCaller): Promise<OtaCommissionResult>;
}
