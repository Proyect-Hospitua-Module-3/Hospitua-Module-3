// Feature 007 · Generar liquidación
import { NewSettlement, Settlement } from '../../../model/settlement/settlement';

export const SETTLEMENT_REPOSITORY = Symbol('SettlementRepositoryPort');

// Otra entrega del mismo check-out guardó primero la liquidación de la estancia.
export const STAY_ALREADY_SETTLED = 'STAY_ALREADY_SETTLED';

// Solo inserta y lee: no hay update ni delete porque la liquidación es inmutable (FR-009).
export interface SettlementRepositoryPort {
  findByStayId(stayId: string): Promise<Settlement | null>;

  // Devuelve la liquidación guardada, con su generatedAt de la base de datos. Si ya existe
  // una para esa estancia (UNIQUE(stay_id)) no lanza un error genérico: devuelve
  // STAY_ALREADY_SETTLED y el servicio vuelve a leerla (FR-011).
  insert(settlement: NewSettlement): Promise<Settlement | typeof STAY_ALREADY_SETTLED>;

  // Solo lectura, para 002, que identifica la habitación por reserva y habitación y no
  // conoce el stayId. GenerateSettlementService no la usa.
  findByReservationAndRoom(reservationRef: string, roomId: string): Promise<Settlement | null>;
}
