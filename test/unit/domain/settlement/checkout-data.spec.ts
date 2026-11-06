// Feature 007 · Generar liquidación
import { InvalidCheckoutDataError } from '../../../../src/domain/errors/settlement/invalid-checkout-data.error';
import { CheckoutData } from '../../../../src/domain/model/settlement/checkout-data';
import {
  checkoutCommand,
  ROOM_A,
  STAY_ID,
} from '../../../support/settlement/fake-settlement-ports';

describe('CheckoutData', () => {
  it('acepta un comando válido y pone los UUID en minúsculas', () => {
    const checkout = CheckoutData.of(
      checkoutCommand({ stayId: STAY_ID.toUpperCase(), roomId: ROOM_A.toUpperCase() }),
    );

    expect(checkout.stayId).toBe(STAY_ID);
    expect(checkout.roomId).toBe(ROOM_A);
    expect(checkout.checkInDate).toBe('2026-12-20');
    expect(checkout.checkOutDate).toBe('2026-12-23');
  });

  it('acepta la salida el mismo día de la entrada', () => {
    const checkout = CheckoutData.of(
      checkoutCommand({ checkInDate: '2026-12-20', checkOutDate: '2026-12-20' }),
    );

    expect(checkout.checkOutDate).toBe('2026-12-20');
  });

  it('acepta ids de Módulo 1 que no siguen el RFC', () => {
    expect(() =>
      CheckoutData.of(checkoutCommand({ roomId: 'a0000000-0000-0000-0000-000000000101' })),
    ).not.toThrow();
  });

  it.each([
    ['eventId ausente', { eventId: undefined }],
    ['stayId que no es UUID', { stayId: 'estancia-1' }],
    ['roomId vacío', { roomId: '' }],
    ['reservationRef en blanco', { reservationRef: '   ' }],
    ['categoryRoom ausente', { categoryRoom: undefined }],
    ['checkInDate con otro formato', { checkInDate: '20/12/2026' }],
    ['checkOutDate inexistente', { checkOutDate: '2026-02-30' }],
    ['salida anterior a la entrada', { checkInDate: '2026-12-23', checkOutDate: '2026-12-20' }],
    ['un número en lugar de texto', { reservationRef: 123 }],
  ])('rechaza %s con INVALID_CHECKOUT_EVENT (BR-007)', (_label, overrides) => {
    const command = { ...checkoutCommand(), ...overrides } as Record<string, unknown>;

    expect(() => CheckoutData.of(command)).toThrow(InvalidCheckoutDataError);
    expect(() => CheckoutData.of(command)).toThrow(
      expect.objectContaining({ errorCode: 'INVALID_CHECKOUT_EVENT' }),
    );
  });
});
