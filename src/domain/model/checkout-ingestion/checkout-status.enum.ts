// Feature 010 · Registrar Check-out

// Estado de un evento en `checkout_event_log`. PENDING es el único no final: un evento
// en PENDING se reanuda al reentregarse; los demás se confirman sin reprocesar.
export const CHECKOUT_STATUSES = ['PENDING', 'PROCESSED', 'REJECTED', 'DEAD_LETTER'] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

export function isFinalCheckoutStatus(status: CheckoutStatus): boolean {
  return status !== 'PENDING';
}
