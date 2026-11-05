-- Feature 005 · Consultar tarifa dinámica — deja la base sin cotizaciones para el TC-005.
-- Solo para entornos de prueba: borra TODAS las cotizaciones guardadas.
-- Uso (carpeta Hospitua-Module-3):
--   Get-Content features/005-consultar-tarifa-dinamica/4-testing/reset-cotizaciones.sql | docker compose exec -T postgres psql -U hospitua -d modulo3
BEGIN;
DELETE FROM lodging_quote_night;
DELETE FROM lodging_quote;
COMMIT;
