-- Feature 002 · Consultar liquidación — datos del TC-002.
-- Carga las cotizaciones (005), liquidaciones Final (007) y facturas (006) que consulta el
-- TC-002, sin pasar por el check-out (010) ni RabbitMQ. Se puede correr las veces que se
-- quiera: primero borra lo que dejó una ejecución anterior. Solo toca filas del TC-002
-- (reservas RES-TC002-* y cotizaciones cuyo id empieza por 0b020000).
--
-- Uso, en la carpeta Hospitua-Module-3:
--   Get-Content features/002-consultar-liquidacion/4-testing/datos-tc-002.sql | docker compose exec -T postgres psql -U hospitua -d modulo3
--
-- Los importes son los que calcularía 007 con estas cotizaciones. Las facturas usan los
-- números 900200001 y 900200002, muy por encima del consecutivo de 006: no se toca
-- invoice_number_counter, así que las facturas reales siguen su numeración normal.
--
-- Habitaciones:
--   0a020000-...-000000000101  RES-TC002-OTA       Final con factura
--   0a020000-...-000000000102  RES-TC002-OTA       Final sin factura todavía
--   0a020000-...-000000000103  RES-TC002-OTA       sin check-out (informativa)
--   0a020000-...-000000000201  RES-TC002-DIRECTA   Final con factura (canal directo)
--   0a020000-...-000000000202  RES-TC002-DIRECTA   sin check-out (informativa directa)
--   0a020000-...-000000000301  RES-TC002-EXPEDIA   Final de otra OTA (expedia)

BEGIN;

DELETE FROM invoice WHERE reservation_ref LIKE 'RES-TC002-%';
DELETE FROM settlement WHERE reservation_ref LIKE 'RES-TC002-%';
DELETE FROM lodging_quote_night WHERE quote_id::text LIKE '0b020000-%';
DELETE FROM lodging_quote WHERE id::text LIKE '0b020000-%';

-- Cotizaciones (005) ---------------------------------------------------------------

INSERT INTO lodging_quote (id, room_id, check_in_date, check_out_date, currency, lodging_amount) VALUES
  ('0b020000-0000-4000-8000-000000000101', '0a020000-0000-4000-8000-000000000101', '2026-12-20', '2026-12-23', 'COP', 750000.00),
  ('0b020000-0000-4000-8000-000000000102', '0a020000-0000-4000-8000-000000000102', '2026-12-20', '2026-12-22', 'COP', 600000.00),
  ('0b020000-0000-4000-8000-000000000103', '0a020000-0000-4000-8000-000000000103', '2026-12-21', '2026-12-23', 'COP', 540000.00),
  ('0b020000-0000-4000-8000-000000000201', '0a020000-0000-4000-8000-000000000201', '2026-12-20', '2026-12-23', 'COP', 750000.00),
  ('0b020000-0000-4000-8000-000000000202', '0a020000-0000-4000-8000-000000000202', '2026-12-24', '2026-12-26', 'COP', 720000.00),
  ('0b020000-0000-4000-8000-000000000301', '0a020000-0000-4000-8000-000000000301', '2026-12-20', '2026-12-23', 'COP', 750000.00);

INSERT INTO lodging_quote_night (quote_id, night_date, base_rate, season_name, adjustment_percent, rate) VALUES
  -- 101, 201 y 301: base 700 000, hospedaje 750 000 (ajuste +50 000)
  ('0b020000-0000-4000-8000-000000000101', '2026-12-20', 200000.00, 'Regular', 0.00, 200000.00),
  ('0b020000-0000-4000-8000-000000000101', '2026-12-21', 250000.00, 'Regular', 0.00, 250000.00),
  ('0b020000-0000-4000-8000-000000000101', '2026-12-22', 250000.00, 'Alta', 20.00, 300000.00),
  ('0b020000-0000-4000-8000-000000000201', '2026-12-20', 200000.00, 'Regular', 0.00, 200000.00),
  ('0b020000-0000-4000-8000-000000000201', '2026-12-21', 250000.00, 'Regular', 0.00, 250000.00),
  ('0b020000-0000-4000-8000-000000000201', '2026-12-22', 250000.00, 'Alta', 20.00, 300000.00),
  ('0b020000-0000-4000-8000-000000000301', '2026-12-20', 200000.00, 'Regular', 0.00, 200000.00),
  ('0b020000-0000-4000-8000-000000000301', '2026-12-21', 250000.00, 'Regular', 0.00, 250000.00),
  ('0b020000-0000-4000-8000-000000000301', '2026-12-22', 250000.00, 'Alta', 20.00, 300000.00),
  -- 102: base 500 000, hospedaje 600 000 (ajuste +100 000)
  ('0b020000-0000-4000-8000-000000000102', '2026-12-20', 250000.00, 'Alta', 20.00, 300000.00),
  ('0b020000-0000-4000-8000-000000000102', '2026-12-21', 250000.00, 'Alta', 20.00, 300000.00),
  -- 103: base 600 000, hospedaje 540 000 (ajuste -60 000)
  ('0b020000-0000-4000-8000-000000000103', '2026-12-21', 300000.00, 'Baja', -10.00, 270000.00),
  ('0b020000-0000-4000-8000-000000000103', '2026-12-22', 300000.00, 'Baja', -10.00, 270000.00),
  -- 202: base 600 000, hospedaje 720 000 (ajuste +120 000)
  ('0b020000-0000-4000-8000-000000000202', '2026-12-24', 300000.00, 'Alta', 20.00, 360000.00),
  ('0b020000-0000-4000-8000-000000000202', '2026-12-25', 300000.00, 'Alta', 20.00, 360000.00);

-- Liquidaciones Final (007) ---------------------------------------------------------

INSERT INTO settlement (
  id, stay_id, reservation_ref, room_id, category_room, check_in_date, check_out_date, quote_id,
  channel, ota_id, ota_confirmation_code, ota_commission_percentage, currency,
  lodging_amount, base_lodging_amount, dynamic_adjustment_amount, ota_commission_amount, net_income,
  status, source_event_id, generated_at
) VALUES
  ('0c020000-0000-4000-8000-000000000101', '0d020000-0000-4000-8000-000000000101', 'RES-TC002-OTA',
   '0a020000-0000-4000-8000-000000000101', 'DOBLE', '2026-12-20', '2026-12-23', '0b020000-0000-4000-8000-000000000101',
   'OTA', 'booking', 'BKG-TC002', 15.00, 'COP',
   750000.00, 700000.00, 50000.00, 112500.00, 637500.00,
   'FINAL', '0e020000-0000-4000-8000-000000000101', '2026-12-23 11:02:00-05'),
  ('0c020000-0000-4000-8000-000000000102', '0d020000-0000-4000-8000-000000000102', 'RES-TC002-OTA',
   '0a020000-0000-4000-8000-000000000102', 'SUITE', '2026-12-20', '2026-12-22', '0b020000-0000-4000-8000-000000000102',
   'OTA', 'booking', 'BKG-TC002', 15.00, 'COP',
   600000.00, 500000.00, 100000.00, 90000.00, 510000.00,
   'FINAL', '0e020000-0000-4000-8000-000000000102', '2026-12-22 10:15:00-05'),
  ('0c020000-0000-4000-8000-000000000201', '0d020000-0000-4000-8000-000000000201', 'RES-TC002-DIRECTA',
   '0a020000-0000-4000-8000-000000000201', 'DOBLE', '2026-12-20', '2026-12-23', '0b020000-0000-4000-8000-000000000201',
   'DIRECT', NULL, NULL, NULL, 'COP',
   750000.00, 700000.00, 50000.00, 0.00, 750000.00,
   'FINAL', '0e020000-0000-4000-8000-000000000201', '2026-12-23 12:00:00-05'),
  ('0c020000-0000-4000-8000-000000000301', '0d020000-0000-4000-8000-000000000301', 'RES-TC002-EXPEDIA',
   '0a020000-0000-4000-8000-000000000301', 'DOBLE', '2026-12-20', '2026-12-23', '0b020000-0000-4000-8000-000000000301',
   'OTA', 'expedia', 'EXP-TC002', 18.00, 'COP',
   750000.00, 700000.00, 50000.00, 135000.00, 615000.00,
   'FINAL', '0e020000-0000-4000-8000-000000000301', '2026-12-23 13:00:00-05');

-- Facturas (006) --------------------------------------------------------------------

INSERT INTO invoice (
  id, invoice_number, status, issued_at, settlement_id, stay_id, source_event_id, reservation_ref,
  channel, ota_id, customer_name, customer_tax_id, currency,
  lodging_amount, ota_commission_amount, net_income, vat_rate_applied, vat_amount, total_amount
) VALUES
  ('0f020000-0000-4000-8000-000000000101', 900200001, 'ISSUED', '2026-12-23 11:05:12-05',
   '0c020000-0000-4000-8000-000000000101', '0d020000-0000-4000-8000-000000000101', '0e020000-0000-4000-8000-000000000101',
   'RES-TC002-OTA', 'OTA', 'booking', 'Cliente TC-002', '900123456', 'COP',
   750000.00, 112500.00, 637500.00, 19.00, 142500.00, 892500.00),
  ('0f020000-0000-4000-8000-000000000201', 900200002, 'ISSUED', '2026-12-23 12:03:00-05',
   '0c020000-0000-4000-8000-000000000201', '0d020000-0000-4000-8000-000000000201', '0e020000-0000-4000-8000-000000000201',
   'RES-TC002-DIRECTA', 'DIRECT', NULL, 'Cliente TC-002', '900123456', 'COP',
   750000.00, 0.00, 750000.00, 19.00, 142500.00, 892500.00);

COMMIT;
