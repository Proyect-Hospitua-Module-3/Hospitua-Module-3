// Feature 007 · Generar liquidación
// Contrato: features/007-generar-liquidacion/2-technical/contracts/UC-generate-settlement.md
import { Settlement } from '../../../model/settlement/settlement';

export const GENERATE_SETTLEMENT_USE_CASE = Symbol('GenerateSettlementUseCase');

// Datos del check-out de una habitación, tal como los arma 010 desde el evento
// facturacion.checkout (o 006 con los mismos datos). Nunca trae canal, importes, datos de
// la OTA ni datos tributarios: salen de Módulo 2 y de la cotización guardada.
export interface GenerateSettlementCommand {
  eventId: string;
  stayId: string;
  reservationRef: string;
  roomId: string;
  // Informativo: se guarda, pero no elige la cotización (FR-016).
  categoryRoom: string;
  // Fechas reales; la salida puede ser el mismo día de la entrada.
  checkInDate: string;
  checkOutDate: string;
}

// Solo lo invocan 010 (Registrar check-out) y 006 (Generar factura final); no tiene
// endpoint ni controller (FR-001, FR-019). Idempotente por stayId (FR-011).
export interface GenerateSettlementUseCase {
  generate(command: GenerateSettlementCommand): Promise<Settlement>;
}
