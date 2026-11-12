// Feature 003 · Consultar porcentaje de comisión OTA (T003, T004, T026)
// Reglas de dependencia del plan 003, verificadas leyendo los imports de src/ (igual que
// settlement-dependencies.spec.ts de 007, sin dependencias nuevas). El plan pide
// dependency-cruiser; el proyecto no lo tiene instalado, y esta prueba corre en `npm test`.
// La regla clave es asimétrica: ota-commission puede leer settlement, pero settlement nunca
// importa nada de ota-commission, así Generar liquidación no puede depender de esta consulta
// (BR-004, FR-003, HU2 escenario 2).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');

interface SourceFile {
  path: string; // relativo a la raíz, con "/"
  imports: string[]; // los de src/ relativos a la raíz y sin extensión; los demás tal cual
  text: string;
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listTs(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const IMPORT = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g;

const sources: SourceFile[] = listTs(SRC).map((file) => {
  const text = readFileSync(file, 'utf8');
  const imports = [...text.matchAll(IMPORT)]
    .map((match) => match[1])
    .map((specifier) =>
      specifier.startsWith('.')
        ? toPosix(relative(ROOT, resolve(dirname(file), specifier)))
        : specifier,
    );
  return { path: toPosix(relative(ROOT, file)), imports, text };
});

function code(file: SourceFile | undefined): string {
  return (file?.text ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const OTA_COMMISSION = /(\/ota-commission[/.]|ota-commission\.module)/;
const SETTLEMENT_FILES = /\/settlement[/.]/;

const DOMAIN_AND_APPLICATION = [
  'src/domain/model/ota-commission/ota-commission-reference.ts',
  'src/domain/model/ota-commission/ota-commission-query.ts',
  'src/domain/errors/ota-commission/commission-not-applicable.error.ts',
  'src/domain/errors/ota-commission/invalid-ota-commission-query.error.ts',
  'src/domain/errors/ota-commission/ota-access-denied.error.ts',
  'src/domain/ports/in/ota-commission/get-latest-ota-commission.use-case.ts',
  'src/domain/ports/out/ota-commission/ota-commission-query.port.ts',
  'src/application/services/ota-commission/get-latest-ota-commission.service.ts',
];
const ADAPTER =
  'src/infrastructure/adapters/out/persistence/repositories/ota-commission/prisma-ota-commission-query.adapter.ts';
const CONTROLLER = 'src/infrastructure/adapters/in/http/ota-commission/ota-commission.controller.ts';
const MODULE = 'src/infrastructure/config/ota-commission.module.ts';
const OWN_FILES = [...DOMAIN_AND_APPLICATION, ADAPTER, CONTROLLER, MODULE];

// Lo que permitiría a 003 generar o escribir liquidaciones (FR-005, BR-002).
const SETTLEMENT_WRITE_SIDE = [
  'src/domain/ports/in/settlement/generate-settlement.use-case',
  'src/application/services/settlement/generate-settlement.service',
  'src/domain/ports/out/settlement/settlement.repository.port',
  'src/infrastructure/adapters/out/persistence/repositories/settlement/prisma-settlement.repository',
];

describe('Reglas de dependencia de ota-commission (003)', () => {
  it('encuentra los archivos de la 003 y de settlement (la prueba no es vacía)', () => {
    for (const path of OWN_FILES) {
      expect(sources.some((file) => file.path === path)).toBe(true);
    }
    expect(sources.filter((file) => SETTLEMENT_FILES.test(file.path)).length).toBeGreaterThan(5);
  });

  it('ningún archivo de settlement importa nada de ota-commission (T003, BR-004, FR-003)', () => {
    const offending = sources
      .filter((file) => SETTLEMENT_FILES.test(file.path))
      .flatMap((file) =>
        file.imports
          .filter((module) => OTA_COMMISSION.test(module))
          .map((module) => `${file.path} → ${module}`),
      );

    expect(offending).toEqual([]);
  });

  it('solo el propio contexto y su controller conocen GetLatestOtaCommissionUseCase (T004)', () => {
    const port = 'src/domain/ports/in/ota-commission/get-latest-ota-commission.use-case';
    const importers = sources
      .filter((file) => file.imports.includes(port))
      .map((file) => file.path)
      .filter((path) => !OWN_FILES.includes(path));

    expect(importers).toEqual([]);
  });

  it('solo AppModule importa OtaCommissionModule: ningún módulo de settlement lo usa', () => {
    const importers = sources
      .filter((file) => file.imports.includes('src/infrastructure/config/ota-commission.module'))
      .map((file) => file.path);

    expect(importers).toEqual(['src/app.module.ts']);
  });

  it('003 no usa el lado de escritura de settlement (FR-005, BR-002)', () => {
    const offending = sources
      .filter((file) => OWN_FILES.includes(file.path))
      .flatMap((file) =>
        file.imports
          .filter((module) => SETTLEMENT_WRITE_SIDE.includes(module))
          .map((module) => `${file.path} → ${module}`),
      );

    expect(offending).toEqual([]);
  });

  it('dominio y aplicación de 003 no dependen de Prisma, NestJS ni adaptadores', () => {
    const offending = sources
      .filter((file) => DOMAIN_AND_APPLICATION.includes(file.path))
      .flatMap((file) =>
        file.imports
          .filter(
            (module) =>
              module.startsWith('@prisma/') ||
              module.startsWith('@nestjs/') ||
              module.startsWith('src/infrastructure/'),
          )
          .map((module) => `${file.path} → ${module}`),
      );

    expect(offending).toEqual([]);
  });

  it('el puerto de salida solo tiene la lectura findLatestByOtaId (T026, SC-004)', () => {
    const port = code(
      sources.find(
        (file) => file.path === 'src/domain/ports/out/ota-commission/ota-commission-query.port.ts',
      ),
    );
    const methods = [...port.matchAll(/^\s+(\w+)\s*\(/gm)].map((match) => match[1]);

    expect(methods).toEqual(['findLatestByOtaId']);
  });

  it('el adaptador solo lee: sin create, update, upsert, delete ni SQL de escritura, y en READ ONLY (T026)', () => {
    const text = code(sources.find((file) => file.path === ADAPTER));

    expect(text).not.toMatch(
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
    );
    expect(text).not.toMatch(/\$executeRaw|\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/);
    expect(text.match(/readOnlyTransaction\(/g)?.length).toBe(1);
  });

  it('el controller solo declara GET (FR-005)', () => {
    const text = code(sources.find((file) => file.path === CONTROLLER));

    expect(text).toMatch(/@Get\(/);
    expect(text).not.toMatch(/@(Post|Put|Patch|Delete|All)\(/);
  });
});
