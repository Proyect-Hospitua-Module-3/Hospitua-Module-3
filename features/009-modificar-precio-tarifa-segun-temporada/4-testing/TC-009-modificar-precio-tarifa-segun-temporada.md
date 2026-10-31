### Test Case Specification: Modificar precio tarifa según temporada
**Created** : 2026-10-31  **Spec/Plan Link** : [modificar_precio_tarifa_segun_temporada.md](../1-functional/modificar_precio_tarifa_segun_temporada.md) · [plan.md](../2-technical/plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-009-ModificarPrecioTarifaSegunTemporada
**Product Name & Version** : HOSPITUA Módulo 3 (Facturación, Consumos y Liquidación) v0.1.0
**Author** : Jordan Caro
**Current Owner** : Equipo Módulo 3
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
This test case verifies that **el Administrador puede mantener el catálogo de temporadas y el porcentaje de ajuste de cada una** (`GET`, `POST`, `PUT` y `DELETE` en `/admin/season-rules`) functions successfully under specified operational conditions, y que el sistema:

- acepta ajustes firmados entre -100 y 100, con a lo sumo 2 decimales, enviados como texto (FR-002);
- mantiene una sola regla vigente por temporada y versiona cada cambio sin solapes (FR-003);
- registra quién hizo cada cambio, cuándo y el valor anterior (FR-004, SC-001);
- rechaza valores inválidos sin cambios parciales (SC-002);
- protege a `Regular`: no se renombra ni se retira, pero su ajuste y su color sí cambian (FR-001, FR-007);
- retira temporadas de forma lógica, sin borrar su historial, y libera su nombre (FR-001);
- permite la operación solo al rol Administrador (FR-005, SC-005);
- acepta un cambio idéntico al vigente sin crear versión ni historial (casos límite de la spec).

Cubre las Historias de usuario 1 y 3 de la spec. La Historia de usuario 2 (las cotizaciones, liquidaciones y facturas ya emitidas no cambian) depende de las features 005, 007 y 006, que aún no están implementadas: ver *Test Case Limitations*.

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Modificar precio tarifa según temporada | Specification Document | [1-functional/modificar_precio_tarifa_segun_temporada.md](../1-functional/modificar_precio_tarifa_segun_temporada.md) |
| Plan técnico 009 | Plan Document | [2-technical/plan.md](../2-technical/plan.md) |
| Contrato `/admin/season-rules` | API Contract | [2-technical/contracts/ADMIN-season-rules.md](../2-technical/contracts/ADMIN-season-rules.md) |
| Contrato del puerto de reglas vigentes | API Contract | [2-technical/contracts/PORT-get-season-rules.md](../2-technical/contracts/PORT-get-season-rules.md) |
| Mapa de implementación | Implementation Map | [3-implementation/implementacion.md](../3-implementation/implementacion.md) |
| Plan técnico base | Plan Document | [docs/plan-tecnico-base.md](../../../docs/plan-tecnico-base.md) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* Módulo 3 no tiene interfaz gráfica: las pruebas se hacen sobre la API REST con Swagger UI (<http://localhost:3000/docs>).
* La Historia de usuario 2 (SC-003, SC-004: las consultas nuevas usan la regla nueva y lo ya emitido no cambia) no se puede probar a mano todavía: requiere la tarifa dinámica (005), la liquidación (007) y la factura (006). El snapshot por instante que usará la 005 se verifica con las pruebas automáticas de la Sección 3.
* El calendario anual (011) aún no existe, así que ninguna temporada está "en uso" y no se puede provocar `SEASON_IN_USE` a mano. Se verifica con las pruebas automáticas de punta a punta.
* La concurrencia entre administradores no se puede provocar a mano de forma confiable; se verifica con las pruebas automáticas de integración.

##### Dependencies & Assumptions
* El login propio de Módulo 3 (`POST /auth/login`) funciona; se ejercita en el paso 2 de la Sección 1.
* Los usuarios `admin` (rol Administrador) y `ota-demo` (rol OTA) existen, creados por el seed.
* El token JWT vence a la hora: si un paso responde 401 inesperadamente, repetir el login y volver a autorizar.
* Los pasos usan los `seasonId` que devuelve el sistema: anótalos en la columna *Comments* cuando aparezcan.

##### Preconditions & Default Setup
* **Initial State** : catálogo recién migrado, con solo la temporada `Regular` (ajuste `0.00`, versión 1). Para dejarlo así, en una terminal en la carpeta `Hospitua-Module-3`:
  `Get-Content features/009-modificar-precio-tarifa-segun-temporada/4-testing/reset-catalogo-temporadas.sql | docker compose exec -T postgres psql -U hospitua -d modulo3`
* **Environment** : local. Docker Desktop corriendo, `docker compose up -d`, `npx prisma migrate deploy`, `npx prisma db seed` y `npm run start:dev` (ver [README](../../../README.md)).
* **Test Accounts** :
  * Administrador: usuario `admin`, contraseña en `SEED_ADMIN_PASSWORD` del archivo `.env`.
  * OTA: usuario `ota-demo`, contraseña en `SEED_OTA_PASSWORD` del archivo `.env`.
* **Id fijo de Regular** : `00000000-0000-4000-8000-000000000001`.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

Para consultar la base de datos en los pasos que lo indican, usar en una terminal aparte (carpeta `Hospitua-Module-3`):

* **Historial** : `docker compose exec postgres psql -U hospitua -d modulo3 -c "SELECT s.name, h.change_type, h.previous_adjustment, h.new_adjustment, h.previous_name, h.new_name, h.changed_by, h.changed_at FROM season_rule_history h JOIN season s ON s.id = h.season_id ORDER BY h.changed_at"`
* **Versiones de ajuste** : `docker compose exec postgres psql -U hospitua -d modulo3 -c "SELECT s.name, r.adjustment_percent, r.valid_from, r.valid_to FROM season_rule r JOIN season s ON s.id = r.season_id ORDER BY s.name, r.valid_from"`

##### Section 1: El Administrador mantiene el catálogo y ajusta los precios (HU1 y HU3)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Abrir la documentación de la API | Abrir el navegador en `/docs` | <http://localhost:3000/docs> | Swagger muestra la sección "Administración - Temporadas" | [ ] | [ ] |
| 2 | Iniciar sesión como Administrador y autorizar | `POST /auth/login` → copiar `accessToken` → **Authorize** | `{ "username": "admin", "password": "<SEED_ADMIN_PASSWORD>" }` | **200** con `accessToken`; candado cerrado | [ ] | [ ] |
| 3 | Revisar el catálogo inicial (HU3) | `GET /admin/season-rules` | N/A | **200**: una sola temporada `Regular`, `adjustmentPercent: "0.00"`, `isDefault: true`, `version: 1` | [ ] | [ ] |
| 4 | Crear una temporada con incremento | `POST /admin/season-rules` | `{ "name": "Alta", "color": "#E67E22", "adjustmentPercent": "20" }` | **201** con `adjustmentPercent: "20.00"`, `isDefault: false`, `version: 1`. Anotar el `seasonId` de Alta | [ ] | [ ] |
| 5 | Crear una temporada con descuento | `POST /admin/season-rules` | `{ "name": "Baja", "color": "#3498db", "adjustmentPercent": "-15" }` | **201** con `color: "#3498DB"` (mayúsculas) y `adjustmentPercent: "-15.00"`. Anotar el `seasonId` de Baja | [ ] | [ ] |
| 6 | Revisar el catálogo con varias temporadas (HU3) | `GET /admin/season-rules` | N/A | **200** con 3 temporadas ordenadas: Alta, Baja, Regular; cada una con su color y ajuste | [ ] | [ ] |
| 7 | Cambiar el ajuste indicando la versión leída | `PUT /admin/season-rules/{id de Alta}` | `{ "adjustmentPercent": "25", "expectedVersion": 1 }` | **200** con `adjustmentPercent: "25.00"`, `version: 2` y un `validFrom` nuevo | [ ] | [ ] |
| 8 | Repetir el mismo ajuste (valor idéntico) | `PUT /admin/season-rules/{id de Alta}` | `{ "adjustmentPercent": "25.00" }` | **200** sin cambios: sigue en `version: 2` | [ ] | [ ] |
| 9 | Cambiar nombre y color sin tocar el ajuste | `PUT /admin/season-rules/{id de Alta}` | `{ "name": "Temporada alta", "color": "#D35400" }` | **200** con el nuevo nombre y color, `adjustmentPercent: "25.00"`, `version: 3` | [ ] | [ ] |
| 10 | Cambiar el ajuste de Regular | `PUT /admin/season-rules/00000000-0000-4000-8000-000000000001` | `{ "adjustmentPercent": "-2.50" }` | **200** con `adjustmentPercent: "-2.50"` y `isDefault: true` | [ ] | [ ] |
| 11 | Cambiar el color de Regular | `PUT /admin/season-rules/00000000-0000-4000-8000-000000000001` | `{ "color": "#7F8C8D" }` | **200** con `color: "#7F8C8D"` y `name: "Regular"` | [ ] | [ ] |
| 12 | Retirar una temporada | `DELETE /admin/season-rules/{id de Baja}` | N/A | **204** sin contenido | [ ] | [ ] |
| 13 | Comprobar que la temporada retirada ya no aparece | `GET /admin/season-rules` | N/A | **200** con 2 temporadas: "Temporada alta" y Regular | [ ] | [ ] |
| 14 | Reutilizar el nombre de la temporada retirada | `POST /admin/season-rules` | `{ "name": "Baja", "color": "#2980B9", "adjustmentPercent": "-10" }` | **201** con un `seasonId` **distinto** al del paso 5 | [ ] | [ ] |
| 15 | Verificar el historial (FR-004, SC-001) | Consulta **Historial** | N/A | Entradas `CREATE`, `UPDATE` y `RETIRE` con valor anterior y nuevo, el id del admin en `changed_by` y la hora en `changed_at`. Los pasos 8 y 3 no dejaron entradas | [ ] | [ ] |
| 16 | Verificar las versiones de ajuste (FR-003) | Consulta **Versiones de ajuste** | N/A | "Temporada alta" tiene 2 versiones: `20.00` cerrada y `25.00` vigente (`valid_to` vacío); el `valid_to` de la primera es igual al `valid_from` de la segunda. La Baja retirada conserva su versión, cerrada | [ ] | [ ] |

--------------------------------------------------------------------------------

##### Section 2: Rechazo de valores inválidos, conflictos y actores no autorizados
Continúa con el estado que dejó la Sección 1.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Ajuste mayor a 100 | `POST /admin/season-rules` | `{ "name": "Festival", "color": "#C0392B", "adjustmentPercent": "100.01" }` | **400** `INVALID_SEASON_ADJUSTMENT` | [ ] | [ ] |
| 2 | Ajuste menor a -100 | `POST /admin/season-rules` | `{ "name": "Festival", "color": "#C0392B", "adjustmentPercent": "-100.01" }` | **400** `INVALID_SEASON_ADJUSTMENT` | [ ] | [ ] |
| 3 | Ajuste con más de 2 decimales | `POST /admin/season-rules` | `{ "name": "Festival", "color": "#C0392B", "adjustmentPercent": "12.345" }` | **400** `INVALID_SEASON_ADJUSTMENT` | [ ] | [ ] |
| 4 | Ajuste como número en lugar de texto | `POST /admin/season-rules` | `{ "name": "Festival", "color": "#C0392B", "adjustmentPercent": 20 }` (sin comillas) | **400** `INVALID_SEASON_ADJUSTMENT` | [ ] | [ ] |
| 5 | Color inválido | `POST /admin/season-rules` | `{ "name": "Festival", "color": "rojo", "adjustmentPercent": "20" }` | **400** `INVALID_SEASON` | [ ] | [ ] |
| 6 | Nombre vacío | `POST /admin/season-rules` | `{ "name": "   ", "color": "#C0392B", "adjustmentPercent": "20" }` | **400** `INVALID_SEASON` | [ ] | [ ] |
| 7 | Enviar un campo que genera el servidor | `POST /admin/season-rules` | `{ "name": "Festival", "color": "#C0392B", "adjustmentPercent": "20", "isDefault": true }` | **400** `INVALID_SEASON` | [ ] | [ ] |
| 8 | Nombre repetido con otras mayúsculas | `POST /admin/season-rules` | `{ "name": "temporada ALTA", "color": "#C0392B", "adjustmentPercent": "20" }` | **409** `SEASON_NAME_CONFLICT` | [ ] | [ ] |
| 9 | Intentar crear otra "Regular" | `POST /admin/season-rules` | `{ "name": "regular", "color": "#C0392B", "adjustmentPercent": "20" }` | **409** `SEASON_NAME_CONFLICT` | [ ] | [ ] |
| 10 | Cambio con una versión desactualizada (otro Administrador ya la cambió) | `PUT /admin/season-rules/{id de Alta}` | `{ "adjustmentPercent": "30", "expectedVersion": 1 }` | **409** `SEASON_RULE_CONFLICT`; el ajuste sigue en `25.00` | [ ] | [ ] |
| 11 | Renombrar Regular | `PUT /admin/season-rules/00000000-0000-4000-8000-000000000001` | `{ "name": "Normal" }` | **409** `DEFAULT_SEASON_IMMUTABLE` | [ ] | [ ] |
| 12 | Retirar Regular | `DELETE /admin/season-rules/00000000-0000-4000-8000-000000000001` | N/A | **409** `DEFAULT_SEASON_IMMUTABLE` | [ ] | [ ] |
| 13 | Cuerpo sin campos para cambiar | `PUT /admin/season-rules/{id de Alta}` | `{}` | **400** `INVALID_SEASON` | [ ] | [ ] |
| 14 | Temporada inexistente | `PUT /admin/season-rules/5dca644e-7a6a-4d2e-a9a5-1943188c4710` | `{ "adjustmentPercent": "5" }` | **404** `SEASON_NOT_FOUND` | [ ] | [ ] |
| 15 | Modificar la temporada retirada en la Sección 1 | `PUT /admin/season-rules/{id de Baja del paso 5}` | `{ "adjustmentPercent": "5" }` | **404** `SEASON_NOT_FOUND` | [ ] | [ ] |
| 16 | Los rechazos no cambiaron nada (SC-002) | Consultas **Historial** y **Versiones de ajuste** | N/A | Mismas filas que al final de la Sección 1 | [ ] | [ ] |
| 17 | Consultar sin token | **Authorize** → Logout → `GET /admin/season-rules` | N/A | **401** `UNAUTHENTICATED` | [ ] | [ ] |
| 18 | Iniciar sesión como OTA | `POST /auth/login` → **Authorize** con su token | `{ "username": "ota-demo", "password": "<SEED_OTA_PASSWORD>" }` | **200** con `accessToken` | [ ] | [ ] |
| 19 | Una OTA intenta consultar el catálogo (FR-005, SC-005) | `GET /admin/season-rules` con el token de la OTA | N/A | **403** `FORBIDDEN` | [ ] | [ ] |
| 20 | Una OTA intenta cambiar un ajuste | `PUT /admin/season-rules/00000000-0000-4000-8000-000000000001` con el token de la OTA | `{ "adjustmentPercent": "50" }` | **403** `FORBIDDEN` | [ ] | [ ] |

--------------------------------------------------------------------------------

##### Section 3: Pruebas automáticas (casos que no se pueden provocar a mano)
En una terminal en la carpeta `Hospitua-Module-3`, con Docker corriendo. Incluyen también las pruebas de la 001.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Pruebas unitarias, de contrato y de integración contra PostgreSQL | `$env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"` y luego `npm test` | Base `modulo3_test` migrada | `Test Suites: 12 passed`, `Tests: 134 passed`, ninguna omitida | [ ] | [ ] |
| 2 | Pruebas de punta a punta de los endpoints | `npm run test:e2e` | N/A | `Tests: 41 passed` | [ ] | [ ] |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
Tomados de los casos límite de la spec.

* **EC-001** : Ajuste negativo o fuera de rango. Los negativos son válidos (descuento); fuera de -100..100 se rechaza sin cambiar la regla. → Sección 1, paso 5; Sección 2, pasos 1 a 4.
* **EC-002** : Dos Administradores modifican casi al mismo tiempo (NFR-002). Queda una sola versión vigente, sin solapes; con la misma `expectedVersion`, solo uno gana. → Sección 2, paso 10; Sección 3, paso 1 (integración: 8 cambios simultáneos y 3 con la misma versión).
* **EC-003** : Cambio a un valor idéntico al vigente. Se acepta sin versión ni historial nuevos. → Sección 1, pasos 8 y 15.
* **EC-004** : Fechas sin temporada explícita. Se aplica `Regular`, la única temporada por defecto. → Sección 1, paso 3; Sección 3, paso 1 (contrato: `defaultSeasonId`). El uso en el cálculo de tarifas se probará con la 005.
* **EC-005** : Actor distinto al Administrador. → Sección 2, pasos 17 a 20.
* **EC-006** : Cambio de regla durante una consulta en curso. La consulta usa la versión vigente en su instante, sin mezclas. → Sección 3, paso 1 (integración y unitarias de `findEffectiveAt`).
* **EC-007** : Retirar una temporada asignada en el calendario vigente → `409 SEASON_IN_USE`. → Sección 3, paso 2 (e2e). A mano solo será posible cuando exista la 011.
* **EC-008** : Límites exactos del rango (-100 y 100). → Sección 3, paso 1 (unitarias del value object).

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | System crash, data corruption, or complete block of critical user journey with no workaround. |
| **Major** | **M** | Core feature broken or significant functionality loss, but an awkward workaround exists. |
| **Small / Minor** | **S** | Cosmetic issue, minor UI alignment, typo, or non-blocking defect. |
