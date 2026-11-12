// Feature 003 · Consultar porcentaje de comisión OTA
import { OtaAccessDeniedError } from '../../../domain/errors/ota-commission/ota-access-denied.error';
import {
  OtaCommissionCaller,
  parseOtaId,
} from '../../../domain/model/ota-commission/ota-commission-query';
import { OtaCommissionResult } from '../../../domain/model/ota-commission/ota-commission-reference';
import { GetLatestOtaCommissionUseCase } from '../../../domain/ports/in/ota-commission/get-latest-ota-commission.use-case';
import { OtaCommissionQueryPort } from '../../../domain/ports/out/ota-commission/ota-commission-query.port';

// Implementa GetLatestOtaCommissionUseCase (HU1, HU3). Sin decoradores de NestJS: se
// construye en ota-commission.module.ts. Sin caché: cada consulta lee lo que hay en
// settlement, así una liquidación antigua nunca "expira" (casos límite, T025).
export class GetLatestOtaCommissionService implements GetLatestOtaCommissionUseCase {
  constructor(private readonly query: OtaCommissionQueryPort) {}

  async execute(rawOtaId: unknown, caller: OtaCommissionCaller): Promise<OtaCommissionResult> {
    // 1. Formato y canal directo, sin consultar settlement (FR-006).
    const otaId = parseOtaId(rawOtaId);

    // 2. Alcance de la OTA antes de leer: ni el contenido ni el tiempo de respuesta delatan
    //    si la otra OTA tiene historial (BR-003, FR-009, SC-006). Módulo 2 ve cualquier OTA.
    if (caller.kind === 'OTA' && caller.otaId !== otaId) {
      throw new OtaAccessDeniedError();
    }

    // 3. La liquidación Final más reciente; sin ninguna, NO_HISTORY explícito (FR-004).
    const reference = await this.query.findLatestByOtaId(otaId);
    return reference ? { kind: 'HISTORICAL', reference } : { kind: 'NO_HISTORY', otaId };
  }
}
