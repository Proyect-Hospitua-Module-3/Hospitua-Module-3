// Feature 007 · Generar liquidación
// Forma pública: contrato UC-generate-settlement.md (la consumen 010 y 006).
import { ChannelKind } from '../shared/channel.vo';
import { CheckoutData } from './checkout-data';
import { ChannelTerms } from './reservation-data';
import { SettlementBreakdown } from './settlement-calculator';

export const SETTLEMENT_STATUS = 'FINAL';

// Datos del check-out que identifican un reenvío idéntico (FR-011). El eventId no cuenta:
// 006 también puede pedir la misma liquidación.
const CHECKOUT_FIELDS = [
  'reservationRef',
  'roomId',
  'categoryRoom',
  'checkInDate',
  'checkOutDate',
] as const;

// Lo que se guarda. Importes y porcentaje como texto decimal exacto; nunca como number.
// generatedAt no está: lo pone la base de datos al guardar (NFR-003).
export interface NewSettlement {
  readonly settlementId: string;
  readonly stayId: string;
  readonly reservationRef: string;
  readonly roomId: string;
  readonly categoryRoom: string;
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly quoteId: string;
  readonly channel: ChannelKind;
  readonly otaId: string | null;
  readonly otaConfirmationCode: string | null;
  readonly otaCommissionPercentage: string | null;
  readonly currency: string;
  readonly lodgingAmount: string;
  readonly baseLodgingAmount: string;
  readonly dynamicAdjustmentAmount: string;
  readonly otaCommissionAmount: string;
  readonly netIncome: string;
  readonly sourceEventId: string;
}

export interface StoredSettlement extends NewSettlement {
  readonly generatedAt: Date;
}

export interface PrepareSettlementInput {
  settlementId: string;
  checkout: CheckoutData;
  quoteId: string;
  terms: ChannelTerms;
  breakdown: SettlementBreakdown;
}

// Liquidación de la estancia de una habitación. Existe solo como Final y no tiene ningún
// método de modificación: una vez guardada nadie la cambia ni la recalcula (FR-009, FR-017).
export class Settlement implements StoredSettlement {
  readonly status = SETTLEMENT_STATUS;
  readonly settlementId: string;
  readonly stayId: string;
  readonly reservationRef: string;
  readonly roomId: string;
  readonly categoryRoom: string;
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly quoteId: string;
  readonly channel: ChannelKind;
  readonly otaId: string | null;
  readonly otaConfirmationCode: string | null;
  readonly otaCommissionPercentage: string | null;
  readonly currency: string;
  readonly lodgingAmount: string;
  readonly baseLodgingAmount: string;
  readonly dynamicAdjustmentAmount: string;
  readonly otaCommissionAmount: string;
  readonly netIncome: string;
  readonly sourceEventId: string;
  readonly generatedAt: Date;

  private constructor(stored: StoredSettlement) {
    this.settlementId = stored.settlementId;
    this.stayId = stored.stayId;
    this.reservationRef = stored.reservationRef;
    this.roomId = stored.roomId;
    this.categoryRoom = stored.categoryRoom;
    this.checkInDate = stored.checkInDate;
    this.checkOutDate = stored.checkOutDate;
    this.quoteId = stored.quoteId;
    this.channel = stored.channel;
    this.otaId = stored.otaId;
    this.otaConfirmationCode = stored.otaConfirmationCode;
    this.otaCommissionPercentage = stored.otaCommissionPercentage;
    this.currency = stored.currency;
    this.lodgingAmount = stored.lodgingAmount;
    this.baseLodgingAmount = stored.baseLodgingAmount;
    this.dynamicAdjustmentAmount = stored.dynamicAdjustmentAmount;
    this.otaCommissionAmount = stored.otaCommissionAmount;
    this.netIncome = stored.netIncome;
    this.sourceEventId = stored.sourceEventId;
    this.generatedAt = new Date(stored.generatedAt.getTime());
    Object.freeze(this);
  }

  // Arma lo que se va a guardar, con la estancia del check-out, la cotización usada, el
  // canal de la reserva y el desglose del calculador (FR-012, FR-016, NFR-003).
  static prepare({
    settlementId,
    checkout,
    quoteId,
    terms,
    breakdown,
  }: PrepareSettlementInput): NewSettlement {
    return Object.freeze({
      settlementId,
      stayId: checkout.stayId,
      reservationRef: checkout.reservationRef,
      roomId: checkout.roomId,
      categoryRoom: checkout.categoryRoom,
      checkInDate: checkout.checkInDate,
      checkOutDate: checkout.checkOutDate,
      quoteId,
      channel: terms.channel.kind,
      otaId: terms.channel.otaId,
      otaConfirmationCode: terms.channel.otaConfirmationCode,
      otaCommissionPercentage: terms.commission?.toString() ?? null,
      currency: breakdown.currency,
      lodgingAmount: breakdown.lodgingAmount.toString(),
      baseLodgingAmount: breakdown.baseLodgingAmount.toString(),
      dynamicAdjustmentAmount: breakdown.dynamicAdjustmentAmount.toString(),
      otaCommissionAmount: breakdown.otaCommissionAmount.toString(),
      netIncome: breakdown.netIncome.toString(),
      sourceEventId: checkout.eventId,
    });
  }

  // Reconstruye una liquidación guardada tal como está, sin recalcular nada (FR-017).
  static restore(stored: StoredSettlement): Settlement {
    return new Settlement(stored);
  }

  // Campos del check-out en los que este intento difiere de la liquidación guardada. Vacío
  // = reenvío idéntico (FR-011); con algo = otro check-out para la misma estancia (FR-010).
  differencesWith(checkout: CheckoutData): string[] {
    return CHECKOUT_FIELDS.filter((field) => this[field] !== checkout[field]);
  }
}
