-- Feature 010 · Registrar Check-out
-- Generado con `prisma migrate diff` (esquema anterior → schema.prisma); la sección
-- "SQL manual" del final está escrita a mano: Prisma no genera índices parciales ni CHECK.
-- Igual que en 009 y 011: generen las próximas migraciones con `prisma migrate diff`.

-- CreateTable
CREATE TABLE "checkout_event_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID,
    "event_type" TEXT,
    "occurred_at" TIMESTAMPTZ(6),
    "payload" JSONB,
    "stay_id" UUID,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "reason" TEXT,
    "result_note" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "checkout_event_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checkout_event_log_stay_id_idx" ON "checkout_event_log"("stay_id");


-- ---------------------------------------------------------------------------
-- SQL manual
-- ---------------------------------------------------------------------------

-- Deduplicación por eventId: un mismo evento se registra una sola vez. Los sobres no
-- reconocibles no tienen event_id y pueden repetirse.
CREATE UNIQUE INDEX "checkout_event_log_event_id_key" ON "checkout_event_log" ("event_id") WHERE "event_id" IS NOT NULL;

ALTER TABLE "checkout_event_log"
    ADD CONSTRAINT "checkout_event_log_status" CHECK ("status" IN ('PENDING', 'PROCESSED', 'REJECTED', 'DEAD_LETTER')),
    -- Solo un sobre no reconocible (REJECTED) se registra sin event_id ni payload.
    ADD CONSTRAINT "checkout_event_log_event_id_required" CHECK ("event_id" IS NOT NULL OR ("status" = 'REJECTED' AND "payload" IS NULL)),
    -- processed_at se fija al cerrar el procesamiento y es nulo mientras está PENDING.
    ADD CONSTRAINT "checkout_event_log_processed_at" CHECK (("status" = 'PENDING') = ("processed_at" IS NULL)),
    -- La nota solo acompaña un resultado PROCESSED (p. ej., factura no emitida).
    ADD CONSTRAINT "checkout_event_log_result_note" CHECK ("result_note" IS NULL OR "status" = 'PROCESSED'),
    -- Un rechazo o una revisión manual siempre registran su código.
    ADD CONSTRAINT "checkout_event_log_error_code" CHECK ("status" NOT IN ('REJECTED', 'DEAD_LETTER') OR "error_code" IS NOT NULL);
