-- Feature 006 · Generar factura final — consultas de solo lectura para el TC-006.
-- No modifica nada: sirve para revisar a mano las facturas emitidas y la integridad del
-- consecutivo después de correr las pruebas de integración o, cuando exista, la 010.
-- Uso (carpeta Hospitua-Module-3):
--   Get-Content features/006-generar-factura-final/4-testing/revisar-facturas.sql | docker compose exec -T postgres psql -U hospitua -d modulo3
-- (para la base de pruebas, cambia -d modulo3 por -d modulo3_test)

-- 1. Último número asignado. Debe coincidir con el mayor invoice_number (consulta 3).
SELECT id, last_number FROM invoice_number_counter;

-- 2. Facturas emitidas, de la más reciente a la más antigua.
SELECT invoice_number, issued_at, stay_id, settlement_id, channel, ota_id,
       lodging_amount, ota_commission_amount, net_income,
       vat_rate_applied, vat_amount, total_amount
FROM invoice
ORDER BY invoice_number DESC
LIMIT 20;

-- 3. Integridad del consecutivo (FR-011, NFR-003). Con la base limpia: total = max y huecos = 0.
--    Las pruebas de integración borran sus propias facturas pero no reinician el contador
--    (como en producción), así que en la base de pruebas puede haber huecos de facturas borradas.
SELECT count(*)                                   AS total_facturas,
       max(invoice_number)                        AS mayor_numero,
       max(invoice_number) - count(*)             AS huecos,
       (SELECT last_number FROM invoice_number_counter) AS contador
FROM invoice;

-- 4. Números duplicados (debe devolver 0 filas; UNIQUE lo impide).
SELECT invoice_number, count(*) FROM invoice GROUP BY invoice_number HAVING count(*) > 1;

-- 5. Desglose que no cuadra (debe devolver 0 filas; los CHECK lo impiden).
SELECT invoice_number FROM invoice
WHERE total_amount <> lodging_amount + vat_amount
   OR net_income <> lodging_amount - ota_commission_amount;

-- 6. Orden: issued_at sigue al número (debe devolver 0 filas).
SELECT a.invoice_number, a.issued_at, b.invoice_number AS siguiente, b.issued_at AS siguiente_issued_at
FROM invoice a
JOIN invoice b ON b.invoice_number = a.invoice_number + 1
WHERE b.issued_at < a.issued_at;

-- 7. Liquidaciones Final sin factura (casos NOT_ISSUED o fallos de emisión pendientes de reintento).
SELECT s.stay_id, s.reservation_ref, s.channel, s.generated_at
FROM settlement s
LEFT JOIN invoice i ON i.settlement_id = s.id
WHERE i.id IS NULL
ORDER BY s.generated_at DESC
LIMIT 20;
