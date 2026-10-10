# Implementation Plan: Consultar tarifa dinámica

**Date**: 2026-10-09
**Spec**: [consultar_tarifa_dinamica.md](../1-functional/consultar_tarifa_dinamica.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Bounded context**: `pricing`

## Summary

Esta feature cubre dos casos de uso del *bounded context* `pricing`, ambos basados en la misma función de cálculo:

1. **`GetDynamicRateUseCase`** (`GET /pricing/dynamic-rate`, Módulo 2 y OTA): para un tipo de habitación y una fecha o rango de fechas, devuelve la tarifa base (propiedad de Módulo 1, vía 004) ajustada por la temporada vigente (catálogo y ajuste de 009, clasificación por fecha de 011), noche por noche. No guarda nada (BR-001, FR-007) y no segmenta el resultado por actor (BR-005).
2. **`CreateLodgingQuoteUseCase`** (`POST /pricing/quotes`, solo Módulo 2): calcula la tarifa dinámica de cada noche, guarda una **cotización inmutable** (`lodging_quote` + `lodging_quote_night`) y devuelve `quoteId`, tarifa por noche y total. Es la fuente del valor de hospedaje que lee `settlement` (007) sin recalcularlo.

La tarifa dinámica nunca se guarda; la cotización sí (FR-007).

## Technical Context

Se hereda el stack y las convenciones de `docs/plan-tecnico-base.md` (NestJS 10 + TypeScript 5, arquitectura hexagonal con una sola capa `domain/`, `application/` e `infrastructure/`, PostgreSQL 16, Prisma ORM, JWT de usuario con Guards por rol, timeout + circuit breaker en llamadas salientes). Específico de esta feature:

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS
**Primary Dependencies**: NestJS 10.x, Prisma ORM, `decimal.js` a través del VO `Money` (aritmética decimal exacta), `opossum` (circuit breaker, ya usado por el cliente de Módulo 1 de 004)
**Storage**: PostgreSQL 16 — esta feature es dueña de `lodging_quote` y `lodging_quote_night` (insert-only); para la consulta de tarifa **no** posee tablas: lee, sin escribir, el catálogo de ajustes de 009 y el calendario de 011
**Testing**: Jest (dominio del cálculo y servicios con puertos mockeados), Supertest + Testcontainers (persistencia de cotizaciones y e2e), stub HTTP de Módulo 1, prueba de contrato del puerto que consume 007
**Target Platform**: servicio backend Linux en contenedor Docker (bounded context `pricing` del monolito modular de Módulo 3)
**Project Type**: servicio backend único (monolito modular hexagonal), sin frontend en este repositorio
**Performance Goals**: no bloquear operaciones de front-desk de Módulo 2 (NFR-002). El costo dominante es la llamada a Módulo 1 por noche, por lo que el timeout y el límite de concurrencia de esas llamadas son los parámetros críticos
**Constraints**: determinismo (NFR-001); si Módulo 1 no responde o no reporta tarifa base para alguna noche, la operación **completa** falla (FR-006, NFR-003), sin resultado parcial ni cotización parcial; cada noche usa su propia temporada (BR-003); el ajuste sale solo del valor numérico configurado, nunca del nombre de la temporada (BR-007); cálculo con `Money` decimal, nunca con `number`; rango con fecha de salida exclusiva (FR-008); cotización inmutable (BR-006, FR-013); solo Módulo 2 cotiza (BR-008); no se diseña ninguna respuesta 5xx (plan base)
**Scale/Scope**: 2 endpoints (`GET /pricing/dynamic-rate`, `POST /pricing/quotes`), 2 tablas propias, cardinalidad de hasta N noches por solicitud

## Project Structure

### Documentation (this feature)

```text
features/005-consultar-tarifa-dinamica/
├── 1-functional/
│   └── consultar_tarifa_dinamica.md   # Spec funcional (fuente de verdad de negocio)
└── 2-technical/
    └── plan.md                        # Este archivo
```

### Source Code (repository root)

Solo se listan los archivos propiedad de 005, dentro de la estructura por capas del plan base (`pricing` como subcarpeta de cada capa). El cliente HTTP hacia Módulo 1 es propiedad de 004; el catálogo de ajustes, de 009; y el calendario por fecha, de 011.

```text
src/
├── domain/
│   ├── model/pricing/
│   │   ├── dynamic-rate.ts                    # VO por noche: { date, baseRate, seasonName, adjustmentPercent, dynamicRate } (no se persiste)
│   │   ├── calculate-dynamic-rate.ts          # Función pura: dynamicRate = baseRate × (1 + adjustmentPercent / 100), half-up a 2 decimales con Money
│   │   └── lodging-quote.ts                   # Cotización: quoteId, roomType, fechas, currency, noches, total; inmutable
│   ├── errors/
│   │   ├── invalid-date-range.error.ts        # INVALID_DATE_RANGE (fin <= inicio)
│   │   └── season-configuration-inconsistent.error.ts  # El calendario referencia una temporada que no está en el catálogo (contrato de 009)
│   └── ports/
│       ├── in/
│       │   ├── get-dynamic-rate.use-case.ts       # 005: consulta de tarifa por noche
│       │   └── create-lodging-quote.use-case.ts   # 005: cotización del hospedaje para Módulo 2
│       └── out/
│           ├── lodging-quote.repository.port.ts   # insert de la cotización (con sus noches)
│           └── lodging-quote-query.port.ts        # Solo lectura de cotizaciones por ids; lo implementa 005 y lo consume 007
│
├── application/
│   ├── services/pricing/
│   │   ├── get-dynamic-rate.service.ts        # Compone tarifa base (004) + reglas (009) + calendario (011)
│   │   └── create-lodging-quote.service.ts    # Tarifa dinámica × noches; guarda la cotización
│   └── dto/pricing/
│       ├── dynamic-rate.query.ts              # { roomType, checkInDate, checkOutDate }
│       └── create-lodging-quote.command.ts    # { roomType, checkInDate, checkOutDate }
│
└── infrastructure/
    └── adapters/
        ├── in/http/
        │   ├── dynamic-rate.controller.ts     # GET /pricing/dynamic-rate (interno sin token, u OTA con JWT role = OTA)
        │   ├── lodging-quote.controller.ts    # POST /pricing/quotes (solo llamada interna de Módulo 2, sin token)
        │   └── dto/                           # DTOs HTTP con class-validator
        └── out/persistence/
            ├── mappers/lodging-quote.mapper.ts
            └── repositories/prisma-lodging-quote.repository.ts   # Implementa el repositorio y la consulta de solo lectura

prisma/
├── schema.prisma                              # Modelos LodgingQuote y LodgingQuoteNight
└── migrations/
    └── <timestamp>_create_lodging_quote_tables/

test/
├── unit/domain/calculate-dynamic-rate.spec.ts
├── unit/application/get-dynamic-rate.service.spec.ts
├── unit/application/create-lodging-quote.service.spec.ts
├── integration/persistence/prisma-lodging-quote.repository.spec.ts   # Testcontainers
├── contract/dynamic-rate.contract.spec.ts
├── contract/lodging-quote.contract.spec.ts
├── contract/lodging-quote-query.port.spec.ts                         # contrato con 007
└── e2e/pricing.e2e-spec.ts                                           # 200 / 400 / 401 / 403 / 404 / 424 por endpoint
```

**Structure Decision**: 005 es una capa de **composición** sobre tres piezas que pertenecen a otras features de `pricing`: la tarifa base de Módulo 1 (004), el catálogo de temporadas y ajustes (009) y el calendario por fecha (011). No reimplementa sus adaptadores. Tiene dos tablas propias solo para la cotización. Esto implica una dependencia de orden explícita: **005 no puede completarse sin que 011, 009 y 004 expongan sus puertos** (ver Dependencies & Execution Order).

### Puertos que 005 consume (definidos por otras features)

| Puerto | Dueño | Qué usa 005 | Estado |
|---|---|---|---|
| `GetBaseRateUseCase` (`get-base-rate.use-case.ts`) | 004 | `getBaseRate(roomType, date)` → tarifa base decimal de Módulo 1, o `BaseRateNotFoundError` / `Module1UnavailableError` | **004 aún no tiene plan técnico**; la firma exacta se acuerda con su responsable |
| `GetEffectiveSeasonRulesUseCase` (`get-effective-season-rules.use-case.ts`) | 009 | `getAll(asOf)` → `{ defaultSeasonId, seasons[{ seasonId, name, adjustmentPercent (decimal firmado -100..100), isDefault }] }`, según `PORT-get-season-rules.md` | Definido |
| Lectura del calendario (`season-calendar.repository.port.ts`) | 011 | Para cada fecha, el `seasonId` clasificado explícitamente (incluida la prioridad de la excepción puntual sobre la temporada base), o "sin clasificación" | **011 aún no tiene plan técnico**; el método exacto se acuerda con su responsable |

### Cotización de hospedaje: detalles técnicos

La spec funcional describe solo el comportamiento (se calcula y se guarda, no cambia, la salida anticipada no genera cotización). Lo que sigue es el **cómo** y vive solo en este plan:

- **Identificador**: Módulo 3 genera un `quoteId` (UUID) al guardar la cotización y lo devuelve en la respuesta.
- **Una cotización por habitación**: si una reserva incluye varias habitaciones, Módulo 2 hace una solicitud por cada una y guarda la lista de `quoteId` en la reserva (plan base).
- **Total**: es la suma exacta de las tarifas de cada noche, calculada con `Money` (decimal, half-up a 2 decimales, moneda `COP`), nunca con `number`.
- **Inmutabilidad**: se impone por diseño, no por validación en tiempo de ejecución: `lodging_quote` y `lodging_quote_night` solo reciben `INSERT`; el repositorio no expone `UPDATE` ni `DELETE`.
- **Qué se guarda por noche**: `night_date`, `base_rate`, `season_name`, `adjustment_percent` y `rate`, para poder reconstruir cómo se compuso cada valor (FR-009, NFR-004).
- **Todo o nada**: la cotización y sus noches se guardan en **una sola transacción**; si falla el cálculo de cualquier noche o la inserción, no queda ninguna cotización parcial.
- **Salida anticipada**: no hay ninguna llamada a esta feature; `settlement` solo lee la cotización vigente de la reserva (regla de `dependency-cruiser` de T035).
- **Sin idempotencia**: dos solicitudes idénticas crean dos cotizaciones; 007 las trata como equivalentes (mismo tipo y mismas fechas).

---

## Contratos HTTP

### `GET /pricing/dynamic-rate`

Parámetros: `roomType`, y `checkInDate` + `checkOutDate` (fecha de salida **exclusiva**) o, para una sola noche, `date` (equivale a `checkInDate = date` y `checkOutDate = date + 1 día`).

Autorización: llamada interna de Módulo 2 sin token, u OTA con JWT `role = OTA`. El resultado es idéntico para ambos (FR-011, BR-005): el actor solo se usa para autorizar el acceso, nunca para alterar el resultado.

```json
{
  "roomType": "DOBLE",
  "currency": "COP",
  "nights": [
    { "date": "2026-12-24", "baseRate": "300000.00", "seasonName": "Alta", "seasonAdjustmentPercent": "20.00", "dynamicRate": "360000.00" }
  ],
  "total": "360000.00"
}
```

### `POST /pricing/quotes`

Body: `{ roomType, checkInDate, checkOutDate }`. Responde `{ quoteId, currency: "COP", nightlyRates: [{ date, rate }], lodgingAmount }`, como define el plan base.

Autorización: **solo llamada interna de Módulo 2 sin token**. Si la solicitud trae un JWT (OTA o Administrador) se rechaza con 403.

### Respuestas de error (ambos endpoints, salvo indicación)

| Caso | HTTP | `errorCode` |
|---|---|---|
| Tarifa base no reportada por Módulo 1 para alguna noche (FR-006) | 404 | `BASE_RATE_NOT_FOUND` |
| Módulo 1 no responde, timeout o circuito abierto (NFR-003) | 424 | `MODULE1_UNAVAILABLE` |
| Rango inválido: fin anterior o igual al inicio (FR-008, FR-015) | 400 | `INVALID_DATE_RANGE` |
| Parámetros faltantes o con formato inválido | 400 | `INVALID_QUERY_PARAMS` |
| OTA o Administrador llamando a `POST /pricing/quotes`, o rol no `OTA` con token en `GET` | 403 | `FORBIDDEN` |
| JWT inválido en el `GET` de una OTA | 401 | `UNAUTHENTICATED` |
| Calendario inconsistente con el catálogo de temporadas | 422 | `UNEXPECTED_ERROR` |
| Error inesperado | 422 | `UNEXPECTED_ERROR` |

Ninguna respuesta de ambos endpoints es 5xx (plan base).

---

## Phase 1: Setup (específico de esta feature)

**Purpose**: Dejar listo el wiring y las tablas de la cotización, sin duplicar infraestructura que pertenece a otras features de `pricing`

- [ ] T001 Definir `LodgingQuote` y `LodgingQuoteNight` en `prisma/schema.prisma` y crear la migración: `lodging_quote` (`id` uuid PK = `quoteId`, `room_type`, `check_in_date`, `check_out_date`, `currency` char(3), `lodging_amount numeric(14,2)`, `created_at` con la hora de la base de datos) y `lodging_quote_night` (`quote_id` FK, `night_date`, `base_rate`, `season_name`, `adjustment_percent numeric(6,2)`, `rate numeric(14,2)`, `UNIQUE(quote_id, night_date)`). Ninguna de las dos tablas tiene `UPDATE` ni `DELETE` en ningún camino de código
- [ ] T002 Registrar en `src/infrastructure/config/pricing.module.ts` los tokens `GetDynamicRateUseCase`, `CreateLodgingQuoteUseCase`, `LodgingQuoteRepositoryPort` y `LodgingQuoteQueryPort` hacia `PrismaLodgingQuoteRepository`, e inyectar los puertos de 004, 009 y 011 por token, sin reimplementar sus adaptadores
- [ ] T003 Confirmar con los responsables de 004 y 011 la firma exacta de `GetBaseRateUseCase` y del puerto de lectura del calendario (ver tabla de puertos consumidos), y confirmar con 007 la firma de `LodgingQuoteQueryPort.findByIds`

**Checkpoint**: el módulo puede orquestar los puertos sin acoplarse a sus implementaciones concretas.

---

## Phase 2: Foundational — Cálculo y errores comunes (bloqueante)

**Purpose**: Núcleo de dominio puro que usan los dos casos de uso. Se hace antes de cualquier historia de usuario.

**⚠️ CRITICAL**: Ninguna historia de usuario puede comenzar hasta completar esta fase.

- [ ] T004 [P] Unit test de `calculate-dynamic-rate` (`calculate-dynamic-rate.spec.ts`): aplica el signo y la magnitud de `adjustmentPercent` sin ramas por nombre de temporada (positivo incrementa, negativo decrementa, cero no ajusta); incluye `Alta`, `Baja`, `Regular` y una temporada personalizada (por ejemplo `+35.00` con nombre `Semana Santa`); `-100.00` produce cero y `+100.00` duplica la base; redondeo half-up a 2 decimales (FR-002, BR-007)
- [ ] T005 Implementar `calculate-dynamic-rate.ts` como función de dominio pura con `Money`, sin dependencias de NestJS, Prisma ni IO
- [ ] T006 [P] Implementar `DynamicRate`, `LodgingQuote` y los errores de dominio (`InvalidDateRangeError`, `SeasonConfigurationInconsistentError`) y registrarlos en el `ExceptionFilter` global con los códigos de la tabla de errores
- [ ] T007 Implementar la validación de rango como función de dominio: `checkInDate < checkOutDate`, con la fecha de salida exclusiva, y el desglose de un rango en noches `[checkInDate, checkOutDate)`

**Checkpoint**: Foundation ready — el cálculo y el rango están verificados y las historias pueden comenzar.

---

## Phase 3: User Story 1 — Módulo 2 obtiene la tarifa dinámica de una noche (Prioridad: P1)

**Goal**: Para una fecha única y un tipo de habitación, devolver la tarifa base ajustada por la temporada vigente, asumiendo la temporada por defecto si no hay clasificación explícita.

**Independent Test**: con una tarifa base conocida y una regla de temporada alta para una fecha, consultar esa noche y verificar el incremento; consultar una fecha sin clasificación y verificar que se devuelve la tarifa base sin ajuste.

### Tests for User Story 1

- [ ] T008 [P] [US1] Unit test de `GetDynamicRateService` para una sola noche, con los tres puertos mockeados: compone `GetBaseRateUseCase` + reglas de 009 + calendario de 011 y devuelve `{ date, baseRate, seasonName, seasonAdjustmentPercent, dynamicRate }` (FR-009)
- [ ] T009 [P] [US1] Unit test: fecha sin clasificación explícita → se usa `defaultSeasonId` del snapshot de 009 y el resultado es la tarifa base sin ajuste (FR-004)
- [ ] T010 [P] [US1] Unit test: un `seasonId` del calendario que no está en el snapshot de 009 lanza `SeasonConfigurationInconsistentError`, sin elegir otra temporada ni usar ajuste cero (contrato de 009)
- [ ] T011 [US1] Contract test `GET /pricing/dynamic-rate?roomType=&date=`: 200 con el detalle de la noche

### Implementation for User Story 1

- [ ] T012 [US1] Implementar `GetDynamicRateService` para una noche: captura `asOf` una sola vez, obtiene un único snapshot con `GetEffectiveSeasonRulesUseCase.getAll(asOf)`, resuelve la clasificación de la fecha con el puerto de 011 y calcula con `calculate-dynamic-rate`
- [ ] T013 [US1] Implementar `DynamicRateController` (`GET /pricing/dynamic-rate`) aceptando `roomType` y `date`, con la lectura opcional del token: sin token se trata como llamada interna; con token se exige `role = OTA` mediante `RolesGuard`
- [ ] T014 [US1] Mapear `BaseRateNotFoundError` → 404 `BASE_RATE_NOT_FOUND` y `Module1UnavailableError` → 424 `MODULE1_UNAVAILABLE` en el `ExceptionFilter` global, con mensajes específicos y accionables

**Checkpoint**: Módulo 2 puede consultar el precio de una noche con el ajuste de temporada correcto.

---

## Phase 4: User Story 2 — Módulo 2 obtiene el valor de hospedaje de una estancia completa (Prioridad: P1)

**Goal**: Para un rango que puede cruzar temporadas, devolver el detalle noche por noche y el total, sin homogeneizar, y rechazar rangos inválidos sin resultado parcial.

**Independent Test**: consultar un rango que cruce de temporada baja a alta y verificar que cada noche refleja su propia temporada; consultar con fecha de fin igual o anterior al inicio y verificar el rechazo total.

### Tests for User Story 2

- [ ] T015 [P] [US2] Unit test de `GetDynamicRateService` con un rango multi-noche que cruza dos temporadas: un resultado por noche, cada uno con su propia temporada, y un total igual a la suma (BR-003)
- [ ] T016 [P] [US2] Unit test: `checkInDate >= checkOutDate` → `InvalidDateRangeError` inmediato, sin invocar ningún puerto (FR-008)
- [ ] T017 [US2] Unit test: si **cualquier** noche falla en `GetBaseRateUseCase` (tarifa no reportada o Módulo 1 no disponible), la consulta completa falla sin devolver las noches que sí tuvieron éxito (FR-006, NFR-003)
- [ ] T018 [US2] Integration test con Testcontainers: rango de 5 o más noches cruzando temporada baja → alta, contra el cálculo manual esperado (SC-002)

### Implementation for User Story 2

- [ ] T019 [US2] Extender `GetDynamicRateService` para iterar las noches `[checkInDate, checkOutDate)`, usando un único snapshot de reglas y consultando la tarifa base por noche; decidir y documentar el límite de concurrencia (recomendado: paralelo con límite, porque el circuito de 004 protege a Módulo 1)
- [ ] T020 [US2] Fail-fast: si una noche falla, propagar el fallo de **toda** la consulta, sin construir resultado parcial
- [ ] T021 [US2] Validar el rango como primer paso del servicio, antes de tocar cualquier puerto
- [ ] T022 [US2] Extender `DynamicRateController` para aceptar `checkInDate` y `checkOutDate` además de `date`, y mapear `InvalidDateRangeError` → 400 `INVALID_DATE_RANGE` y parámetros inválidos → 400 `INVALID_QUERY_PARAMS`

**Checkpoint**: Módulo 2 puede conocer el valor de hospedaje bruto de una estancia completa, incluso cruzando temporadas.

---

## Phase 5: User Story 3 — La OTA verifica la tarifa dinámica vigente (Prioridad: P2)

**Goal**: Garantizar que el resultado es idéntico para Módulo 2 y para una OTA, sin ninguna segmentación por actor.

**Independent Test**: consultar la misma fecha y tipo como Módulo 2 y como OTA y verificar que el resultado es exactamente el mismo.

### Tests for User Story 3

- [ ] T023 [P] [US3] Unit test: `GetDynamicRateService` no recibe ni usa el actor; el actor solo se usa para autorizar (BR-005, FR-011)
- [ ] T024 [US3] Contract test: la misma consulta, sin token y con un JWT de OTA, devuelve payloads idénticos
- [ ] T025 [US3] Test e2e: token con rol `Administrador` en `GET /pricing/dynamic-rate` → 403 `FORBIDDEN`; token inválido → 401 `UNAUTHENTICATED`

### Implementation for User Story 3

- [ ] T026 [US3] Confirmar que la autorización vive en el Guard del controller y que `GetDynamicRateUseCase` no recibe el actor, para separar estrictamente autorización y lógica de negocio

**Checkpoint**: no existe ninguna rama de código que distinga el resultado por tipo de actor autorizado.

---

## Phase 6: User Story 4 — Módulo 2 cotiza el hospedaje al crear una reserva (Prioridad: P1)

**Goal**: Calcular y guardar una cotización inmutable por habitación.

**Independent Test**: solicitar una cotización y verificar `quoteId`, tarifas por noche y total; cambiar la regla de temporada y verificar que la cotización guardada no cambia.

### Tests for User Story 4

- [ ] T027 [P] [US4] Unit test de `CreateLodgingQuoteService`: reutiliza el cálculo por noche, el total es la suma exacta de las noches y la cotización se guarda una sola vez (FR-012)
- [ ] T028 [P] [US4] Unit test de rechazos sin guardar nada: tarifa base no reportada, Módulo 1 no disponible y rango inválido (FR-015)
- [ ] T029 [US4] Integration test con Testcontainers: guardar una cotización y verificar `lodging_quote` y `lodging_quote_night`; cambiar la regla de temporada y verificar que los valores guardados no cambian (SC-007); verificar que una falla a mitad de la inserción no deja una cotización parcial (transacción)
- [ ] T030 [US4] Contract test `POST /pricing/quotes`: 200 con `{ quoteId, currency, nightlyRates, lodgingAmount }`; 400, 404 y 424 con el `errorCode` correspondiente; y 403 `FORBIDDEN` cuando la solicitud trae un JWT de OTA o de Administrador (BR-008, FR-016)
- [ ] T031 [US4] Contract test de `LodgingQuoteQueryPort.findByIds` contra lo que consume el plan de 007: devuelve `roomType`, `lodgingAmount`, la moneda y el `quoteId` de cada cotización

### Implementation for User Story 4

- [ ] T032 [US4] Implementar `CreateLodgingQuoteService`: valida el rango, calcula las noches (reutilizando el cálculo de US1 y US2), calcula el total con `Money` y guarda la cotización con sus noches en **una sola transacción**
- [ ] T033 [US4] Implementar `PrismaLodgingQuoteRepository` (insert de cotización y noches en transacción; `findByIds` como consulta de solo lectura que implementa `LodgingQuoteQueryPort`); sin `UPDATE` ni `DELETE`
- [ ] T034 [US4] Implementar `LodgingQuoteController` (`POST /pricing/quotes`) que rechaza con 403 `FORBIDDEN` cualquier solicitud que traiga JWT
- [ ] T035 [US4] Regla de `dependency-cruiser`: `settlement` puede importar `LodgingQuoteQueryPort` y el modelo `LodgingQuote`, pero nunca `GetDynamicRateService` ni `CreateLodgingQuoteService`, conforme a la regla 5 del plan base; con esto una salida anticipada o cualquier check-out nunca genera una cotización (FR-014)

**Checkpoint**: Módulo 2 puede cotizar; `settlement` puede leer la cotización sin recalcularla.

---

## Phase 7: Casos límite (NFR-001, NFR-003, NFR-004)

**Purpose**: Cubrir los casos límite de la spec que no son consecuencia directa de las fases anteriores.

- [ ] T036 [P] Unit test de determinismo: la misma fecha, tipo y configuración vigente devuelven siempre el mismo resultado en invocaciones sucesivas (NFR-001, SC-006), sin estado mutable entre llamadas
- [ ] T037 Confirmar que esta feature no introduce ningún caché con TTL que pueda devolver una tarifa base o una temporada desactualizada: cada consulta refleja la configuración vigente al ejecutarse
- [ ] T038 Verificar que el resultado de cada noche permite trazar `baseRate` de origen, temporada aplicada y `dynamicRate` resultante (FR-009, NFR-004), y que cada noche de una cotización guarda esos mismos datos
- [ ] T039 Unit test de un rango de una sola noche con `date`: equivale a `checkOutDate = checkInDate + 1 día` y devuelve exactamente una noche

**Checkpoint**: todos los casos límite de la spec están representados en código y pruebas.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T040 Documentación OpenAPI de `GET /pricing/dynamic-rate` y `POST /pricing/quotes` (parámetros, forma de las respuestas y todos los códigos de error)
- [ ] T041 Contract test consumidor contra el contrato REST de Módulo 1 que define 004, para detectar cambios incompatibles antes de integrar
- [ ] T042 Revisar el timeout, el umbral del circuito y el límite de concurrencia con datos reales de latencia de Módulo 1, cuando exista un entorno compartido
- [ ] T043 Logging estructurado de cada cotización (`quoteId`, `roomType`, rango, total, duración), sin datos personales del huésped

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: depende de que **011, 009 y 004** expongan sus puertos. El plan base fija el orden interno de `pricing` como 011 → 009 → 004 → 005. Si 005 se adelanta, se desarrolla con dobles de prueba de esos puertos; la integración real queda bloqueada.
- **Foundational (Phase 2)**: depende de Setup; BLOQUEA todas las historias de usuario.
- **User Story 1 (Phase 3)**: depende de Foundational. Es la base del resto.
- **User Story 2 (Phase 4)**: depende de Phase 3; extiende el servicio al caso multi-noche.
- **User Story 3 (Phase 5)**: depende de Phase 3; verifica una propiedad transversal, no añade lógica de negocio.
- **User Story 4 (Phase 6)**: depende de Phase 3 y 4 (reutiliza el cálculo por noche y por rango).
- **Casos límite (Phase 7)**: depende de Phases 3 a 6.
- **Polish (Phase 8)**: depende de Phases 3 a 7.
- **Consumidores de esta feature**: 007 necesita `lodging_quote` y `LodgingQuoteQueryPort` para leer el valor de hospedaje; por eso el plan base ubica 005 antes de `settlement` (Phase 3 antes de Phase 4).

### User Story Dependencies

- **User Story 1 (P1)**: puede comenzar después de Foundational; no depende de otras historias.
- **User Story 2 (P1)**: depende de US1 (extiende el mismo servicio), pero se prueba de forma independiente con un rango.
- **User Story 3 (P2)**: depende de US1; solo verifica que el resultado no cambia por actor.
- **User Story 4 (P1)**: reutiliza el cálculo de US1 y US2, pero escribe en tablas propias y es verificable por separado.

### Within Each User Story

- Pruebas de la historia primero, escritas antes de su implementación.
- Modelo y errores antes de servicios, servicios antes de controllers.
- Validación de rango antes de tocar cualquier puerto.
- Historia completa y verificada antes de pasar a la siguiente prioridad.

## Notes

- [Story] mapea cada tarea a su historia de usuario para trazabilidad con la spec funcional.
- La regla más importante de este plan es el **fail-fast sin resultado parcial**, tanto en la consulta como en la cotización (T017, T020, T028, T029).
- `calculate-dynamic-rate` es deliberadamente **agnóstico al nombre de la temporada**: recibe el `adjustmentPercent` ya configurado en 009 (porcentaje firmado de -100.00 a +100.00) y aplica `baseRate × (1 + adjustmentPercent / 100)`. `Regular` es la única temporada reservada (por defecto, ajuste cero, no eliminable); el Administrador puede crear otras sin cambiar este código (FR-002, BR-007).
- Un único snapshot de reglas por solicitud (`asOf` capturado una vez): un cambio concurrente de una regla no se mezcla dentro de una misma consulta ni de una misma cotización.
- Decisiones que no vienen de la spec ni del plan base y conviene confirmar con el equipo:
  - **Parámetros del `GET`**: `checkInDate` y `checkOutDate` (iguales a los del `POST`), más `date` para una noche; el plan base no define los parámetros del `GET`.
  - **`POST /pricing/quotes` solo interno**: se rechaza con 403 cualquier solicitud con JWT, porque Módulo 2 va por red interna sin token; el plan base lo dice pero no define cómo se hace cumplir (FR-016).
  - **Calendario inconsistente** (temporada no encontrada en el catálogo) devuelve 422 `UNEXPECTED_ERROR` porque no hay un `errorCode` específico en el plan base; podría agregarse uno.
- El `POST` no es idempotente: dos solicitudes idénticas crean dos cotizaciones, y 007 las trata como equivalentes (mismo tipo y mismas fechas). No es una decisión a confirmar, solo una consecuencia del diseño.
- Dependencias de otros equipos: las firmas exactas de los puertos de 004 y 011, que aún no tienen plan técnico, se acuerdan con sus responsables (T003).
- Cualquier conflicto entre este plan y la spec funcional (`1-functional/consultar_tarifa_dinamica.md`) se resuelve a favor de la spec, conforme a la nota final de `docs/plan-tecnico-base.md`.
