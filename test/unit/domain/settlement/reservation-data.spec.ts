// Feature 007 · Generar liquidación (T023, T025)
import { InvalidCommissionError } from '../../../../src/domain/errors/settlement/invalid-commission.error';
import { MissingCommissionError } from '../../../../src/domain/errors/settlement/missing-commission.error';
import { channelTermsOf } from '../../../../src/domain/model/settlement/reservation-data';
import {
  directReservation,
  otaReservation,
} from '../../../support/settlement/fake-settlement-ports';

describe('channelTermsOf', () => {
  it.each([
    ['sin canal informado', null],
    ['recepción', 'RECEPTION'],
    ['teléfono', 'PHONE'],
    ['portal propio', 'WEBSITE'],
    ['"ota" en minúsculas (solo "OTA" es intermediario)', 'ota'],
  ])('%s → canal directo sin comisión (FR-004, FR-007)', (_label, channel) => {
    const terms = channelTermsOf(directReservation({ channel }));

    expect(terms.channel.kind).toBe('DIRECT');
    expect(terms.channel.otaId).toBeNull();
    expect(terms.commission).toBeNull();
  });

  it('ignora los campos de OTA que lleguen con un canal directo', () => {
    const terms = channelTermsOf(
      directReservation({ channel: 'RECEPTION', otaId: 'booking', otaCommissionPercentage: 15 }),
    );

    expect(terms.channel.kind).toBe('DIRECT');
    expect(terms.commission).toBeNull();
  });

  it.each([15, '15', '15.00'])(
    'canal OTA con porcentaje %p → OTA, su código de confirmación y la comisión (FR-005)',
    (percentage) => {
      const terms = channelTermsOf(otaReservation({ otaCommissionPercentage: percentage }));

      expect(terms.channel.kind).toBe('OTA');
      expect(terms.channel.otaId).toBe('booking');
      expect(terms.channel.otaConfirmationCode).toBe('BKG-88421');
      expect(terms.commission?.toString()).toBe('15.00');
    },
  );

  it.each([
    ['ausente', undefined],
    ['null', null],
    ['texto vacío', ''],
  ])(
    'canal OTA con porcentaje %s → MISSING_COMMISSION, sin asumir uno por defecto',
    (_label, percentage) => {
      const reservation = otaReservation({ otaCommissionPercentage: percentage });

      expect(() => channelTermsOf(reservation)).toThrow(MissingCommissionError);
      expect(() => channelTermsOf(reservation)).toThrow(/RES-000123.*'booking'/);
    },
  );

  it.each([-5, 120, '100.01', 'quince'])(
    'canal OTA con porcentaje %p → INVALID_COMMISSION, sin estimar una comisión',
    (percentage) => {
      expect(() => channelTermsOf(otaReservation({ otaCommissionPercentage: percentage }))).toThrow(
        InvalidCommissionError,
      );
    },
  );
});
