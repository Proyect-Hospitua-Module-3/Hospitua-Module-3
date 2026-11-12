// Feature 003 · Consultar porcentaje de comisión OTA
// Doble en memoria de OtaCommissionQueryPort: guarda las liquidaciones "sembradas" y registra
// cada consulta, para comprobar que el caso de uso no lee settlement cuando rechaza.
import { OtaCommissionReference } from '../../../src/domain/model/ota-commission/ota-commission-reference';
import { OtaCommissionQueryPort } from '../../../src/domain/ports/out/ota-commission/ota-commission-query.port';

export const OTA_ID = 'booking';
export const OTHER_OTA_ID = 'expedia';
export const SETTLEMENT_ID = '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01';
export const SETTLEMENT_DATE = new Date('2026-10-08T16:02:00.000Z');

export function reference(
  overrides: Partial<{
    otaId: string;
    percentage: string;
    settlementId: string;
    settlementDate: Date;
  }> = {},
): OtaCommissionReference {
  return OtaCommissionReference.of({
    otaId: OTA_ID,
    percentage: '15.00',
    settlementId: SETTLEMENT_ID,
    settlementDate: SETTLEMENT_DATE,
    ...overrides,
  });
}

export class InMemoryOtaCommissionQuery implements OtaCommissionQueryPort {
  references: OtaCommissionReference[] = [];
  calls: string[] = [];

  async findLatestByOtaId(otaId: string): Promise<OtaCommissionReference | null> {
    this.calls.push(otaId);
    const own = this.references
      .filter((item) => item.otaId === otaId)
      .sort((a, b) => b.settlementDate.getTime() - a.settlementDate.getTime());
    return own[0] ?? null;
  }
}
