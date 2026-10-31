// Feature 011 · Revisar temporada del año
// /admin/season-calendar de punta a punta (HTTP → guards → caso de uso → puertos), más
// la consulta real de 009 al calendario antes de retirar una temporada (SEASON_IN_USE).
// La persistencia se reemplaza por dobles en memoria que comparten el mismo reloj, para
// que corra sin PostgreSQL; el repositorio real se prueba en test/integration.
process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.JWT_EXPIRES_IN_SECONDS = '3600';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { SEASON_CALENDAR_REPOSITORY } from '../../../src/domain/ports/out/pricing/season-calendar.repository.port';
import { SEASON_RULE_REPOSITORY } from '../../../src/domain/ports/out/pricing/season-rule.repository.port';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { InMemorySeasonCalendarRepository } from '../../support/pricing/in-memory-season-calendar.repository';
import {
  InMemorySeasonRuleRepository,
  REGULAR_ID,
} from '../../support/pricing/in-memory-season-rule.repository';

const ADMIN = {
  id: 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde',
  username: 'admin',
  password: 'clave-admin',
};
const OTA = {
  id: '0b8a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d',
  username: 'ota-demo',
  password: 'clave-ota',
};
const UNKNOWN_ID = '6e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('/admin/season-calendar (e2e)', () => {
  let app: INestApplication;
  let seasons: InMemorySeasonRuleRepository;
  let calendars: InMemorySeasonCalendarRepository;
  let adminToken: string;
  let otaToken: string;
  let altaId: string;
  let eventoId: string;
  let retiradaId: string;

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
    seasons = new InMemorySeasonRuleRepository();
    // Mismo reloj que el catálogo, y las temporadas activas salen del catálogo de 009.
    calendars = new InMemorySeasonCalendarRepository(
      () => seasons.tick(),
      (ids) =>
        new Set(
          ids.filter((id) => {
            const season = seasons.seasons.get(id);
            return season !== undefined && season.archivedAt === null;
          }),
        ),
    );

    // SEASON_CALENDAR_REFERENCE es un alias (useExisting) del repositorio de calendario,
    // así que 009 consulta este mismo doble al retirar una temporada.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .overrideProvider(SEASON_RULE_REPOSITORY)
      .useValue(seasons)
      .overrideProvider(SEASON_CALENDAR_REPOSITORY)
      .useValue(calendars)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    adminToken = await login(ADMIN.username, ADMIN.password);
    otaToken = await login(OTA.username, OTA.password);

    altaId = await createSeason('Temporada alta', '#C0392B', '25');
    eventoId = await createSeason('Evento especial', '#8E44AD', '50');
    retiradaId = await createSeason('Retirada', '#7F8C8D', '10');
    await call('delete', `/admin/season-rules/${retiradaId}`).expect(204);
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

  function call(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    token: string | null = adminToken,
  ) {
    const req = request(app.getHttpServer())[method](path);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  }

  async function createSeason(
    name: string,
    color: string,
    adjustmentPercent: string,
  ): Promise<string> {
    const response = await call('post', '/admin/season-rules')
      .send({ name, color, adjustmentPercent })
      .expect(201);
    return response.body.seasonId;
  }

  function review(query: string) {
    return call('get', `/admin/season-calendar?${query}`);
  }

  function publish(year: string | number, body: object) {
    return call('put', `/admin/season-calendar/${year}`).send(body);
  }

  function base(seasonId: string, startDate: string, endDate: string, entryId?: string) {
    return { ...(entryId ? { entryId } : {}), seasonId, kind: 'BASE', startDate, endDate };
  }

  function exception(seasonId: string, date: string) {
    return { seasonId, kind: 'EXCEPTION', startDate: date, endDate: date };
  }

  describe('autorización (FR-005)', () => {
    it.each([
      ['GET', 'get', '/admin/season-calendar?year=2026'],
      ['PUT', 'put', '/admin/season-calendar/2026'],
    ] as const)('%s sin token responde 401 UNAUTHENTICATED', async (_m, method, path) => {
      const response = await call(method, path, null).send({ entries: [] }).expect(401);
      expect(response.body.errorCode).toBe('UNAUTHENTICATED');
    });

    it.each([
      ['GET', 'get', '/admin/season-calendar?year=2026'],
      ['PUT', 'put', '/admin/season-calendar/2026'],
    ] as const)('%s con rol OTA responde 403 FORBIDDEN', async (_m, method, path) => {
      const response = await call(method, path, otaToken).send({ entries: [] }).expect(403);
      expect(response.body.errorCode).toBe('FORBIDDEN');
    });

    it('un PUT rechazado por rol no publica nada', () => {
      expect(calendars.stored).toHaveLength(0);
    });
  });

  describe('GET sin revisión publicada', () => {
    it('200 con revision 0, sin entradas y todo el año en default', async () => {
      const response = await review('year=2026').expect(200);

      expect(response.body).toEqual({
        year: 2026,
        asOf: expect.any(String),
        revision: 0,
        effectiveAt: null,
        changedBy: null,
        changedAt: null,
        defaultSeason: {
          seasonId: REGULAR_ID,
          name: 'Regular',
          color: '#808080',
          adjustmentPercent: '0.00',
        },
        entries: [],
        carriedInEntries: [],
        unclassifiedRanges: [{ from: '2026-01-01', to: '2026-12-31', resolvedAs: 'DEFAULT' }],
        conflicts: [],
      });
    });
  });

  describe('PUT: publicar el año', () => {
    let firstRevision: { effectiveAt: string; entries: { entryId: string; kind: string }[] };

    it('200 con la revisión 1, el responsable y los datos de cada temporada', async () => {
      const response = await publish(2026, {
        expectedRevision: null,
        entries: [
          base(altaId, '2026-06-01', '2026-08-31'),
          exception(eventoId, '2026-07-04'),
          base(altaId, '2026-12-20', '2027-01-10'),
        ],
      }).expect(200);

      expect(response.body).toMatchObject({
        year: 2026,
        revision: 1,
        changedBy: ADMIN.id,
        carriedInEntries: [],
        conflicts: [],
        unclassifiedRanges: [
          { from: '2026-01-01', to: '2026-05-31', resolvedAs: 'DEFAULT' },
          { from: '2026-09-01', to: '2026-12-19', resolvedAs: 'DEFAULT' },
        ],
      });
      expect(response.body.effectiveAt).toBe(response.body.changedAt);
      expect(response.body.asOf).toBe(response.body.effectiveAt);
      expect(response.body.entries).toHaveLength(3);
      expect(response.body.entries).toEqual(
        expect.arrayContaining([
          {
            entryId: expect.stringMatching(UUID),
            kind: 'EXCEPTION',
            startDate: '2026-07-04',
            endDate: '2026-07-04',
            season: {
              seasonId: eventoId,
              name: 'Evento especial',
              color: '#8E44AD',
              adjustmentPercent: '50.00',
            },
          },
          {
            entryId: expect.stringMatching(UUID),
            kind: 'BASE',
            startDate: '2026-12-20',
            endDate: '2027-01-10',
            season: {
              seasonId: altaId,
              name: 'Temporada alta',
              color: '#C0392B',
              adjustmentPercent: '25.00',
            },
          },
        ]),
      );
      firstRevision = response.body;
    });

    it('GET devuelve la misma revisión activa', async () => {
      const response = await review('year=2026').expect(200);

      expect(response.body.revision).toBe(1);
      expect(response.body.entries).toEqual(firstRevision.entries);
    });

    it('2027 ve el período que viene de 2026 como heredado, no como propio', async () => {
      const response = await review('year=2027').expect(200);

      expect(response.body.revision).toBe(0);
      expect(response.body.entries).toEqual([]);
      expect(response.body.carriedInEntries).toEqual([
        expect.objectContaining({
          ownerYear: 2026,
          ownerRevision: 1,
          kind: 'BASE',
          startDate: '2026-12-20',
          endDate: '2027-01-10',
        }),
      ]);
      expect(response.body.unclassifiedRanges).toEqual([
        { from: '2027-01-11', to: '2027-12-31', resolvedAs: 'DEFAULT' },
      ]);
    });

    it('con ventana, los rangos sin clasificar se recortan a la ventana', async () => {
      const inside = await review('year=2026&from=2026-07-01&to=2026-07-15').expect(200);
      expect(inside.body.unclassifiedRanges).toEqual([]);

      const edge = await review('year=2026&from=2026-05-25&to=2026-06-05').expect(200);
      expect(edge.body.unclassifiedRanges).toEqual([
        { from: '2026-05-25', to: '2026-05-31', resolvedAs: 'DEFAULT' },
      ]);
    });

    it('asOf anterior a la publicación muestra el año sin revisión', async () => {
      const before = new Date(new Date(firstRevision.effectiveAt).getTime() - 1).toISOString();
      const response = await review(`year=2026&asOf=${before}`).expect(200);

      expect(response.body.revision).toBe(0);
      expect(response.body.asOf).toBe(before);
    });

    it('409 SEASON_CALENDAR_CONFLICT si expectedRevision ya no es la activa', async () => {
      const response = await publish(2026, { expectedRevision: null, entries: [] }).expect(409);

      expect(response.body.errorCode).toBe('SEASON_CALENDAR_CONFLICT');
      expect(calendars.active(2026)?.revision).toBe(1);
    });

    it('una nueva revisión reemplaza la lista completa y conserva el entryId enviado', async () => {
      const kept = firstRevision.entries.find((e) => e.kind === 'EXCEPTION')!;
      const response = await publish(2026, {
        expectedRevision: 1,
        entries: [{ ...exception(eventoId, '2026-07-04'), entryId: kept.entryId }],
      }).expect(200);

      expect(response.body.revision).toBe(2);
      expect(response.body.entries).toEqual([expect.objectContaining({ entryId: kept.entryId })]);
    });

    it('la revisión 1 sigue disponible para auditoría', async () => {
      const response = await review('year=2026&revision=1').expect(200);

      expect(response.body.revision).toBe(1);
      expect(response.body.entries).toEqual(firstRevision.entries);
      expect(response.body.asOf).toBe(firstRevision.effectiveAt);
    });

    it('404 SEASON_CALENDAR_NOT_FOUND si la revisión pedida no existe', async () => {
      const response = await review('year=2026&revision=99').expect(404);
      expect(response.body.errorCode).toBe('SEASON_CALENDAR_NOT_FOUND');
    });
  });

  describe('PUT: reglas que rechazan todo el conjunto', () => {
    beforeAll(async () => {
      // 2026 vuelve a tener un período que cruza a 2027.
      await publish(2026, {
        expectedRevision: 2,
        entries: [base(altaId, '2026-12-20', '2027-01-10')],
      }).expect(200);
    });

    function expectNothingPublished(year: number, revision: number | undefined) {
      expect(calendars.active(year)?.revision).toBe(revision);
    }

    it('409 OVERLAPPING_SEASON_CALENDAR si dos períodos base comparten días', async () => {
      const response = await publish(2026, {
        expectedRevision: 3,
        entries: [
          base(altaId, '2026-06-01', '2026-08-31'),
          base(eventoId, '2026-08-15', '2026-09-15'),
        ],
      }).expect(409);

      expect(response.body.errorCode).toBe('OVERLAPPING_SEASON_CALENDAR');
      expectNothingPublished(2026, 3);
    });

    it('409 OVERLAPPING_SEASON_CALENDAR si el solape es con el período heredado del año anterior', async () => {
      const response = await publish(2027, {
        entries: [base(eventoId, '2027-01-05', '2027-01-20')],
      }).expect(409);

      expect(response.body.errorCode).toBe('OVERLAPPING_SEASON_CALENDAR');
      expectNothingPublished(2027, undefined);
    });

    it('409 DUPLICATE_SEASON_EXCEPTION si hay dos excepciones el mismo día', async () => {
      const response = await publish(2026, {
        expectedRevision: 3,
        entries: [exception(eventoId, '2026-07-04'), exception(altaId, '2026-07-04')],
      }).expect(409);

      expect(response.body.errorCode).toBe('DUPLICATE_SEASON_EXCEPTION');
      expectNothingPublished(2026, 3);
    });

    it.each([
      ['no existe en el catálogo', () => UNKNOWN_ID],
      ['fue retirada', () => retiradaId],
    ])('422 UNKNOWN_SEASON_REFERENCE si la temporada %s', async (_case, seasonId) => {
      const response = await publish(2026, {
        expectedRevision: 3,
        entries: [base(seasonId(), '2026-03-01', '2026-03-31')],
      }).expect(422);

      expect(response.body.errorCode).toBe('UNKNOWN_SEASON_REFERENCE');
      expectNothingPublished(2026, 3);
    });

    it.each([
      ['un año inválido en la ruta', 'abc', { entries: [] }],
      ['sin entries', '2026', { expectedRevision: 3 }],
      [
        'campos de 009 en una entrada',
        '2026',
        { entries: [{ ...exception(eventoId, '2026-07-04'), name: 'X' }] },
      ],
      [
        'un kind desconocido',
        '2026',
        { entries: [{ ...exception(eventoId, '2026-07-04'), kind: 'OTRO' }] },
      ],
      ['una fecha que no existe', '2026', { entries: [base(altaId, '2026-02-30', '2026-03-10')] }],
      ['un inicio fuera del año', '2026', { entries: [base(altaId, '2025-12-30', '2026-01-10')] }],
      [
        'un período base que pasa del año siguiente',
        '2026',
        { entries: [base(altaId, '2026-12-01', '2028-01-01')] },
      ],
      [
        'una excepción de varios días',
        '2026',
        { entries: [{ ...exception(eventoId, '2026-07-04'), endDate: '2026-07-05' }] },
      ],
      ['inicio posterior al fin', '2026', { entries: [base(altaId, '2026-08-31', '2026-06-01')] }],
    ])('400 INVALID_CALENDAR_RANGE con %s', async (_case, year, body) => {
      const response = await publish(year, body).expect(400);

      expect(response.body.errorCode).toBe('INVALID_CALENDAR_RANGE');
      expectNothingPublished(2026, 3);
    });
  });

  describe('GET: validación de la consulta', () => {
    it.each([
      ['sin year', ''],
      ['year inválido', 'year=20x6'],
      ['from sin to', 'year=2026&from=2026-06-01'],
      ['ventana fuera del año', 'year=2026&from=2026-12-01&to=2027-01-31'],
      ['from posterior a to', 'year=2026&from=2026-08-01&to=2026-06-01'],
      ['asOf sin zona horaria', 'year=2026&asOf=2026-10-09T22:00:00'],
      ['asOf y revision a la vez', 'year=2026&asOf=2026-10-09T22:00:00Z&revision=1'],
      ['un parámetro desconocido', 'year=2026&seasonId=x'],
    ])('400 INVALID_CALENDAR_RANGE con %s', async (_case, query) => {
      const response = await review(query).expect(400);
      expect(response.body.errorCode).toBe('INVALID_CALENDAR_RANGE');
    });

    it('422 UNEXPECTED_ERROR si falla la lectura del calendario', async () => {
      calendars.failWith = new Error('conexión perdida');
      try {
        const response = await review('year=2026').expect(422);
        expect(response.body.errorCode).toBe('UNEXPECTED_ERROR');
      } finally {
        calendars.failWith = null;
      }
    });
  });

  describe('009: retirar una temporada usada por el calendario', () => {
    it('409 SEASON_IN_USE si la revisión activa la referencia', async () => {
      const response = await call('delete', `/admin/season-rules/${altaId}`).expect(409);
      expect(response.body.errorCode).toBe('SEASON_IN_USE');
    });

    it('204 cuando ninguna revisión activa la referencia', async () => {
      // La revisión 2 usaba Evento especial, pero ya no es la activa.
      await call('delete', `/admin/season-rules/${eventoId}`).expect(204);
    });
  });
});
