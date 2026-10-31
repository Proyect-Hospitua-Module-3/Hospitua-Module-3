# Implementation Plan: Modificar precio tarifa según temporada

**Date**: 2026-10-09
**Spec**: [modificar_precio_tarifa_segun_temporada.md](../1-functional/modificar_precio_tarifa_segun_temporada.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Bounded context**: `pricing`

## Summary

La feature 009 permite al Administrador mantener el catálogo de temporadas y el porcentaje de ajuste de cada temporada sobre la tarifa base. El caso de uso valida el catálogo y el ajuste, persiste cada cambio de forma atómica con su auditoría, y entrega la regla vigente a `Consultar tarifa dinámica` (005). No consulta ni modifica la tarifa base de Módulo 1.

El ajuste se representa como **porcentaje firmado**, acordado para este plan: `+20.00` significa incrementar 20 % y `-10.00` reducir 10 %. El rango inclusivo es `-100.00..+100.00`; la tarifa dinámica se calcula como `baseRate × (1 + adjustmentPercent / 100)`, con aritmética decimal exacta y redondeo half-up a dos decimales. La temporada por defecto (`Regular`) es la temporada reservada del catálogo y no se puede borrar ni renombrar; su porcentaje de ajuste es configurable dentro del mismo rango y puede ser distinto de cero. Las reglas actualizadas aplican a consultas nuevas desde su instante de vigencia; las cotizaciones y liquidaciones ya materializadas son snapshots y no se recalculan.

009 administra nombres, colores e importes de ajuste de las temporadas; 011 conserva la responsabilidad del calendario y sus clasificaciones/excepciones por fecha. La ausencia de clasificación explícita se resuelve usando la temporada por defecto. Eliminar una temporada es un **retiro lógico** (`archived_at`): deja de aparecer en el catálogo y de poder asignarse, pero conserva su historial y las referencias de revisiones anteriores del calendario. Una temporada asignada en una revisión activa del calendario no se puede retirar, evitando referencias rotas.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS
**Primary Dependencies**: NestJS 10.x, Prisma ORM, `decimal.js` a través del value object `Money`, Passport-JWT/Guards, Jest
**Storage**: PostgreSQL 16 — catálogo `season`, reglas vigentes versionadas en `season_rule` e historial append-only `season_rule_history`; las asignaciones de fecha son propiedad de `season_calendar_entry` de 011
**Testing**: Jest para dominio y aplicación; Supertest + Testcontainers para REST, persistencia, auditoría y concurrencia; pruebas de contrato del puerto consumido por 005
**Target Platform**: Servicio backend Linux en contenedor Docker
**Project Type**: Servicio backend único (monolito modular hexagonal), bounded context `pricing`, sin frontend en este repositorio
**Performance Goals**: Lectura consistente de temporada/reglas sin llamadas externas; los cambios administrativos quedan disponibles inmediatamente para consultas nuevas de 005, sin caché con TTL
**Constraints**: Solo Administrador puede modificar; porcentaje firmado entre -100 % y +100 %; temporada por defecto no eliminable ni renombrable; su ajuste puede variar dentro del rango firmado; una sola regla vigente por temporada; escritura + auditoría atómicas; modificaciones serializadas por bloqueo de fila con control optimista opcional (`expectedVersion`); retiro lógico, nunca borrado físico; cambios no alteran cotizaciones ya creadas ni liquidaciones/facturas consolidadas
**Scale/Scope**: Gestión CRUD del catálogo de temporadas, modificación/revisión de reglas y puerto interno de consulta para 005/011; sin llamada saliente a Módulo 1 ni cambio de tarifa base

## Project Structure

### Documentation (this feature)

```text
features/009-modificar-precio-tarifa-segun-temporada/
├── 1-functional/
│   └── modificar_precio_tarifa_segun_temporada.md
├── 2-technical/
│   ├── plan.md
│   └── contracts/
│       ├── ADMIN-season-rules.md
│       └── PORT-get-season-rules.md
├── 3-implementation/
│   └── implementacion.md              # Mapa del código y las pruebas de 009, con el estado de cada tarea
└── 4-testing/
    └── TC-009-modificar-precio-tarifa-segun-temporada.md  # Caso de prueba manual (plantilla docs/test-case-template.md)
```

### Source Code (repository root)

Solo se listan los archivos propiedad de 009. Igual que en 001, dentro de cada capa todo va en una subcarpeta del *bounded context* (`pricing/`). El calendario y los adaptadores existentes de tarifas/cotizaciones permanecen a cargo de 011 y 005 respectivamente.

```text
src/
├── domain/
│   ├── model/pricing/
│   │   ├── season.ts                         # Temporada + regla vigente; decide cambios (planChange) y retiros
│   │   ├── season-adjustment-percent.vo.ts   # Decimal firmado -100..100; sin neutralización por nombre de temporada
│   │   ├── season-name.vo.ts                 # Nombre sin espacios exteriores; unicidad sin distinguir mayúsculas
│   │   ├── season-color.vo.ts                # #RRGGBB, guardado en mayúsculas
│   │   └── season-rule.ts                    # Versión del ajuste, inmutable
│   ├── errors/pricing/
│   │   ├── invalid-season.error.ts
│   │   ├── invalid-season-adjustment.error.ts
│   │   ├── season-not-found.error.ts
│   │   ├── season-name-conflict.error.ts
│   │   ├── default-season-immutable.error.ts
│   │   ├── season-in-use.error.ts
│   │   ├── season-rule-conflict.error.ts
│   │   ├── season-rules-unavailable.error.ts       # Interno del puerto (no es HTTP)
│   │   └── season-catalog-inconsistent.error.ts    # Interno del puerto (no es HTTP)
│   └── ports/
│       ├── in/pricing/
│       │   ├── modify-season-rule.use-case.ts      # Define también los comandos Create/Update/RetireSeasonCommand
│       │   └── get-effective-season-rules.use-case.ts
│       └── out/pricing/
│           ├── season-rule.repository.port.ts
│           └── season-calendar-reference.port.ts  # Solo consulta de referencias de 011 para validar borrado
│
├── application/
│   └── services/pricing/
│       ├── modify-season-rule.service.ts
│       └── get-effective-season-rules.service.ts
│
└── infrastructure/
    ├── adapters/
    │   ├── in/http/pricing/
    │   │   ├── season-admin.controller.ts      # Compartido con 011: rutas /admin/season-rules (009) y /admin/season-calendar (011)
    │   │   └── dto/season.dto.ts
    │   └── out/
    │       ├── persistence/
    │       │   ├── mappers/pricing/season.mapper.ts
    │       │   └── repositories/pricing/prisma-season-rule.repository.ts
    │       └── calendar/
    │           └── pending-season-calendar-reference.adapter.ts  # PROVISIONAL hasta 011: responde "no está en uso"
    └── config/
        └── pricing.module.ts

prisma/
├── schema.prisma                              # Season, SeasonRule, SeasonRuleHistory
└── migrations/
    └── <timestamp>_manage_season_rules/
        └── migration.sql                      # Incluye índices parciales, exclusión de rangos, CHECK y la temporada Regular

test/
├── unit/
│   ├── domain/pricing/season-adjustment-percent.vo.spec.ts
│   ├── domain/pricing/season-name-color.vo.spec.ts
│   ├── domain/pricing/season.spec.ts
│   ├── application/pricing/modify-season-rule.service.spec.ts
│   └── application/pricing/get-effective-season-rules.service.spec.ts
├── integration/
│   └── persistence/pricing/prisma-season-rule.repository.spec.ts
├── e2e/
│   └── pricing/season-admin.e2e-spec.ts
├── contract/
│   └── pricing/effective-season-rules.contract.spec.ts
└── support/
    └── pricing/in-memory-season-rule.repository.ts       # Doble del puerto para unitarias y e2e
```

Los comandos se definen junto al puerto de entrada, en `domain/`, y no en `application/dto/`: el puerto los usa en su firma y el dominio no puede importar de la capa de aplicación (regla 1 del plan base). Mismo criterio que 001.

**Transacciones sin lógica en SQL**: `modify` y `retire` del repositorio bloquean la temporada y le entregan el estado actual a una función del dominio (`Season.planChange`, `Season.assertCanBeRetired` y la consulta al calendario), que decide; el repositorio aplica la decisión en la misma transacción. La temporada se bloquea **sola** y su regla vigente se lee en una sentencia posterior: si se bloqueara con un `JOIN` a `season_rule`, quien espera el bloqueo recibiría una regla ya cerrada y solaparía versiones (lo detectó la restricción de exclusión en las pruebas de concurrencia).

**Structure Decision**: se reutiliza el bounded context `pricing` y la arquitectura hexagonal del plan base. El controller REST valida autenticación/rol y mapea request/response; las reglas de negocio y la coordinación de transacciones viven en aplicación/dominio. PostgreSQL/Prisma solo aparecen en los adaptadores.

## Diseño técnico

### Adaptadores de entrada

Las rutas administrativas son privadas a Módulo 3 y requieren `JwtAuthGuard`, `RolesGuard` y rol `Administrador`, conforme al plan base. Se detallan las operaciones de catálogo definidas en la matriz del plan base:

| Método y ruta                           | Propósito                                                              | Respuesta                       |
| --------------------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| `GET /admin/season-rules`               | Consultar catálogo completo, regla vigente, versión y auditoría mínima | `200` con `seasons[]`           |
| `POST /admin/season-rules`              | Crear temporada con nombre, color y ajuste inicial                     | `201` con temporada y regla     |
| `PUT /admin/season-rules/{seasonId}`    | Actualizar nombre, color y/o porcentaje de ajuste; acepta `expectedVersion` opcional | `200` con configuración vigente |
| `DELETE /admin/season-rules/{seasonId}` | Retirar (borrado lógico) una temporada no predeterminada y sin asignaciones en revisiones activas del calendario | `204` |

El contrato HTTP define validación de formato, códigos de error y ejemplos en [`contracts/ADMIN-season-rules.md`](contracts/ADMIN-season-rules.md). Las consultas del calendario y sus excepciones siguen perteneciendo a 011; este controller no crea ni cambia períodos de fecha. La ruta de retiro devuelve conflicto si una revisión activa del calendario de 011 referencia la temporada; no borra asignaciones ni las reclasifica silenciosamente.

`PUT` acepta cambios parciales (`name`, `color`, `adjustmentPercent`). Se mantiene `PUT` y no `PATCH` porque es el verbo acordado en la matriz del plan base; la semántica de actualización parcial queda documentada en el contrato.

### Dominio y valores

- `Season` guarda un identificador estable, nombre visible, color hexadecimal `#RRGGBB`, el indicador `isDefault`, un `version` entero que se incrementa con cada cambio efectivo (nombre, color o ajuste) y `archivedAt` (nulo mientras la temporada está en el catálogo).
- Una sola temporada tiene `isDefault = true`; la migración asegura que exista la temporada reservada `Regular` para la arquitectura y 005. Su identidad estable y nombre reservado `Regular` no se pueden borrar ni renombrar; su color sí puede personalizarse. Las temporadas adicionales admiten nombres y colores definidos por el Administrador.
- `SeasonAdjustmentPercent` representa un decimal exacto firmado entre `-100.00` y `+100.00`, inclusive. Fuera de rango, no numérico, `NaN`/infinito o precisión superior a dos decimales se rechaza.
- La temporada por defecto conserva el `seasonId` reservado y puede tener un ajuste distinto de cero, siempre que permanezca dentro del rango firmado. El default no puede eliminarse ni renombrarse.
- Para fecha sin clasificación explícita, 005 usa el `seasonId` predeterminado; esto hace visible la temporada y su regla vigente, en vez de devolver una categoría o importe inventado.
- El ajuste no modifica la tarifa base consultada a Módulo 1. El cálculo se aplica por noche sobre esa base, y no se almacena como una tarifa fija de fecha [SPEC FR-006, FR-009] [BASE].

### Modelo de datos y vigencia

| Tabla                         | Campos esenciales                                                                                                         | Restricciones                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `season`                      | `id`, `name`, `color`, `is_default`, `version`, `archived_at`, `archived_by`, `created_at`, `created_by`, `updated_at`, `updated_by` | Un único default (índice único parcial); `name` único sin distinguir mayúsculas/espacios exteriores entre temporadas no retiradas (índice único parcial `WHERE archived_at IS NULL`); default reservado como `Regular` y nunca retirado (`CHECK (NOT is_default OR archived_at IS NULL)`); color `#RRGGBB` |
| `season_rule`                 | `id`, `season_id`, `adjustment_percent`, `valid_from`, `valid_to`, `created_at`, `created_by`                             | Versiones append-only; restricción temporal de exclusión para evitar intervalos solapados por temporada; `valid_to` nulo solo para la versión vigente  |
| `season_rule_history`         | `id`, `season_id`, `previous_rule_id`, `new_rule_id`, `previous_adjustment`, `new_adjustment`, `changed_by`, `changed_at` | Append-only y en la misma transacción que el cambio; para creación, valor anterior nulo                                                                |
| `season_calendar_entry` (011) | Referenciada por `season_id`                                                                                              | 009 solo consulta referencias para proteger retiros; 011 es dueño de sus fechas/excepciones                                                            |

Las fechas de vigencia son instantes UTC de la base de datos. **Concurrencia**: toda modificación (`PUT`) y todo retiro (`DELETE`) empieza con `SELECT … FOR UPDATE` sobre la fila de `season`, lo que serializa los cambios de una misma temporada. Con la fila bloqueada, si la petición trae `expectedVersion` y no coincide con `season.version`, se rechaza con `409 SEASON_RULE_CONFLICT` (otro Administrador cambió la temporada después de que la leyó). Si no trae `expectedVersion`, el cambio se aplica sobre la versión vigente (último en escribir gana, pero siempre con una sola versión vigente). Al cambiar el ajuste, la transacción cierra el `valid_to` de la regla vigente y crea la nueva versión con `valid_from` igual al mismo instante de cambio. La regla anterior nunca se actualiza en sus valores; solo se cierra su intervalo vigente. La base valida además la exclusión de rangos superpuestos por `season_id` como última defensa. La modificación de nombre/color es una actualización atómica del catálogo, con auditoría; no altera el identificador usado por 011. Cada cambio efectivo incrementa `season.version`.

### Retiro de temporadas

`DELETE` no borra la fila: marca `archived_at` y `archived_by`. Así `season_rule`, `season_rule_history` y las entradas de revisiones históricas del calendario conservan su clave foránea y la auditoría de FR-004 queda intacta.

1. Bloquea la fila de `season` (`FOR UPDATE`); si no existe o ya está retirada, responde `404 SEASON_NOT_FOUND`; si es la predeterminada, `409 DEFAULT_SEASON_IMMUTABLE`.
2. Consulta con `SeasonCalendarReferencePort` si alguna **revisión activa** del calendario (de cualquier año) la referencia en una entrada `BASE` o `EXCEPTION`. Si es así, `409 SEASON_IN_USE`. Las revisiones históricas no bloquean el retiro.
3. Marca el retiro, cierra el `valid_to` de su regla vigente y registra la operación en `season_rule_history`, todo en la misma transacción.

**Carrera con 011**: la publicación de una revisión del calendario bloquea en modo `FOR SHARE` las filas de `season` que referencia antes de validar que no estén retiradas. Como el retiro toma `FOR UPDATE` sobre la misma fila, ambas operaciones se serializan: o el retiro ve la revisión nueva y responde `SEASON_IN_USE`, o la publicación ve la temporada retirada y la rechaza con `UNKNOWN_SEASON_REFERENCE`.

Una temporada retirada no se puede modificar (`404 SEASON_NOT_FOUND`) ni asignar en el calendario, y libera su nombre para una temporada nueva. El puerto `GetEffectiveSeasonRulesUseCase` la sigue devolviendo con `archivedAt` para que 011 pueda mostrar revisiones históricas que la usaron.

Una actualización que conserva los mismos valores de ajuste, nombre y color es un no-op: se acepta y retorna el estado actual, pero no crea una versión ni fila de historial redundante [SPEC casos límite]. Una modificación efectiva escribe configuración y auditoría en una transacción. Fallo de auditoría revierte el cambio completo.

### Vigencia para las consultas y dependencia con 005/011

`GetEffectiveSeasonRulesUseCase` da a `pricing` un snapshot determinista de las reglas que eran efectivas en `asOf`, timestamp capturado al inicio de la consulta dinámica. El snapshot incluye las temporadas retiradas, con `archivedAt` y su última regla, para que 011 pueda etiquetar revisiones históricas; las revisiones activas nunca referencian una temporada retirada, así que 005 no las aplica en la práctica. 005 resuelve la temporada del calendario de cada noche mediante su integración con 011 y obtiene de este puerto el ajuste correspondiente. No hay caché TTL: una actualización confirmada se observa en una consulta que comienza después del `valid_from`.

La lectura debe ser consistente en una sola operación de base de datos/transacción de solo lectura: no combina la temporada obtenida antes de un cambio con el ajuste leído después de ese cambio. 011 también puede consumir el catálogo (id/nombre/color/default) para representar colores y etiquetas del calendario, pero 009 no depende de 011 para actualizar un porcentaje, salvo para validar que la temporada no esté en uso antes de borrarla.

El proceso que crea una cotización (005) persiste sus tarifas por noche en `lodging_quote_night`. Cambios de temporada posteriores solo afectan consultas nuevas; no alteran cotizaciones creadas, liquidaciones `FINAL` ni facturas emitidas [SPEC FR-006, BR-004] [BASE].

### Errores

Los errores de dominio se traducen en `ApiError` mediante el filtro compartido. Los mensajes son accionables y no revelan datos de autenticación.

| Error                                                  | `errorCode`                 |      HTTP | Reintentable | Efecto                            |
| ------------------------------------------------------ | --------------------------- | --------: | -----------: | --------------------------------- |
| Nombre/color malformado, nombre vacío o cuerpo sin campos | `INVALID_SEASON`         |       400 |           No | Conserva catálogo                 |
| Ajuste no decimal, exceso de precisión o fuera de `-100..100` | `INVALID_SEASON_ADJUSTMENT` | 400 |        No | Conserva regla actual             |
| `seasonId` inexistente o temporada retirada            | `SEASON_NOT_FOUND`          |       404 |           No | Sin cambios                       |
| Nombre normalizado ya usado por otra temporada no retirada | `SEASON_NAME_CONFLICT`  |       409 |           No | Conserva catálogo                 |
| Intento de retirar o renombrar la temporada por defecto | `DEFAULT_SEASON_IMMUTABLE` |       409 |           No | Sin cambios                       |
| Temporada referenciada por una revisión activa del calendario | `SEASON_IN_USE`      |       409 |           No | Conserva temporada y asignaciones |
| `expectedVersion` distinto de la versión vigente       | `SEASON_RULE_CONFLICT`      |       409 |           No | Transacción revertida             |
| Falta de autenticación/token inválido                  | `UNAUTHENTICATED`           |       401 |           No | No ejecuta el caso de uso         |
| Actor no Administrador                                 | `FORBIDDEN`                 |       403 |           No | No ejecuta el caso de uso         |
| Base de datos no disponible                            | `UNEXPECTED_ERROR`          |       422 |           Sí | El `ExceptionFilter` global registra el error con id de correlación y lo incluye en el mensaje; rollback completo |

Esta tabla coincide con la de [`contracts/ADMIN-season-rules.md`](contracts/ADMIN-season-rules.md). El puerto interno `GetEffectiveSeasonRulesUseCase` no responde HTTP: si no puede leer el snapshot lanza `SeasonRulesUnavailableError` (`SEASON_RULES_UNAVAILABLE`), código interno que no forma parte de `ApiError`; 005 lo traduce a `422 UNEXPECTED_ERROR`, como indica su plan.

### Observabilidad y privacidad

Cada cambio efectivo registra `actorId`, `seasonId`, `changedAt`, ajuste anterior/nuevo y campos administrativos modificados. Los logs incluyen identificadores, operación, resultado, versión y duración; nunca contraseñas ni tokens. El historial de configuración se conserva para auditoría y para reconstruir qué ajuste estaba vigente en el instante de una consulta/cotización.

## Phase 1: Setup (específico de esta feature)

**Purpose**: Confirmar el ownership de datos y preparar el contexto `pricing`.

- [ ] T001 Confirmar que el proyecto base tiene `PricingModule`, `PrismaService`, `Money`, JWT/roles y `ApiError` configurados.
- [ ] T002 Coordinar con 011 el identificador estable de temporada usado por `season_calendar_entry` y el puerto de solo lectura para detectar referencias antes de borrar una temporada.
- [ ] T003 Coordinar con 005 la firma `GetEffectiveSeasonRulesUseCase` y la semántica de `adjustmentPercent` para el cálculo por noche.
- [ ] T004 Alinear el contrato REST administrativo con la matriz final del catálogo (`GET /admin/season-rules`, `POST /admin/season-rules`, `PUT /admin/season-rules/{seasonId}` y `DELETE /admin/season-rules/{seasonId}`), confirmando payloads, códigos de error y ejemplos de respuesta.

**Checkpoint**: los límites de propiedad `009`/`011`/`005` y los contratos de integración están acordados.

## Phase 2: Foundational (prerrequisitos bloqueantes)

**Purpose**: Establecer modelo, invariantes, errores y persistencia atómica.

- [ ] T005 Implementar `Season` con ID estable, nombre, color y protección del default.
- [ ] T006 Implementar `SeasonAdjustmentPercent` con rango inclusivo `-100.00..100.00`, precisión de dos decimales y sin fijar un valor por defecto por nombre de temporada.
- [ ] T007 Definir `SeasonRule`, `ModifySeasonRuleUseCase`, `GetEffectiveSeasonRulesUseCase` y los puertos de persistencia/consulta de calendario.
- [ ] T008 Agregar tablas e índices de temporada/reglas/historial a Prisma (incluidos `version`, `archived_at`, el índice único parcial de nombre entre temporadas no retiradas y el `CHECK` que impide retirar el default); migración con una temporada default reservada, sin asumir categorías o colores adicionales.
- [ ] T009 Implementar mapper y repositorio Prisma: snapshot por `asOf`, bloqueo/versionado transaccional, no-op sin historial redundante y rollback si falla auditoría.
- [ ] T010 Registrar los bindings del catálogo, caso de uso administrativo y puerto de reglas efectivas en `PricingModule`.
- [ ] T011 Registrar los errores de dominio y sus `errorCode` en el filtro compartido.

**Checkpoint**: las reglas y temporadas se pueden representar y persistir respetando unicidad, vigencia y auditoría.

## Phase 3: User Story 1 — El Administrador mantiene temporadas y ajusta sus precios (Prioridad: P1)

**Goal**: Crear/modificar/eliminar temporadas permitidas y guardar ajustes válidos sin tocar la tarifa base.

**Independent Test**: crear una temporada con nombre/color y ajuste `+20.00`, verificar que las consultas posteriores aplican el factor `1.20`; intentar ajuste `-100.01`/`100.01` y verificar rechazo sin cambio parcial.

### Tests for User Story 1

- [ ] T012 [P] [US1] Unit tests del VO: límites `-100.00`, `0.00`, `100.00`; rechaza fuera de rango, formato no numérico, NaN/infinito y exceso de decimales.
- [ ] T013 [P] [US1] Unit tests de `Season`: valida nombre/color/identidad, default no eliminable ni renombrable y reglaje validado por el rango firmado.
- [ ] T014 [P] [US1] Unit tests de servicio: alta, cambio de ajuste (positivo y negativo), cambio de nombre/color, no-op idéntico, `expectedVersion` desactualizado, rechazo del default, temporada referenciada por una revisión activa, retiro permitido cuando solo la referencian revisiones históricas y temporada retirada no modificable.
- [ ] T015 [P] [US1] Contract/e2e tests REST para autorización, alta/modificación/retiro, payload inválido, default protegido, `404` de temporada retirada y errores `409`.
- [ ] T016 [US1] Integration test con Postgres: cambio de regla y registro de auditoría atómicos; fallo de historial revierte la regla; el retiro conserva `season_rule`, `season_rule_history` y las entradas históricas del calendario; un retiro concurrente con una publicación de 011 que la referencia termina en `SEASON_IN_USE` o en `UNKNOWN_SEASON_REFERENCE`, nunca en ambos éxitos.

### Implementation for User Story 1

- [ ] T017 [US1] Implementar `ModifySeasonRuleService` con validación de entrada, protección del default, retiro lógico y verificación de referencias en revisiones activas del calendario.
- [ ] T018 [US1] Implementar rutas administrativas protegidas por `Administrador` para crear, consultar, modificar y retirar temporadas.
- [ ] T019 [US1] Implementar transacción de actualización y retiro con `SELECT … FOR UPDATE` sobre `season`, comparación opcional de `expectedVersion`, incremento de `version`, `valid_from` UTC y registro de historial.
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

**Independent Test**: revisar un catálogo con múltiples temporadas y confirmar que cada nombre/color/porcentaje vigente es identificable y la temporada por defecto aparece explícitamente como reservada, con `isDefault = true` y ajuste válido dentro del rango firmado.

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
- [ ] T037 Ejecutar pruebas de migración desde base vacía y validar que se crea una temporada default reservada y única, con ajuste válido dentro del rango firmado.

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
- El default se trata como la temporada reservada `Regular` exigida por la lógica de 005, incluso si las temporadas adicionales tienen nombres comerciales libres; su ajuste puede no ser neutro y sigue validado por el rango firmado.
- El calendario estacional es propiedad de 011; 009 no redefine la precedencia de excepciones puntuales ni la estructura de los períodos.
- El cambio de regla no recalcula la cotización guardada, liquidación ni factura. La aplicación efectiva es solo para operaciones de cálculo que comiencen después del instante de confirmación.
