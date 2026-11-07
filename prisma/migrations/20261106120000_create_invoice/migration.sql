-- Feature 006 · Generar factura final
-- Generado con `prisma migrate diff` (esquema anterior → schema.prisma); la sección
-- "SQL manual" del final está escrita a mano: Prisma no genera CHECK ni datos iniciales.
-- Igual que en las migraciones anteriores: generen las próximas con `prisma migrate diff`
-- y no con `prisma migrate dev`, que podría borrar lo de abajo.

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "invoice_number" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "settlement_id" UUID NOT NULL,
    "stay_id" UUID NOT NULL,
    "source_event_id" UUID NOT NULL,
    "reservation_ref" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "ota_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "customer_tax_id" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "lodging_amount" DECIMAL(14,2) NOT NULL,
    "ota_commission_amount" DECIMAL(14,2) NOT NULL,
    "net_income" DECIMAL(14,2) NOT NULL,
    "vat_rate_applied" DECIMAL(5,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_number_counter" (
    "id" INTEGER NOT NULL,
    "last_number" BIGINT NOT NULL,

    CONSTRAINT "invoice_number_counter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_invoice_number_key" ON "invoice"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_settlement_id_key" ON "invoice"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_stay_id_key" ON "invoice"("stay_id");

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- ---------------------------------------------------------------------------
-- SQL manual
-- ---------------------------------------------------------------------------

-- Consecutivo oficial: una sola fila, creada aquí y nunca reiniciada. La primera factura
-- recibe el número 1 (FR-005, FR-011).
ALTER TABLE "invoice_number_counter"
    ADD CONSTRAINT "invoice_number_counter_single_row" CHECK ("id" = 1),
    ADD CONSTRAINT "invoice_number_counter_not_negative" CHECK ("last_number" >= 0);

INSERT INTO "invoice_number_counter" ("id", "last_number") VALUES (1, 0);

ALTER TABLE "invoice"
    -- Solo existe la factura emitida (FR-006).
    ADD CONSTRAINT "invoice_status_issued" CHECK ("status" = 'ISSUED'),
    ADD CONSTRAINT "invoice_number_positive" CHECK ("invoice_number" > 0),
    ADD CONSTRAINT "invoice_currency_cop" CHECK ("currency" = 'COP'),
    -- Datos tributarios mínimos completos (FR-008).
    ADD CONSTRAINT "invoice_customer_filled" CHECK (btrim("customer_name") <> '' AND btrim("customer_tax_id") <> ''),
    -- En canal directo no hay OTA ni comisión; en canal OTA el identificador es obligatorio.
    ADD CONSTRAINT "invoice_channel_data" CHECK (
        ("channel" = 'OTA' AND "ota_id" IS NOT NULL)
        OR ("channel" = 'DIRECT' AND "ota_id" IS NULL AND "ota_commission_amount" = 0)
    ),
    ADD CONSTRAINT "invoice_vat_rate_range" CHECK ("vat_rate_applied" BETWEEN 0 AND 100),
    ADD CONSTRAINT "invoice_amounts_not_negative" CHECK (
        "lodging_amount" >= 0
        AND "ota_commission_amount" >= 0
        AND "net_income" >= 0
        AND "vat_amount" >= 0
        AND "total_amount" >= 0
    ),
    -- El desglose cuadra siempre (FR-010): lo cobrado al huésped y la conciliación con la OTA.
    ADD CONSTRAINT "invoice_total_breakdown" CHECK ("total_amount" = "lodging_amount" + "vat_amount"),
    ADD CONSTRAINT "invoice_net_income_breakdown" CHECK ("net_income" = "lodging_amount" - "ota_commission_amount");
