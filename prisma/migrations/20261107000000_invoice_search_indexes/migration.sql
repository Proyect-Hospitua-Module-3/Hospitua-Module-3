-- Feature 008 · Gestionar facturación
-- Índices de búsqueda y resumen sobre invoice (tabla de 006); 008 no crea tablas.
-- Generado con `prisma migrate diff` (esquema anterior → schema.prisma); la sección
-- "SQL manual" del final está escrita a mano: Prisma no genera extensiones ni índices GIN.
-- stay_id no lleva índice nuevo: ya tiene el UNIQUE invoice_stay_id_key de 006.

-- CreateIndex
CREATE INDEX "idx_invoice_issued_at" ON "invoice"("issued_at" DESC, "invoice_number" DESC);

-- CreateIndex
CREATE INDEX "idx_invoice_channel_issued_at" ON "invoice"("channel", "ota_id", "issued_at");

-- CreateIndex
CREATE INDEX "idx_invoice_customer_tax_id" ON "invoice"("customer_tax_id");

-- CreateIndex
CREATE INDEX "idx_invoice_reservation_ref" ON "invoice"("reservation_ref");



-- ---------------------------------------------------------------------------
-- SQL manual
-- ---------------------------------------------------------------------------

-- Búsqueda por nombre del cliente sin distinguir mayúsculas, exacta o parcial (ILIKE): el
-- índice de trigramas sirve para las dos (caso límite «coincidencia parcial», NFR-001).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "idx_invoice_customer_name_trgm" ON "invoice" USING GIN ("customer_name" gin_trgm_ops);
