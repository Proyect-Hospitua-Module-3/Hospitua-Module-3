### Test Case Specification: Actualizar porcentaje de IVA
**Created** : 2026-10-30  **Spec/Plan Link** : [actualizar_porcentaje_iva.md](../1-functional/actualizar_porcentaje_iva.md) · [plan.md](../2-technical/plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-001-ActualizarPorcentajeIVA
**Product Name & Version** : HOSPITUA Módulo 3 (Facturación, Consumos y Liquidación) v0.1.0
**Author** : Jordan Caro
**Current Owner** : Equipo Módulo 3
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
This test case verifies that **el Administrador puede registrar y actualizar el porcentaje de IVA vigente** (`PUT /admin/vat-rate`) functions successfully under specified operational conditions, y que el sistema:

- acepta solo valores entre 0 y 100 con a lo sumo 2 decimales, enviados como texto (FR-002, NFR-004);
- rechaza cualquier valor inválido sin modificar el porcentaje vigente (SC-003);
- permite la operación solo al rol Administrador (FR-006, SC-005);
- registra quién hizo cada cambio y cuándo (FR-005, SC-004);
- acepta un valor idéntico al vigente y también lo traza (casos límite de la spec).

Cubre la Historia de usuario 1 de la spec. La Historia de usuario 2 (las facturas emitidas no cambian) depende de la feature 006, que aún no está implementada: ver *Test Case Limitations*.

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Actualizar porcentaje de IVA | Specification Document | [1-functional/actualizar_porcentaje_iva.md](../1-functional/actualizar_porcentaje_iva.md) |
| Plan técnico 001 | Plan Document | [2-technical/plan.md](../2-technical/plan.md) |
| Contrato `PUT /admin/vat-rate` | API Contract | [2-technical/contracts/PUT-admin-vat-rate.md](../2-technical/contracts/PUT-admin-vat-rate.md) |
| Mapa de implementación | Implementation Map | [3-implementation/implementacion.md](../3-implementation/implementacion.md) |
| Plan técnico base | Plan Document | [docs/plan-tecnico-base.md](../../../docs/plan-tecnico-base.md) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* Módulo 3 no tiene interfaz gráfica: las pruebas se hacen sobre la API REST con Swagger UI (<http://localhost:3000/docs>).
* No existe un endpoint para consultar el porcentaje vigente (lo lee la feature 006 por un puerto interno). Para comprobar el vigente y el historial se consulta la base de datos con `psql` dentro del contenedor de Docker.
* La Historia de usuario 2 de la spec (SC-001, SC-002: las facturas ya emitidas no cambian y las nuevas usan el nuevo porcentaje) no se puede probar todavía: requiere la feature 006 Generar factura final.
* La concurrencia entre administradores y el rollback cuando falla el historial no se pueden provocar a mano de forma confiable; se verifican con las pruebas automáticas de la Sección 3.

##### Dependencies & Assumptions
* El login propio de Módulo 3 (`POST /auth/login`) funciona; se ejercita en el paso 2 de la Sección 1.
* Los usuarios `admin` (rol Administrador) y `ota-demo` (rol OTA) existen, creados por el seed.
* El token JWT vence a la hora: si un paso responde 401 inesperadamente, repetir el login y volver a autorizar.

##### Preconditions & Default Setup
* **Initial State** : sin ningún porcentaje de IVA registrado. Para dejar la base en ese estado, en una terminal en la carpeta `Hospitua-Module-3`:
  `docker compose exec postgres psql -U hospitua -d modulo3 -c "DELETE FROM vat_rate_history" -c "DELETE FROM vat_rate"`
* **Environment** : local. Docker Desktop corriendo, `docker compose up -d`, `npx prisma migrate deploy`, `npx prisma db seed` y `npm run start:dev` (ver [README](../../../README.md)).
* **Test Accounts** :
  * Administrador: usuario `admin`, contraseña en `SEED_ADMIN_PASSWORD` del archivo `.env`.
  * OTA: usuario `ota-demo`, contraseña en `SEED_OTA_PASSWORD` del archivo `.env`.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

Para consultar la base de datos en los pasos que lo indican, usar en una terminal aparte (carpeta `Hospitua-Module-3`):

* **Vigente** : `docker compose exec postgres psql -U hospitua -d modulo3 -c "SELECT value, updated_by, updated_at FROM vat_rate"`
* **Historial** : `docker compose exec postgres psql -U hospitua -d modulo3 -c "SELECT value_before, value_after, changed_by, changed_at FROM vat_rate_history ORDER BY changed_at"`

##### Section 1: El Administrador registra y actualiza el porcentaje de IVA (HU1, escenario 1)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Abrir la documentación de la API | Abrir el navegador en `/docs` | <http://localhost:3000/docs> | Swagger muestra las secciones "Autenticación" y "Administración - IVA" | [ ] | [ ] |
| 2 | Iniciar sesión como Administrador | `POST /auth/login` → Try it out → Execute | `{ "username": "admin", "password": "<SEED_ADMIN_PASSWORD>" }` | **200** con `accessToken` y `expiresIn: 3600` | [ ] | [ ] |
| 3 | Autorizar las peticiones con el token | Botón **Authorize** → pegar el `accessToken` sin comillas → Authorize → Close | Token del paso 2 | El candado aparece cerrado | [ ] | [ ] |
| 4 | Registrar el primer porcentaje de IVA | `PUT /admin/vat-rate` → Try it out → Execute | `{ "value": "19.00" }` | **200** con `value: "19.00"`, `updatedBy` (id del admin) y `updatedAt` (fecha y hora). El bloque Curl incluye `Authorization: Bearer ...` | [ ] | [ ] |
| 5 | Actualizar a otro valor válido | `PUT /admin/vat-rate` → Execute | `{ "value": "5" }` | **200** con `value: "5.00"` (siempre con 2 decimales) | [ ] | [ ] |
| 6 | Actualizar a un valor idéntico al vigente | `PUT /admin/vat-rate` → Execute | `{ "value": "5.00" }` | **200** con `value: "5.00"`: se acepta como operación válida | [ ] | [ ] |
| 7 | Probar el límite inferior | `PUT /admin/vat-rate` → Execute | `{ "value": "0" }` | **200** con `value: "0.00"` | [ ] | [ ] |
| 8 | Probar el límite superior | `PUT /admin/vat-rate` → Execute | `{ "value": "100" }` | **200** con `value: "100.00"` | [ ] | [ ] |
| 9 | Verificar el vigente en la base de datos | Consulta **Vigente** | N/A | Una sola fila: `value = 100.00`, `updated_by` = id del admin | [ ] | [ ] |
| 10 | Verificar la trazabilidad del historial (FR-005, SC-004) | Consulta **Historial** | N/A | 5 filas en orden: `(vacío → 19.00)`, `(19.00 → 5.00)`, `(5.00 → 5.00)`, `(5.00 → 0.00)`, `(0.00 → 100.00)`; todas con `changed_by` = id del admin y su `changed_at` | [ ] | [ ] |

--------------------------------------------------------------------------------

##### Section 2: Rechazo de valores inválidos y de actores no autorizados (HU1, escenario 2)
Continúa con el estado que dejó la Sección 1 (vigente `100.00`, 5 entradas de historial).

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Valor mayor a 100 | `PUT /admin/vat-rate` con el token del admin | `{ "value": "120" }` | **400** `INVALID_VAT_RATE` con un mensaje que explica el rango permitido | [ ] | [ ] |
| 2 | Valor apenas por encima de 100 | `PUT /admin/vat-rate` | `{ "value": "100.01" }` | **400** `INVALID_VAT_RATE` | [ ] | [ ] |
| 3 | Valor negativo | `PUT /admin/vat-rate` | `{ "value": "-1" }` | **400** `INVALID_VAT_RATE` | [ ] | [ ] |
| 4 | Más de 2 decimales | `PUT /admin/vat-rate` | `{ "value": "19.555" }` | **400** `INVALID_VAT_RATE` | [ ] | [ ] |
| 5 | Valor no numérico | `PUT /admin/vat-rate` | `{ "value": "diecinueve" }` | **400** `INVALID_VAT_RATE` | [ ] | [ ] |
| 6 | Valor como número en lugar de texto | `PUT /admin/vat-rate` | `{ "value": 19 }` (sin comillas) | **400** `INVALID_VAT_RATE` | [ ] | [ ] |
| 7 | Cuerpo sin el campo `value` | `PUT /admin/vat-rate` | `{}` | **400** `INVALID_VAT_RATE` | [ ] | [ ] |
| 8 | El vigente no cambió tras los rechazos (SC-003) | Consultas **Vigente** e **Historial** | N/A | Vigente sigue en `100.00`; el historial sigue con 5 filas | [ ] | [ ] |
| 9 | Petición sin token | **Authorize** → Logout → `PUT /admin/vat-rate` | `{ "value": "19.00" }` | **401** `UNAUTHENTICATED`; el Curl no incluye `Authorization` | [ ] | [ ] |
| 10 | Petición con un token inválido | **Authorize** → pegar un texto cualquiera → `PUT /admin/vat-rate` | Token: `token-invalido`; cuerpo `{ "value": "19.00" }` | **401** `UNAUTHENTICATED` | [ ] | [ ] |
| 11 | Login con contraseña incorrecta | `POST /auth/login` | `{ "username": "admin", "password": "incorrecta" }` | **401** `UNAUTHENTICATED`, sin `accessToken` | [ ] | [ ] |
| 12 | Iniciar sesión como OTA | **Authorize** → Logout → `POST /auth/login` | `{ "username": "ota-demo", "password": "<SEED_OTA_PASSWORD>" }` | **200** con `accessToken` | [ ] | [ ] |
| 13 | Actor distinto al Administrador intenta actualizar (FR-006, SC-005) | **Authorize** con el token de la OTA → `PUT /admin/vat-rate` | `{ "value": "19.00" }` | **403** `FORBIDDEN` | [ ] | [ ] |
| 14 | El vigente no cambió tras los accesos rechazados | Consultas **Vigente** e **Historial** | N/A | Vigente sigue en `100.00`; el historial sigue con 5 filas | [ ] | [ ] |

--------------------------------------------------------------------------------

##### Section 3: Pruebas automáticas (casos que no se pueden provocar a mano)
En una terminal en la carpeta `Hospitua-Module-3`, con Docker corriendo.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Pruebas unitarias, de contrato y de integración contra PostgreSQL | `$env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"` y luego `npm test` | Base `modulo3_test` migrada | `Test Suites: 5 passed`, `Tests: 40 passed`, ninguna omitida | [ ] | [ ] |
| 2 | Pruebas de punta a punta del endpoint | `npm run test:e2e` | N/A | `Tests: 16 passed` | [ ] | [ ] |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
Tomados de los casos límite de la spec.

* **EC-001** : Dos Administradores actualizan casi al mismo tiempo (FR-007, NFR-002). Debe quedar un solo vigente y un historial en secuencia coherente. → Sección 3, paso 1: prueba de integración con 10 actualizaciones simultáneas.
* **EC-002** : Estado inicial sin ningún porcentaje (FR-003). El sistema no asume un valor por defecto y el primer registro deja el valor anterior vacío. → Sección 1, pasos 4 y 10; Sección 3, paso 1.
* **EC-003** : Falla el registro del historial (FR-005). El cambio del vigente también se revierte. → Sección 3, paso 1: prueba de integración T022.
* **EC-004** : Valor idéntico al vigente. Se acepta y deja su entrada de historial. → Sección 1, pasos 6 y 10.
* **EC-005** : Límites exactos del rango (0 y 100) y valores justo fuera de él. → Sección 1, pasos 7 y 8; Sección 2, pasos 2 y 3.
* **EC-006** : Token expirado. Debe responder 401 `UNAUTHENTICATED`. → Repetir el paso 9 de la Sección 2 con un token de más de una hora.
* **EC-007** : Una factura se genera en el instante exacto de una actualización, y las facturas emitidas no cambian (BR-002, BR-003). → **No aplicable todavía**: requiere la feature 006.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | System crash, data corruption, or complete block of critical user journey with no workaround. |
| **Major** | **M** | Core feature broken or significant functionality loss, but an awkward workaround exists. |
| **Small / Minor** | **S** | Cosmetic issue, minor UI alignment, typo, or non-blocking defect. |
