# Implementation Plan: Consultar liquidación

**Date**: 2026-10-09
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
└── 2-technical/
    ├── plan.md
    └── contracts/
        └── GET-settlements.md
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── model/settlement/
│   │   └── settlement-query-result.ts
│   └── ports/
│       ├── in/get-settlement.use-case.ts
│       └── out/
│           ├── settlement-query.port.ts
│           └── settlement-invoice-query.port.ts
├── application/
│   ├── services/settlement/get-settlement.service.ts
│   └── dto/settlement/settlement-response.dto.ts
└── infrastructure/
    ├── adapters/
    │   ├── in/http/settlements.controller.ts
    │   └── out/persistence/repositories/
    │       ├── prisma-settlement-query.adapter.ts
    │       └── prisma-settlement-invoice-query.adapter.ts
    └── config/settlement.module.ts

test/
├── unit/application/settlement/get-settlement.service.spec.ts
├── integration/persistence/settlement/prisma-settlement-query.adapter.spec.ts
├── contract/settlement/settlements.contract.spec.ts
└── e2e/consultar-liquidacion.e2e-spec.ts
```

**Structure Decision**: Se usa la estructura por capas del plan base con settlement como subcarpeta. Un único settlements.controller.ts atiende a Módulo 1 y a la OTA; GetSettlementService concentra la orquestación.

## Diseño técnico

### Entrada y autorización

`settlements.controller.ts` implementa la única ruta `GET /api/settlements`. El guard distingue por la cabecera `Authorization`: una petición sin ella es la llamada interna de Módulo 1, que llega por la red interna sin token y cuyo endpoint no se publica fuera de ella [BASE]; exige `reservationRef` y `roomId`, y si falta alguno responde `INVALID_QUERY_PARAMS` sin revelar información financiera, de modo que una solicitud sin identidad no se trata como consulta de OTA ni accede a liquidaciones de reservas OTA [SPEC FR-013]. `categoryRoom` es opcional e informativo para Módulo 1; su ausencia no causa un rechazo por parámetros inválidos. Una petición con cabecera `Authorization` es autenticada: requiere token válido, rol OTA y claim `otaId` [BASE]. La validación de parámetros y la separación de respuestas siguen [GET-settlements.md](contracts/GET-settlements.md).

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

### Consistencia

Cada lectura se ejecuta como transacción `READ ONLY`. Si el check-out se procesa al mismo tiempo, la consulta ve la liquidación informativa antes de que se guarde la `FINAL` o la liquidación `FINAL` después del guardado; nunca observa un estado intermedio. Módulo 1 consulta antes de confirmar el check-out y no necesita consultar después del evento asíncrono.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Crear el módulo de consulta y su estructura de entrada HTTP.

- [ ] T001 Crear el módulo de consulta y la estructura de entrada HTTP.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Preparar los puertos de consulta, el acceso autorizado y la ruta HTTP que comparten las historias.

- [ ] T002 Definir puertos de consulta de liquidaciones por reserva y factura por `settlementId`, el puerto de entrada `GetSettlementUseCase` y el tipo `SettlementQueryResult`.
- [ ] T003 Configurar el guard y el mapeo de errores `ApiError` para acceso interno y OTA.
- [ ] T004 Implementar el único controller `settlements.controller.ts` con la ruta `GET /api/settlements`, la validación de parámetros por actor y la delegación en `GetSettlementUseCase`.

**Checkpoint**: La ruta, los puertos de consulta y las reglas de acceso están disponibles para las historias.

---

## Phase 3: User Story 1 - La OTA consulta las liquidaciones de su reserva (Priority: P1)

**Goal**: La OTA consulta las liquidaciones `Final` de las habitaciones con check-out de su reserva y recibe el desglose y la factura definitiva cuando ya fue emitida.

**Independent Test**: Se puede generar la liquidación de cada habitación con check-out de una reserva OTA y verificar que, al consultar la reserva como esa OTA, se reciben sus liquidaciones `Final` con el desglose calculado por `Generar liquidación`.

### Tests for User Story 1

- [ ] T005 [US1] Pruebas unitarias para autorización OTA, filtro de pertenencia, colección ordenada y resultado vacío.
- [ ] T006 [US1] Pruebas de integración de lectura de liquidaciones y factura asociada, sin mutación; consultas repetidas de una liquidación `Final` sin cambios devuelven el mismo resultado; la consulta por `otaId` no devuelve liquidaciones de reservas directas ni de otra OTA.
- [ ] T007 [US1] Contract test de la respuesta OTA como colección y objeto de liquidación del contrato; la respuesta no incluye datos migratorios, datos personales del huésped ni `billingCustomer`; verifica que los campos de desglose provistos por la liquidación incluyen `lodgingAmount`, `baseLodgingAmount` y `dynamicAdjustmentAmount`, y que se cumple `lodgingAmount = baseLodgingAmount + dynamicAdjustmentAmount`.
- [ ] T008 [US1] Pruebas e2e de `GET /api/settlements` con token OTA, respuestas anti-enumeración y token OTA sin claim `otaId`.

### Implementation for User Story 1

- [ ] T009 [US1] Implementar `PrismaSettlementQueryAdapter` para consultar finales por `reservationRef` y `otaId` y proyectarlas ordenadas por habitación.
- [ ] T010 [US1] Implementar `PrismaSettlementInvoiceQueryAdapter` para consultar la factura por `settlementId` y aplicar la proyección contractual.
- [ ] T011 [US1] Implementar el `GetSettlementService` (puerto `GetSettlementUseCase`) para consulta OTA y su respuesta `SETTLEMENT_NOT_FOUND` para reservas no visibles.

**Checkpoint**: La OTA recibe las liquidaciones `Final` de su reserva con el desglose contractual.

---

## Phase 4: User Story 2 - Módulo 1 consulta la liquidación informativa antes del check-out (Priority: P1)

**Goal**: Módulo 1 consulta la liquidación informativa antes del check-out sin guardarla.

**Independent Test**: Se puede consultar una habitación con reserva y cotización válidas antes del check-out y verificar que el sistema devuelve su liquidación informativa, sin guardarla.

### Tests for User Story 2

- [ ] T012 [US2] Pruebas unitarias de selección `FINAL`/`INFORMATIVE`, obtención de la reserva mediante `ReservationClientPort`, llamada a `LodgingQuoteQueryPort.findByIds` con sus `quoteIds` y selección por `roomId`, ausencia de reserva/cotización y comisión ausente/inválida; comprueba que la ausencia de `categoryRoom` no se rechaza como parámetro inválido, que la respuesta informativa tiene `categoryRoom: null` aunque la petición incluya ese parámetro, y que con los mismos datos de reserva y cotización la informativa coincide con la liquidación que genera `Generar liquidación` (`baseLodgingAmount`, `dynamicAdjustmentAmount`, `lodgingAmount`, comisión e ingreso neto), sin persistirla.
- [ ] T013 [US2] Contract test de respuesta individual, incluido el canal directo sin comisión, una liquidación `FINAL` existente consultada sin `categoryRoom` con respuesta `200` y errores de cálculo informativo; verifica que la respuesta `INFORMATIVE` tiene `categoryRoom: null` aunque la petición envíe `categoryRoom`, que ese parámetro nunca se refleja en la respuesta, y el desglose conforme al contrato; la respuesta no incluye datos migratorios, datos personales del huésped ni `billingCustomer`; verifica que la reserva se obtiene mediante `ReservationClientPort`, que se llama a `LodgingQuoteQueryPort.findByIds` con sus `quoteIds` y se elige la cotización por `roomId`, sin usar `categoryRoom` para selección ni validación.
- [ ] T014 [US2] Pruebas e2e de llamada interna sin token; verifica que la falta de `reservationRef` o `roomId` responde `400`, que una petición de liquidación `FINAL` existente sin `categoryRoom` responde `200` y que una solicitud sin token y sin `roomId` no revela información financiera de reservas OTA; verifica headers de no-cache y correlación.

### Implementation for User Story 2

- [ ] T015 [US2] Usar `SettlementRepositoryPort.findByReservationAndRoom` de 007 para devolver la `FINAL` de Módulo 1 antes de calcular la informativa.
- [ ] T016 [US2] Implementar cálculo informativo con los puertos de 005/007, sin persistir.

**Checkpoint**: Módulo 1 obtiene el desglose informativo antes del check-out sin persistirlo.

---

## Phase 5: User Story 3 - Cada actor recibe el resultado permitido durante el check-out asíncrono (Priority: P2)

**Goal**: Módulo 1 recibe la liquidación informativa o `Final` permitida y la OTA recibe la `Final` disponible o la ausencia de liquidación, sin resultados parciales o intermedios.

**Independent Test**: Se puede consultar concurrentemente con el procesamiento del evento como Módulo 1 y como OTA, y verificar que cada actor recibe únicamente el resultado permitido, sin presentar un estado intermedio o parcial.

### Tests for User Story 3

- [ ] T017 [US3] Pruebas de integración de `READ ONLY` y lectura concurrente sin estado intermedio.

### Implementation for User Story 3

Los adaptadores de liquidación y factura, el cálculo informativo, la reutilización del puerto de 007 y el servicio de consulta de las historias 1 y 2 implementan esta historia.

**Checkpoint**: Las consultas concurrentes devuelven únicamente el resultado permitido para cada actor.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verificar rendimiento, solo lectura y consistencia contractual de la feature.

- [ ] T018 Verificar el objetivo p95 menor a 800 ms con Módulo 2 respondiendo dentro del timeout de 500 ms.
- [ ] T019 Revisar que la consulta final sea de solo lectura y que todas las respuestas coincidan con el contrato.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 precede a T002–T004.
- **Foundational (Phase 2)**: depende de Setup; precede a las tres historias.
- **User Stories (Phases 3–5)**: dependen de Foundational; la historia 2 depende además de los puertos y servicios de consulta de 005/007.
- **Polish (Phase 6)**: T018–T019 cierran la feature.
- **Dependencias de otras features**: 002 lee, en modo de solo lectura, la tabla `settlement` y `SettlementRepositoryPort.findByReservationAndRoom` de 007 y la tabla `invoice` de 006; ambas deben estar disponibles antes de las pruebas de integración de las historias 1 y 2.

### User Story Dependencies

- **User Story 1 (P1)**: puede implementarse tras Foundational; la ruta que usa ya está disponible por el controller de Foundational (T004).
- **User Story 2 (P1)**: depende además de los puertos y servicios de consulta de 005/007 y amplía el `GetSettlementService` creado en T011.
- **User Story 3 (P2)**: usa los resultados de las consultas y el procesamiento asíncrono; no se declara una dependencia adicional entre historias.

### Within Each User Story

- Ejecutar las pruebas de cada historia antes de su implementación.
- Completar los puertos y adaptadores requeridos antes del servicio que los consume.

## Notes

- Los puertos de liquidación existentes en 007 se reutilizan. 002 agrega únicamente las consultas descritas aquí y no administra índices ni escritura de liquidaciones.
- Las fechas reales de entrada y salida que envía Módulo 1 se ignoran porque el valor de hospedaje sale de la cotización guardada (FR-002 y BR-004 de `generar_liquidacion.md`): una salida anticipada no cambia la liquidación informativa, que coincide con la `Final`.
