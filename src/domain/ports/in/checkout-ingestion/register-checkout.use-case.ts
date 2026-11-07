// Feature 010 · Registrar Check-out
// Contrato: features/010-registrar-checkout/2-technical/contracts/EVENT-facturacion-checkout.md

export const REGISTER_CHECKOUT_USE_CASE = Symbol('RegisterCheckoutUseCase');

// Qué hace el consumer con el mensaje original: ack, o nack con reencolado.
export type RegisterCheckoutResult = 'ACK' | 'NACK_REQUEUE';

// El mensaje tal como llega de `modulo3.checkout`, sin interpretar.
export interface RegisterCheckoutCommand {
  body: Uint8Array;
  headers: Readonly<Record<string, unknown>>;
}

// Procesa un mensaje `facturacion.checkout`: audita, valida y decide si va a la cola de
// reintento o a la DLQ. Nunca lanza: cualquier fallo se traduce en NACK_REQUEUE.
export interface RegisterCheckoutUseCase {
  register(command: RegisterCheckoutCommand): Promise<RegisterCheckoutResult>;
}
