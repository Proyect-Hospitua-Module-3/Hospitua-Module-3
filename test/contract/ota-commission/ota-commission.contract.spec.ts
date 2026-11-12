// Feature 003 · Consultar porcentaje de comisión OTA (T010, T019, T028)
// Contrato GET-ota-commission-otaid.md (proveedor 003, consumidores Módulo 2 y las OTA): forma
// exacta del 200 con y sin historial, cada error del contrato y la autorización por actor.
// La lectura de settlement se reemplaza por un doble; el adaptador real se prueba en
// test/integration/persistence/ota-commission.
process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.JWT_EXPIRES_IN_SECONDS = '3600';
process.env.MODULE1_BASE_URL = 'http://localhost:3001';
process.env.MODULE1_TIMEOUT_MS = '500';
process.env.MODULE2_BASE_URL = 'http://localhost:3002';
process.env.MODULE2_TIMEOUT_MS = '500';

import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { OTA_COMMISSION_QUERY } from '../../../src/domain/ports/out/ota-commission/ota-commission-query.port';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import {
  InMemoryOtaCommissionQuery,
  OTA_ID,
  OTHER_OTA_ID,
  reference,
} from '../../support/ota-commission/in-memory-ota-commission-query';

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OTA_SUB = '0b8a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d';

describe('Contrato GET /ota-commission/{otaId} (003 → Módulo 2 y OTA)', () => {
  let app: INestApplication;
  let query: InMemoryOtaCommissionQuery;
  let jwt: JwtService;
  let bookingToken: string;
  let adminToken: string;

  beforeEach(async () => {
    query = new InMemoryOtaCommissionQuery();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(OTA_COMMISSION_QUERY)
      .useValue(query)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    jwt = app.get(JwtService);
    bookingToken = jwt.sign({ sub: OTA_SUB, role: 'OTA', otaId: OTA_ID });
    adminToken = jwt.sign({ sub: 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde', role: 'Administrador' });
  });

  afterEach(async () => {
    await app?.close();
  });

  const get = (otaId: string, token?: string) => {
    const call = request(app.getHttpServer()).get(`/ota-commission/${otaId}`);
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  };

  function expectApiError(response: request.Response, status: number, errorCode: string): void {
    expect(response.status).toBe(status);
    expect(response.body).toEqual({
      errorCode,
      message: expect.any(String),
      timestamp: expect.stringMatching(ISO_INSTANT),
      path: expect.stringContaining('/ota-commission/'),
    });
    // Ningún error lleva un porcentaje (SC-006).
    expect(response.body.message).not.toMatch(/\d+\.\d{2}/);
  }

  describe('200 (contrato, sección 5)', () => {
    it('con historial devuelve exactamente el ejemplo 1 del contrato (Módulo 2, sin token)', async () => {
      query.references.push(reference());

      const response = await get(OTA_ID);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        otaId: 'booking',
        historical: true,
        percentage: '15.00',
        settlementId: '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01',
        settlementDate: '2026-10-08T16:02:00.000Z',
      });
      expect(typeof response.body.percentage).toBe('string');
    });

    it('sin historial devuelve solo { otaId, historical: false }: ni porcentaje ni 0 (ejemplo 2, FR-004)', async () => {
      const response = await get('expedia');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ otaId: 'expedia', historical: false });
    });

    it('no hay 404: una OTA desconocida es «sin historial»', async () => {
      const response = await get('ota-que-no-existe');

      expect(response.status).toBe(200);
      expect(response.body.historical).toBe(false);
    });

    it('solo los campos del contrato, sin datos del huésped ni de la reserva (T028, NFR-003)', async () => {
      query.references.push(reference());

      const response = await get(OTA_ID);

      expect(Object.keys(response.body).sort()).toEqual([
        'historical',
        'otaId',
        'percentage',
        'settlementDate',
        'settlementId',
      ]);
    });

    it('la OTA consulta su propio otaId con su token (HU3 escenario 1)', async () => {
      query.references.push(reference());

      const response = await get(OTA_ID, bookingToken);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ otaId: OTA_ID, historical: true, percentage: '15.00' });
    });
  });

  describe('Errores (contrato, sección 6)', () => {
    it.each(['DIRECT', 'direct'])(
      '400 INVALID_QUERY_PARAMS para el canal directo (%p) sin leer settlement (FR-006)',
      async (otaId) => {
        const response = await get(otaId);

        expectApiError(response, 400, 'INVALID_QUERY_PARAMS');
        expect(query.calls).toEqual([]);
      },
    );

    it('400 INVALID_QUERY_PARAMS para un otaId solo con espacios', async () => {
      expectApiError(await get('%20%20'), 400, 'INVALID_QUERY_PARAMS');
    });

    it('401 UNAUTHENTICATED con un token inválido', async () => {
      expectApiError(await get(OTA_ID, 'no-es-un-jwt'), 401, 'UNAUTHENTICATED');
    });

    it('401 UNAUTHENTICATED con un token expirado', async () => {
      // Venció hace un minuto.
      const expired = jwt.sign({ sub: OTA_SUB, role: 'OTA', otaId: OTA_ID }, { expiresIn: -60 });

      expectApiError(await get(OTA_ID, expired), 401, 'UNAUTHENTICATED');
    });

    it('401 UNAUTHENTICATED con un token OTA sin otaId', async () => {
      const withoutOtaId = jwt.sign({ sub: OTA_SUB, role: 'OTA' });

      expectApiError(await get(OTA_ID, withoutOtaId), 401, 'UNAUTHENTICATED');
    });

    it('403 FORBIDDEN con token de Administrador', async () => {
      expectApiError(await get(OTA_ID, adminToken), 403, 'FORBIDDEN');
      expect(query.calls).toEqual([]);
    });

    it('403 FORBIDDEN cuando una OTA consulta otra OTA, con el mismo cuerpo exista o no historial (HU3 escenario 2, SC-006)', async () => {
      const withoutHistory = await get(OTHER_OTA_ID, bookingToken);
      query.references.push(reference({ otaId: OTHER_OTA_ID, percentage: '18.00' }));
      const withHistory = await get(OTHER_OTA_ID, bookingToken);

      expectApiError(withoutHistory, 403, 'FORBIDDEN');
      expectApiError(withHistory, 403, 'FORBIDDEN');
      expect({ ...withHistory.body, timestamp: undefined }).toEqual({
        ...withoutHistory.body,
        timestamp: undefined,
      });
      expect(query.calls).toEqual([]);
    });
  });

  describe('Solo lectura (FR-005, SC-004)', () => {
    it.each(['post', 'put', 'patch', 'delete'] as const)(
      '%s /ota-commission/{otaId} no existe → 404',
      async (method) => {
        const response = await request(app.getHttpServer())
          [method](`/ota-commission/${OTA_ID}`)
          .send({ percentage: '10.00' });

        expect(response.status).toBe(404);
        expect(response.body.errorCode).toBe('NOT_FOUND');
      },
    );
  });
});
