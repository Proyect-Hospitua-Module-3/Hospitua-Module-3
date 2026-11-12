### Test Case Specification: Consultar porcentaje de comisión OTA
**Created** : 2026-11-12  **Spec/Plan Link** : [consultar_porcentaje_comision_ota.md](../1-functional/consultar_porcentaje_comision_ota.md) · [plan.md](../2-technical/plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-003-ConsultarPorcentajeComisionOTA
**Product Name & Version** : HOSPITUA Módulo 3 (Facturación, Consumos y Liquidación) v0.1.0
**Author** : Mauricio Rios
**Current Owner** : Equipo Módulo 3
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
This test case verifies that **Módulo 2 y las OTA pueden consultar el porcentaje de comisión histórico de una OTA** (`GET /ota-commission/{otaId}`) functions successfully under specified operational conditions, y que el sistema:

- devuelve el porcentaje de la liquidación `Final` más reciente de la OTA con su fecha, marcado como histórico y referencial (FR-001, FR-002, SC-001);
- informa explícitamente que no hay historial, sin porcentaje por defecto ni 0 % (FR-004, SC-002);
- no deja que `Generar liquidación` use esta consulta: una nueva liquidación aplica el porcentaje que informa Módulo 2 en la reserva (FR-003, BR-004, SC-003);
- restringe a cada OTA a su propio historial y rechaza otros roles (FR-007, FR-009, SC-005, SC-006);
- rechaza el canal directo sin devolver 0 % (FR-006, NFR-004);
- no modifica nada al consultar y responde siempre lo mismo sin liquidaciones nuevas (FR-005, FR-008, SC-004).

Cubre las 3 historias de usuario y sus 6 escenarios de aceptación:

| Escenario | Dónde se prueba |
| --- | --- |
| HU1 escenario 1 — OTA con liquidaciones previas | Sección 1, pasos 3–5 |
| HU1 escenario 2 — OTA sin liquidaciones previas | Sección 1, paso 6 |
| HU2 escenario 1 — el porcentaje histórico difiere del de la reserva de un nuevo check-out | Sección 3, pasos 1–8 |
| HU2 escenario 2 — intento de usar la consulta como origen del cálculo | Sección 3, pasos 9–10; Sección 5, paso 2 |
| HU3 escenario 1 — la OTA consulta su propio historial | Sección 2, pasos 1–3 |
| HU3 escenario 2 — una OTA intenta consultar otra OTA | Sección 2, pasos 4–6 |

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Consultar porcentaje de comisión OTA | Specification Document | [1-functional/consultar_porcentaje_comision_ota.md](../1-functional/consultar_porcentaje_comision_ota.md) |
| Plan técnico 003 | Plan Document | [2-technical/plan.md](../2-technical/plan.md) |
| Contrato `GET /ota-commission/{otaId}` | API Contract | [2-technical/contracts/GET-ota-commission-otaid.md](../2-technical/contracts/GET-ota-commission-otaid.md) |
| Mapa de implementación | Implementation Map | [3-implementation/implementacion.md](../3-implementation/implementacion.md) |
| Datos del caso de prueba | SQL Script | [datos-tc-003.sql](datos-tc-003.sql) |
| Módulo 2 simulado | Script | [modulo2-simulado.js](modulo2-simulado.js) |
| Publicar el check-out (Módulo 1 simulado) | Script de la 010 | [publicar-checkout.js](../../010-registrar-checkout/4-testing/publicar-checkout.js) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* Módulo 3 no tiene interfaz gráfica para esta feature (la consumen Módulo 2 y las OTA): las pruebas se hacen sobre la API REST con **Postman** o con Swagger UI (<http://localhost:3000/docs>).
* Módulo 1 y Módulo 2 todavía no existen. El check-out de la Sección 3 lo publica [publicar-checkout.js](../../010-registrar-checkout/4-testing/publicar-checkout.js) (como haría Módulo 1) y la reserva la responde [modulo2-simulado.js](modulo2-simulado.js) (como haría Módulo 2).
* El historial de las Secciones 1 y 2 lo carga [datos-tc-003.sql](datos-tc-003.sql), con los importes que calcularía la 007 y fechas fijas, para que el orden "más reciente" sea siempre el mismo. La Sección 3 sí genera una liquidación con el flujo real (RabbitMQ → 010 → 007).
* Una OTA sin claim `otaId` no se puede crear con el login (el seed siempre lo pone) y un token vencido no se obtiene a mano sin esperar una hora: se verifican con las pruebas automáticas de la Sección 5.

##### Dependencies & Assumptions
* El login propio de Módulo 3 (`POST /auth/login`) funciona.
* Los usuarios `admin` (rol Administrador) y `ota-demo` (rol OTA, `otaId` = `SEED_OTA_ID`, por defecto `booking`) existen, creados por el seed. Si `SEED_OTA_ID` no es `booking`, usar ese valor donde este caso dice `booking`.
* Módulo 2 llama **sin token**: en Postman, pestaña **Authorization → No Auth**; en Swagger, **Authorize → Logout**.
* La 010 y la 007 funcionan: la Sección 3 depende de ellas (ver [TC-010](../../010-registrar-checkout/4-testing/TC-010-registrar-checkout.md)).
* El token JWT vence a la hora: si un paso con token responde 401 inesperadamente, repetir el login.

##### Preconditions & Default Setup
* **Environment** : local. Docker Desktop corriendo, `docker compose up -d --wait`, `npx prisma migrate deploy`, `npx prisma db seed` y `npm run start:dev` (ver [README](../../../README.md)), con `MODULE2_BASE_URL=http://localhost:8081` y `RABBITMQ_URL=amqp://hospitua:hospitua@localhost:5672` en el `.env`.
* **Initial State** : datos del TC-003 cargados. En una terminal en la carpeta `Hospitua-Module-3` (se puede repetir; primero borra lo de una ejecución anterior). Cargarlo después de los datos de otros TC (por ejemplo el TC-002), porque fecha la liquidación de `booking` como la más reciente:
  `Get-Content features/003-consultar-porcentaje-comision-ota/4-testing/datos-tc-003.sql | docker compose exec -T postgres psql -U hospitua -d modulo3`
* **Test Accounts** :
  * OTA: usuario `ota-demo`, contraseña en `SEED_OTA_PASSWORD` del archivo `.env`.
  * Administrador: usuario `admin`, contraseña en `SEED_ADMIN_PASSWORD` del archivo `.env`.
* **Historial cargado** :

| OTA (`otaId`) | Liquidaciones `Final` (porcentaje · fecha) | Lo que debe devolver la consulta |
| --- | --- | --- |
| `ota-tc003-a` | 12.00 · 2025-03-15; 13.50 · 2026-06-20; **15.00 · 2026-10-08** | 15.00 de `0c030000-0000-4000-8000-000000000003` |
| `ota-tc003-antigua` | **9.00 · 2015-02-01** | 9.00 de `0c030000-0000-4000-8000-000000000004` |
| `booking` | **16.00 · al cargar el script, después de cualquier otra de booking** | 16.00 de `0c030000-0000-4000-8000-000000000005` |
| canal directo | una `DIRECT` más reciente que todas | nunca aparece |
| `ota-tc003-sin-historial` | ninguna | sin historial |

Para consultar la base de datos en los pasos que lo indican, en una terminal aparte (carpeta `Hospitua-Module-3`):

* **Liquidaciones** : `docker compose exec postgres psql -U hospitua -d modulo3 -c "SELECT id, reservation_ref, channel, ota_id, ota_commission_percentage, ota_commission_amount, net_income, generated_at FROM settlement WHERE reservation_ref LIKE 'RES-TC003-%' ORDER BY generated_at"`

**Evidencia** : por cada paso, una captura de Postman (petición, código y cuerpo) o de la terminal, nombrada `TC-003-S<sección>-P<paso>.png`.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

**Última ejecución** : pendiente (caso de prueba en estado Draft, aún no ejecutado).

##### Section 1: Módulo 2 consulta el historial de una OTA (HU1)
Sin token.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Abrir la documentación de la API | Abrir el navegador en `/docs` | <http://localhost:3000/docs> | Aparece `GET /ota-commission/{otaId}` en «Comisión OTA (Módulo 2 y OTA)» | [ ] | — |
| 2 | Revisar la base antes de consultar | Consulta **Liquidaciones** | N/A | 6 liquidaciones `RES-TC003-*` como en la tabla de historial. Anotar las filas para el paso 7 | [ ] | — |
| 3 | OTA con varias liquidaciones (HU1 escenario 1) | `GET http://localhost:3000/ota-commission/ota-tc003-a` | Sin `Authorization` | **200** con exactamente `{ "otaId": "ota-tc003-a", "historical": true, "percentage": "15.00", "settlementId": "0c030000-0000-4000-8000-000000000003", "settlementDate": "2026-10-08T16:02:00.000Z" }`. Es la más reciente: no el 12.00 ni el 13.50 ni un promedio | [ ] | — |
| 4 | Liquidación muy antigua (caso límite) | `GET /ota-commission/ota-tc003-antigua` | Sin `Authorization` | **200** con `historical: true`, `percentage: "9.00"`, `settlementDate: "2015-02-01T14:00:00.000Z"`: no expira por antigüedad | [ ] | — |
| 5 | Repetir la consulta del paso 3 (FR-008) | `GET /ota-commission/ota-tc003-a` | Sin `Authorization` | **200** con exactamente el mismo cuerpo del paso 3 | [ ] | — |
| 6 | OTA sin liquidaciones (HU1 escenario 2) | `GET /ota-commission/ota-tc003-sin-historial` | Sin `Authorization` | **200** con exactamente `{ "otaId": "ota-tc003-sin-historial", "historical": false }`: sin `percentage`, sin 0 y sin 404 | [ ] | — |
| 7 | Canal directo (caso límite, FR-006) | `GET /ota-commission/DIRECT` y luego `GET /ota-commission/direct` | Sin `Authorization` | Las dos: **400** `INVALID_QUERY_PARAMS` con el mensaje «El canal directo no es una OTA: no tiene porcentaje de comisión que consultar.». Ninguna devuelve `percentage` | [ ] | — |
| 8 | La consulta no cambia nada (FR-005, SC-004) | Consulta **Liquidaciones** | N/A | Exactamente las mismas filas del paso 2 | [ ] | — |
| 9 | No se puede modificar el porcentaje (caso límite) | `PUT http://localhost:3000/ota-commission/ota-tc003-a` y luego `POST` a la misma ruta | Cuerpo `{ "percentage": "5.00" }` | Las dos: **404** `NOT_FOUND` (la ruta no existe). Repetir el paso 3: sigue en `15.00` | [ ] | — |

--------------------------------------------------------------------------------

##### Section 2: La OTA consulta su propio historial (HU3) y autorización

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Iniciar sesión como OTA | `POST http://localhost:3000/auth/login` → copiar `accessToken` | `{ "username": "ota-demo", "password": "<SEED_OTA_PASSWORD>" }` | **200** con `accessToken` | [ ] | — |
| 2 | Usar el token de la OTA | Postman: **Authorization → Bearer Token** con el `accessToken` (Swagger: **Authorize**) | Token del paso 1 | — | [ ] | — |
| 3 | La OTA consulta su propio `otaId` (HU3 escenario 1) | `GET /ota-commission/booking` | Token de `ota-demo` | **200** con `otaId: "booking"`, `historical: true`, `percentage: "16.00"`, `settlementId: "0c030000-0000-4000-8000-000000000005"` | [ ] | — |
| 4 | La OTA consulta otra OTA con historial (HU3 escenario 2) | `GET /ota-commission/ota-tc003-a` | Token de `ota-demo` | **403** `FORBIDDEN` con el mensaje «No tiene permiso para consultar la información de esta OTA.»; sin `15.00` ni ningún porcentaje en el cuerpo | [ ] | — |
| 5 | La OTA consulta otra OTA sin historial | `GET /ota-commission/ota-tc003-sin-historial` | Token de `ota-demo` | **403** con el mismo `errorCode` y el mismo mensaje del paso 4: la respuesta no revela si la otra OTA tiene historial (SC-006) | [ ] | — |
| 6 | La OTA consulta el canal directo | `GET /ota-commission/DIRECT` | Token de `ota-demo` | **400** `INVALID_QUERY_PARAMS` (el canal directo no es una OTA) | [ ] | — |
| 7 | Un Administrador no consulta comisiones (FR-007) | Login como `admin` → Bearer Token → `GET /ota-commission/booking` | `{ "username": "admin", "password": "<SEED_ADMIN_PASSWORD>" }` | **403** `FORBIDDEN` | [ ] | — |
| 8 | Token inválido | Bearer Token con el valor `abc` → `GET /ota-commission/booking` | `abc` | **401** `UNAUTHENTICATED` | [ ] | — |

--------------------------------------------------------------------------------

##### Section 3: Generar liquidación no usa esta consulta (HU2)
Check-out real de la reserva `RES-TC003-NUEVA`: Módulo 2 informa el **18 %** para `ota-tc003-a`, cuyo porcentaje histórico es el **15 %**. Sin token.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Levantar Módulo 2 simulado | Terminal aparte: `node features/003-consultar-porcentaje-comision-ota/4-testing/modulo2-simulado.js` | Puerto 8081 | «Módulo 2 simulado (TC-003) en http://localhost:8081» | [ ] | Si está corriendo el simulador de otro TC, detenerlo antes |
| 2 | Porcentaje histórico antes del check-out | `GET /ota-commission/ota-tc003-a` | Sin `Authorization` | **200** con `percentage: "15.00"` (igual que la Sección 1, paso 3) | [ ] | — |
| 3 | Publicar el check-out (como Módulo 1) | Otra terminal: `$env:ROOM_ID = "0a030000-0000-4000-8000-000000000101"; $env:RESERVATION_REF = "RES-TC003-NUEVA"; $env:SIN_DATOS_TRIBUTARIOS = "1"; node features/010-registrar-checkout/4-testing/publicar-checkout.js` | Estancia 2026-12-20 a 2026-12-23, sin datos tributarios (no se emite factura: el TC-003 no la necesita) | El script confirma la publicación en `hospitua.events` | [ ] | Al terminar, cerrar esa terminal o borrar las variables |
| 4 | 007 pidió la reserva a Módulo 2 | Mirar la terminal del Módulo 2 simulado | N/A | Una petición `GET /api/reservations/RES-TC003-NUEVA` | [ ] | — |
| 5 | La liquidación usa el porcentaje de la reserva (HU2 escenario 1) | Consulta **Liquidaciones** | N/A | Una fila nueva `RES-TC003-NUEVA`, `OTA`, `ota-tc003-a`, `ota_commission_percentage` **18.00**, `ota_commission_amount` **135000.00**, `net_income` **615000.00**. No usa el 15.00 histórico. Anotar su `id` | [ ] | — |
| 6 | La liquidación anterior no cambió | Consulta **Liquidaciones** | N/A | Las 6 filas del paso 2 de la Sección 1 siguen iguales | [ ] | — |
| 7 | La referencia histórica pasa a ser la nueva liquidación | `GET /ota-commission/ota-tc003-a` | Sin `Authorization` | **200** con `percentage: "18.00"` y `settlementId` = el `id` anotado en el paso 5 | [ ] | — |
| 8 | Repetir la consulta | `GET /ota-commission/ota-tc003-a` | Sin `Authorization` | **200** con el mismo cuerpo del paso 7 | [ ] | — |
| 9 | Revisión del diseño: settlement no conoce esta consulta (HU2 escenario 2) | En la carpeta `Hospitua-Module-3`: `Select-String -Path src\domain\model\settlement\*.ts, src\application\services\settlement\*.ts, src\domain\ports\in\settlement\*.ts, src\domain\ports\out\settlement\*.ts -Pattern "ota-commission"` | N/A | Sin resultados: ningún archivo de `settlement` importa ni menciona `ota-commission` | [ ] | — |
| 10 | Revisión del diseño: el módulo no se exporta | Abrir [ota-commission.module.ts](../../../src/infrastructure/config/ota-commission.module.ts) | N/A | El `@Module` no tiene `exports`: ningún otro módulo puede inyectar el caso de uso | [ ] | La prueba de la Sección 5, paso 2 lo verifica automáticamente |

--------------------------------------------------------------------------------

##### Section 4: Errores de la petición

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | `otaId` solo con espacios | `GET /ota-commission/%20%20` | Sin `Authorization` | **400** `INVALID_QUERY_PARAMS` con el mensaje «Indica el identificador de la OTA (otaId).» | [ ] | — |
| 2 | Formato de los errores | Cualquier respuesta de error de este TC | N/A | El cuerpo es `{ errorCode, message, timestamp, path }`; ninguna respuesta es 5xx | [ ] | — |
| 3 | Campos de la respuesta (NFR-003) | Revisar las respuestas 200 de las Secciones 1–3 | N/A | Solo `otaId`, `historical`, `percentage`, `settlementId`, `settlementDate`; ningún dato del huésped, de la reserva ni de otra OTA | [ ] | — |

--------------------------------------------------------------------------------

##### Section 5: Pruebas automáticas de la feature y regresión

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Specs de la 003 sin base de datos | `npm test -- --runTestsByPath test/unit/domain/ota-commission/ota-commission-query.spec.ts test/unit/application/ota-commission/get-latest-ota-commission.service.spec.ts test/unit/infrastructure/ota-commission/ota-commission-access.guard.spec.ts test/contract/ota-commission/ota-commission.contract.spec.ts` | Cuatro specs | `Test Suites: 4 passed`; `Tests: 45 passed`. Incluye el token expirado y el token OTA sin `otaId` (401) | [ ] | 2026-11-12: pasan en el equipo de desarrollo |
| 2 | Reglas de dependencia (HU2 escenario 2) | `npm test -- --runTestsByPath test/architecture/ota-commission-dependencies.spec.ts test/architecture/settlement-dependencies.spec.ts` | N/A | `Tests: 15 passed`: `settlement` nunca importa `ota-commission`, solo `AppModule` importa su módulo, el adaptador solo lee y el controller solo tiene `GET` | [ ] | 2026-11-12: pasan en el equipo de desarrollo |
| 3 | Adaptador contra PostgreSQL | `npm test -- --runInBand --runTestsByPath test/integration/persistence/ota-commission/prisma-ota-commission-query.adapter.spec.ts` | `TEST_DATABASE_URL` con una base de pruebas migrada | `Tests: 9 passed`, sin omitidas. Incluye dos liquidaciones del mismo instante y que el índice `(ota_id, generated_at DESC)` existe | [ ] | — |
| 4 | E2E de la 003 (incluye HU2 con 007 real) | `npm run test:e2e -- --runInBand --runTestsByPath test/e2e/ota-commission/consultar-comision-ota.e2e-spec.ts` | `TEST_DATABASE_URL` definida | `Tests: 7 passed`. Incluye que 007 no lee el puerto de la 003 al generar la liquidación | [ ] | — |
| 5 | Regresión del proyecto | `npm test` y `npm run test:e2e` | `TEST_DATABASE_URL` definida | Todas pasan; solo se omiten las que necesitan RabbitMQ si no hay `TEST_RABBITMQ_URL` | [ ] | — |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
Casos límite de la spec:

* **EC-001** : La misma OTA con distintos porcentajes en el tiempo: se devuelve el de la liquidación más reciente, sin promediar. → Sección 1, paso 3; Sección 3, paso 7.
* **EC-002** : Consulta del canal directo: se rechaza, nunca 0 %. → Sección 1, paso 7; Sección 2, paso 6.
* **EC-003** : Una OTA consulta otra OTA: rechazo sin revelar si la otra tiene historial. → Sección 2, pasos 4–5.
* **EC-004** : Intento de actualizar, corregir o fijar el porcentaje: no existe ninguna ruta para hacerlo. → Sección 1, paso 9.
* **EC-005** : Consultas repetidas sin liquidaciones nuevas: mismo resultado. → Sección 1, paso 5; Sección 3, paso 8.
* **EC-006** : Única liquidación muy antigua: se devuelve igual, sin expirar. → Sección 1, paso 4.

Casos límite adicionales del plan y del contrato:

* **EC-007** : Una liquidación del canal directo más reciente que las de la OTA nunca aparece. → Sección 1, paso 3 (datos con una `DIRECT` más reciente).
* **EC-008** : `DIRECT` en minúsculas también se rechaza. → Sección 1, paso 7.
* **EC-009** : Token inválido, token de otro rol, token expirado o token OTA sin `otaId`. → Sección 2, pasos 7–8; Sección 5, paso 1.
* **EC-010** : `otaId` vacío. → Sección 4, paso 1.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| --- | :---: | --- |
| **Critical** | **C** | Una OTA ve el porcentaje de otra OTA; la consulta crea, cambia o corrige un porcentaje o una liquidación; `Generar liquidación` usa el porcentaje histórico en vez del de la reserva; se devuelve 0 % o un porcentaje por defecto cuando no hay historial o para el canal directo. |
| **Major** | **M** | No se devuelve la liquidación más reciente; un rol no autorizado accede; una respuesta no cumple el contrato. |
| **Small / Minor** | **S** | Error de mensaje, de documentación o de formato que no cambia el porcentaje, el acceso ni los datos. |
