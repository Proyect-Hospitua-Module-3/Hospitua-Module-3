# Implementation Plan: Actualizar porcentaje de IVA

**Date**: 2026-10-01
**Spec**: `features/001-actualizar-porcentaje-iva/1-functional/actualizar_porcentaje_iva.md`
**Base técnica del proyecto**: `docs/plan-tecnico-base.md`
**Bounded context**: `billing`

## Summary

El Administrador necesita mantener un único porcentaje de IVA vigente, con el que `Generar factura final` (006) calcula el IVA de cada factura en el momento de su emisión (FR-002 de `generar_factura_final.md`). Esta feature implementa el caso de uso `UpdateVatRateUseCase` dentro del *bounded context* `billing` ya definido en el plan técnico base: valida el nuevo porcentaje, lo registra como vigente de forma atómica (garantizando que nunca exista un estado sin porcentaje ni dos porcentajes vigentes simultáneos), deja trazabilidad de quién y cuándo hizo el cambio, y expone el valor vigente como una consulta interna que reutilizará `Generar factura final` — sin que una actualización posterior pueda alterar facturas ya emitidas, porque éstas nunca leen el valor vigente retroactivamente.

## Technical Context

Se hereda íntegramente el stack y las convenciones de `docs/plan-tecnico-base.md` (NestJS 10 + TypeScript 5, arquitectura hexagonal, PostgreSQL 16, TypeORM, JWT con Guards por actor, Jest/Supertest/Testcontainers). Específico de esta feature:

**Primary Dependencies**: `@nestjs/common`, `class-validator` (validación de DTO de entrada), TypeORM (transacción sobre una sola fila + tabla de historial)
**Storage**: PostgreSQL — tabla `vat_rate` (fila única, vigente) + `vat_rate_history` (insert-only, auditoría)
**Testing**: Jest (unitarias de dominio), Supertest + Testcontainers (integración del endpoint y de la concurrencia real sobre Postgres)
**Target Platform**: servicio NestJS backend (módulo `billing` del monolito modular de Módulo 3)
**Performance Goals**: disponibilidad inmediata del nuevo porcentaje para operaciones posteriores (NFR-003) — sin caché con TTL que retrase la propagación
**Constraints**: exactamente un porcentaje vigente en todo momento (BR-003); una actualización nunca debe tocar ni recalcular facturas ya emitidas (BR-002/FR-004); concurrencia sin estado ambiguo (NFR-002)
**Scale/Scope**: un único endpoint administrativo de baja frecuencia (`PUT /admin/vat-rate`), consumido internamente por `billing` en el momento de emitir cada factura

## Project Structure

### Documentation (this feature)

```text
features/001-actualizar-porcentaje-iva/
├── 1-functional/
│   └── actualizar_porcentaje_iva.md   # Spec (ya existente)
└── 2-technical/
    └── plan.md                        # Este archivo
```

### Source Code (repositorio, dentro del monolito modular `billing`)

```text
src/billing/
├── domain/
│   ├── vat-rate.entity.ts             # Entidad de dominio VatRate (value, validación de rango)
│   ├── vat-rate-history.entity.ts     # Entrada de historial (valor anterior, nuevo, actor, fecha)
│   ├── errors/
│   │   └── invalid-vat-rate.error.ts  # InvalidVatRateError (rango inválido)
│   └── ports/
│       └── vat-rate-repository.port.ts # VatRateRepositoryPort (getCurrent / updateCurrent)
│
├── application/
│   ├── update-vat-rate.use-case.ts    # UpdateVatRateUseCase
│   └── get-current-vat-rate.use-case.ts # GetCurrentVatRateUseCase (consumido por 006 Generar factura final)
│
└── infrastructure/
    ├── inbound/
    │   ├── vat-rate.controller.ts     # PUT /admin/vat-rate (AdminGuard)
    │   └── dto/update-vat-rate.dto.ts # { value: number } con class-validator
    └── outbound/
        └── typeorm-vat-rate.repository.ts # Implementa el puerto: transacción (UPDATE fila única + INSERT historial)

migrations/
└── NNNN-create-vat-rate-tables.ts     # vat_rate (fila única, seed inicial obligatorio) + vat_rate_history

test/
├── unit/billing/vat-rate.entity.spec.ts
├── unit/billing/update-vat-rate.use-case.spec.ts
├── integration/billing/vat-rate.repository.spec.ts   # incluye prueba de concurrencia real (Testcontainers)
└── e2e/billing/vat-rate.e2e-spec.ts                  # PUT /admin/vat-rate: 200 / 400 / 403
```

**Structure Decision**: esta feature vive dentro del hexágono `billing` ya definido en `docs/plan-tecnico-base.md` (no crea un *bounded context* nuevo). Reutiliza el `AdminGuard` y el `ExceptionFilter` de `shared-kernel`. No requiere adaptadores salientes hacia otros módulos: es puramente interna a Módulo 3.

---

## Phase 1: Setup (específico de esta feature)

**Purpose**: Preparar persistencia y wiring del módulo `billing` para el sub-dominio de IVA

- [ ] T001 Crear migración `vat_rate` (fila única: `id` fijo, `value numeric(5,2)`, `updated_by`, `updated_at`) con **seed obligatorio** de un valor inicial (BR-003: nunca debe existir un estado sin porcentaje configurado)
- [ ] T002 Crear migración `vat_rate_history` (insert-only: `id`, `value_before`, `value_after`, `changed_by`, `changed_at`)
- [ ] T003 Registrar `VatRateModule` (o sub-módulo dentro de `BillingModule`) con el token de inyección para `VatRateRepositoryPort` → `TypeOrmVatRateRepository`

**Checkpoint**: tabla con valor vigente garantizado desde el despliegue inicial, lista para que el dominio opere.

---

## Phase 2: User Story 1 — El Administrador actualiza el porcentaje de IVA vigente (Prioridad: P1)

**Goal**: Permitir al Administrador actualizar el porcentaje vigente, validando rango y rechazando valores inválidos sin tocar el porcentaje anterior.

**Independent Test**: actualizar el porcentaje a un valor válido y verificar que una operación posterior que consulte el vigente obtiene el nuevo valor; intentar un valor negativo o fuera de rango y verificar que el vigente no cambia.

### Tests for User Story 1

- [ ] T004 [P] [US1] Unit test de `VatRate` (dominio): acepta 0 ≤ value ≤ 100 (rango tributario confirmado: el IVA nunca es negativo ni supera el 100%), rechaza valores negativos y valores mayores a 100 — `test/unit/billing/vat-rate.entity.spec.ts`
- [ ] T005 [P] [US1] Unit test de `UpdateVatRateUseCase`: delega la validación a `VatRate`, invoca el puerto solo si es válido — `test/unit/billing/update-vat-rate.use-case.spec.ts`
- [ ] T006 [US1] Contract test `PUT /admin/vat-rate`: 200 con valor válido, 400 con valor inválido (negativo / fuera de rango), 403 si el actor no es Administrador — `test/e2e/billing/vat-rate.e2e-spec.ts`

### Implementation for User Story 1

- [ ] T007 [US1] Implementar entidad de dominio `VatRate` con invariante de rango y `InvalidVatRateError`
- [ ] T008 [US1] Implementar `VatRateRepositoryPort` (`getCurrent(): Promise<VatRate>`, `updateCurrent(newValue, actorId): Promise<VatRate>`) en `domain/ports`
- [ ] T009 [US1] Implementar `UpdateVatRateUseCase(actorId, newValue)`: construye `VatRate` (dispara validación de dominio si falla) y llama `repository.updateCurrent`
- [ ] T010 [US1] Implementar `TypeOrmVatRateRepository.updateCurrent`: **una sola transacción** que (a) hace `UPDATE` de la fila única de `vat_rate` (el bloqueo de fila de PostgreSQL serializa automáticamente actualizaciones concurrentes — ver NFR-002 más abajo) y (b) inserta la fila correspondiente en `vat_rate_history`; si el insert de historial falla, se revierte toda la transacción (FR-005: no se acepta una actualización sin trazabilidad)
- [ ] T011 [US1] Implementar `VatRateController` (`PUT /admin/vat-rate`) con `AdminGuard` (valida claim de actor `Administrador` del JWT) y `UpdateVatRateDto` validado con `class-validator` como primer filtro rápido (antes de llegar al dominio)
- [ ] T012 [US1] Mapear `InvalidVatRateError` → 400 y falta de rol admin → 403 en el `ExceptionFilter` compartido de `shared-kernel`

**Checkpoint**: el Administrador puede actualizar el porcentaje vigente; valores inválidos se rechazan sin alterar el estado.

---

## Phase 3: User Story 2 — Un cambio de porcentaje nunca afecta facturas ya emitidas (Prioridad: P1)

**Goal**: Garantizar que `UpdateVatRateUseCase` nunca toca ni recalcula una factura ya emitida, y que `Generar factura final` (006) siempre usa el porcentaje vigente en el instante de la emisión, no uno recalculado después.

**Independent Test**: emitir (o simular) una factura con un porcentaje de IVA conocido, actualizar el porcentaje vigente a otro valor, y verificar que la factura ya emitida conserva su desglose original.

### Tests for User Story 2

- [ ] T013 [P] [US2] Unit test: `UpdateVatRateUseCase` solo opera sobre `vat_rate`/`vat_rate_history`; no referencia ni importa el agregado `Invoice` (verificable por diseño — se documenta como regla de dependencia, no solo se prueba)
- [ ] T014 [US2] Integration test: con una fila de `invoice` simulada que ya tiene `vatRateApplied` persistido (denormalizado en el momento de su emisión por 006), actualizar el `vat_rate` vigente y verificar que el `vatRateApplied` de esa factura no cambia — `test/integration/billing/vat-rate.repository.spec.ts`
- [ ] T015 [US2] Integration test de concurrencia real con Testcontainers: lanzar dos actualizaciones casi simultáneas sobre el mismo `vat_rate` y verificar que el resultado final es exactamente uno de los dos valores (nunca un estado corrupto o mixto), aprovechando el bloqueo de fila de PostgreSQL

### Implementation for User Story 2

- [ ] T016 [US2] Implementar `GetCurrentVatRateUseCase` (query de solo lectura) como el **único** punto por el que `billing` (incluida la futura feature 006 `Generar factura final`) obtiene el porcentaje vigente — nunca se expone `vat_rate` como tabla de lectura directa fuera de este puerto
- [ ] T017 [US2] Documentar explícitamente (comentario de arquitectura en `vat-rate.repository.port.ts` o regla de `dependency-cruiser`) que `Invoice` almacena el IVA aplicado como campo propio en el momento de la emisión (denormalizado), nunca como referencia viva a `vat_rate` — esta es la garantía estructural de BR-002/FR-004, no una validación en tiempo de ejecución
- [ ] T018 [US2] Regla de `dependency-cruiser`: prohibir que `billing/domain` o `billing/application` de la emisión de factura importen `UpdateVatRateUseCase` (solo pueden consumir `GetCurrentVatRateUseCase`)

**Checkpoint**: una actualización de IVA es indiferente para toda factura ya persistida; el mecanismo que lo garantiza es estructural (denormalización), no un chequeo adicional.

---

## Phase 4: Casos límite y trazabilidad (NFR-001, FR-005, FR-007)

**Purpose**: Cubrir los casos límite explícitos de la spec que no quedan cubiertos por las historias de usuario principales.

- [ ] T019 Decisión de diseño: una actualización a un valor **idéntico** al vigente se acepta y **sí** genera una entrada de historial (consistente con FR-005: toda actualización exitosa debe quedar trazada, sin excepción para el caso "mismo valor")
- [ ] T020 Si la inserción en `vat_rate_history` falla por cualquier motivo, la transacción completa se revierte y la actualización se reporta como fallida (no se permite un cambio de vigente sin su traza correspondiente — edge case de la spec: "Intento de actualizar... sin dejar registrado quién... el sistema debe rechazar la operación o completarla solo si puede registrar esa trazabilidad")
- [ ] T021 [P] Unit test del caso "valor idéntico al vigente" y del caso "fallo al escribir historial → rollback completo"

**Checkpoint**: todos los casos límite de la spec quedan representados en código y pruebas, no solo en el documento funcional.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T022 Documentación OpenAPI del endpoint `PUT /admin/vat-rate` (payload, 200/400/403), publicada junto con el resto de contratos REST de Módulo 3
- [ ] T023 Logging estructurado del evento de actualización (actor, valor anterior, valor nuevo, timestamp) para observabilidad, sin duplicar lo que ya persiste `vat_rate_history`
- [ ] T024 Dejar el rango válido (0 a 100, tope superior de FR-002/NFR-004) como constantes nombradas (`VAT_RATE_MIN`/`VAT_RATE_MAX`), no hardcodeadas sin nombre, por si un futuro cambio regulatorio exige ajustarlas

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: depende de que las Fases 1 y 2 del `docs/plan-tecnico-base.md` (scaffolding NestJS, JWT Guards, `shared-kernel`) ya estén resueltas a nivel de proyecto — no se repiten aquí.
- **User Story 1 (Phase 2)**: depende solo de Setup. Es la vía principal de valor y puede entregarse de forma independiente.
- **User Story 2 (Phase 3)**: depende de Setup; es independiente de la implementación concreta de la Fase 2, pero **debe** completarse antes de que `Generar factura final` (006) dependa del puerto `GetCurrentVatRateUseCase` que aquí se define.
- **Casos límite (Phase 4)**: depende de Phase 2 (reutiliza el mismo flujo transaccional).
- **Polish (Phase 5)**: depende de que Phases 2–4 estén completas.

### Dependencia cruzada con otras features (fuera de alcance de este plan)

- `GetCurrentVatRateUseCase` (T016) es el contrato que **006 Generar factura final** deberá consumir cuando se planifique esa feature. No se implementa aquí el lado de 006, solo se deja el puerto listo y documentado.

## Notes

- [Story] mapea cada tarea a su historia de usuario para trazabilidad con la spec funcional.
- La concurrencia (NFR-002) se resuelve con el bloqueo de fila nativo de PostgreSQL dentro de una transacción explícita — no se introduce un mecanismo de locking optimista adicional (versión/ETag) porque el caso de uso no lo requiere: el requisito es "una sola queda vigente de forma consistente", no "rechazar la segunda escritura".
- Cualquier conflicto entre este plan y la spec funcional (`1-functional/actualizar_porcentaje_iva.md`) se resuelve a favor de la spec, conforme a la nota final de `docs/plan-tecnico-base.md`.
