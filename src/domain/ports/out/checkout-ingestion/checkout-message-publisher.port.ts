// Feature 010 · Registrar Check-out

export const CHECKOUT_MESSAGE_PUBLISHER = Symbol('CheckoutMessagePublisherPort');

// Publicación directa a la cola de reintento o a la DLQ. Conserva el cuerpo y los
// headers originales. La promesa se resuelve solo con publisher confirm y sin
// `basic.return`; en cualquier otro caso se rechaza (contrato, sección 4).
export interface CheckoutMessagePublisherPort {
  // Escribe `x-retry-count` con el valor calculado por el servicio.
  publishToRetry(
    body: Uint8Array,
    headers: Readonly<Record<string, unknown>>,
    retryCount: number,
  ): Promise<void>;

  publishToDeadLetter(body: Uint8Array, headers: Readonly<Record<string, unknown>>): Promise<void>;
}
