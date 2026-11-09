# Implementación: Gestionar facturación (008)

**Spec**: [gestionar_facturacion.md](../1-functional/gestionar_facturacion.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contratos**: [GET-invoices.md](../2-technical/contracts/GET-invoices.md), [GET-invoices-id.md](../2-technical/contracts/GET-invoices-id.md) y [GET-invoices-summary.md](../2-technical/contracts/GET-invoices-summary.md) (REST)
**Rama**: `feature/008-gestionar-facturacion`

Este documento es el mapa de dónde está el código de la 008. El código no vive en esta carpeta: sigue la arquitectura hexagonal del plan base, así que está repartido por capas en `src/` y `test/`, siempre dentro de una subcarpeta `billing/` (el mismo bounded context de la 001 y la 006).

> Para encontrar todos los archivos de la 008 en VS Code: `Ctrl+Shift+F` y buscar `Feature 008`.

**Alcance**: las 3 Historias de usuario. Todo el plan está hecho (37 de 37 tareas).

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

**Paginación con foto (`asOf`)**: la primera página fija `asOf` con la hora de la base de datos y lo devuelve. Para las páginas siguientes el cliente reenvía ese `asOf`: las facturas emitidas mientras se navega no entran, así que no hay repetidos ni saltos entre páginas.

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
          │            currentTime() (SELECT now()); asOf futuro                            → 400 INVALID_QUERY_PARAMS
          │            rango → instantes en America/Bogota
          │            PrismaInvoiceQueryAdapter.search (READ ONLY): página + count(*)
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
| [invoice-search-criteria.ts](../../../src/domain/model/billing/invoice-search-criteria.ts) | `parseInvoiceSearch` (criterios, página, `asOf`), `parseInvoiceSummaryRange` y `parseInvoiceId`: validan los parámetros tal como llegan | FR-001, FR-002, FR-007, FR-013 |
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
| [prisma-invoice-query.adapter.ts](../../../src/infrastructure/adapters/out/persistence/repositories/billing/prisma-invoice-query.adapter.ts) | Las lecturas de `invoice`, cada una en una transacción `READ ONLY` (helper de la 002) |
| [logged-manage-invoices.use-case.ts](../../../src/infrastructure/logging/billing/logged-manage-invoices.use-case.ts) | Log de cada consulta: quién, qué criterios (sin sus valores), cuántos resultados o el `errorCode`, y la duración |

### Archivos compartidos que tocó la 008

| Archivo | Cambio |
|---|---|
| [domain-exception.filter.ts](../../../src/infrastructure/adapters/in/http/domain-exception.filter.ts) | Dos líneas: `MISSING_SEARCH_CRITERIA: 400` e `INVOICE_NOT_FOUND: 404` (`INVALID_DATE_RANGE` e `INVALID_QUERY_PARAMS` ya estaban) |
| [billing.module.ts](../../../src/infrastructure/config/billing.module.ts) | Registra el controller, el adaptador y el servicio envuelto en el log; lee `BILLING_REPORTING_TZ` |
| [schema.prisma](../../../prisma/schema.prisma) | Cuatro `@@index` en el modelo `Invoice` |
| [.env.example](../../../.env.example) y [README.md](../../../README.md) | `BILLING_REPORTING_TZ` y la fila de la 008 |

Se reutilizan sin cambios: de la 002, `readOnlyTransaction`; de la base, `JwtAuthGuard`, `RolesGuard`, `@Roles`, `@CurrentUser` y `ChannelKind`.

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

---

## 4. Pruebas

Contadas con `jest --json` el 2026-11-07: **151 pruebas de la 008**, todas pasan.

| Archivo | Tipo | Pruebas | Qué verifica |
|---|---|---:|---|
| [invoice-search-criteria.spec.ts](../../../test/unit/domain/billing/invoice-search-criteria.spec.ts) | Unitaria | 53 | Al menos un criterio, rango, formato de cada parámetro, `EXACT`/`PARTIAL`, repetidos y vacíos |
| [issued-date-range.spec.ts](../../../test/unit/domain/billing/issued-date-range.spec.ts) | Unitaria | 6 | Conversión a Bogotá, borde del día, bisiesto, otra zona con cambio de horario |
| [manage-invoices.service.spec.ts](../../../test/unit/application/billing/manage-invoices.service.spec.ts) | Unitaria | 22 | HU1 (`NO_MATCHES`, paginación, `asOf`), HU2 (404, 400) y HU3 (ceros, orden, sin mezcla) |
| [logged-manage-invoices.use-case.spec.ts](../../../test/unit/infrastructure/billing/logged-manage-invoices.use-case.spec.ts) | Unitaria | 4 | El log no lleva nombre ni documento del cliente |
| [manage-invoices-dependencies.spec.ts](../../../test/architecture/manage-invoices-dependencies.spec.ts) | Arquitectura | 5 | 008 no usa el lado de escritura de 006/007; el adaptador solo lee; el controller solo tiene `GET` |
| [invoices-admin.contract.spec.ts](../../../test/contract/billing/invoices-admin.contract.spec.ts) | Contrato | 34 | Forma exacta de las tres respuestas y cada error de los contratos; 401/403; `POST`/`PUT`/`PATCH`/`DELETE` → 404 |
| [prisma-invoice-query.adapter.spec.ts](../../../test/integration/persistence/billing/prisma-invoice-query.adapter.spec.ts) | Integración (PostgreSQL) | 18 | Cada filtro, `%` y `_` literales, borde del día en Bogotá, orden estable, paginación con `asOf`, totales = suma manual, auditoría de solo lectura |
| [gestionar-facturacion.e2e-spec.ts](../../../test/e2e/billing/gestionar-facturacion.e2e-spec.ts) | E2E (PostgreSQL) | 9 | Check-out → liquidación (007) → factura (006) → búsqueda, detalle y resumen por HTTP; reserva cancelada sin resultados |

**Cómo se corrieron.** En el equipo de desarrollo no se pudo instalar Docker. Las pruebas con base de datos se corrieron contra PGlite: el motor de PostgreSQL 17 compilado a WebAssembly, con las extensiones `pg_trgm` y `btree_gist`, levantado solo para verificar y fuera del repositorio. Sobre él se aplicaron las 8 migraciones desde cero.

- Sin base de datos: `npm test`, 1061 pasan y 139 se omiten (las que necesitan `TEST_DATABASE_URL` o RabbitMQ). `npm run test:e2e`, 145 pasan y 12 se omiten.
- Con base de datos: las 18 de integración y las 9 E2E de la 008 pasan.
- Con PGlite, 4 suites de otras features fallan al correr la carpeta `test/integration` completa: `settlement-query-consistency` (002), `prisma-season-calendar.repository` (011), `prisma-season-rule.repository` (009) y `generate-final-invoice.flow` (006). Dos de ellas pasan corridas solas. Las otras dos prueban concurrencia (transacciones sin confirmar y esperas de bloqueo), algo que PGlite no soporta porque todas las conexiones comparten una sola sesión. No dependen de nada de la 008, pero **falta confirmarlas con el PostgreSQL de Docker**.

---

## 5. Trazabilidad: requisito → código → prueba

| Requisito | Código | Prueba |
|---|---|---|
| FR-001, SC-001 (criterios de búsqueda) | `parseInvoiceSearch`, `conditionsOf` del adaptador | unitarias de criterios, integración «filtra por…», e2e HU1 |
| FR-002 (al menos un criterio) | `parseInvoiceSearch` → `MissingSearchCriteriaError` | unitarias, contrato 400 sin consultar la base |
| FR-003 (número oficial) | `InvoiceSearchItem.invoiceNumber` | contrato y e2e HU1 |
| FR-004, FR-005, BR-004, SC-003 (detalle tal como se emitió y trazable) | `findDetailById` (lista blanca), `toDetailDto` | integración «exactamente lo persistido», e2e HU2 |
| FR-006, BR-001, NFR-004, SC-004 (solo lectura) | puerto sin escrituras, `readOnlyTransaction`, solo `GET` | arquitectura, contrato `POST`/`PUT`/`PATCH`/`DELETE`, auditoría en integración y e2e |
| FR-007 (paginar sin omitir) | `LIMIT/OFFSET` + `count(*)`, `totalPages` | unitarias, integración «totalItems cuenta todas» |
| FR-008, SC-002 (sin coincidencias) | `resultStatus: NO_MATCHES` | unitarias, contrato, e2e reserva cancelada |
| FR-009, NFR-003 (sin datos migratorios ni personales del huésped) | lista blanca de columnas y DTO; el log no registra valores | contrato (campos prohibidos), integración, log |
| FR-010, BR-002, SC-005 (solo Administrador) | `JwtAuthGuard` + `RolesGuard` + `@Roles('Administrador')` | contrato 401/403 en las tres rutas, e2e OTA → 403 |
| FR-011, FR-012, SC-006 (resumen por canal sin mezclar) | `summarizeByChannel` (`groupBy channel, otaId`) | unitarias, integración «suma manual», e2e HU3 |
| FR-013, SC-007 (rango inválido) | `parseIssuedDateRange` | unitarias, contrato 400 en búsqueda y resumen |
| FR-014 (canal sin facturas en cero) | `listKnownOtaIds` + relleno con ceros en el servicio | unitarias, integración y e2e «OTA en cero» |
| BR-003 (reserva cancelada sin factura) | — (nunca hubo factura) | e2e «reserva cancelada» |
| NFR-002 (determinista) | orden `issued_at DESC, invoice_number DESC`; `asOf` | integración «orden total» y «sin repetidos ni saltos» |
| NFR-006 (una zona horaria) | `issuedIntervalOf`, `BILLING_REPORTING_TZ` | unitarias de zona, integración «23:59 de Bogotá» |
| NFR-001, NFR-005 (rendimiento) | índices de la migración | T035, sección 7 |

---

## 6. Estado de las tareas del plan

Las 37 tareas están marcadas en el [plan](../2-technical/plan.md):

| Fase | Tareas | Qué quedó |
|---|---|---|
| 1–2 | T001–T009 | Configuración, errores, read models, puertos, adaptador, migración y wiring |
| 3 (HU1) | T010–T018 | Búsqueda |
| 4 (HU2) | T019–T024 | Detalle |
| 5 (HU3) | T025–T030 | Resumen por canal |
| 6 | T031–T037 | E2E, auditoría de solo lectura, métodos no permitidos, rendimiento, Swagger y log |

---

## 7. Decisiones de implementación

- **Validación en el dominio y no con un DTO de class-validator**, como en la 002: los parámetros pueden faltar, repetirse (llegan como arreglo) o venir vacíos, y el orden de los errores importa (formato → rango → falta de criterio). Los DTO solo documentan Swagger.
- **Un parámetro vacío o repetido es `INVALID_QUERY_PARAMS`**; `customerMatch` sin `customerName` no hace nada (la respuesta informa `customerMatchMode: null`).
- **Búsqueda con SQL parametrizado** (`$queryRaw` + `Prisma.sql`) en vez de `findMany`: el nombre se busca con `ILIKE … ESCAPE '!'` para que `%` y `_` sean texto y no comodines (el cliente de Prisma no los escapa). `EXACT` es `ILIKE` sin comodines, es decir el nombre completo sin distinguir mayúsculas; las dos formas usan el índice de trigramas.
- **Fechas como texto ISO convertidas a `timestamptz` en PostgreSQL**, para no depender de la zona horaria de la sesión.
- **`asOf` con la hora de la base de datos** (`SELECT now()`), el mismo reloj que `issued_at`; si el cliente reenvía un `asOf` futuro respecto de ella, se rechaza.
- **Errores propios en `billing`**: `InvalidIssuedDateRangeError` usa el mismo `INVALID_DATE_RANGE` que la 005 pero con un mensaje de fechas de emisión; no se reutiliza el de `pricing`, cuyo mensaje habla de fechas de entrada y salida.
- **Puerto de entrada recibe `requestedBy`** (el `sub` del token) solo para el log de auditoría (T037); el servicio no lo usa.
- **`immutable: true` lo pone el controller**: toda factura de la 006 está en `ISSUED` y nunca cambia.
- **Lista de OTA conocidas con una CTE recursiva** que salta de una OTA a la siguiente por `idx_invoice_channel_issued_at`. Con `GROUP BY ota_id` (o el `distinct` de Prisma) se recorría la tabla completa: 137 ms con 100 000 facturas. Con la CTE solo se lee una entrada por OTA.
- **`BILLING_REPORTING_TZ` es opcional** (por defecto `America/Bogota`) para no romper los `.env` existentes; una zona inválida detiene el arranque.
- **Sin índice nuevo sobre `stay_id`**: el `UNIQUE` de la 006 ya lo es.
- **Rendimiento (T035)**: PENDIENTE_T035

---

## 8. Dependencias con otras features

| Feature | Qué usa la 008 |
|---|---|
| 006 Generar factura final | La tabla `invoice` (solo lectura), con `stay_id`, `reservation_ref`, `channel` y `ota_id` copiados de la liquidación |
| 002 Consultar liquidación | `readOnlyTransaction` |
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

El caso de prueba de la 008 (`4-testing/`) queda a cargo del equipo de pruebas.
