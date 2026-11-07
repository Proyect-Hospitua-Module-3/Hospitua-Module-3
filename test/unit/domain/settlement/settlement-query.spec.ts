// Feature 002 · Consultar liquidación (T004: validación de parámetros por actor)
import { InvalidSettlementQueryError } from '../../../../src/domain/errors/settlement/invalid-settlement-query.error';
import {
  INTERNAL_SETTLEMENT_CALLER,
  parseSettlementQuery,
  SettlementCaller,
} from '../../../../src/domain/model/settlement/settlement-query';

const RESERVATION_REF = 'RES-000123';
const ROOM_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const OTA: SettlementCaller = { kind: 'OTA', otaId: 'booking' };

function rejection(run: () => unknown): InvalidSettlementQueryError {
  try {
    run();
  } catch (error) {
    if (error instanceof InvalidSettlementQueryError) return error;
    throw error;
  }
  throw new Error('Se esperaba InvalidSettlementQueryError');
}

describe('parseSettlementQuery', () => {
  describe('Módulo 1 (sin token)', () => {
    it('acepta reservationRef y roomId y conserva el id de correlación', () => {
      expect(
        parseSettlementQuery(
          { reservationRef: RESERVATION_REF, roomId: ROOM_ID, correlationId: 'corr-1' },
          INTERNAL_SETTLEMENT_CALLER,
        ),
      ).toEqual({
        kind: 'INTERNAL',
        reservationRef: RESERVATION_REF,
        roomId: ROOM_ID,
        correlationId: 'corr-1',
      });
    });

    it('acepta un roomId en mayúsculas o que no sigue la versión del RFC (mismo formato que 007)', () => {
      const upper = ROOM_ID.toUpperCase();
      const nonRfc = '00000000-0000-0000-0000-000000000001';

      expect(
        parseSettlementQuery(
          { reservationRef: RESERVATION_REF, roomId: upper },
          INTERNAL_SETTLEMENT_CALLER,
        ),
      ).toMatchObject({ roomId: upper });
      expect(
        parseSettlementQuery(
          { reservationRef: RESERVATION_REF, roomId: nonRfc },
          INTERNAL_SETTLEMENT_CALLER,
        ),
      ).toMatchObject({ roomId: nonRfc });
    });

    it.each([
      ['falta', {}],
      ['está vacío', { reservationRef: '' }],
      ['está en blanco', { reservationRef: '   ' }],
      ['llega repetido', { reservationRef: [RESERVATION_REF, 'RES-2'] }],
    ])('rechaza con INVALID_QUERY_PARAMS si reservationRef %s (FR-013)', (_case, query) => {
      const error = rejection(() =>
        parseSettlementQuery({ ...query, roomId: ROOM_ID }, INTERNAL_SETTLEMENT_CALLER),
      );

      expect(error.errorCode).toBe('INVALID_QUERY_PARAMS');
      expect(error.message).toContain('reservationRef');
    });

    it.each([
      ['falta', {}],
      ['está vacío', { roomId: '' }],
      ['llega repetido', { roomId: [ROOM_ID, ROOM_ID] }],
      ['no es un UUID', { roomId: 'habitacion-101' }],
    ])('rechaza con INVALID_QUERY_PARAMS si roomId %s (FR-013)', (_case, query) => {
      const error = rejection(() =>
        parseSettlementQuery(
          { ...query, reservationRef: RESERVATION_REF },
          INTERNAL_SETTLEMENT_CALLER,
        ),
      );

      expect(error.errorCode).toBe('INVALID_QUERY_PARAMS');
      expect(error.message).toContain('roomId');
    });

    it('el mensaje de rechazo no revela información de la reserva (SC-010)', () => {
      const error = rejection(() =>
        parseSettlementQuery({ reservationRef: RESERVATION_REF }, INTERNAL_SETTLEMENT_CALLER),
      );

      expect(error.message).not.toContain(RESERVATION_REF);
    });
  });

  describe('OTA (con token)', () => {
    it('solo exige reservationRef y toma el otaId del token', () => {
      expect(
        parseSettlementQuery({ reservationRef: RESERVATION_REF, correlationId: 'corr-2' }, OTA),
      ).toEqual({
        kind: 'OTA',
        reservationRef: RESERVATION_REF,
        otaId: 'booking',
        correlationId: 'corr-2',
      });
    });

    it('ignora roomId aunque llegue mal formado o repetido (contrato, «Parámetros»)', () => {
      const result = parseSettlementQuery(
        { reservationRef: RESERVATION_REF, roomId: ['no-uuid', 'otro'] },
        OTA,
      );

      expect(result).toEqual({ kind: 'OTA', reservationRef: RESERVATION_REF, otaId: 'booking' });
    });

    it('rechaza con INVALID_QUERY_PARAMS si falta reservationRef', () => {
      expect(rejection(() => parseSettlementQuery({}, OTA)).errorCode).toBe('INVALID_QUERY_PARAMS');
    });
  });
});
