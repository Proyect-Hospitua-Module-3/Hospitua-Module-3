# Implementation Plan: Revisar temporada del año

**Date**: 2026-10-09
**Spec**: [revisar_temporada_del_año.md](../1-functional/revisar_temporada_del_año.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Bounded context**: `pricing`

## Summary

La feature 011 administra y consulta el calendario anual de clasificación estacional dentro del bounded context `pricing`. El Administrador consulta la clasificación por año/rango y puede registrar una nueva versión completa de la clasificación anual, incluyendo períodos base y excepciones puntuales. El caso de uso valida referencias al catálogo de temporadas de 009, rangos y conflictos antes de activar la nueva versión; la escritura, su vigencia y su auditoría son atómicas.

Los períodos base son inclusivos por fecha y no pueden solaparse. Una excepción puntual corresponde a una fecha exacta y puede sobrescribir el período base aplicable; dos excepciones distintas para la misma fecha se rechazan. Las fechas sin clasificación explícita resuelven a la temporada default `Regular` de 009 y la vista administrativa informa que se aplicó el default. Un calendario incoherente nunca se usa silenciosamente para tarifa dinámica.

005 consulta la clasificación mediante un puerto interno, usando un único `asOf` por operación para no mezclar revisiones ante cambios concurrentes. Las versiones anteriores del calendario quedan disponibles para auditoría. Las cotizaciones por noche ya persistidas no se actualizan cuando se publica una revisión nueva. El calendario describe fechas del hotel; los cambios realizados quedan auditados con actor e instante UTC.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS
**Primary Dependencies**: NestJS 10.x, Prisma ORM, PostgreSQL range constraints/transactions, Passport-JWT/Guards, Jest
**Storage**: PostgreSQL 16 — `season_calendar_revision` y `season_calendar_entry`; el catálogo/ajuste de temporadas es propiedad de 009
**Testing**: Jest para dominio y aplicación; Supertest + Testcontainers para contratos HTTP, auditoría, integridad temporal, solapamientos y concurrencia; test de contrato del puerto interno de 005
**Target Platform**: Servicio backend Linux en contenedor Docker
**Project Type**: Servicio backend único (monolito modular hexagonal), bounded context `pricing`, sin frontend
**Performance Goals**: Consulta local de una clasificación o un rango sin llamadas externas; retorno completo y consistente del rango solicitado sin resultados parciales
**Constraints**: Solo Administrador consulta/administra calendario; fechas de calendario como `date` local del hotel; rango base sin solapamientos; excepción puntual prevalece sobre base; excepción-excepción duplicada rechazada; fechas no clasificadas usan default regular; revisiones históricas auditables; cotizaciones existentes inmutables
**Scale/Scope**: Revisión/configuración de calendarios por año, resolución de temporada por fecha y rango para 005; no gestiona porcentaje/precio, catálogo de temporadas ni tarifa base

## Project Structure

### Documentation (this feature)

```text
features/011-revisar-temporada-del-año/
├── 1-functional/
│   └── revisar_temporada_del_año.md
└── 2-technical/
    ├── plan.md
    └── contracts/
        ├── ADMIN-season-calendar.md
        └── PORT-resolve-season-by-date.md
```

### Source Code (repository root)

Solo se listan los archivos propiedad de 011. La identidad, nombre, color y porcentaje de ajuste de la temporada son de 009; 011 almacena únicamente referencias estacionales y sus períodos.

```text
src/
├── domain/
│   ├── model/pricing/
│   │   ├── season-calendar.ts                  # Revisión anual y sus entries
│   │   ├── season-calendar-entry.ts             # Período base o excepción puntual
│   │   └── calendar-date-range.vo.ts            # Rango inclusivo de fechas calendario
│   ├── errors/
│   │   ├── invalid-calendar-year.error.ts
│   │   ├── invalid-season-calendar-entry.error.ts
│   │   ├── overlapping-season-calendar.error.ts
│   │   ├── duplicate-season-exception.error.ts
│   │   ├── season-calendar-not-found.error.ts
│   │   └── season-calendar-unavailable.error.ts
│   └── ports/
│       ├── in/
│       │   ├── review-season-calendar.use-case.ts
│       │   ├── replace-season-calendar.use-case.ts
│       │   └── resolve-season-by-date.use-case.ts
│       └── out/
│           ├── season-calendar.repository.port.ts
│           └── season-catalog-query.port.ts      # Consulta de IDs/default a 009
│
├── application/
│   ├── services/pricing/
│   │   ├── review-season-calendar.service.ts
│   │   ├── replace-season-calendar.service.ts
│   │   └── resolve-season-by-date.service.ts
│   └── dto/pricing/
│       ├── review-season-calendar.query.ts
│       ├── replace-season-calendar.command.ts
│       └── resolve-season-by-date.query.ts
│
└── infrastructure/
    ├── adapters/
    │   ├── in/http/
    │   │   └── season-calendar.controller.ts
    │   └── out/persistence/
    │       ├── mappers/season-calendar.mapper.ts
    │       └── repositories/prisma-season-calendar.repository.ts
    └── config/
        └── pricing.module.ts

prisma/
├── schema.prisma                                # SeasonCalendarRevision, SeasonCalendarEntry
└── migrations/
    └── <timestamp>_season_calendar/
        └── migration.sql

test/
├── unit/
│   ├── domain/pricing/season-calendar-entry.spec.ts
│   └── application/pricing/season-calendar.service.spec.ts
├── integration/
│   └── persistence/pricing/prisma-season-calendar.repository.spec.ts
├── e2e/
│   └── pricing/season-calendar.e2e-spec.ts
└── contract/
    └── pricing/resolve-season-by-date.contract.spec.ts
```

**Structure Decision**: Se reutiliza el bounded context `pricing` y el modelo hexagonal del plan base. El controller solo aplica autorización/validación de transporte; dominio/aplicación validan y resuelven la clasificación, y Prisma implementa los puertos. 011 no llama a Módulo 1/2 ni modifica reglas de precios de 009.

## Diseño técnico

### Adaptadores de entrada

La matriz del plan base declara `GET /admin/season-calendar`; la decisión de incluir administración de calendario añade `PUT /admin/season-calendar/{year}` para publicar atómicamente la revisión de un año. Ambas operaciones requieren JWT con `role = Administrador`. El consumidor 005 no usa una ruta REST: accede al caso de uso interno de resolución por fecha.

| Método y ruta | Propósito | Respuesta |
|---|---|---|
| `GET /admin/season-calendar?year={YYYY}&from?={YYYY-MM-DD}&to?={YYYY-MM-DD}` | Consultar calendario anual completo o una ventana del año, incluidos huecos, excepciones, leyenda y conflictos existentes | `200` |
| `PUT /admin/season-calendar/{year}` | Publicar una revisión completa e inmutable de clasificación anual y excepciones | `200` con revisión activa |

No se exponen mutaciones por elemento en rutas separadas: el `PUT` reemplaza la definición completa del año como una única revisión validada. Esto evita estados parciales al cambiar múltiples rangos. Si el calendario actual fue leído antes de editarlo, puede enviarse `expectedRevision` para control optimista; una versión obsoleta se rechaza sin sobrescribir el cambio concurrente. El detalle de cuerpo, precedencia, errores y respuesta se especifica en [`contracts/ADMIN-season-calendar.md`](contracts/ADMIN-season-calendar.md).

### Modelo de dominio y representación temporal

- `CalendarYear` es un entero entre 1 y 9999 y determina el intervalo `[YYYY-01-01, (YYYY+1)-01-01)`. `from` y `to` son fechas civiles del hotel, no timestamps; los rangos del API son inclusivos.
- `SeasonCalendarEntry` contiene `entryId`, `seasonId`, `kind` (`BASE` o `EXCEPTION`), `startDate`, `endDate`, `validFrom` y `validTo`.
- `BASE` puede cubrir uno o varios días del año y su intervalo no puede cruzar el límite del año. Dos entradas `BASE` con días compartidos se rechazan.
- `EXCEPTION` cubre exactamente un día (`startDate = endDate`) y puede superponerse con una entrada `BASE`: tiene precedencia explícita. Dos excepciones para la misma fecha se rechazan incluso si apuntan a la misma temporada; no se usa orden de inserción para desempatar.
- Una fecha que no coincide con ninguna entrada `BASE` o `EXCEPTION` se resuelve al `defaultSeasonId` del catálogo de 009, con `isDefault = true` y clasificación `DEFAULT`. El hueco se hace explícito en la respuesta administrativa.
- `seasonId` debe existir en el catálogo retornado por 009. Los nombres, colores y porcentajes no se copian como fuente de verdad en el calendario; se adjuntan al consultar a través del snapshot de catálogo.
- El calendario permite las categorías configuradas en 009; no codifica enum fijo `HIGH/REGULAR/LOW`. `BASE`/`EXCEPTION` describe el papel temporal, no una categoría estacional.

### Versionado y auditoría

Cada `PUT` crea una nueva revisión inmutable con `revision`, `year`, `effectiveAt`, `changedBy`, `changedAt` y todas las entradas suministradas. La revisión previa se conserva íntegra. `expectedRevision` permite comparar y actualizar sin perder cambios concurrentes. Una revisión no válida no cambia la versión activa ni escribe historial/auditoría parcial.

Los cambios de clasificación aplican a nuevas consultas que capturen un `asOf` posterior a `effectiveAt`. Las cotizaciones existentes son snapshots de 005 y nunca se reescriben; liquidaciones/facturas derivadas conservan sus importes. Los cambios programados para períodos futuros pueden permanecer en revisiones publicadas antes de que lleguen esas fechas; la clasificación se aplica por fecha de estancia y no altera resultados ya materializados.

La hora de publicación y las fechas civiles se manejan por separado: `effectiveAt`/auditoría en UTC; noches/fechas del calendario en `YYYY-MM-DD` de la zona comercial configurada para el hotel. No se convierte un día del calendario a UTC para determinar su fecha.

### Persistencia y validación de consistencia

| Tabla | Campos esenciales | Restricciones |
|---|---|---|
| `season_calendar_revision` | `id`, `year`, `revision`, `effective_at`, `changed_by`, `changed_at`, `is_active` | `UNIQUE(year, revision)`; máximo una activa por año; versiones publicadas inmutables |
| `season_calendar_entry` | `id`, `revision_id`, `season_id`, `kind`, `start_date`, `end_date` | FK a revisión y season; `start_date <= end_date`; dentro del año; excepción de un solo día |

La activación de una revisión y la inserción completa de sus entradas ocurre en una sola transacción. La validación de dominio detecta conflictos con mensajes que identifican rango/fecha y entradas en colisión. La persistencia usa una restricción de exclusión PostgreSQL sobre rangos de `BASE` para defensa concurrente; las restricciones de `EXCEPTION` aseguran unicidad por fecha dentro de la revisión. Las excepciones pueden superponerse con los rangos base por diseño, pero no con otra excepción.

Para `resolveSeasonByDate`, la lectura selecciona la revisión efectiva para `asOf`, busca primero una excepción puntual, luego un rango base y por último usa el default de 009. Una sola transacción de lectura obtiene revisión y entradas; la consulta no puede ver la mitad de una publicación.

`GET` devuelve estado de conflicto si lee una revisión histórica malformada (p. ej. datos anteriores a las restricciones), pero la resolución consumida por 005 falla explícitamente antes de devolver clasificación. No se aplica prioridad implícita ni se retorna una temporada parcial.

### Puertos y colaboración con 009/005

```ts
export interface ResolveSeasonByDateUseCase {
  resolve(query: ResolveSeasonByDateQuery): Promise<SeasonClassification>;
}

export interface ResolveSeasonByDateQuery {
  date: string;       // YYYY-MM-DD, fecha civil del hotel
  asOf: Date;         // mismo instante de snapshot de las reglas 009
}

export interface SeasonClassification {
  date: string;
  seasonId: string;
  source: 'BASE' | 'EXCEPTION' | 'DEFAULT';
  entryId: string | null;
  revision: number;
  calendarEffectiveAt: string;
}
```

005 captura un único `asOf` para el cálculo del rango, solicita el snapshot de reglas a 009 y resuelve la temporada de cada noche mediante 011 con ese mismo `asOf`. Luego toma el ajuste por `seasonId` del snapshot 009. Esto evita la carrera de combinar un calendario posterior con reglas de precio anteriores o viceversa. 011 no calcula tarifas ni depende de la tarifa base.

Un rango puede cruzar años: 005 resuelve cada fecha de forma independiente y 011 escoge la revisión correspondiente al año civil de cada fecha. La validación de la consulta de rango y el formato de salida noche a noche son responsabilidad de 005; la consulta administrativa de 011 limita `from`/`to` a un único año.

### Errores

Errores de dominio salen con `ApiError` en HTTP y como errores tipados por el puerto interno. El calendario no disponible/inconsistente nunca se convierte en default; el default solo se usa cuando no existe asignación válida para una fecha dentro de un calendario consistente.

| Error | `errorCode` | HTTP | Efecto |
|---|---|---:|---|
| Año/fechas malformados o rango invertido/fuera del año | `INVALID_CALENDAR_RANGE` | 400 | Sin lectura parcial ni publicación |
| ID de temporada desconocido en el catálogo 009 | `SEASON_NOT_FOUND` | 422 | Rechaza la revisión completa |
| Rangos base solapados | `OVERLAPPING_SEASON_CALENDAR` | 409 | No activa la revisión |
| Excepciones duplicadas para una fecha | `DUPLICATE_SEASON_EXCEPTION` | 409 | No activa la revisión |
| `expectedRevision` no es la activa | `SEASON_CALENDAR_CONFLICT` | 409 | Conserva la revisión ganadora |
| Revisión solicitada inexistente | `SEASON_CALENDAR_NOT_FOUND` | 404 | Sin resultados |
| Calendario/catálogo incoherente o corrupto | `SEASON_CALENDAR_INCONSISTENT` | Error interno de dominio (sin HTTP) | La consulta de 005 falla sin resultado parcial; `GET` administrativo señala el conflicto |
| JWT ausente/inválido | `UNAUTHENTICATED` | 401 | No ejecuta operación administrativa |
| Rol distinto de Administrador | `FORBIDDEN` | 403 | No ejecuta operación administrativa |
| Persistencia temporalmente no disponible | `DATABASE_UNAVAILABLE` | 503 | Rollback completo; reintentable |

## Phase 1: Setup (específico de esta feature)

**Purpose**: Coordinar el ownership del calendario, catálogo e instantánea con 009/005.

- [ ] T001 Confirmar que están disponibles `PricingModule`, `PrismaService`, JWT/roles, `ApiError` y `DateRange` del plan base.
- [ ] T002 Acordar con 009 el contrato de consulta por `seasonId`, catálogo/default y regla efectiva por un único `asOf`.
- [ ] T003 Acordar con 005 la semántica de fecha civil, resolución por noche y propagación del mismo `asOf` al puerto de reglas de 009.
- [ ] T004 Publicar en OpenAPI que 011 permite revisar (`GET`) y reemplazar atómicamente (`PUT`) una revisión anual del calendario.

**Checkpoint**: se han fijado dueños de catálogo/calendario y la firma de resolución interna.

## Phase 2: Foundational (prerrequisitos bloqueantes)

**Purpose**: Crear los modelos y garantías comunes a revisión, administración y resolución.

- [ ] T005 Implementar `CalendarYear`, `CalendarDateRange` y validación de fechas civiles inclusivas del año.
- [ ] T006 Implementar `SeasonCalendarEntry` con tipos `BASE`/`EXCEPTION` y precedencia puntual explícita.
- [ ] T007 Definir puertos de entrada `ReviewSeasonCalendarUseCase`, `ReplaceSeasonCalendarUseCase` y `ResolveSeasonByDateUseCase`, más tokens.
- [ ] T008 Definir `SeasonCalendarRepositoryPort` y `SeasonCatalogQueryPort` hacia 009.
- [ ] T009 Crear modelos Prisma de revisión/entradas e índices/restricciones; no duplicar nombre, color o ajuste del catálogo 009.
- [ ] T010 Implementar `SeasonCalendarMapper` y repositorio Prisma con transacción de publicación, historial y lectura por snapshot `asOf`.
- [ ] T011 Registrar errores de dominio, códigos `ApiError` y bindings de puertos en `PricingModule`.

**Checkpoint**: la revisión del calendario se puede validar y leer sin depender de endpoints remotos ni datos duplicados.

## Phase 3: User Story 1 — Revisar la clasificación anual y detectar huecos/conflictos (Prioridad: P1)

**Goal**: El Administrador ve los períodos, temporadas, excepciones y vacíos de manera inequívoca.

**Independent Test**: consultar un año con rangos base, una excepción y fechas sin asignación; verificar la etiqueta/color efectiva, origen `EXCEPTION`/`BASE`/`DEFAULT` y los conflictos si hay datos heredados incoherentes.

### Tests for User Story 1

- [ ] T012 [P] [US1] Unit tests del resolver: rango base, excepción sobre base, default para hueco y límites inclusivos de fechas.
- [ ] T013 [P] [US1] Unit tests de validación: fin anterior a inicio, fechas fuera del año, rango que cruza de año y catálogo sin temporada referenciada.
- [ ] T014 [P] [US1] Contract/e2e test de `GET /admin/season-calendar`: año completo, rango parcial, autenticación, rol, huecos y enriquecimiento con nombre/color de 009.
- [ ] T015 [US1] Integration test Postgres que comprueba lectura de una revisión completa en una sola transacción y reporta explícitamente filas conflictivas heredadas.

### Implementation for User Story 1

- [ ] T016 [US1] Implementar `ReviewSeasonCalendarService` y read model que expone cada período, excepción y hueco con clasificación default visible.
- [ ] T017 [US1] Implementar `GET /admin/season-calendar`, validar `year/from/to`, proteger con JWT/rol Administrador.
- [ ] T018 [US1] Resolver/adjuntar nombres, colores y reglas vigentes con el catálogo de 009 para que el Administrador pueda revisar la leyenda completa.

**Checkpoint**: la vista administrativa representa la temporada efectiva y no oculta huecos o incoherencias.

## Phase 4: User Story 2 — Resolver la clasificación canónica para tarifa dinámica (Prioridad: P1)

**Goal**: 005 utiliza la misma clasificación revisada por el Administrador con snapshot consistente por operación.

**Independent Test**: con clasificación alta para una fecha y hueco en otra, llamar el puerto interno para ambas y verificar alta/default; cambiar calendario durante una consulta simulada y comprobar que todas las fechas usan la revisión seleccionada por un solo `asOf`.

### Tests for User Story 2

- [ ] T019 [P] [US2] Contract test del puerto para fecha en BASE, fecha en EXCEPTION, fecha DEFAULT y fecha de un año distinto.
- [ ] T020 [P] [US2] Unit tests: excepción prevalece; dos excepciones o solapamiento BASE levantan error de inconsistencia en vez de elegir prioridad.
- [ ] T021 [US2] Integration test concurrente de resolución/publicación: una lectura ve completamente revisión anterior o nueva; no mezcla entradas.
- [ ] T022 [US2] Integration test de no retroactividad: publicación nueva cambia la resolución de futuros cálculos, pero no actualiza una cotización ya persistida por 005.

### Implementation for User Story 2

- [ ] T023 [US2] Implementar `ResolveSeasonByDateService.resolve(date, asOf)` con precedencia `EXCEPTION > BASE > DEFAULT`.
- [ ] T024 [US2] Implementar selección de revisión por año y `asOf`; fallar explícitamente si el catálogo, revisión o referencias están corruptos.
- [ ] T025 [US2] Exportar el puerto tipado para 005 y documentar que se usa el mismo instante de snapshot del puerto 009.
- [ ] T026 [US2] Confirmar que 005 utiliza el resultado por fecha en vez de una clasificación local o enum hardcodeado.

**Checkpoint**: todas las consultas usan la clasificación canónica, determinista y consistente del calendario.

## Phase 5: User Story 3 — Publicar revisiones anuales sin conflictos ni estados parciales (Prioridad: P2)

**Goal**: El Administrador puede administrar períodos y excepciones, con conflictos rechazados antes de que la revisión sea visible.

**Independent Test**: publicar un calendario válido con rango base y excepción; verificar que se activa una nueva revisión; enviar rangos base solapados o excepciones duplicadas y confirmar que la revisión activa permanece intacta.

### Tests for User Story 3

- [ ] T027 [P] [US3] Unit tests de `ReplaceSeasonCalendarService`: alta/modificación/borrado mediante reemplazo completo, excepción válida y temporada inexistente.
- [ ] T028 [P] [US3] Tests de conflictos: rangos base con cualquier día compartido; excepción-excepción duplicada; excepción única sobre base aceptada.
- [ ] T029 [US3] E2E/contract tests del `PUT`: validación, control `expectedRevision`, 409 en carrera, auth 401/403 y respuesta de revisión.
- [ ] T030 [US3] Integration test Postgres de dos publicaciones concurrentes con el mismo `expectedRevision`; solo una se activa y la otra recibe conflicto.
- [ ] T031 [US3] Integration test de atomicidad: falla al insertar una entrada o auditoría y la revisión activa anterior sigue intacta.

### Implementation for User Story 3

- [ ] T032 [US3] Implementar reemplazo completo de un año validando todas las referencias a temporada y conflictos antes de persistir.
- [ ] T033 [US3] Crear nueva `SeasonCalendarRevision` con actor y hora DB, activar atómicamente e inmovilizar revisiones anteriores.
- [ ] T034 [US3] Implementar control de concurrencia `expectedRevision` y restricciones de BD para solapamientos/duplicados.
- [ ] T035 [US3] Mapear errores de dominio a respuestas `ApiError` accionables; no aceptar ni publicar resultados parciales.

**Checkpoint**: las configuraciones son versionadas, auditables y solo una revisión íntegra es visible por año/instante.

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T036 Documentar ambos contratos (HTTP y puerto interno) en OpenAPI/documentación técnica del módulo.
- [ ] T037 Añadir logs estructurados por `year`, `revision`, `actorId`, resultado y duración; omitir tokens.
- [ ] T038 Ejecutar pruebas de migración desde BD vacía y validar índices/constraints PostgreSQL para rangos solapados.
- [ ] T039 Añadir test de arquitectura: `pricing` es el único dueño de escrituras del calendario; 005 solo resuelve/lee; 007/006 no consumen reglas actuales para recalcular snapshots.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** depende del scaffolding base y del acuerdo de contrato con 009 y 005.
- **Foundational (Phase 2)** bloquea todas las historias: dominio, repositorio, versionado, errores e inyección.
- **User Story 1 (Phase 3)** depende del catálogo legible de 009 y entrega la vista administrativa.
- **User Story 2 (Phase 4)** depende de resolución y snapshots; su consumidor es 005.
- **User Story 3 (Phase 5)** depende de persistencia/versionado; implementa administración completa y control de conflictos.
- **Polish (Phase 6)** depende de rutas/puertos y persistencia completos.

### Dependencias con otras features

- **009 Modificar precio tarifa según temporada** posee el catálogo de temporadas (IDs, nombres, colores, default) y los porcentajes; 011 solo guarda `seasonId` y los períodos clasificados.
- **005 Consultar tarifa dinámica** consume el puerto `ResolveSeasonByDateUseCase` y el snapshot de reglas de 009; usa la clasificación y ajuste de cada fecha, no una temporada única para toda la estancia.
- **007 Generar liquidación** lee la cotización guardada; no consulta el calendario ni recalcula importes.
- **006 Generar factura final** congela los importes de 007; no consulta temporadas.
- **Módulo 1** es propietario de la tarifa base; 011 no lo consulta ni modifica.

## Notes

- La aprobación del alcance por el usuario incluye que 011 también administra altas, modificaciones y excepciones; el plan escoge un único `PUT` de reemplazo completo por año para preservar atomicidad.
- El calendario es anual, mientras los porcentajes son configuración versionada de 009. La revisión del calendario solo referencia `seasonId`; nombre, color y regla de precio se consultan al catálogo.
- Los intervalos base son inclusivos para API/dominio y se validan como fechas civiles; la persistencia puede representarlos como rangos PostgreSQL semiabiertos `[startDate, endDate + 1 day)` para restricciones de solapamiento.
- Solapamiento excepción-base es intencional (la excepción prevalece); solapamiento base-base o excepción-excepción no es resoluble y se rechaza antes de activar.
- Una consulta administrativa puede mostrar huecos como default regular; una referencia rota o conflicto real no se disfraza como default.
- Publicar una revisión no cambia las tarifas ya consultadas, cotizaciones existentes, liquidaciones ni facturas; solo los cálculos futuros observan la revisión efectiva para su `asOf`.
