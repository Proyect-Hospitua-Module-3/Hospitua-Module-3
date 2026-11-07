// Feature 010 · Registrar Check-out (plan 010 "Structure Decision", FR-001, FR-007)
// Reglas de dependencia verificadas leyendo los imports de src/ (igual que las de 006 y 007).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');

interface SourceFile {
  path: string;
  imports: string[];
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
  return { path: toPosix(relative(ROOT, file)), imports };
});

const CHECKOUT_FILES = /checkout-ingestion|messaging\/|rabbitmq/;
const checkoutFiles = sources.filter((file) => CHECKOUT_FILES.test(file.path));
const CONSUMER = 'src/infrastructure/adapters/in/messaging/checkout-registered.consumer.ts';
const PROCESSOR = 'src/application/services/checkout-ingestion/checkout-event-processor.service.ts';
const SETTLEMENT_PORT = 'src/domain/ports/in/settlement/generate-settlement.use-case';
const INVOICE_PORT = 'src/domain/ports/in/billing/generate-final-invoice.use-case';

describe('Reglas de dependencia de checkout-ingestion (010)', () => {
  it('encuentra los archivos de la 010 (la prueba no es vacía)', () => {
    expect(checkoutFiles.length).toBeGreaterThan(10);
    expect(checkoutFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining([CONSUMER, PROCESSOR]),
    );
  });

  it('el consumer no tiene lógica de negocio: solo conoce el puerto de entrada y la topología', () => {
    const consumer = sources.find((file) => file.path === CONSUMER);
    const internal = (consumer?.imports ?? []).filter((module) => module.startsWith('src/'));

    expect(internal.sort()).toEqual([
      'src/domain/ports/in/checkout-ingestion/register-checkout.use-case',
      'src/infrastructure/config/rabbitmq.config',
    ]);
  });

  it('solo el procesador (y el wiring) llaman a 007 y 006, en la capa de aplicación', () => {
    const callers = checkoutFiles
      .filter(
        (file) => file.imports.includes(SETTLEMENT_PORT) || file.imports.includes(INVOICE_PORT),
      )
      .map((file) => file.path)
      .sort();

    expect(callers).toEqual([PROCESSOR, 'src/infrastructure/config/checkout-ingestion.module.ts']);
  });

  it('010 no consulta Módulo 1 ni el cálculo de tarifas: no toca ocupación ni disponibilidad (FR-007)', () => {
    const offending = checkoutFiles.flatMap((file) =>
      file.imports
        .filter(
          (module) =>
            /\/pricing\//.test(module) ||
            /module1/i.test(module) ||
            /\/adapters\/out\/http\//.test(module),
        )
        .map((module) => `${file.path} → ${module}`),
    );

    expect(offending).toEqual([]);
  });

  it('dominio y aplicación de 010 no dependen de NestJS, amqplib, Prisma ni de infraestructura', () => {
    const offending = checkoutFiles
      .filter((file) => /^src\/(domain|application)\//.test(file.path))
      .flatMap((file) =>
        file.imports
          .filter(
            (module) =>
              module.startsWith('@nestjs/') ||
              module === 'amqplib' ||
              module.startsWith('@prisma/') ||
              module.startsWith('src/infrastructure/'),
          )
          .map((module) => `${file.path} → ${module}`),
      );

    expect(offending).toEqual([]);
  });

  it('no hay controller HTTP de check-out: la única entrada es la cola (FR-001)', () => {
    const controllers = sources.filter(
      (file) =>
        file.path.startsWith('src/infrastructure/adapters/in/http/') &&
        file.imports.some((module) => /checkout-ingestion/.test(module)),
    );

    expect(controllers).toEqual([]);
  });
});
