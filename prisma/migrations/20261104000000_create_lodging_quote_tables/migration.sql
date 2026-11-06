-- Feature 005 · Consultar tarifa dinámica
-- Generado con `prisma migrate diff` (esquema anterior → schema.prisma); la sección
-- "SQL manual" del final está escrita a mano: Prisma no genera CHECK. Igual que en 009
-- y 011: generen las próximas migraciones con `prisma migrate diff` y no con
-- `prisma migrate dev`, que podría borrar lo de abajo.

-- CreateTable
CREATE TABLE "lodging_quote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL,
    "check_in_date" DATE NOT NULL,
    "check_out_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "lodging_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lodging_quote_night" (
    "quote_id" UUID NOT NULL,
    "night_date" DATE NOT NULL,
    "base_rate" DECIMAL(14,2) NOT NULL,
    "season_name" TEXT NOT NULL,
    "adjustment_percent" DECIMAL(6,2) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "lodging_quote_night_pkey" PRIMARY KEY ("quote_id","night_date")
);

-- AddForeignKey
ALTER TABLE "lodging_quote_night" ADD CONSTRAINT "lodging_quote_night_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "lodging_quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- SQL manual
-- ---------------------------------------------------------------------------

-- lodging_quote ------------------------------------------------------------------

ALTER TABLE "lodging_quote"
    -- Fecha de salida exclusiva: al menos una noche (FR-008).
    ADD CONSTRAINT "lodging_quote_valid_stay" CHECK ("check_in_date" < "check_out_date"),
    ADD CONSTRAINT "lodging_quote_currency_cop" CHECK ("currency" = 'COP'),
    -- Puede ser cero: un ajuste de -100.00 deja la noche en cero.
    ADD CONSTRAINT "lodging_quote_amount_not_negative" CHECK ("lodging_amount" >= 0);

-- lodging_quote_night ------------------------------------------------------------

ALTER TABLE "lodging_quote_night"
    -- Módulo 1 nunca entrega una tarifa base menor o igual a cero (004).
    ADD CONSTRAINT "lodging_quote_night_base_rate_positive" CHECK ("base_rate" > 0),
    -- Mismo rango del ajuste de 009.
    ADD CONSTRAINT "lodging_quote_night_adjustment_range" CHECK ("adjustment_percent" BETWEEN -100 AND 100),
    ADD CONSTRAINT "lodging_quote_night_rate_not_negative" CHECK ("rate" >= 0);
