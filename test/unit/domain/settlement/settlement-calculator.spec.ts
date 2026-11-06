// Feature 007 · Generar liquidación (T013, T022)
import { Channel } from '../../../../src/domain/model/shared/channel.vo';
import { CommissionPercentage } from '../../../../src/domain/model/settlement/commission-percentage.vo';
import {
  SettlementBreakdown,
  SettlementCalculator,
} from '../../../../src/domain/model/settlement/settlement-calculator';
import { QUOTE_A, ROOM_A, storedQuote } from '../../../support/settlement/fake-settlement-ports';

function asText(breakdown: SettlementBreakdown) {
  return {
    currency: breakdown.currency,
    lodgingAmount: breakdown.lodgingAmount.toString(),
    baseLodgingAmount: breakdown.baseLodgingAmount.toString(),
    dynamicAdjustmentAmount: breakdown.dynamicAdjustmentAmount.toString(),
    otaCommissionAmount: breakdown.otaCommissionAmount.toString(),
    netIncome: breakdown.netIncome.toString(),
  };
}

function commission(raw: number | string): CommissionPercentage {
  const parsed = CommissionPercentage.tryParse(raw);
  if (!parsed) throw new Error(`porcentaje de prueba inválido: ${raw}`);
  return parsed;
}

const OTA = Channel.ota('booking', 'BKG-88421');

describe('SettlementCalculator', () => {
  describe('canal directo (HU1)', () => {
    it('ingreso neto = hospedaje de la cotización, sin comisión ni IVA, con el desglose base/dinámica', () => {
      const breakdown = SettlementCalculator.calculate({
        quote: storedQuote(QUOTE_A, ROOM_A),
        channel: Channel.direct(),
        commission: null,
      });

      expect(asText(breakdown)).toEqual({
        currency: 'COP',
        lodgingAmount: '750000.00',
        baseLodgingAmount: '700000.00',
        dynamicAdjustmentAmount: '50000.00',
        otaCommissionAmount: '0.00',
        netIncome: '750000.00',
      });
    });

    it('un ajuste dinámico negativo (temporada baja) no cambia el ingreso neto', () => {
      const quote = storedQuote(
        QUOTE_A,
        ROOM_A,
        [
          ['2026-12-20', '300000.00', '270000.00'],
          ['2026-12-21', '300000.00', '270000.00'],
        ],
        '540000.00',
      );

      const breakdown = SettlementCalculator.calculate({
        quote,
        channel: Channel.direct(),
        commission: null,
      });

      expect(breakdown.baseLodgingAmount.toString()).toBe('600000.00');
      expect(breakdown.dynamicAdjustmentAmount.toString()).toBe('-60000.00');
      expect(breakdown.netIncome.toString()).toBe('540000.00');
    });

    it('nunca recalcula: usa el lodgingAmount guardado aunque las noches no sumen lo mismo', () => {
      // Valor que el cliente aceptó al reservar (BR-004); el calculador no lo rehace.
      const quote = storedQuote(QUOTE_A, ROOM_A, undefined, '749999.99');

      const breakdown = SettlementCalculator.calculate({
        quote,
        channel: Channel.direct(),
        commission: null,
      });

      expect(breakdown.lodgingAmount.toString()).toBe('749999.99');
      expect(breakdown.netIncome.toString()).toBe('749999.99');
    });
  });

  describe('canal OTA (HU2)', () => {
    it('ejemplo del plan: 750.000 con 15 % → comisión 112.500 y neto 637.500, sin IVA', () => {
      const breakdown = SettlementCalculator.calculate({
        quote: storedQuote(QUOTE_A, ROOM_A),
        channel: OTA,
        commission: commission(15),
      });

      expect(asText(breakdown)).toEqual({
        currency: 'COP',
        lodgingAmount: '750000.00',
        baseLodgingAmount: '700000.00',
        dynamicAdjustmentAmount: '50000.00',
        otaCommissionAmount: '112500.00',
        netIncome: '637500.00',
      });
    });

    it.each([
      // 333333.33 × 12.5 % = 41666.66625 → half-up 41666.67
      ['333333.33', '12.5', '41666.67', '291666.66'],
      // 100000.10 × 0.05 % = 50.00005 → 50.00
      ['100000.10', '0.05', '50.00', '99950.10'],
      // 0.10 × 15 % = 0.015 → half-up 0.02 (sin errores de coma flotante)
      ['0.10', '15', '0.02', '0.08'],
    ])(
      'hospedaje %s con %s %% → comisión %s (half-up a 2 decimales) y neto %s',
      (lodgingAmount, percentage, expectedCommission, expectedNet) => {
        const quote = storedQuote(
          QUOTE_A,
          ROOM_A,
          [['2026-12-20', lodgingAmount, lodgingAmount]],
          lodgingAmount,
        );

        const breakdown = SettlementCalculator.calculate({
          quote,
          channel: OTA,
          commission: commission(percentage),
        });

        expect(breakdown.otaCommissionAmount.toString()).toBe(expectedCommission);
        expect(breakdown.netIncome.toString()).toBe(expectedNet);
      },
    );

    it.each([
      [0, '0.00', '750000.00'],
      [100, '750000.00', '0.00'],
    ])(
      'con %s %% de comisión: comisión %s y neto %s',
      (percentage, expectedCommission, expectedNet) => {
        const breakdown = SettlementCalculator.calculate({
          quote: storedQuote(QUOTE_A, ROOM_A),
          channel: OTA,
          commission: commission(percentage),
        });

        expect(breakdown.otaCommissionAmount.toString()).toBe(expectedCommission);
        expect(breakdown.netIncome.toString()).toBe(expectedNet);
      },
    );
  });

  it('rechaza como error de programación un canal OTA sin comisión o uno directo con comisión', () => {
    const quote = storedQuote(QUOTE_A, ROOM_A);

    expect(() => SettlementCalculator.calculate({ quote, channel: OTA, commission: null })).toThrow(
      Error,
    );
    expect(() =>
      SettlementCalculator.calculate({
        quote,
        channel: Channel.direct(),
        commission: commission(15),
      }),
    ).toThrow(Error);
  });

  it('es determinista: el mismo insumo da siempre el mismo desglose (NFR-001)', () => {
    const input = { quote: storedQuote(QUOTE_A, ROOM_A), channel: OTA, commission: commission(15) };

    expect(asText(SettlementCalculator.calculate(input))).toEqual(
      asText(SettlementCalculator.calculate(input)),
    );
  });
});
