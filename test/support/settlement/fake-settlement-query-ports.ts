// Feature 002 · Consultar liquidación
// Dobles de prueba de los puertos de lectura de 002 y liquidaciones Final de ejemplo
// (contrato GET-settlements.md, ejemplo OTA: 750.000 de hospedaje, 15% de comisión).
import { Settlement, StoredSettlement } from '../../../src/domain/model/settlement/settlement';
import { InvoiceSummary } from '../../../src/domain/model/settlement/settlement-query-result';
import { SettlementInvoiceQueryPort } from '../../../src/domain/ports/out/settlement/settlement-invoice-query.port';
import { SettlementQueryPort } from '../../../src/domain/ports/out/settlement/settlement-query.port';
import { RESERVATION_REF, ROOM_A } from './fake-settlement-ports';

export const OTA_ID = 'booking';

let nextId = 0;
function nextUuid(prefix: string): string {
  nextId += 1;
  return `${prefix}-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
}

// Liquidación Final de la OTA `booking` en RES-000123, habitación ROOM_A.
export function finalSettlement(overrides: Partial<StoredSettlement> = {}): Settlement {
  return Settlement.restore({
    settlementId: nextUuid('d2000000'),
    stayId: nextUuid('d3000000'),
    reservationRef: RESERVATION_REF,
    roomId: ROOM_A,
    categoryRoom: 'DOBLE',
    checkInDate: '2026-12-20',
    checkOutDate: '2026-12-23',
    quoteId: 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b',
    channel: 'OTA',
    otaId: OTA_ID,
    otaConfirmationCode: 'BKG-88421',
    otaCommissionPercentage: '15.00',
    currency: 'COP',
    lodgingAmount: '750000.00',
    baseLodgingAmount: '700000.00',
    dynamicAdjustmentAmount: '50000.00',
    otaCommissionAmount: '112500.00',
    netIncome: '637500.00',
    sourceEventId: '9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72',
    generatedAt: new Date('2026-12-23T16:04:58.000Z'),
    ...overrides,
  });
}

// Liquidación Final del canal directo (sin OTA ni comisión) en la misma reserva.
export function directFinalSettlement(overrides: Partial<StoredSettlement> = {}): Settlement {
  return finalSettlement({
    channel: 'DIRECT',
    otaId: null,
    otaConfirmationCode: null,
    otaCommissionPercentage: null,
    lodgingAmount: '540000.00',
    baseLodgingAmount: '600000.00',
    dynamicAdjustmentAmount: '-60000.00',
    otaCommissionAmount: '0.00',
    netIncome: '540000.00',
    ...overrides,
  });
}

// Factura emitida por 006 para una liquidación (IVA 19% sobre 750.000).
export function issuedInvoice(overrides: Partial<InvoiceSummary> = {}): InvoiceSummary {
  return {
    invoiceId: nextUuid('d4000000'),
    invoiceNumber: 1042,
    issuedAt: new Date('2026-12-23T16:05:12.000Z'),
    vatRateApplied: '19.00',
    vatAmount: '142500.00',
    totalAmount: '892500.00',
    status: 'ISSUED',
    ...overrides,
  };
}

// Como el adaptador real: solo las Final de la reserva cuyo ota_id es el de la OTA. Las
// devuelve en el orden en que se guardaron (el servicio no debe depender del orden).
// `leaky` simula un adaptador que olvidó filtrar por OTA, para probar que el servicio
// tampoco deja pasar liquidaciones ajenas.
export class InMemorySettlementQuery implements SettlementQueryPort {
  readonly settlements: Settlement[] = [];
  readonly calls: Array<{ reservationRef: string; otaId: string }> = [];
  leaky = false;
  failure?: Error;

  constructor(settlements: Settlement[] = []) {
    this.settlements.push(...settlements);
  }

  async findByReservationRefAndOtaId(reservationRef: string, otaId: string): Promise<Settlement[]> {
    this.calls.push({ reservationRef, otaId });
    if (this.failure) throw this.failure;
    return this.settlements.filter(
      (settlement) =>
        settlement.reservationRef === reservationRef &&
        (this.leaky || (settlement.channel === 'OTA' && settlement.otaId === otaId)),
    );
  }
}

export class InMemorySettlementInvoices implements SettlementInvoiceQueryPort {
  readonly bySettlementId = new Map<string, InvoiceSummary>();
  readonly calls: string[] = [];
  failure?: Error;

  emit(settlement: Settlement, overrides: Partial<InvoiceSummary> = {}): InvoiceSummary {
    const invoice = issuedInvoice(overrides);
    this.bySettlementId.set(settlement.settlementId, invoice);
    return invoice;
  }

  async findBySettlementId(settlementId: string): Promise<InvoiceSummary | null> {
    this.calls.push(settlementId);
    if (this.failure) throw this.failure;
    return this.bySettlementId.get(settlementId) ?? null;
  }
}
