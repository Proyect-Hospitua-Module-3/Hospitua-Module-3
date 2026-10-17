# Implementation Plan: Registrar Check-out

**Date**: 2026-10-09
**Spec**: [registrar_checkout.md](../1-functional/registrar_checkout.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Contrato**: [EVENT-habitacion-checkout.md](contracts/EVENT-habitacion-checkout.md)

## Summary

El contexto `checkout-ingestion` consume `habitacion.checkout`, valida el sobre y coordina `GenerateSettlementUseCase` (007) seguido de `GenerateFinalInvoiceUseCase` (006). La auditoría registra el estado por `eventId`; `stayId` asegura la idempotencia de negocio [SPEC FR-001–FR-010, BR-004].

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS, según el Plan Base.
**Primary Dependencies**: NestJS 10.x, `@nestjs/microservices` (`Transport.RMQ`), Prisma ORM y RabbitMQ.
**Storage**: PostgreSQL 16; `checkout_event_log` audita el evento con una lista blanca y sin valores tributarios.
**Testing**: Jest (validación y orquestación), Jest + Testcontainers (PostgreSQL/RabbitMQ), contract test del evento y pruebas e2e del ack, errores terminales y reintentos diferidos.
**Target Platform**: Servicio backend Linux en contenedor Docker, dentro del monolito modular del Módulo 3.
**Project Type**: Consumer asíncrono de RabbitMQ con auditoría y orquestación de servicios internos.
**Performance Goals**: Validación local sin llamadas externas; la generación de la liquidación se mantiene dentro de 800 ms, conforme al objetivo de 007.
**Constraints**: `stayId` UUID obligatorio e idempotencia por estancia; lista blanca sin valores de `billingCustomer`; `GenerateSettlementUseCase` precede a `GenerateFinalInvoiceUseCase`; errores terminales a DLQ y fallas transitorias con hasta 5 reintentos separados por 30 s mediante `x-retry-count`; publicaciones persistentes a retry o DLQ mediante el exchange por defecto, con `mandatory` y confirmación antes del ack; una devolución `basic.return` o una publicación no confirmada causa nack con reencolado.
**Scale/Scope**: Un evento por habitación, un consumer, una cola principal, una cola de reintento y una DLQ.

## Project Structure

### Documentation (this feature)

```text
features/010-registrar-checkout/
├── 1-functional/
│   └── registrar_checkout.md
└── 2-technical/
    ├── plan.md
    └── contracts/
        └── EVENT-habitacion-checkout.md
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── model/checkout-ingestion/
│   │   ├── checkout-event.ts
│   │   ├── checkout-event-log.ts
│   │   └── checkout-status.enum.ts
│   ├── errors/
│   │   ├── invalid-checkout-event.error.ts
│   │   └── checkout-non-recoverable.error.ts
│   └── ports/
│       ├── in/register-checkout.use-case.ts
│       └── out/
│           ├── checkout-event-log.repository.port.ts
│           └── checkout-message-publisher.port.ts
├── application/
│   ├── services/checkout-ingestion/register-checkout.service.ts
│   └── dto/checkout-ingestion/register-checkout.command.ts
└── infrastructure/
    ├── adapters/
    │   ├── in/messaging/checkout-registered.consumer.ts
    │   ├── out/messaging/rabbitmq-checkout-message-publisher.adapter.ts
    │   └── out/persistence/
    │       ├── mappers/checkout-event-log.mapper.ts
    │       └── repositories/prisma-checkout-event-log.repository.ts
    └── config/
        ├── rabbitmq.config.ts
        └── checkout-ingestion.module.ts

prisma/
├── schema.prisma
└── migrations/<timestamp>_create_checkout_event_log/migration.sql

test/
├── unit/
│   ├── domain/checkout-ingestion/checkout-event.spec.ts
│   └── application/checkout-ingestion/register-checkout.service.spec.ts
├── integration/
│   ├── messaging/checkout-registered.consumer.spec.ts
│   └── persistence/checkout-ingestion/prisma-checkout-event-log.repository.spec.ts
├── contract/messaging/checkout-event.contract.spec.ts
└── e2e/checkout-flow.e2e-spec.ts
```

**Structure Decision**: Se usa la estructura por capas del plan base con checkout-ingestion como subcarpeta. El consumer es un adaptador sin lógica; RegisterCheckoutService concentra la orquestación.

## Diseño técnico

### Flujo de aplicación

1. El consumer entrega el cuerpo original sin interpretar y los headers del mensaje a `RegisterCheckoutService` mediante el puerto `RegisterCheckoutUseCase`.
2. Si el sobre es reconocible (JSON válido con un `eventId` con formato UUID), `registerIfAbsent(...)` registra atómicamente el mensaje con estado `PENDING` o devuelve el registro existente por `eventId`.
3. Se valida el sobre, la lista blanca y los datos mínimos. Si el JSON es inválido o el sobre no es reconocible, se sigue el flujo de publicación a DLQ y auditoría descrito para ese caso. Si el evento reconocible con `eventId` tiene campos inválidos, se publica a DLQ con las reglas de confirmación; tras la confirmación y sin `basic.return`, se registra `REJECTED` con `INVALID_CHECKOUT_EVENT`.
4. Un evento válido ejecuta `GenerateSettlementUseCase` de 007 y, después, `GenerateFinalInvoiceUseCase` de 006. 006 vuelve a invocar 007 internamente; la idempotencia por `stayId` devuelve la liquidación existente sin duplicarla.
5. 010 entrega `billingCustomer` solo a 006, nunca a 007. Si falta o está incompleto, 006 produce `BillingCustomerDataMissingError`; 010 conserva la liquidación, confirma el evento y marca `PROCESSED` con la nota definida en el contrato. Un evento nuevo para la misma estancia, con los mismos datos de check-out y datos tributarios completos, reutiliza la liquidación existente y permite emitir la factura.

### Puertos y dependencias

```ts
export type RegisterCheckoutResult = 'ACK' | 'NACK_REQUEUE';

export interface RegisterCheckoutCommand {
  body: Uint8Array;
  headers: Readonly<Record<string, unknown>>;
}

export interface RegisterCheckoutUseCase {
  register(command: RegisterCheckoutCommand): Promise<RegisterCheckoutResult>;
}

export interface CheckoutEventLogRepositoryPort {
  registerIfAbsent(eventLog: CheckoutEventLog): Promise<CheckoutEventLog>;
  markProcessed(eventId: string, resultNote?: string): Promise<void>;
  markRejected(eventId: string, errorCode: string, reason: string): Promise<void>;
  markDeadLetter(eventId: string, errorCode: string, reason: string): Promise<void>;
  registerUnrecognizedEnvelopeRejection(reason: string): Promise<void>;
}

export interface CheckoutMessagePublisherPort {
  publishToRetry(
    body: Uint8Array,
    headers: Readonly<Record<string, unknown>>,
    retryCount: number
  ): Promise<void>;
  publishToDeadLetter(
    body: Uint8Array,
    headers: Readonly<Record<string, unknown>>
  ): Promise<void>;
}
```

Las operaciones del repositorio registran inicialmente `PENDING` por `eventId` o devuelven el registro existente; ese registro permite reanudar un procesamiento en `PENDING`. Las transiciones finales fijan `processed_at`; este campo permanece nulo en `PENDING`. `result_note` se informa únicamente para un resultado `PROCESSED` sin factura. El rechazo de un sobre no reconocible registra `INVALID_CHECKOUT_EVENT` con `event_id` y `payload` nulos.

El servicio decide el destino, publica mediante `CheckoutMessagePublisherPort` y espera la confirmación de la publicación antes de escribir el estado terminal. Si la publicación falla, devuelve `NACK_REQUEUE` y conserva el registro reconocible en `PENDING`. El adaptador de publicación conserva el cuerpo y los headers; para retry escribe el `x-retry-count` calculado por el servicio. El consumer solo traduce `ACK` a ack y `NACK_REQUEUE` a nack con reencolado.

Las firmas de los casos de uso proveedores se consumen como están definidas en sus planes:

- 007: `GenerateSettlementUseCase.generate(command: GenerateSettlementCommand): Promise<Settlement>`.
- 006: `GenerateFinalInvoiceUseCase.generate(command: GenerateFinalInvoiceCommand): Promise<Invoice>`.

### Auditoría `checkout_event_log`

| Columna | Tipo | Regla |
|---|---|---|
| `id` | UUID | Clave primaria. |
| `event_id` | UUID nullable | Único cuando no es nulo. |
| `event_type` | string nullable | Tipo del evento reconocido. |
| `occurred_at` | timestamptz nullable | Instante de emisión normalizado; el offset original no se conserva. |
| `payload` | jsonb nullable | Campos de lista blanca y el indicador `has_billing_customer`; nunca guarda `billingCustomer`; nulo si no se reconoce el sobre. |
| `stay_id` | UUID nullable | Identificador de estancia reconocido. |
| `status` | string | `PENDING`, `PROCESSED`, `REJECTED` o `DEAD_LETTER`. |
| `error_code` | string nullable | Código de resultado o rechazo. |
| `reason` | string nullable | Motivo registrado. |
| `result_note` | string nullable | Nota del resultado de procesamiento. |
| `processed_at` | timestamptz nullable | Momento de cierre del procesamiento. |
| `created_at` | timestamptz | Momento de registro. |

El `payload` de auditoría excluye `billingCustomer.name` y `billingCustomer.taxId`; conserva únicamente `has_billing_customer: boolean`, cuyo valor es `true` cuando el evento incluye el objeto `billingCustomer`, aunque esté incompleto, y `false` cuando no lo incluye. `Generar factura final` determina si los datos bastan para emitir la factura. Los valores tributarios se usan en memoria para `Generar factura final` (006) y no se registran.

`registerIfAbsent(...)` crea atómicamente el registro `PENDING` o devuelve el existente. Un mensaje existente en `PENDING` reanuda el procesamiento; `PROCESSED`, `REJECTED` o `DEAD_LETTER` se confirma sin reprocesar.

Los eventos con JSON inválido o sobre no reconocible se publican persistentemente a `modulo3.checkout.dlq` por el exchange por defecto con `mandatory`; tras confirmación y sin `basic.return`, se registran con `event_id` y `payload` nulos, estado `REJECTED`, código `INVALID_CHECKOUT_EVENT` y motivo, sin guardar el cuerpo crudo en la base de datos; el mensaje enviado a la DLQ conserva su contenido original, y se hace ack. Si la publicación falla, se devuelve con `basic.return` o no se confirma, se hace nack con reencolado y no se crea el registro `REJECTED`.

### Clave e idempotencia

`eventId` deduplica entregas del mismo mensaje. `stayId` UUID identifica la estancia y corresponde a la restricción `UNIQUE(stay_id)` de la liquidación de 007. Para un `eventId` nuevo, datos de check-out idénticos reutilizan la liquidación existente; datos contradictorios producen `SETTLEMENT_ALREADY_EXISTS` y conservan la original. Nunca se genera una segunda liquidación o factura por estancia.

### Errores y confirmación

| Resultado | Estado de auditoría | Mensaje |
|---|---|---|
| Éxito con factura o sin emisión por datos tributarios | `PROCESSED` | ack |
| Payload inválido | `REJECTED` después de confirmar la publicación a DLQ | Publicación persistente con `mandatory` al exchange por defecto; sin `basic.return`, registrar y hacer ack; si falla, nack con reencolado |
| Error de negocio no recuperable (`RESERVATION_NOT_FOUND`, `QUOTE_NOT_FOUND`, `MISSING_COMMISSION`, `INVALID_COMMISSION`, `SETTLEMENT_ALREADY_EXISTS`) | `DEAD_LETTER` después de confirmar la publicación a DLQ | Publicación persistente con `mandatory` al exchange por defecto; sin `basic.return`, escribir `error_code`, `reason` y estado y hacer ack; si falla, conservar `PENDING` y hacer nack con reencolado |
| Dependencia transitoria (`MODULE2_UNAVAILABLE`, `VAT_RATE_UNAVAILABLE`, `DATABASE_UNAVAILABLE`) con `x-retry-count < 5` | `PENDING` cuando el registro existe | Publicar persistentemente a retry con contador incrementado y `mandatory`; sin `basic.return`, hacer ack; si falla, nack con reencolado |
| Dependencia transitoria con `x-retry-count >= 5` | `DEAD_LETTER` después de confirmar la publicación a DLQ | Publicar persistentemente a DLQ con `mandatory`; sin `basic.return`, registrar el código del fallo actual en `error_code`, escribir `reason` y estado y hacer ack; si falla, conservar `PENDING` y hacer nack con reencolado |
| `FINAL_SETTLEMENT_NOT_FOUND` o error no tipado | `DEAD_LETTER` después de confirmar la publicación a DLQ | Publicar persistentemente a DLQ con `mandatory`; registrar `UNEXPECTED_ERROR` en `error_code` para error no tipado; sin `basic.return`, escribir `error_code`, `reason` y estado y hacer ack; si falla, conservar `PENDING` y hacer nack con reencolado |
| Duplicado en estado final (`PROCESSED`, `REJECTED`, `DEAD_LETTER`) | Sin cambio | ack inmediato |

Las fallas transitorias con `x-retry-count` menor que 5 se publican persistentemente a `modulo3.checkout.retry.30s` mediante el exchange por defecto, con el contador incrementado, `mandatory` activado y confirmación del broker antes del ack del original. La cola retry es durable, no tiene binding a `hospitua.events` y usa `x-message-ttl: 30000`, `x-dead-letter-exchange: ""` y `x-dead-letter-routing-key: modulo3.checkout`. `x-retry-count` es un entero no negativo; si está ausente, no es un entero o es negativo, se interpreta como 0. El broker puede agregar `x-death` al devolver el mensaje por TTL, pero `x-death` no determina el límite de reintentos. Cuando el contador es 5, el siguiente fallo publica persistentemente a `modulo3.checkout.dlq` mediante el exchange por defecto con `mandatory`; tras confirmación y ausencia de `basic.return`, se registra el código del fallo actual en `error_code`, el motivo en `reason` y el estado `DEAD_LETTER`. Las fallas de escritura de la auditoría de 010, incluida la de `registerIfAbsent(...)`, se tratan como `DATABASE_UNAVAILABLE` y siguen la misma ruta de retry; el registro se crea o se actualiza cuando una reentrega logra escribirlo. Se exceptúa la escritura del estado posterior a una publicación confirmada a la DLQ, que se rige por el nack con reencolado descrito a continuación. Los errores terminales y payloads inválidos se publican persistentemente a la DLQ mediante el exchange por defecto con `mandatory`. La DLQ es durable y no tiene binding a `hospitua.events`; no se declara `hospitua.events.dlx`. Una publicación devuelta con `basic.return` o no confirmada se trata como fallida y causa nack con reencolado del mensaje original. Si la publicación a la DLQ se confirma y falla la escritura del estado, el mensaje original recibe nack con reencolado y la reentrega repite la publicación: un evento reconocible encuentra su registro en `PENDING` y un sobre irreconocible se evalúa de nuevo como tal. La DLQ puede recibir una copia duplicada; la revisión manual la descarta por `eventId` cuando existe y, en un sobre irreconocible, por ser idéntica al mensaje original. La recuperación manual corrige la causa, cambia el registro a `PENDING` y publica el mensaje a `modulo3.checkout` mediante el exchange por defecto con `x-retry-count` en 0, para iniciar un nuevo ciclo de reintentos. `modulo3.checkout.dlq` es el destino de la revisión manual definida en la spec [SPEC FR-008, FR-010].

La lista de códigos de auditoría y acciones se define en [EVENT-habitacion-checkout.md](contracts/EVENT-habitacion-checkout.md). `INVALID_CHECKOUT_EVENT` es código de auditoría y no un error HTTP.

### Observabilidad y privacidad

El log estructurado de cada procesamiento incluye `eventId` y `stayId` cuando el sobre los trae, resultado, `errorCode` y duración. Nunca registra `billingCustomer.name`, `billingCustomer.taxId` ni datos migratorios.

### Consistencia con Consultar liquidación

El procesamiento del evento es asíncrono. Módulo 1 consulta normalmente antes de confirmar el check-out y no necesita volver a consultar después del evento. Si cualquier consulta coincide con el procesamiento, recibir el evento no implica que la liquidación final esté disponible de inmediato en `GET /api/settlements`: se devuelve la informativa antes de persistir la final o la final después, nunca un estado intermedio.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Crear el módulo `checkout-ingestion`, el consumer y la estructura de auditoría.

- [ ] T001 Crear el módulo `checkout-ingestion`, el consumer y la estructura de auditoría.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Definir la auditoría, la publicación de mensajes y la topología compartida por las historias.

- [ ] T002 Definir `CheckoutEventLog`, sus estados y `CheckoutEventLogRepositoryPort`. Agregar el modelo `CheckoutEventLog` a `prisma/schema.prisma` con la migración correspondiente y `UNIQUE` parcial sobre `event_id`. Definir en `domain/ports/out/checkout-message-publisher.port.ts` las operaciones de publicación a retry y DLQ.
- [ ] T003 Implementar `registerIfAbsent(...)` con deduplicación atómica por `eventId`.
- [ ] T004 Implementar las transiciones de auditoría (`markProcessed`, `markRejected`, `markDeadLetter` y `registerUnrecognizedEnvelopeRejection`) mediante las operaciones de `CheckoutEventLogRepositoryPort`.
- [ ] T005 Configurar la topología RabbitMQ y el manejo de ack manual conforme al Plan Base. Declarar `modulo3.checkout.retry.30s` durable, sin binding a `hospitua.events`, con `x-message-ttl: 30000`, `x-dead-letter-exchange: ""` y `x-dead-letter-routing-key: modulo3.checkout`; declarar `modulo3.checkout.dlq` durable y sin binding a `hospitua.events`; no declarar `hospitua.events.dlx`; mantener la cola principal sin argumentos nuevos. Configurar publicaciones persistentes por el exchange por defecto con `mandatory` activado; hacer ack del original solo tras publisher confirm y ausencia de `basic.return`, y hacer nack con reencolado si la publicación falla, es devuelta o no se confirma. Configurar el adaptador RabbitMQ de `CheckoutMessagePublisherPort` para publicar por el exchange por defecto, con mensajes persistentes y `mandatory`; resolver cada promesa solo tras publisher confirm y sin `basic.return`, y rechazarla en cualquier otro caso.

**Checkpoint**: La auditoría, los puertos de publicación y la topología están disponibles para las historias.

---

## Phase 3: User Story 1 - Procesar un evento válido de check-out (Priority: P1)

**Goal**: Procesar el evento válido e incluir `Generar liquidación`, seguido de `Generar factura final` cuando existan datos tributarios completos.

**Independent Test**: Se puede procesar un evento válido con el identificador UUID de la estancia y verificar que se incluye a `Generar liquidación`, seguida de `Generar factura final` cuando existen los datos tributarios completos.

### Tests for User Story 1

- [ ] T006 [US1] Pruebas de integración con Testcontainers para PostgreSQL y RabbitMQ: auditoría atómica, deduplicación, ack, publicación a DLQ con ack, `DATABASE_UNAVAILABLE`, `FINAL_SETTLEMENT_NOT_FOUND` y `UNEXPECTED_ERROR`. Verificar publicaciones persistentes a retry y DLQ con `mandatory`, publisher confirm y `basic.return`; una publicación devuelta, fallida o no confirmada debe causar nack con reencolado del original. Verificar que el servicio confirma la publicación antes de escribir el estado terminal y que una publicación fallida deja el registro reconocible en `PENDING` y resulta en `NACK_REQUEUE`. Verificar que un `eventId` presente sin formato UUID se trata como sobre no reconocible, y que, si falla la escritura del estado tras confirmar la publicación a la DLQ, la reentrega repite la publicación. Verificar que una falla de escritura de la auditoría anterior a cualquier publicación a la DLQ, incluida la de `registerIfAbsent(...)`, sigue la ruta de retry y que el registro se crea cuando una reentrega logra escribirlo.
- [ ] T007 [US1] Pruebas e2e del flujo de check-out completo y del flujo sin factura por datos tributarios incompletos. Cubrir también el evento posterior con datos tributarios completos que emite la factura, y verificar que el procesamiento no modifica la ocupación, disponibilidad ni bloqueo físico de la habitación.

### Implementation for User Story 1

- [ ] T008 [US1] Implementar `RegisterCheckoutService` (puerto `RegisterCheckoutUseCase`) con la secuencia 007 y 006, incluyendo la respuesta normal sin emisión de factura.
- [ ] T009 [US1] Implementar el consumer adaptador con ack/nack según el resultado tipado. El servicio publica a retry o DLQ por medio de `CheckoutMessagePublisherPort`; el adaptador de publicación conserva cuerpo y headers e incorpora el `x-retry-count` calculado por el servicio para retry. El consumer solo traduce `ACK` a ack y `NACK_REQUEUE` a nack con reencolado.

**Checkpoint**: Un evento válido genera la liquidación y da lugar a la factura final cuando corresponde.

---

## Phase 4: User Story 2 - Rechazar eventos inválidos y omitir datos migratorios (Priority: P1)

**Goal**: Rechazar eventos con datos obligatorios inválidos y omitir los datos migratorios del procesamiento de Módulo 3.

**Independent Test**: Se pueden procesar eventos con datos obligatorios faltantes, rangos de fechas inválidos y datos migratorios omitidos, y verificar en cada caso el resultado correspondiente.

### Tests for User Story 2

- [ ] T010 [US2] Pruebas unitarias de validación del sobre, lista blanca y fechas; validar `occurredAt` con `Z` y `-05:00`, y rechazar valores sin offset o con formato inválido. Cubrir también una estancia de una sola noche (fecha de salida el día posterior a la de entrada) y verificar que la validación y el registro no consultan a otros módulos.
- [ ] T011 [US2] Contract test del evento, campos de lista blanca, ejemplos y matriz de resultados del contrato; aceptar ambos formatos de `occurredAt` (`Z` y offset `-05:00`).

### Implementation for User Story 2

- [ ] T012 [US2] Implementar validación del `EventEnvelope` y reconstrucción de payload por lista blanca.

**Checkpoint**: Los eventos con datos obligatorios inválidos se rechazan y los datos migratorios se omiten.

---

## Phase 5: User Story 3 - Mantener idempotencia y completar datos tributarios (Priority: P2)

**Goal**: Reconocer reenvíos y eventos nuevos de una misma estancia, conservar una sola liquidación y permitir emitir la factura cuando existan datos tributarios completos.

**Independent Test**: Se puede procesar un evento, reenviarlo o recibir otro de la misma estancia, y verificar que la liquidación se reutiliza y que los datos de check-out contradictorios se rechazan.

### Tests for User Story 3

- [ ] T013 [US3] Pruebas unitarias de orquestación: generación de liquidación y factura, datos tributarios incompletos, reuso idempotente y contradicción de estancia. Verificar que el servicio espera la confirmación de publicación a DLQ antes de escribir el estado terminal y que, si la publicación falla, devuelve `NACK_REQUEUE` y conserva `PENDING`.

El registro atómico por `eventId`, las transiciones de auditoría y `RegisterCheckoutService` implementan esta historia mediante las tareas existentes de deduplicación, auditoría y orquestación.

**Checkpoint**: La liquidación existente se reutiliza y los datos tributarios completos permiten emitir la factura sin duplicar la liquidación.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verificar recuperación, privacidad y reintentos del procesamiento asíncrono.

- [ ] T014 Documentar la recuperación manual desde DLQ: corregir la causa, cambiar `DEAD_LETTER` a `PENDING` y publicar el mensaje a `modulo3.checkout` mediante el exchange por defecto, con `mandatory`, y esperar confirmación y ausencia de `basic.return` antes de finalizar la recuperación. La publicación lleva `x-retry-count` en 0, para iniciar un nuevo ciclo de reintentos.
- [ ] T015 Verificar privacidad: `checkout_event_log.payload` no contiene `billingCustomer.name` ni `billingCustomer.taxId` y conserva solamente `has_billing_customer`; comprobar además la unicidad por estancia y ausencia de duplicados. Verificar también que el payload persistido no contiene datos migratorios y que `has_billing_customer` es `true` cuando llega el objeto `billingCustomer`, aunque esté incompleto.
- [ ] T016 Probar la cola `modulo3.checkout.retry.30s`, su TTL de 30 s y la reentrega para fallas transitorias. Verificar que eventos nuevos de `hospitua.events` no llegan a retry; que al vencer el TTL el mensaje vuelve solo a `modulo3.checkout`; que `x-retry-count` gobierna el límite y `x-death` no lo determina; y que las publicaciones directas persistentes usan `mandatory`, publisher confirm y manejo de `basic.return`. Verificar que un `x-retry-count` ausente, no entero o negativo se trata como 0.
- [ ] T017 Probar el límite de 5 reintentos y que el fallo siguiente registre el código del fallo actual en auditoría y enrute el evento a DLQ. Verificar que cada publicación a retry incrementa `x-retry-count`; al llegar a 5, la falla siguiente publica a DLQ, registra `DEAD_LETTER` y registra el código del fallo actual en `error_code` solo después de confirmación; si la publicación falla, se conserva `PENDING` y se hace nack con reencolado.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 precede a T002–T005.
- **Foundational (Phase 2)**: T002–T005 preceden a las pruebas de las historias.
- **User Stories (Phases 3–5)**: las pruebas T006, T007, T010, T011 y T013 preceden a la implementación T008, T009 y T012.
- **Polish (Phase 6)**: T014 documenta la recuperación manual; T015–T017 cierran las verificaciones de privacidad y reintentos.

### User Story Dependencies

- **User Story 1 (P1)**: T008 requiere T012 (US2), porque `RegisterCheckoutService` usa la validación del sobre; también requiere las exportaciones de `GenerateSettlementUseCase` de 007 y `GenerateFinalInvoiceUseCase` de 006.
- **User Story 2 (P1)**: valida el sobre y la lista blanca antes de coordinar servicios de negocio.
- **User Story 3 (P2)**: reutiliza el registro por `eventId` y la idempotencia por `stayId` para completar datos tributarios sin duplicar la liquidación.

### Within Each User Story

- Ejecutar las pruebas de cada historia antes de su implementación.
- Completar los puertos de auditoría y publicación requeridos por el servicio antes del wiring del consumer.
- Mantener las verificaciones de recuperación, privacidad y reintentos después del flujo principal.

## Notes

La lista blanca excluye datos migratorios y el cuerpo crudo. `stayId` es obligatorio para procesar la estancia y la liquidación; el consumer no deriva este identificador de otros datos.
