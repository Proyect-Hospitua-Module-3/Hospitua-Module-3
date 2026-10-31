// Feature 009 · Modificar precio tarifa según temporada
// T015, T029, T030: /admin/season-rules de punta a punta (HTTP → guards → caso de uso → puerto).
// La persistencia se reemplaza por dobles en memoria para que corra sin PostgreSQL;
// el repositorio real se prueba en test/integration.
process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.JWT_EXPIRES_IN_SECONDS = '3600';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { SEASON_CALENDAR_REFERENCE } from '../../../src/domain/ports/out/pricing/season-calendar-reference.port';
import { SEASON_RULE_REPOSITORY } from '../../../src/domain/ports/out/pricing/season-rule.repository.port';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import {
  InMemorySeasonRuleRepository,
  REGULAR_ID,
} from '../../support/pricing/in-memory-season-rule.repository';

const ADMIN = { id: 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde', username: 'admin', password: 'clave-admin' };
const OTA = { id: '0b8a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', username: 'ota-demo', password: 'clave-ota' };
const UNKNOWN_ID = '5dca644e-7a6a-4d2e-a9a5-1943188c4710';

describe('/admin/season-rules (e2e)', () => {
  let app: INestApplication;
  let repository: InMemorySeasonRuleRepository;
  let seasonsInCalendar: Set<string>;
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
    repository = new InMemorySeasonRuleRepository();
    seasonsInCalendar = new Set();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .overrideProvider(SEASON_RULE_REPOSITORY)
      .useValue(repository)
      .overrideProvider(SEASON_CALENDAR_REFERENCE)
      .useValue({ isReferencedByActiveRevision: async (id: string) => seasonsInCalendar.has(id) })
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

  function call(method: 'get' | 'post' | 'put' | 'delete', path: string, token: string | null = adminToken) {
    const req = request(app.getHttpServer())[method](path);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  }

  function createSeason(body: object) {
    return call('post', '/admin/season-rules').send(body);
  }

  describe('autorización (SC-005)', () => {
    it.each([
      ['GET', 'get', '/admin/season-rules'],
      ['POST', 'post', '/admin/season-rules'],
      ['PUT', 'put', `/admin/season-rules/${REGULAR_ID}`],
      ['DELETE', 'delete', `/admin/season-rules/${REGULAR_ID}`],
    ] as const)('%s sin token responde 401 UNAUTHENTICATED', async (_m, method, path) => {
      const response = await call(method, path, null).send({}).expect(401);
      expect(response.body.errorCode).toBe('UNAUTHENTICATED');
    });

    it('con rol OTA responde 403 FORBIDDEN', async () => {
      const response = await call('put', `/admin/season-rules/${REGULAR_ID}`, otaToken)
        .send({ adjustmentPercent: '50' })
        .expect(403);
      expect(response.body.errorCode).toBe('FORBIDDEN');
    });
  });

  describe('GET: catálogo', () => {
    it('incluye Regular como temporada por defecto', async () => {
      const response = await call('get', '/admin/season-rules').expect(200);

      expect(response.body.asOf).toEqual(expect.any(String));
      expect(response.body.seasons).toContainEqual({
        seasonId: REGULAR_ID,
        name: 'Regular',
        color: '#808080',
        adjustmentPercent: '0.00',
        isDefault: true,
        version: 1,
        validFrom: expect.any(String),
        updatedBy: expect.any(String),
        updatedAt: expect.any(String),
      });
    });
  });

  describe('POST: crear temporada', () => {
    it('201 con la temporada, su ajuste y versión 1', async () => {
      const response = await createSeason({ name: 'Festival', color: '#c0392b', adjustmentPercent: '25' }).expect(201);

      expect(response.body).toMatchObject({
        name: 'Festival',
        color: '#C0392B',
        adjustmentPercent: '25.00',
        isDefault: false,
        version: 1,
        updatedBy: ADMIN.id,
      });
    });

    it('409 SEASON_NAME_CONFLICT si el nombre ya existe, sin distinguir mayúsculas', async () => {
      const response = await createSeason({ name: 'festival', color: '#000000', adjustmentPercent: '5' }).expect(409);
      expect(response.body.errorCode).toBe('SEASON_NAME_CONFLICT');
    });

    it.each([
      ['un ajuste fuera de rango', { name: 'Alta', color: '#E67E22', adjustmentPercent: '100.01' }, 'INVALID_SEASON_ADJUSTMENT'],
      ['un ajuste como número', { name: 'Alta', color: '#E67E22', adjustmentPercent: 20 }, 'INVALID_SEASON_ADJUSTMENT'],
      ['un color inválido', { name: 'Alta', color: 'naranja', adjustmentPercent: '20' }, 'INVALID_SEASON'],
      ['un nombre vacío', { name: '  ', color: '#E67E22', adjustmentPercent: '20' }, 'INVALID_SEASON'],
      ['un campo que genera el servidor', { name: 'Alta', color: '#E67E22', adjustmentPercent: '20', isDefault: true }, 'INVALID_SEASON'],
      ['campos faltantes', { name: 'Alta' }, 'INVALID_SEASON'],
    ])('400 con %s', async (_case, body, errorCode) => {
      const response = await createSeason(body).expect(400);

      expect(response.body).toEqual({
        errorCode,
        message: expect.any(String),
        timestamp: expect.any(String),
        path: '/admin/season-rules',
      });
    });
  });

  describe('PUT: modificar temporada', () => {
    let festivalId: string;

    beforeAll(async () => {
      const list = await call('get', '/admin/season-rules').expect(200);
      festivalId = list.body.seasons.find((s: { name: string }) => s.name === 'Festival').seasonId;
    });

    it('cambia el ajuste y sube la versión', async () => {
      const response = await call('put', `/admin/season-rules/${festivalId}`)
        .send({ adjustmentPercent: '-10', expectedVersion: 1 })
        .expect(200);

      expect(response.body).toMatchObject({ adjustmentPercent: '-10.00', version: 2 });
    });

    it('con valores idénticos responde 200 sin subir la versión (no-op)', async () => {
      const response = await call('put', `/admin/season-rules/${festivalId}`)
        .send({ adjustmentPercent: '-10.00' })
        .expect(200);

      expect(response.body.version).toBe(2);
    });

    it('409 SEASON_RULE_CONFLICT con una expectedVersion desactualizada', async () => {
      const response = await call('put', `/admin/season-rules/${festivalId}`)
        .send({ adjustmentPercent: '5', expectedVersion: 1 })
        .expect(409);
      expect(response.body.errorCode).toBe('SEASON_RULE_CONFLICT');
    });

    it('permite cambiar el ajuste de Regular', async () => {
      const response = await call('put', `/admin/season-rules/${REGULAR_ID}`)
        .send({ adjustmentPercent: '-2.50' })
        .expect(200);
      expect(response.body.adjustmentPercent).toBe('-2.50');
    });

    it('409 DEFAULT_SEASON_IMMUTABLE al renombrar Regular', async () => {
      const response = await call('put', `/admin/season-rules/${REGULAR_ID}`)
        .send({ name: 'Normal' })
        .expect(409);
      expect(response.body.errorCode).toBe('DEFAULT_SEASON_IMMUTABLE');
    });

    it('400 INVALID_SEASON con un cuerpo sin campos para cambiar', async () => {
      const response = await call('put', `/admin/season-rules/${festivalId}`).send({}).expect(400);
      expect(response.body.errorCode).toBe('INVALID_SEASON');
    });

    it.each([
      ['inexistente', UNKNOWN_ID],
      ['con formato inválido', 'no-es-un-uuid'],
    ])('404 SEASON_NOT_FOUND con un id %s', async (_case, id) => {
      const response = await call('put', `/admin/season-rules/${id}`).send({ adjustmentPercent: '5' }).expect(404);
      expect(response.body.errorCode).toBe('SEASON_NOT_FOUND');
    });
  });

  describe('DELETE: retirar temporada', () => {
    it('409 DEFAULT_SEASON_IMMUTABLE al retirar Regular', async () => {
      const response = await call('delete', `/admin/season-rules/${REGULAR_ID}`).expect(409);
      expect(response.body.errorCode).toBe('DEFAULT_SEASON_IMMUTABLE');
    });

    it('409 SEASON_IN_USE si el calendario vigente la usa', async () => {
      const created = await createSeason({ name: 'Alta', color: '#E67E22', adjustmentPercent: '20' }).expect(201);
      seasonsInCalendar.add(created.body.seasonId);

      const response = await call('delete', `/admin/season-rules/${created.body.seasonId}`).expect(409);
      expect(response.body.errorCode).toBe('SEASON_IN_USE');
    });

    it('204, deja de aparecer en el catálogo, no se puede modificar y libera su nombre', async () => {
      const created = await createSeason({ name: 'Puente', color: '#16A085', adjustmentPercent: '10' }).expect(201);
      const id = created.body.seasonId;

      await call('delete', `/admin/season-rules/${id}`).expect(204);

      const list = await call('get', '/admin/season-rules').expect(200);
      expect(list.body.seasons.map((s: { seasonId: string }) => s.seasonId)).not.toContain(id);
      await call('put', `/admin/season-rules/${id}`).send({ adjustmentPercent: '5' }).expect(404);
      await call('delete', `/admin/season-rules/${id}`).expect(404);
      await createSeason({ name: 'Puente', color: '#16A085', adjustmentPercent: '12' }).expect(201);
    });
  });
});
