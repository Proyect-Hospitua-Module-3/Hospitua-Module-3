-- Feature 011 · Revisar temporada del año
-- Generado con `prisma migrate diff` (esquema anterior → schema.prisma); la sección
-- "SQL manual" del final está escrita a mano: Prisma no genera CHECK, índices parciales
-- ni restricciones de exclusión. Igual que en 009: generen las próximas migraciones con
-- `prisma migrate diff` y no con `prisma migrate dev`, que podría borrar lo de abajo.

-- CreateTable
CREATE TABLE "season_calendar_revision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "year" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "season_calendar_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_calendar_entry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revision_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "entry_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,

    CONSTRAINT "season_calendar_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_calendar_active_base" (
    "calendar_entry_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "period" daterange NOT NULL,

    CONSTRAINT "season_calendar_active_base_pkey" PRIMARY KEY ("calendar_entry_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "season_calendar_revision_year_revision_key" ON "season_calendar_revision"("year", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "season_calendar_revision_id_year_key" ON "season_calendar_revision"("id", "year");

-- CreateIndex
CREATE INDEX "season_calendar_entry_season_id_idx" ON "season_calendar_entry"("season_id");

-- CreateIndex
CREATE UNIQUE INDEX "season_calendar_entry_revision_id_entry_id_key" ON "season_calendar_entry"("revision_id", "entry_id");

-- CreateIndex
CREATE INDEX "season_calendar_active_base_year_idx" ON "season_calendar_active_base"("year");

-- AddForeignKey
ALTER TABLE "season_calendar_entry" ADD CONSTRAINT "season_calendar_entry_revision_id_year_fkey" FOREIGN KEY ("revision_id", "year") REFERENCES "season_calendar_revision"("id", "year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_calendar_entry" ADD CONSTRAINT "season_calendar_entry_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_calendar_active_base" ADD CONSTRAINT "season_calendar_active_base_calendar_entry_id_fkey" FOREIGN KEY ("calendar_entry_id") REFERENCES "season_calendar_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- SQL manual
-- ---------------------------------------------------------------------------

-- season_calendar_revision -----------------------------------------------------

ALTER TABLE "season_calendar_revision"
    ADD CONSTRAINT "season_calendar_revision_year_range" CHECK ("year" BETWEEN 1 AND 9999),
    ADD CONSTRAINT "season_calendar_revision_number_positive" CHECK ("revision" >= 1);

-- Una sola revisión activa por año.
CREATE UNIQUE INDEX "season_calendar_revision_single_active" ON "season_calendar_revision" ("year") WHERE "is_active";

-- season_calendar_entry --------------------------------------------------------

ALTER TABLE "season_calendar_entry"
    ADD CONSTRAINT "season_calendar_entry_kind" CHECK ("kind" IN ('BASE', 'EXCEPTION')),
    ADD CONSTRAINT "season_calendar_entry_valid_interval" CHECK ("start_date" <= "end_date"),
    -- La entrada empieza en el año de su revisión (BR-006).
    ADD CONSTRAINT "season_calendar_entry_start_in_year" CHECK (EXTRACT(YEAR FROM "start_date") = "year"),
    -- Un BASE llega como máximo al 31 de diciembre del año siguiente (BR-006).
    ADD CONSTRAINT "season_calendar_entry_base_until_next_year" CHECK ("kind" <> 'BASE' OR "end_date" < make_date("year" + 2, 1, 1)),
    -- Una excepción cubre un solo día.
    ADD CONSTRAINT "season_calendar_entry_exception_single_day" CHECK ("kind" <> 'EXCEPTION' OR "start_date" = "end_date");

-- Dos excepciones de una misma revisión no pueden caer en la misma fecha (BR-005).
CREATE UNIQUE INDEX "season_calendar_entry_single_exception" ON "season_calendar_entry" ("revision_id", "start_date") WHERE "kind" = 'EXCEPTION';

-- season_calendar_active_base ----------------------------------------------------

-- Última defensa de NFR-002: entre los BASE de las revisiones activas de todos los años
-- no hay dos que compartan un día. El período se guarda como daterange '[)'. No hace
-- falta btree_gist: solo se comparan rangos.
ALTER TABLE "season_calendar_active_base"
    ADD CONSTRAINT "season_calendar_active_base_no_overlap" EXCLUDE USING gist ("period" WITH &&);
