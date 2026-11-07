# Implementation Plan: Consultar liquidación

**Date**: 2026-10-09 (ajustado al código de develop el 2026-11-07, ver «Ajustes al código actual» en Notes)
**Spec**: [consultar_liquidacion.md](../1-functional/consultar_liquidacion.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Contrato**: [GET-settlements.md](contracts/GET-settlements.md)

## Summary

La feature expone `GET /api/settlements` en un único `settlements.controller.ts`. Módulo 1 obtiene una liquidación individual final o informativa; una OTA obtiene la colección de liquidaciones finales de la reserva propia. La consulta de resultados finales no muta datos [FR-001–FR-013].

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS
**Primary Dependencies**: NestJS 10.x, Prisma ORM, Passport-JWT y `@nestjs/jwt`.
**Storage**: PostgreSQL 16; acceso de solo lectura a liquidaciones y facturas.
**Testing**: Jest para pruebas unitarias y de integración, Supertest para e2e, Testcontainers para pruebas de integración y contract tests REST.
**Target Platform**: Contenedores Docker; Docker Compose para el entorno local.
**Project Type**: Servicio backend de Módulo 3 con una ruta REST de consulta.
**Performance Goals**: El 95% de las consultas responde en menos de 800 ms en condiciones normales; timeout de 500 ms para la llamada a Módulo 2.
**Constraints**: La consulta informativa se calcula sin persistir [SPEC FR-009, FR-011]; las lecturas de persistencia usan transacción `READ ONLY`; la respuesta usa `Cache-Control: no-store` y acepta/propaga `X-Correlation-Id` [CONV]. La llamada interna de Módulo 1 no usa token; la consulta autenticada requiere `role = OTA` y `otaId`, y otros roles reciben 403.
**Scale/Scope**: Una ruta `GET /api/settlements`, con consulta individual para Módulo 1 y colección para OTA.

## Project Structure

### Documentation (this feature)

```text
features/002-consultar-liquidacion/
├── 1-functional/
│   └── consultar_liquidacion.md
├── 2-technical/
│   ├── plan.md
│   └── contracts/
│       └── GET-settlements.md
├── 3-implementation/
│   └── implementacion.md        # Mapa de archivos de la feature (como las demás features)
└── 4-testing/
    ├── TC-002-consultar-liquidacion.md
    ├── datos-tc-002.sql         # Cotizaciones, Final y facturas de ejemplo del TC
    ├── modulo2-simulado.js      # Módulo 2 simulado para el TC (y con demora para T018)
    └── medir-tiempos.js         # Medición del p95 (T018)
```

### Source Code (repository root)

Rutas reales del proyecto: cada capa tiene una subcarpeta por *bounded context* (`settlement/`) y los DTO HTTP viven junto a su controller, como en 005 y 001 (no existe `application/dto/`). Cada archivo empieza con la marca `Feature 002`.

```text
src/
├── domain/
│   ├── model/settlement/
│   │   ├── settlement-query.ts                 # Parámetros por actor y parseSettlementQuery (nuevo)
│   │   └── settlement-query-result.ts          # SettlementQueryResult e InvoiceSummary (nuevo)
│   ├── errors/settlement/
│   │   ├── settlement-not-found.error.ts       # SETTLEMENT_NOT_FOUND (nuevo)
│   │   └── invalid-settlement-query.error.ts   # INVALID_QUERY_PARAMS (nuevo)
│   └── ports/
│       ├── in/settlement/get-settlement.use-case.ts            # nuevo
│       └── out/settlement/
│           ├── settlement-query.port.ts                        # nuevo
│           └── settlement-invoice-query.port.ts                # nuevo
├── application/
│   └── services/settlement/get-settlement.service.ts          # nuevo
└── infrastructure/
    ├── adapters/
    │   ├── in/http/
    │   │   ├── domain-exception.filter.ts                      # modificado: + SETTLEMENT_NOT_FOUND → 404
    │   │   └── settlement/
    │   │       ├── settlements.controller.ts                   # nuevo: GET /api/settlements
    │   │       ├── settlement-access.guard.ts                  # nuevo: sin token = Módulo 1; con token = OTA con otaId
    │   │       ├── no-store.middleware.ts                      # nuevo: Cache-Control: no-store
    │   │       └── dto/settlement.dto.ts                       # nuevo: query y respuesta (Swagger)
    │   └── out/persistence/repositories/settlement/
    │       ├── prisma-settlement-query.adapter.ts              # nuevo
    │       ├── prisma-settlement-invoice-query.adapter.ts      # nuevo
    │       └── read-only-transaction.ts                        # nuevo: transacción READ ONLY de los dos adaptadores
    └── config/settlement.module.ts                             # modificado: controller, puertos y servicio de 002

test/
├── unit/application/settlement/
│   ├── get-settlement.service.spec.ts          # HU1: OTA
│   └── get-settlement-module1.service.spec.ts  # HU2: Módulo 1 (FINAL o INFORMATIVE)
├── unit/domain/settlement/settlement-query.spec.ts
├── unit/infrastructure/settlement/
│   ├── settlement-access.guard.spec.ts
│   ├── no-store.middleware.spec.ts
│   └── settlements.controller.spec.ts      # controller con caso de uso falso + SETTLEMENT_NOT_FOUND → 404
├── integration/persistence/settlement/
│   ├── prisma-settlement-query.adapter.spec.ts
│   ├── prisma-settlement-invoice-query.adapter.spec.ts
│   └── settlement-query-consistency.spec.ts   # HU3: consulta durante el check-out (T017)
├── contract/settlement/settlements.contract.spec.ts
├── e2e/settlement/settlements.e2e-spec.ts
└── support/settlement/fake-settlement-query-ports.ts  # dobles de los puertos de lectura de 002
```

Se reutilizan sin cambios, de 007: `SettlementRepositoryPort.findByReservationAndRoom` (`SETTLEMENT_REPOSITORY`), `SettlementCalculator`, `channelTermsOf`, `ReservationClientPort` (`RESERVATION_CLIENT`), `SettlementMapper` y los errores `RESERVATION_NOT_FOUND`, `QUOTE_NOT_FOUND`, `MISSING_COMMISSION`, `INVALID_COMMISSION` y `MODULE2_UNAVAILABLE`; de 005: `LodgingQuoteQueryPort` (`LODGING_QUOTE_QUERY`, exportado por `PricingModule`); de la base: `OptionalJwtAuthGuard` y `CorrelationIdMiddleware`. No hay migración: 002 solo lee `settlement` (007) e `invoice` (006), que ya existen con sus índices.

**Structure Decision**: Se usa la estructura por capas del plan base con `settlement` como subcarpeta. Un único `settlements.controller.ts` atiende a Módulo 1 y a la OTA; `GetSettlementService` concentra la orquestación. Todo lo de 002 vive en `settlement` y **ningún archivo de 002 importa código de `billing`**: la prueba de arquitectura de 007 (`test/architecture/settlement-dependencies.spec.ts`, «settlement no emite la factura: nunca importa billing») falla con cualquier archivo cuya ruta contenga `settlement` e importe `billing`. Por eso el resumen de factura (`InvoiceSummary`) se define en `domain/model/settlement/` y `PrismaSettlementInvoiceQueryAdapter` lee la tabla `invoice` directamente con Prisma, sin usar el modelo, los mappers ni los puertos de 006. Por la misma prueba, 002 tampoco importa `ports/in/pricing` ni `services/pricing`: solo el puerto de lectura `LodgingQuoteQueryPort`.

## Diseño técnico

### Entrada y autorización

`settlements.controller.ts` implementa la única ruta `GET /api/settlements`. El guard distingue por la cabecera `Authorization`: una petición sin ella es la llamada interna de Módulo 1, que llega por la red interna sin token y cuyo endpoint no se publica fuera de ella [BASE]; exige `reservationRef` y `roomId`, y si falta alguno responde `INVALID_QUERY_PARAMS` sin revelar información financiera, de modo que una solicitud sin identidad no se trata como consulta de OTA ni accede a liquidaciones de reservas OTA [SPEC FR-013]. `categoryRoom` es opcional e informativo para Módulo 1; su ausencia no causa un rechazo por parámetros inválidos. Una petición con cabecera `Authorization` es autenticada: requiere token válido, rol OTA y claim `otaId` [BASE]. La validación de parámetros y la separación de respuestas siguen [GET-settlements.md](contracts/GET-settlements.md).

Cómo queda en el código actual:

- La ruta usa `@Controller('api/settlements')`: el proyecto no tiene prefijo global y el plan base fija `/api/settlements` (a diferencia de `/pricing/...` de 005).
- Guards: `@UseGuards(OptionalJwtAuthGuard, SettlementAccessGuard)`. `OptionalJwtAuthGuard` (de la base) deja pasar sin cabecera `Authorization` y, con ella, exige un JWT válido (si no, `401 UNAUTHENTICATED`). `SettlementAccessGuard` (propio de 002, en `adapters/in/http/settlement/`) deja pasar sin cabecera; con cabecera, un rol distinto de OTA lanza `ForbiddenException` (`403 FORBIDDEN`) y un token OTA sin claim `otaId` lanza `UnauthorizedException` (`401 UNAUTHENTICATED`). No se usa `RolesGuard` porque rechaza con 401 las llamadas sin token, que aquí son las de Módulo 1; no se reutiliza `InternalOrOtaGuard` de 005 porque vive en `pricing` y no exige `otaId`.
- Validación por actor: depende de si hay token, así que no se hace con un DTO de class-validator. El controller pasa los parámetros tal como llegan y quién consulta (`SettlementCaller`: `{ kind: 'INTERNAL' }` o `{ kind: 'OTA', otaId }`, como `DynamicRateCaller` en 005); el caso de uso empieza con `parseSettlementQuery` (`domain/model/settlement/settlement-query.ts`, función pura), que lanza `InvalidSettlementQueryError` (`INVALID_QUERY_PARAMS`, 400) si falta `reservationRef` o está en blanco, o, para Módulo 1, si falta `roomId` o no tiene formato UUID. Con token OTA, `roomId` y `categoryRoom` se ignoran. `checkInDate`, `checkOutDate`, `source` y cualquier otro parámetro se ignoran siempre.
- `Cache-Control: no-store`: un middleware (`no-store.middleware.ts`) que `SettlementModule` aplica a `api/settlements`. Los middlewares corren antes que los guards, así que la cabecera sale también en 400, 401, 403 y 404. `X-Correlation-Id` ya lo pone `CorrelationIdMiddleware` en todas las rutas; el controller pasa ese id al caso de uso para que llegue a Módulo 2 (`getReservation(reservationRef, correlationId)`).

### Casos de consulta

Para Módulo 1, se busca primero por `(reservationRef, roomId)` usando `SettlementRepositoryPort.findByReservationAndRoom` de 007. Si existe, se devuelve la `FINAL` con los campos de la liquidación y su factura si está emitida; `categoryRoom` se proyecta desde la liquidación. Si no existe, se obtiene la reserva mediante `ReservationClientPort`, se toman sus `quoteIds` y se llama a `LodgingQuoteQueryPort.findByIds`; de las cotizaciones devueltas se elige la que tenga `roomId` igual al consultado. `categoryRoom` no interviene en la selección ni en la validación y, como la cotización no contiene `categoryRoom` ni `roomType`, en la respuesta informativa se devuelve `null`; nunca se toma del parámetro de la petición. `lodgingAmount` sale de la cotización (o de la liquidación FINAL); `baseLodgingAmount` es la suma de `baseRate` de las noches de la cotización y `dynamicAdjustmentAmount = lodgingAmount − baseLodgingAmount`, por lo que siempre se cumple `lodgingAmount = baseLodgingAmount + dynamicAdjustmentAmount`. La liquidación informativa no se persiste. Se aplican las reglas de canal y comisión de `Generar liquidación`: canal directo si la reserva no informa canal o informa un canal distinto de `OTA`, y comisión OTA entre 0 y 100, con los mismos errores tipados.

Para OTA, `SettlementQueryPort.findByReservationRefAndOtaId(reservationRef, otaId): Settlement[]` devuelve las liquidaciones finales de la reserva cuyo `ota_id` coincide con el `otaId` autenticado. Las liquidaciones se ordenan por `roomId`. La ausencia, reserva directa o reserva perteneciente a otra OTA produce `SETTLEMENT_NOT_FOUND` para conservar la respuesta anti-enumeración.

`PrismaSettlementQueryAdapter` implementa `SettlementQueryPort`; `PrismaSettlementInvoiceQueryAdapter` implementa `SettlementInvoiceQueryPort`, consulta la factura por `settlementId` y proyecta exclusivamente el subconjunto definido en el contrato. 002 no define ni crea índices de persistencia.

### Puertos

```ts
interface SettlementQueryPort {
  findByReservationRefAndOtaId(reservationRef: string, otaId: string): Promise<Settlement[]>;
}

interface SettlementInvoiceQueryPort {
  findBySettlementId(settlementId: string): Promise<InvoiceSummary | null>;
}
```

`SettlementRepositoryPort.findByReservationAndRoom` se reutiliza desde 007 y no se redefine aquí.

`Settlement` es el modelo de dominio de 007 (`domain/model/settlement/settlement.ts`), con importes y porcentaje como texto decimal exacto. `InvoiceSummary` es propio de 002 y vive en `domain/model/settlement/settlement-query-result.ts` (no en `billing`, por la regla de arquitectura de la Structure Decision): `invoiceId`, `invoiceNumber`, `issuedAt`, `vatRateApplied`, `vatAmount`, `totalAmount` y `status`. El adaptador convierte `invoice_number` (`BIGINT`) a `number` y los `DECIMAL` a texto con dos decimales. El plan base menciona un `invoice.repository.port.ts` de lectura compartido por 002 y 008 en `billing`; 002 no lo usa, por la misma regla, y define su propio puerto.

`GetSettlementUseCase` devuelve `SettlementQueryResult` (`domain/model/settlement/`): `settlementType` (`FINAL` o `INFORMATIVE`), los datos de la liquidación y `InvoiceSummary | null`. Para Módulo 1 es un resultado individual; para OTA, una colección ordenada por `roomId`. El controller lo proyecta a `settlement-response.dto.ts`.

### Errores

| Condición | Código | HTTP |
|---|---|---:|
| Parámetros obligatorios inválidos | `INVALID_QUERY_PARAMS` | 400 |
| Token inválido o token OTA sin claim `otaId` | `UNAUTHENTICATED` | 401 |
| Token con rol distinto de OTA | `FORBIDDEN` | 403 |
| Sin resultado visible para OTA | `SETTLEMENT_NOT_FOUND` | 404 |
| Reserva inexistente en cálculo informativo | `RESERVATION_NOT_FOUND` | 404 |
| Cotización inexistente | `QUOTE_NOT_FOUND` | 404 |
| Módulo 2 no disponible | `MODULE2_UNAVAILABLE` | 424 |
| Comisión ausente o inválida | `MISSING_COMMISSION` / `INVALID_COMMISSION` | 409 |
| Error inesperado | `UNEXPECTED_ERROR` | 422 |

Solo `SETTLEMENT_NOT_FOUND` es nuevo: 002 crea `SettlementNotFoundError` y agrega `SETTLEMENT_NOT_FOUND: 404` a `domain-exception.filter.ts` (archivo compartido; cambio de una línea). `INVALID_QUERY_PARAMS` y `FORBIDDEN` ya están mapeados (005); `RESERVATION_NOT_FOUND`, `QUOTE_NOT_FOUND`, `MISSING_COMMISSION`, `INVALID_COMMISSION` y `MODULE2_UNAVAILABLE` ya los lanzan el cliente de Módulo 2 y `channelTermsOf` de 007; `UNAUTHENTICATED` sale de `UnauthorizedException`. La consulta OTA sin resultado visible responde `SETTLEMENT_NOT_FOUND` con el mismo mensaje en los tres casos (sin liquidaciones, reserva directa, reserva de otra OTA), para no permitir enumerar reservas.

### Cálculo informativo y reloj

La informativa se arma con `channelTermsOf(reserva)` y `SettlementCalculator.calculate({ quote, channel, commission })` de 007, los mismos que usa `Generar liquidación`, para que coincida con la `Final` (FR-008, SC-008). Si ninguna cotización devuelta por `findByIds` tiene el `roomId` consultado (comparado sin distinguir mayúsculas, como en 005), se lanza `QuoteNotFoundError`. `generatedAt` de la informativa es el momento del cálculo: el servicio recibe un reloj inyectable (`now: () => Date`) para que las pruebas sean deterministas; en la `Final` es el `generatedAt` guardado.

Cómo queda en el código: `GetSettlementService` recibe, además de los dos puertos de lectura de 002, `SETTLEMENT_REPOSITORY`, `RESERVATION_CLIENT` (007) y `LODGING_QUOTE_QUERY` (005). El `roomId` consultado se pasa a minúsculas antes de buscar, porque 007 lo guarda así. Los pasos de la informativa siguen el mismo orden que `Generar liquidación` (reserva → cotización → canal y comisión → cálculo), y si dos cotizaciones de la reserva fueran de la misma habitación se usa la de menor `quoteId`, igual que 007, para que la informativa coincida con la `Final`. La proyección a `SettlementQueryResult` está en `informativeSettlementResult` (`domain/model/settlement/settlement-query-result.ts`).

### Consistencia

Cada lectura propia de 002 (`PrismaSettlementQueryAdapter` y `PrismaSettlementInvoiceQueryAdapter`) se ejecuta como transacción `READ ONLY` (`prisma.$transaction` que empieza con `SET TRANSACTION READ ONLY`); el proyecto no tenía aún este patrón y 002 es la primera en usarlo. `findByReservationAndRoom` de 007 se reutiliza tal cual: es un único `SELECT`, que PostgreSQL ya lee de una sola instantánea, y envolverlo exigiría cambiar código de 007. Liquidación y factura se guardan en transacciones separadas (007 y luego 006), así que una `FINAL` con `invoice: null` es un estado válido (factura aún no emitida), no un estado intermedio. Si el check-out se procesa al mismo tiempo, la consulta ve la liquidación informativa antes de que se guarde la `FINAL` o la liquidación `FINAL` después del guardado; nunca observa un estado intermedio. Módulo 1 consulta antes de confirmar el check-out y no necesita consultar después del evento asíncrono.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Crear el módulo de consulta y su estructura de entrada HTTP.

- [x] T001 Crear el módulo de consulta y la estructura de entrada HTTP: carpeta `adapters/in/http/settlement/` y el middleware `no-store` aplicado a `api/settlements` en el `SettlementModule` existente (no un módulo nuevo). El controller, los puertos y el servicio de 002 se registran en ese módulo en T011: la aplicación no arranca con un controller cuyo caso de uso aún no tiene implementación.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Preparar los puertos de consulta, el acceso autorizado y la ruta HTTP que comparten las historias.

- [x] T002 Definir puertos de consulta de liquidaciones por reserva y factura por `settlementId`, el puerto de entrada `GetSettlementUseCase` (con el tipo de quién consulta: interno u OTA con `otaId`) y los tipos `SettlementQueryResult` e `InvoiceSummary`, todos en `settlement` y sin importar `billing`.
- [x] T003 Configurar el guard y el mapeo de errores `ApiError` para acceso interno y OTA: `SettlementAccessGuard` (otro rol → 403; OTA sin `otaId` → 401), `SettlementNotFoundError` e `InvalidSettlementQueryError`, y `SETTLEMENT_NOT_FOUND: 404` en `domain-exception.filter.ts`. Incluye pruebas unitarias del guard.
- [x] T004 Implementar el único controller `settlements.controller.ts` con la ruta `GET /api/settlements`, la validación de parámetros por actor y la delegación en `GetSettlementUseCase` (pasa quién consulta y el `X-Correlation-Id`), con su documentación Swagger.

**Checkpoint**: La ruta, los puertos de consulta y las reglas de acceso están disponibles para las historias.

---

## Phase 3: User Story 1 - La OTA consulta las liquidaciones de su reserva (Priority: P1)

**Goal**: La OTA consulta las liquidaciones `Final` de las habitaciones con check-out de su reserva y recibe el desglose y la factura definitiva cuando ya fue emitida.

**Independent Test**: Se puede generar la liquidación de cada habitación con check-out de una reserva OTA y verificar que, al consultar la reserva como esa OTA, se reciben sus liquidaciones `Final` con el desglose calculado por `Generar liquidación`.

### Tests for User Story 1

- [x] T005 [US1] Pruebas unitarias para autorización OTA, filtro de pertenencia, colección ordenada y resultado vacío.
- [x] T006 [US1] Pruebas de integración de lectura de liquidaciones y factura asociada, sin mutación; consultas repetidas de una liquidación `Final` sin cambios devuelven el mismo resultado; la consulta por `otaId` no devuelve liquidaciones de reservas directas ni de otra OTA.
- [x] T007 [US1] Contract test de la respuesta OTA como colección y objeto de liquidación del contrato; la respuesta no incluye datos migratorios, datos personales del huésped ni `billingCustomer`; verifica que los campos de desglose provistos por la liquidación incluyen `lodgingAmount`, `baseLodgingAmount` y `dynamicAdjustmentAmount`, y que se cumple `lodgingAmount = baseLodgingAmount + dynamicAdjustmentAmount`.
- [x] T008 [US1] Pruebas e2e de `GET /api/settlements` con token OTA, respuestas anti-enumeración y token OTA sin claim `otaId`.

### Implementation for User Story 1

- [x] T009 [US1] Implementar `PrismaSettlementQueryAdapter` para consultar finales por `reservationRef` y `otaId` y proyectarlas ordenadas por habitación.
- [x] T010 [US1] Implementar `PrismaSettlementInvoiceQueryAdapter` para consultar la factura por `settlementId` y aplicar la proyección contractual.
- [x] T011 [US1] Implementar el `GetSettlementService` (puerto `GetSettlementUseCase`) para consulta OTA y su respuesta `SETTLEMENT_NOT_FOUND` para reservas no visibles, y registrar en `SettlementModule` el controller, `GET_SETTLEMENT_USE_CASE` y los puertos de 002.

**Checkpoint**: La OTA recibe las liquidaciones `Final` de su reserva con el desglose contractual.

**Estado (2026-11-07)**: HU1 completa.

---

## Phase 4: User Story 2 - Módulo 1 consulta la liquidación informativa antes del check-out (Priority: P1)

**Goal**: Módulo 1 consulta la liquidación informativa antes del check-out sin guardarla.

**Independent Test**: Se puede consultar una habitación con reserva y cotización válidas antes del check-out y verificar que el sistema devuelve su liquidación informativa, sin guardarla.

### Tests for User Story 2

- [x] T012 [US2] Pruebas unitarias de selección `FINAL`/`INFORMATIVE`, obtención de la reserva mediante `ReservationClientPort`, llamada a `LodgingQuoteQueryPort.findByIds` con sus `quoteIds` y selección por `roomId`, ausencia de reserva/cotización y comisión ausente/inválida; comprueba que la ausencia de `categoryRoom` no se rechaza como parámetro inválido, que la respuesta informativa tiene `categoryRoom: null` aunque la petición incluya ese parámetro, y que con los mismos datos de reserva y cotización la informativa coincide con la liquidación que genera `Generar liquidación` (`baseLodgingAmount`, `dynamicAdjustmentAmount`, `lodgingAmount`, comisión e ingreso neto), sin persistirla.
- [x] T013 [US2] Contract test de respuesta individual, incluido el canal directo sin comisión, una liquidación `FINAL` existente consultada sin `categoryRoom` con respuesta `200` y errores de cálculo informativo; verifica que la respuesta `INFORMATIVE` tiene `categoryRoom: null` aunque la petición envíe `categoryRoom`, que ese parámetro nunca se refleja en la respuesta, y el desglose conforme al contrato; la respuesta no incluye datos migratorios, datos personales del huésped ni `billingCustomer`; verifica que la reserva se obtiene mediante `ReservationClientPort`, que se llama a `LodgingQuoteQueryPort.findByIds` con sus `quoteIds` y se elige la cotización por `roomId`, sin usar `categoryRoom` para selección ni validación.
- [x] T014 [US2] Pruebas e2e de llamada interna sin token; verifica que la falta de `reservationRef` o `roomId` responde `400`, que una petición de liquidación `FINAL` existente sin `categoryRoom` responde `200` y que una solicitud sin token y sin `roomId` no revela información financiera de reservas OTA; verifica headers de no-cache y correlación.

### Implementation for User Story 2

- [x] T015 [US2] Usar `SettlementRepositoryPort.findByReservationAndRoom` de 007 para devolver la `FINAL` de Módulo 1 antes de calcular la informativa.
- [x] T016 [US2] Implementar cálculo informativo con los puertos de 005/007, sin persistir.

**Checkpoint**: Módulo 1 obtiene el desglose informativo antes del check-out sin persistirlo.

**Estado (2026-11-07)**: HU2 completa. La llamada interna de Módulo 1 ya no responde `422`: devuelve la `FINAL` o la `INFORMATIVE`.

---

## Phase 5: User Story 3 - Cada actor recibe el resultado permitido durante el check-out asíncrono (Priority: P2)

**Goal**: Módulo 1 recibe la liquidación informativa o `Final` permitida y la OTA recibe la `Final` disponible o la ausencia de liquidación, sin resultados parciales o intermedios.

**Independent Test**: Se puede consultar concurrentemente con el procesamiento del evento como Módulo 1 y como OTA, y verificar que cada actor recibe únicamente el resultado permitido, sin presentar un estado intermedio o parcial.

### Tests for User Story 3

- [x] T017 [US3] Pruebas de integración de `READ ONLY` y lectura concurrente sin estado intermedio.

### Implementation for User Story 3

Los adaptadores de liquidación y factura, el cálculo informativo, la reutilización del puerto de 007 y el servicio de consulta de las historias 1 y 2 implementan esta historia.

**Checkpoint**: Las consultas concurrentes devuelven únicamente el resultado permitido para cada actor.

**Estado (2026-11-07)**: HU3 completa. `settlement-query-consistency.spec.ts` usa el servicio con los adaptadores reales contra PostgreSQL: comprueba que la transacción es de solo lectura, que una `Final` o una factura cuya transacción aún no se confirma no se ven (Módulo 1 recibe la informativa y la OTA `SETTLEMENT_NOT_FOUND`), y que durante un check-out simulado (007 guarda la `Final` y después 006 la factura) cada respuesta es la informativa completa o la `Final` completa, nunca una mezcla.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verificar rendimiento, solo lectura y consistencia contractual de la feature.

- [x] T018 Verificar el objetivo p95 menor a 800 ms con Módulo 2 respondiendo dentro del timeout de 500 ms.
- [x] T019 Revisar que la consulta final sea de solo lectura y que todas las respuestas coincidan con el contrato; correr la prueba de arquitectura de 007 (`settlement-dependencies.spec.ts`) para confirmar que ningún archivo de 002 importa `billing` ni el cálculo de `pricing`.
- [x] T020 Documentar la feature como las demás: `3-implementation/implementacion.md` (mapa de archivos y pruebas), `4-testing/TC-002-consultar-liquidacion.md` (caso de prueba manual con Módulo 2 simulado) y la fila de 002 en el `README.md`.

**Estado (2026-11-07)**: hechas. T018: p95 total 478 ms con Módulo 2 tardando 450 ms (ver «Decisiones de implementación» en `3-implementation/implementacion.md`). T019: sin escrituras ni imports de `billing` o del cálculo de `pricing` en la 002; contrato y DTO coinciden; prueba de arquitectura de 007 en verde. T020: mapa, TC-002 (ejecutado, todos los pasos en verde) y fila del README.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 precede a T002–T004.
- **Foundational (Phase 2)**: depende de Setup; precede a las tres historias.
- **User Stories (Phases 3–5)**: dependen de Foundational; la historia 2 depende además de los puertos y servicios de consulta de 005/007.
- **Polish (Phase 6)**: T018–T020 cierran la feature.
- **Dependencias de otras features**: 002 lee, en modo de solo lectura, la tabla `settlement` y `SettlementRepositoryPort.findByReservationAndRoom` de 007 y la tabla `invoice` de 006; ambas deben estar disponibles antes de las pruebas de integración de las historias 1 y 2. **Estado al 2026-11-07: cumplidas.** 007 (PR #135), 005 (PR #136) y 006 (PR #138) están en develop, con las tablas, el índice `(reservation_ref, room_id)` y los puertos que 002 reutiliza.

### User Story Dependencies

- **User Story 1 (P1)**: puede implementarse tras Foundational; usa el controller de Foundational (T004), que se registra en `SettlementModule` junto con el servicio (T011).
- **User Story 2 (P1)**: depende además de los puertos y servicios de consulta de 005/007 y amplía el `GetSettlementService` creado en T011.
- **User Story 3 (P2)**: usa los resultados de las consultas y el procesamiento asíncrono; no se declara una dependencia adicional entre historias.

### Within Each User Story

- Ejecutar las pruebas de cada historia antes de su implementación.
- Completar los puertos y adaptadores requeridos antes del servicio que los consume.

## Notes

- Los puertos de liquidación existentes en 007 se reutilizan. 002 agrega únicamente las consultas descritas aquí y no administra índices ni escritura de liquidaciones.
- Las fechas reales de entrada y salida que envía Módulo 1 se ignoran porque el valor de hospedaje sale de la cotización guardada (FR-002 y BR-004 de `generar_liquidacion.md`): una salida anticipada no cambia la liquidación informativa, que coincide con la `Final`.

### Ajustes al código actual (2026-11-07)

Ajustes hechos al revisar este plan contra develop antes de implementar. No cambian la spec funcional ni el contrato: solo dicen dónde y cómo queda cada pieza en el código que ya existe.

- **Rutas de archivos**: se agregan las subcarpetas `settlement/` que usa el proyecto en cada capa; el DTO pasa de `application/dto/` (carpeta que el proyecto no tiene) a `adapters/in/http/settlement/dto/`, junto al controller; la e2e queda en `test/e2e/settlement/`. Se agregan la prueba de integración del adaptador de facturas y la unitaria del guard.
- **Sin importar `billing`**: lo exige la prueba de arquitectura de 007. `InvoiceSummary` se define en `settlement` y la tabla `invoice` se lee directamente con Prisma (ver Structure Decision).
- **Guard propio** (`SettlementAccessGuard`) en vez de `RolesGuard` o del guard de 005, porque además debe exigir `otaId` (401).
- **Errores**: solo `SETTLEMENT_NOT_FOUND` es nuevo; los demás ya existen.
- **`READ ONLY`** en los adaptadores propios de 002; `findByReservationAndRoom` de 007 se reutiliza tal cual.
- **`Cache-Control: no-store`** por middleware, para que salga también en las respuestas de error.
- **Documentación**: se agrega T020 (mapa de implementación, TC-002 y README), como en las demás features.
