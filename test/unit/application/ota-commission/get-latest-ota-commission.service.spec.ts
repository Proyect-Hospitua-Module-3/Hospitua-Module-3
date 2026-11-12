// Feature 003 · Consultar porcentaje de comisión OTA (T006, T007, T008, T017, T018, T023, T024)
import { GetLatestOtaCommissionService } from '../../../../src/application/services/ota-commission/get-latest-ota-commission.service';
import { CommissionNotApplicableError } from '../../../../src/domain/errors/ota-commission/commission-not-applicable.error';
import { OtaAccessDeniedError } from '../../../../src/domain/errors/ota-commission/ota-access-denied.error';
import { INTERNAL_OTA_COMMISSION_CALLER } from '../../../../src/domain/model/ota-commission/ota-commission-query';
import {
  InMemoryOtaCommissionQuery,
  OTA_ID,
  OTHER_OTA_ID,
  reference,
  SETTLEMENT_DATE,
  SETTLEMENT_ID,
} from '../../../support/ota-commission/in-memory-ota-commission-query';

describe('GetLatestOtaCommissionService (003)', () => {
  let query: InMemoryOtaCommissionQuery;
  let service: GetLatestOtaCommissionService;

  beforeEach(() => {
    query = new InMemoryOtaCommissionQuery();
    service = new GetLatestOtaCommissionService(query);
  });

  describe('HU1 — Módulo 2 consulta el historial de una OTA', () => {
    it('con una liquidación devuelve porcentaje, liquidación y fecha (T006, escenario 1)', async () => {
      query.references.push(reference());

      const result = await service.execute(OTA_ID, INTERNAL_OTA_COMMISSION_CALLER);

      expect(result.kind).toBe('HISTORICAL');
      if (result.kind !== 'HISTORICAL') return;
      expect(result.reference.otaId).toBe(OTA_ID);
      expect(result.reference.percentage.toString()).toBe('15.00');
      expect(result.reference.settlementId).toBe(SETTLEMENT_ID);
      expect(result.reference.settlementDate).toEqual(SETTLEMENT_DATE);
      expect(query.calls).toEqual([OTA_ID]);
    });

    it('sin liquidaciones devuelve NO_HISTORY, sin porcentaje ni 0% (T007, escenario 2, FR-004)', async () => {
      const result = await service.execute(OTA_ID, INTERNAL_OTA_COMMISSION_CALLER);

      expect(result).toEqual({ kind: 'NO_HISTORY', otaId: OTA_ID });
      expect(result).not.toHaveProperty('reference');
    });

    it('el canal directo lanza CommissionNotApplicableError sin leer settlement (T008, FR-006)', async () => {
      await expect(service.execute('DIRECT', INTERNAL_OTA_COMMISSION_CALLER)).rejects.toThrow(
        CommissionNotApplicableError,
      );
      expect(query.calls).toEqual([]);
    });

    it('con varios porcentajes en el tiempo devuelve el de la más reciente, sin promediar (T024)', async () => {
      query.references.push(
        reference({ percentage: '12.00', settlementDate: new Date('2026-01-10T10:00:00Z') }),
        reference({ percentage: '18.00', settlementDate: new Date('2026-11-10T10:00:00Z') }),
        reference({ percentage: '15.00', settlementDate: new Date('2026-06-10T10:00:00Z') }),
      );

      const result = await service.execute(OTA_ID, INTERNAL_OTA_COMMISSION_CALLER);

      expect(result.kind === 'HISTORICAL' && result.reference.percentage.toString()).toBe('18.00');
    });

    it('dos consultas seguidas sin liquidaciones nuevas dan el mismo resultado (T023, NFR-001)', async () => {
      query.references.push(reference());

      const first = await service.execute(OTA_ID, INTERNAL_OTA_COMMISSION_CALLER);
      const second = await service.execute(OTA_ID, INTERNAL_OTA_COMMISSION_CALLER);

      expect(second).toEqual(first);
    });
  });

  describe('HU3 — la OTA consulta su propio historial', () => {
    it('una OTA consulta su propio otaId (escenario 1)', async () => {
      query.references.push(reference());

      const result = await service.execute(OTA_ID, { kind: 'OTA', otaId: OTA_ID });

      expect(result.kind).toBe('HISTORICAL');
    });

    it('una OTA que consulta otra OTA recibe OtaAccessDeniedError sin leer settlement (T017, escenario 2)', async () => {
      query.references.push(reference({ otaId: OTHER_OTA_ID }));

      await expect(service.execute(OTHER_OTA_ID, { kind: 'OTA', otaId: OTA_ID })).rejects.toThrow(
        OtaAccessDeniedError,
      );
      expect(query.calls).toEqual([]);
    });

    it('el rechazo es igual exista o no historial de la otra OTA (SC-006)', async () => {
      const withoutHistory = await service
        .execute(OTHER_OTA_ID, { kind: 'OTA', otaId: OTA_ID })
        .catch((error: Error) => error);
      query.references.push(reference({ otaId: OTHER_OTA_ID }));
      const withHistory = await service
        .execute(OTHER_OTA_ID, { kind: 'OTA', otaId: OTA_ID })
        .catch((error: Error) => error);

      expect(withHistory).toEqual(withoutHistory);
      expect((withHistory as OtaAccessDeniedError).errorCode).toBe('FORBIDDEN');
    });

    it('Módulo 2 (llamada interna) puede consultar cualquier OTA (T018)', async () => {
      query.references.push(reference({ otaId: OTHER_OTA_ID }));

      const result = await service.execute(OTHER_OTA_ID, INTERNAL_OTA_COMMISSION_CALLER);

      expect(result.kind).toBe('HISTORICAL');
    });
  });
});
