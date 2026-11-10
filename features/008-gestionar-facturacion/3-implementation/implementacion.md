# Implementación: Gestionar facturación (008)

**Spec**: [gestionar_facturacion.md](../1-functional/gestionar_facturacion.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contratos**: [GET-invoices.md](../2-technical/contracts/GET-invoices.md), [GET-invoices-id.md](../2-technical/contracts/GET-invoices-id.md) y [GET-invoices-summary.md](../2-technical/contracts/GET-invoices-summary.md) (REST)
**Rama**: `feature/008-gestionar-facturacion`
**Validación actualizada**: 2026-11-09

Este documento ubica el backend de la 008 en las capas hexagonales de `src/` y `test/`, dentro del contexto `billing`, y su pantalla React en `frontend/`. Incluye la evidencia de pruebas, rendimiento y recorrido en navegador.

> Para encontrar todos los archivos de la 008 en VS Code: `Ctrl+Shift+F` y buscar `Feature 008`.

**Alcance**: las 3 historias de usuario, 3 endpoints de lectura y pantalla `/facturas`. Las 43 tareas del plan están completas: 167 pruebas backend de 008, 48 frontend, benchmark de 1M de facturas y QA con Chrome contra el backend y PostgreSQL reales.

---

## 1. Qué hace

Tres rutas de solo lectura, solo para el **Administrador**, sobre las facturas que emitió la 006:

| Ruta | Qué recibe | Qué devuelve |
|---|---|---|
| `GET /invoices` | Al menos un criterio: `stayId`, `reservationRef`, `customerName` (con `customerMatch` `EXACT` o `PARTIAL`), `customerTaxId`, `channel` (con `otaId` opcional) o el rango `issuedFrom`–`issuedTo`. Además `page`, `pageSize` y `asOf` | Una página de facturas con su número oficial, más `totalItems`, `totalPages`, `asOf`, `resultStatus` (`MATCHES` o `NO_MATCHES`) y el modo de coincidencia aplicado |
| `GET /invoices/{invoiceId}` | El id de una factura de la búsqueda | El desglose completo tal como se emitió (hospedaje, comisión, neto, IVA, total), la liquidación de origen, la fecha de emisión, `status: "ISSUED"` e `immutable: true` |
| `GET /invoices/summary` | `issuedFrom` e `issuedTo` (obligatorios) | Por canal: cantidad de facturas y totales de hospedaje, comisión OTA, IVA y facturado. `DIRECT` siempre aparece, y cada OTA con facturas históricas aparece aunque esté en cero |

Las consultas **solo leen**: nunca crean, cambian ni recalculan facturas ni liquidaciones. Los importes son los que guardó la 006; el resumen solo los suma por canal.

**Fechas y zona horaria**: las fechas (`YYYY-MM-DD`) se interpretan en hora de Bogotá. Un rango `2026-12-01`–`2026-12-31` es el intervalo `[2026-12-01 00:00, 2027-01-01 00:00)` de Bogotá, es decir `[05:00 UTC, 05:00 UTC)`. Una factura de las 23:59 del 31 de diciembre en Bogotá entra aunque en UTC ya sea 1 de enero.

**Paginación con foto (`asOf`)**: la primera página espera las emisiones abiertas de 006 y fija `asOf` con `clock_timestamp()` de PostgreSQL, truncado a milisegundos. Las páginas siguientes reenvían ese corte y filtran `issued_at <= asOf`. Página y conteo usan una misma transacción `READ ONLY` con `RepeatableRead`, por lo que un commit concurrente no produce un total incompatible con los resultados. Una búsqueda nueva o un cambio de tamaño inicia otro corte.

---

## 2. Recorrido de una petición

```text
HTTP ─► CorrelationIdMiddleware      X-Correlation-Id (de la base)
     ─► JwtAuthGuard                 sin token, inválido o vencido                            → 401
     ─► RolesGuard                   rol distinto de Administrador                             → 403
     ─► InvoicesAdminController      pasa los parámetros tal cual + el sub del token
     ─► LoggedManageInvoicesUseCase  log estructurado de la consulta (sin nombre ni documento)
     ─► ManageInvoicesService
          ├─ search ─► parseInvoiceSearch   formato de cada parámetro                       → 400 INVALID_QUERY_PARAMS
          │                                 una sola fecha o rango invertido                 → 400 INVALID_DATE_RANGE
          │                                 ningún criterio                                  → 400 MISSING_SEARCH_CRITERIA
          │            currentTime(): advisory SHARE (8, 1), luego clock_timestamp()
          │            asOf con fecha civil imposible o futuro                             → 400 INVALID_QUERY_PARAMS
          │            rango → instantes en America/Bogota
          │            PrismaInvoiceQueryAdapter.search (READ ONLY, RepeatableRead): página + count(*)
          │       ◄── 200 { items, page, pageSize, totalItems, totalPages, asOf, resultStatus, customerMatchMode }
          ├─ getDetail ─► parseInvoiceId    no es UUID                                      → 400 INVALID_QUERY_PARAMS
          │               findDetailById (READ ONLY, lista blanca de columnas); no existe    → 404 INVOICE_NOT_FOUND
          │       ◄── 200 { invoiceId, invoiceNumber, status, immutable, …, totalAmount }
          └─ summarizeByChannel ─► parseInvoiceSummaryRange   falta una fecha o invertido   → 400 INVALID_DATE_RANGE
                                   summarizeByChannel + listKnownOtaIds (READ ONLY)
                                   DIRECT siempre; OTA históricas en cero; orden DIRECT y luego otaId
                  ◄── 200 { range, timezone, currency, channels: [ … ] }
```

---

## 3. Archivos por capa

### Dominio — reglas de negocio puras (sin NestJS ni Prisma)

| Archivo | Qué hace | Requisito |
|---|---|---|
| [invoice-search-criteria.ts](../../../src/domain/model/billing/invoice-search-criteria.ts) | `parseInvoiceSearch` (criterios, página, `asOf` con zona y fecha civil posible), `parseInvoiceSummaryRange` y `parseInvoiceId`: validan los parámetros tal como llegan | FR-001, FR-002, FR-007, FR-013 |
| [issued-date-range.ts](../../../src/domain/model/billing/issued-date-range.ts) | Valida el par de fechas y lo convierte a instantes en la zona de referencia | FR-013, NFR-006 |
| [customer-match-mode.ts](../../../src/domain/model/billing/customer-match-mode.ts) | `EXACT` / `PARTIAL` y el mínimo de 3 caracteres | Caso límite «coincidencia parcial» |
| [invoice-read-models.ts](../../../src/domain/model/billing/invoice-read-models.ts) | Forma de la búsqueda, el detalle y el resumen; importes como texto decimal | FR-003, FR-004, FR-005, FR-012 |
| [missing-search-criteria.error.ts](../../../src/domain/errors/billing/missing-search-criteria.error.ts) | `MISSING_SEARCH_CRITERIA` (400) | FR-002 |
| [invalid-issued-date-range.error.ts](../../../src/domain/errors/billing/invalid-issued-date-range.error.ts) | `INVALID_DATE_RANGE` (400), con mensaje de fechas de emisión | FR-013 |
| [invalid-invoice-query.error.ts](../../../src/domain/errors/billing/invalid-invoice-query.error.ts) | `INVALID_QUERY_PARAMS` (400) | Contratos, «Errores» |
| [invoice-not-found.error.ts](../../../src/domain/errors/billing/invoice-not-found.error.ts) | `INVOICE_NOT_FOUND` (404) | Contrato GET-invoices-id |
| [manage-invoices.use-case.ts](../../../src/domain/ports/in/billing/manage-invoices.use-case.ts) | Puerto de entrada `ManageInvoicesUseCase` | — |
| [invoice-query.port.ts](../../../src/domain/ports/out/billing/invoice-query.port.ts) | Puerto de salida de solo lectura (sin métodos de escritura) | FR-006, BR-001 |

### Aplicación — caso de uso

| Archivo | Qué hace |
|---|---|
| [manage-invoices.service.ts](../../../src/application/services/billing/manage-invoices.service.ts) | Orquesta el recorrido de la sección 2: valida, fija `asOf`, convierte el rango a Bogotá, marca `NO_MATCHES` y completa el resumen con ceros. Recibe la zona horaria por constructor. Sin decoradores de NestJS |

### Infraestructura — adaptadores

| Archivo | Qué hace |
|---|---|
| [invoices-admin.controller.ts](../../../src/infrastructure/adapters/in/http/billing/invoices-admin.controller.ts) | Las tres rutas `GET`, con `@Roles('Administrador')` en la clase y su documentación Swagger. `summary` va antes de `:invoiceId` |
| [dto/invoices.dto.ts](../../../src/infrastructure/adapters/in/http/billing/dto/invoices.dto.ts) | Parámetros y respuestas para Swagger |
| [prisma-invoice-query.adapter.ts](../../../src/infrastructure/adapters/out/persistence/repositories/billing/prisma-invoice-query.adapter.ts) | Lecturas `READ ONLY`: hora tras advisory compartido con `ReadCommitted`; página/conteo con `RepeatableRead`; detalle con lista blanca y agregación por canal |
| [invoice-publication-lock.ts](../../../src/infrastructure/adapters/out/persistence/repositories/billing/invoice-publication-lock.ts) | Define el namespace 8 y key 1 del advisory que comparten las features 006 y 008 |
| [logged-manage-invoices.use-case.ts](../../../src/infrastructure/logging/billing/logged-manage-invoices.use-case.ts) | Log de cada consulta: quién, qué criterios (sin sus valores), cuántos resultados o el `errorCode`, y la duración |

### Archivos compartidos que tocó la 008

| Archivo | Cambio |
|---|---|
| [domain-exception.filter.ts](../../../src/infrastructure/adapters/in/http/domain-exception.filter.ts) | Dos líneas: `MISSING_SEARCH_CRITERIA: 400` e `INVOICE_NOT_FOUND: 404` (`INVALID_DATE_RANGE` e `INVALID_QUERY_PARAMS` ya estaban) |
| [billing.module.ts](../../../src/infrastructure/config/billing.module.ts) | Registra el controller, el adaptador y el servicio envuelto en el log; lee `BILLING_REPORTING_TZ` |
| [schema.prisma](../../../prisma/schema.prisma) | Cuatro `@@index` en el modelo `Invoice` |
| [read-only-transaction.ts](../../../src/infrastructure/adapters/out/persistence/repositories/settlement/read-only-transaction.ts) | El helper de 002 recibe aislamiento opcional; conserva `SET TRANSACTION READ ONLY` como primera sentencia y su comportamiento previo para los demás consumidores |
| [prisma-invoice-issuance.repository.ts](../../../src/infrastructure/adapters/out/persistence/repositories/billing/prisma-invoice-issuance.repository.ts) | 006 toma el advisory exclusivo `(8, 1)` antes del bloqueo del contador oficial y lo mantiene hasta commit, para que 008 espere las emisiones pendientes antes de fijar el corte |
| [.env.example](../../../.env.example) y [README.md](../../../README.md) | `BILLING_REPORTING_TZ` y la fila de la 008 |
| [Modal.tsx](../../../frontend/src/components/ui/Modal.tsx) | Contiene Tab y Shift+Tab dentro del diálogo también cuando el foco está en el título con `tabIndex=-1`; Escape cierra y el foco vuelve al botón de apertura |

Se reutilizan de la base `JwtAuthGuard`, `RolesGuard`, `@Roles`, `@CurrentUser` y `ChannelKind`. El frontend reutiliza la sesión, el diseño, los avisos, botones y diálogo existentes.

### Base de datos

Migración [20261107000000_invoice_search_indexes](../../../prisma/migrations/20261107000000_invoice_search_indexes/migration.sql). La 008 no crea tablas: solo índices sobre `invoice` (de la 006).

| Índice | Para qué |
|---|---|
| `idx_invoice_issued_at (issued_at DESC, invoice_number DESC)` | Orden de la búsqueda y rango de fechas; resumen por rango |
| `idx_invoice_channel_issued_at (channel, ota_id, issued_at)` | Canal + OTA + rango; lista de OTA conocidas |
| `idx_invoice_customer_tax_id` | Búsqueda por documento |
| `idx_invoice_reservation_ref` | Búsqueda por reserva |
| `idx_invoice_customer_name_trgm` (GIN, `pg_trgm`) | Nombre exacto o parcial sin distinguir mayúsculas. SQL manual, con `CREATE EXTENSION IF NOT EXISTS pg_trgm` |

`stay_id` no lleva índice nuevo: ya tiene el `UNIQUE` de la 006.

### Frontend

| Archivo | Qué hace |
|---|---|
| [api/invoices.ts](../../../frontend/src/api/invoices.ts) | Tipos de los tres contratos y clientes `GET` con JWT; lista blanca de parámetros de búsqueda |
| [lib/invoices.ts](../../../frontend/src/lib/invoices.ts) | Valida criterios, UUID, nombre parcial, canal/OTA, fechas y tamaño; presenta importes decimales sin perder centavos por conversión a `Number` |
| [InvoicesPage.tsx](../../../frontend/src/pages/invoices/InvoicesPage.tsx) | Orquesta búsqueda, detalle y resumen con estados independientes; reintentos, 401/403 y descarte de respuestas tardías |
| [InvoiceSearchForm.tsx](../../../frontend/src/pages/invoices/InvoiceSearchForm.tsx) | Filtros combinables, errores asociados a campos y limpieza de la búsqueda |
| [InvoiceResults.tsx](../../../frontend/src/pages/invoices/InvoiceResults.tsx) | Número oficial, filtros aplicados, coincidencia, total, corte temporal y navegación entre páginas |
| [InvoiceDetailView.tsx](../../../frontend/src/pages/invoices/InvoiceDetailView.tsx) | Cliente fiscal, importes emitidos y trazabilidad dentro del diálogo de solo lectura |
| [InvoiceSummaryPanel.tsx](../../../frontend/src/pages/invoices/InvoiceSummaryPanel.tsx) | Formulario independiente y totales de DIRECT y cada OTA histórica, incluidos los ceros |
| [InvoicesPage.module.css](../../../frontend/src/pages/invoices/InvoicesPage.module.css) | Formularios adaptables y tablas con desplazamiento dentro de su región |
| [App.tsx](../../../frontend/src/App.tsx) y [AppLayout.tsx](../../../frontend/src/components/layout/AppLayout.tsx) | Ruta `/facturas` con sesión requerida y acceso desde la navegación |

---

## 4. Pruebas

Verificadas el **2026-11-09**: **167 pruebas backend de la 008** (138 sin base de datos, 20 de integración y 9 E2E) y **48 frontend**, todas pasan.

| Archivo | Tipo | Pruebas | Qué verifica |
|---|---|---:|---|
| [invoice-search-criteria.spec.ts](../../../test/unit/domain/billing/invoice-search-criteria.spec.ts) | Unitaria | 64 | Al menos un criterio, formato, `EXACT`/`PARTIAL`, repetidos/vacíos y `asOf` con fecha civil imposible, hora o zona inválida |
| [issued-date-range.spec.ts](../../../test/unit/domain/billing/issued-date-range.spec.ts) | Unitaria | 7 | Bogotá, borde del día, bisiesto, fechas civiles y otra zona con cambio de horario |
| [manage-invoices.service.spec.ts](../../../test/unit/application/billing/manage-invoices.service.spec.ts) | Unitaria | 22 | HU1 (`NO_MATCHES`, paginación, `asOf`), HU2 (404, 400) y HU3 (ceros, orden, sin mezcla) |
| [logged-manage-invoices.use-case.spec.ts](../../../test/unit/infrastructure/billing/logged-manage-invoices.use-case.spec.ts) | Unitaria | 4 | El log no lleva nombre ni documento del cliente |
| [manage-invoices-dependencies.spec.ts](../../../test/architecture/manage-invoices-dependencies.spec.ts) | Arquitectura | 5 | 008 no usa el lado de escritura de 006/007; el adaptador solo lee; el controller solo tiene `GET` |
| [invoices-admin.contract.spec.ts](../../../test/contract/billing/invoices-admin.contract.spec.ts) | Contrato | 36 | Respuestas, errores, fechas imposibles y `asOf` futuro; 401/403; `POST`/`PUT`/`PATCH`/`DELETE` → 404 |
| [prisma-invoice-query.adapter.spec.ts](../../../test/integration/persistence/billing/prisma-invoice-query.adapter.spec.ts) | Integración (PostgreSQL) | 20 | Filtros, caracteres literales, Bogotá, orden, `asOf`, sumas y auditoría; emisión abierta al fijar el corte y commit entre página/conteo |
| [gestionar-facturacion.e2e-spec.ts](../../../test/e2e/billing/gestionar-facturacion.e2e-spec.ts) | E2E (PostgreSQL) | 9 | Check-out → liquidación (007) → factura (006) → búsqueda, detalle y resumen por HTTP; reserva cancelada sin resultados |
| [lib/invoices.test.ts](../../../frontend/src/lib/invoices.test.ts) | Frontend (Vitest) | 23 | Validación de criterios y rangos, fechas reales e importes sin pérdida de centavos |
| [InvoicesPage.test.tsx](../../../frontend/src/pages/invoices/InvoicesPage.test.tsx) | Frontend (Testing Library) | 25 | Ruta real, filtros, paginación con `asOf`, detalle, resumen, permisos, reintentos, respuestas tardías y foco con Tab/Shift+Tab/Escape y restauración |

**Entorno de validación.** PostgreSQL **16.15** real, imagen `postgres:16` del Compose en Docker Desktop. Se creó la base aislada `codex_008_validation_b74e`, se aplicaron las **8 migraciones desde cero** y las pruebas usaron `TEST_DATABASE_URL` sobre esa base. Al finalizar se eliminó únicamente esa base de validación. La base de operación `modulo3` y sus datos permanecieron intactos.

- Backend completo: **1214 pasan, 10 omitidas**; E2E completas: **157 pasan, 3 omitidas**. Las omisiones corresponden a las pruebas condicionadas a RabbitMQ, no a PostgreSQL.
- Regresiones del emisor 006: **9 pruebas del repositorio y 9 del flujo pasan**, incluido el orden de bloqueo compartido con 008. Las suites de integración de las demás features también pasaron en la ejecución completa con PostgreSQL.
- Frontend: **231 pruebas pasan en la suite completa**, más la regresión final de teclado: **56/56** entre facturas (25), temporadas (21) e IVA (10); **232 casos actuales verificados** entre ambas ejecuciones. Compilación backend y frontend: **PASS**, incluida la compilación final tras el ajuste del diálogo.

Para repetir, configurar `TEST_DATABASE_URL` hacia una base de pruebas separada y ya migrada. Desde la raíz del repositorio:

```powershell
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand
npm.cmd run build
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
```

Las pruebas que requieren RabbitMQ se ejecutan al proporcionar sus variables de prueba; no formaron parte de esta evidencia. El [TC-008](../4-testing/TC-008-gestionar-facturacion.md) describe la preparación funcional y el [benchmark](../4-testing/benchmark-facturas.sql) reproduce T035.

**QA en Chrome real.** Se verificó `/facturas` con Vite en `127.0.0.1:5182`, Nest en `127.0.0.1:3182` y la misma base aislada PostgreSQL. Con inicio de sesión real se comprobó una búsqueda de 25 facturas OTA (20 + 5 en la segunda página), detalle con `892500.01` y liquidación de origen, resumen con DIRECT y OTA histórica en cero, y búsqueda sin coincidencias. En escritorio de 1440 px y móvil de 390 px no hubo desbordamiento horizontal de la página ni errores de consola; el diálogo quedó dentro de ambas ventanas. Se guardaron cinco capturas y un informe local en `node_modules/.cache/qa-008/`; los datos de prueba se limpiaron al terminar (`fixturesCleaned: true`). La caché no es un artefacto versionado ni un requisito para repetir el caso. El TC-008 conserva además el procedimiento complementario de teclado.

---

## 5. Trazabilidad: requisito → código → prueba

| Requisito | Código | Prueba |
|---|---|---|
| FR-001, SC-001 (criterios de búsqueda) | `parseInvoiceSearch`, `conditionsOf` del adaptador | unitarias de criterios, integración «filtra por…», e2e HU1 |
| FR-002 (al menos un criterio) | `parseInvoiceSearch` → `MissingSearchCriteriaError` | unitarias, contrato 400 sin consultar la base |
| FR-003 (número oficial) | `InvoiceSearchItem.invoiceNumber` | contrato y e2e HU1 |
| FR-004, FR-005, BR-004, SC-003 (detalle tal como se emitió y trazable) | `findDetailById` (lista blanca), `toDetailDto` | integración «exactamente lo persistido», e2e HU2 |
| FR-006, BR-001, NFR-004, SC-004 (solo lectura) | puerto sin escrituras, `readOnlyTransaction`, solo `GET` | arquitectura, contrato `POST`/`PUT`/`PATCH`/`DELETE`, auditoría en integración y e2e |
| FR-007 (paginar sin omitir) | `LIMIT/OFFSET` + `count(*)` en `RepeatableRead`, `totalPages`; frontend conserva filtros y corte | unitarias, integración «totalItems cuenta todas» y commit entre página/conteo; pantalla conserva `asOf` |
| FR-008, SC-002 (sin coincidencias) | `resultStatus: NO_MATCHES` | unitarias, contrato, e2e reserva cancelada |
| FR-009, NFR-003 (sin datos migratorios ni personales del huésped) | lista blanca de columnas y DTO; el log no registra valores | contrato (campos prohibidos), integración, log |
| FR-010, BR-002, SC-005 (solo Administrador) | `JwtAuthGuard` + `RolesGuard` + `@Roles('Administrador')` | contrato 401/403 en las tres rutas, e2e OTA → 403 |
| FR-011, FR-012, SC-006 (resumen por canal sin mezclar) | `summarizeByChannel` (`groupBy channel, otaId`) | unitarias, integración «suma manual», e2e HU3 |
| FR-013, SC-007 (rango inválido) | `parseIssuedDateRange` | unitarias, contrato 400 en búsqueda y resumen |
| FR-014 (canal sin facturas en cero) | `listKnownOtaIds` + relleno con ceros en el servicio | unitarias, integración y e2e «OTA en cero» |
| BR-003 (reserva cancelada sin factura) | — (nunca hubo factura) | e2e «reserva cancelada» |
| NFR-002 (determinista) | orden `issued_at DESC, invoice_number DESC`; advisory `(8, 1)`, `clock_timestamp()` y `asOf` | integración «orden total», «sin repetidos ni saltos», emisión abierta y commit entre página/conteo; paginación frontend |
| NFR-006 (una zona horaria) | `issuedIntervalOf`, `BILLING_REPORTING_TZ` | unitarias de zona, integración «23:59 de Bogotá» |
| NFR-001, NFR-005 (rendimiento) | índices de la migración y CTE de OTA históricas | T035: [planes y mediciones de 1M de facturas](../4-testing/rendimiento.md) |

---

## 6. Estado de las tareas del plan

Las **43 tareas** están completas en el [plan](../2-technical/plan.md):

| Fase | Tareas | Qué quedó |
|---|---|---|
| 1–2 | T001–T009 | Configuración, errores, read models, puertos, adaptador, migración y wiring |
| 3 (HU1) | T010–T018 | Búsqueda |
| 4 (HU2) | T019–T024 | Detalle |
| 5 (HU3) | T025–T030 | Resumen por canal |
| 6 | T031–T037 | E2E, auditoría de solo lectura, métodos no permitidos, rendimiento, Swagger y log |
| 7 | T038–T043 | API frontend, validación, búsqueda/paginación, detalle/resumen, 48 pruebas y QA en navegador |

---

## 7. Decisiones de implementación

- **Validación en el dominio y no con un DTO de class-validator**, como en la 002: los parámetros pueden faltar, repetirse (llegan como arreglo) o venir vacíos, y el orden de los errores importa (formato → rango → falta de criterio). Los DTO solo documentan Swagger.
- **Un parámetro vacío o repetido es `INVALID_QUERY_PARAMS`**; `customerMatch` sin `customerName` no hace nada (la respuesta informa `customerMatchMode: null`).
- **Búsqueda con SQL parametrizado** (`$queryRaw` + `Prisma.sql`) en vez de `findMany`: el nombre se busca con `ILIKE … ESCAPE '!'` para que `%` y `_` sean texto y no comodines (el cliente de Prisma no los escapa). `EXACT` es `ILIKE` sin comodines, es decir el nombre completo sin distinguir mayúsculas; las dos formas usan el índice de trigramas.
- **Fechas como texto ISO convertidas a `timestamptz` en PostgreSQL**, para no depender de la zona horaria de la sesión.
- **`asOf` después de esperar emisiones pendientes**, usando una transacción de lectura `ReadCommitted` que toma `pg_advisory_xact_lock_shared(8, 1)` y después lee `date_trunc('milliseconds', clock_timestamp())`. La 006 toma ese advisory de forma exclusiva antes del contador y lo libera al commit. `now()` devolvería el inicio de la transacción, anterior a la espera. Página y conteo usan `RepeatableRead`; si el cliente reenvía un corte futuro o una fecha civil imposible, se rechaza.
- **Errores propios en `billing`**: `InvalidIssuedDateRangeError` usa el mismo `INVALID_DATE_RANGE` que la 005 pero con un mensaje de fechas de emisión; no se reutiliza el de `pricing`, cuyo mensaje habla de fechas de entrada y salida.
- **Puerto de entrada recibe `requestedBy`** (el `sub` del token) solo para el log de auditoría (T037); el servicio no lo usa.
- **`immutable: true` lo pone el controller**: toda factura de la 006 está en `ISSUED` y nunca cambia.
- **Lista de OTA conocidas con una CTE recursiva** que salta de una OTA a la siguiente por `idx_invoice_channel_issued_at`, evitando recorrer toda la tabla para descubrir los canales históricos. En el benchmark de 1M de facturas, devuelve las diez OTA en 0,238 ms mediante `Index Only Scan`.
- **`BILLING_REPORTING_TZ` es opcional** (por defecto `America/Bogota`) para no romper los `.env` existentes; una zona inválida detiene el arranque.
- **Sin índice nuevo sobre `stay_id`**: el `UNIQUE` de la 006 ya lo es.
- **Rendimiento (T035)**: verificado el 2026-11-09 con PostgreSQL 16.15 y una tabla temporal de **1 000 000 de facturas**, con los índices de 006/008 y `ANALYZE`. Búsqueda por reserva 0,077 ms; nombre parcial selectivo 3,527 ms; página canal/OTA/mes 0,092 ms y su conteo 4,690 ms; resumen mensual de 41 070 facturas 20,654 ms. Se confirmó uso de índices y `ROLLBACK`, sin alterar facturas reales ni el consecutivo. [Planes, tiempos y límites](../4-testing/rendimiento.md), [script reproducible](../4-testing/benchmark-facturas.sql). Son tiempos SQL de una ejecución, no un SLA HTTP ni una prueba de carga.
- **Frontend con estados independientes** para búsqueda, detalle y resumen: permite reintentar con los parámetros originales y descarta respuestas de consultas o sesiones anteriores. El tamaño de página reinicia la búsqueda aplicada; escribir otros filtros solo cambia el formulario hasta pulsar Buscar.
- **Importes formateados desde texto decimal**: la presentación de montos evita `Number`, para conservar exactamente los centavos incluso por encima del entero seguro de JavaScript. No recalcula la factura.

---

## 8. Dependencias con otras features

| Feature | Qué usa la 008 |
|---|---|
| 006 Generar factura final | Tabla `invoice` de solo lectura y advisory de publicación `(8, 1)`; el emisor lo adquiere antes del contador |
| 002 Consultar liquidación | `readOnlyTransaction`, extendido con aislamiento opcional y valor previo por defecto |
| 007 Generar liquidación | La liquidación de origen (`settlement_id`); solo se muestra su id |
| 010 Registrar check-out | Es quien emite las facturas en la operación real (vía 007 y 006) |
| 003 Consultar comisión OTA | No depende de la 008 |

---

## 9. Cómo mostrarlo funcionando

1. Generar facturas reales: seguir el [TC-010](../../010-registrar-checkout/4-testing/TC-010-registrar-checkout.md) (cotización con la 005, `publicar-checkout.js` y Módulo 2 simulado), o el [TC-006](../../006-generar-factura-final/4-testing/TC-006-generar-factura-final.md).
2. `POST /auth/login` con el usuario de `SEED_ADMIN_*` y autorizar en Swagger (<http://localhost:3000/docs>) o en Postman con `Authorization: Bearer <token>`.
3. `GET /invoices?reservationRef=<la reserva>` → copiar un `invoiceId`.
4. `GET /invoices/{invoiceId}` → detalle.
5. `GET /invoices/summary?issuedFrom=<hoy>&issuedTo=<hoy>` → resumen por canal.

El [TC-008](../4-testing/TC-008-gestionar-facturacion.md) documenta el recorrido desde la pantalla, casos HTTP y comprobaciones complementarias. La ejecución de Chrome registrada en la sección 4 cubre búsqueda, paginación, detalle, resumen y vistas de escritorio/móvil.

---

## 10. Frontend: Facturas emitidas

La pantalla **Facturas emitidas** está en `/facturas`, dentro de la sesión del Administrador. Permite combinar estancia, reserva, cliente fiscal, documento, canal/OTA y fechas de emisión. No consulta todo el histórico al entrar: exige al menos un criterio. Muestra los filtros aplicados y el modo de coincidencia; las páginas conservan el corte de la búsqueda. El detalle muestra los importes originales y la liquidación de origen en un diálogo de solo lectura. El resumen tiene un rango independiente y conserva DIRECT y cada OTA histórica con ceros cuando corresponda.

Para iniciar el entorno local:

1. Abrir **Docker Desktop** y esperar que el motor esté disponible. Desde la raíz del repositorio, con `.env` configurado, iniciar los servicios y esperar que estén saludables:

   ```powershell
   docker compose up -d --wait
   ```

2. Si es una instalación o base nueva, instalar las dependencias, generar Prisma, aplicar las migraciones y crear los usuarios del `.env`. En una base existente, aplicar las migraciones pendientes sin reiniciar los datos:

   ```powershell
   npm.cmd install
   npm.cmd run prisma:generate
   npm.cmd run prisma:migrate
   npm.cmd run prisma:seed
   ```

   El seed prepara usuarios; no sustituye el flujo que emite facturas. Para datos de demostración, seguir [TC-010](../../010-registrar-checkout/4-testing/TC-010-registrar-checkout.md) o [TC-006](../../006-generar-factura-final/4-testing/TC-006-generar-factura-final.md).

3. Iniciar el backend desde la raíz y dejar la terminal abierta:

   ```powershell
   npm.cmd run start:dev
   ```

4. Abrir otra terminal e iniciar el frontend:

   ```powershell
   Set-Location frontend
   npm.cmd install
   npm.cmd run dev
   ```

5. Abrir <http://localhost:5173/facturas> e iniciar sesión con `SEED_ADMIN_USERNAME` y `SEED_ADMIN_PASSWORD` del `.env` del backend. Swagger queda en <http://localhost:3000/docs>.

Vite redirige `/api/*` a Nest en `http://localhost:3000`, quitando `/api`; el navegador usa un solo origen. Si Nest usa otro puerto, configurar `BACKEND_URL` antes de iniciar Vite. La QA registrada usó puertos aislados 3182/5182; los puertos locales por defecto siguen siendo 3000/5173.

La validación con Testing Library cubre también Tab, Shift+Tab, Escape y devolución del foco desde el diálogo. La evidencia de Chrome corresponde al recorrido funcional y a escritorio/móvil descritos en la sección 4; no sustituye todos los pasos complementarios del TC-008.
