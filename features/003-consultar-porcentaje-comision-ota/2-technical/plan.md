# Implementation Plan: Consultar porcentaje de comisión OTA

**Date**: 2026-10-09
**Spec**: [consultar_porcentaje_comision_ota.md](../1-functional/consultar_porcentaje_comision_ota.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Bounded context**: `ota-commission`

## Summary

Módulo 2 y las propias OTA necesitan una referencia histórica, nunca contractual, del porcentaje de comisión aplicado en la liquidación `Final` más reciente de una OTA. Esta feature implementa una **consulta de solo lectura** dentro del *bounded context* `ota-commission`, que lee datos ya persistidos por `settlement` (sin escribir nunca en él y sin que `Generar liquidación` dependa jamás de esta consulta, conforme a BR-004 de la spec 003 y a la regla 5 del plan base). El diseño deja esa separación como una regla estructural de dependencias entre carpetas de código, no solo como una convención documentada.

La OTA se identifica con su `otaId`, el mismo valor que guarda `settlement` (`ota_id`) y que lleva el JWT de la OTA. Módulo 3 no modela ni administra una tabla de OTAs.

## Technical Context

Se hereda el stack y las convenciones de `docs/plan-tecnico-base.md` (NestJS 10 + TypeScript 5, arquitectura hexagonal con una sola capa `domain/`, `application/` e `infrastructure/`, PostgreSQL 16, Prisma ORM, JWT de usuario con Guards por rol, Jest/Supertest/Testcontainers). Específico de esta feature:

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS
**Primary Dependencies**: NestJS 10.x, Prisma ORM (solo lecturas sobre `settlement`), `decimal.js` a través de `CommissionPercentage` (el porcentaje no se maneja como `number`)
**Storage**: no posee tablas propias; lee `settlement` (propiedad del contexto `settlement`, feature 007) en modo exclusivamente de lectura, usando las columnas `ota_id`, `ota_commission_percentage` y `generated_at`
**Testing**: Jest (unitarias de dominio y de aplicación con puertos mockeados), Supertest + Testcontainers (integración de la consulta contra `settlement` real y e2e por rol), `dependency-cruiser` (regla estática de arquitectura)
**Target Platform**: servicio backend Linux en contenedor Docker (bounded context `ota-commission` del monolito modular de Módulo 3)
**Project Type**: servicio backend único (monolito modular hexagonal), sin frontend en este repositorio
**Performance Goals**: no bloquear a Módulo 2 al preparar una reserva (NFR-002); la consulta usa el índice `(ota_id, generated_at DESC)` que define el plan de 007 para esta feature
**Constraints**: solo lectura (BR-002, FR-005); jamás invocada desde `Generar liquidación` (BR-004, FR-003); una OTA solo accede a su propio historial (BR-003, FR-009); el canal directo nunca devuelve 0% (FR-006, NFR-004); el resultado se marca siempre como histórico y referencial (FR-002); no se diseña ninguna respuesta 5xx (plan base)
**Scale/Scope**: un único endpoint de consulta (`GET /ota-commission/{otaId}`), consumido por Módulo 2 (red interna, sin token) y por las OTA (JWT con `role = OTA`)

## Project Structure

### Documentation (this feature)

```text
features/003-consultar-porcentaje-comision-ota/
├── 1-functional/
│   └── consultar_porcentaje_comision_ota.md   # Spec funcional (fuente de verdad de negocio)
└── 2-technical/
    ├── plan.md                                 # Este archivo
    └── contracts/
        └── GET-ota-commission-otaid.md         # Contrato REST de GET /ota-commission/{otaId}
```

### Source Code (repository root)

Solo se listan los archivos propiedad de 003, dentro de la estructura por capas del plan base (`ota-commission` como subcarpeta de cada capa).

```text
src/
├── domain/
│   ├── model/ota-commission/
│   │   └── ota-commission-reference.ts        # { otaId, percentage, settlementId, settlementDate }, inmutable
│   ├── errors/
│   │   ├── commission-not-applicable.error.ts # El identificador consultado es el canal directo, no una OTA (FR-006)
│   │   └── ota-access-denied.error.ts         # Una OTA consulta a otra OTA (BR-003) → 403 FORBIDDEN
│   └── ports/
│       ├── in/
│       │   └── get-latest-ota-commission.use-case.ts   # (otaId, requestingActor) → referencia o "sin historial"
│       └── out/
│           └── ota-commission-query.port.ts    # Solo lectura sobre settlement: findLatestByOtaId(otaId)
│
├── application/
│   └── services/ota-commission/
│       └── get-latest-ota-commission.service.ts   # Regla de acceso por actor (antes de leer) + traducción de "sin historial"
│
└── infrastructure/
    └── adapters/
        ├── in/http/
        │   └── ota-commission.controller.ts   # GET /ota-commission/{otaId}; @Roles("OTA") opcional según haya token (ver Autorización)
        └── out/persistence/
            └── repositories/prisma-ota-commission-query.adapter.ts   # SELECT puro sobre settlement; ninguna escritura

test/
├── unit/application/get-latest-ota-commission.service.spec.ts
├── integration/persistence/prisma-ota-commission-query.adapter.spec.ts   # Testcontainers, datos reales de settlement
├── contract/ota-commission.contract.spec.ts                               # GET /ota-commission/{otaId}
└── e2e/ota-commission.e2e-spec.ts                                         # 200 con y sin historial / 400 / 401 / 403
```

**Structure Decision**: `ota-commission` es un contexto propio cuyo único adaptador saliente lee, sin escribir, la tabla `settlement` del contexto `settlement`, aceptando el acoplamiento de lectura típico de un monolito modular con una única base de datos. La dependencia es **asimétrica**: `ota-commission` puede leer de `settlement`, pero `settlement` nunca puede importar nada de `ota-commission` (BR-004). Se protege con una regla de `dependency-cruiser` ejecutada en CI (Phase 2).

**Nota de coordinación con 007**: el plan base define para esta feature un puerto y un adaptador propios (`ota-commission-query.port.ts`, `prisma-ota-commission-query.adapter.ts`), y este plan los sigue: `ota-commission` lee `settlement` con su propio puerto de lectura y no depende del repositorio de `settlement`. 007 ya no expone `findLatestByOtaId`; solo crea las columnas y el índice `(ota_id, generated_at DESC)` que 003 lee (T002).

## Contrato HTTP

`GET /ota-commission/{otaId}`

### Autorización

| Quién llama | Cómo se identifica | Alcance |
|---|---|---|
| Módulo 2 | Red interna, sin token (plan base) | Cualquier `otaId` |
| OTA | JWT con `role = OTA` y claim `otaId` | Solo su propio `otaId` |
| Administrador u otro rol | JWT de otro rol | Rechazado (403) |

El plan base no distingue entre Módulo 1 y Módulo 2 en las llamadas internas ("ninguna regla de negocio depende de saber qué módulo llama"), por lo que el Guard no valida cuál de los dos es; la spec limita el caso de uso a Módulo 2 y OTA.

Si llega un token, se valida y se aplican las reglas de OTA; si no llega, se trata como llamada interna de un módulo. La comparación `claim.otaId == {otaId}` es una regla de negocio y se hace en el caso de uso (regla 9 del plan base), **antes** de leer `settlement`.

### Respuestas

| Caso | Respuesta | `errorCode` |
|---|---|---|
| OTA con liquidaciones `Final` previas | 200 `{ otaId, percentage, settlementId, settlementDate, historical: true }` | — |
| OTA sin liquidaciones previas | 200 `{ otaId, historical: false }` (sin `percentage` ni `settlementDate`) | — |
| Identificador del canal directo (`DIRECT`), que no es una OTA (FR-006) | 400 | `INVALID_QUERY_PARAMS` |
| Sin token válido en una llamada de OTA | 401 | `UNAUTHENTICATED` |
| OTA consultando a otra OTA, o rol distinto a `OTA` | 403 con mensaje genérico, sin confirmar si la otra OTA tiene historial | `FORBIDDEN` |
| Error inesperado | 422 | `UNEXPECTED_ERROR` |

- `percentage` es un decimal exacto como string (`"15.00"`) y `settlementDate` es la fecha `generated_at` de la liquidación, en UTC (ISO 8601).
- "Sin historial" es un resultado válido (200), no un 404, para no confundirlo con un recurso inexistente (FR-004).
- El caso del canal directo reutiliza `INVALID_QUERY_PARAMS`, que ya existe en la lista de `errorCode` del plan base; no se agrega ningún código nuevo.

---

## Phase 1: Setup (específico de esta feature)

**Purpose**: Dejar listo el adaptador de lectura y el wiring del contexto, sin tocar el esquema de `settlement`

- [ ] T001 Registrar en `src/infrastructure/config/ota-commission.module.ts` el token `OtaCommissionQueryPort` → `PrismaOtaCommissionQueryAdapter` y `GetLatestOtaCommissionUseCase` → `GetLatestOtaCommissionService`
- [ ] T002 Confirmar (no migrar) que `settlement` tiene el índice `(ota_id, generated_at DESC)` y las columnas `ota_id`, `ota_commission_percentage`, `generated_at`, tal como las define el plan de 007; si algo falta, se acuerda con 007 como cambio sobre una tabla de su propiedad

**Checkpoint**: el contexto puede leer `settlement` sin que `settlement` conozca la existencia de `ota-commission`.

---

## Phase 2: Foundational — Regla de arquitectura transversal (BR-004 / FR-003)

**Purpose**: Antes de las historias de usuario, dejar la garantía estructural de que esta consulta nunca se convierte en fuente de datos de `Generar liquidación`. Es la historia de usuario 2 de la spec, pero se resuelve mejor como regla de base.

**⚠️ CRITICAL**: Ninguna historia de usuario de esta feature puede comenzar hasta completar esta fase.

- [ ] T003 [US2] Regla de `dependency-cruiser` (en la configuración de la T004 del plan base): ningún archivo del contexto `settlement` (`domain/model/settlement`, `application/services/settlement`, y los puertos y adaptadores de `settlement`) puede importar nada de los archivos de `ota-commission` en ninguna capa
- [ ] T004 [US2] Hacer que ese chequeo corra en el CI base (T005 del plan base) y falle el build si `GenerateSettlementService` o cualquier caso de uso de `settlement` referencia `GetLatestOtaCommissionUseCase`
- [ ] T005 [US2] Comentario de arquitectura en `get-latest-ota-commission.use-case.ts`: esta consulta es consumidora de `settlement`, nunca al revés (BR-001, BR-004)

**Checkpoint**: Foundation ready — la independencia entre `Generar liquidación` y esta consulta queda verificada por CI y las historias de usuario pueden comenzar.

---

## Phase 3: User Story 1 — Módulo 2 revisa el porcentaje histórico antes de una nueva reserva (Prioridad: P1)

**Goal**: Devolver el porcentaje de la liquidación `Final` más reciente de una OTA, marcado como histórico y referencial, o informar ausencia de historial sin valores por defecto.

**Independent Test**: generar la liquidación `Final` de una reserva OTA con un porcentaje conocido y verificar que la consulta devuelve ese porcentaje y la fecha de esa liquidación; consultar una OTA sin liquidaciones y verificar que se informa ausencia de historial, no 0%.

### Tests for User Story 1

- [ ] T006 [P] [US1] Unit test de `GetLatestOtaCommissionService` con `OtaCommissionQueryPort` mockeado: con un registro devuelve porcentaje y fecha con `historical: true`
- [ ] T007 [P] [US1] Unit test: con el puerto devolviendo `null` retorna (no lanza) `{ otaId, historical: false }`, nunca 0% ni `undefined`
- [ ] T008 [P] [US1] Unit test: un `otaId` del canal directo (`DIRECT`) lanza `CommissionNotApplicableError` sin llamar al puerto (FR-006, NFR-004)
- [ ] T009 [US1] Integration test con Testcontainers: sembrar varias filas de `settlement` de una misma OTA con distintos `generated_at` y verificar que el adaptador devuelve la más reciente; sembrar filas de canal directo y verificar que nunca se devuelven
- [ ] T010 [US1] Contract test `GET /ota-commission/{otaId}`: 200 con `historical: true` y los campos acordados; 200 con `historical: false` y sin `percentage`; 400 `INVALID_QUERY_PARAMS` para el canal directo

### Implementation for User Story 1

- [ ] T011 [US1] Implementar `OtaCommissionReference` (objeto de valor inmutable: `otaId`, `percentage` como decimal exacto, `settlementId`, `settlementDate`)
- [ ] T012 [US1] Definir `OtaCommissionQueryPort.findLatestByOtaId(otaId): Promise<OtaCommissionReference | null>` en `domain/ports/out`
- [ ] T013 [US1] Implementar `GetLatestOtaCommissionService(otaId, requestingActor)`: valida el `otaId` (canal directo → error), aplica la regla de acceso (Phase 4), invoca el puerto y traduce `null` a un resultado explícito "sin historial"
- [ ] T014 [US1] Implementar `PrismaOtaCommissionQueryAdapter`: `SELECT` puro sobre `settlement` filtrando `ota_id` y `channel = 'OTA'`, `ORDER BY generated_at DESC LIMIT 1`; ninguna escritura, ni siquiera transaccional
- [ ] T015 [US1] Implementar `OtaCommissionController` (`GET /ota-commission/{otaId}`) marcando siempre la respuesta como histórica y referencial, no contractual (FR-002)
- [ ] T016 [US1] Registrar `CommissionNotApplicableError` → 400 `INVALID_QUERY_PARAMS` en el `ExceptionFilter` global

**Checkpoint**: Módulo 2 puede consultar el historial de comisión de cualquier OTA, con o sin liquidaciones previas, sin ambigüedad.

---

## Phase 4: User Story 3 — La OTA verifica su propio porcentaje de comisión (Prioridad: P2)

**Goal**: Permitir que una OTA consulte únicamente su propio historial, rechazando el acceso al de otra OTA.

**Independent Test**: como una OTA, consultar el propio porcentaje y verificar que coincide con lo liquidado; intentar consultar el de otra OTA y verificar el rechazo sin fuga de datos.

### Tests for User Story 3

- [ ] T017 [P] [US3] Unit test de autorización: actor OTA con `otaId` distinto al del parámetro → `OtaAccessDeniedError`, sin llegar a invocar el puerto de lectura (evita fuga por tiempo de respuesta o por existencia)
- [ ] T018 [P] [US3] Unit test: actor interno (Módulo 2) puede consultar cualquier `otaId`
- [ ] T019 [US3] Test e2e: OTA consultando su propio `otaId` → 200; OTA consultando un `otaId` ajeno → 403 con el mismo cuerpo exista o no historial de la otra OTA; sin token → 401 en la llamada de OTA; token con rol `Administrador` → 403

### Implementation for User Story 3

- [ ] T020 [US3] En `OtaCommissionController`, aplicar la lectura del token cuando existe: con token, validar con `RolesGuard` que `role = OTA` y extraer el claim `otaId`; sin token, tratar la llamada como interna (plan base, sección Autorización)
- [ ] T021 [US3] En `GetLatestOtaCommissionService`, aplicar la regla de alcance (BR-003, FR-009): si el actor es OTA, exigir `actor.otaId === otaId` y lanzar `OtaAccessDeniedError` en caso contrario, **antes** de tocar el puerto de lectura
- [ ] T022 [US3] Registrar `OtaAccessDeniedError` → 403 `FORBIDDEN` en el `ExceptionFilter` global, con mensaje genérico que no confirme ni niegue la existencia de historial de la OTA ajena

**Checkpoint**: una OTA nunca puede ver el porcentaje de comisión de otra OTA, ni siquiera por un mensaje de error distinto.

---

## Phase 5: Casos límite (FR-004, FR-006, FR-008, NFR-001, NFR-004)

**Purpose**: Cubrir los casos límite de la spec que no son el camino feliz de US1 y US3.

- [ ] T023 [P] Unit test de determinismo: dos invocaciones consecutivas sobre el mismo `otaId`, sin liquidaciones nuevas, devuelven exactamente el mismo resultado (NFR-001, FR-008)
- [ ] T024 [P] Test: la misma OTA con liquidaciones de porcentajes distintos en el tiempo devuelve el de la más reciente, sin promediar ni elegir uno arbitrario
- [ ] T025 Confirmar que el adaptador de lectura no aplica ningún TTL de caché que pueda "expirar" una liquidación antigua: una OTA cuya única liquidación es muy antigua sigue devolviendo ese dato como la referencia más reciente
- [ ] T026 Test de intento de escritura: verificar que ningún método del puerto ni del adaptador puede crear, actualizar o corregir porcentajes (FR-005, SC-004)

**Checkpoint**: todos los casos límite de la spec están representados en código y pruebas.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T027 Documentación OpenAPI de `GET /ota-commission/{otaId}` (actores autorizados, forma del 200 con `historical: true|false`, y los 400, 401 y 403)
- [ ] T028 Verificar la privacidad (NFR-003): el payload de respuesta contiene solo `{ otaId, percentage, settlementId, settlementDate, historical }`, sin datos del huésped ni de liquidaciones de otras OTA
- [ ] T029 Revisar con el responsable de 007 el índice `(ota_id, generated_at DESC)` y el volumen real de liquidaciones, una vez que existan datos

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: depende de que `settlement` (feature 007) ya tenga su tabla creada con las columnas y el índice indicados (Phase 4 del plan base). Si `settlement` aún no está implementado, esta feature puede avanzar con un doble de prueba de `OtaCommissionQueryPort`; la integración real (T009) queda bloqueada hasta que exista la tabla.
- **Foundational (Phase 2)**: depende de Setup; BLOQUEA todas las historias de usuario. Debe hacerse temprano porque protege el resto del desarrollo.
- **User Story 1 (Phase 3)**: depende de Phase 1 y 2. Es la vía principal de valor.
- **User Story 3 (Phase 4)**: depende de Phase 3 (reutiliza `GetLatestOtaCommissionService`) y añade la capa de autorización por actor.
- **Casos límite (Phase 5)**: depende de Phase 3.
- **Polish (Phase 6)**: depende de las Phases 3 a 5.

### User Story Dependencies

- **User Story 1 (P1)**: puede comenzar después de Foundational (Phase 2); no depende de otras historias.
- **User Story 2 (P2)**: se resuelve en Foundational (Phase 2) como regla de arquitectura; no tiene código propio de negocio y protege a las demás.
- **User Story 3 (P2)**: puede comenzar después de Foundational; reutiliza `GetLatestOtaCommissionService` de US1 para añadir la autorización por actor, pero sus pruebas de acceso son independientes.

### Within Each User Story

- Pruebas de la historia primero, escritas antes de su implementación.
- Modelo (`OtaCommissionReference`) antes de puertos, puertos antes del servicio de aplicación, servicio antes del controller y del adaptador.
- La regla de acceso por actor se implementa en el servicio, antes de que el puerto de lectura se invoque.
- Historia completa y verificada antes de pasar a la siguiente prioridad.

### Nota de secuenciación con el plan base

El plan base ubica `ota-commission` en la Phase 6 (T023), después de `settlement`, porque esta consulta necesita liquidaciones `Final` reales para tener datos que leer. El plan puede desarrollarse antes a nivel de código (contra un doble del puerto), pero su prueba de integración real y su habilitación dependen de que `settlement` (features 007, 010 y 002) ya genere liquidaciones.

## Notes

- [Story] mapea cada tarea a su historia de usuario para trazabilidad con la spec funcional.
- La asimetría de dependencia (`ota-commission` lee de `settlement`, nunca al revés) es la decisión de diseño más importante y está protegida por una regla de CI (T003 y T004), no solo por documentación.
- Decisión de diseño que no viene de la spec (queda documentada aquí y en el contrato `GET-ota-commission-otaid.md`; cambiarla no altera la spec funcional): **cómo se reconoce el canal directo** en `{otaId}`. Este plan usa el valor reservado `DIRECT` (el mismo del campo `channel` de `settlement`), porque sin él FR-006 no se puede implementar.
- El **puerto propio** de lectura (`ota-commission-query.port.ts`) lo define el plan base y no es una decisión de esta feature; 007 ya no expone una consulta equivalente y solo crea las columnas y el índice que este puerto lee (ver la nota de coordinación en Structure Decision).
- Cualquier conflicto entre este plan y la spec funcional (`1-functional/consultar_porcentaje_comision_ota.md`) se resuelve a favor de la spec, conforme a la nota final de `docs/plan-tecnico-base.md`.
