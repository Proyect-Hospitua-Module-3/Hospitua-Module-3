// Feature 007 · Generar liquidación
import { Channel } from '../../../../src/domain/model/shared/channel.vo';

describe('Channel', () => {
  it('directo: sin datos de OTA', () => {
    const channel = Channel.direct();

    expect(channel.kind).toBe('DIRECT');
    expect(channel.isOta).toBe(false);
    expect(channel.otaId).toBeNull();
    expect(channel.otaConfirmationCode).toBeNull();
  });

  it('OTA: con la OTA y su código de confirmación', () => {
    const channel = Channel.ota('booking', 'BKG-88421');

    expect(channel.kind).toBe('OTA');
    expect(channel.isOta).toBe(true);
    expect(channel.otaId).toBe('booking');
    expect(channel.otaConfirmationCode).toBe('BKG-88421');
  });

  it.each([
    ['', 'BKG-88421'],
    ['booking', '  '],
  ])('OTA sin identificador o sin código es un error de programación (%p, %p)', (otaId, code) => {
    expect(() => Channel.ota(otaId, code)).toThrow(Error);
  });
});
