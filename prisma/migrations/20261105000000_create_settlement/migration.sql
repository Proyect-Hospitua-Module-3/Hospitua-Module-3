-- Feature 007 · Generar liquidación
-- Generado con `prisma migrate diff` (esquema anterior → schema.prisma); la sección
-- "SQL manual" del final está escrita a mano: Prisma no genera CHECK. Igual que en 005,
-- 009 y 011: generen las próximas migraciones con `prisma migrate diff` y no con
-- `prisma migrate dev`, que podría borrar lo de abajo.

-- CreateTable
CREATE TABLE "settlement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stay_id" UUID NOT NULL,
    "reservation_ref" TEXT NOT NULL,
    "room_id" UUID NOT NULL,
    "category_room" TEXT NOT NULL,
    "check_in_date" DATE NOT NULL,
    "check_out_date" DATE NOT NULL,
    "quote_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "ota_id" TEXT,
    "ota_confirmation_code" TEXT,
    "ota_commission_percentage" DECIMAL(5,2),
    "currency" CHAR(3) NOT NULL,
    "lodging_amount" DECIMAL(14,2) NOT NULL,
    "base_lodging_amount" DECIMAL(14,2) NOT NULL,
    "dynamic_adjustment_amount" DECIMAL(14,2) NOT NULL,
    "ota_commission_amount" DECIMAL(14,2) NOT NULL,
    "net_income" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL,
    "source_event_id" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settlement_stay_id_key" ON "settlement"("stay_id");

-- CreateIndex
CREATE INDEX "settlement_reservation_ref_room_id_idx" ON "settlement"("reservation_ref", "room_id");

-- CreateIndex
CREATE INDEX "settlement_ota_id_generated_at_idx" ON "settlement"("ota_id", "generated_at" DESC);


-- ---------------------------------------------------------------------------
-- SQL manual
-- ---------------------------------------------------------------------------

ALTER TABLE "settlement"
    -- Solo existe la liquidación Final (FR-009).
    ADD CONSTRAINT "settlement_status_final" CHECK ("status" = 'FINAL'),
    ADD CONSTRAINT "settlement_currency_cop" CHECK ("currency" = 'COP'),
    -- Fechas reales: la salida el mismo día de la entrada es válida.
    ADD CONSTRAINT "settlement_valid_stay" CHECK ("check_in_date" <= "check_out_date"),
    -- Los datos de la OTA van juntos y solo con canal OTA; en canal directo no hay
    -- comisión (FR-007).
    ADD CONSTRAINT "settlement_channel_data" CHECK (
        ("channel" = 'OTA'
            AND "ota_id" IS NOT NULL
            AND "ota_confirmation_code" IS NOT NULL
            AND "ota_commission_percentage" IS NOT NULL)
        OR ("channel" = 'DIRECT'
            AND "ota_id" IS NULL
            AND "ota_confirmation_code" IS NULL
            AND "ota_commission_percentage" IS NULL
            AND "ota_commission_amount" = 0)
    ),
    ADD CONSTRAINT "settlement_commission_percentage_range" CHECK ("ota_commission_percentage" BETWEEN 0 AND 100),
    -- Puede ser cero: un ajuste de temporada de -100.00 deja el hospedaje en cero (005).
    ADD CONSTRAINT "settlement_lodging_amount_not_negative" CHECK ("lodging_amount" >= 0),
    -- Las tarifas base de Módulo 1 siempre son mayores que cero (004).
    ADD CONSTRAINT "settlement_base_lodging_amount_positive" CHECK ("base_lodging_amount" > 0),
    ADD CONSTRAINT "settlement_commission_amount_not_negative" CHECK ("ota_commission_amount" >= 0),
    -- El desglose cuadra siempre (FR-008, FR-012).
    ADD CONSTRAINT "settlement_dynamic_adjustment_breakdown" CHECK ("dynamic_adjustment_amount" = "lodging_amount" - "base_lodging_amount"),
    ADD CONSTRAINT "settlement_net_income_breakdown" CHECK ("net_income" = "lodging_amount" - "ota_commission_amount");
