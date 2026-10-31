-- Feature 009 · Deja el catálogo de temporadas como recién migrado: solo Regular, con 0.00.
-- SOLO para preparar el caso de prueba TC-009 en la base local. Borra todas las temporadas.
-- Uso (PowerShell, desde la carpeta Hospitua-Module-3):
--   Get-Content features/009-modificar-precio-tarifa-segun-temporada/4-testing/reset-catalogo-temporadas.sql | docker compose exec -T postgres psql -U hospitua -d modulo3

BEGIN;

DELETE FROM season_rule_history;
DELETE FROM season_rule;
DELETE FROM season;

-- Igual que la migración 20261031000000_manage_season_rules.
WITH t AS (SELECT clock_timestamp() AS ts)
INSERT INTO season (id, name, color, is_default, version, created_at, created_by, updated_at, updated_by)
SELECT '00000000-0000-4000-8000-000000000001', 'Regular', '#808080', true, 1,
       t.ts, '00000000-0000-0000-0000-000000000000',
       t.ts, '00000000-0000-0000-0000-000000000000'
FROM t;

INSERT INTO season_rule (season_id, adjustment_percent, valid_from, created_at, created_by)
SELECT id, 0.00, created_at, created_at, created_by FROM season WHERE is_default;

INSERT INTO season_rule_history (season_id, change_type, new_rule_id, new_adjustment, new_name, new_color, changed_by, changed_at)
SELECT s.id, 'CREATE', r.id, r.adjustment_percent, s.name, s.color, s.created_by, s.created_at
FROM season s JOIN season_rule r ON r.season_id = s.id
WHERE s.is_default;

COMMIT;

SELECT name, color, is_default, version FROM season;
