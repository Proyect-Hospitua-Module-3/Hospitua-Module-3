// Feature 007 · Generar liquidación
// Contrato: features/007-generar-liquidacion/2-technical/contracts/CLIENT-get-reservation.md
import { ReservationData } from '../../../model/settlement/reservation-data';

export const RESERVATION_CLIENT = Symbol('ReservationClientPort');

// Consulta de la reserva a Módulo 2. La usa 007 y, para el acceso de la OTA (HU4), la 005.
// - 404 → ReservationNotFoundError.
// - Timeout, 5xx, fallo de red, circuito abierto u otra respuesta inesperada →
//   Module2UnavailableError (reintentable).
// - Sin caché: el canal o la comisión pueden corregirse hasta el check-out.
export interface ReservationClientPort {
  // correlationId viaja a Módulo 2 en X-Correlation-Id, para seguir la generación en sus logs.
  getReservation(reservationRef: string, correlationId?: string): Promise<ReservationData>;
}
