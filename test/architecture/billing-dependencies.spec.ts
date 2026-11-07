// Feature 006 · Generar factura final (T033)
// Reglas de dependencia del plan 006, verificadas leyendo los imports de src/ (igual que
// settlement-dependencies.spec.ts de 007, sin dependencias nuevas).
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

const GENERATE_FINAL_INVOICE_PORT = 'src/domain/ports/in/billing/generate-final-invoice.use-case';

// Quién puede conocer GenerateFinalInvoiceUseCase: el propio 006 (puerto, servicio, wiring y
// log) y, cuando exista, checkout-ingestion (010).
const ALLOWED_GENERATE_FINAL_INVOICE_IMPORTERS = [
  /^src\/domain\/ports\/in\/billing\/generate-final-invoice\.use-case\.ts$/,
  /^src\/application\/services\/billing\/generate-final-invoice\.service\.ts$/,
  /^src\/infrastructure\/logging\/billing\//,
  /^src\/infrastructure\/config\/billing\.module\.ts$/,
  /^src\/application\/services\/checkout-ingestion\//,
  /^src\/infrastructure\/adapters\/in\/messaging\//,
  /^src\/infrastructure\/config\/checkout-ingestion\.module\.ts$/,
];

const INVOICE_FILES = [
  'src/domain/model/billing/billing-customer.ts',
  'src/domain/model/billing/invoice.ts',
  'src/domain/model/billing/invoice-breakdown.ts',
  'src/application/services/billing/generate-final-invoice.service.ts',
];

function code(file: SourceFile | undefined): string {
  return (file?.text ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Reglas de dependencia de la factura final (006)', () => {
  it('encuentra los archivos de la 006 (la prueba no es vacía)', () => {
    for (const path of INVOICE_FILES) {
      expect(sources.some((file) => file.path === path)).toBe(true);
    }
  });

  it('solo 010 y el propio 006 importan GenerateFinalInvoiceUseCase (FR-001, BR-001)', () => {
    const forbidden = sources
      .filter((file) => file.imports.includes(GENERATE_FINAL_INVOICE_PORT))
      .map((file) => file.path)
      .filter((path) => !ALLOWED_GENERATE_FINAL_INVOICE_IMPORTERS.some((rule) => rule.test(path)));

    expect(forbidden).toEqual([]);
  });

  it('ningún controller HTTP emite facturas (FR-001)', () => {
    const offending = sources
      .filter((file) => file.path.startsWith('src/infrastructure/adapters/in/http/'))
      .filter(
        (file) =>
          file.imports.includes(GENERATE_FINAL_INVOICE_PORT) ||
          file.imports.includes('src/application/services/billing/generate-final-invoice.service'),
      )
      .map((file) => file.path);

    expect(offending).toEqual([]);
  });

  it('dominio y aplicación de 006 no dependen de Prisma, NestJS ni adaptadores', () => {
    const offending = sources
      .filter((file) => INVOICE_FILES.includes(file.path))
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

  it('006 solo lee el IVA: nunca usa UpdateVatRateUseCase ni el repositorio de IVA', () => {
    const service = sources.find((file) => file.path === INVOICE_FILES[3]);

    expect(service?.imports).not.toContain('src/domain/ports/in/billing/update-vat-rate.use-case');
    expect(service?.imports).not.toContain('src/domain/ports/out/billing/vat-rate.repository.port');
  });

  it('el repositorio de facturas no hace UPDATE ni DELETE de invoice (FR-006); solo actualiza el consecutivo', () => {
    const repository = sources.find((file) =>
      file.path.endsWith('repositories/billing/prisma-invoice-issuance.repository.ts'),
    );

    expect(repository).toBeDefined();
    const text = code(repository);
    expect(text).toContain('invoice.create(');
    expect(text).not.toMatch(/\.invoice\.(update|updateMany|upsert|delete|deleteMany)\s*\(/);
    expect(text).not.toMatch(/\bDELETE\b/);
    const updates = text.match(/\bUPDATE\s+\w+/g) ?? [];
    expect(updates).toEqual(['UPDATE invoice_number_counter']);
  });

  it('el consecutivo no usa secuencias de PostgreSQL (nextval deja huecos tras un rollback)', () => {
    const repository = sources.find((file) =>
      file.path.endsWith('repositories/billing/prisma-invoice-issuance.repository.ts'),
    );

    expect(code(repository)).not.toMatch(/nextval|SEQUENCE/i);
    expect(code(repository)).toMatch(/FOR UPDATE/);
  });
});
