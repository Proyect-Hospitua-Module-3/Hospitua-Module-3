# Evidencia de rendimiento · 008 (T035)

Medición realizada el **2026-11-09** sobre **PostgreSQL 16.15**, imagen `postgres:16` del
Compose del proyecto, en Docker Desktop local. `shared_buffers = 128MB`, `work_mem = 4MB`.

Se ejecutó [benchmark-facturas.sql](benchmark-facturas.sql) contra una base aislada y migrada.
El script creó una tabla temporal con **1 000 000 de facturas**, los índices de las migraciones
006/008 y estadísticas actualizadas mediante `ANALYZE`. Distribución: dos años, canal directo y
diez OTA, nombres y documentos distintos, importes coherentes con las restricciones de invoice.
El mes consultado contiene 41 070 facturas. Al terminar se confirmó `ROLLBACK`; no se insertó
ninguna fila de benchmark en `public.invoice` ni se modificó el consecutivo oficial.

## Resultados observados

Los tiempos son `Execution Time` de una ejecución de `EXPLAIN (ANALYZE, BUFFERS)`, excluyendo
la planificación, el viaje HTTP y la serialización de la respuesta.

| Consulta | Filas devueltas/procesadas | Plan observado | Ejecución |
|---|---:|---|---:|
| Búsqueda por reserva | 1 | Index Scan por `reservation_ref` | 0,077 ms |
| Búsqueda por documento fiscal | 1 | Index Scan por `customer_tax_id` | 0,030 ms |
| Búsqueda por estancia | 1 | Index Scan por `stay_id` | 0,033 ms |
| Nombre parcial selectivo | 1 | Bitmap Index Scan GIN de trigramas; 127 candidatos, 126 descartados | 3,527 ms |
| Primera página por canal + OTA + mes | 20 | Index Scan Backward por `(channel, ota_id, issued_at)` e Incremental Sort | 0,092 ms |
| Conteo de esa búsqueda | 2 738 coincidencias | Bitmap Index Scan por `(channel, ota_id, issued_at)` | 4,690 ms |
| Resumen mensual por canal | 41 070 facturas → 11 grupos | Bitmap Index Scan por `issued_at` y HashAggregate | 20,654 ms |
| OTA históricas | 10 | CTE recursiva e Index Only Scan por `(channel, ota_id, issued_at)` | 0,238 ms |

Ejemplo del plan de resumen:

```text
HashAggregate (actual time=20.604..20.609 rows=11 loops=1)
  Group Key: channel, ota_id
  -> Bitmap Heap Scan on invoice (actual time=2.391..9.681 rows=41070 loops=1)
       -> Bitmap Index Scan on invoice_issued_at_invoice_number_idx
          (actual time=2.131..2.132 rows=41070 loops=1)
Execution Time: 20.654 ms
```

Los nombres de índices de la tabla temporal los genera PostgreSQL; sus columnas, orden y
método coinciden con los índices de producción. La consulta de canales históricos leyó
43 bloques locales (`hit=18`, `read=25`), sin recorrer el millón de facturas.

## Reproducir

Con Docker iniciado y una base de pruebas migrada (por ejemplo `modulo3_test`), desde la raíz:

```powershell
Get-Content -Raw -Encoding UTF8 'features/008-gestionar-facturacion/4-testing/benchmark-facturas.sql' |
  docker compose exec -T postgres psql -X -U hospitua -d modulo3_test -v ON_ERROR_STOP=1
```

La extensión `pg_trgm` debe estar instalada por la migración de 008. La tabla es temporal y
desaparece al cerrar la conexión, incluso si el comando se interrumpe. No requiere limpiar
las tablas reales ni cambiar la URL de la aplicación.

## Alcance y límites

La medición confirma el uso de índices para los filtros representativos y el resumen mensual
al volumen solicitado por T035. No es una prueba de carga HTTP ni una garantía de latencia
para cualquier máquina, tamaño de rango o número de clientes simultáneos. Un nombre muy
común, una página con OFFSET elevado o un resumen de toda la historia pueden leer muchas
más filas. La tabla temporal usa buffers locales y no reproduce la competencia de disco,
WAL, caché compartida o actividad de escritura de un despliegue real. No se midieron
percentiles ni se estableció un SLA que la especificación no exige.
