### Test Case Specification: Revisar temporada del año
**Created** : 2026-10-31  **Spec/Plan Link** : [revisar_temporada_del_año.md](../1-functional/revisar_temporada_del_año.md) · [plan.md](../2-technical/plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-011-RevisarTemporadaDelAño
**Product Name & Version** : HOSPITUA Módulo 3 (Facturación, Consumos y Liquidación) v0.1.0
**Author** : Jorge Jaraba
**Current Owner** : Equipo Módulo 3
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
This test case verifies that **el Administrador puede revisar y publicar el calendario anual de temporadas** (`GET /admin/season-calendar` y `PUT /admin/season-calendar/{year}`) functions successfully under specified operational conditions, y que el sistema:

- muestra la temporada de cada período con el nombre, el color y el ajuste del catálogo de 009 (FR-001, FR-002);
- señala las fechas sin clasificación y las resuelve con la temporada `Regular` (FR-003, SC-001, SC-004);
- considera los períodos BASE del año anterior que se prolongan al año consultado (BR-006);
- publica la lista completa del año como una revisión nueva, con responsable y vigencia, y conserva la anterior para auditoría (FR-008, FR-009, NFR-004);
- rechaza toda la publicación si hay solapes BASE (también entre años), excepciones repetidas, temporadas inexistentes o retiradas, o una revisión desactualizada, sin cambiar la vigente (FR-004, FR-010, SC-002, SC-006);
- rechaza rangos y fechas inválidos sin resultado parcial (FR-007);
- permite la operación solo al rol Administrador (FR-005, SC-005);
- impide que 009 retire una temporada usada por el calendario vigente.

Cubre las Historias de usuario 1 y 3 de la spec. La Historia de usuario 2 (la tarifa dinámica usa esta clasificación) depende de la feature 005, que aún no está implementada: ver *Test Case Limitations*.

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Revisar temporada del año | Specification Document | [1-functional/revisar_temporada_del_año.md](../1-functional/revisar_temporada_del_año.md) |
| Plan técnico 011 | Plan Document | [2-technical/plan.md](../2-technical/plan.md) |
| Contrato `/admin/season-calendar` | API Contract | [2-technical/contracts/ADMIN-season-calendar.md](../2-technical/contracts/ADMIN-season-calendar.md) |
| Contrato del puerto de resolución por fecha | API Contract | [2-technical/contracts/PORT-resolve-season-by-date.md](../2-technical/contracts/PORT-resolve-season-by-date.md) |
| Mapa de implementación | Implementation Map | [3-implementation/implementacion.md](../3-implementation/implementacion.md) |
| Caso de prueba de 009 (catálogo de temporadas) | Test Case | [TC-009](../../009-modificar-precio-tarifa-segun-temporada/4-testing/TC-009-modificar-precio-tarifa-segun-temporada.md) |
| Plan técnico base | Plan Document | [docs/plan-tecnico-base.md](../../../docs/plan-tecnico-base.md) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* Módulo 3 no tiene interfaz gráfica: las pruebas se hacen sobre la API REST con Swagger UI (<http://localhost:3000/docs>).
* La Historia de usuario 2 (SC-003: la tarifa dinámica usa la clasificación revisada) no se puede probar a mano todavía: requiere la tarifa dinámica (005). El puerto interno que usará la 005 se verifica con las pruebas automáticas de la Sección 3.
* La concurrencia entre administradores y los datos heredados corruptos no se pueden provocar a mano de forma confiable; se verifican con las pruebas automáticas de integración.

##### Dependencies & Assumptions
* El login propio de Módulo 3 (`POST /auth/login`) funciona; se ejercita en el paso 2 de la Sección 1.
* Los usuarios `admin` (rol Administrador) y `ota-demo` (rol OTA) existen, creados por el seed.
* El catálogo de temporadas (009) funciona: los pasos crean y retiran temporadas con `/admin/season-rules`.
* El token JWT vence a la hora: si un paso responde 401 inesperadamente, repetir el login y volver a autorizar.
* Los pasos usan los `seasonId` y `entryId` que devuelve el sistema: anótalos en la columna *Comments* cuando aparezcan.

##### Preconditions & Default Setup
* **Initial State** : calendario vacío y catálogo con solo `Regular` (ajuste `0.00`). Para dejarlo así, en una terminal en la carpeta `Hospitua-Module-3`, **en este orden** (el calendario referencia temporadas):
  1. `Get-Content features/011-revisar-temporada-del-año/4-testing/reset-calendario-temporadas.sql | docker compose exec -T postgres psql -U hospitua -d modulo3`
  2. `Get-Content features/009-modificar-precio-tarifa-segun-temporada/4-testing/reset-catalogo-temporadas.sql | docker compose exec -T postgres psql -U hospitua -d modulo3`
* **Environment** : local. Docker Desktop corriendo, `docker compose up -d`, `npx prisma migrate deploy`, `npx prisma db seed` y `npm run start:dev` (ver [README](../../../README.md)).
* **Test Accounts** :
  * Administrador: usuario `admin`, contraseña en `SEED_ADMIN_PASSWORD` del archivo `.env`.
  * OTA: usuario `ota-demo`, contraseña en `SEED_OTA_PASSWORD` del archivo `.env`.
* **Id fijo de Regular** : `00000000-0000-4000-8000-000000000001`.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

Para consultar la base de datos en los pasos que lo indican, usar en una terminal aparte (carpeta `Hospitua-Module-3`):

* **Revisiones** : `docker compose exec postgres psql -U hospitua -d modulo3 -c "SELECT year, revision, is_active, changed_by, effective_at FROM season_calendar_revision ORDER BY year, revision"`

##### Section 1: El Administrador revisa y publica el calendario (HU1 y HU3)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Abrir la documentación de la API | Abrir el navegador en `/docs` | <http://localhost:3000/docs> | La sección "Administración - Temporadas" muestra `GET /admin/season-calendar` y `PUT /admin/season-calendar/{year}` | [ ] | [ ] |
| 2 | Iniciar sesión como Administrador y autorizar | `POST /auth/login` → copiar `accessToken` → **Authorize** | `{ "username": "admin", "password": "<SEED_ADMIN_PASSWORD>" }` | **200** con `accessToken`; candado cerrado | [ ] | [ ] |
| 3 | Crear la temporada Alta (009) | `POST /admin/season-rules` | `{ "name": "Alta", "color": "#E67E22", "adjustmentPercent": "20" }` | **201**. Anotar el `seasonId` de Alta | [ ] | [ ] |
| 4 | Crear la temporada Evento especial (009) | `POST /admin/season-rules` | `{ "name": "Evento especial", "color": "#8E44AD", "adjustmentPercent": "50" }` | **201**. Anotar el `seasonId` de Evento | [ ] | [ ] |
| 5 | Revisar un año sin calendario (HU1, escenario 2) | `GET /admin/season-calendar` | `year=2026` | **200** con `revision: 0`, `effectiveAt`/`changedBy` en `null`, `entries: []`, `carriedInEntries: []`, `unclassifiedRanges: [{ "from": "2026-01-01", "to": "2026-12-31", "resolvedAs": "DEFAULT" }]` y `defaultSeason` = Regular con `"0.00"` | [ ] | [ ] |
| 6 | Publicar el primer calendario de 2026 (HU3, escenario 3) | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": null, "entries": [ { "seasonId": "<Alta>", "kind": "BASE", "startDate": "2026-06-01", "endDate": "2026-08-31" }, { "seasonId": "<Evento>", "kind": "EXCEPTION", "startDate": "2026-07-04", "endDate": "2026-07-04" }, { "seasonId": "<Alta>", "kind": "BASE", "startDate": "2026-12-20", "endDate": "2027-01-10" } ] }` | **200** con `revision: 1`, `changedBy` = id del admin, `effectiveAt` = `changedAt`. Las 3 entradas traen un `entryId` generado y su temporada con nombre, color y ajuste (`Alta #E67E22 20.00`, `Evento especial #8E44AD 50.00`). `unclassifiedRanges`: `2026-01-01..2026-05-31` y `2026-09-01..2026-12-19`; `conflicts: []`. Anotar los `entryId` de los dos BASE | [ ] | [ ] |
| 7 | Revisar una ventana del año (HU1, escenario 1) | `GET /admin/season-calendar` | `year=2026`, `from=2026-07-01`, `to=2026-07-15` | **200** con `revision: 1`, las 3 entradas propias del año y `unclassifiedRanges: []` (la ventana está cubierta por el BASE y la excepción) | [ ] | [ ] |
| 8 | Revisar el año siguiente: período heredado (BR-006) | `GET /admin/season-calendar` | `year=2027` | **200** con `revision: 0`, `entries: []` y en `carriedInEntries` el BASE de Alta `2026-12-20..2027-01-10` con `ownerYear: 2026`, `ownerRevision: 1`. `unclassifiedRanges`: `2027-01-11..2027-12-31` | [ ] | [ ] |
| 9 | Publicar cambios: alargar el verano y quitar la excepción | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": 1, "entries": [ { "entryId": "<BASE de verano>", "seasonId": "<Alta>", "kind": "BASE", "startDate": "2026-06-01", "endDate": "2026-09-15" }, { "entryId": "<BASE de diciembre>", "seasonId": "<Alta>", "kind": "BASE", "startDate": "2026-12-20", "endDate": "2027-01-10" } ] }` | **200** con `revision: 2`: solo los 2 BASE, con los **mismos** `entryId` enviados; la excepción ya no está. `unclassifiedRanges`: `2026-01-01..2026-05-31` y `2026-09-16..2026-12-19` | [ ] | [ ] |
| 10 | Consultar la revisión anterior (auditoría) | `GET /admin/season-calendar` | `year=2026`, `revision=1` | **200** con `revision: 1` y sus 3 entradas originales, incluida la excepción del 4 de julio | [ ] | [ ] |
| 11 | Verificar vigencia y responsable (FR-008, NFR-004) | Consulta **Revisiones** | N/A | 2 filas de 2026: revisión 1 con `is_active = f` y revisión 2 con `is_active = t`; las dos con el id del admin en `changed_by` y su `effective_at` | [ ] | [ ] |
| 12 | Intentar retirar una temporada usada por el calendario (009) | `DELETE /admin/season-rules/{id de Alta}` | N/A | **409** `SEASON_IN_USE` | [ ] | [ ] |
| 13 | Retirar una temporada que ya no usa la revisión vigente (009) | `DELETE /admin/season-rules/{id de Evento}` | N/A | **204**: Evento solo estaba en la revisión 1, que ya no está activa | [ ] | [ ] |

--------------------------------------------------------------------------------

##### Section 2: Rechazo de conflictos, datos inválidos y actores no autorizados
Continúa con el estado que dejó la Sección 1 (2026 en revisión 2).

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear la temporada Fiesta (009) | `POST /admin/season-rules` | `{ "name": "Fiesta", "color": "#C0392B", "adjustmentPercent": "30" }` | **201**. Anotar el `seasonId` de Fiesta | [ ] | [ ] |
| 2 | Publicar con una revisión desactualizada (otro Administrador ya publicó) | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": 1, "entries": [ { "seasonId": "<Alta>", "kind": "BASE", "startDate": "2026-06-01", "endDate": "2026-09-15" } ] }` | **409** `SEASON_CALENDAR_CONFLICT` | [ ] | [ ] |
| 3 | Dos BASE que comparten un día (HU3, escenario 4) | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": 2, "entries": [ { "seasonId": "<Alta>", "kind": "BASE", "startDate": "2026-06-01", "endDate": "2026-09-15" }, { "seasonId": "<Fiesta>", "kind": "BASE", "startDate": "2026-09-15", "endDate": "2026-09-30" } ] }` | **409** `OVERLAPPING_SEASON_CALENDAR`; el mensaje indica la fecha en conflicto | [ ] | [ ] |
| 4 | BASE de 2027 sobre el período heredado de 2026 (BR-006) | `PUT /admin/season-calendar/2027` | `{ "expectedRevision": null, "entries": [ { "seasonId": "<Fiesta>", "kind": "BASE", "startDate": "2027-01-05", "endDate": "2027-01-20" } ] }` | **409** `OVERLAPPING_SEASON_CALENDAR` | [ ] | [ ] |
| 5 | Dos excepciones el mismo día | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": 2, "entries": [ { "seasonId": "<Fiesta>", "kind": "EXCEPTION", "startDate": "2026-10-12", "endDate": "2026-10-12" }, { "seasonId": "<Alta>", "kind": "EXCEPTION", "startDate": "2026-10-12", "endDate": "2026-10-12" } ] }` | **409** `DUPLICATE_SEASON_EXCEPTION` | [ ] | [ ] |
| 6 | Temporada que no existe en el catálogo | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": 2, "entries": [ { "seasonId": "5dca644e-7a6a-4d2e-a9a5-1943188c4710", "kind": "EXCEPTION", "startDate": "2026-10-12", "endDate": "2026-10-12" } ] }` | **422** `UNKNOWN_SEASON_REFERENCE` | [ ] | [ ] |
| 7 | Temporada retirada en la Sección 1 (FR-010) | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": 2, "entries": [ { "seasonId": "<Evento>", "kind": "EXCEPTION", "startDate": "2026-10-12", "endDate": "2026-10-12" } ] }` | **422** `UNKNOWN_SEASON_REFERENCE` | [ ] | [ ] |
| 8 | BASE que pasa del año siguiente | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": 2, "entries": [ { "seasonId": "<Fiesta>", "kind": "BASE", "startDate": "2026-12-01", "endDate": "2028-01-01" } ] }` | **400** `INVALID_CALENDAR_RANGE` | [ ] | [ ] |
| 9 | Excepción de dos días | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": 2, "entries": [ { "seasonId": "<Fiesta>", "kind": "EXCEPTION", "startDate": "2026-10-12", "endDate": "2026-10-13" } ] }` | **400** `INVALID_CALENDAR_RANGE` | [ ] | [ ] |
| 10 | Entrada que empieza fuera del año | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": 2, "entries": [ { "seasonId": "<Fiesta>", "kind": "BASE", "startDate": "2025-12-30", "endDate": "2026-01-05" } ] }` | **400** `INVALID_CALENDAR_RANGE` | [ ] | [ ] |
| 11 | Fecha que no existe | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": 2, "entries": [ { "seasonId": "<Fiesta>", "kind": "BASE", "startDate": "2026-02-30", "endDate": "2026-03-05" } ] }` | **400** `INVALID_CALENDAR_RANGE` | [ ] | [ ] |
| 12 | Fin anterior al inicio | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": 2, "entries": [ { "seasonId": "<Fiesta>", "kind": "BASE", "startDate": "2026-03-10", "endDate": "2026-03-01" } ] }` | **400** `INVALID_CALENDAR_RANGE` | [ ] | [ ] |
| 13 | Enviar un dato que es de 009 en una entrada | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": 2, "entries": [ { "seasonId": "<Fiesta>", "kind": "BASE", "startDate": "2026-03-01", "endDate": "2026-03-10", "name": "Fiesta" } ] }` | **400** `INVALID_CALENDAR_RANGE` | [ ] | [ ] |
| 14 | Consultar con `from` sin `to` | `GET /admin/season-calendar` | `year=2026`, `from=2026-06-01` | **400** `INVALID_CALENDAR_RANGE` | [ ] | [ ] |
| 15 | Consultar con fin anterior al inicio | `GET /admin/season-calendar` | `year=2026`, `from=2026-08-01`, `to=2026-06-01` | **400** `INVALID_CALENDAR_RANGE` | [ ] | [ ] |
| 16 | Consultar con `asOf` y `revision` a la vez | `GET /admin/season-calendar` | `year=2026`, `asOf=2026-10-09T22:00:00Z`, `revision=1` | **400** `INVALID_CALENDAR_RANGE` | [ ] | [ ] |
| 17 | Consultar una revisión que no existe | `GET /admin/season-calendar` | `year=2026`, `revision=99` | **404** `SEASON_CALENDAR_NOT_FOUND` | [ ] | [ ] |
| 18 | Los rechazos no cambiaron nada (SC-006) | `GET /admin/season-calendar` con `year=2026`, y consulta **Revisiones** | N/A | Sigue `revision: 2`; mismas filas que en el paso 11 de la Sección 1 (sin revisiones de 2027) | [ ] | [ ] |
| 19 | Consultar sin token | **Authorize** → Logout → `GET /admin/season-calendar` | `year=2026` | **401** `UNAUTHENTICATED` | [ ] | [ ] |
| 20 | Iniciar sesión como OTA | `POST /auth/login` → **Authorize** con su token | `{ "username": "ota-demo", "password": "<SEED_OTA_PASSWORD>" }` | **200** con `accessToken` | [ ] | [ ] |
| 21 | Una OTA intenta revisar el calendario (FR-005, SC-005) | `GET /admin/season-calendar` con el token de la OTA | `year=2026` | **403** `FORBIDDEN` | [ ] | [ ] |
| 22 | Una OTA intenta publicar | `PUT /admin/season-calendar/2026` con el token de la OTA | `{ "entries": [] }` | **403** `FORBIDDEN` | [ ] | [ ] |

--------------------------------------------------------------------------------

##### Section 3: Pruebas automáticas (casos que no se pueden provocar a mano)
En una terminal en la carpeta `Hospitua-Module-3`, con Docker corriendo. Incluyen también las pruebas de 001 y 009.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Pruebas unitarias, de contrato y de integración contra PostgreSQL | `$env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"` y luego `npm test` | Base `modulo3_test` migrada | `Test Suites: 20 passed`, `Tests: 306 passed`, ninguna omitida | [ ] | [ ] |
| 2 | Pruebas de punta a punta de los endpoints | `npm run test:e2e` | N/A | `Test Suites: 3 passed`, `Tests: 81 passed` | [ ] | [ ] |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
Tomados de los casos límite de la spec.

* **EC-001** : Fechas sin clasificación propia: primero se considera un BASE del año anterior que se prolongue; si no hay ninguno, `Regular` por defecto. → Sección 1, pasos 5 y 8.
* **EC-002** : Rango inválido en la revisión (fin anterior al inicio). → Sección 2, pasos 12, 14 y 15.
* **EC-003** : Solapamiento entre temporadas: se señala sin asumir prioridad. → Sección 2, pasos 3 y 4; Sección 3, paso 1 (integración: datos heredados que se solapan aparecen como conflicto bloqueante y la resolución para 005 falla).
* **EC-004** : Misma fecha en más de una excepción. → Sección 2, paso 5.
* **EC-005** : Actor distinto al Administrador. → Sección 2, pasos 19 a 22.
* **EC-006** : Dos Administradores publican el mismo año casi al mismo tiempo: solo uno se activa. → Sección 2, paso 2; Sección 3, paso 1 (integración: 5 publicaciones simultáneas con la misma revisión y años vecinos simultáneos).
* **EC-007** : Asignar una temporada retirada. → Sección 2, paso 7; Sección 3, paso 1 (integración: publicación simultánea con el retiro en 009).
* **EC-008** : Cambio para un período que aún no está vigente: queda como revisión nueva y no afecta lo ya calculado. → Sección 1, pasos 9 y 10 (la revisión anterior se conserva); Sección 3, paso 1 (una consulta con un `asOf` anterior no ve la revisión nueva). Lo ya cotizado por la 005 se probará con esa feature.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | System crash, data corruption, or complete block of critical user journey with no workaround. |
| **Major** | **M** | Core feature broken or significant functionality loss, but an awkward workaround exists. |
| **Small / Minor** | **S** | Cosmetic issue, minor UI alignment, typo, or non-blocking defect. |
