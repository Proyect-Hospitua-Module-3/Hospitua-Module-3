// Feature 008 · Gestionar facturación
// Reglas de dependencia del plan 008, verificadas leyendo los imports de src/ (igual que
// billing-dependencies.spec.ts de 006, sin dependencias nuevas): 008 solo lee facturas.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');

interface SourceFile {
  path: string; // relativo a la raíz, con "/"
  imports: string[]; // módulos importados: los de src/ relativos a la raíz y sin extensión
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

// Archivos propios de 008, por capa.
const DOMAIN_AND_APPLICATION = [
  'src/domain/model/billing/customer-match-mode.ts',
  'src/domain/model/billing/invoice-read-models.ts',
  'src/domain/model/billing/invoice-search-criteria.ts',
  'src/domain/model/billing/issued-date-range.ts',
  'src/domain/ports/in/billing/manage-invoices.use-case.ts',
  'src/domain/ports/out/billing/invoice-query.port.ts',
  'src/application/services/billing/manage-invoices.service.ts',
];
const READ_SIDE = [
  ...DOMAIN_AND_APPLICATION,
  'src/infrastructure/adapters/in/http/billing/invoices-admin.controller.ts',
  'src/infrastructure/adapters/out/persistence/repositories/billing/prisma-invoice-query.adapter.ts',
  'src/infrastructure/logging/billing/logged-manage-invoices.use-case.ts',
];
const ADAPTER = READ_SIDE[READ_SIDE.length - 2];

// Lo que permitiría a 008 emitir o modificar facturas (FR-006, BR-001).
const WRITE_SIDE = [
  'src/domain/ports/out/billing/invoice-issuance.repository.port',
  'src/domain/ports/in/billing/generate-final-invoice.use-case',
  'src/application/services/billing/generate-final-invoice.service',
  'src/infrastructure/adapters/out/persistence/repositories/billing/prisma-invoice-issuance.repository',
  'src/domain/ports/out/settlement/settlement.repository.port',
];

function code(file: SourceFile | undefined): string {
  return (file?.text ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Reglas de dependencia de Gestionar facturación (008)', () => {
  it('encuentra los archivos de la 008 (la prueba no es vacía)', () => {
    for (const path of READ_SIDE) {
      expect(sources.some((file) => file.path === path)).toBe(true);
    }
  });

  it('ningún archivo de 008 usa el lado de escritura de 006 o 007 (FR-006, BR-001)', () => {
    const offending = sources
      .filter((file) => READ_SIDE.includes(file.path))
      .flatMap((file) =>
        file.imports
          .filter((module) => WRITE_SIDE.includes(module))
          .map((module) => `${file.path} → ${module}`),
      );

    expect(offending).toEqual([]);
  });

  it('dominio y aplicación de 008 no dependen de Prisma, NestJS ni adaptadores', () => {
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

  it('el adaptador solo lee: ni create, update, upsert ni delete, y todo en READ ONLY (NFR-004)', () => {
    const adapter = sources.find((file) => file.path === ADAPTER);
    const text = code(adapter);

    expect(text).not.toMatch(
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
    );
    expect(text).not.toMatch(/\$executeRaw|\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/);
    expect(text.match(/readOnlyTransaction\(/g)?.length).toBe(5);
  });

  it('el controller solo declara GET (FR-006)', () => {
    const controller = sources.find((file) => file.path === READ_SIDE[7]);
    const text = code(controller);

    expect(text).toMatch(/@Get\(/);
    expect(text).not.toMatch(/@(Post|Put|Patch|Delete|All)\(/);
  });
});
