// Crea los usuarios del login propio. No hay feature de gestión de usuarios (plan base).
// Las credenciales salen de variables de entorno: nunca se versionan.
import { AppUserRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 10;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name} (ver .env.example).`);
  }
  return value;
}

async function upsertUser(
  prisma: PrismaClient,
  username: string,
  password: string,
  role: AppUserRole,
  otaId: string | null,
): Promise<void> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await prisma.appUser.upsert({
    where: { username },
    update: { passwordHash, role, otaId, active: true },
    create: { username, passwordHash, role, otaId },
  });
  console.log(`Usuario listo: ${username} (${role})`);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await upsertUser(
      prisma,
      requiredEnv('SEED_ADMIN_USERNAME'),
      requiredEnv('SEED_ADMIN_PASSWORD'),
      AppUserRole.Administrador,
      null,
    );
    await upsertUser(
      prisma,
      requiredEnv('SEED_OTA_USERNAME'),
      requiredEnv('SEED_OTA_PASSWORD'),
      AppUserRole.OTA,
      requiredEnv('SEED_OTA_ID'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
