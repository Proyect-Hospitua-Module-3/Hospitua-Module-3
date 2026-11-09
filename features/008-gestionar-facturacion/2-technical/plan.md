# Implementation Plan: Gestionar facturación

**Date**: 2026-10-01 (alineado al plan técnico base el 2026-10-07; ajustado a la implementación el 2026-11-07)
**Spec**: [gestionar_facturacion.md](../1-functional/gestionar_facturacion.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)

## Summary

`Gestionar facturación` permite al **Administrador** buscar facturas fiscales definitivas (emitidas por `Generar factura final`, feature 006), abrir su detalle trazable y obtener un resumen consolidado por canal de origen dentro de un rango de fechas. Es una funcionalidad **exclusivamente de lectura** (BR-001, FR-006).

Enfoque técnico: se implementa dentro del *bounded context* `billing` como el caso de uso `ManageInvoicesUseCase` (lado de lectura) sobre la misma tabla `invoice` que persiste la feature 006, sin tabla ni fuente de datos propia (BR-005). Se exponen tres endpoints REST `GET` protegidos con JWT de usuario y `@Roles('Administrador')`. La lectura pasa por un puerto de salida dedicado `InvoiceQueryPort` (separado del repositorio de escritura de 006), implementado con Prisma dentro de transacciones `READ ONLY`, de forma que ningún camino de código de esta feature pueda alterar una factura o liquidación (NFR-004). Los importes del detalle y del resumen se leen tal como fueron persistidos; nunca se recalculan (BR-004).

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS (según proyecto base)
**Primary Dependencies**: NestJS 10.x, Prisma ORM, Passport-JWT + Guards por rol (según proyecto base). Los query params se validan en el dominio y no con `class-validator`, como en 002: pueden faltar, repetirse o llegar vacíos
**Storage**: PostgreSQL 16 — lectura solo sobre `invoice` (creada por feature 006, con `stay_id`, `reservation_ref`, `channel` y `ota_id` copiados de la liquidación). Esta feature solo agrega índices y la extensión `pg_trgm` para búsqueda parcial por nombre de cliente, mediante una migración de Prisma Migrate
**Testing**: Jest (unitarias y de arquitectura), Jest contra un PostgreSQL ya migrado en `TEST_DATABASE_URL` (integración y e2e, igual que el resto del proyecto; sin la variable se omiten), Supertest (e2e y contrato HTTP)
**Target Platform**: Servicio backend Linux en contenedor Docker
**Project Type**: Servicio backend único (monolito modular hexagonal) — sin frontend en este repositorio
**Performance Goals**: sin objetivo numérico (NFR-001 y NFR-005 solo exigen "tiempo adecuado" y "sin degradación perceptible"); el rendimiento se mide con `EXPLAIN ANALYZE` sobre un volumen sembrado y se confirma el uso de índices (T035)
**Constraints**: solo lectura (NFR-004); resultados deterministas con orden total estable (NFR-002); una única zona horaria de referencia `America/Bogota` para filtros y agregados (NFR-006); no exponer datos migratorios ni datos personales no financieros (FR-009, NFR-003); acceso solo para `Administrador` (FR-010)
**Scale/Scope**: 3 historias de usuario, 3 endpoints `GET`, 1 caso de uso con 3 operaciones, 1 migración de índices

## Project Structure

### Documentation (this feature)

```text
features/008-gestionar-facturacion/
├── 1-functional/
│   └── gestionar_facturacion.md   # Spec funcional (fuente de verdad de negocio)
└── 2-technical/
    ├── plan.md                    # Este archivo
    └── contracts/                 # Contratos REST detallados (petición, reglas, respuesta, errores)
        ├── GET-invoices.md            # HU1 Buscar facturas
        ├── GET-invoices-id.md         # HU2 Detalle de factura
        └── GET-invoices-summary.md    # HU3 Resumen por canal
```

### Source Code (repository root)

Solo se listan los archivos que esta feature crea o modifica dentro de la estructura por capas del proyecto base (una sola `domain/`, `application/` e `infrastructure/`, con `billing` como subcarpeta). El mapa completo, con qué hace cada archivo, está en [3-implementation/implementacion.md](../3-implementation/implementacion.md).

```text
src/
├── domain/
│   ├── model/
│   │   ├── shared/
│   │   │   └── channel.vo.ts                      # (reutilizado) ChannelKind: DIRECT | OTA
│   │   └── billing/
│   │       ├── invoice-search-criteria.ts         # parseInvoiceSearch (exige >= 1 criterio), parseInvoiceSummaryRange, parseInvoiceId
│   │       ├── issued-date-range.ts               # Rango de emisión y conversión a America/Bogota
│   │       ├── customer-match-mode.ts             # EXACT | PARTIAL
│   │       └── invoice-read-models.ts             # InvoiceSearchItem, InvoiceDetail, ChannelTotals, …
│   ├── errors/billing/
│   │   ├── missing-search-criteria.error.ts       # MISSING_SEARCH_CRITERIA
│   │   ├── invalid-issued-date-range.error.ts     # INVALID_DATE_RANGE (mensaje de fechas de emisión)
│   │   ├── invalid-invoice-query.error.ts         # INVALID_QUERY_PARAMS
│   │   └── invoice-not-found.error.ts             # INVOICE_NOT_FOUND
│   └── ports/
│       ├── in/billing/
│       │   └── manage-invoices.use-case.ts        # ManageInvoicesUseCase: search, getDetail, summarizeByChannel
│       └── out/billing/
│           └── invoice-query.port.ts              # InvoiceQueryPort (solo métodos de consulta)
│
├── application/services/billing/
│   └── manage-invoices.service.ts                 # Implementa ManageInvoicesUseCase (HU1, HU2, HU3)
│
└── infrastructure/
    ├── adapters/
    │   ├── in/http/
    │   │   ├── billing/
    │   │   │   ├── invoices-admin.controller.ts   # GET /invoices, /invoices/summary, /invoices/{id}
    │   │   │   └── dto/invoices.dto.ts            # Parámetros y respuestas para Swagger
    │   │   └── domain-exception.filter.ts         # (modificado) MISSING_SEARCH_CRITERIA 400, INVOICE_NOT_FOUND 404
    │   └── out/persistence/repositories/billing/
    │       └── prisma-invoice-query.adapter.ts    # Implementa InvoiceQueryPort (READ ONLY)
    ├── logging/billing/
    │   └── logged-manage-invoices.use-case.ts     # Log estructurado de cada consulta (T037)
    └── config/
        └── billing.module.ts                      # (modificado) controller, servicio, puerto y BILLING_REPORTING_TZ

prisma/
├── schema.prisma                                  # (modificado) índices de invoice con @@index
└── migrations/
    └── 20261107000000_invoice_search_indexes/
        └── migration.sql                          # Índices B-tree + pg_trgm y el índice GIN (SQL manual)

test/
├── unit/
│   ├── domain/billing/
│   │   ├── invoice-search-criteria.spec.ts
│   │   └── issued-date-range.spec.ts
│   ├── application/billing/
│   │   └── manage-invoices.service.spec.ts
│   └── infrastructure/billing/
│       └── logged-manage-invoices.use-case.spec.ts
├── architecture/
│   └── manage-invoices-dependencies.spec.ts
├── contract/billing/
│   └── invoices-admin.contract.spec.ts
├── integration/persistence/billing/
│   └── prisma-invoice-query.adapter.spec.ts
├── e2e/billing/
│   └── gestionar-facturacion.e2e-spec.ts
└── support/billing/
    └── in-memory-invoice-query.ts                 # Doble en memoria de InvoiceQueryPort
```

**Structure Decision**: se usa la estructura por capas del proyecto base, con `billing` como subcarpeta de cada capa. El puerto de entrada es `ManageInvoicesUseCase` (`domain/ports/in/billing/manage-invoices.use-case.ts`), implementado por `ManageInvoicesService`, tal como lo lista el plan base. La lectura usa un puerto de salida propio `InvoiceQueryPort` en lugar de reutilizar el `InvoiceIssuanceRepositoryPort` de la feature 006: así el lado de consulta no tiene acceso a métodos de escritura, lo que hace estructuralmente imposible violar BR-001/FR-006 desde esta feature. Una prueba de arquitectura lo verifica.

## Diseño técnico

### Endpoints (adaptadores de entrada)

Todos con `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('Administrador')` a nivel de controller (ver *Autorización por rol* del plan base). Sin token o con token inválido → `401`; con JWT de otro rol (p. ej. `OTA`) → `403` (FR-010, SC-005). Estos endpoints no aceptan llamadas internas sin token de Módulo 1 o Módulo 2.

| Método y ruta | Query / params | Respuesta | HU / FR |
|---|---|---|---|
| `GET /invoices` | `stayId?`, `reservationRef?`, `customerName?`, `customerMatch?=EXACT\|PARTIAL` (default `EXACT`), `customerTaxId?`, `channel?=DIRECT\|OTA`, `otaId?`, `issuedFrom?`, `issuedTo?` (`YYYY-MM-DD`), `page?=1`, `pageSize?=20` (máx. 100), `asOf?` (ISO 8601; si no llega, se fija a la hora actual) | `200` con `{ items[], page, pageSize, totalItems, totalPages, asOf, resultStatus: "MATCHES"\|"NO_MATCHES", customerMatchMode }` | HU1 — FR-001, 002, 003, 007, 008, 013 |
| `GET /invoices/summary` | `issuedFrom`, `issuedTo` (obligatorios) | `200` con `{ range, timezone, currency, channels: [{ channel, otaId?, invoiceCount, totalLodging, totalOtaCommission, totalVat, totalInvoiced }] }` | HU3 — FR-011, 012, 013, 014 |
| `GET /invoices/{invoiceId}` | `invoiceId` (UUID) | `200` con detalle completo; `404` si no existe | HU2 — FR-004, 005 |

- El contrato completo de cada endpoint (headers, parámetros, reglas de procesamiento, campos de respuesta con ejemplos JSON y tabla de errores) está en [`contracts/`](contracts/): [GET-invoices.md](contracts/GET-invoices.md), [GET-invoices-id.md](contracts/GET-invoices-id.md) y [GET-invoices-summary.md](contracts/GET-invoices-summary.md).
- La ruta `/invoices/summary` se declara antes de `/invoices/:invoiceId` en el controller para que no sea capturada como id.
- No se declaran `POST`, `PUT`, `PATCH` ni `DELETE` sobre `/invoices*`; Nest devuelve `404`/`405` y una prueba de contrato lo verifica (FR-006, caso límite de modificación).

### Reglas de validación (dominio)

- `parseInvoiceSearch(...)` lanza `MissingSearchCriteriaError` si no llega ninguno de: `stayId`, `reservationRef`, `customerName`, `customerTaxId`, `channel`, rango de fechas (FR-002). `page`/`pageSize`/`asOf` no cuentan como criterio. `asOf` no puede ser futuro.
- Rango de fechas: si llega solo uno de `issuedFrom`/`issuedTo` o `issuedFrom > issuedTo` → `InvalidIssuedDateRangeError` (`INVALID_DATE_RANGE`, FR-013, SC-007). Se valida en `parseIssuedDateRange` (`issued-date-range.ts`) antes de tocar la base de datos, así nunca hay resultado parcial. No se reutiliza el `InvalidDateRangeError` de 005: su mensaje habla de fechas de entrada y salida.
- `otaId` solo es válido con `channel=OTA`.
- No se expone filtro por estado: aunque el título de HU1 menciona "estado", ningún FR lo define como criterio (FR-001) y toda factura emitida por 006 tiene un único estado, `Emitida` (inmutable, BR-003 de `generar_factura_final.md`). El estado sí se muestra en el detalle (`status: "ISSUED"`).
- `customerName` con `customerMatch=PARTIAL` requiere al menos 3 caracteres. La respuesta siempre informa el `customerMatchMode` aplicado (caso límite de coincidencia parcial).
- Errores mapeados en el `ExceptionFilter` global del plan base (`infrastructure/adapters/in/http/domain-exception.filter.ts`), con el formato `ApiError`: `MissingSearchCriteriaError` → 400 `MISSING_SEARCH_CRITERIA`, `InvalidIssuedDateRangeError` → 400 `INVALID_DATE_RANGE`, `InvoiceNotFoundError` → 404 `INVOICE_NOT_FOUND`, todos con mensaje específico (no genérico). Los contratos usan además `INVALID_QUERY_PARAMS` (`InvalidInvoiceQueryError`, 400, parámetro repetido o vacío, formato inválido de UUID, fecha, `pageSize`, `asOf` futuro, `otaId` sin `channel=OTA` o `PARTIAL` con menos de 3 caracteres), `UNAUTHENTICATED` (401) y `FORBIDDEN` (403). No se documenta ningún 5xx; un fallo inesperado, como una caída de la base de datos, lo captura el `ExceptionFilter` global y responde 422 `UNEXPECTED_ERROR` (plan base).

### Puertos

```ts
// src/domain/ports/in/billing/manage-invoices.use-case.ts
// Los parámetros llegan tal como vienen en la query; el servicio los valida.
// requestedBy (sub del token) solo se usa en el log de cada consulta (T037).
export interface ManageInvoicesUseCase {
  search(query: InvoiceSearchQuery, requestedBy: string): Promise<InvoiceSearchResult>;
  getDetail(invoiceId: unknown, requestedBy: string): Promise<InvoiceDetail>; // lanza InvoiceNotFoundError
  summarizeByChannel(query: InvoiceSummaryQuery, requestedBy: string): Promise<InvoiceChannelSummary>;
}
export const MANAGE_INVOICES_USE_CASE = Symbol('ManageInvoicesUseCase');

// src/domain/ports/out/billing/invoice-query.port.ts
export interface InvoiceQueryPort {
  currentTime(): Promise<Date>; // SELECT now(): fija asOf con el reloj de la base de datos
  search(filter: InvoiceSearchFilter, page: InvoicePageRequest): Promise<InvoiceSearchPage>;
  findDetailById(invoiceId: string): Promise<InvoiceDetail | null>;
  summarizeByChannel(interval: IssuedInterval): Promise<ChannelTotals[]>;
  listKnownOtaIds(): Promise<string[]>; // OTA con al menos una factura histórica
}
export const INVOICE_QUERY = Symbol('InvoiceQueryPort');
```

### Adaptador Prisma (salida)

- Cada método se ejecuta en una transacción interactiva de Prisma (`prisma.$transaction(async (tx) => ...)`) cuya primera sentencia es `SET TRANSACTION READ ONLY` (NFR-004): aunque hubiera un error de programación, Postgres rechazaría cualquier escritura.
- **Búsqueda**: SQL parametrizado (`tx.$queryRaw` con `Prisma.sql`) sobre la tabla `invoice` únicamente, porque el filtro de nombre necesita `ILIKE … ESCAPE` y el cliente de Prisma no escapa `%` ni `_`; sin relación con `settlement`. Para eso la feature 006 copia en `invoice`, al emitirla, `stay_id`, `reservation_ref`, `channel` y `ota_id` de la liquidación de origen; no hay riesgo de inconsistencia porque la liquidación es `Final` y la factura es inmutable (BR-003 de `generar_factura_final.md`). Orden total determinista `ORDER BY issued_at DESC, invoice_number DESC` (NFR-002).
- **Paginación con foto (`asOf`)**: paginación por `LIMIT/OFFSET` + `count(*)` con el mismo filtro para devolver `totalItems` y `totalPages` (FR-007). Para que las facturas emitidas mientras el Administrador navega no desplacen las páginas (repetidos o saltos), toda búsqueda agrega `issuedAt <= asOf`. En la primera petición el sistema fija `asOf` con la hora actual de la base de datos (`SELECT now()`) y lo devuelve en la respuesta; el cliente lo reenvía al pedir las páginas siguientes. Así la misma búsqueda con el mismo `asOf` devuelve siempre el mismo conjunto y el mismo orden (NFR-002).
- **Coincidencia de cliente**: `EXACT` → `customer_name ILIKE <nombre>`; `PARTIAL` → `customer_name ILIKE '%<texto>%'`; en los dos casos con `ESCAPE '!'` y el texto escapado, para que `%` y `_` se busquen como texto y no como comodines. Las dos formas usan el índice GIN `pg_trgm`. `customerTaxId` siempre exacto.
- **Detalle**: `select` explícito de columnas (lista blanca), nunca el modelo completo: número oficial, `issued_at`, `settlement_id`, `stay_id`, `reservation_ref`, canal/OTA, cliente (nombre/razón social y documento fiscal), `lodging_amount`, `ota_commission_amount`, `net_income`, `vat_rate_applied`, `vat_amount`, `total_amount`, `status = ISSUED`. No hay campos migratorios (FR-009); los importes son los persistidos por 006 (BR-004, SC-003).
- **Resumen**: `tx.invoice.groupBy({ by: ['channel', 'otaId'], _count, _sum })` filtrado por rango. Luego, en `ManageInvoicesService`, se completa con ceros cada canal conocido que no tuvo facturas en el rango (FR-014). Canales conocidos = Directo (siempre) + toda OTA con al menos una factura histórica en `invoice`, leídas con una CTE recursiva que salta de una OTA a la siguiente por `idx_invoice_channel_issued_at` (el `distinct` de Prisma y un `GROUP BY` recorren la tabla completa; medido en T035). No se consulta el catálogo de OTA a Módulo 2 ni se mantiene un catálogo propio; una OTA sin ninguna factura aún no aparece en el resumen hasta su primera factura. Cada canal se agrega por separado, nunca se mezclan importes (FR-012).
- Las filas se convierten a los read models de dominio dentro del adaptador (importes con `toFixed(2)`); el dominio nunca ve tipos de Prisma.

### Zona horaria (NFR-006)

`issued_at` es `timestamptz`. Las fechas de filtro (`YYYY-MM-DD`) se interpretan en `America/Bogota` y se convierten al intervalo semiabierto `[issuedFrom 00:00, issuedTo + 1 día 00:00)` en esa zona, tanto en búsqueda como en resumen. La zona se define en configuración (`BILLING_REPORTING_TZ`, opcional: por defecto `America/Bogota`; una zona IANA inválida detiene el arranque) y se devuelve en la respuesta del resumen.

### Migración de índices (Prisma Migrate)

Sobre la tabla `invoice` creada por la feature 006. Los índices B-tree se declaran con `@@index` en el modelo `Invoice` de `prisma/schema.prisma`; el SQL se genera con `prisma migrate diff` (como las migraciones anteriores) y la extensión `pg_trgm` y el índice GIN se agregan a mano en la sección "SQL manual" de `20261107000000_invoice_search_indexes/migration.sql`:

- `CREATE EXTENSION IF NOT EXISTS pg_trgm` (SQL manual)
- `idx_invoice_issued_at (issued_at DESC, invoice_number DESC)`
- `idx_invoice_channel_issued_at (channel, ota_id, issued_at)`
- `idx_invoice_customer_tax_id (customer_tax_id)`
- `idx_invoice_customer_name_trgm USING GIN (customer_name gin_trgm_ops)` (SQL manual)
- `stay_id` no lleva índice nuevo: ya tiene el `UNIQUE` `invoice_stay_id_key` de 006
- `idx_invoice_reservation_ref (reservation_ref)`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verificar que la base del proyecto y la feature 006 están disponibles

- [x] T001 Confirmar que el proyecto base (Fases 1 y 2 de `docs/plan-tecnico-base.md`) está completo: VOs compartidos en `src/domain/model/shared/` (`DateRange`, `Channel`, `Money`), `PrismaService`, login propio con JWT de usuario y Guards por rol (`@Roles`), y `ExceptionFilter` global
- [x] T002 Confirmar que la feature 006 (`Generar factura final`) ya persiste la tabla `invoice` (modelo `Invoice` en `prisma/schema.prisma`) con las columnas requeridas, incluidas `stay_id`, `reservation_ref`, `channel` y `ota_id`; si el plan técnico de 006 aún no las incluye, acordarlo con su responsable antes de seguir
- [x] T003 Agregar variable de configuración `BILLING_REPORTING_TZ=America/Bogota` en `.env.example` y leerla en `billing.module.ts` (opcional, con `America/Bogota` por defecto; una zona inválida detiene el arranque)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Piezas compartidas por las tres historias

**⚠️ CRITICAL**: Ninguna historia puede empezar hasta completar esta fase

- [x] T004 [P] Crear errores de dominio `MissingSearchCriteriaError`, `InvalidIssuedDateRangeError`, `InvalidInvoiceQueryError` e `InvoiceNotFoundError` en `src/domain/errors/billing/` y registrarlos en el `ExceptionFilter` global con su código HTTP y `errorCode`
- [x] T005 [P] Crear read models `InvoiceSearchItem`, `InvoiceDetail`, `ChannelTotals` en `src/domain/model/billing/invoice-read-models.ts`
- [x] T006 Definir el puerto de entrada `ManageInvoicesUseCase` en `src/domain/ports/in/billing/manage-invoices.use-case.ts` y el puerto de salida `InvoiceQueryPort` con el token `INVOICE_QUERY` en `src/domain/ports/out/billing/invoice-query.port.ts` (depende de T005)
- [x] T007 Crear esqueleto de `PrismaInvoiceQueryAdapter` en `src/infrastructure/adapters/out/persistence/repositories/billing/prisma-invoice-query.adapter.ts`, con el helper de transacción `READ ONLY` de 002 (`repositories/settlement/read-only-transaction.ts`)
- [x] T008 Crear la migración `20261107000000_invoice_search_indexes` con `prisma migrate diff`: `@@index` en `schema.prisma` y SQL manual para `pg_trgm` y el índice GIN
- [x] T009 Crear `InvoicesAdminController` vacío con `@Roles('Administrador')` a nivel de clase y registrar controller, `ManageInvoicesService` y el binding `INVOICE_QUERY → PrismaInvoiceQueryAdapter` en `src/infrastructure/config/billing.module.ts`

**Checkpoint**: Fundación lista — las historias pueden implementarse en paralelo

---

## Phase 3: User Story 1 - Buscar facturas por estancia, cliente, canal o fecha (Priority: P1)

**Goal**: El Administrador localiza facturas por uno o varios criterios, con resultados paginados, deterministas y con número oficial

**Independent Test**: Sembrar facturas de canal directo y de dos OTA en fechas distintas y verificar que cada criterio individual y la combinación rango + canal devuelven exactamente las facturas esperadas; una búsqueda sin coincidencias devuelve `200` con `resultStatus: "NO_MATCHES"`

### Tests for User Story 1

- [x] T010 [P] [US1] Unit test de `parseInvoiceSearch` (sin criterios → error; rango invertido → error; `otaId` sin `channel=OTA` → error; `PARTIAL` con < 3 caracteres → error) en `test/unit/domain/billing/invoice-search-criteria.spec.ts`, y de la zona horaria en `issued-date-range.spec.ts`
- [x] T011 [P] [US1] Unit test de `ManageInvoicesService.search` con puerto mockeado (`NO_MATCHES`, paginación, `customerMatchMode` en la respuesta) en `test/unit/application/billing/manage-invoices.service.spec.ts`
- [x] T012 [P] [US1] Integration test de `search()` contra Postgres (`TEST_DATABASE_URL`): cada filtro, combinación rango + canal, coincidencia exacta vs. parcial, orden estable entre ejecuciones, `totalItems` correcto con más resultados que `pageSize`, y una factura insertada entre la página 1 y la 2 con el mismo `asOf` no produce repetidos ni saltos en `test/integration/persistence/billing/prisma-invoice-query.adapter.spec.ts`
- [x] T013 [P] [US1] Contract test de `GET /invoices`: forma de la respuesta (incluye `asOf`), `400` sin criterios, con rango inválido o con `asOf` futuro, `401` sin token y `403` con JWT de rol `OTA` en `test/contract/billing/invoices-admin.contract.spec.ts`

### Implementation for User Story 1

- [x] T014 [P] [US1] Implementar `CustomerMatchMode` y `parseInvoiceSearch` (`InvoiceSearchCriteria`) en `src/domain/model/billing/`
- [x] T015 [US1] Implementar `PrismaInvoiceQueryAdapter.search()` con filtros parametrizados, condición `issuedAt <= asOf`, orden total y `LIMIT/OFFSET` + `count` (depende de T007, T014)
- [x] T016 [US1] Implementar `ManageInvoicesService.search` en `src/application/services/billing/manage-invoices.service.ts` (construye criterio, aplica zona horaria, fija `asOf` si no llega usando la hora de la base de datos (`SELECT now()` en Postgres, no `new Date()` en Node, para evitar desfases con `issued_at`), marca `NO_MATCHES`)
- [x] T017 [US1] Implementar `SearchInvoicesQueryDto` e `InvoiceSearchResponseDto` para Swagger en `src/infrastructure/adapters/in/http/billing/dto/invoices.dto.ts`; las validaciones (`pageSize` máx. 100, `asOf` ISO 8601 no futuro) están en el dominio y el servicio, como en 002
- [x] T018 [US1] Implementar `GET /invoices` en `InvoicesAdminController`

**Checkpoint**: La búsqueda funciona y es testeable de forma independiente

---

## Phase 4: User Story 2 - Consultar el detalle completo y trazable de una factura (Priority: P2)

**Goal**: El Administrador abre una factura localizada y ve su desglose y trazabilidad tal como fue emitida, sin alterarla

**Independent Test**: Emitir una factura OTA mediante el flujo de 006, abrir su detalle y comprobar que hospedaje, comisión, IVA, total, número oficial, liquidación de origen y fecha de emisión coinciden byte a byte con lo persistido, y que la fila no cambió (`updated_at`/hash idénticos antes y después)

### Tests for User Story 2

- [x] T019 [P] [US2] Unit test de `ManageInvoicesService.getDetail` (factura existente; inexistente → `InvoiceNotFoundError`) en `test/unit/application/billing/manage-invoices.service.spec.ts`
- [x] T020 [P] [US2] Integration test de `findDetailById()`: importes idénticos a los persistidos por 006 y ausencia de cualquier campo migratorio en el resultado en `test/integration/persistence/billing/prisma-invoice-query.adapter.spec.ts`
- [x] T021 [P] [US2] Contract test de `GET /invoices/{invoiceId}`: esquema con lista blanca de campos (falla si aparece `nationality`, `documentType`, `visaType`, etc.), `404` para id inexistente, `400` para id no UUID

### Implementation for User Story 2

- [x] T022 [US2] Implementar `PrismaInvoiceQueryAdapter.findDetailById()` con `select` explícito de columnas
- [x] T023 [US2] Implementar `ManageInvoicesService.getDetail` en `src/application/services/billing/manage-invoices.service.ts`
- [x] T024 [US2] Implementar `InvoiceDetailResponseDto` (incluye `status: "ISSUED"` e `immutable: true`) y `GET /invoices/:invoiceId` en el controller, declarado después de `/invoices/summary`

**Checkpoint**: HU1 y HU2 funcionan de forma independiente

---

## Phase 5: User Story 3 - Resumen consolidado de facturas por canal (Priority: P3)

**Goal**: El Administrador obtiene, para un rango de fechas, los totales de hospedaje, comisión OTA e IVA agrupados por canal, con ceros en canales sin facturas

**Independent Test**: Sembrar facturas de canal directo y de dos OTA en un período, pedir el resumen y comparar cada total con la suma manual; pedir un rango sin facturas y verificar ceros en todos los canales

### Tests for User Story 3

- [x] T025 [P] [US3] Unit test de `ManageInvoicesService.summarizeByChannel` (relleno con ceros de canales conocidos sin facturas en el rango, Directo presente aunque nunca haya facturado, rango inválido → error) en `test/unit/application/billing/manage-invoices.service.spec.ts`
- [x] T026 [P] [US3] Integration test de `summarizeByChannel()`: totales por canal iguales a la suma manual, sin mezcla entre OTA, y facturas en el borde del día (23:59 hora Bogotá vs. 00:00 UTC) contadas en el día correcto
- [x] T027 [P] [US3] Contract test de `GET /invoices/summary`: `400` si faltan `issuedFrom`/`issuedTo` o el rango es inválido; respuesta incluye `timezone`

### Implementation for User Story 3

- [x] T028 [US3] Implementar `PrismaInvoiceQueryAdapter.summarizeByChannel()` con `groupBy` por `channel` y `otaId`, y `listKnownOtaIds()` (OTA con facturas históricas, con CTE recursiva sobre el índice; Directo lo agrega el servicio)
- [x] T029 [US3] Implementar `ManageInvoicesService.summarizeByChannel` (completa con ceros los canales conocidos sin facturas en el rango)
- [x] T030 [US3] Implementar `InvoiceSummaryQueryDto`, `InvoiceSummaryResponseDto` y `GET /invoices/summary` en el controller

**Checkpoint**: Las tres historias funcionan de forma independiente

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Garantías transversales de la feature

- [x] T031 E2E en `test/e2e/billing/gestionar-facturacion.e2e-spec.ts`: check-out → liquidación → factura (007/006 por `GenerateFinalInvoiceUseCase`, como lo invoca 010, con Módulo 2 simulado y la cotización del hospedaje sembrada; la cola de RabbitMQ tiene su propia E2E en 010) y luego búsqueda, detalle y resumen con JWT de Administrador
- [x] T032 E2E: una reserva cancelada antes del check-out no aparece en ningún resultado (BR-003)
- [x] T033 Prueba de auditoría de solo lectura: snapshot de `invoice` y `settlement` antes y después de ejecutar las tres operaciones; deben ser idénticos (NFR-004, SC-004)
- [x] T034 Prueba de contrato: `POST`/`PUT`/`PATCH`/`DELETE` sobre `/invoices*` no están disponibles (FR-006); además, `test/architecture/manage-invoices-dependencies.spec.ts` verifica que 008 no usa el lado de escritura de 006/007
- [x] T035 Medir con `EXPLAIN ANALYZE` las consultas de búsqueda y resumen sobre un volumen sembrado (~1M filas) y confirmar uso de índices (NFR-001, NFR-005). Resultado en el mapa de implementación, sección 7
- [x] T036 Documentar los tres endpoints en OpenAPI (`@nestjs/swagger`) a partir de los contratos de `contracts/`, con los mismos ejemplos y códigos de error
- [x] T037 Logging estructurado de cada consulta (usuario, criterios usados, número de resultados), sin registrar datos personales del cliente

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: depende de que el proyecto base y la feature 006 estén implementados (Phase 5 del plan base: 001 → 006 → 008)
- **Foundational (Phase 2)**: depende de Setup — BLOQUEA todas las historias
- **User Stories (Phase 3–5)**: dependen de Foundational; pueden avanzar en paralelo o en orden P1 → P2 → P3
- **Polish (Phase 6)**: depende de las tres historias

### User Story Dependencies

- **User Story 1 (P1)**: solo depende de Foundational
- **User Story 2 (P2)**: solo depende de Foundational; en la práctica se usa después de HU1 para obtener el `invoiceId`, pero se prueba de forma independiente con un id sembrado
- **User Story 3 (P3)**: solo depende de Foundational

### Within Each User Story

- VO / dominio antes que adaptador
- Adaptador antes que servicio de aplicación
- Servicio de aplicación antes que controller/DTO
- Historia completa antes de pasar a la siguiente prioridad

## Notes

- [Story] label mapea cada tarea a su historia para trazabilidad
- Cada historia es completable y testeable de forma independiente
- Ante cualquier conflicto, la spec funcional `gestionar_facturacion.md` es la fuente de verdad; para stack, capas y contratos generales manda `docs/plan-tecnico-base.md`
- Commit después de cada tarea o grupo lógico
- Evitar: lógica de negocio en el controller, reutilizar el repositorio de escritura de 006, recalcular importes en lectura
