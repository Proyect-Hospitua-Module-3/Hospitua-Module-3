// Feature 001 · Actualizar porcentaje de IVA
// T006: PUT /admin/vat-rate de punta a punta (HTTP → guards → caso de uso → puerto).
// La persistencia se reemplaza por dobles en memoria para que corra sin PostgreSQL;
// el repositorio real se prueba en test/integration.
process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.JWT_EXPIRES_IN_SECONDS = '3600';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import {
  GET_CURRENT_VAT_RATE_USE_CASE,
  GetCurrentVatRateUseCase,
} from '../../../src/domain/ports/in/billing/get-current-vat-rate.use-case';
import { VAT_RATE_REPOSITORY } from '../../../src/domain/ports/out/billing/vat-rate.repository.port';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { InMemoryVatRateRepository } from '../../support/billing/in-memory-vat-rate.repository';

const ADMIN = { id: 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde', username: 'admin', password: 'clave-admin' };
const OTA = { id: '0b8a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', username: 'ota-demo', password: 'clave-ota' };

describe('PUT /admin/vat-rate (e2e)', () => {
  let app: INestApplication;
  let repository: InMemoryVatRateRepository;
  let adminToken: string;
  let otaToken: string;

  beforeAll(async () => {
    const users = {
      [ADMIN.username]: {
        id: ADMIN.id,
        username: ADMIN.username,
        passwordHash: await bcrypt.hash(ADMIN.password, 4),
        role: 'Administrador',
        otaId: null,
        active: true,
      },
      [OTA.username]: {
        id: OTA.id,
        username: OTA.username,
        passwordHash: await bcrypt.hash(OTA.password, 4),
        role: 'OTA',
        otaId: 'booking',
        active: true,
      },
    };
    const fakePrisma = {
      appUser: {
        findUnique: async ({ where }: { where: { username: string } }) =>
          users[where.username] ?? null,
      },
    };
    repository = new InMemoryVatRateRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .overrideProvider(VAT_RATE_REPOSITORY)
      .useValue(repository)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    adminToken = await login(ADMIN.username, ADMIN.password);
    otaToken = await login(OTA.username, OTA.password);
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(username: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password })
      .expect(200);
    return response.body.accessToken;
  }

  function putVatRate(token: string | null, body: unknown) {
    const req = request(app.getHttpServer()).put('/admin/vat-rate');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body as object);
  }

  describe('login', () => {
    it('devuelve un token con su expiración', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: ADMIN.username, password: ADMIN.password })
        .expect(200);

      expect(response.body).toEqual({ accessToken: expect.any(String), expiresIn: 3600 });
    });

    it('rechaza credenciales incorrectas con 401 UNAUTHENTICATED', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: ADMIN.username, password: 'otra' })
        .expect(401);

      expect(response.body.errorCode).toBe('UNAUTHENTICATED');
    });
  });

  describe('autorización (SC-005)', () => {
    it('sin token responde 401 UNAUTHENTICATED y no toca el porcentaje', async () => {
      const response = await putVatRate(null, { value: '19.00' }).expect(401);

      expect(response.body.errorCode).toBe('UNAUTHENTICATED');
      expect(repository.history).toHaveLength(0);
    });

    it('con un token inválido responde 401 UNAUTHENTICATED', async () => {
      const response = await putVatRate('no-es-un-jwt', { value: '19.00' }).expect(401);

      expect(response.body.errorCode).toBe('UNAUTHENTICATED');
    });

    it('con rol OTA responde 403 FORBIDDEN y no toca el porcentaje', async () => {
      const response = await putVatRate(otaToken, { value: '19.00' }).expect(403);

      expect(response.body.errorCode).toBe('FORBIDDEN');
      expect(repository.history).toHaveLength(0);
    });
  });

  describe('actualización', () => {
    it('registra el primer porcentaje: 200 con valor, responsable y hora', async () => {
      const response = await putVatRate(adminToken, { value: '19.00' }).expect(200);

      expect(response.body).toEqual({
        value: '19.00',
        updatedBy: ADMIN.id,
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      });
      expect(repository.history[0]).toEqual({
        valueBefore: null,
        valueAfter: '19.00',
        changedBy: ADMIN.id,
      });
    });

    it('el nuevo valor queda disponible de inmediato para 006 (NFR-003)', async () => {
      await putVatRate(adminToken, { value: '5' }).expect(200);

      const port = app.get<GetCurrentVatRateUseCase>(GET_CURRENT_VAT_RATE_USE_CASE);
      expect((await port.getCurrent()).value.toString()).toBe('5.00');
    });

    it('acepta un valor idéntico al vigente y deja su entrada de historial', async () => {
      const before = repository.history.length;

      await putVatRate(adminToken, { value: '5.00' }).expect(200);

      expect(repository.history).toHaveLength(before + 1);
    });
  });

  describe('validación (SC-003)', () => {
    it.each([
      ['mayor a 100', { value: '120.00' }],
      ['negativo', { value: '-1' }],
      ['con más de 2 decimales', { value: '19.555' }],
      ['no numérico', { value: 'diecinueve' }],
      ['como número JSON', { value: 19 }],
      ['ausente', {}],
    ])('rechaza un valor %s con 400 INVALID_VAT_RATE sin cambiar el vigente', async (_c, body) => {
      const currentBefore = repository.current?.value.toString();
      const historyBefore = repository.history.length;

      const response = await putVatRate(adminToken, body).expect(400);

      expect(response.body).toEqual({
        errorCode: 'INVALID_VAT_RATE',
        message: expect.any(String),
        timestamp: expect.any(String),
        path: '/admin/vat-rate',
      });
      expect(repository.current?.value.toString()).toBe(currentBefore);
      expect(repository.history).toHaveLength(historyBefore);
    });

    it('rechaza un JSON mal formado con 400', async () => {
      const response = await request(app.getHttpServer())
        .put('/admin/vat-rate')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Content-Type', 'application/json')
        .send('{"value": ')
        .expect(400);

      expect(response.body.errorCode).toBe('INVALID_REQUEST');
    });
  });

  describe('errores inesperados', () => {
    afterEach(() => {
      repository.failWith = null;
    });

    it('responden 422 UNEXPECTED_ERROR con el id de correlación, nunca 5xx', async () => {
      repository.failWith = new Error('se cayó la base de datos');

      const response = await putVatRate(adminToken, { value: '19.00' })
        .set('X-Correlation-Id', 'prueba-123')
        .expect(422);

      expect(response.body.errorCode).toBe('UNEXPECTED_ERROR');
      expect(response.body.message).toContain('prueba-123');
      expect(response.headers['x-correlation-id']).toBe('prueba-123');
    });
  });
});
