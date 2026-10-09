# Implementation Plan: Modificar precio tarifa según temporada

**Date**: 2026-10-09
**Spec**: [modificar_precio_tarifa_segun_temporada.md](../1-functional/modificar_precio_tarifa_segun_temporada.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Bounded context**: `pricing`

## Summary

La feature 009 permite al Administrador mantener el catálogo de temporadas y el porcentaje de ajuste de cada temporada sobre la tarifa base. El caso de uso valida el catálogo y el ajuste, persiste cada cambio de forma atómica con su auditoría, y entrega la regla vigente a `Consultar tarifa dinámica` (005). No consulta ni modifica la tarifa base de Módulo 1.

El ajuste se representa como **porcentaje firmado**, acordado para este plan: `+20.00` significa incrementar 20 % y `-10.00` reducir 10 %. El rango inclusivo es `-100.00..+100.00`; la tarifa dinámica se calcula como `baseRate × (1 + adjustmentPercent / 100)`, con aritmética decimal exacta y redondeo half-up a dos decimales. La temporada por defecto (`Regular`) permanece neutral en 0 % y no se puede borrar. Las reglas actualizadas aplican a consultas nuevas desde su instante de vigencia; las cotizaciones y liquidaciones ya materializadas son snapshots y no se recalculan.

009 administra nombres, colores e importes de ajuste de las temporadas; 011 conserva la responsabilidad del calendario y sus clasificaciones/excepciones por fecha. La ausencia de clasificación explícita se resuelve usando la temporada por defecto. Una temporada referenciada en el calendario no se elimina, evitando referencias rotas.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS
**Primary Dependencies**: NestJS 10.x, Prisma ORM, `decimal.js` a través del value object `Money`, Passport-JWT/Guards, Jest
**Storage**: PostgreSQL 16 — catálogo `season`, reglas vigentes versionadas en `season_rule` e historial append-only `season_rule_history`; las asignaciones de fecha son propiedad de `season_calendar_entry` de 011
**Testing**: Jest para dominio y aplicación; Supertest + Testcontainers para REST, persistencia, auditoría y concurrencia; pruebas de contrato del puerto consumido por 005
**Target Platform**: Servicio backend Linux en contenedor Docker
**Project Type**: Servicio backend único (monolito modular hexagonal), bounded context `pricing`, sin frontend en este repositorio
**Performance Goals**: Lectura consistente de temporada/reglas sin llamadas externas; los cambios administrativos quedan disponibles inmediatamente para consultas nuevas de 005, sin caché con TTL
**Constraints**: Solo Administrador puede modificar; porcentaje firmado entre -100 % y +100 %; temporada por defecto no eliminable y con ajuste neutral; una sola regla vigente por temporada; escritura + auditoría atómicas; cambios no alteran cotizaciones ya creadas ni liquidaciones/facturas consolidadas
**Scale/Scope**: Gestión CRUD del catálogo de temporadas, modificación/revisión de reglas y puerto interno de consulta para 005/011; sin llamada saliente a Módulo 1 ni cambio de tarifa base

## Project Structure

### Documentation (this feature)

```text
features/009-modificar-precio-tarifa-segun-temporada/
├── 1-functional/
│   └── modificar_precio_tarifa_segun_temporada.md
└── 2-technical/
    ├── plan.md
    └── contracts/
        ├── ADMIN-season-rules.md
        └── PORT-get-season-rules.md
```

### Source Code (repository root)

Solo se listan los archivos propiedad de 009. El calendario y los adaptadores existentes de tarifas/cotizaciones permanecen a cargo de 011 y 005 respectivamente.

```text
src/
├── domain/
│   ├── model/pricing/
│   │   ├── season.ts                         # Temporada configurable; identidad estable del default
│   │   ├── season-adjustment-percent.vo.ts   # Decimal firmado -100..100; Regular = 0
│   │   └── season-rule.ts                    # Regla temporal vigente e inmutable por versión
│   ├── errors/
│   │   ├── invalid-season.error.ts
│   │   ├── invalid-season-adjustment.error.ts
│   │   ├── default-season-immutable.error.ts
│   │   ├── season-in-use.error.ts
│   │   └── season-rule-conflict.error.ts
│   └── ports/
│       ├── in/
│       │   ├── manage-season-rules.use-case.ts
│       │   └── get-effective-season-rules.use-case.ts
│       └── out/
│           ├── season-rule.repository.port.ts
│           └── season-calendar-reference.port.ts  # Solo consulta de referencias de 011 para validar borrado
│
├── application/
│   ├── services/pricing/
│   │   ├── manage-season-rules.service.ts
│   │   └── get-effective-season-rules.service.ts
│   └── dto/pricing/
│       ├── create-season.command.ts
│       ├── update-season-rule.command.ts
│       └── effective-season-rules.query.ts
│
└── infrastructure/
    ├── adapters/
    │   ├── in/http/
    │   │   └── season-admin.controller.ts
    │   └── out/persistence/
    │       ├── mappers/season-rule.mapper.ts
    │       └── repositories/prisma-season-rule.repository.ts
    └── config/
        └── pricing.module.ts

prisma/
├── schema.prisma                              # Season, SeasonRule, SeasonRuleHistory
└── migrations/
    └── <timestamp>_manage_season_rules/
        └── migration.sql

test/
├── unit/
│   ├── domain/pricing/season-adjustment-percent.vo.spec.ts
│   └── application/pricing/manage-season-rules.service.spec.ts
├── integration/
│   └── persistence/pricing/prisma-season-rule.repository.spec.ts
├── e2e/
│   └── pricing/season-admin.e2e-spec.ts
└── contract/
    └── pricing/effective-season-rules.contract.spec.ts
```

**Structure Decision**: se reutiliza el bounded context `pricing` y la arquitectura hexagonal del plan base. El controller REST valida autenticación/rol y mapea request/response; las reglas de negocio y la coordinación de transacciones viven en aplicación/dominio. PostgreSQL/Prisma solo aparecen en los adaptadores.

## Diseño técnico

### Adaptadores de entrada

Las rutas administrativas son privadas a Módulo 3 y requieren `JwtAuthGuard`, `RolesGuard` y rol `Administrador`, conforme al plan base. Se concreta la matriz base `GET/PUT /admin/season-rules` con operaciones de catálogo y una ruta identificada por temporada para actualización/borrado:

| Método y ruta | Propósito | Respuesta |
|---|---|---|
| `GET /admin/season-rules` | Consultar catálogo completo, regla vigente, versión y auditoría mínima | `200` con `seasons[]` |
| `POST /admin/season-rules` | Crear temporada con nombre, color y ajuste inicial | `201` con temporada y regla |
| `PUT /admin/season-rules/{seasonId}` | Actualizar nombre, color y/o porcentaje de ajuste | `200` con configuración vigente |
| `DELETE /admin/season-rules/{seasonId}` | Eliminar temporada no predeterminada y sin referencias en calendario | `204` |

El contrato HTTP define validación de formato, códigos de error y ejemplos en [`contracts/ADMIN-season-rules.md`](contracts/ADMIN-season-rules.md). Las consultas del calendario y sus excepciones siguen perteneciendo a 011; este controller no crea ni cambia períodos de fecha. La ruta de borrado devuelve conflicto si el catálogo de 011 referencia la temporada; no borra asignaciones ni las reclasifica silenciosamente.

### Dominio y valores

- `Season` guarda un identificador estable, nombre visible, color hexadecimal `#RRGGBB` y el indicador `isDefault`.
- Una sola temporada tiene `isDefault = true`; la migración asegura que exista el default neutral que la arquitectura y 005 necesitan. Su identidad estable y nombre reservado `Regular` no se pueden borrar ni cambiar; su color sí puede personalizarse. Las temporadas adicionales admiten nombres y colores definidos por el Administrador.
- `SeasonAdjustmentPercent` representa un decimal exacto firmado entre `-100.00` y `+100.00`, inclusive. Fuera de rango, no numérico, `NaN`/infinito o precisión superior a dos decimales se rechaza.
- La temporada por defecto debe tener ajuste `0.00`, ya que 005 define que la temporada regular produce precio neutro. El default no puede eliminarse.
- Para fecha sin clasificación explícita, 005 usa el `seasonId` predeterminado; esto hace visible la temporada y su regla neutral, en vez de devolver una categoría o importe inventado.
- El ajuste no modifica la tarifa base consultada a Módulo 1. El cálculo se aplica por noche sobre esa base, y no se almacena como una tarifa fija de fecha [SPEC FR-006, FR-009] [BASE].

### Modelo de datos y vigencia

| Tabla | Campos esenciales | Restricciones |
|---|---|---|
| `season` | `id`, `name`, `color`, `is_default`, `created_at`, `created_by`, `updated_at`, `updated_by` | Un único default (índice único parcial); `name` único sin distinguir mayúsculas/espacios exteriores; default reservado como `Regular`; color `#RRGGBB` |
| `season_rule` | `id`, `season_id`, `adjustment_percent`, `valid_from`, `valid_to`, `created_at`, `created_by` | Versiones append-only; restricción temporal de exclusión para evitar intervalos solapados por temporada; `valid_to` nulo solo para la versión vigente |
| `season_rule_history` | `id`, `season_id`, `previous_rule_id`, `new_rule_id`, `previous_adjustment`, `new_adjustment`, `changed_by`, `changed_at` | Append-only y en la misma transacción que el cambio; para creación, valor anterior nulo |
| `season_calendar_entry` (011) | Referenciada por `season_id` | 009 solo consulta referencias para proteger eliminaciones; 011 es dueño de sus fechas/excepciones |

Las fechas de vigencia son instantes UTC de la base de datos. Al cambiar el ajuste, la transacción bloquea la temporada/regla actual, cierra su `valid_to` y crea la nueva versión con `valid_from` igual al mismo instante de cambio. La regla anterior nunca se actualiza en sus valores; solo se cierra su intervalo vigente. La base valida además la exclusión de rangos superpuestos por `season_id` para protegerse de carreras concurrentes. La modificación de nombre/color es una actualización atómica del catálogo, con auditoría; no altera el identificador usado por 011.

Una actualización que conserva los mismos valores de ajuste, nombre y color es un no-op: se acepta y retorna el estado actual, pero no crea una versión ni fila de historial redundante [SPEC casos límite]. Una modificación efectiva escribe configuración y auditoría en una transacción. Fallo de auditoría revierte el cambio completo.

### Vigencia para las consultas y dependencia con 005/011

`GetEffectiveSeasonRulesUseCase` da a `pricing` un snapshot determinista de las reglas que eran efectivas en `asOf`, timestamp capturado al inicio de la consulta dinámica. 005 resuelve la temporada del calendario de cada noche mediante su integración con 011 y obtiene de este puerto el ajuste correspondiente. No hay caché TTL: una actualización confirmada se observa en una consulta que comienza después del `valid_from`.

La lectura debe ser consistente en una sola operación de base de datos/transacción de solo lectura: no combina la temporada obtenida antes de un cambio con el ajuste leído después de ese cambio. 011 también puede consumir el catálogo (id/nombre/color/default) para representar colores y etiquetas del calendario, pero 009 no depende de 011 para actualizar un porcentaje, salvo para validar que la temporada no esté en uso antes de borrarla.

El proceso que crea una cotización (005) persiste sus tarifas por noche en `lodging_quote_night`. Cambios de temporada posteriores solo afectan consultas nuevas; no alteran cotizaciones creadas, liquidaciones `FINAL` ni facturas emitidas [SPEC FR-006, BR-004] [BASE].

### Errores

Los errores de dominio se traducen en `ApiError` mediante el filtro compartido. Los mensajes son accionables y no revelan datos de autenticación.

| Error | `errorCode` | HTTP | Reintentable | Efecto |
|---|---|---:|---:|---|
| Ajuste no decimal o fuera de `-100..100` | `INVALID_SEASON_ADJUSTMENT` | 400 | No | Conserva regla actual |
| Nombre/color inválido o nombre duplicado | `INVALID_SEASON` | 400 / 409 | No | Conserva catálogo |
| Intento de borrar la temporada por defecto | `DEFAULT_SEASON_IMMUTABLE` | 409 | No | Sin cambios |
| Temporada referenciada por calendario | `SEASON_IN_USE` | 409 | No | Conserva temporada y asignaciones |
| Conflicto de versión o cambio concurrente no rebasable | `SEASON_RULE_CONFLICT` | 409 | No | Transacción revertida |
| Falta de autenticación/token inválido | `UNAUTHENTICATED` | 401 | No | No ejecuta el caso de uso |
| Actor no Administrador | `FORBIDDEN` | 403 | No | No ejecuta el caso de uso |
| Base de datos no disponible | `DATABASE_UNAVAILABLE` | 503 | Sí | Rollback completo |

### Observabilidad y privacidad

Cada cambio efectivo registra `actorId`, `seasonId`, `changedAt`, ajuste anterior/nuevo y campos administrativos modificados. Los logs incluyen identificadores, operación, resultado, versión y duración; nunca contraseñas ni tokens. El historial de configuración se conserva para auditoría y para reconstruir qué ajuste estaba vigente en el instante de una consulta/cotización.

## Phase 1: Setup (específico de esta feature)

**Purpose**: Confirmar el ownership de datos y preparar el contexto `pricing`.

- [ ] T001 Confirmar que el proyecto base tiene `PricingModule`, `PrismaService`, `Money`, JWT/roles y `ApiError` configurados.
- [ ] T002 Coordinar con 011 el identificador estable de temporada usado por `season_calendar_entry` y el puerto de solo lectura para detectar referencias antes de borrar una temporada.
- [ ] T003 Coordinar con 005 la firma `GetEffectiveSeasonRulesUseCase` y la semántica de `adjustmentPercent` para el cálculo por noche.
- [ ] T004 Alinear la matriz OpenAPI base `GET/PUT /admin/season-rules` con las operaciones de catálogo que requiere FR-001 (`GET`, `POST`, `PUT` por ID y `DELETE` por ID).

**Checkpoint**: los límites de propiedad `009`/`011`/`005` y los contratos de integración están acordados.

## Phase 2: Foundational (prerrequisitos bloqueantes)

**Purpose**: Establecer modelo, invariantes, errores y persistencia atómica.

- [ ] T005 Implementar `Season` con ID estable, nombre, color y protección del default.
- [ ] T006 Implementar `SeasonAdjustmentPercent` con rango inclusivo `-100.00..100.00`, precisión de dos decimales y regla default `0.00`.
- [ ] T007 Definir `SeasonRule`, `ManageSeasonRulesUseCase`, `GetEffectiveSeasonRulesUseCase` y los puertos de persistencia/consulta de calendario.
- [ ] T008 Agregar tablas e índices de temporada/reglas/historial a Prisma; migración con una temporada default neutral, sin asumir categorías o colores adicionales.
- [ ] T009 Implementar mapper y repositorio Prisma: snapshot por `asOf`, bloqueo/versionado transaccional, no-op sin historial redundante y rollback si falla auditoría.
- [ ] T010 Registrar los bindings del catálogo, caso de uso administrativo y puerto de reglas efectivas en `PricingModule`.
- [ ] T011 Registrar los errores de dominio y sus `errorCode` en el filtro compartido.

**Checkpoint**: las reglas y temporadas se pueden representar y persistir respetando unicidad, vigencia y auditoría.

## Phase 3: User Story 1 — El Administrador mantiene temporadas y ajusta sus precios (Prioridad: P1)

**Goal**: Crear/modificar/eliminar temporadas permitidas y guardar ajustes válidos sin tocar la tarifa base.

**Independent Test**: crear una temporada con nombre/color y ajuste `+20.00`, verificar que las consultas posteriores aplican el factor `1.20`; intentar ajuste `-100.01`/`100.01` y verificar rechazo sin cambio parcial.

### Tests for User Story 1

- [ ] T012 [P] [US1] Unit tests del VO: límites `-100.00`, `0.00`, `100.00`; rechaza fuera de rango, formato no numérico, NaN/infinito y exceso de decimales.
- [ ] T013 [P] [US1] Unit tests de `Season`: valida nombre/color/identidad, default no eliminable y regla default neutral.
- [ ] T014 [P] [US1] Unit tests de servicio: alta, cambio de ajuste, cambio de nombre/color, no-op idéntico, rechazo del default y temporada referenciada.
- [ ] T015 [P] [US1] Contract/e2e tests REST para autorización, alta/modificación/borrado, payload inválido, default protegido y errores `409`.
- [ ] T016 [US1] Integration test con Postgres: cambio de regla y registro de auditoría atómicos; fallo de historial revierte la regla.

### Implementation for User Story 1

- [ ] T017 [US1] Implementar `ManageSeasonRulesService` con validación de entrada, protección del default y verificación de referencias de calendario.
- [ ] T018 [US1] Implementar rutas administrativas protegidas por `Administrador` para crear, consultar, modificar y eliminar temporadas.
- [ ] T019 [US1] Implementar transacción de actualización con bloqueo optimista/versionado o bloqueo de fila, `valid_from` UTC y registro de historial.
- [ ] T020 [US1] Implementar respuesta `ApiError` específica y mantener el estado anterior ante cualquier validación/conflicto.

**Checkpoint**: un Administrador configura temporadas y ajustes; actores no autorizados o entradas inválidas no cambian el estado.

## Phase 4: User Story 2 — Las reglas rigen nuevas consultas sin retroactividad (Prioridad: P1)

**Goal**: Dar a 005 reglas vigentes consistentes para cálculos nuevos y preservar los snapshots existentes.

**Independent Test**: consultar una misma temporada antes y después de cambiar su regla; la consulta posterior usa la nueva tasa y la cotización anterior conserva su desglose original.

### Tests for User Story 2

- [ ] T021 [P] [US2] Unit test del puerto de lectura: selecciona la única versión que contiene `asOf`, con bordes temporales exactos y en orden determinista.
- [ ] T022 [P] [US2] Contract test interno consumido por 005: catálogo más reglas efectivas incluye `seasonId`, nombre, color, default, porcentaje firmado y timestamp de vigencia.
- [ ] T023 [US2] Integration test concurrente de actualización/lectura: cada consulta ve el snapshot anterior o el nuevo, nunca una mezcla.
- [ ] T024 [US2] Integration test de no retroactividad: una cotización guardada previo al cambio permanece idéntica, mientras una cotización nueva recibe la regla actual.

### Implementation for User Story 2

- [ ] T025 [US2] Implementar `GetEffectiveSeasonRulesUseCase.getAll(asOf)` como consulta interna sin endpoint público adicional.
- [ ] T026 [US2] Exponer catálogo y regla por ID estable para integración de 005 y lectura de etiquetas/colores de 011.
- [ ] T027 [US2] Definir la integración de 005: fecha sin clasificación explícita resuelve a `isDefault`; consultar regla como snapshot `asOf` y usar decimal exacto para el ajuste.
- [ ] T028 [US2] Verificar que este caso de uso no escribe cotizaciones ni accede a `settlement`/`invoice`; 005 materializa nuevas cotizaciones y 007/006 no recalculan snapshots.

**Checkpoint**: la lectura concurrente es determinista y los cambios no alteran importes previamente materializados.

## Phase 5: User Story 3 — El Administrador revisa las reglas vigentes (Prioridad: P2)

**Goal**: Mostrar sin ambigüedad el catálogo, ajuste, estado default y datos mínimos de auditoría.

**Independent Test**: revisar un catálogo con múltiples temporadas y confirmar que cada nombre/color/porcentaje vigente es identificable y la temporada por defecto aparece explícitamente como neutral.

### Tests for User Story 3

- [ ] T029 [P] [US3] Contract test de `GET /admin/season-rules`: lista completa ordenada determinísticamente, tasa vigente y metadatos de auditoría.
- [ ] T030 [P] [US3] E2E test de autorización: Administrador obtiene el catálogo; sin token recibe 401 y un rol distinto recibe 403.
- [ ] T031 [US3] Integration test del historial: cambio efectivo muestra actor, hora y valor anterior/nuevo; no-op idéntico no agrega historial redundante.

### Implementation for User Story 3

- [ ] T032 [US3] Implementar consulta de catálogo vigente sin mutación, con orden por nombre normalizado e ID estable como desempate.
- [ ] T033 [US3] Mapear los datos auditables necesarios sin exponer secretos ni historial técnico innecesario.

**Checkpoint**: la revisión identifica valores vigentes y cambios de forma verificable.

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T034 Documentar el contrato REST en OpenAPI y el puerto de integración con 005/011.
- [ ] T035 Verificar con test de arquitectura que `settlement`/`billing` no dependan de reglas actuales de `pricing`.
- [ ] T036 Agregar logs estructurados para cambios efectivos, errores de validación y conflictos de concurrencia sin credenciales.
- [ ] T037 Ejecutar pruebas de migración desde base vacía y validar que se crea una temporada default neutral y única.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** requiere la infraestructura base NestJS/PostgreSQL/JWT del plan base y coordinación de contratos con 005/011.
- **Foundational (Phase 2)** bloquea las historias: modelo, persistencia versionada, puertos y errores.
- **User Story 1 (Phase 3)** depende de la fundación; entrega la gestión administrativa.
- **User Story 2 (Phase 4)** depende de modelo/reglas y se integra con 005 para el cálculo futuro.
- **User Story 3 (Phase 5)** depende de catálogo y consulta disponibles.
- **Polish (Phase 6)** depende de los contratos y flujos terminados.

### Dependencias con otras features

- **011 Revisar temporada del año** es dueño de la clasificación por fecha, períodos y excepciones; consume la identidad/nombre/color del catálogo y 009 consulta referencias antes de borrar.
- **005 Consultar tarifa dinámica** es consumidor del puerto interno que obtiene el snapshot vigente; aplica el porcentaje sobre la tarifa base de Módulo 1 para cada noche.
- **004 Consultar tarifa base** y Módulo 1 son fuente de la base; 009 no los llama ni modifica sus valores.
- **005 Crear cotización** persiste tarifas por noche; 007 Generar liquidación lee la cotización guardada y 006 factura snapshots sin recalcularlos.

## Notes

- El porcentaje firmado y rango `-100..100` quedan fijados para este plan: `-100` produce tarifa cero y `+100` como máximo duplica la base. Si el negocio cambia el rango, deberán cambiar en conjunto validación, contrato y pruebas.
- El default se trata como la temporada regular neutral exigida por el cálculo de 005, incluso si las temporadas adicionales tienen nombres comerciales libres.
- El calendario estacional es propiedad de 011; 009 no redefine la precedencia de excepciones puntuales ni la estructura de los períodos.
- La matriz de contratos REST del plan base enumera `GET/PUT /admin/season-rules`; esta feature necesita completar las operaciones de creación y borrado previstas por FR-001. Acordar esa ampliación de OpenAPI antes de implementar.
- El cambio de regla no recalcula la cotización guardada, liquidación ni factura. La aplicación efectiva es solo para operaciones de cálculo que comiencen después del instante de confirmación.
