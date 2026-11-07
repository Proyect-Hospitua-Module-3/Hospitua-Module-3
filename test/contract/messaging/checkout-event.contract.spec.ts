// Feature 010 · Registrar Check-out
// T013: el evento facturacion.checkout tal como lo define
// features/010-registrar-checkout/2-technical/contracts/EVENT-facturacion-checkout.md
import { TRANSIENT_CHECKOUT_ERROR_CODES } from '../../../src/application/services/checkout-ingestion/register-checkout.service';
import { recognizeCheckoutEnvelope } from '../../../src/domain/model/checkout-ingestion/checkout-event';
import {
  CHECKOUT_DEAD_LETTER_QUEUE,
  CHECKOUT_QUEUE,
  CHECKOUT_RETRY_DELAY_MS,
  CHECKOUT_RETRY_QUEUE,
  CHECKOUT_ROUTING_KEY,
  HOSPITUA_EVENTS_EXCHANGE,
} from '../../../src/infrastructure/config/rabbitmq.config';

// Ejemplos de la sección 6 del contrato, copiados tal cual.
const WITH_BILLING_CUSTOMER = {
  eventId: 'a5d8b76e-3f91-4c22-b88a-9e67d4f91012',
  eventType: 'CHECK_OUT',
  occurredAt: '2026-10-08T11:00:00Z',
  sourceModule: 'MODULE_1',
  payload: {
    stayId: 'd1e4c7b8-2a55-4e31-89d2-b0a112233445',
    reservationRef: 'RES-000123',
    roomId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    categoryRoom: 'DOBLE',
    checkInDate: '2026-10-05',
    checkOutDate: '2026-10-08',
    billingCustomer: { name: 'Comercializadora Andina S.A.S.', taxId: '900123456-7' },
  },
};

const WITHOUT_BILLING_CUSTOMER = {
  eventId: 'b7e9c112-4a02-4d33-a11b-8e55d3f82033',
  eventType: 'CHECK_OUT',
  occurredAt: '2026-10-08T06:05:00-05:00',
  sourceModule: 'MODULE_1',
  payload: {
    stayId: 'e3f5d8c9-3b66-4f42-9a03-c1b223344556',
    reservationRef: 'RES-000456',
    roomId: 'a11bc20c-69dd-4483-b678-1f13c3d4e580',
    categoryRoom: 'DOBLE',
    checkInDate: '2026-10-07',
    checkOutDate: '2026-10-08',
  },
};

function eventOf(envelope: unknown) {
  const recognition = recognizeCheckoutEnvelope(envelope);
  if (!recognition.recognized) throw new Error(recognition.reason);
  return recognition.envelope.toCheckoutEvent();
}

describe('Contrato del evento facturacion.checkout', () => {
  it('acepta el ejemplo con datos tributarios y los entrega para 006', () => {
    const event = eventOf(WITH_BILLING_CUSTOMER);
    expect(event.billingCustomer).toEqual(WITH_BILLING_CUSTOMER.payload.billingCustomer);
    expect(event.auditPayload().has_billing_customer).toBe(true);
  });

  it('acepta el ejemplo sin datos tributarios (no invalida el evento)', () => {
    const event = eventOf(WITHOUT_BILLING_CUSTOMER);
    expect(event.billingCustomer).toBeNull();
    expect(event.auditPayload().has_billing_customer).toBe(false);
  });

  it('acepta el sobre que publica Módulo 1 (occurredAt con -05:00 y fracción de segundo)', () => {
    const fromModule1 = {
      ...WITH_BILLING_CUSTOMER,
      occurredAt: '2026-10-11T11:20:40.123456-05:00',
    };
    expect(eventOf(fromModule1).occurredAt.toISOString()).toBe('2026-10-11T16:20:40.123Z');
  });

  it('la auditoría solo guarda la lista blanca del payload más has_billing_customer', () => {
    expect(Object.keys(eventOf(WITH_BILLING_CUSTOMER).auditPayload()).sort()).toEqual([
      'categoryRoom',
      'checkInDate',
      'checkOutDate',
      'has_billing_customer',
      'reservationRef',
      'roomId',
      'stayId',
    ]);
  });

  it('la topología coincide con la sección 2 del contrato', () => {
    expect(HOSPITUA_EVENTS_EXCHANGE).toBe('hospitua.events');
    expect(CHECKOUT_ROUTING_KEY).toBe('facturacion.checkout');
    expect(CHECKOUT_QUEUE).toBe('modulo3.checkout');
    expect(CHECKOUT_RETRY_QUEUE).toBe('modulo3.checkout.retry.30s');
    expect(CHECKOUT_RETRY_DELAY_MS).toBe(30_000);
    expect(CHECKOUT_DEAD_LETTER_QUEUE).toBe('modulo3.checkout.dlq');
  });

  it('solo las fallas transitorias de la sección 4 van a la cola de reintento', () => {
    expect([...TRANSIENT_CHECKOUT_ERROR_CODES].sort()).toEqual([
      'DATABASE_UNAVAILABLE',
      'MODULE2_UNAVAILABLE',
      'VAT_RATE_UNAVAILABLE',
    ]);
  });
});
