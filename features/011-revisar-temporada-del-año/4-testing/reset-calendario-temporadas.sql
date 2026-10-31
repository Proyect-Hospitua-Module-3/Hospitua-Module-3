-- Feature 011 · Deja el calendario de temporadas vacío (ningún año con revisión).
-- SOLO para preparar el caso de prueba TC-011 en la base local. Borra todas las revisiones.
-- No toca el catálogo de temporadas de 009.
-- Uso (PowerShell, desde la carpeta Hospitua-Module-3):
--   Get-Content features/011-revisar-temporada-del-año/4-testing/reset-calendario-temporadas.sql | docker compose exec -T postgres psql -U hospitua -d modulo3
-- Si además vas a reiniciar el catálogo con el script de 009, corre este primero: el
-- calendario referencia temporadas y la base no deja borrar una temporada en uso.

BEGIN;

DELETE FROM season_calendar_active_base;
DELETE FROM season_calendar_entry;
DELETE FROM season_calendar_revision;

COMMIT;

SELECT count(*) AS revisiones FROM season_calendar_revision;
