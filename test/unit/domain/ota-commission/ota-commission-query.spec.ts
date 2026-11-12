// Feature 003 · Consultar porcentaje de comisión OTA
import { CommissionNotApplicableError } from '../../../../src/domain/errors/ota-commission/commission-not-applicable.error';
import { InvalidOtaCommissionQueryError } from '../../../../src/domain/errors/ota-commission/invalid-ota-commission-query.error';
import { parseOtaId } from '../../../../src/domain/model/ota-commission/ota-commission-query';
import { OtaCommissionReference } from '../../../../src/domain/model/ota-commission/ota-commission-reference';

describe('parseOtaId (003)', () => {
  it('devuelve el otaId tal como llega', () => {
    expect(parseOtaId('booking')).toBe('booking');
  });

  it.each(['DIRECT', 'direct', ' Direct '])(
    'el canal directo (%p) no es una OTA → INVALID_QUERY_PARAMS (FR-006)',
    (raw) => {
      expect(() => parseOtaId(raw)).toThrow(CommissionNotApplicableError);
      expect(() => parseOtaId(raw)).toThrow(
        expect.objectContaining({ errorCode: 'INVALID_QUERY_PARAMS' }),
      );
    },
  );

  it.each(['', '   ', undefined, ['booking', 'expedia']])(
    'un otaId vacío o que no es texto (%p) → INVALID_QUERY_PARAMS',
    (raw) => {
      expect(() => parseOtaId(raw)).toThrow(InvalidOtaCommissionQueryError);
    },
  );
});

describe('OtaCommissionReference (003)', () => {
  const input = {
    otaId: 'booking',
    percentage: '15',
    settlementId: '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01',
    settlementDate: new Date('2026-10-08T16:02:00.000Z'),
  };

  it('guarda el porcentaje como decimal exacto de 2 decimales y es inmutable', () => {
    const reference = OtaCommissionReference.of(input);

    expect(reference.percentage.toString()).toBe('15.00');
    expect(Object.isFrozen(reference)).toBe(true);
  });

  it('copia la fecha: cambiar la original no altera la referencia', () => {
    const date = new Date(input.settlementDate.getTime());
    const reference = OtaCommissionReference.of({ ...input, settlementDate: date });
    date.setUTCFullYear(2000);

    expect(reference.settlementDate.toISOString()).toBe('2026-10-08T16:02:00.000Z');
  });

  it.each(['-1', '100.01', 'abc'])('rechaza un porcentaje imposible (%p)', (percentage) => {
    expect(() => OtaCommissionReference.of({ ...input, percentage })).toThrow();
  });
});
