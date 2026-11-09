-- Feature 008 · T035. Benchmark reproducible de lectura sobre un millón de facturas.
-- Ejecutar con psql -X -v ON_ERROR_STOP=1 contra una base con las migraciones aplicadas.
-- Usa una tabla TEMPORARY: no inserta, modifica ni elimina facturas reales.
-- La conexión descarta la tabla al terminar, incluso si se interrumpe el script.
\timing on
SELECT version();
SHOW shared_buffers;
SHOW work_mem;

BEGIN;
CREATE TEMPORARY TABLE invoice
  (LIKE public.invoice INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
  ON COMMIT DROP;

INSERT INTO invoice (
  id, invoice_number, status, issued_at, settlement_id, stay_id, source_event_id,
  reservation_ref, channel, ota_id, customer_name, customer_tax_id, currency,
  lodging_amount, ota_commission_amount, net_income, vat_rate_applied, vat_amount, total_amount
)
SELECT
  md5('invoice-' || n)::uuid, n, 'ISSUED',
  timestamptz '2025-01-01 05:00:00+00' + (n % 730) * interval '1 day'
    + (n / 730) * interval '1 second',
  md5('settlement-' || n)::uuid, md5('stay-' || n)::uuid, md5('event-' || n)::uuid,
  'BENCH-008-' || n,
  CASE WHEN n % 3 = 0 THEN 'DIRECT' ELSE 'OTA' END,
  CASE WHEN n % 3 = 0 THEN NULL ELSE 'ota-' || (n % 10) END,
  'Cliente ' || lpad(n::text, 10, '0'), 'NIT-' || lpad(n::text, 10, '0'), 'COP',
  amount, commission, amount - commission, 19.00, amount * 0.19, amount * 1.19
FROM generate_series(1, 1000000) AS data(n)
CROSS JOIN LATERAL (SELECT (100000 + (n % 1000) * 100)::numeric AS amount) AS amounts
CROSS JOIN LATERAL (
  SELECT CASE WHEN n % 3 = 0 THEN 0::numeric ELSE amount * 0.15 END AS commission
) AS commissions;

-- Mismos índices que invoice en las migraciones 006 y 008.
CREATE UNIQUE INDEX ON invoice (id);
CREATE UNIQUE INDEX ON invoice (invoice_number);
CREATE UNIQUE INDEX ON invoice (settlement_id);
CREATE UNIQUE INDEX ON invoice (stay_id);
CREATE INDEX ON invoice (issued_at DESC, invoice_number DESC);
CREATE INDEX ON invoice (channel, ota_id, issued_at);
CREATE INDEX ON invoice (customer_tax_id);
CREATE INDEX ON invoice (reservation_ref);
CREATE INDEX ON invoice USING gin (customer_name gin_trgm_ops);
ANALYZE invoice;
SELECT count(*) AS benchmark_rows FROM invoice;

\echo 'T035: busqueda por reserva'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, invoice_number, issued_at, stay_id, reservation_ref, channel, ota_id,
       customer_name, customer_tax_id, currency, total_amount
FROM invoice
WHERE reservation_ref = 'BENCH-008-500001' AND issued_at <= timestamptz '2027-01-01 00:00:00+00'
ORDER BY issued_at DESC, invoice_number DESC LIMIT 20 OFFSET 0;

\echo 'T035: busqueda por documento'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, invoice_number, total_amount FROM invoice
WHERE customer_tax_id = 'NIT-0000500001' AND issued_at <= timestamptz '2027-01-01 00:00:00+00'
ORDER BY issued_at DESC, invoice_number DESC LIMIT 20;

\echo 'T035: busqueda por estancia'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, invoice_number FROM invoice
WHERE stay_id = md5('stay-500001')::uuid AND issued_at <= timestamptz '2027-01-01 00:00:00+00'
ORDER BY issued_at DESC, invoice_number DESC LIMIT 20;

\echo 'T035: nombre parcial literal'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, invoice_number FROM invoice
WHERE customer_name ILIKE '%0000500001%' ESCAPE '!'
  AND issued_at <= timestamptz '2027-01-01 00:00:00+00'
ORDER BY issued_at DESC, invoice_number DESC LIMIT 20;

\echo 'T035: pagina por canal, OTA y rango'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, invoice_number, total_amount FROM invoice
WHERE channel = 'OTA' AND ota_id = 'ota-1'
  AND issued_at >= timestamptz '2026-11-01 05:00:00+00'
  AND issued_at < timestamptz '2026-12-01 05:00:00+00'
  AND issued_at <= timestamptz '2027-01-01 00:00:00+00'
ORDER BY issued_at DESC, invoice_number DESC LIMIT 20 OFFSET 0;

\echo 'T035: conteo por canal, OTA y rango'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM invoice
WHERE channel = 'OTA' AND ota_id = 'ota-1'
  AND issued_at >= timestamptz '2026-11-01 05:00:00+00'
  AND issued_at < timestamptz '2026-12-01 05:00:00+00'
  AND issued_at <= timestamptz '2027-01-01 00:00:00+00';

\echo 'T035: resumen mensual por canal'
EXPLAIN (ANALYZE, BUFFERS)
SELECT channel, ota_id, count(*), sum(lodging_amount), sum(ota_commission_amount),
       sum(vat_amount), sum(total_amount)
FROM invoice
WHERE issued_at >= timestamptz '2026-11-01 05:00:00+00'
  AND issued_at < timestamptz '2026-12-01 05:00:00+00'
GROUP BY channel, ota_id;

\echo 'T035: canales OTA historicos'
EXPLAIN (ANALYZE, BUFFERS)
WITH RECURSIVE known AS (
  (SELECT ota_id FROM invoice WHERE channel = 'OTA' AND ota_id IS NOT NULL ORDER BY ota_id LIMIT 1)
  UNION ALL
  SELECT (SELECT next.ota_id FROM invoice next
          WHERE next.channel = 'OTA' AND next.ota_id > known.ota_id ORDER BY next.ota_id LIMIT 1)
  FROM known WHERE known.ota_id IS NOT NULL
)
SELECT ota_id FROM known WHERE ota_id IS NOT NULL;

ROLLBACK;
