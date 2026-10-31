-- Feature 009 · Modificar precio tarifa según temporada
-- Generado con `prisma migrate diff` (esquema anterior → schema.prisma); la sección
-- "SQL manual" del final la escribimos a mano: Prisma no genera índices parciales,
-- restricciones de exclusión ni CHECK.
--
-- Importante para el equipo: generen las próximas migraciones con
--   npx prisma migrate diff --from-schema-datamodel <schema anterior> --to-schema-datamodel prisma/schema.prisma --script
-- y no con `prisma migrate dev`, que podría proponer borrar los índices manuales de abajo.

-- CreateTable
CREATE TABLE "season" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "color" CHAR(7) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(6),
    "archived_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_rule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "season_id" UUID NOT NULL,
    "adjustment_percent" DECIMAL(5,2) NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,

    CONSTRAINT "season_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_rule_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "season_id" UUID NOT NULL,
    "change_type" TEXT NOT NULL,
    "previous_rule_id" UUID,
    "new_rule_id" UUID,
    "previous_adjustment" DECIMAL(5,2),
    "new_adjustment" DECIMAL(5,2),
    "previous_name" TEXT,
    "new_name" TEXT,
    "previous_color" CHAR(7),
    "new_color" CHAR(7),
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "season_rule_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "season_rule_season_id_idx" ON "season_rule"("season_id");

-- CreateIndex
CREATE INDEX "season_rule_history_season_id_idx" ON "season_rule_history"("season_id");

-- AddForeignKey
ALTER TABLE "season_rule" ADD CONSTRAINT "season_rule_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_rule_history" ADD CONSTRAINT "season_rule_history_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_rule_history" ADD CONSTRAINT "season_rule_history_previous_rule_id_fkey" FOREIGN KEY ("previous_rule_id") REFERENCES "season_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_rule_history" ADD CONSTRAINT "season_rule_history_new_rule_id_fkey" FOREIGN KEY ("new_rule_id") REFERENCES "season_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- SQL manual
-- ---------------------------------------------------------------------------

-- Necesaria para combinar "=" sobre UUID con "&&" sobre rangos en la exclusión de abajo.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- season ----------------------------------------------------------------------

ALTER TABLE "season"
    ADD CONSTRAINT "season_color_format" CHECK ("color" ~ '^#[0-9A-F]{6}$'),
    ADD CONSTRAINT "season_name_not_blank" CHECK (btrim("name") <> ''),
    ADD CONSTRAINT "season_version_positive" CHECK ("version" >= 1),
    -- La temporada por defecto se llama Regular y nunca se retira (FR-001).
    ADD CONSTRAINT "season_default_is_regular" CHECK (NOT "is_default" OR "name" = 'Regular'),
    ADD CONSTRAINT "season_default_never_archived" CHECK (NOT "is_default" OR "archived_at" IS NULL),
    ADD CONSTRAINT "season_archive_complete" CHECK (("archived_at" IS NULL) = ("archived_by" IS NULL));

-- Una sola temporada por defecto.
CREATE UNIQUE INDEX "season_single_default" ON "season" ("is_default") WHERE "is_default";

-- Nombre único sin distinguir mayúsculas ni espacios exteriores, solo entre temporadas
-- no retiradas: una temporada retirada libera su nombre.
CREATE UNIQUE INDEX "season_active_name_key" ON "season" (lower(btrim("name"))) WHERE "archived_at" IS NULL;

-- season_rule -----------------------------------------------------------------

ALTER TABLE "season_rule"
    -- Porcentaje firmado entre -100 y 100 (FR-002).
    ADD CONSTRAINT "season_rule_adjustment_range" CHECK ("adjustment_percent" BETWEEN -100 AND 100),
    ADD CONSTRAINT "season_rule_valid_interval" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
    -- Última defensa de FR-003: dos versiones de una misma temporada nunca se solapan
    -- en el tiempo. El rango es [valid_from, valid_to); valid_to nulo = sin fin.
    ADD CONSTRAINT "season_rule_no_overlap" EXCLUDE USING gist (
        "season_id" WITH =,
        tstzrange("valid_from", "valid_to", '[)') WITH &&
    );

-- Una sola versión vigente (valid_to nulo) por temporada.
CREATE UNIQUE INDEX "season_rule_single_current" ON "season_rule" ("season_id") WHERE "valid_to" IS NULL;

-- season_rule_history ---------------------------------------------------------

ALTER TABLE "season_rule_history"
    ADD CONSTRAINT "season_rule_history_change_type" CHECK ("change_type" IN ('CREATE', 'UPDATE', 'RETIRE'));

-- Temporada por defecto ------------------------------------------------------------
-- `Regular` existe desde el principio con ajuste 0.00 y un id fijo que conocen 005 y 011.
-- El responsable es el usuario "sistema" (UUID nulo): la crea la migración, no un Administrador.

WITH "t" AS (SELECT clock_timestamp() AS "ts")
INSERT INTO "season" ("id", "name", "color", "is_default", "version", "created_at", "created_by", "updated_at", "updated_by")
SELECT '00000000-0000-4000-8000-000000000001', 'Regular', '#808080', true, 1,
       "t"."ts", '00000000-0000-0000-0000-000000000000',
       "t"."ts", '00000000-0000-0000-0000-000000000000'
FROM "t";

INSERT INTO "season_rule" ("season_id", "adjustment_percent", "valid_from", "created_at", "created_by")
SELECT "id", 0.00, "created_at", "created_at", "created_by" FROM "season" WHERE "is_default";

INSERT INTO "season_rule_history" ("season_id", "change_type", "new_rule_id", "new_adjustment", "new_name", "new_color", "changed_by", "changed_at")
SELECT s."id", 'CREATE', r."id", r."adjustment_percent", s."name", s."color", s."created_by", s."created_at"
FROM "season" s JOIN "season_rule" r ON r."season_id" = s."id"
WHERE s."is_default";
