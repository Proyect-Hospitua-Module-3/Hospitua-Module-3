// Feature 007 · Generar liquidación
// Forma acordada con Módulo 2: contrato CLIENT-get-reservation.md.
import { InvalidCommissionError } from '../../errors/settlement/invalid-commission.error';
import { MissingCommissionError } from '../../errors/settlement/missing-commission.error';
import { Channel } from '../shared/channel.vo';
import { CommissionPercentage } from './commission-percentage.vo';

export const OTA_CHANNEL = 'OTA';

// Datos de la reserva que devuelve Módulo 2 (GET /api/reservations/{reservationRef}). El
// cliente ya comprobó los tipos; las reglas de negocio (canal, comisión) se aplican abajo.
export interface ReservationData {
  readonly reservationRef: string;
  // Una cotización por habitación de la reserva (las guarda Módulo 2 al crearla).
  readonly quoteIds: readonly string[];
  // null si Módulo 2 no informó canal. Cualquier valor distinto de "OTA" es canal directo.
  readonly channel: string | null;
  // Solo con channel = "OTA"; con otro canal no se leen.
  readonly otaId?: string;
  readonly otaConfirmationCode?: string;
  // Tal como llega (número JSON o texto); ausente o null si Módulo 2 no lo informó.
  readonly otaCommissionPercentage?: number | string | null;
}

export interface ChannelTerms {
  readonly channel: Channel;
  // null en canal directo.
  readonly commission: CommissionPercentage | null;
}

// Canal y comisión de la reserva (FR-003 a FR-007). Sin canal, o con un canal distinto de
// OTA, es directo y sin comisión; con OTA la comisión es obligatoria y nunca se supone
// una por defecto (FR-014). Lo reutiliza 002 para la liquidación informativa.
export function channelTermsOf(reservation: ReservationData): ChannelTerms {
  if (reservation.channel !== OTA_CHANNEL) {
    return { channel: Channel.direct(), commission: null };
  }

  const otaId = reservation.otaId ?? '';
  const raw = reservation.otaCommissionPercentage;
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    throw new MissingCommissionError(reservation.reservationRef, otaId);
  }
  const commission = CommissionPercentage.tryParse(raw);
  if (!commission) {
    throw new InvalidCommissionError(reservation.reservationRef, otaId, raw);
  }
  return {
    channel: Channel.ota(otaId, reservation.otaConfirmationCode ?? ''),
    commission,
  };
}
