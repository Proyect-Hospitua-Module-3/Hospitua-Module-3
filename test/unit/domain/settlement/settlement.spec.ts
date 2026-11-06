// Feature 007 · Generar liquidación
import { CheckoutData } from '../../../../src/domain/model/settlement/checkout-data';
import { channelTermsOf } from '../../../../src/domain/model/settlement/reservation-data';
import { Settlement } from '../../../../src/domain/model/settlement/settlement';
import { SettlementCalculator } from '../../../../src/domain/model/settlement/settlement-calculator';
import {
  checkoutCommand,
  EVENT_ID,
  GENERATED_AT,
  otaReservation,
  QUOTE_A,
  ROOM_A,
  storedQuote,
} from '../../../support/settlement/fake-settlement-ports';

const SETTLEMENT_ID = '4e2b8c1d-9a7f-4f3e-b6d5-0c1a2b3d4e5f';

function prepared() {
  const checkout = CheckoutData.of(checkoutCommand());
  const quote = storedQuote(QUOTE_A, ROOM_A);
  const terms = channelTermsOf(otaReservation());
  const breakdown = SettlementCalculator.calculate({ quote, ...terms });
  return Settlement.prepare({
    settlementId: SETTLEMENT_ID,
    checkout,
    quoteId: QUOTE_A,
    terms,
    breakdown,
  });
}

describe('Settlement', () => {
  it('prepare arma la liquidación con la estancia, la cotización, el canal y el desglose (FR-012, FR-016)', () => {
    expect(prepared()).toEqual({
      settlementId: SETTLEMENT_ID,
      stayId: 'c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c',
      reservationRef: 'RES-000123',
      roomId: ROOM_A,
      categoryRoom: 'DOBLE',
      checkInDate: '2026-12-20',
      checkOutDate: '2026-12-23',
      quoteId: QUOTE_A,
      channel: 'OTA',
      otaId: 'booking',
      otaConfirmationCode: 'BKG-88421',
      otaCommissionPercentage: '15.00',
      currency: 'COP',
      lodgingAmount: '750000.00',
      baseLodgingAmount: '700000.00',
      dynamicAdjustmentAmount: '50000.00',
      otaCommissionAmount: '112500.00',
      netIncome: '637500.00',
      sourceEventId: EVENT_ID,
    });
  });

  it('restore la deja siempre Final e inmutable (FR-009)', () => {
    const settlement = Settlement.restore({ ...prepared(), generatedAt: GENERATED_AT });

    expect(settlement.status).toBe('FINAL');
    expect(settlement.generatedAt).toEqual(GENERATED_AT);
    expect(Object.isFrozen(settlement)).toBe(true);
    expect(() => {
      (settlement as { netIncome: string }).netIncome = '0.00';
    }).toThrow(TypeError);
  });

  it('differencesWith: vacío para un reenvío idéntico, aunque cambie el eventId (FR-011)', () => {
    const settlement = Settlement.restore({ ...prepared(), generatedAt: GENERATED_AT });
    const resent = CheckoutData.of(
      checkoutCommand({ eventId: '0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a' }),
    );

    expect(settlement.differencesWith(resent)).toEqual([]);
  });

  it('differencesWith: lista los datos del check-out que cambiaron (FR-010)', () => {
    const settlement = Settlement.restore({ ...prepared(), generatedAt: GENERATED_AT });
    const other = CheckoutData.of(
      checkoutCommand({ checkOutDate: '2026-12-24', categoryRoom: 'SUITE' }),
    );

    expect(settlement.differencesWith(other)).toEqual(['categoryRoom', 'checkOutDate']);
  });
});
