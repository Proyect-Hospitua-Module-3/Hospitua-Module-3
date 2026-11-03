# Implementación: Revisar temporada del año (011)

**Spec**: [revisar_temporada_del_año.md](../1-functional/revisar_temporada_del_año.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contratos**: [ADMIN-season-calendar.md](../2-technical/contracts/ADMIN-season-calendar.md) (REST) · [PORT-resolve-season-by-date.md](../2-technical/contracts/PORT-resolve-season-by-date.md) (puerto interno para 005)
**Rama**: `implementation/011-revisar-temporada`

Este documento es el mapa de dónde está el código de la 011. El código no vive en esta carpeta: sigue la arquitectura hexagonal del plan base, así que está repartido por capas en `src/` y `test/`, siempre dentro de una subcarpeta `pricing/`.

> Para encontrar todos los archivos de la 011 en VS Code: `Ctrl+Shift+F` y buscar `Feature 011`.

---

## 1. Qué hace

El Administrador mantiene el **calendario anual de temporadas**: qué temporada del catálogo de 009 (Regular, Alta, Baja…) rige cada fecha del año. Hay dos tipos de entrada:

- **BASE**: un período de uno o varios días. Pertenece al año en que empieza y puede llegar hasta el 31 de diciembre del año siguiente (por ejemplo, del 20-12-2026 al 10-01-2027).
- **EXCEPTION**: un solo día, que prevalece sobre el período BASE de esa fecha.

Una fecha sin entradas cae en la temporada por defecto (`Regular`), y la vista lo señala. Cada publicación crea una **revisión** nueva e inmutable del año, con responsable e instante; las anteriores quedan para auditoría.

| Endpoint | Qué hace |
|---|---|
| `GET /admin/season-calendar?year=YYYY` | Muestra el calendario del año (o una ventana `from`/`to`), las entradas que vienen del año anterior, los días que caen al default y los conflictos. Con `asOf` o `revision` muestra una revisión pasada |
| `PUT /admin/season-calendar/{year}` | Publica la lista completa de entradas del año como una revisión nueva; lo que no venga queda eliminado |

Los dos exigen el rol Administrador. Además, el puerto interno `ResolveSeasonByDateUseCase` le dice a 005 qué temporada rige una fecha en un instante dado (`EXCEPTION > BASE > DEFAULT`), y el repositorio responde a 009 si una temporada está en uso antes de retirarla.

---

## 2. Recorrido de una petición

Así viaja `PUT /admin/season-calendar/2026` con `{ "expectedRevision": 1, "entries": [ … ] }`:

```text
HTTP ─► JwtAuthGuard + RolesGuard              ¿hay token? ¿es Administrador?                    → 401 / 403
     ─► SeasonAdminController + ValidationPipe  ¿solo campos permitidos y de tipo texto/entero?   → 400
     ─► ReplaceSeasonCalendarService            SeasonCalendarDraft.parse: año, fechas reales,
                                                inicio dentro del año, EXCEPTION de un día,
                                                BASE hasta el año siguiente                       → 400
     ─► PrismaSeasonCalendarRepository.publish  ┌ bloquea los años 2025, 2026 y 2027 (pg_advisory_xact_lock)
                                                │ lee la revisión activa, las temporadas usadas (FOR SHARE)
                                                │ y los BASE activos de los años vecinos
                                                │ draft.assertPublishable (DOMINIO decide):
                                                │   ¿revisión esperada? ¿temporadas existen y no retiradas?
                                                │   ¿excepciones repetidas? ¿BASE que comparten días?    → 409 / 422
                                                │ desactiva la revisión anterior, guarda la nueva con la hora
                                                │ de la base y actualiza season_calendar_active_base
                                                └ todo en una transacción (si algo falla, no queda nada)
     ─► ReviewSeasonCalendarService             arma la respuesta con nombres y colores de 009
◄─── 200 { year, revision, effectiveAt, changedBy, entries, carriedInEntries, unclassifiedRanges, conflicts, … }
```

**Idea clave para explicar:** igual que en 009, el repositorio pone los candados y guarda, pero **quien decide es el dominio** (`SeasonCalendarDraft.assertPublishable`), con el estado leído ya bajo bloqueo. La base de datos tiene además una restricción de exclusión como última defensa contra períodos solapados entre años.

---

## 3. Archivos por capa

### Dominio — reglas de negocio puras (sin NestJS ni Prisma)

| Archivo | Qué hace | Requisito |
|---|---|---|
| [calendar-date.vo.ts](../../../src/domain/model/pricing/calendar-date.vo.ts) | Fecha civil `YYYY-MM-DD` del hotel; aritmética de días sin `Date` ni zonas horarias | FR-007 |
| [calendar-year.vo.ts](../../../src/domain/model/pricing/calendar-year.vo.ts) | Año entre 1 y 9999 y el último día al que puede llegar un BASE | FR-007, BR-006 |
| [calendar-date-range.vo.ts](../../../src/domain/model/pricing/calendar-date-range.vo.ts) | Rango inclusivo de fechas; días en común con otro rango | FR-004, FR-007 |
| [season-calendar-entry.ts](../../../src/domain/model/pricing/season-calendar-entry.ts) | Entrada BASE o EXCEPTION; valida una entrada del `PUT` | FR-002, FR-009, BR-006 |
| [season-calendar.ts](../../../src/domain/model/pricing/season-calendar.ts) | `SeasonCalendarRevision` (revisión guardada), `SeasonCalendarDraft` (lo que se quiere publicar y sus reglas) y `YearCalendar` (resuelve una fecha e inspecciona una ventana: huecos y conflictos) | FR-002–FR-004, FR-006, FR-009, FR-010, BR-002–BR-006 |
| [errors/pricing/](../../../src/domain/errors/pricing/) | 8 errores de la 011: 6 con código HTTP y 2 internos del puerto para 005 (`SEASON_CALENDAR_INCONSISTENT`, `SEASON_CALENDAR_UNAVAILABLE`) | — |
| [review-season-calendar.use-case.ts](../../../src/domain/ports/in/pricing/review-season-calendar.use-case.ts) | Puerto de entrada: revisar un año o una ventana | FR-001 |
| [replace-season-calendar.use-case.ts](../../../src/domain/ports/in/pricing/replace-season-calendar.use-case.ts) | Puerto de entrada: publicar el año completo | FR-009 |
| [resolve-season-by-date.use-case.ts](../../../src/domain/ports/in/pricing/resolve-season-by-date.use-case.ts) | Puerto de entrada interno para 005 | FR-006 |
| [season-calendar.repository.port.ts](../../../src/domain/ports/out/pricing/season-calendar.repository.port.ts) | Puerto de salida: lectura por instante y publicación con bloqueo y decisión del dominio | FR-008, FR-009 |
| [season-catalog-query.port.ts](../../../src/domain/ports/out/pricing/season-catalog-query.port.ts) | Puerto de salida: catálogo de 009 en un instante | FR-002, FR-010 |

### Aplicación — casos de uso

| Archivo | Qué hace | Requisito |
|---|---|---|
| [review-season-calendar.service.ts](../../../src/application/services/pricing/review-season-calendar.service.ts) | Valida la consulta antes de leer, carga la revisión del año y la del anterior, y adjunta nombre, color y ajuste de 009 | FR-001–FR-004, FR-007 |
| [replace-season-calendar.service.ts](../../../src/application/services/pricing/replace-season-calendar.service.ts) | Valida el borrador, exige responsable, publica y responde con el calendario resultante | FR-008, FR-009, NFR-004 |
| [resolve-season-by-date.service.ts](../../../src/application/services/pricing/resolve-season-by-date.service.ts) | Temporada de una fecha en un `asOf`; falla en vez de elegir si los datos son ambiguos | FR-006, BR-004, NFR-003 |
| [season-catalog-lookup.ts](../../../src/application/services/pricing/season-catalog-lookup.ts) | Índice por id del snapshot de 009 (incluye retiradas, para revisiones históricas) | FR-002 |

### Infraestructura — adaptadores

| Archivo | Qué hace | Requisito |
|---|---|---|
| [season-admin.controller.ts](../../../src/infrastructure/adapters/in/http/pricing/season-admin.controller.ts) | **Compartido con 009.** La 011 agrega `GET /admin/season-calendar` y `PUT /admin/season-calendar/{year}`; cualquier error de forma responde `INVALID_CALENDAR_RANGE` | FR-005, BR-001 |
| [season-calendar.dto.ts](../../../src/infrastructure/adapters/in/http/pricing/dto/season-calendar.dto.ts) | Query, cuerpo y respuesta HTTP (también documentan Swagger) | — |
| [season-rules-catalog.adapter.ts](../../../src/infrastructure/adapters/out/catalog/season-rules-catalog.adapter.ts) | Implementa `SeasonCatalogQueryPort` con el puerto `GetEffectiveSeasonRulesUseCase` de 009; nunca lee sus tablas para mostrar o resolver | FR-002 |
| [prisma-season-calendar.repository.ts](../../../src/infrastructure/adapters/out/persistence/repositories/pricing/prisma-season-calendar.repository.ts) | Lectura por instante en una sola consulta, esperando con un bloqueo compartido a que terminen las publicaciones en curso; publicación con `pg_advisory_xact_lock` sobre N-1/N/N+1, `FOR SHARE` de temporadas, proyección de BASE activos y traducción de `23P01`. También implementa `SeasonCalendarReferencePort` de 009 | FR-008, FR-009, NFR-002 |
| [season-calendar.mapper.ts](../../../src/infrastructure/adapters/out/persistence/mappers/pricing/season-calendar.mapper.ts) | Filas de PostgreSQL → dominio (fechas como texto, sin `Date`) | — |
| [domain-exception.filter.ts](../../../src/infrastructure/adapters/in/http/domain-exception.filter.ts) | **Compartido.** La 011 agrega sus 6 `errorCode` con su HTTP | — |
| [pricing.module.ts](../../../src/infrastructure/config/pricing.module.ts) | **Compartido con 009.** Conecta los puertos de 011 y exporta `RESOLVE_SEASON_BY_DATE_USE_CASE` para 005 | — |

### Base de datos

| Archivo | Qué hace | Requisito |
|---|---|---|
| [schema.prisma](../../../prisma/schema.prisma) | **Compartido.** Modelos `SeasonCalendarRevision`, `SeasonCalendarEntry`, `SeasonCalendarActiveBase` (y la relación inversa en `Season`) | — |
| [migration.sql](../../../prisma/migrations/20261031120000_season_calendar/migration.sql) | Tablas y restricciones (ver abajo). Generada con `prisma migrate diff` más SQL manual | FR-004, FR-008, NFR-002 |

La base de datos es la **última defensa** de las reglas, aunque alguien se salte la aplicación:

| Restricción | Garantiza |
|---|---|
| `season_calendar_revision_single_active` (índice único parcial) | Una sola revisión activa por año |
| `season_calendar_revision_year_revision_key` (único) | Números de revisión únicos por año |
| `season_calendar_entry_kind`, `_valid_interval`, `_start_in_year`, `_base_until_next_year`, `_exception_single_day` (CHECK) | Tipo válido, inicio ≤ fin, inicio en el año de la revisión, BASE hasta el año siguiente, excepción de un día |
| `season_calendar_entry_single_exception` (índice único parcial) | Dos excepciones de una revisión nunca caen el mismo día |
| `season_calendar_entry_season_id_fkey` (FK) | Solo se asignan temporadas que existen |
| `season_calendar_active_base_no_overlap` (EXCLUDE con `gist`) | Dos BASE de revisiones activas nunca comparten un día, aunque sean de años distintos |

---

## 4. Pruebas

El caso de prueba manual, con la plantilla del curso, está en [4-testing/TC-011-revisar-temporada-del-año.md](../4-testing/TC-011-revisar-temporada-del-año.md). Las pruebas automáticas son estas:

| Archivo | Qué comprueba | Pruebas |
|---|---|:-:|
| [calendar-date-range.vo.spec.ts](../../../test/unit/domain/pricing/calendar-date-range.vo.spec.ts) | Fechas civiles sin zona horaria, años, límite de un BASE, año bisiesto, rangos inclusivos e intersección | 37 |
| [season-calendar-entry.spec.ts](../../../test/unit/domain/pricing/season-calendar-entry.spec.ts) | Entradas válidas e inválidas del `PUT` | 20 |
| [season-calendar.spec.ts](../../../test/unit/domain/pricing/season-calendar.spec.ts) | Reglas de publicación, precedencia, heredados, huecos y conflictos | 38 |
| [review-season-calendar.service.spec.ts](../../../test/unit/application/pricing/review-season-calendar.service.spec.ts) | Año completo, ventana, `asOf`, `revision`, validación, catálogo | 22 |
| [replace-season-calendar.service.spec.ts](../../../test/unit/application/pricing/replace-season-calendar.service.spec.ts) | Reemplazo completo, `expectedRevision`, temporada desconocida o retirada, conflictos | 12 |
| [resolve-season-by-date.service.spec.ts](../../../test/unit/application/pricing/resolve-season-by-date.service.spec.ts) | Validación de fecha y `asOf`, mismo `asOf` hacia 009, errores del catálogo o del calendario (nunca cae al default) | 9 |
| [resolve-season-by-date.contract.spec.ts](../../../test/contract/pricing/resolve-season-by-date.contract.spec.ts) | Contrato con 005: campos y casos BASE, heredado, EXCEPTION, DEFAULT | 7 |
| [prisma-season-calendar.repository.spec.ts](../../../test/integration/persistence/pricing/prisma-season-calendar.repository.spec.ts) | PostgreSQL real: lectura consistente, concurrencia (lectura durante una publicación sin confirmar, mismo año, años vecinos, retiro de 009), atomicidad, solapes entre años, `23P01`, restricciones | 27 |
| [season-calendar.e2e-spec.ts](../../../test/e2e/pricing/season-calendar.e2e-spec.ts) | Los 2 endpoints: 200, 400, 401, 403, 404, 409, 422, y `SEASON_IN_USE` de 009 | 40 |

Resultado actual: **las 212 pruebas de la 011 pasan**, incluidas las de integración contra PostgreSQL real (5 de 5 corridas estables). Con las de 001 y 009, el proyecto suma 387.

```powershell
$env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"
npm test             # unitarias, de contrato y de integración
npm run test:e2e     # endpoints de punta a punta
```

Las suites de integración de 009 y 011 borran las mismas tablas; se turnan con un bloqueo sobre la base de pruebas ([pricing-test-database-lock.ts](../../../test/support/database/pricing-test-database-lock.ts)).

---

## 5. Trazabilidad: requisito → código → prueba

| Requisito de la spec | Dónde se cumple | Dónde se prueba |
|---|---|---|
| FR-001 Revisar el año por fecha o rango | `ReviewSeasonCalendarService`, `GET` con `from`/`to` | unitarias de revisión; e2e GET y ventana |
| FR-002 / BR-002 Leyenda y colores de 009; la excepción prevalece | Catálogo adjunto al leer; `YearCalendar.resolve` | e2e (nombres y colores); unitarias de precedencia; contrato |
| FR-003 / BR-003 Regular por defecto | `defaultSeasonId` de 009; `unclassifiedRanges` | e2e "todo el año en default"; contrato DEFAULT |
| FR-004 / SC-002 Detectar solapes y duplicados | `assertPublishable`; `YearCalendar.inspect`; EXCLUDE | unitarias; e2e 409; integración "filas heredadas que se solapan" |
| FR-005 / BR-001 / SC-005 Solo Administrador | `@Roles('Administrador')` + `RolesGuard` | e2e 401 y 403 |
| FR-006 / SC-003 Referencia única para la tarifa | `ResolveSeasonByDateUseCase` exportado para 005 | contrato del puerto (el uso real se probará con 005) |
| FR-007 Rango inválido sin resultado parcial | Validación completa antes de leer | unitarias; e2e 400 |
| FR-008 / NFR-004 Vigencia y responsable | Revisión con `effectiveAt` y `changedBy` de la base y del token | e2e "revisión 1"; integración "hora de la base" |
| FR-009 / SC-006 Publicar atómicamente | Transacción única; reemplazo completo | integración "atomicidad"; e2e "nada publicado" tras cada rechazo |
| FR-010 Solo temporadas existentes y no retiradas | `FOR SHARE` + `assertPublishable` | e2e 422; integración "publicar mientras 009 retira" |
| BR-006 BASE que cruza al año siguiente, sin solapes entre años | `carriedInEntries`; BASE vecinos bajo bloqueo; EXCLUDE | e2e 2027 heredado; integración T040 y `23P01` |
| NFR-002 Concurrencia | `pg_advisory_xact_lock` N-1/N/N+1 + `expectedRevision` | integración: 5 publicaciones con la misma revisión; años vecinos simultáneos |
| NFR-003 Determinismo | Lectura por `asOf` en una sola consulta, tras esperar las publicaciones en curso | integración "lecturas simultáneas sin mezclar", "asOf anterior" y "publicación sin confirmar" |

---

## 6. Estado de las tareas del plan

| Tarea | Estado |
|---|---|
| T001 | Hecho, salvo `DateRange` compartido del plan base, que aún no existe: se usa `CalendarDateRange` propio |
| T002–T003 (acuerdos con 009 y 005) | Hecho en los contratos (`PORT-get-season-rules` de 009 y `PORT-resolve-season-by-date`); el código de 011 los usa tal cual |
| T004, T036 (OpenAPI) | Hecho: Swagger en `/docs` |
| T005–T011 (fundación) | Hecho |
| T012–T018 (Historia 1) | Hecho |
| T019–T021, T023–T025 (Historia 2) | Hecho |
| T022, T026 (no retroactividad y uso real por 005) | Pendiente: requiere la 005 |
| T027–T035 (Historia 3) | Hecho |
| T037 (logs estructurados) | Pendiente |
| T038 (migración desde base vacía y restricciones) | Hecho: `prisma migrate deploy` sobre base vacía e integración "restricciones de la migración" |
| T039 (test de arquitectura) | Pendiente |
| T040 (solapes entre años vecinos) | Hecho |

---

## 7. Decisiones de implementación

Están en las Notes del [plan](../2-technical/plan.md#decisiones-de-implementación-por-confirmar-con-el-equipo), por confirmar con el equipo: un solo `INVALID_CALENDAR_RANGE`; `expectedRevision: 0` igual a `null`; `effectiveAt` truncado a milisegundos; huecos y conflictos recortados a la ventana; resolución estricta ante dos BASE; `id` interno más `entry_id` estable; `CalendarDateRange` propio; la lectura espera a las publicaciones en curso; el `PUT` responde con la forma del `GET`; sin carpeta `application/dto/`; integración con `TEST_DATABASE_URL`.

---

## 8. Dependencias con otras features

- **009 Modificar precio tarifa según temporada**:
  - 011 lee el catálogo solo con su puerto `GetEffectiveSeasonRulesUseCase`.
  - El repositorio de 011 reemplaza al adaptador provisional `PendingSeasonCalendarReferenceAdapter` de 009 (ya borrado), así que retirar una temporada usada por el calendario ahora responde `409 SEASON_IN_USE`.
  - La carrera publicación/retiro (T016 de 009 y T030 de 011) se prueba en la integración de 011.
  - Los documentos de 009 que todavía mencionan el adaptador provisional, y el script `reset-catalogo-temporadas.sql` (que ahora falla si el calendario usa temporadas), son de 009 y no se modificaron aquí. Mientras tanto, para reiniciar el catálogo corre antes [reset-calendario-temporadas.sql](../4-testing/reset-calendario-temporadas.sql).
- **005 Consultar tarifa dinámica**: consumirá `RESOLVE_SEASON_BY_DATE_USE_CASE`, exportado por `PricingModule`, con el mismo `asOf` que use para las reglas de 009. Traduce `SEASON_CALENDAR_INCONSISTENT` y `SEASON_CALENDAR_UNAVAILABLE` a `422 UNEXPECTED_ERROR`.
- **Migraciones**: igual que en 009, las próximas se deben generar con `prisma migrate diff` desde el esquema anterior, para no perder el SQL escrito a mano.

---

## 9. Cómo mostrarlo funcionando

Pasos completos en el [README](../../../README.md). Con el servidor corriendo, en <http://localhost:3000/docs>:

1. `POST /auth/login` con el administrador → copiar el token → **Authorize**.
2. Crear dos temporadas con `POST /admin/season-rules` (009), por ejemplo Alta y Evento, y anotar sus `seasonId`.
3. `GET /admin/season-calendar?year=2026` → `revision: 0` y todo el año en `unclassifiedRanges` (default Regular).
4. `PUT /admin/season-calendar/2026` con `expectedRevision: null`, un BASE de Alta del `2026-12-20` al `2027-01-10` y una EXCEPTION de Evento el `2026-07-04` → **200**, revisión 1.
5. `GET /admin/season-calendar?year=2027` → el período de Alta aparece en `carriedInEntries` con `ownerYear: 2026`.
6. Repetir el `PUT` del paso 4 → **409** `SEASON_CALENDAR_CONFLICT`.
7. `DELETE /admin/season-rules/{id de Alta}` (009) → **409** `SEASON_IN_USE`.
