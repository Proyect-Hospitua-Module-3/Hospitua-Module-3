// Feature 010 · Registrar Check-out

// Sobre válido del contrato (ejemplo "Con datos tributarios"), como objeto mutable para
// que cada prueba cambie solo lo que necesita.
export function validEnvelope(): Record<string, any> {
  return {
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
      billingCustomer: {
        name: 'Comercializadora Andina S.A.S.',
        taxId: '900123456-7',
      },
    },
  };
}

export function toBody(value: unknown): Uint8Array {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
}
