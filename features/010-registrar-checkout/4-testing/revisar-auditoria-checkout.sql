-- Feature 010 · Registrar Check-out — consultas para el TC-010 y la recuperación desde la DLQ.
-- Las consultas 1 a 5 son de solo lectura. La 6 modifica un registro: úsala solo como paso 2
-- de la recuperación manual (ver 3-implementation/implementacion.md).
-- Uso (carpeta Hospitua-Module-3):
--   Get-Content features/010-registrar-checkout/4-testing/revisar-auditoria-checkout.sql | docker compose exec -T postgres psql -U hospitua -d modulo3
-- (para ejecutar solo una consulta, cópiala en psql: docker compose exec postgres psql -U hospitua -d modulo3)

-- 1. Últimos eventos recibidos con su resultado.
SELECT created_at, event_id, stay_id, status, error_code, result_note, processed_at
FROM checkout_event_log
ORDER BY created_at DESC
LIMIT 20;

-- 2. Eventos en revisión manual (DLQ) o rechazados.
SELECT created_at, event_id, stay_id, status, error_code, reason
FROM checkout_event_log
WHERE status IN ('DEAD_LETTER', 'REJECTED')
ORDER BY created_at DESC;

-- 3. Eventos que siguen PENDING (en reintento o a medio procesar).
SELECT created_at, event_id, stay_id, error_code, reason
FROM checkout_event_log
WHERE status = 'PENDING'
ORDER BY created_at;

-- 4. Privacidad (T017): debe devolver 0 filas. El payload nunca guarda datos tributarios.
SELECT event_id FROM checkout_event_log
WHERE payload ? 'billingCustomer'
   OR payload::text ILIKE '%taxId%'
   OR payload::text ILIKE '%nationality%';

-- 5. Recorrido de una estancia: auditoría → liquidación → factura.
--    Cambia el stay_id por el que imprimió publicar-checkout.js.
SELECT l.event_id, l.status, l.result_note,
       s.id AS settlement_id, s.channel, s.lodging_amount, s.net_income,
       i.invoice_number, i.vat_amount, i.total_amount
FROM checkout_event_log l
LEFT JOIN settlement s ON s.stay_id = l.stay_id
LEFT JOIN invoice i ON i.settlement_id = s.id
WHERE l.stay_id = '00000000-0000-4000-8000-000000000000';

-- 6. Recuperación desde la DLQ, paso 2 (MODIFICA): vuelve a PENDING un evento en DEAD_LETTER.
--    error_code y reason se conservan como historial hasta que el reproceso los cierre.
--    Descoméntala y cambia el event_id.
-- UPDATE checkout_event_log
-- SET status = 'PENDING', processed_at = NULL
-- WHERE event_id = '00000000-0000-4000-8000-000000000000' AND status = 'DEAD_LETTER';
