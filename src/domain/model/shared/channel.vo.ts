// Feature 007 · Generar liquidación
// VO compartido del plan base (T006): lo usan settlement (007, 002) y billing (006, 008).

export type ChannelKind = 'DIRECT' | 'OTA';

// Canal de origen de la reserva. Directo (recepción, teléfono, portal propio o sin canal
// informado) o intermediado por una OTA, con su código de confirmación externo.
export class Channel {
  private constructor(
    readonly kind: ChannelKind,
    readonly otaId: string | null,
    readonly otaConfirmationCode: string | null,
  ) {
    Object.freeze(this);
  }

  static direct(): Channel {
    return new Channel('DIRECT', null, null);
  }

  static ota(otaId: string, otaConfirmationCode: string): Channel {
    if (!otaId.trim() || !otaConfirmationCode.trim()) {
      // Error de programación: quien construye el canal ya validó los datos de la OTA.
      throw new Error(
        'Un canal OTA necesita el identificador de la OTA y su código de confirmación.',
      );
    }
    return new Channel('OTA', otaId, otaConfirmationCode);
  }

  get isOta(): boolean {
    return this.kind === 'OTA';
  }
}
