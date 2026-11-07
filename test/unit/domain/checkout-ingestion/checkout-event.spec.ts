// Feature 010 · Registrar Check-out
import { InvalidCheckoutEventError } from '../../../../src/domain/errors/checkout-ingestion/invalid-checkout-event.error';
import {
  CheckoutEvent,
  recognizeCheckoutEnvelope,
} from '../../../../src/domain/model/checkout-ingestion/checkout-event';
import { validEnvelope } from '../../../support/checkout-ingestion/checkout-event-fixtures';

function toEvent(envelope: unknown): CheckoutEvent {
  const recognition = recognizeCheckoutEnvelope(envelope);
  if (!recognition.recognized) {
    throw new Error(`Sobre no reconocido: ${recognition.reason}`);
  }
  return recognition.envelope.toCheckoutEvent();
}

function rejectionOf(envelope: unknown): string {
  try {
    toEvent(envelope);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidCheckoutEventError);
    expect((error as InvalidCheckoutEventError).errorCode).toBe('INVALID_CHECKOUT_EVENT');
    return (error as Error).message;
  }
  throw new Error('Se esperaba INVALID_CHECKOUT_EVENT');
}

// T012: sobre, lista blanca y fechas.
describe('Evento Registrar Check-out', () => {
  describe('reconocimiento del sobre', () => {
    it.each([
      ['un texto', 'hola'],
      ['una lista', [validEnvelope()]],
      ['null', null],
    ])('no reconoce %s como sobre', (_caso, value) => {
      const recognition = recognizeCheckoutEnvelope(value);
      expect(recognition.recognized).toBe(false);
    });

    it.each([
      ['sin eventId', undefined],
      ['eventId que no es UUID', 'evento-1'],
      ['eventId numérico', 12345],
    ])('no reconoce un sobre %s', (_caso, eventId) => {
      const envelope = { ...validEnvelope(), eventId };
      const recognition = recognizeCheckoutEnvelope(envelope);
      expect(recognition).toEqual({
        recognized: false,
        reason: 'El sobre del evento no trae un eventId con formato UUID.',
      });
    });

    it('reconoce el sobre aunque el resto del evento sea inválido y normaliza el eventId', () => {
      const recognition = recognizeCheckoutEnvelope({
        eventId: 'A5D8B76E-3F91-4C22-B88A-9E67D4F91012',
      });
      expect(recognition.recognized && recognition.envelope.eventId).toBe(
        'a5d8b76e-3f91-4c22-b88a-9e67d4f91012',
      );
    });
  });

  describe('validación', () => {
    it('acepta el evento del contrato con datos tributarios', () => {
      const event = toEvent(validEnvelope());

      expect(event).toMatchObject({
        eventId: 'a5d8b76e-3f91-4c22-b88a-9e67d4f91012',
        stayId: 'd1e4c7b8-2a55-4e31-89d2-b0a112233445',
        reservationRef: 'RES-000123',
        roomId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        categoryRoom: 'DOBLE',
        checkInDate: '2026-10-05',
        checkOutDate: '2026-10-08',
        billingCustomer: { name: 'Comercializadora Andina S.A.S.', taxId: '900123456-7' },
      });
      expect(event.occurredAt.toISOString()).toBe('2026-10-08T11:00:00.000Z');
    });

    it.each([
      ['Z', '2026-10-08T11:00:00Z', '2026-10-08T11:00:00.000Z'],
      ['-05:00', '2026-10-08T06:05:00-05:00', '2026-10-08T11:05:00.000Z'],
      ['microsegundos de Módulo 1', '2026-10-08T11:00:00.123456-05:00', '2026-10-08T16:00:00.123Z'],
    ])('acepta occurredAt con %s', (_caso, occurredAt, expected) => {
      const event = toEvent({ ...validEnvelope(), occurredAt });
      expect(event.occurredAt.toISOString()).toBe(expected);
    });

    it.each([
      ['sin offset', '2026-10-08T11:00:00'],
      ['solo fecha', '2026-10-08'],
      ['día inexistente', '2026-02-30T10:00:00Z'],
      ['hora 24', '2026-10-08T24:00:00Z'],
      ['texto libre', 'ayer'],
      ['número', 1759921200000],
    ])('rechaza occurredAt %s', (_caso, occurredAt) => {
      expect(rejectionOf({ ...validEnvelope(), occurredAt })).toContain('occurredAt');
    });

    it.each([
      ['eventType', 'CHECK_IN'],
      ['sourceModule', 'MODULE_2'],
    ])('rechaza %s distinto del contrato', (field, value) => {
      expect(rejectionOf({ ...validEnvelope(), [field]: value })).toContain(field);
    });

    it('rechaza un evento sin payload', () => {
      const { payload: _omitido, ...envelope } = validEnvelope();
      expect(rejectionOf(envelope)).toContain('payload');
    });

    it.each(['stayId', 'reservationRef', 'roomId', 'categoryRoom', 'checkInDate', 'checkOutDate'])(
      'rechaza un evento sin payload.%s (FR-002, FR-005)',
      (field) => {
        const envelope = validEnvelope();
        delete envelope.payload[field];
        expect(rejectionOf(envelope)).toContain(`payload.${field}`);
      },
    );

    it.each([
      ['stayId', 'estancia-1'],
      ['roomId', '101'],
      ['reservationRef', '   '],
      ['categoryRoom', ''],
      ['checkInDate', '2026-02-30'],
      ['checkOutDate', '08/10/2026'],
    ])('rechaza payload.%s inválido (%s)', (field, value) => {
      const envelope = validEnvelope();
      envelope.payload[field] = value;
      expect(rejectionOf(envelope)).toContain(`payload.${field}`);
    });

    it('acepta una estancia de una sola noche (HU1, escenario 2)', () => {
      const envelope = validEnvelope();
      envelope.payload.checkInDate = '2026-10-07';
      envelope.payload.checkOutDate = '2026-10-08';
      expect(toEvent(envelope).checkOutDate).toBe('2026-10-08');
    });

    it('acepta una salida el mismo día de la entrada (FR-003, HU1, escenario 5)', () => {
      const envelope = validEnvelope();
      envelope.payload.checkInDate = '2026-10-08';
      envelope.payload.checkOutDate = '2026-10-08';
      expect(toEvent(envelope).checkInDate).toBe('2026-10-08');
    });

    it('rechaza una salida anterior a la entrada (HU2, escenario 2)', () => {
      const envelope = validEnvelope();
      envelope.payload.checkInDate = '2026-10-09';
      envelope.payload.checkOutDate = '2026-10-08';
      expect(rejectionOf(envelope)).toContain('no puede ser anterior');
    });

    it('acepta un 29 de febrero en año bisiesto', () => {
      const envelope = validEnvelope();
      envelope.payload.checkInDate = '2028-02-28';
      envelope.payload.checkOutDate = '2028-02-29';
      expect(toEvent(envelope).checkOutDate).toBe('2028-02-29');
    });

    it('normaliza a minúsculas los UUID de la estancia y la habitación', () => {
      const envelope = validEnvelope();
      envelope.payload.stayId = 'D1E4C7B8-2A55-4E31-89D2-B0A112233445';
      envelope.payload.roomId = 'F47AC10B-58CC-4372-A567-0E02B2C3D479';
      const event = toEvent(envelope);
      expect(event.stayId).toBe('d1e4c7b8-2a55-4e31-89d2-b0a112233445');
      expect(event.roomId).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    });

    it('produce el mismo resultado al validar dos veces el mismo evento (NFR-001)', () => {
      expect(toEvent(validEnvelope())).toEqual(toEvent(validEnvelope()));
      const invalidEnvelope = { ...validEnvelope(), eventType: 'OTRO' };
      expect(rejectionOf(invalidEnvelope)).toBe(rejectionOf(invalidEnvelope));
    });
  });

  describe('datos tributarios (FR-002, BR-003)', () => {
    it('acepta un evento sin billingCustomer', () => {
      const envelope = validEnvelope();
      delete envelope.payload.billingCustomer;
      expect(toEvent(envelope).billingCustomer).toBeNull();
    });

    it('acepta un billingCustomer incompleto y entrega lo que trae', () => {
      const envelope = validEnvelope();
      envelope.payload.billingCustomer = { name: 'Ana Pérez' };
      expect(toEvent(envelope).billingCustomer).toEqual({ name: 'Ana Pérez', taxId: null });
    });

    it('trata un billingCustomer que no es un objeto como ausente, sin rechazar el evento', () => {
      const envelope = validEnvelope();
      envelope.payload.billingCustomer = 'Ana Pérez';
      expect(toEvent(envelope).billingCustomer).toBeNull();
    });
  });

  describe('lista blanca de auditoría (FR-006, NFR-003)', () => {
    it('omite datos migratorios y campos desconocidos, y no guarda los datos tributarios', () => {
      const envelope = validEnvelope();
      envelope.payload.guests = [{ documentNumber: 'X123', nationality: 'VE' }];
      envelope.payload.sire = { file: 'SIRE.TXT' };
      envelope.payload.channel = 'OTA';

      const recognition = recognizeCheckoutEnvelope(envelope);
      const audit = recognition.recognized ? recognition.envelope.auditPayload() : null;

      expect(audit).toEqual({
        stayId: 'd1e4c7b8-2a55-4e31-89d2-b0a112233445',
        reservationRef: 'RES-000123',
        roomId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        categoryRoom: 'DOBLE',
        checkInDate: '2026-10-05',
        checkOutDate: '2026-10-08',
        has_billing_customer: true,
      });
      expect(toEvent(envelope).auditPayload()).toEqual(audit);
    });

    it.each([
      ['incompleto', { taxId: '' }, true],
      ['vacío', {}, true],
      ['ausente', undefined, false],
    ])('marca has_billing_customer con billingCustomer %s', (_caso, billingCustomer, expected) => {
      const envelope = validEnvelope();
      envelope.payload.billingCustomer = billingCustomer;
      const recognition = recognizeCheckoutEnvelope(envelope);
      expect(
        recognition.recognized && recognition.envelope.auditPayload().has_billing_customer,
      ).toBe(expected);
    });

    it('en un evento inválido audita solo los textos de la lista blanca', () => {
      const envelope = validEnvelope();
      envelope.payload.stayId = 42;
      envelope.payload.roomId = { id: 'x' };

      const recognition = recognizeCheckoutEnvelope(envelope);
      if (!recognition.recognized) throw new Error('Debía reconocerse');

      expect(recognition.envelope.stayId).toBeNull();
      expect(recognition.envelope.auditPayload()).not.toHaveProperty('stayId');
      expect(recognition.envelope.auditPayload()).not.toHaveProperty('roomId');
      expect(recognition.envelope.auditPayload().reservationRef).toBe('RES-000123');
    });
  });
});
