# Implementation Plan: Actualizar porcentaje de IVA

**Date**: 2026-10-09
**Spec**: [actualizar_porcentaje_iva.md](../1-functional/actualizar_porcentaje_iva.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Bounded context**: `billing`

## Summary

El Administrador necesita mantener un único porcentaje de IVA vigente, con el que `Generar factura final` (006) calcula el IVA de cada factura en el momento de su emisión (FR-002 de `generar_factura_final.md`). Esta feature implementa el caso de uso `UpdateVatRateUseCase` dentro del *bounded context* `billing`: valida el nuevo porcentaje (0 a 100, ambos inclusive), lo registra como vigente de forma atómica (nunca dos porcentajes vigentes simultáneos), deja trazabilidad de quién y cuándo hizo el cambio, y expone el valor vigente mediante `GetCurrentVatRateUseCase`, la única vía por la que 006 lo lee.

**No existe un valor inicial** (decisión de la spec 001): mientras el Administrador no registre el primer porcentaje, `GetCurrentVatRateUseCase` falla con `VatRateUnavailableError` y 006 no emite facturas ni asume un valor por defecto. El primer registro y las actualizaciones siguientes usan la misma operación.

Una actualización nunca puede alterar facturas ya emitidas: 006 guarda el porcentaje aplicado en la propia factura (`vat_rate_applied`) y no mantiene ninguna referencia viva a `vat_rate`.

## Technical Context

Se hereda el stack y las convenciones de `docs/plan-tecnico-base.md` (NestJS 10 + TypeScript 5, arquitectura hexagonal con una sola capa `domain/`, `application/` e `infrastructure/`, PostgreSQL 16, Prisma ORM, JWT de usuario con Guards por rol, Jest/Supertest/Testcontainers). Específico de esta feature:

**Primary Dependencies**: NestJS 10.x, Prisma ORM, `class-validator` (validación rápida del DTO de entrada), `decimal.js` (aritmética decimal exacta, a través del value object del porcentaje)
**Storage**: PostgreSQL 16 — tabla `vat_rate` (fila única, `id` fijo; vacía hasta el primer registro) + `vat_rate_history` (insert-only, auditoría)
**Testing**: Jest (unitarias de dominio y de aplicación con puertos mockeados), Supertest + Testcontainers (endpoint, persistencia y concurrencia real sobre Postgres), prueba de contrato del puerto consumido por 006
**Target Platform**: servicio backend Linux en contenedor Docker (bounded context `billing` del monolito modular de Módulo 3)
**Project Type**: servicio backend único (monolito modular hexagonal), sin frontend en este repositorio
**Performance Goals**: disponibilidad inmediata del nuevo porcentaje para las operaciones posteriores (NFR-003), sin caché con TTL que retrase la propagación
**Constraints**: porcentaje decimal exacto entre 0 y 100, con a lo sumo 2 decimales (FR-002, NFR-004); un único porcentaje vigente una vez configurado y ninguno por defecto (FR-003, BR-003); una actualización nunca toca ni recalcula facturas ya emitidas (BR-002, FR-004); actualizaciones concurrentes sin estado ambiguo (FR-007, NFR-002); solo el rol `Administrador` puede actualizar (FR-006, BR-001); no se diseña ninguna respuesta 5xx (plan base)
**Scale/Scope**: un único endpoint administrativo de baja frecuencia (`PUT /admin/vat-rate`) y un puerto interno de lectura consumido por 006

## Project Structure

### Documentation (this feature)

```text
features/001-actualizar-porcentaje-iva/
├── 1-functional/
│   └── actualizar_porcentaje_iva.md   # Spec funcional (fuente de verdad de negocio)
└── 2-technical/
    ├── plan.md                        # Este archivo
    └── contracts/
        └── PUT-admin-vat-rate.md      # Contrato REST de PUT /admin/vat-rate
```

El contrato del puerto `GetCurrentVatRateUseCase` que consume 006 ya está documentado en `features/006-generar-factura-final/2-technical/contracts/PORT-get-current-vat-rate.md`; este plan lo implementa sin modificarlo.

### Source Code (repository root)

Solo se listan los archivos propiedad de 001, dentro de la estructura por capas del plan base (`billing` como subcarpeta de cada capa).

```text
src/
├── domain/
│   ├── model/billing/
│   │   ├── vat-rate.ts                        # Entidad VatRate (porcentaje vigente, actualizador, fecha)
│   │   └── vat-rate-value.vo.ts               # VO decimal exacto 0..100, máx. 2 decimales (constantes VAT_RATE_MIN / VAT_RATE_MAX)
│   ├── errors/
│   │   ├── invalid-vat-rate.error.ts          # INVALID_VAT_RATE (ya definido en el plan base)
│   │   └── vat-rate-unavailable.error.ts      # No hay porcentaje configurado, o la lectura falló (lo exige el contrato con 006)
│   └── ports/
│       ├── in/
│       │   ├── update-vat-rate.use-case.ts        # PUT /admin/vat-rate
│       │   └── get-current-vat-rate.use-case.ts   # Lectura interna: getCurrent(): Promise<VatRate>
│       └── out/
│           └── vat-rate.repository.port.ts        # getCurrent() / saveNew(value, actorId)
│
├── application/
│   ├── services/billing/
│   │   ├── update-vat-rate.service.ts         # Valida con el VO y delega la escritura atómica al puerto
│   │   └── get-current-vat-rate.service.ts    # Solo lectura; falla si no hay porcentaje configurado
│   └── dto/billing/
│       └── update-vat-rate.command.ts         # { value: string decimal, actorId }
│
└── infrastructure/
    └── adapters/
        ├── in/http/
        │   ├── vat-rate-admin.controller.ts   # PUT /admin/vat-rate, con @Roles("Administrador") y el RolesGuard del plan base
        │   └── dto/update-vat-rate.dto.ts     # { value } con class-validator como primer filtro
        └── out/persistence/
            ├── mappers/vat-rate.mapper.ts             # Dominio <-> modelo Prisma
            └── repositories/prisma-vat-rate.repository.ts  # Implementa el puerto: una transacción (lock + upsert + historial)

prisma/
├── schema.prisma                              # Modelos VatRate y VatRateHistory
└── migrations/
    └── <timestamp>_create_vat_rate_tables/    # vat_rate (sin fila inicial) + vat_rate_history

test/
├── unit/domain/vat-rate-value.vo.spec.ts
├── unit/application/update-vat-rate.service.spec.ts
├── unit/application/get-current-vat-rate.service.spec.ts
├── integration/persistence/prisma-vat-rate.repository.spec.ts   # incluye la prueba de concurrencia real (Testcontainers)
├── contract/get-current-vat-rate.port.spec.ts                   # contrato con 006
└── e2e/vat-rate.e2e-spec.ts                                     # PUT /admin/vat-rate: 200 / 400 / 401 / 403
```

**Structure Decision**: 001 vive dentro de `billing`; no crea un *bounded context* nuevo ni adaptadores salientes hacia otros módulos. Reutiliza el `ExceptionFilter` global (`domain-exception.filter.ts`) y el `RolesGuard` con el decorador `@Roles(...)` de `src/infrastructure/adapters/in/http/auth/`, definidos en el plan base (Phase 2).

## Contrato HTTP

`PUT /admin/vat-rate` — solo JWT con `role = Administrador`.

| Caso | Respuesta | `errorCode` |
|---|---|---|
| Actualización válida | 200 con `{ value, updatedBy, updatedAt }` | — |
| Valor negativo, mayor a 100, no numérico o con más de 2 decimales | 400 | `INVALID_VAT_RATE` |
| Sin token o token inválido | 401 | `UNAUTHENTICATED` |
| Token de un rol distinto a `Administrador` (por ejemplo `OTA`) | 403 | `FORBIDDEN` |
| Error inesperado | 422 | `UNEXPECTED_ERROR` (el plan base no define respuestas 5xx) |

El valor viaja y se almacena como decimal exacto (`"19.00"`), no como `number` de coma flotante.

---

## Phase 1: Setup (específico de esta feature)

**Purpose**: Preparar persistencia y wiring del contexto `billing` para el IVA

- [ ] T001 Definir los modelos `VatRate` y `VatRateHistory` en `prisma/schema.prisma` y crear la migración Prisma de `vat_rate` (fila única: `id` fijo, `value numeric(5,2)`, `updated_by`, `updated_at` (hora de la base de datos, `now()`), con `CHECK (value >= 0 AND value <= 100)` escrito como SQL manual dentro de la migración, porque Prisma no genera constraints CHECK), **sin valor inicial**: la tabla queda vacía hasta el primer registro del Administrador
- [ ] T002 Crear la migración Prisma de `vat_rate_history` (insert-only: `id`, `value_before numeric(5,2)` nulo en el primer registro, `value_after numeric(5,2)`, `changed_by`, `changed_at` con la hora de la base de datos `now()`, no la del servidor de aplicación: marca de tiempo verificable, NFR-001)
- [ ] T003 Registrar en `src/infrastructure/config/billing.module.ts` los tokens `VatRateRepositoryPort` → `PrismaVatRateRepository`, `UpdateVatRateUseCase` → `UpdateVatRateService` y `GetCurrentVatRateUseCase` → `GetCurrentVatRateService`

**Checkpoint**: el esquema existe sin ningún porcentaje; el dominio puede operar sobre el puerto.

---

## Phase 2: User Story 1 — El Administrador actualiza el porcentaje de IVA vigente (Prioridad: P1)

**Goal**: Permitir al Administrador registrar o actualizar el porcentaje vigente, validando el rango y rechazando valores inválidos sin tocar el porcentaje anterior.

**Independent Test**: registrar un porcentaje válido y verificar que `GetCurrentVatRateUseCase` devuelve el nuevo valor; intentar un valor negativo o fuera de rango y verificar que el vigente no cambia.

### Tests for User Story 1

- [ ] T004 [P] [US1] Unit test del VO `VatRateValue` (`vat-rate-value.vo.spec.ts`): acepta `0` y `100` (ambos inclusive) y valores con hasta 2 decimales; rechaza negativos, mayores a 100, no numéricos y más de 2 decimales (FR-002, NFR-004)
- [ ] T005 [P] [US1] Unit test de `UpdateVatRateService`: delega la validación al VO, invoca el puerto solo si el valor es válido y no lo invoca si es inválido (FR-002)
- [ ] T006 [US1] Test e2e de `PUT /admin/vat-rate`: 200 con valor válido, 400 `INVALID_VAT_RATE` con valor inválido, 401 sin token, 403 con rol `OTA` (SC-003, SC-005)

### Implementation for User Story 1

- [ ] T007 [US1] Implementar `VatRateValue` (decimal exacto con `decimal.js`, constantes `VAT_RATE_MIN = 0` y `VAT_RATE_MAX = 100`) y `InvalidVatRateError`
- [ ] T008 [US1] Definir `VatRateRepositoryPort` (`getCurrent(): Promise<VatRate | null>`, `saveNew(value, actorId): Promise<VatRate>`) en `domain/ports/out`
- [ ] T009 [US1] Implementar `UpdateVatRateService(actorId, value)`: construye `VatRateValue` (la validación de dominio falla aquí) y llama al repositorio
- [ ] T010 [US1] Implementar `PrismaVatRateRepository.saveNew` en **una sola transacción**: (a) `pg_advisory_xact_lock` para serializar todas las actualizaciones, incluido el primer registro cuando la tabla aún está vacía; (b) leer el valor actual (puede no existir); (c) `upsert` de la fila única de `vat_rate`; (d) `INSERT` en `vat_rate_history` con `value_before` (nulo en el primer registro). Si el insert del historial falla, se revierte toda la transacción (FR-005)
- [ ] T011 [US1] Implementar `VatRateAdminController` (`PUT /admin/vat-rate`) con `@Roles("Administrador")` (`RolesGuard`) y `UpdateVatRateDto` validado con `class-validator` como primer filtro rápido
- [ ] T012 [US1] Registrar `InvalidVatRateError` → 400 `INVALID_VAT_RATE`, y los casos de autenticación → 401 `UNAUTHENTICATED` y rol insuficiente → 403 `FORBIDDEN`, en el `ExceptionFilter` global

**Checkpoint**: el Administrador puede registrar y actualizar el porcentaje; los valores inválidos se rechazan sin alterar el estado.

---

## Phase 3: User Story 2 — Un cambio de porcentaje nunca afecta facturas ya emitidas (Prioridad: P1)

**Goal**: Garantizar que `UpdateVatRateUseCase` nunca toca ni recalcula una factura ya emitida, y que 006 siempre usa el porcentaje vigente en el instante de la emisión.

**Independent Test**: con una factura simulada que ya tiene `vat_rate_applied` persistido, actualizar el porcentaje vigente y verificar que esa factura conserva su desglose original.

### Tests for User Story 2

- [ ] T013 [P] [US2] Test de arquitectura (`dependency-cruiser`): `UpdateVatRateService` y su repositorio no importan nada del agregado `Invoice` ni de `settlement`; solo operan sobre `vat_rate` y `vat_rate_history`
- [ ] T014 [US2] Integration test: con una fila de `invoice` simulada con `vat_rate_applied` ya persistido, actualizar `vat_rate` y verificar que el `vat_rate_applied` de esa factura no cambia (SC-002)
- [ ] T015 [US2] Integration test de concurrencia real con Testcontainers: dos actualizaciones casi simultáneas, **incluido el caso en que la tabla está vacía**; el resultado final es exactamente uno de los dos valores, el historial refleja una secuencia coherente (`value_before` de la segunda = `value_after` de la primera) y nunca queda un estado mixto (FR-007, NFR-002)
- [ ] T016 [US2] Unit test de `GetCurrentVatRateService`: devuelve el porcentaje vigente; sin porcentaje configurado lanza `VatRateUnavailableError`, sin devolver 0 ni un valor por defecto (FR-003, BR-003)
- [ ] T016a [US2] Integration test del caso límite "una factura se está generando en el instante de una actualización": 006 lee el porcentaje una sola vez (antes de su transacción) y la factura queda con exactamente uno de los dos porcentajes, anterior o nuevo, nunca una mezcla ni un valor indeterminado (BR-003)
- [ ] T017 [US2] Contract test del puerto `GetCurrentVatRateUseCase` contra `PORT-get-current-vat-rate.md` de 006: `getCurrent()` sin argumentos, `value` como decimal exacto (`"19.00"`), y los errores del contrato

### Implementation for User Story 2

- [ ] T018 [US2] Implementar `GetCurrentVatRateService` como el **único** punto por el que `billing` (incluida 006) obtiene el porcentaje vigente; `vat_rate` nunca se expone como tabla de lectura fuera de este puerto. Si el repositorio no tiene ninguna fila, lanza `VatRateUnavailableError`
- [ ] T019 [US2] Documentar en `vat-rate.repository.port.ts` que `Invoice` guarda el porcentaje aplicado como campo propio (`vat_rate_applied`) en el momento de la emisión, nunca como referencia viva a `vat_rate`: esa es la garantía estructural de BR-002 y FR-004, no una validación en tiempo de ejecución
- [ ] T020 [US2] Regla de `dependency-cruiser`: el código de emisión de facturas (006) solo puede consumir `GetCurrentVatRateUseCase`, nunca `UpdateVatRateUseCase` ni `VatRateRepositoryPort`

**Checkpoint**: una actualización de IVA es indiferente para toda factura ya persistida; el mecanismo es estructural.

---

## Phase 4: Casos límite y trazabilidad (NFR-001, FR-005, FR-007)

**Purpose**: Cubrir los casos límite de la spec que no quedan cubiertos por las historias principales.

- [ ] T021 Decisión de diseño: una actualización a un valor **idéntico** al vigente se acepta y **sí** genera una entrada de historial (consistente con FR-005: toda actualización exitosa queda trazada, sin excepción)
- [ ] T022 Si la inserción en `vat_rate_history` falla por cualquier motivo, la transacción completa se revierte y la actualización se reporta como fallida: no se permite un cambio del vigente sin su traza correspondiente
- [ ] T023 [P] Unit/integration test del caso "valor idéntico al vigente" y del caso "fallo al escribir historial → rollback completo"
- [ ] T024 [P] Test del caso "sin ningún porcentaje configurado": `GetCurrentVatRateUseCase` falla, y el primer `PUT /admin/vat-rate` registra el porcentaje con `value_before` nulo en el historial (spec: estado inicial sin porcentaje)

**Checkpoint**: todos los casos límite de la spec quedan representados en código y pruebas.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T025 Documentación OpenAPI de `PUT /admin/vat-rate` (payload, 200/400/401/403/422), publicada junto con el resto de contratos REST de Módulo 3
- [ ] T026 Logging estructurado del evento de actualización (actor, valor anterior, valor nuevo, timestamp), sin duplicar lo que ya persiste `vat_rate_history`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: depende de que las Fases 1 y 2 del plan base (scaffolding NestJS, Prisma, login propio y Guards por rol, `ExceptionFilter` global) estén resueltas; no se repiten aquí.
- **User Story 1 (Phase 2)**: depende solo de Setup. Es la vía principal de valor y puede entregarse de forma independiente.
- **User Story 2 (Phase 3)**: depende de Setup. Debe completarse antes de que 006 dependa de `GetCurrentVatRateUseCase`.
- **Casos límite (Phase 4)**: depende de Phase 2 (reutiliza el mismo flujo transaccional).
- **Polish (Phase 5)**: depende de las Phases 2 a 4.

### Dependencia cruzada con otras features

- **006 Generar factura final** consume `GetCurrentVatRateUseCase` según el contrato `PORT-get-current-vat-rate.md`. El plan base ordena 001 antes de 006 en la Phase 5 (T020 → T021).

## Notes

- [Story] mapea cada tarea a su historia de usuario para trazabilidad con la spec funcional.
- La concurrencia (NFR-002) se resuelve con un `pg_advisory_xact_lock` dentro de la transacción, porque con la tabla vacía no hay fila que bloquear en el primer registro; no se introduce locking optimista (versión/ETag) porque el requisito es "una sola queda vigente de forma consistente", no "rechazar la segunda escritura".
- Decisión de diseño que no viene de la spec (queda documentada aquí y en el contrato `PUT-admin-vat-rate.md`; cambiarla no altera la spec funcional): el **máximo de 2 decimales** (alineado con `numeric(5,2)` y con `vat_rate_applied` de 006); sin un límite, un valor como 19.555 se redondearía en silencio.
- El `pg_advisory_xact_lock` es un detalle de implementación, no una decisión de negocio: no cambia ningún comportamiento visible de la spec.
- Cualquier conflicto entre este plan y la spec funcional (`1-functional/actualizar_porcentaje_iva.md`) se resuelve a favor de la spec, conforme a la nota final de `docs/plan-tecnico-base.md`.
