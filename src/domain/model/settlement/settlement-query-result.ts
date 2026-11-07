// Feature 002 · Consultar liquidación
// Forma pública: contrato GET-settlements.md («Objeto de liquidación»).
import { ChannelKind } from '../shared/channel.vo';
import { ChannelTerms } from './reservation-data';
import { Settlement } from './settlement';
import { SettlementBreakdown } from './settlement-calculator';

// FINAL: la liquidación guardada por 007. INFORMATIVE: calculada al consultar para
// Módulo 1, nunca guardada (FR-009, FR-010, FR-011).
export type SettlementType = 'FINAL' | 'INFORMATIVE';

// Subconjunto de la factura de 006 que devuelve la consulta (FR-003). Se define aquí, en
// settlement, y no se importa de billing: settlement nunca importa billing (prueba de
// arquitectura de 007). Importes y porcentaje como texto decimal exacto.
export interface InvoiceSummary {
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly issuedAt: Date;
  readonly vatRateApplied: string;
  readonly vatAmount: string;
  readonly totalAmount: string;
  readonly status: string;
}

// Desglose de la liquidación, sin IVA (FR-002): el IVA solo está en la factura. Siempre
// se cumple lodgingAmount = baseLodgingAmount + dynamicAdjustmentAmount.
export interface SettlementQueryBreakdown {
  readonly baseLodgingAmount: string;
  readonly dynamicAdjustmentAmount: string;
  readonly lodgingAmount: string;
  // null en canal directo.
  readonly otaCommissionPercentage: string | null;
  readonly otaCommissionAmount: string;
  readonly netIncome: string;
}

// Una liquidación tal como la devuelve la consulta. Sin datos migratorios, datos
// personales del huésped ni billingCustomer (FR-007, NFR-004).
export interface SettlementQueryResult {
  readonly settlementType: SettlementType;
  readonly reservationRef: string;
  readonly roomId: string;
  // De la liquidación FINAL; null en la INFORMATIVE. Nunca sale del parámetro (FR-001).
  readonly categoryRoom: string | null;
  readonly channel: ChannelKind;
  readonly otaId: string | null;
  readonly currency: string;
  readonly breakdown: SettlementQueryBreakdown;
  // Solo en una FINAL con factura emitida; null si no la hay o si es INFORMATIVE.
  readonly invoice: InvoiceSummary | null;
  // FINAL: cuándo se generó. INFORMATIVE: cuándo se calculó.
  readonly generatedAt: Date;
}

// Módulo 1 recibe una liquidación; la OTA, las FINAL de su reserva ordenadas por roomId.
export type GetSettlementResult =
  | { readonly kind: 'SINGLE'; readonly settlement: SettlementQueryResult }
  | {
      readonly kind: 'COLLECTION';
      readonly reservationRef: string;
      readonly settlements: readonly SettlementQueryResult[];
    };

// Una liquidación Final guardada tal como la devuelve la consulta, sin recalcular nada
// (FR-004, BR-003): todos los importes son los que guardó 007.
export function finalSettlementResult(
  settlement: Settlement,
  invoice: InvoiceSummary | null,
): SettlementQueryResult {
  return {
    settlementType: 'FINAL',
    reservationRef: settlement.reservationRef,
    roomId: settlement.roomId,
    categoryRoom: settlement.categoryRoom,
    channel: settlement.channel,
    otaId: settlement.otaId,
    currency: settlement.currency,
    breakdown: {
      baseLodgingAmount: settlement.baseLodgingAmount,
      dynamicAdjustmentAmount: settlement.dynamicAdjustmentAmount,
      lodgingAmount: settlement.lodgingAmount,
      otaCommissionPercentage: settlement.otaCommissionPercentage,
      otaCommissionAmount: settlement.otaCommissionAmount,
      netIncome: settlement.netIncome,
    },
    invoice,
    generatedAt: settlement.generatedAt,
  };
}

export interface InformativeSettlementInput {
  readonly reservationRef: string;
  readonly roomId: string;
  readonly terms: ChannelTerms;
  readonly breakdown: SettlementBreakdown;
  readonly calculatedAt: Date;
}

// La liquidación informativa de Módulo 1 (FR-009, FR-010): mismo canal, comisión y
// desglose que guardaría Generar liquidación (FR-008, SC-008), pero solo en memoria.
// categoryRoom es null porque la cotización no lo trae, y nunca sale del parámetro de la
// petición (FR-001). Nunca lleva factura.
export function informativeSettlementResult({
  reservationRef,
  roomId,
  terms,
  breakdown,
  calculatedAt,
}: InformativeSettlementInput): SettlementQueryResult {
  return {
    settlementType: 'INFORMATIVE',
    reservationRef,
    roomId,
    categoryRoom: null,
    channel: terms.channel.kind,
    otaId: terms.channel.otaId,
    currency: breakdown.currency,
    breakdown: {
      baseLodgingAmount: breakdown.baseLodgingAmount.toString(),
      dynamicAdjustmentAmount: breakdown.dynamicAdjustmentAmount.toString(),
      lodgingAmount: breakdown.lodgingAmount.toString(),
      otaCommissionPercentage: terms.commission?.toString() ?? null,
      otaCommissionAmount: breakdown.otaCommissionAmount.toString(),
      netIncome: breakdown.netIncome.toString(),
    },
    invoice: null,
    generatedAt: new Date(calculatedAt.getTime()),
  };
}
