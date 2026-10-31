-- Generado con `prisma migrate diff` a partir de schema.prisma; las restricciones CHECK
-- del final son SQL manual (Prisma no las genera ni las compara).

-- CreateEnum
CREATE TYPE "AppUserRole" AS ENUM ('Administrador', 'OTA');

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AppUserRole" NOT NULL,
    "ota_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_rate" (
    "id" INTEGER NOT NULL,
    "value" DECIMAL(5,2) NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vat_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_rate_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "value_before" DECIMAL(5,2),
    "value_after" DECIMAL(5,2) NOT NULL,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vat_rate_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_username_key" ON "app_user"("username");

-- ---------------------------------------------------------------------------
-- SQL manual
-- ---------------------------------------------------------------------------

-- Una OTA siempre trae su otaId (BR-002 de consultar_liquidacion.md).
ALTER TABLE "app_user"
    ADD CONSTRAINT "app_user_ota_id_required" CHECK ("role" <> 'OTA' OR "ota_id" IS NOT NULL);

-- vat_rate es de fila única y su valor está entre 0 y 100 (FR-002, NFR-004).
-- La tabla nace vacía: no hay porcentaje por defecto (FR-003).
ALTER TABLE "vat_rate"
    ADD CONSTRAINT "vat_rate_single_row" CHECK ("id" = 1),
    ADD CONSTRAINT "vat_rate_value_range" CHECK ("value" >= 0 AND "value" <= 100);

ALTER TABLE "vat_rate_history"
    ADD CONSTRAINT "vat_rate_history_value_after_range" CHECK ("value_after" >= 0 AND "value_after" <= 100),
    ADD CONSTRAINT "vat_rate_history_value_before_range"
        CHECK ("value_before" IS NULL OR ("value_before" >= 0 AND "value_before" <= 100));
