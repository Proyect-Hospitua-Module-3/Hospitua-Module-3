### Test Case Specification: Consultar tarifa dinámica
**Created** : 2026-11-04  **Spec/Plan Link** : [consultar_tarifa_dinamica.md](../1-functional/consultar_tarifa_dinamica.md) · [plan.md](../2-technical/plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-005-ConsultarTarifaDinamica
**Product Name & Version** : HOSPITUA Módulo 3 (Facturación, Consumos y Liquidación) v0.1.0
**Author** : Jorge Jaraba
**Current Owner** : Equipo Módulo 3
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
This test case verifies that **Módulo 2 puede consultar la tarifa dinámica de una habitación y guardar la cotización del hospedaje** (`GET /pricing/dynamic-rate` y `POST /pricing/quotes`) functions successfully under specified operational conditions, y que el sistema:

- ajusta la tarifa base de Módulo 1 con el porcentaje configurado para la temporada de cada noche, sin importar el nombre de la temporada (FR-002, BR-007, SC-001);
- usa la temporada por defecto con su porcentaje vigente cuando una fecha no tiene clasificación (FR-004);
- valora cada noche de una estancia con su propia temporada y suma el total exacto (FR-003, BR-003, SC-002);
- rechaza rangos inválidos y parámetros mal formados sin resultado parcial (FR-008, SC-004);
- falla de forma explícita, sin resultado parcial, si Módulo 1 no reporta una tarifa base válida o no responde (FR-006, NFR-003, SC-003);
- guarda la cotización con la tarifa base de cada noche, y esa cotización no cambia aunque después cambien las reglas de temporada (FR-012, FR-013, SC-007);
- rechaza sin guardar nada las cotizaciones inválidas, sin tarifa base o pedidas por un actor distinto a Módulo 2 (FR-015, FR-016, SC-008);
- restringe la consulta a Módulo 2 por ahora (FR-010; la OTA llega con la Historia de usuario 4).

Cubre las Historias de usuario 1, 2 y 3 de la spec. La Historia de usuario 4 (la OTA consulta la tarifa de sus reservas) depende de la feature 007: ver *Test Case Limitations*.

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Consultar tarifa dinámica | Specification Document | [1-functional/consultar_tarifa_dinamica.md](../1-functional/consultar_tarifa_dinamica.md) |
| Plan técnico 005 | Plan Document | [2-technical/plan.md](../2-technical/plan.md) |
| Contrato `GET /pricing/dynamic-rate` | API Contract | [2-technical/contracts/GET-pricing-dynamic-rate.md](../2-technical/contracts/GET-pricing-dynamic-rate.md) |
| Contrato `POST /pricing/quotes` | API Contract | [2-technical/contracts/POST-pricing-quotes.md](../2-technical/contracts/POST-pricing-quotes.md) |
| Contrato del puerto `findByIds` (lo usa 007) | API Contract | [2-technical/contracts/PORT-find-lodging-quotes-by-ids.md](../2-technical/contracts/PORT-find-lodging-quotes-by-ids.md) |
| Mapa de implementación | Implementation Map | [3-implementation/implementacion.md](../3-implementation/implementacion.md) |
| Caso de prueba de 009 (catálogo de temporadas) | Test Case | [TC-009](../../009-modificar-precio-tarifa-segun-temporada/4-testing/TC-009-modificar-precio-tarifa-segun-temporada.md) |
| Caso de prueba de 011 (calendario de temporadas) | Test Case | [TC-011](../../011-revisar-temporada-del-año/4-testing/TC-011-revisar-temporada-del-año.md) |
| Plan técnico base | Plan Document | [docs/plan-tecnico-base.md](../../../docs/plan-tecnico-base.md) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* Módulo 3 no tiene interfaz gráfica: las pruebas se hacen sobre la API REST con Swagger UI (<http://localhost:3000/docs>).
* Módulo 1 todavía no existe: se reemplaza con el servidor [modulo1-simulado.js](./modulo1-simulado.js), que responde como su contrato (tarifa base 300 000 COP para cualquier habitación, salvo dos habitaciones especiales para los errores).
* La Historia de usuario 4 (la OTA consulta la tarifa de sus reservas, SC-005 para la OTA) no se puede probar todavía: necesita el cliente de Módulo 2 de la feature 007. Mientras tanto, una OTA recibe `403` (Sección 2, paso 16).
* La falla a mitad de la inserción de una cotización, el límite de noches en paralelo y el cambio de reglas en medio de una consulta no se pueden provocar a mano de forma confiable; se verifican con las pruebas automáticas de la Sección 3.

##### Dependencies & Assumptions
* El login propio de Módulo 3 (`POST /auth/login`) funciona.
* Los usuarios `admin` (rol Administrador) y `ota-demo` (rol OTA) existen, creados por el seed.
* El catálogo de temporadas (009) y el calendario (011) funcionan: los pasos crean temporadas con `/admin/season-rules` y las asignan con `/admin/season-calendar`.
* Módulo 2 llama **sin token**: en Swagger se hace con **Authorize → Logout** antes de los pasos de Módulo 2.
* El token JWT vence a la hora: si un paso del Administrador responde 401 inesperadamente, repetir el login y volver a autorizar.
* Los pasos usan los `seasonId`, `version` y `quoteId` que devuelve el sistema: anótalos en la columna *Comments* cuando aparezcan.

##### Preconditions & Default Setup
* **Initial State** : sin cotizaciones, calendario vacío y catálogo con solo `Regular` (ajuste `0.00`). Para dejarlo así, en una terminal en la carpeta `Hospitua-Module-3`, **en este orden** (el calendario referencia temporadas):
  1. `Get-Content features/005-consultar-tarifa-dinamica/4-testing/reset-cotizaciones.sql | docker compose exec -T postgres psql -U hospitua -d modulo3`
  2. `Get-Content features/011-revisar-temporada-del-año/4-testing/reset-calendario-temporadas.sql | docker compose exec -T postgres psql -U hospitua -d modulo3`
  3. `Get-Content features/009-modificar-precio-tarifa-segun-temporada/4-testing/reset-catalogo-temporadas.sql | docker compose exec -T postgres psql -U hospitua -d modulo3`
* **Environment** : local. Docker Desktop corriendo, `docker compose up -d`, `npx prisma migrate deploy`, `npx prisma db seed` y `npm run start:dev` (ver [README](../../../README.md)), con `MODULE1_BASE_URL=http://localhost:8080` en el `.env`. En otra terminal, el Módulo 1 simulado: `node features/005-consultar-tarifa-dinamica/4-testing/modulo1-simulado.js`.
* **Test Accounts** :
  * Administrador: usuario `admin`, contraseña en `SEED_ADMIN_PASSWORD` del archivo `.env`.
  * OTA: usuario `ota-demo`, contraseña en `SEED_OTA_PASSWORD` del archivo `.env`.
* **Habitaciones del Módulo 1 simulado** :
  * Normal (tarifa base 300 000): `3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b`
  * No existe en Módulo 1: `99999999-0000-4000-8000-000000000000`
  * Tarifa base en cero: `88888888-0000-4000-8000-000000000000`

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

**Última ejecución** : 2026-11-04, todos los pasos ✔. Contra la app compilada (`node dist/main`), una base temporal migrada desde cero con el seed y el Módulo 1 simulado de esta carpeta; los pasos de Swagger se ejecutaron llamando a los mismos endpoints con los mismos datos, y las consultas a la base con `psql`.

Para consultar la base de datos en los pasos que lo indican, usar en una terminal aparte (carpeta `Hospitua-Module-3`):

* **Cotizaciones** : `docker compose exec postgres psql -U hospitua -d modulo3 -c "SELECT id, room_id, check_in_date, check_out_date, currency, lodging_amount FROM lodging_quote ORDER BY created_at"`
* **Noches** : `docker compose exec postgres psql -U hospitua -d modulo3 -c "SELECT quote_id, night_date, base_rate, season_name, adjustment_percent, rate FROM lodging_quote_night ORDER BY quote_id, night_date"`

En las tablas, `<habitación>` es la habitación normal `3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b`.

##### Section 1: Módulo 2 consulta la tarifa y cotiza el hospedaje (HU1, HU2 y HU3)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Abrir la documentación de la API | Abrir el navegador en `/docs` | <http://localhost:3000/docs> | La sección "Tarifa dinámica (Módulo 2)" muestra `GET /pricing/dynamic-rate` y `POST /pricing/quotes` | [✔] | — |
| 2 | Iniciar sesión como Administrador y autorizar | `POST /auth/login` → copiar `accessToken` → **Authorize** | `{ "username": "admin", "password": "<SEED_ADMIN_PASSWORD>" }` | **200** con `accessToken`; candado cerrado | [✔] | — |
| 3 | Crear la temporada Alta (009) | `POST /admin/season-rules` | `{ "name": "Alta", "color": "#E53935", "adjustmentPercent": "20" }` | **201**. Anotar el `seasonId` y la `version` de Alta | [✔] | — |
| 4 | Crear la temporada Baja (009) | `POST /admin/season-rules` | `{ "name": "Baja", "color": "#1E88E5", "adjustmentPercent": "-10" }` | **201**. Anotar el `seasonId` de Baja | [✔] | — |
| 5 | Clasificar diciembre de 2026 (011) | `PUT /admin/season-calendar/2026` | `{ "expectedRevision": null, "entries": [ { "seasonId": "<Baja>", "kind": "BASE", "startDate": "2026-12-20", "endDate": "2026-12-21" }, { "seasonId": "<Alta>", "kind": "BASE", "startDate": "2026-12-24", "endDate": "2026-12-25" } ] }` | **200** con `revision: 1` | [✔] | — |
| 6 | Pasar a llamadas de Módulo 2 (sin token) | **Authorize** → **Logout** | N/A | Candado abierto | [✔] | — |
| 7 | Una noche en temporada alta (HU1, escenario 1) | `GET /pricing/dynamic-rate` | `roomId=<habitación>`, `date=2026-12-24` | **200**: `currency: "COP"`, una noche `{ "date": "2026-12-24", "baseRate": "300000.00", "seasonName": "Alta", "seasonAdjustmentPercent": "20.00", "dynamicRate": "360000.00" }` y `total: "360000.00"` | [✔] | — |
| 8 | Una noche sin temporada explícita (HU1, escenario 2) | `GET /pricing/dynamic-rate` | `roomId=<habitación>`, `date=2026-07-15` | **200**: la noche usa `Regular` con `"0.00"` → `dynamicRate: "300000.00"` | [✔] | — |
| 9 | Estancia que cruza tres temporadas (HU2, escenario 1) | `GET /pricing/dynamic-rate` | `roomId=<habitación>`, `checkInDate=2026-12-20`, `checkOutDate=2026-12-26` | **200** con 6 noches en orden: 20 y 21 `Baja -10.00 → 270000.00`; 22 y 23 `Regular 0.00 → 300000.00`; 24 y 25 `Alta 20.00 → 360000.00`. `total: "1860000.00"` (suma manual: 2×270 000 + 2×300 000 + 2×360 000). La noche del 26 (salida) no aparece | [✔] | — |
| 10 | Una noche pedida como rango (caso límite) | `GET /pricing/dynamic-rate` | `roomId=<habitación>`, `checkInDate=2026-12-31`, `checkOutDate=2027-01-01` | **200** con exactamente una noche, `2026-12-31`, igual que pedirla con `date=2026-12-31` | [✔] | — |
| 11 | Repetir la consulta del paso 9 (NFR-001, SC-006) | `GET /pricing/dynamic-rate` | Los mismos datos del paso 9 | **200** con exactamente el mismo resultado del paso 9 | [✔] | — |
| 12 | Cotizar el hospedaje (HU3, escenario 1) | `POST /pricing/quotes` | `{ "roomId": "<habitación>", "checkInDate": "2026-12-23", "checkOutDate": "2026-12-26" }` | **200** con `quoteId` (UUID), `currency: "COP"`, `nightlyRates` `[ 23: "300000.00", 24: "360000.00", 25: "360000.00" ]` y `lodgingAmount: "1020000.00"`. Anotar el `quoteId` | [✔] | — |
| 13 | Verificar lo guardado (FR-012, NFR-004) | Consultas **Cotizaciones** y **Noches** | N/A | 1 cotización con el `quoteId` del paso 12, `2026-12-23` → `2026-12-26`, `COP`, `1020000.00`; 3 noches con `base_rate` `300000.00`, temporada, ajuste y tarifa de cada noche (`Regular 0.00 300000.00`, `Alta 20.00 360000.00` ×2) | [✔] | — |
| 14 | El Administrador sube Alta a +50 % | Login como `admin` → **Authorize** → `PUT /admin/season-rules/{id de Alta}` | `{ "adjustmentPercent": "50", "expectedVersion": <version de Alta> }` | **200** con `adjustmentPercent: "50.00"` | [✔] | — |
| 15 | La consulta refleja la regla vigente (FR-007, caso límite) | **Authorize** → **Logout** → `GET /pricing/dynamic-rate` | `roomId=<habitación>`, `checkInDate=2026-12-23`, `checkOutDate=2026-12-26` | **200**: 24 y 25 ahora `Alta 50.00 → 450000.00`; `total: "1200000.00"` | [✔] | — |
| 16 | La cotización guardada no cambió (FR-013, SC-007) | Consultas **Cotizaciones** y **Noches** | N/A | Igual que en el paso 13: `1020000.00` y las noches de Alta con `20.00` y `360000.00` | [✔] | — |
| 17 | Cotizar otra vez la misma estancia | `POST /pricing/quotes` | Los mismos datos del paso 12 | **200** con un `quoteId` **distinto** y `lodgingAmount: "1200000.00"` (regla vigente). La consulta **Cotizaciones** muestra 2 cotizaciones | [✔] | — |

--------------------------------------------------------------------------------

##### Section 2: Rechazos, Módulo 1 sin tarifa y actores no autorizados
Continúa con el estado que dejó la Sección 1 (2 cotizaciones guardadas), sin token salvo donde se indica.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Salida igual a la entrada (HU2, escenario 2) | `GET /pricing/dynamic-rate` | `roomId=<habitación>`, `checkInDate=2026-12-24`, `checkOutDate=2026-12-24` | **400** `INVALID_DATE_RANGE`, sin `nights` | [✔] | — |
| 2 | Salida anterior a la entrada | `GET /pricing/dynamic-rate` | `roomId=<habitación>`, `checkInDate=2026-12-26`, `checkOutDate=2026-12-23` | **400** `INVALID_DATE_RANGE` | [✔] | — |
| 3 | `date` junto con el rango | `GET /pricing/dynamic-rate` | `roomId=<habitación>`, `date=2026-12-24`, `checkInDate=2026-12-24`, `checkOutDate=2026-12-25` | **400** `INVALID_QUERY_PARAMS` | [✔] | — |
| 4 | Fecha que no existe | `GET /pricing/dynamic-rate` | `roomId=<habitación>`, `date=2026-02-30` | **400** `INVALID_QUERY_PARAMS` | [✔] | — |
| 5 | `roomId` que no es un UUID | `GET /pricing/dynamic-rate` | `roomId=101`, `date=2026-12-24` | **400** `INVALID_QUERY_PARAMS` | [✔] | — |
| 6 | Habitación que Módulo 1 no conoce (FR-006) | `GET /pricing/dynamic-rate` | `roomId=99999999-0000-4000-8000-000000000000`, `date=2026-12-24` | **404** `ROOM_NOT_FOUND` | [✔] | — |
| 7 | Módulo 1 reporta tarifa base en cero (FR-006, SC-003) | `GET /pricing/dynamic-rate` | `roomId=88888888-0000-4000-8000-000000000000`, `checkInDate=2026-12-23`, `checkOutDate=2026-12-26` | **424** `INVALID_BASE_RATE`, sin `nights` ni total | [✔] | — |
| 8 | Módulo 1 no responde (NFR-003) | Detener el Módulo 1 simulado (`Ctrl+C`) → `GET /pricing/dynamic-rate` → volver a iniciar el Módulo 1 simulado | `roomId=<habitación>`, `date=2026-12-24` | **424** `MODULE1_UNAVAILABLE`, sin resultado | [✔] | — |
| 9 | Cotizar con un rango inválido (FR-015) | `POST /pricing/quotes` | `{ "roomId": "<habitación>", "checkInDate": "2026-12-26", "checkOutDate": "2026-12-26" }` | **400** `INVALID_DATE_RANGE` | [✔] | — |
| 10 | Cotizar sin un campo | `POST /pricing/quotes` | `{ "roomId": "<habitación>", "checkInDate": "2026-12-23" }` | **400** `INVALID_QUERY_PARAMS` | [✔] | — |
| 11 | Cotizar una habitación que Módulo 1 no conoce | `POST /pricing/quotes` | `{ "roomId": "99999999-0000-4000-8000-000000000000", "checkInDate": "2026-12-23", "checkOutDate": "2026-12-26" }` | **404** `ROOM_NOT_FOUND` | [✔] | — |
| 12 | Cotizar con tarifa base en cero | `POST /pricing/quotes` | `{ "roomId": "88888888-0000-4000-8000-000000000000", "checkInDate": "2026-12-23", "checkOutDate": "2026-12-26" }` | **424** `INVALID_BASE_RATE` | [✔] | — |
| 13 | Iniciar sesión como Administrador y autorizar | `POST /auth/login` → **Authorize** | `{ "username": "admin", "password": "<SEED_ADMIN_PASSWORD>" }` | **200** con `accessToken` | [✔] | — |
| 14 | El Administrador consulta la tarifa (FR-010) | `GET /pricing/dynamic-rate` con el token | `roomId=<habitación>`, `date=2026-12-24` | **403** `FORBIDDEN` | [✔] | — |
| 15 | El Administrador intenta cotizar (FR-016, BR-008) | `POST /pricing/quotes` con el token | Los datos del paso 12 de la Sección 1 | **403** `FORBIDDEN` | [✔] | — |
| 16 | La OTA consulta la tarifa (hasta la HU4) | Login como `ota-demo` → **Authorize** → `GET /pricing/dynamic-rate` | `roomId=<habitación>`, `date=2026-12-24` | **403** `FORBIDDEN` | [✔] | — |
| 17 | La OTA intenta cotizar (FR-016, BR-008) | `POST /pricing/quotes` con el token de la OTA | Los datos del paso 12 de la Sección 1 | **403** `FORBIDDEN` | [✔] | — |
| 18 | Token inválido | **Authorize** → Logout → **Authorize** con `abc` → `GET /pricing/dynamic-rate` | `roomId=<habitación>`, `date=2026-12-24` | **401** `UNAUTHENTICATED` | [✔] | — |
| 19 | Los rechazos no guardaron nada (SC-008) | Consulta **Cotizaciones** | N/A | Siguen exactamente las 2 cotizaciones de la Sección 1 | [✔] | — |

--------------------------------------------------------------------------------

##### Section 3: Pruebas automáticas (casos que no se pueden provocar a mano)
En una terminal en la carpeta `Hospitua-Module-3`, con Docker corriendo. Incluyen también las pruebas de 001, 004, 009 y 011.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Pruebas unitarias, de contrato y de integración contra PostgreSQL | `$env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"` y luego `npm test` | Base `modulo3_test` migrada (`npx prisma migrate deploy` con `DATABASE_URL` apuntando a ella) | `Test Suites: 31 passed`, `Tests: 475 passed`, ninguna omitida | [✔] | — |
| 2 | Pruebas de punta a punta de los endpoints | `npm run test:e2e` | N/A | `Test Suites: 5 passed`, `Tests: 123 passed` | [✔] | — |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
Tomados de los casos límite de la spec.

* **EC-001** : La habitación no tiene tarifa base en Módulo 1: se rechaza, nunca se calcula sobre cero o un valor supuesto. → Sección 2, pasos 6, 7, 11 y 12.
* **EC-002** : Módulo 1 no responde: la consulta falla de forma explícita, sin resultado parcial. → Sección 2, paso 8; la falla de una sola noche dentro de un rango, en las pruebas automáticas (Sección 3).
* **EC-003** : La regla de temporada cambia después de una consulta: la consulta nueva refleja la regla vigente y la cotización guardada no cambia. → Sección 1, pasos 14 a 16.
* **EC-004** : Consulta repetida sin cambios de configuración: mismo resultado. → Sección 1, paso 11.
* **EC-005** : Rango de una sola noche: salida = entrada + 1 día devuelve esa noche; salida = entrada se rechaza. → Sección 1, paso 10; Sección 2, paso 1.
* **EC-006** : Cotización pedida por un actor distinto a Módulo 2: se rechaza. → Sección 2, pasos 15 y 17.
* **EC-007** : La OTA consulta una habitación que no es de sus reservas, o Módulo 2 no responde al verificarla: pendiente de la Historia de usuario 4 (007). Hoy toda OTA recibe `403`. → Sección 2, paso 16.
* **EC-008** : Una falla a mitad de guardar la cotización no deja una cotización parcial. → pruebas automáticas de integración (Sección 3).

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | System crash, data corruption, or complete block of critical user journey with no workaround. |
| **Major** | **M** | Core feature broken or significant functionality loss, but an awkward workaround exists. |
| **Small / Minor** | **S** | Cosmetic issue, minor UI alignment, typo, or non-blocking defect. |
