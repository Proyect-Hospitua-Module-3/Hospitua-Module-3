### Test Case Specification: Registrar Check-out
**Created** : 2026-11-06  **Spec/Plan Link** : [registrar_checkout.md](../1-functional/registrar_checkout.md) · [plan.md](../2-technical/plan.md)  **Status** : Draft

#### Test Overview *(mandatory)*

**Test Case ID** : TC-010-RegistrarCheckout  
**Product Name & Version** : HOSPITUA Módulo 3 (Facturación, Consumos y Liquidación) v0.1.0  
**Author** : Juan Andrade
**Current Owner** : Equipo Módulo 3  
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context *(mandatory)*

##### Test Objectives

Verificar los escenarios de las tres historias de la spec (procesar un evento válido, rechazar eventos inválidos sin guardar datos migratorios y mantener la idempotencia de la estancia) y sus casos límite: falla temporal con reintentos, IVA no configurado o no disponible, error que no se resuelve reintentando y procesamiento asíncrono. Se comprueba además la política de mensajería del contrato (ack manual, retry de 30 s con `x-retry-count`, DLQ, publisher confirms y `basic.return`), la privacidad de la auditoría y la recuperación manual desde la DLQ. La feature no tiene endpoint: la entrada es la cola `modulo3.checkout`.

##### Document References

| Reference Name | Type of Reference | Document Location / Link |
| --- | --- | --- |
| Registrar Check-out | Specification Document | [1-functional/registrar_checkout.md](../1-functional/registrar_checkout.md) |
| Plan técnico 010 | Plan Document | [2-technical/plan.md](../2-technical/plan.md) |
| Contrato del evento | Event Contract | [2-technical/contracts/EVENT-facturacion-checkout.md](../2-technical/contracts/EVENT-facturacion-checkout.md) |
| Mapa de implementación | Implementation Map | [3-implementation/implementacion.md](../3-implementation/implementacion.md) |
| Módulo 1 simulado (publica el evento) | Script | [publicar-checkout.js](publicar-checkout.js) |
| Recuperación desde la DLQ | Script | [recuperar-desde-dlq.js](recuperar-desde-dlq.js) |
| Consultas de la auditoría | SQL Script | [revisar-auditoria-checkout.sql](revisar-auditoria-checkout.sql) |
| Simuladores de Módulo 1 (tarifa) y Módulo 2 (reservas) | Scripts de la 005 | [modulo1-simulado.js](../../005-consultar-tarifa-dinamica/4-testing/modulo1-simulado.js) · [modulo2-simulado.js](../../005-consultar-tarifa-dinamica/4-testing/modulo2-simulado.js) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* Las secciones 1–5 son pruebas automatizadas; la sección 6 es manual, con RabbitMQ y PostgreSQL reales y Módulo 1 y Módulo 2 simulados.
* Las suites contra PostgreSQL y RabbitMQ se omiten sin `TEST_DATABASE_URL` / `TEST_RABBITMQ_URL`.
* El viaje completo por la cola de reintento (TTL de 30 s) solo se comprueba en la sección 6: las pruebas automáticas verifican la publicación con `x-retry-count`, no la espera.

##### Dependencies & Assumptions
* 005 (cotización), 007 (liquidación), 006 (factura) y 001 (IVA) están implementadas en la misma rama.
* Para la sección 6: [TC-005](../../005-consultar-tarifa-dinamica/4-testing/TC-005-consultar-tarifa-dinamica.md) explica cómo guardar una cotización con `POST /pricing/quotes`, y [TC-001](../../001-actualizar-porcentaje-iva/4-testing/TC-001-actualizar-porcentaje-iva.md) cómo registrar el IVA.

##### Preconditions & Default Setup

* **Initial State** : base migrada (incluye `20261106000000_create_checkout_event_log` y `20261106120000_create_invoice`) y con el seed.
* **Environment** : `npm ci`; `docker compose up -d` (PostgreSQL y RabbitMQ). Para las suites con infraestructura:
  ```powershell
  $env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"
  $env:TEST_RABBITMQ_URL = "amqp://hospitua:hospitua@localhost:5672"
  $env:DATABASE_URL = $env:TEST_DATABASE_URL; npx prisma migrate deploy
  ```
* **Test Accounts** : Administrador del seed (solo para la sección 6: registrar el IVA).

--------------------------------------------------------------------------------

#### Test Execution Flow *(mandatory)*

##### Section 1: Procesar un evento válido (HU1; FR-001, FR-004, FR-009, BR-002)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | HU1: evento válido de punta a punta con los servicios reales de 010, 007, 006 y 001. Prueba: `check-out válido: ack, PROCESSED, una liquidación y la factura número 1` | `npm test -- --runInBand --runTestsByPath test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts -t "check-out válido"` | Evento del contrato con datos tributarios; reserva directa. | ack; auditoría `PROCESSED` sin nota; liquidación `FINAL`; factura 1 con total 892 500. | [✔] | — |
| 2 | Reserva OTA (BR-005: canal y comisión salen de Módulo 2). Prueba: `reserva OTA: la factura copia la comisión como referencia…` | `npm test -- --runInBand --runTestsByPath test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts -t "reserva OTA"` | Reserva OTA al 15 %. | Factura OTA: comisión 112 500, neto 637 500, total 892 500. | [✔] | — |
| 3 | FR-004 / FR-009: 007 y después 006, con `billingCustomer` solo para 006. Prueba: 6 casos de `CheckoutEventProcessorService` | `npm test -- --runInBand --runTestsByPath test/unit/application/checkout-ingestion/checkout-event-processor.service.spec.ts` | Evento con y sin `billingCustomer`; fallos de 007 y 006. | Orden 007 → 006; 007 nunca recibe datos tributarios; si 007 falla, 006 no se invoca. | [✔] | — |
| 4 | HU1, sin datos tributarios: resultado normal con nota (contrato, regla 5). Prueba: `sin datos tributarios: PROCESSED con la nota del contrato…` | `npm test -- --runInBand --runTestsByPath test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts -t "sin datos tributarios"` | `billingCustomer` sin `taxId`. | ack; `PROCESSED` con "Factura no emitida: datos tributarios ausentes o incompletos"; liquidación sí, factura no, sin número. | [✔] | — |
| 5 | Servicio: evento válido, nota y log. Prueba: describe `evento válido` | `npm test -- --runInBand --runTestsByPath test/unit/application/checkout-ingestion/register-checkout.service.spec.ts -t "evento válido"` | Procesador simulado. | `PENDING` antes de procesar; `PROCESSED` y ack; log sin datos tributarios. | [✔] | — |
| 6 | HU1 con infraestructura real: el evento publicado en `hospitua.events` termina en liquidación y factura. Prueba: `el evento de Módulo 1 termina en liquidación Final y factura emitida` | `npm run test:e2e -- --runInBand --runTestsByPath test/e2e/checkout/checkout-flow.e2e-spec.ts -t "termina en liquidación"` | `AppModule` + RabbitMQ + PostgreSQL; Módulo 2 simulado. | Auditoría `PROCESSED`; `invoice.settlement_id` = la liquidación; total 892 500. | [✔] | — |
| 7 | Sin datos tributarios con infraestructura real. Prueba: `sin datos tributarios: PROCESSED con nota, liquidación sin factura` | `npm run test:e2e -- --runInBand --runTestsByPath test/e2e/checkout/checkout-flow.e2e-spec.ts -t "sin datos tributarios"` | `billingCustomer: null`. | `PROCESSED` con nota; payload sin el documento fiscal; liquidación sí, factura no. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 2: Rechazar eventos inválidos y omitir datos migratorios (HU2; FR-002, FR-003, FR-005, FR-006, BR-003, NFR-001–NFR-003)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | Validación del evento: 46 casos (sobre, `occurredAt`, campos obligatorios, fechas, datos tributarios, lista blanca, determinismo) | `npm test -- --runInBand --runTestsByPath test/unit/domain/checkout-ingestion/checkout-event.spec.ts` | Variantes del evento del contrato. | Se rechaza lo inválido; salida el mismo día y una noche son válidas; los datos tributarios nunca invalidan; sin datos migratorios en la auditoría. | [✔] | — |
| 2 | Contrato del evento: ejemplos, lista blanca, topología y códigos transitorios | `npm test -- --runInBand --runTestsByPath test/contract/messaging/checkout-event.contract.spec.ts` | Ejemplos del contrato. | Los 6 casos del contrato se cumplen. | [✔] | — |
| 3 | Sobre no reconocible y evento reconocible inválido. Pruebas: describes `sobre no reconocible` y `evento reconocible inválido` | `npm test -- --runInBand --runTestsByPath test/unit/application/checkout-ingestion/register-checkout.service.spec.ts -t "no reconocible\|reconocible inválido"` | JSON inválido, UTF-8 inválido, sin `eventId`, `eventId` no UUID; evento sin datos válidos. | DLQ; `REJECTED` (sin `event_id` si el sobre no es reconocible); nack si la DLQ no confirma. | [✔] | — |
| 4 | NFR-002: un evento inválido no consulta otros módulos. Prueba: `evento inválido: REJECTED a la DLQ sin llamar a 007 ni a 006` | `npm test -- --runInBand --runTestsByPath test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts -t "evento inválido"` | Evento sin `stayId`. | `REJECTED` con `INVALID_CHECKOUT_EVENT`; Módulo 2 no recibe peticiones; sin liquidación. | [✔] | — |
| 5 | Privacidad (T017): la auditoría no guarda datos tributarios. Prueba: `la auditoría nunca guarda nombre ni documento fiscal…` | `npm test -- --runInBand --runTestsByPath test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts -t "la auditoría nunca guarda"` | Evento con `billingCustomer` completo. | Payload sin nombre ni documento; `has_billing_customer: true`. | [✔] | — |
| 6 | Privacidad en la base real. Prueba: `nunca persiste datos tributarios ni migratorios` | `npm test -- --runInBand --runTestsByPath test/integration/persistence/checkout-ingestion/prisma-checkout-event-log.repository.spec.ts -t "nunca persiste"` | PostgreSQL. | La fila no tiene datos tributarios ni migratorios. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 3: Idempotencia de la estancia (HU3; BR-004)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | Reentrega del mismo `eventId`. Prueba: `reentrega del mismo mensaje: ack sin volver a consultar Módulo 2…` | `npm test -- --runInBand --runTestsByPath test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts -t "reentrega del mismo mensaje"` | El mismo mensaje dos veces. | ack; un solo registro de auditoría; Módulo 2 no se consulta otra vez; una sola factura. | [✔] | — |
| 2 | Otro evento, misma estancia y mismos datos. Prueba: `otro evento con los mismos datos de la estancia…` | `npm test -- --runInBand --runTestsByPath test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts -t "otro evento con los mismos datos"` | `eventId` nuevo, mismo `stayId`. | `PROCESSED`; la liquidación y la factura se reutilizan (1 inserción, número 1). | [✔] | — |
| 3 | Otro evento con datos contradictorios. Prueba: `otro evento con datos contradictorios: SETTLEMENT_ALREADY_EXISTS a la DLQ…` | `npm test -- --runInBand --runTestsByPath test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts -t "datos contradictorios"` | Mismo `stayId`, otra fecha de salida. | DLQ; `DEAD_LETTER` con `SETTLEMENT_ALREADY_EXISTS`; la factura emitida no cambia. | [✔] | — |
| 4 | Deduplicación por `eventId` en el servicio. Prueba: describe `deduplicación por eventId` | `npm test -- --runInBand --runTestsByPath test/unit/application/checkout-ingestion/register-checkout.service.spec.ts -t "deduplicación por eventId"` | Registros `PROCESSED`, `REJECTED`, `DEAD_LETTER` y `PENDING`. | Cerrados → ack sin reprocesar; `PENDING` → se reanuda. | [✔] | — |
| 5 | Deduplicación en la base: entregas simultáneas. Prueba: `dos entregas simultáneas del mismo evento dejan un solo registro` | `npm test -- --runInBand --runTestsByPath test/integration/persistence/checkout-ingestion/prisma-checkout-event-log.repository.spec.ts -t "entregas simultáneas"` | PostgreSQL. | Un solo registro. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 4: Reintentos, DLQ y mensajería (FR-008, FR-010, NFR-005; casos límite)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | Caso límite: falla temporal → reintento y, al recuperarse, factura. Prueba: `Módulo 2 caído: va a la cola de reintento y la reentrega…` | `npm test -- --runInBand --runTestsByPath test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts -t "Módulo 2 caído"` | Módulo 2 falla; luego responde. | Retry con `x-retry-count` 1 y `PENDING`, sin liquidación parcial; la reentrega termina `PROCESSED` con la factura 1. | [✔] | — |
| 2 | NFR-005: 5 reintentos y luego DLQ. Prueba: `agotados los 5 reintentos: DLQ con MODULE2_UNAVAILABLE` | `npm test -- --runInBand --runTestsByPath test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts -t "agotados los 5 reintentos"` | `x-retry-count` 5. | DLQ; `DEAD_LETTER` con el código del fallo actual. | [✔] | — |
| 3 | Caso límite: IVA no configurado (no reintentable) / no disponible (reintentable). Pruebas: `IVA nunca configurado…`; `fallo transitorio al leer el IVA…` | `npm test -- --runInBand --runTestsByPath test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts -t "IVA nunca configurado\|leer el IVA"` | Sin IVA; lectura del IVA falla. | Sin IVA: DLQ sin reintentos, liquidación guardada, sin factura. No disponible: retry. | [✔] | — |
| 4 | Errores no recuperables y fallas transitorias en el servicio: describes `errores no recuperables`, `fallas transitorias`, `fallas de la auditoría`, `x-retry-count` | `npm test -- --runInBand --runTestsByPath test/unit/application/checkout-ingestion/register-checkout.service.spec.ts -t "no recuperables\|fallas transitorias\|fallas de la auditoría\|x-retry-count"` | 7 códigos de negocio, 3 transitorios, fallas de auditoría, `x-retry-count` ausente / no entero / negativo / texto, `x-death`. | Cada código a su destino; publicar → confirmar → escribir estado; nack si algo falla; `x-death` no cuenta. | [✔] | — |
| 5 | Topología, publicador con confirms y `basic.return`, consumer con ack/nack (RabbitMQ real) | `npm test -- --runInBand --runTestsByPath test/integration/messaging/checkout-messaging.spec.ts` | RabbitMQ. | 10 casos: solo `facturacion.checkout` llega a la cola; retry/DLQ sin binding; confirm y `basic.return`; ack y reencolado. | [✔] | — |
| 6 | Falla temporal con infraestructura real. Prueba: `Módulo 2 caído: el evento va a la cola de reintento con x-retry-count 1` | `npm run test:e2e -- --runInBand --runTestsByPath test/e2e/checkout/checkout-flow.e2e-spec.ts -t "Módulo 2 caído"` | Módulo 2 simulado responde 503. | Mensaje en `modulo3.checkout.retry.30s` con `x-retry-count` 1; auditoría `PENDING`; sin liquidación. | [✔] | — |
| 7 | Auditoría real: transiciones y restricciones | `npm test -- --runInBand --runTestsByPath test/integration/persistence/checkout-ingestion/prisma-checkout-event-log.repository.spec.ts` | PostgreSQL. | 10 casos: `PENDING` con lista blanca, sin duplicados, transiciones solo desde `PENDING`, `CHECK` de la migración. | [✔] | — |
| 8 | Caso límite: la base de datos falla mientras 007 lee o guarda la liquidación (el error de Prisma llega sin tipo) | `npm test -- --runInBand --runTestsByPath test/unit/infrastructure/checkout-ingestion/transient-persistence.checkout-processor.spec.ts` | `P1001`, `P1017`, `P2024`, `PrismaClientInitializationError`; `P2003` (FK) como control. | Las fallas transitorias salen como `DATABASE_UNAVAILABLE` → retry y, agotados los 5, DLQ con ese código. Un error de Prisma no transitorio sigue como `UNEXPECTED_ERROR` → DLQ. Los errores de dominio pasan sin cambios. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 5: Arranque del consumer, arquitectura y log (FR-001, FR-007, NFR-004)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | Arranque del consumer con un broker simulado (T011) | `npm test -- --runInBand --runTestsByPath test/unit/infrastructure/checkout-ingestion/rabbitmq-checkout.runner.spec.ts` | Sin `RABBITMQ_URL`; broker que acepta, rechaza o cierra la conexión. | Sin URL arranca y advierte; con URL declara topología, canal con confirms y `prefetch(1)`; reconecta; al apagar cierra. | [✔] | — |
| 2 | FR-001 / FR-007: reglas de dependencia | `npm test -- --runInBand --runTestsByPath test/architecture/checkout-ingestion-dependencies.spec.ts` | Imports de `src/`. | Consumer sin lógica; solo el procesador llama a 007/006; 010 no toca pricing ni Módulo 1; sin NestJS/amqplib/Prisma en dominio y aplicación; sin controller. | [✔] | — |
| 3 | NFR-004: log estructurado por mensaje | `npm test -- --runInBand --runTestsByPath test/unit/infrastructure/checkout-ingestion/checkout-log-writer.spec.ts` | Los 6 resultados posibles. | JSON con eventId, stayId, resultado, errorCode y duración; `warn` si no se procesó. | [✔] | — |
| 4 | Regresión: el `AppModule` arranca con 010 conectada | `npm run test:e2e -- --runInBand` | Todas las E2E (sin infraestructura). | `Tests: 129 passed, 3 skipped` (las 3 omitidas son las de 010 con infraestructura). Con `TEST_DATABASE_URL` y `TEST_RABBITMQ_URL`: `Tests: 132 passed`. | [✔] | — |
| 5 | Regresión: reglas de dependencia de 006 y 007 con 010 como importador | `npm test -- --runInBand --runTestsByPath test/architecture/billing-dependencies.spec.ts test/architecture/settlement-dependencies.spec.ts` | Imports de `src/`. | Pasan: 010 está entre los importadores permitidos. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 6: Prueba manual de punta a punta (RabbitMQ y PostgreSQL reales)

Antes de empezar: `docker compose up -d`; `npx prisma migrate deploy`; `npm run prisma:seed`. En el `.env`: `RABBITMQ_URL=amqp://hospitua:hospitua@localhost:5672`, `MODULE1_BASE_URL=http://localhost:8080` y `MODULE2_BASE_URL=http://localhost:8081`.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | Levantar Módulo 1 simulado (tarifas) | Terminal aparte: `node features/005-consultar-tarifa-dinamica/4-testing/modulo1-simulado.js` | Puerto 8080. | "Módulo 1 simulado en http://localhost:8080". | [✔] | — |
| 2 | Arrancar Módulo 3 | `npm run start:dev` | `.env` del encabezado. | Log "Consumiendo modulo3.checkout (feature 010)". | [✔] | — |
| 3 | Registrar el IVA | Swagger `/docs`: login de Administrador → `PUT /admin/vat-rate` | `{ "value": "19" }` | **200** con `19.00`. | [✔] | Ver TC-001 |
| 4 | Guardar una cotización (como haría Módulo 2 al reservar) | `POST /pricing/quotes` | `roomId` cualquiera; `checkInDate` 2026-12-20; `checkOutDate` 2026-12-23. | **200** (contrato POST-pricing-quotes). Anotar `quoteId` y `roomId`. | [✔] | Ver TC-005 |
| 5 | Levantar Módulo 2 simulado (reservas) | Terminal aparte: `$env:QUOTE_ID = "<quoteId>"; node features/005-consultar-tarifa-dinamica/4-testing/modulo2-simulado.js` | Puerto 8081. | "Módulo 2 simulado en http://localhost:8081". | [✔] | — |
| 6 | HU1: publicar un check-out directo | `$env:ROOM_ID = "<roomId>"; node features/010-registrar-checkout/4-testing/publicar-checkout.js` | `RESERVATION_REF` = `RES-DIRECTA` (por defecto). | El script imprime el evento. Consulta 5 del SQL con su `stayId`: `PROCESSED`, liquidación `DIRECT` y factura con número e IVA. | [✔] | Anotar `eventId` y `stayId` |
| 7 | HU3: reentrega del mismo evento | Repetir el paso 6 con `$env:EVENT_ID` y `$env:STAY_ID` del paso 6 | Mismo evento. | Un solo registro de auditoría y la misma factura (consultas 1 y 5). | [✔] | — |
| 8 | HU1 OTA | Paso 6 con `$env:RESERVATION_REF = "RES-OTA-PROPIA"` y sin `EVENT_ID`/`STAY_ID` | Reserva OTA al 15 %. | Factura OTA: comisión de referencia; total = hospedaje + IVA. | [✔] | — |
| 9 | Sin datos tributarios | Paso 6 con `$env:SIN_DATOS_TRIBUTARIOS = "1"` | Sin `billingCustomer`. | `PROCESSED` con la nota; liquidación sin factura (consulta 7 de [revisar-facturas.sql](../../006-generar-factura-final/4-testing/revisar-facturas.sql)). | [✔] | — |
| 10 | HU2: evento inválido y sobre no reconocible | Paso 6 con `$env:SIN_STAY_ID = "1"`; luego con `$env:NO_JSON = "1"` | — | Consulta 2: dos `REJECTED` con `INVALID_CHECKOUT_EVENT` (el segundo sin `event_id`). Consola de RabbitMQ (`http://localhost:15672`): 2 mensajes en `modulo3.checkout.dlq`. | [✔] | — |
| 11 | Caso límite: falla temporal y viaje por la cola de reintento (TTL 30 s) | Paso 6 con `$env:RESERVATION_REF = "RES-CAIDA"`; observar 30 s | Módulo 2 responde 503. | El mensaje aparece en `modulo3.checkout.retry.30s`, vuelve a `modulo3.checkout` a los 30 s con `x-retry-count` 1, 2, …; tras 6 intentos (≈ 2,5 min) queda en la DLQ y la auditoría en `DEAD_LETTER` con `MODULE2_UNAVAILABLE`. | [✔] | — |
| 12 | Caso límite: IVA no configurado → DLQ y recuperación (T016) | Solo en un entorno de pruebas: `DELETE FROM vat_rate;` en psql; publicar (paso 6), luego registrar el IVA (paso 3), aplicar la consulta 6 del SQL y ejecutar `$env:EVENT_ID = "<eventId>"; node features/010-registrar-checkout/4-testing/recuperar-desde-dlq.js` | `VAT_RATE_NOT_CONFIGURED`. | Primero `DEAD_LETTER` con la liquidación guardada. Tras la recuperación: `PROCESSED` y factura emitida sobre la misma liquidación. | [✔] | — |
| 13 | Privacidad | Consulta 4 del SQL | — | 0 filas. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 7: Pruebas automáticas de la feature

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | Specs de 010 sin infraestructura | `npm test -- --runInBand --runTestsByPath test/unit/domain/checkout-ingestion/checkout-event.spec.ts test/unit/application/checkout-ingestion/register-checkout.service.spec.ts test/unit/application/checkout-ingestion/checkout-event-processor.service.spec.ts test/unit/infrastructure/checkout-ingestion/rabbitmq-checkout.runner.spec.ts test/unit/infrastructure/checkout-ingestion/checkout-log-writer.spec.ts test/contract/messaging/checkout-event.contract.spec.ts test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts test/architecture/checkout-ingestion-dependencies.spec.ts` | Ocho specs. | `Test Suites: 8 passed`; `Tests: 133 passed`. | [✔] | — |
| 2 | Specs de 010 con PostgreSQL y RabbitMQ | `npm test -- --runInBand --runTestsByPath test/integration/persistence/checkout-ingestion/prisma-checkout-event-log.repository.spec.ts test/integration/messaging/checkout-messaging.spec.ts` y `npm run test:e2e -- --runInBand --runTestsByPath test/e2e/checkout/checkout-flow.e2e-spec.ts` | `TEST_DATABASE_URL` y `TEST_RABBITMQ_URL`. | `Tests: 20 passed` y `Tests: 3 passed`, sin omitidas. | [✔] | — |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
Casos límite de la spec:

* **EC-001** : Falla temporal: sin resultados parciales; hasta 5 reintentos con 30 s; luego revisión manual. → Sección 4, pasos 1, 2, 6; Sección 6, paso 11.
* **EC-002** : IVA no configurado o no disponible: liquidación conservada, sin factura ni número. → Sección 4, paso 3; Sección 6, paso 12.
* **EC-003** : Reserva con varias habitaciones: un evento por habitación, una liquidación por cada una. → Lo cubre 007 (cotización por `roomId`); en la 010 cada evento es independiente (Sección 3).
* **EC-004** : Error que no se resuelve reintentando: revisión manual con su motivo. → Sección 3, paso 3; Sección 4, paso 4.
* **EC-005** : Procesamiento asíncrono: recibir el evento no implica que la liquidación exista de inmediato. → Sección 6, paso 11 (mientras reintenta, la estancia no tiene liquidación).

Casos límite adicionales del plan y del contrato:

* **EC-006** : `x-retry-count` ausente, no entero o negativo cuenta como 0; `x-death` no cuenta. → Sección 4, paso 4.
* **EC-007** : Publicación a retry/DLQ sin confirm o con `basic.return`: nack con reencolado. → Sección 2, paso 3; Sección 4, pasos 4 y 5.
* **EC-008** : Broker caído o conexión perdida: la aplicación reconecta sin perder mensajes. → Sección 5, paso 1.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| --- | :---: | --- |
| **Critical** | **C** | Un check-out se pierde (ack sin destino confirmado), se procesa dos veces, genera una segunda liquidación o factura, o la auditoría guarda datos tributarios o migratorios. |
| **Major** | **M** | Un evento válido no llega a liquidación/factura, una falla transitoria no se reintenta o un error terminal no va a la DLQ. |
| **Small / Minor** | **S** | Error documental, de log o de formato que no cambia el destino del mensaje ni los datos. |
