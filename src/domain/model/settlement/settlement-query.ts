// Feature 002 · Consultar liquidación
// Parámetros por actor: contrato GET-settlements.md («Ruta y autenticación», «Parámetros»).
import { InvalidSettlementQueryError } from '../../errors/settlement/invalid-settlement-query.error';

// Mismo formato que acepta 007 para roomId (no exige la versión del RFC).
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Llega tal como viene en la query (puede faltar, repetirse o no ser texto). categoryRoom,
// las fechas y source no están: se ignoran siempre (FR-001, contrato «Parámetros»).
export interface SettlementQuery {
  readonly reservationRef?: unknown;
  // Solo Módulo 1; con token OTA se ignora.
  readonly roomId?: unknown;
  // X-Correlation-Id de la petición, para la llamada a Módulo 2.
  readonly correlationId?: string;
}

// Quién consulta: Módulo 1 por la red interna, sin token, o una OTA con el otaId de su
// token (FR-013, BR-006). El guard HTTP ya exigió que el token OTA traiga otaId.
export type SettlementCaller = { kind: 'INTERNAL' } | { kind: 'OTA'; otaId: string };

export const INTERNAL_SETTLEMENT_CALLER: SettlementCaller = Object.freeze({ kind: 'INTERNAL' });

// Consulta ya validada para su actor.
export type ValidSettlementQuery =
  | {
      readonly kind: 'INTERNAL';
      readonly reservationRef: string;
      readonly roomId: string;
      readonly correlationId?: string;
    }
  | {
      readonly kind: 'OTA';
      readonly reservationRef: string;
      readonly otaId: string;
      readonly correlationId?: string;
    };

// Sin token: reservationRef y roomId obligatorios. Con token OTA: solo reservationRef.
// Si falta algo se rechaza sin revelar información financiera (FR-013, SC-010).
export function parseSettlementQuery(
  query: SettlementQuery,
  caller: SettlementCaller,
): ValidSettlementQuery {
  const reservationRef = query.reservationRef;
  if (typeof reservationRef !== 'string' || reservationRef.trim() === '') {
    throw new InvalidSettlementQueryError(
      'Envía reservationRef una sola vez: la referencia de la reserva que quieres consultar.',
    );
  }

  if (caller.kind === 'OTA') {
    return {
      kind: 'OTA',
      reservationRef,
      otaId: caller.otaId,
      correlationId: query.correlationId,
    };
  }

  const roomId = query.roomId;
  if (typeof roomId !== 'string' || roomId.trim() === '') {
    throw new InvalidSettlementQueryError(
      'Envía roomId una sola vez: la habitación de la reserva que quieres consultar.',
    );
  }
  if (!UUID_FORMAT.test(roomId)) {
    throw new InvalidSettlementQueryError(
      'roomId debe ser un UUID, por ejemplo f47ac10b-58cc-4372-a567-0e02b2c3d479.',
    );
  }
  return { kind: 'INTERNAL', reservationRef, roomId, correlationId: query.correlationId };
}
