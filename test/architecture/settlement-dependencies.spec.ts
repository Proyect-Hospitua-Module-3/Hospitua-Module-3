// Feature 007 · Generar liquidación (T028, T030, T031)
// Reglas de dependencia del plan 007 y de la regla 5 del plan base, verificadas leyendo los
// imports de src/. El plan pide dependency-cruiser "cuando sea posible"; mientras el
// proyecto no lo tenga instalado, esta prueba cumple su función sin dependencias nuevas.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');

interface SourceFile {
  path: string; // relativo a la raíz, con "/"
  imports: string[]; // módulos de src/ importados, relativos a la raíz y sin extensión
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
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => toPosix(relative(ROOT, resolve(dirname(file), specifier))));
  return { path: toPosix(relative(ROOT, file)), imports, text };
});

function importersOf(module: string): string[] {
  return sources.filter((file) => file.imports.includes(module)).map((file) => file.path);
}

const GENERATE_SETTLEMENT_PORT = 'src/domain/ports/in/settlement/generate-settlement.use-case';

// Quién puede conocer GenerateSettlementUseCase: el propio settlement (puerto, servicio,
// wiring y log) y, cuando existan, checkout-ingestion (010) y billing (006).
const ALLOWED_GENERATE_SETTLEMENT_IMPORTERS = [
  /^src\/domain\/ports\/in\/settlement\//,
  /^src\/application\/services\/settlement\//,
  /^src\/infrastructure\/logging\/settlement\//,
  /^src\/infrastructure\/config\/settlement\.module\.ts$/,
  /^src\/application\/services\/(checkout-ingestion|billing)\//,
  /^src\/infrastructure\/adapters\/in\/messaging\//,
  /^src\/infrastructure\/config\/(checkout-ingestion|billing)\.module\.ts$/,
];

const SETTLEMENT_FILES = /\/settlement[/.]/;

describe('Reglas de dependencia de settlement (007)', () => {
  it('encuentra los archivos de la 007 (la prueba no es vacía)', () => {
    expect(importersOf(GENERATE_SETTLEMENT_PORT).length).toBeGreaterThan(0);
    expect(sources.filter((file) => SETTLEMENT_FILES.test(file.path)).length).toBeGreaterThan(5);
  });

  it('solo 010, 006 y el propio settlement importan GenerateSettlementUseCase (FR-001, T028)', () => {
    const forbidden = importersOf(GENERATE_SETTLEMENT_PORT).filter(
      (path) => !ALLOWED_GENERATE_SETTLEMENT_IMPORTERS.some((rule) => rule.test(path)),
    );

    expect(forbidden).toEqual([]);
  });

  it('ningún controller HTTP genera liquidaciones (FR-001, HU3)', () => {
    const controllers = sources.filter((file) =>
      file.path.startsWith('src/infrastructure/adapters/in/http/'),
    );

    expect(
      controllers
        .filter(
          (file) =>
            file.imports.includes(GENERATE_SETTLEMENT_PORT) ||
            file.imports.some((module) =>
              module.startsWith('src/application/services/settlement/'),
            ),
        )
        .map((file) => file.path),
    ).toEqual([]);
  });

  it('settlement nunca invoca el cálculo de pricing: solo lee cotizaciones (regla 5 del plan base, FR-002)', () => {
    const offending = sources
      .filter((file) => SETTLEMENT_FILES.test(file.path))
      .flatMap((file) =>
        file.imports
          .filter(
            (module) =>
              module.startsWith('src/application/services/pricing/') ||
              module.startsWith('src/domain/ports/in/pricing/'),
          )
          .map((module) => `${file.path} → ${module}`),
      );

    expect(offending).toEqual([]);
  });

  it('settlement no emite la factura: nunca importa billing (FR-019, BR-009)', () => {
    const offending = sources
      .filter((file) => SETTLEMENT_FILES.test(file.path))
      .flatMap((file) =>
        file.imports
          .filter((module) => /\/billing[/.]/.test(module))
          .map((module) => `${file.path} → ${module}`),
      );

    expect(offending).toEqual([]);
  });

  it('el repositorio de liquidaciones no tiene ningún UPDATE ni DELETE (FR-009, FR-017, T031)', () => {
    const repository = sources.find((file) =>
      file.path.endsWith('repositories/settlement/prisma-settlement.repository.ts'),
    );

    expect(repository).toBeDefined();
    // Sin comentarios: el propio archivo explica que no hace UPDATE ni DELETE.
    const code = (repository?.text ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toContain('settlement.create(');
    expect(code).not.toMatch(/\.(update|updateMany|upsert|delete|deleteMany)\s*\(/);
    expect(code).not.toMatch(/\b(UPDATE|DELETE)\b/);
  });
});
