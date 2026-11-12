# Implementación: Registrar Check-out (010)

**Spec**: [registrar_checkout.md](../1-functional/registrar_checkout.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contrato**: [EVENT-facturacion-checkout.md](../2-technical/contracts/EVENT-facturacion-checkout.md) (evento de Módulo 1 por RabbitMQ)
**Rama**: `implementation/010-registrar-checkout`

Este documento es el mapa de dónde está el código de la 010. El código no vive en esta carpeta: sigue la arquitectura hexagonal del plan base, así que está repartido por capas en `src/` y `test/`, dentro de subcarpetas `checkout-ingestion/` (y `messaging/` para los adaptadores de RabbitMQ).

> Para encontrar todos los archivos de la 010 en VS Code: `Ctrl+Shift+F` y buscar `Feature 010`.

**Alcance de esta entrega**: Historias de usuario 1, 2 y 3 completas. La 010 consume `facturacion.checkout` de la cola `modulo3.checkout` y, por cada evento válido, genera la liquidación `Final` (007) y la factura final (006). No tiene endpoint. Se prueba a mano con el [TC-010](../4-testing/TC-010-registrar-checkout.md) (publicando el evento con [publicar-checkout.js](../4-testing/publicar-checkout.js)) y con pruebas automáticas (sección 4).

---

## 1. Qué hace

Módulo 1 publica un evento por estancia cuando registra el check-out. La 010:

1. **Audita** el mensaje en `checkout_event_log` por `eventId` (una entrega repetida no se reprocesa).
2. **Valida** el sobre y los datos mínimos; los datos tributarios nunca invalidan el evento.
3. **Procesa**: `GenerateSettlementUseCase` (007) y después `GenerateFinalInvoiceUseCase` (006).
4. **Decide el destino** del mensaje según el resultado:

| Resultado | Qué pasa con el mensaje | Auditoría |
|---|---|---|
| Liquidación y factura emitidas | ack | `PROCESSED` |
| Sin datos tributarios (006 devuelve `NOT_ISSUED`) | ack; la liquidación queda guardada | `PROCESSED` + nota "Factura no emitida: datos tributarios ausentes o incompletos" |
| Entrega repetida del mismo `eventId` ya cerrado | ack sin reprocesar | sin cambios |
| Falla transitoria (`MODULE2_UNAVAILABLE`, `VAT_RATE_UNAVAILABLE`, `DATABASE_UNAVAILABLE`) | `modulo3.checkout.retry.30s` con `x-retry-count + 1`; a los 30 s vuelve a `modulo3.checkout` | `PENDING` |
| Falla transitoria con `x-retry-count = 5` | `modulo3.checkout.dlq` | `DEAD_LETTER` + código |
| Error de negocio (`RESERVATION_NOT_FOUND`, `QUOTE_NOT_FOUND`, `MISSING_COMMISSION`, `INVALID_COMMISSION`, `SETTLEMENT_ALREADY_EXISTS`, `VAT_RATE_NOT_CONFIGURED`, `FINAL_SETTLEMENT_NOT_FOUND`) o error no tipado | DLQ sin reintentos | `DEAD_LETTER` + código |
| Evento inválido o sobre no reconocible | DLQ | `REJECTED` + `INVALID_CHECKOUT_EVENT` |
| La publicación a retry/DLQ no se confirma o vuelve con `basic.return` | nack con reencolado | sigue `PENDING` |

---

## 2. Recorrido de un mensaje

```text
Módulo 1 ─► hospitua.events (facturacion.checkout) ─► modulo3.checkout
  RabbitMqCheckoutRunner          al arrancar: topología, canal con confirms, consumer con prefetch(1)
  CheckoutRegisteredConsumer      ack / nack(requeue) según el resultado; sin lógica de negocio
  RegisterCheckoutService
     1. JSON + sobre reconocible (eventId UUID)        no → DLQ, REJECTED sin event_id
     2. registerIfAbsent(PENDING) por eventId          ya cerrado → ack (DUPLICATE)
     3. CheckoutEvent: campos, fechas, occurredAt      inválido → DLQ, REJECTED
     4. CheckoutEventProcessorService
          GenerateSettlementUseCase (007)              sin billingCustomer
          GenerateFinalInvoiceUseCase (006)            con billingCustomer; NOT_ISSUED → nota
     5. según el errorCode: retry (≤ 5) o DLQ; publicar, confirmar y después escribir el estado
     6. markProcessed(resultNote)
  checkoutLogWriter               log JSON: eventId, stayId, resultado, errorCode, duración
```

**Idea clave para explicar:** la 010 no calcula nada. Recibe el evento, lo audita y orquesta 007 y 006; toda la regla de dinero está en ellas. Lo propio de la 010 es **no perder ni duplicar** un check-out: auditoría por `eventId`, idempotencia por `stayId` (007 y 006) y el mensaje solo se confirma cuando su destino (retry o DLQ) quedó confirmado por el broker.

---

## 3. Archivos por capa

### Dominio

| Archivo | Responsabilidad |
| --- | --- |
| [checkout-event.ts](../../../src/domain/model/checkout-ingestion/checkout-event.ts) | Reconoce el sobre (JSON con `eventId` UUID), valida el evento (FR-002, FR-003, FR-005) y arma la lista blanca de auditoría con `has_billing_customer`. Los datos tributarios nunca invalidan el evento. |
| [checkout-event-log.ts](../../../src/domain/model/checkout-ingestion/checkout-event-log.ts) | Registro de `checkout_event_log` y el registro PENDING inicial de un sobre reconocible. |
| [checkout-status.enum.ts](../../../src/domain/model/checkout-ingestion/checkout-status.enum.ts) | Estados `PENDING`, `PROCESSED`, `REJECTED` y `DEAD_LETTER`. |
| [invalid-checkout-event.error.ts](../../../src/domain/errors/checkout-ingestion/invalid-checkout-event.error.ts) | `INVALID_CHECKOUT_EVENT`: código de auditoría, no un error HTTP. |
| [register-checkout.use-case.ts](../../../src/domain/ports/in/checkout-ingestion/register-checkout.use-case.ts) | `RegisterCheckoutUseCase`, su comando (cuerpo y headers sin interpretar) y el resultado `ACK` o `NACK_REQUEUE`. |
| [checkout-event-log.repository.port.ts](../../../src/domain/ports/out/checkout-ingestion/checkout-event-log.repository.port.ts) | Puerto de la auditoría. |
| [checkout-message-publisher.port.ts](../../../src/domain/ports/out/checkout-ingestion/checkout-message-publisher.port.ts) | Puerto de publicación a retry y DLQ. |
| [checkout-event-processor.port.ts](../../../src/domain/ports/out/checkout-ingestion/checkout-event-processor.port.ts) | Paso de negocio de un evento válido (007 y 006). |

### Aplicación

| Archivo | Responsabilidad |
| --- | --- |
| [register-checkout.service.ts](../../../src/application/services/checkout-ingestion/register-checkout.service.ts) | Audita, valida y decide el destino según la sección 4 del contrato. Confirma la publicación antes de escribir el estado final y devuelve `NACK_REQUEUE` si algo falla. |
| [checkout-event-processor.service.ts](../../../src/application/services/checkout-ingestion/checkout-event-processor.service.ts) | **T010.** 007 y después 006; `billingCustomer` solo a 006; `NOT_ISSUED` → nota del contrato. No captura errores: el servicio decide retry o DLQ con el `errorCode`. |

### Infraestructura

| Archivo | Responsabilidad |
| --- | --- |
| [rabbitmq.config.ts](../../../src/infrastructure/config/rabbitmq.config.ts) | Nombres de exchange, routing key y colas, y la declaración de la topología. |
| [rabbitmq-checkout.runner.ts](../../../src/infrastructure/config/rabbitmq-checkout.runner.ts) | **T011.** Al arrancar: declara la topología, abre un canal con publisher confirms para el publicador y consume `modulo3.checkout`. Sin `RABBITMQ_URL` la aplicación arranca igual y lo advierte; si el broker no responde o cae, reintenta cada 5 s. Reemplaza a `rabbitmq-topology.initializer.ts`, que solo declaraba la topología. |
| [checkout-ingestion.module.ts](../../../src/infrastructure/config/checkout-ingestion.module.ts) | Wiring por token: importa `SettlementModule` (007) y `BillingModule` (006); auditoría en Prisma; procesador envuelto en `TransientPersistenceCheckoutProcessor`; runner. |
| [transient-persistence.checkout-processor.ts](../../../src/infrastructure/adapters/out/persistence/checkout-ingestion/transient-persistence.checkout-processor.ts) | Decorador del procesador: una falla transitoria de Prisma que llega sin tipo (de 007 al leer o guardar la liquidación, o de la lectura de cotizaciones de 005) sale como `CheckoutPersistenceUnavailableError` (`DATABASE_UNAVAILABLE`) y va a retry. Sin él, 010 la veía como `UNEXPECTED_ERROR` y la mandaba a la DLQ sin reintentar (decisión 8). |
| [transient-persistence-error.ts](../../../src/infrastructure/adapters/out/persistence/transient-persistence-error.ts) | `isTransientPersistenceError`: la misma lista de códigos de Prisma que usa 006 (conexión, timeout, pool, transacción). |
| [checkout-registered.consumer.ts](../../../src/infrastructure/adapters/in/messaging/checkout-registered.consumer.ts) | Consumer con ack manual y `prefetch(1)`: traduce `ACK` y `NACK_REQUEUE`. |
| [rabbitmq-checkout-message-publisher.adapter.ts](../../../src/infrastructure/adapters/out/messaging/rabbitmq-checkout-message-publisher.adapter.ts) | Publica por el exchange por defecto, persistente y con `mandatory`; resuelve solo con publisher confirm y sin `basic.return`. |
| [prisma-checkout-event-log.repository.ts](../../../src/infrastructure/adapters/out/persistence/repositories/checkout-ingestion/prisma-checkout-event-log.repository.ts) | `registerIfAbsent` con `ON CONFLICT` sobre el índice único parcial de `event_id`, y las transiciones, que solo cambian registros PENDING. |
| [checkout-event-log.mapper.ts](../../../src/infrastructure/adapters/out/persistence/mappers/checkout-ingestion/checkout-event-log.mapper.ts) | Filas de PostgreSQL → dominio. |
| [checkout-log-writer.ts](../../../src/infrastructure/logging/checkout-ingestion/checkout-log-writer.ts) | Log JSON por mensaje (`log` si se procesó, `warn` en otro caso), sin datos tributarios. |
| `docker-compose.yml`, `.env.example` | RabbitMQ local, `RABBITMQ_URL` y `TEST_RABBITMQ_URL`. |
| `package.json`, `package-lock.json` | `amqplib` y `@types/amqplib` con versión fijada. |

### Base de datos

Migración [20261106000000_create_checkout_event_log](../../../prisma/migrations/20261106000000_create_checkout_event_log/migration.sql) y modelo `CheckoutEventLog` en [schema.prisma](../../../prisma/schema.prisma): tabla `checkout_event_log`, índice único parcial sobre `event_id` y `CHECK` de estados, `processed_at`, `result_note` y `error_code`. La 010 no crea otras tablas: escribe en `settlement` (007) e `invoice` (006) solo a través de sus casos de uso.

---

## 4. Pruebas

| Archivo | Qué comprueba |
|---|---|
| [checkout-event.spec.ts](../../../test/unit/domain/checkout-ingestion/checkout-event.spec.ts) | Reconocimiento del sobre, `occurredAt` con `Z`, `-05:00` y fracción de segundo, rechazos por campo, una noche, salida el mismo día, salida anterior, datos tributarios ausentes o incompletos, lista blanca sin datos migratorios y determinismo (T012) |
| [register-checkout.service.spec.ts](../../../test/unit/application/checkout-ingestion/register-checkout.service.spec.ts) | Sobre no reconocible, evento inválido, errores no recuperables, fallas transitorias, límite de 5 reintentos, fallas de la auditoría, deduplicación, reanudación de PENDING, `x-retry-count` y orden "publicar, confirmar y después escribir el estado" (T015, T019) |
| [checkout-event-processor.service.spec.ts](../../../test/unit/application/checkout-ingestion/checkout-event-processor.service.spec.ts) | 007 antes que 006; `billingCustomer` solo a 006; `NOT_ISSUED` → nota; si 007 falla, 006 no se invoca (T010) |
| [rabbitmq-checkout.runner.spec.ts](../../../test/unit/infrastructure/checkout-ingestion/rabbitmq-checkout.runner.spec.ts) | Con un broker simulado: sin `RABBITMQ_URL` no se conecta; topología, confirms y `prefetch(1)`; apagado; reconexión si el broker no responde o cae (T011) |
| [checkout-log-writer.spec.ts](../../../test/unit/infrastructure/checkout-ingestion/checkout-log-writer.spec.ts) | Log JSON y nivel según el resultado |
| [transient-persistence.checkout-processor.spec.ts](../../../test/unit/infrastructure/checkout-ingestion/transient-persistence.checkout-processor.spec.ts) | Fallas transitorias de Prisma → `DATABASE_UNAVAILABLE`; un error no transitorio (FK) y los errores de dominio pasan sin cambios; con `RegisterCheckoutService`: retry, DLQ tras 5 reintentos y `UNEXPECTED_ERROR` para el no transitorio |
| [checkout-event.contract.spec.ts](../../../test/contract/messaging/checkout-event.contract.spec.ts) | Ejemplos del contrato, sobre de Módulo 1, lista blanca, topología y códigos transitorios (T013) |
| [checkout-to-invoice.flow.spec.ts](../../../test/integration/checkout-ingestion/checkout-to-invoice.flow.spec.ts) | **Flujo completo sin infraestructura**: servicios reales de 010, 007, 006 y 001 con puertos en memoria. Directo y OTA, sin datos tributarios, privacidad, reentrega, otro evento de la misma estancia, datos contradictorios, Módulo 2 caído y reintento, 5 reintentos, IVA sin configurar, IVA no disponible, evento inválido (T009, T015, T017, T019) |
| [checkout-ingestion-dependencies.spec.ts](../../../test/architecture/checkout-ingestion-dependencies.spec.ts) | Consumer sin lógica; solo el procesador llama a 007/006; 010 no toca pricing ni Módulo 1 (FR-007); dominio y aplicación sin NestJS/amqplib/Prisma; sin controller |
| [prisma-checkout-event-log.repository.spec.ts](../../../test/integration/persistence/checkout-ingestion/prisma-checkout-event-log.repository.spec.ts) | Repositorio contra PostgreSQL: deduplicación, entregas simultáneas, transiciones, sobre no reconocible, privacidad y restricciones. Requiere `TEST_DATABASE_URL` |
| [checkout-messaging.spec.ts](../../../test/integration/messaging/checkout-messaging.spec.ts) | Topología, publicador (confirm, `basic.return`, canal cerrado) y consumer (ack y nack con reencolado) contra RabbitMQ (T005–T007, T018). Requiere `TEST_RABBITMQ_URL` |
| [checkout-flow.e2e-spec.ts](../../../test/e2e/checkout/checkout-flow.e2e-spec.ts) | **De punta a punta real**: `AppModule` + RabbitMQ + PostgreSQL. El evento publicado en `hospitua.events` termina en liquidación y factura; sin datos tributarios; Módulo 2 caído → cola de reintento con `x-retry-count = 1` (T009, T018). Requiere las dos variables |
| `test/support/checkout-ingestion/` | Ejemplo de evento y dobles de la auditoría y del publicador |

Resultado actual: **las pruebas de la 010 pasan**, incluidas las que necesitan PostgreSQL o RabbitMQ reales, también con Jest corriendo todos los archivos en paralelo. La prueba manual de punta a punta del [TC-010](../4-testing/TC-010-registrar-checkout.md) (sección 6) también pasó completa, incluido el viaje real por la cola de reintento: 6 intentos separados exactamente por 30 s y después la DLQ.

```bash
docker compose up -d   # PostgreSQL y RabbitMQ
set -a; . ./.env; set +a   # TEST_DATABASE_URL y TEST_RABBITMQ_URL
npm test
npm run test:e2e
```

```powershell
docker compose up -d   # PostgreSQL y RabbitMQ
$env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"
$env:TEST_RABBITMQ_URL = "amqp://hospitua:hospitua@localhost:5672"
npm test
npm run test:e2e
```

---

## 5. Recuperación desde la DLQ (T016)

Un evento en `modulo3.checkout.dlq` queda en `DEAD_LETTER` (o `REJECTED`) con su `error_code`. Para reprocesarlo:

1. **Corregir la causa.** Ejemplos: `VAT_RATE_NOT_CONFIGURED` → registrar el IVA en `PUT /admin/vat-rate`; `MODULE2_UNAVAILABLE` agotado → esperar a que Módulo 2 responda; `MISSING_COMMISSION` → que Módulo 2 corrija la reserva. Un `INVALID_CHECKOUT_EVENT` no se recupera: Módulo 1 debe publicar un evento correcto.
2. **Volver el registro a `PENDING`** con la consulta 6 de [revisar-auditoria-checkout.sql](../4-testing/revisar-auditoria-checkout.sql). Sin este paso la reentrega se toma como duplicado y se descarta.
3. **Republicar** con [recuperar-desde-dlq.js](../4-testing/recuperar-desde-dlq.js) (`$env:EVENT_ID = "<eventId>"`). Publica en `modulo3.checkout` por el exchange por defecto, persistente, con `mandatory` y `x-retry-count = 0`, y solo quita el mensaje de la DLQ tras el publisher confirm y sin `basic.return`. Las copias duplicadas del mismo `eventId` se descartan; los demás mensajes vuelven a la DLQ.
4. **Verificar** con las consultas 1 y 5 que el evento quedó `PROCESSED` y que la estancia tiene liquidación y factura.

Es seguro reprocesar: 007 y 006 son idempotentes por `stayId`, así que una liquidación ya guardada se reutiliza y nunca se emite una segunda factura.

---

## 6. Trazabilidad: requisito → código → prueba

| Requisito de la spec | Dónde se cumple | Dónde se prueba |
|---|---|---|
| FR-001 / BR-001 Recibir el evento de Módulo 1 | Cola `modulo3.checkout` enlazada solo a `facturacion.checkout`; `RabbitMqCheckoutRunner`; sin controller | contrato (topología); runner; arquitectura; mensajería; e2e |
| FR-002 / FR-003 / FR-005 / BR-003 / SC-002 Validación, sin incluir 007 si el evento es inválido | `CheckoutEvent`; `RegisterCheckoutService` paso 3 | checkout-event.spec; servicio; flujo ("evento inválido") |
| FR-004 / FR-009 / BR-002 / SC-001 / SC-003 Incluye 007 y da lugar a 006; sin datos tributarios genera la liquidación y no emite factura | `CheckoutEventProcessorService` | procesador; flujo; e2e |
| FR-006 / NFR-003 / SC-004 Sin datos migratorios en los registros de Módulo 3 | Lista blanca del payload de auditoría | checkout-event.spec; contrato; repositorio |
| FR-007 No toca ocupación ni disponibilidad | 010 no importa pricing ni el cliente de Módulo 1 | arquitectura |
| FR-008 / NFR-004 / SC-006 Auditoría y revisión manual (todo rechazo registra su motivo) | `checkout_event_log` + DLQ; log JSON por mensaje | servicio; flujo; repositorio; log writer |
| FR-010 / NFR-005 / SC-008 Reintentos (5 × 30 s) y luego revisión manual conservando la liquidación | `x-retry-count`, `modulo3.checkout.retry.30s`, DLQ | servicio (T019); flujo; mensajería; e2e (retry) |
| BR-004 / SC-005 / SC-007 Idempotencia por estancia; el mismo `eventId` no se reprocesa | Auditoría por `eventId` + 007/006 por `stayId` | servicio; flujo (reentrega, misma estancia, contradictorio); repositorio |
| BR-005 Canal, hospedaje y comisión no vienen en el evento | 007 los toma de Módulo 2 y de la cotización | flujo (OTA) |
| NFR-001 Determinismo de la validación | `CheckoutEvent` puro | checkout-event.spec |
| NFR-002 Validación sin consultar otros módulos | Pasos 1–3 antes de 007/006 | flujo ("evento inválido": Módulo 2 no se consulta) |
| Privacidad de datos tributarios (plan 010) | `has_billing_customer`; log sin cliente | checkout-event.spec; flujo; consulta 4 del SQL |

---

## 7. Estado de las tareas del plan

| Tarea | Estado |
|---|---|
| T001–T004 (módulo, auditoría, deduplicación, transiciones) | Hecho |
| T005–T007 (topología, publicador, ack manual) | Hecho: sus pruebas pasan contra RabbitMQ real |
| T008 (integración con PostgreSQL y RabbitMQ) | Hecho: pasa contra el PostgreSQL y el RabbitMQ de `docker compose` (decisión 7) |
| T009 (e2e del flujo completo) | Hecho: flujo en memoria y e2e real pasan; TC-010 sección 6 pasó a mano |
| T010 (007 + 006) | Hecho |
| T011 (consumer activo) | Hecho: `RabbitMqCheckoutRunner` |
| T012–T014 (Historia 2) | Hecho |
| T015 (orquestación) | Hecho |
| T016 (recuperación desde la DLQ) | Hecho: sección 5 y scripts de `4-testing/` |
| T017 (privacidad) | Hecho: unitarias, flujo, repositorio contra PostgreSQL y consulta 4 (0 filas) |
| T018 (cola de reintento real) | Hecho: mensajería y e2e pasan; el viaje completo por TTL se comprobó a mano (TC-010, sección 6, paso 11): reintentos cada 30 s y DLQ tras el quinto |
| T019 (límite de 5 reintentos) | Hecho |

---

## 8. Decisiones de implementación

1. **007 y después 006**, como pide el plan, aunque 006 vuelva a invocar 007: así un evento con datos contradictorios falla en 007 con `SETTLEMENT_ALREADY_EXISTS` aunque la estancia ya tenga factura, en lugar de confirmarse en silencio.
2. **El runner construye `RegisterCheckoutService`**: el publicador necesita el canal con confirms, que solo existe al conectar. El módulo le pasa las demás dependencias.
3. **`RABBITMQ_URL` opcional**: sin ella la aplicación arranca (las demás features no dependen del broker) y los eventos esperan en la cola. Las E2E (`e2e-env.ts`) y `npm test` (`jest-env.ts`) la fijan vacía: si una prueba que levanta `AppModule` arrancara el consumer, consumiría la cola real y robaría los mensajes que publica en paralelo la suite de mensajería.
4. **Reconexión cada 5 s** si el broker no responde o cierra la conexión; los mensajes sin ack vuelven a la cola, así que no se pierde ninguno.
5. **Migración `20261106000000`**. Va antes que la de 006 (`20261106120000`); son tablas independientes.
6. **Recuperación con script** en lugar de la consola de RabbitMQ: la consola no permite garantizar `mandatory`, confirm y `x-retry-count = 0` a la vez.
7. **Infraestructura de pruebas con `docker compose`** y no con Testcontainers: las suites leen `TEST_DATABASE_URL` y `TEST_RABBITMQ_URL` y se omiten si no están. Así no hace falta otra dependencia y se usan los mismos servicios del entorno local.
8. **Fallas de base de datos de 007 → `DATABASE_UNAVAILABLE`** con un decorador del procesador en infraestructura (`TransientPersistenceCheckoutProcessor`). 006 ya tipaba sus fallas, pero 007 y la lectura de cotizaciones de 005 dejan pasar el error crudo de Prisma, y 010 lo mandaba a la DLQ como `UNEXPECTED_ERROR`, aunque el contrato dice que una falla transitoria de persistencia se reintenta. Se resuelve en 010, sin tocar 007: la aplicación no puede reconocer errores de Prisma (regla de arquitectura) y la lista de códigos transitorios es la misma de 006. Lo ideal es que 007 tipe sus propios errores; está anotado para su responsable.
9. **El circuit breaker de Módulo 2 también afecta a eventos sanos**: tras 5 fallos seguidos (por ejemplo, varias reservas `RES-CAIDA`), el circuito queda abierto 30 s y cualquier check-out en ese lapso va a retry con `MODULE2_UNAVAILABLE` sin llamar a Módulo 2. Es lo que define el contrato de 007 (FR-021); el reintento pasa cuando el circuito vuelve a probar.
