### Test Case Specification: Consultar liquidación
**Created** : 2026-11-07  **Spec/Plan Link** : [consultar_liquidacion.md](../1-functional/consultar_liquidacion.md) · [plan.md](../2-technical/plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-002-ConsultarLiquidacion
**Product Name & Version** : HOSPITUA Módulo 3 (Facturación, Consumos y Liquidación) v0.1.0
**Author** : Jorge Jaraba
**Current Owner** : Equipo Módulo 3
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
This test case verifies that **la OTA y Módulo 1 pueden consultar liquidaciones** (`GET /api/settlements`) functions successfully under specified operational conditions, y que el sistema:

- entrega a la OTA las liquidaciones `Final` de las habitaciones con check-out de su reserva, con el desglose y la factura cuando ya fue emitida, ordenadas por habitación (FR-002, FR-003, SC-001);
- responde igual si la reserva no tiene check-out, es directa o es de otra OTA, sin revelar cuál es el caso (FR-005, FR-006, SC-002, SC-003);
- entrega a Módulo 1 la `Final` de una habitación con check-out, o la liquidación informativa si aún no lo tiene, sin guardarla (FR-009, FR-010, FR-011, SC-006, SC-007);
- calcula la informativa con las mismas reglas que `Generar liquidación`, también en canal directo y con ajuste dinámico negativo (FR-008, SC-008);
- informa el motivo cuando la informativa no se puede calcular, sin valores parciales (FR-012, SC-009);
- rechaza sin información financiera las consultas sin los parámetros obligatorios, con token inválido o con un rol distinto de OTA (FR-013, SC-010);
- no cambia ninguna liquidación ni factura al consultar (FR-004, SC-004) y no expone datos del huésped ni `billingCustomer` (FR-007).

Cubre las 3 Historias de usuario de la spec.

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Consultar liquidación | Specification Document | [1-functional/consultar_liquidacion.md](../1-functional/consultar_liquidacion.md) |
| Plan técnico 002 | Plan Document | [2-technical/plan.md](../2-technical/plan.md) |
| Contrato `GET /api/settlements` | API Contract | [2-technical/contracts/GET-settlements.md](../2-technical/contracts/GET-settlements.md) |
| Contrato de reservas de Módulo 2 (007) | API Contract | [CLIENT-get-reservation.md](../../007-generar-liquidacion/2-technical/contracts/CLIENT-get-reservation.md) |
| Mapa de implementación | Implementation Map | [3-implementation/implementacion.md](../3-implementation/implementacion.md) |
| Datos del caso de prueba | SQL Script | [datos-tc-002.sql](datos-tc-002.sql) |
| Módulo 2 simulado | Script | [modulo2-simulado.js](modulo2-simulado.js) |
| Medición de tiempos | Script | [medir-tiempos.js](medir-tiempos.js) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* Módulo 3 no tiene interfaz gráfica: las pruebas se hacen sobre la API REST con Swagger UI (<http://localhost:3000/docs>).
* Módulo 2 todavía no existe: se reemplaza con [modulo2-simulado.js](modulo2-simulado.js), que responde como el contrato de reservas que consume la 007, con una reserva fija para cada caso.
* Las liquidaciones `Final` y las facturas no se generan con un check-out real (010 y RabbitMQ): las carga [datos-tc-002.sql](datos-tc-002.sql) con los importes que calcularía la 007. Las facturas usan los números 900200001 y 900200002, que no afectan el consecutivo de la 006.
* Una OTA sin claim `otaId` no se puede crear con el login (el seed siempre lo pone), y la consulta en medio de un check-out no se puede provocar a mano de forma confiable: las dos cosas se verifican con las pruebas automáticas de la Sección 4.
* Swagger no deja enviar la cabecera `X-Correlation-Id`: ese paso se hace con `curl`.

##### Dependencies & Assumptions
* El login propio de Módulo 3 (`POST /auth/login`) funciona.
* Los usuarios `admin` (rol Administrador) y `ota-demo` (rol OTA, `otaId` `booking`) existen, creados por el seed.
* Módulo 1 llama **sin token**: en Swagger se hace con **Authorize → Logout** antes de los pasos de Módulo 1.
* El token JWT vence a la hora: si un paso de la OTA responde 401 inesperadamente, repetir el login y volver a autorizar.

##### Preconditions & Default Setup
* **Initial State** : datos del TC-002 cargados. En una terminal en la carpeta `Hospitua-Module-3` (se puede repetir; primero borra lo de una ejecución anterior):
  `Get-Content features/002-consultar-liquidacion/4-testing/datos-tc-002.sql | docker compose exec -T postgres psql -U hospitua -d modulo3`
* **Environment** : local. Docker Desktop corriendo, `docker compose up -d`, `npx prisma migrate deploy`, `npx prisma db seed` y `npm run start:dev` (ver [README](../../../README.md)), con `MODULE2_BASE_URL=http://localhost:8081` en el `.env`. En otra terminal, el Módulo 2 simulado: `node features/002-consultar-liquidacion/4-testing/modulo2-simulado.js` (cada petición que recibe aparece en esa terminal).
* **Test Accounts** :
  * OTA: usuario `ota-demo`, contraseña en `SEED_OTA_PASSWORD` del archivo `.env`.
  * Administrador: usuario `admin`, contraseña en `SEED_ADMIN_PASSWORD` del archivo `.env`.
* **Habitaciones** (`<101>` es `0a020000-0000-4000-8000-000000000101`, y así las demás):

| Habitación | Reserva | Estado |
| --- | --- | --- |
| `<101>` | `RES-TC002-OTA` (booking, 15 %) | Final con factura 900200001 |
| `<102>` | `RES-TC002-OTA` | Final sin factura todavía |
| `<103>` | `RES-TC002-OTA` | Sin check-out |
| `<201>` | `RES-TC002-DIRECTA` (sin canal) | Final con factura 900200002 |
| `<202>` | `RES-TC002-DIRECTA` | Sin check-out |
| `<301>` | `RES-TC002-EXPEDIA` (expedia, 18 %) | Final |

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

**Última ejecución** : 2026-11-07, todos los pasos ✔. Contra la app compilada (`node dist/main`), una base temporal migrada desde cero con el seed y los datos de esta carpeta, y el Módulo 2 simulado; los pasos de Swagger se ejecutaron llamando a los mismos endpoints con los mismos datos, y las consultas a la base con `psql`.

Para consultar la base de datos en los pasos que lo indican, en una terminal aparte (carpeta `Hospitua-Module-3`):

* **Liquidaciones** : `docker compose exec postgres psql -U hospitua -d modulo3 -c "SELECT reservation_ref, room_id, channel, lodging_amount, net_income, generated_at FROM settlement WHERE reservation_ref LIKE 'RES-TC002-%' ORDER BY room_id"`
* **Facturas** : `docker compose exec postgres psql -U hospitua -d modulo3 -c "SELECT invoice_number, reservation_ref, total_amount, issued_at FROM invoice WHERE reservation_ref LIKE 'RES-TC002-%' ORDER BY invoice_number"`

##### Section 1: La OTA consulta las liquidaciones de su reserva (HU1)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Abrir la documentación de la API | Abrir el navegador en `/docs` | <http://localhost:3000/docs> | Aparece `GET /api/settlements` | [✔] | — |
| 2 | Revisar la base antes de consultar | Consultas **Liquidaciones** y **Facturas** | N/A | 4 liquidaciones (`<101>`, `<102>`, `<201>`, `<301>`) y 2 facturas. Anotar los valores para el paso 11 de la Sección 3 | [✔] | — |
| 3 | Iniciar sesión como OTA y autorizar | `POST /auth/login` → copiar `accessToken` → **Authorize** | `{ "username": "ota-demo", "password": "<SEED_OTA_PASSWORD>" }` | **200** con `accessToken`; candado cerrado | [✔] | — |
| 4 | Reserva con dos habitaciones liquidadas (escenario 1) | `GET /api/settlements` | `reservationRef=RES-TC002-OTA` | **200** con `reservationRef` y `settlements` de 2 elementos, en este orden: `<101>` `FINAL`, `categoryRoom: "DOBLE"`, desglose `700000.00` / `50000.00` / `750000.00` / `15.00` / `112500.00` / `637500.00`, `invoice` con `invoiceNumber: 900200001`, `vatAmount: "142500.00"`, `totalAmount: "892500.00"`; `<102>` `FINAL`, `categoryRoom: "SUITE"`, desglose `500000.00` / `100000.00` / `600000.00` / `15.00` / `90000.00` / `510000.00`, `invoice: null`. La habitación `<103>` (sin check-out) no aparece. Sin `Cliente TC-002` ni `BKG-TC002` en la respuesta | [✔] | — |
| 5 | Repetir la consulta (escenario 2 de HU3, SC-005) | `GET /api/settlements` | Los mismos datos del paso 4 | **200** con exactamente la misma respuesta del paso 4 | [✔] | — |
| 6 | Reserva directa (escenario 3) | `GET /api/settlements` | `reservationRef=RES-TC002-DIRECTA` | **404** `SETTLEMENT_NOT_FOUND` con el mensaje «No hay liquidaciones disponibles para esta reserva. Solo aparecen las habitaciones de tus reservas que ya tuvieron check-out.» | [✔] | — |
| 7 | Reserva de otra OTA (escenario 3) | `GET /api/settlements` | `reservationRef=RES-TC002-EXPEDIA` | **404** con el mismo `errorCode` y el mismo mensaje del paso 6 | [✔] | — |
| 8 | Reserva sin check-out o que no existe (escenario 2) | `GET /api/settlements` | `reservationRef=RES-TC002-NO-EXISTE` | **404** con el mismo `errorCode` y el mismo mensaje del paso 6 | [✔] | — |
| 9 | Parámetros que la OTA no usa | `GET /api/settlements` | `reservationRef=RES-TC002-OTA`, `roomId=<101>`, `categoryRoom=SUITE` | **200** con la misma respuesta del paso 4 (`roomId` y `categoryRoom` se ignoran) | [✔] | — |
| 10 | Sin `reservationRef` | `GET /api/settlements` | Sin parámetros | **400** `INVALID_QUERY_PARAMS` | [✔] | — |
| 11 | Un Administrador no consulta liquidaciones (BR-006) | Login como `admin` → **Authorize** → `GET /api/settlements` | `reservationRef=RES-TC002-OTA` | **403** `FORBIDDEN` | [✔] | — |
| 12 | Token inválido (escenario 4) | **Authorize** con el valor `abc` → `GET /api/settlements` | `reservationRef=RES-TC002-OTA` | **401** `UNAUTHENTICATED` | [✔] | — |
| 13 | La OTA no hace consultar a Módulo 2 | Mirar la terminal del Módulo 2 simulado | N/A | Ninguna petición en toda la Sección 1 | [✔] | — |

--------------------------------------------------------------------------------

##### Section 2: Módulo 1 consulta la liquidación de una habitación (HU2)
Sin token: **Authorize → Logout** antes del paso 1.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Habitación sin check-out, reserva OTA (escenario 1) | `GET /api/settlements` | `reservationRef=RES-TC002-OTA`, `roomId=<103>` | **200** con `settlementType: "INFORMATIVE"`, `categoryRoom: null`, `channel: "OTA"`, `otaId: "booking"`, desglose `600000.00` / `-60000.00` / `540000.00` / `15.00` / `81000.00` / `459000.00`, `invoice: null` y `generatedAt` = ahora. La terminal del Módulo 2 muestra `GET /api/reservations/RES-TC002-OTA` | [✔] | — |
| 2 | `categoryRoom` no cambia nada (FR-001) | `GET /api/settlements` | Los del paso 1 + `categoryRoom=SUITE` | **200** igual al paso 1: `categoryRoom` sigue en `null` y `SUITE` no aparece en la respuesta | [✔] | — |
| 3 | La informativa no se guardó (FR-011) | Consulta **Liquidaciones** | N/A | Sigue sin haber fila para `<103>` | [✔] | — |
| 4 | Habitación con check-out, sin `categoryRoom` | `GET /api/settlements` | `reservationRef=RES-TC002-OTA`, `roomId=<101>` | **200** igual al primer elemento del paso 4 de la Sección 1 (`FINAL`, factura 900200001). La terminal del Módulo 2 **no** muestra una petición nueva | [✔] | — |
| 5 | Final sin factura todavía | `GET /api/settlements` | `reservationRef=RES-TC002-OTA`, `roomId=<102>` | **200** `FINAL` con `invoice: null` | [✔] | — |
| 6 | Habitación sin check-out, canal directo | `GET /api/settlements` | `reservationRef=RES-TC002-DIRECTA`, `roomId=<202>` | **200** `INFORMATIVE`, `channel: "DIRECT"`, `otaId: null`, desglose `600000.00` / `120000.00` / `720000.00` / `null` / `0.00` / `720000.00` | [✔] | — |
| 7 | Habitación con check-out, canal directo | `GET /api/settlements` | `reservationRef=RES-TC002-DIRECTA`, `roomId=<201>` | **200** `FINAL`, `channel: "DIRECT"`, `otaCommissionPercentage: null`, factura 900200002 | [✔] | — |
| 8 | `roomId` en mayúsculas | `GET /api/settlements` | `reservationRef=RES-TC002-OTA`, `roomId=0A020000-0000-4000-8000-000000000101` | **200** igual al paso 4 | [✔] | — |

--------------------------------------------------------------------------------

##### Section 3: Errores de Módulo 1 y cabeceras
Sin token.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Sin `roomId` (SC-010) | `GET /api/settlements` | `reservationRef=RES-TC002-OTA` | **400** `INVALID_QUERY_PARAMS`, sin importes ni datos de la OTA | [✔] | — |
| 2 | Sin `reservationRef` | `GET /api/settlements` | `roomId=<101>` | **400** `INVALID_QUERY_PARAMS` | [✔] | — |
| 3 | `roomId` que no es UUID | `GET /api/settlements` | `reservationRef=RES-TC002-OTA`, `roomId=101` | **400** `INVALID_QUERY_PARAMS` | [✔] | — |
| 4 | Los 400 no llaman a Módulo 2 | Mirar la terminal del Módulo 2 simulado | N/A | Ninguna petición nueva desde los pasos 1–3 | [✔] | — |
| 5 | Habitación que no está en la reserva (escenario 3) | `GET /api/settlements` | `reservationRef=RES-TC002-OTA`, `roomId=0a020000-0000-4000-8000-000000000999` | **404** `QUOTE_NOT_FOUND` | [✔] | — |
| 6 | Reserva que Módulo 2 no tiene | `GET /api/settlements` | `reservationRef=RES-TC002-NO-EXISTE`, `roomId=<103>` | **404** `RESERVATION_NOT_FOUND` | [✔] | — |
| 7 | Reserva OTA sin comisión (escenario 3) | `GET /api/settlements` | `reservationRef=RES-TC002-SIN-COMISION`, `roomId=<103>` | **409** `MISSING_COMMISSION`, sin `breakdown` | [✔] | — |
| 8 | Comisión fuera de 0 a 100 | `GET /api/settlements` | `reservationRef=RES-TC002-COMISION-INVALIDA`, `roomId=<103>` | **409** `INVALID_COMMISSION` | [✔] | — |
| 9 | Módulo 2 no disponible | `GET /api/settlements` | `reservationRef=RES-TC002-CAIDA`, `roomId=<103>` | **424** `MODULE2_UNAVAILABLE` | [✔] | — |
| 10 | Cabeceras y correlación | `curl -i "http://localhost:3000/api/settlements?reservationRef=RES-TC002-OTA&roomId=0a020000-0000-4000-8000-000000000103" -H "X-Correlation-Id: tc-002-correlacion"` | N/A | **200** con `Cache-Control: no-store` y `X-Correlation-Id: tc-002-correlacion`; la terminal del Módulo 2 muestra la petición con `X-Correlation-Id: tc-002-correlacion`. Todas las respuestas de este TC, también las de error, llevan `Cache-Control: no-store` | [✔] | — |
| 11 | Nada cambió en la base (FR-004, SC-004) | Consultas **Liquidaciones** y **Facturas** | N/A | Exactamente lo mismo que en el paso 2 de la Sección 1: ninguna consulta creó, cambió ni recalculó liquidaciones ni facturas | [✔] | — |

--------------------------------------------------------------------------------

##### Section 4: Pruebas automáticas de la feature y regresión

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Specs de la 002 sin base de datos | `npm test -- --runTestsByPath test/unit/domain/settlement/settlement-query.spec.ts test/unit/infrastructure/settlement/settlement-access.guard.spec.ts test/unit/infrastructure/settlement/no-store.middleware.spec.ts test/unit/infrastructure/settlement/settlements.controller.spec.ts test/unit/application/settlement/get-settlement.service.spec.ts test/unit/application/settlement/get-settlement-module1.service.spec.ts test/contract/settlement/settlements.contract.spec.ts` | Siete specs | `Test Suites: 7 passed`; `Tests: 85 passed` | [✔] | Incluye el token OTA sin `otaId` (401) |
| 2 | Specs de la 002 contra PostgreSQL (HU3) | `npm test -- --runInBand --runTestsByPath test/integration/persistence/settlement/prisma-settlement-query.adapter.spec.ts test/integration/persistence/settlement/prisma-settlement-invoice-query.adapter.spec.ts test/integration/persistence/settlement/settlement-query-consistency.spec.ts` | `TEST_DATABASE_URL` con `modulo3_test` migrada | `Test Suites: 3 passed`; `Tests: 15 passed`; sin omitidas. Incluye: la transacción es `READ ONLY`, una Final o una factura que se están guardando no se ven, y las consultas durante un check-out solo ven resultados completos | [✔] | — |
| 3 | E2E de la 002 | `npm run test:e2e -- --runTestsByPath test/e2e/settlement/settlements.e2e-spec.ts` | N/A | `Tests: 16 passed` | [✔] | — |
| 4 | Reglas de dependencia de la 007 | `npm test -- --runTestsByPath test/architecture/settlement-dependencies.spec.ts` | N/A | Pasa: ningún archivo de la 002 importa `billing` ni el cálculo de `pricing` | [✔] | — |
| 5 | Regresión del proyecto | `npm test` y `npm run test:e2e` | `TEST_DATABASE_URL` definida | `npm test`: 1048 pasan, 10 omitidas (RabbitMQ). E2E: 145 pasan, 3 omitidas | [✔] | — |

--------------------------------------------------------------------------------

##### Section 5: Tiempo de respuesta (NFR-001)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Módulo 2 lento, casi en el timeout | Detener el Módulo 2 simulado y levantarlo con `$env:DELAY_MS = "450"; node features/002-consultar-liquidacion/4-testing/modulo2-simulado.js` | 450 ms por respuesta (timeout: 500 ms) | La terminal dice `demora 450 ms` | [✔] | — |
| 2 | Medir | `$env:SEED_OTA_PASSWORD = "<clave>"; node features/002-consultar-liquidacion/4-testing/medir-tiempos.js` | 200 consultas de cada tipo (OTA, Final, informativa), 4 a la vez | Todas **200** y `CUMPLE: p95 … ms (objetivo < 800 ms)` | [✔] | 2026-11-07: p95 total 478 ms; informativa p95 493 ms |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
Casos límite de la spec:

* **EC-001** : La reserva no tiene habitaciones con check-out: la OTA recibe que no hay liquidación, nunca ceros. → Sección 1, paso 8.
* **EC-002** : Reserva directa o de otra OTA: la misma respuesta que sin liquidación. → Sección 1, pasos 6–7.
* **EC-003** : Token inválido, rol distinto de OTA o token OTA sin `otaId`. → Sección 1, pasos 11–12; Sección 4, paso 1.
* **EC-004** : Módulo 1 sin `reservationRef` o sin `roomId`: rechazo sin información financiera. → Sección 3, pasos 1–4.
* **EC-005** : Reserva o cotización inexistente, comisión ausente o inválida, Módulo 2 caído: motivo explícito sin parciales. → Sección 3, pasos 5–9.
* **EC-006** : Reserva sin canal: canal directo sin comisión. → Sección 2, paso 6.
* **EC-007** : Consulta mientras se procesa el check-out: informativa o Final, nunca un estado intermedio. → Sección 4, paso 2.
* **EC-008** : Final con la factura aún sin emitir: `invoice: null`. → Sección 1, paso 4; Sección 2, paso 5.

Casos límite adicionales del plan y del contrato:

* **EC-009** : `categoryRoom` en la petición nunca se refleja en la respuesta. → Sección 2, paso 2.
* **EC-010** : `roomId` en mayúsculas encuentra la misma liquidación. → Sección 2, paso 8.
* **EC-011** : Ajuste dinámico negativo en la informativa. → Sección 2, paso 1.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| --- | :---: | --- |
| **Critical** | **C** | Una OTA ve una liquidación ajena o directa; la consulta crea, cambia o recalcula una liquidación o factura; la informativa se guarda o se entrega a la OTA; la respuesta expone datos del huésped o `billingCustomer`. |
| **Major** | **M** | La informativa no coincide con la Final con los mismos datos; un error no informa su motivo o devuelve valores parciales; una respuesta no cumple el contrato. |
| **Small / Minor** | **S** | Error de mensaje, de documentación o de formato que no cambia importes, acceso ni datos. |
