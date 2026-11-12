-- Feature 003 · Consultar porcentaje de comisión OTA — datos del TC-003.
-- Carga el historial de liquidaciones Final (007) que consulta el TC-003 y la cotización (005)
-- que usa el check-out real de la Sección 3 (HU2). Se puede correr las veces que se quiera:
-- primero borra lo que dejó una ejecución anterior. Solo toca filas del TC-003 (reservas
-- RES-TC003-* y la cotización cuyo id empieza por 0b030000). No crea facturas.
--
-- Uso, en la carpeta Hospitua-Module-3:
--   Get-Content features/003-consultar-porcentaje-comision-ota/4-testing/datos-tc-003.sql | docker compose exec -T postgres psql -U hospitua -d modulo3
--
-- Historial que queda cargado:
--   ota-tc003-a        3 liquidaciones: 12.00 (2025-03-15), 13.50 (2026-06-20), 15.00 (2026-10-08) ← la más reciente
--   ota-tc003-antigua  1 liquidación de hace años: 9.00 (2015-02-01)
--   booking            1 liquidación al 16.00, la más reciente de booking (la OTA del usuario ota-demo)
--   canal directo      1 liquidación DIRECT más reciente que todas (nunca debe aparecer)
--   ota-tc003-sin-historial  ninguna
-- La liquidación de booking se fecha ahora o justo después de la última de booking que ya
-- tenga la base (p. ej. las del TC-002, de diciembre de 2026), y la directa después de todas:
-- así el resultado no depende de otros casos de prueba cargados antes. Si después se carga
-- otro script con liquidaciones de booking, volver a correr este.

BEGIN;

DELETE FROM invoice WHERE reservation_ref LIKE 'RES-TC003-%';
DELETE FROM settlement WHERE reservation_ref LIKE 'RES-TC003-%';
DELETE FROM lodging_quote_night WHERE quote_id::text LIKE '0b030000-%';
DELETE FROM lodging_quote WHERE id::text LIKE '0b030000-%';

-- Cotización para el check-out real de la Sección 3 (reserva RES-TC003-NUEVA) -------------
-- Base 700 000, hospedaje 750 000 (ajuste +50 000), igual que los datos del TC-002.

INSERT INTO lodging_quote (id, room_id, check_in_date, check_out_date, currency, lodging_amount) VALUES
  ('0b030000-0000-4000-8000-000000000101', '0a030000-0000-4000-8000-000000000101', '2026-12-20', '2026-12-23', 'COP', 750000.00);

INSERT INTO lodging_quote_night (quote_id, night_date, base_rate, season_name, adjustment_percent, rate) VALUES
  ('0b030000-0000-4000-8000-000000000101', '2026-12-20', 200000.00, 'Regular', 0.00, 200000.00),
  ('0b030000-0000-4000-8000-000000000101', '2026-12-21', 250000.00, 'Regular', 0.00, 250000.00),
  ('0b030000-0000-4000-8000-000000000101', '2026-12-22', 250000.00, 'Alta', 20.00, 300000.00);

-- Liquidaciones Final (007) ---------------------------------------------------------------
-- Importes de 750 000 de hospedaje con la comisión de cada una.

INSERT INTO settlement (
  id, stay_id, reservation_ref, room_id, category_room, check_in_date, check_out_date, quote_id,
  channel, ota_id, ota_confirmation_code, ota_commission_percentage, currency,
  lodging_amount, base_lodging_amount, dynamic_adjustment_amount, ota_commission_amount, net_income,
  status, source_event_id, generated_at
) VALUES
  ('0c030000-0000-4000-8000-000000000001', '0d030000-0000-4000-8000-000000000001', 'RES-TC003-A-1',
   '0a030000-0000-4000-8000-000000000201', 'DOBLE', '2025-03-12', '2025-03-15', '0b030000-0000-4000-8000-000000000901',
   'OTA', 'ota-tc003-a', 'A-TC003-1', 12.00, 'COP',
   750000.00, 700000.00, 50000.00, 90000.00, 660000.00,
   'FINAL', '0e030000-0000-4000-8000-000000000001', '2025-03-15 11:00:00-05'),
  ('0c030000-0000-4000-8000-000000000002', '0d030000-0000-4000-8000-000000000002', 'RES-TC003-A-2',
   '0a030000-0000-4000-8000-000000000201', 'DOBLE', '2026-06-17', '2026-06-20', '0b030000-0000-4000-8000-000000000902',
   'OTA', 'ota-tc003-a', 'A-TC003-2', 13.50, 'COP',
   750000.00, 700000.00, 50000.00, 101250.00, 648750.00,
   'FINAL', '0e030000-0000-4000-8000-000000000002', '2026-06-20 11:00:00-05'),
  ('0c030000-0000-4000-8000-000000000003', '0d030000-0000-4000-8000-000000000003', 'RES-TC003-A-3',
   '0a030000-0000-4000-8000-000000000201', 'DOBLE', '2026-10-05', '2026-10-08', '0b030000-0000-4000-8000-000000000903',
   'OTA', 'ota-tc003-a', 'A-TC003-3', 15.00, 'COP',
   750000.00, 700000.00, 50000.00, 112500.00, 637500.00,
   'FINAL', '0e030000-0000-4000-8000-000000000003', '2026-10-08 11:02:00-05'),
  ('0c030000-0000-4000-8000-000000000004', '0d030000-0000-4000-8000-000000000004', 'RES-TC003-ANTIGUA',
   '0a030000-0000-4000-8000-000000000201', 'DOBLE', '2015-01-29', '2015-02-01', '0b030000-0000-4000-8000-000000000904',
   'OTA', 'ota-tc003-antigua', 'ANT-TC003', 9.00, 'COP',
   750000.00, 700000.00, 50000.00, 67500.00, 682500.00,
   'FINAL', '0e030000-0000-4000-8000-000000000004', '2015-02-01 09:00:00-05'),
  ('0c030000-0000-4000-8000-000000000005', '0d030000-0000-4000-8000-000000000005', 'RES-TC003-BOOKING',
   '0a030000-0000-4000-8000-000000000201', 'DOBLE', '2026-11-09', '2026-11-12', '0b030000-0000-4000-8000-000000000905',
   'OTA', 'booking', 'BKG-TC003', 16.00, 'COP',
   750000.00, 700000.00, 50000.00, 120000.00, 630000.00,
   'FINAL', '0e030000-0000-4000-8000-000000000005',
   GREATEST(now(), (SELECT max(generated_at) + interval '1 second' FROM settlement WHERE ota_id = 'booking'))),
  ('0c030000-0000-4000-8000-000000000006', '0d030000-0000-4000-8000-000000000006', 'RES-TC003-DIRECTA',
   '0a030000-0000-4000-8000-000000000201', 'DOBLE', '2026-11-09', '2026-11-12', '0b030000-0000-4000-8000-000000000906',
   'DIRECT', NULL, NULL, NULL, 'COP',
   750000.00, 700000.00, 50000.00, 0.00, 750000.00,
   'FINAL', '0e030000-0000-4000-8000-000000000006',
   GREATEST(now(), (SELECT max(generated_at) FROM settlement)) + interval '2 seconds');

COMMIT;
