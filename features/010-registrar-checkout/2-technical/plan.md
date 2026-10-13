# Implementation Plan: Registrar Check-out

**Fecha**: 2026-10-09
**Spec**: [registrar_checkout.md](../1-functional/registrar_checkout.md)
**Plan Base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Contrato**: [EVENT-habitacion-checkout.md](contracts/EVENT-habitacion-checkout.md)

## Summary

El contexto `checkout-ingestion` consume `habitacion.checkout`, valida el sobre y coordina `GenerateSettlementUseCase` (007) seguido de `GenerateFinalInvoiceUseCase` (006). La auditoría registra el estado por `eventId`; `stayId` asegura la idempotencia de negocio [SPEC FR-001–FR-009, BR-004].

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS, según el Plan Base.
**Primary Dependencies**: NestJS 10.x, `@nestjs/microservices` (`Transport.RMQ`), Prisma ORM y RabbitMQ.
**Storage**: PostgreSQL 16; `checkout_event_log` audita el evento con una lista blanca y sin valores tributarios.
**Testing**: Jest (validación y orquestación), Jest + Testcontainers (PostgreSQL/RabbitMQ), contract test del evento y pruebas e2e del ack, errores terminales y reentregas diferidas.
**Target Platform**: Servicio backend Linux en contenedor Docker, dentro del monolito modular del Módulo 3.
**Project Type**: Consumer asíncrono de RabbitMQ con auditoría y orquestación de servicios internos.
**Performance Goals**: Validación local sin llamadas externas; la generación de la liquidación se mantiene dentro de 800 ms, conforme al objetivo de 007.
**Constraints**: `stayId` UUID obligatorio e idempotencia por estancia; lista blanca sin valores de `billingCustomer`; `GenerateSettlementUseCase` precede a `GenerateFinalInvoiceUseCase`; errores terminales a DLQ y fallas transitorias con hasta 5 reintentos separados por 30 s mediante `x-retry-count`; publicaciones persistentes a retry o DLQ mediante el exchange por defecto, con `mandatory` y confirmación antes del ack; una devolución `basic.return` o una publicación no confirmada causa nack con reencolado.
**Scale/Scope**: Un evento por habitación, un consumer, una cola principal, una cola de reintento y una DLQ.

## Project Structure

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
│       └── out/checkout-event-log.repository.port.ts
├── application/
│   ├── services/checkout-ingestion/register-checkout.service.ts
│   └── dto/checkout-ingestion/register-checkout.command.ts
└── infrastructure/
    ├── adapters/
    │   ├── in/messaging/checkout-registered.consumer.ts
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

1. El consumer lee el `EventEnvelope` y entrega el mensaje a `RegisterCheckoutService` mediante el puerto `RegisterCheckoutUseCase`.
2. Se valida el sobre, la lista blanca y los datos mínimos; el JSON inválido o sobre irreconocible se audita sin guardar el cuerpo crudo.
3. `registerIfAbsent(...)` registra atómicamente `PENDING` o devuelve el registro existente por `eventId`.
4. Un evento válido ejecuta `GenerateSettlementUseCase` de 007 y, después, `GenerateFinalInvoiceUseCase` de 006. 006 vuelve a invocar 007 internamente; la idempotencia por `stayId` devuelve la liquidación existente sin duplicarla.
5. Si `billingCustomer` falta o está incompleto, 006 produce `BillingCustomerDataMissingError`; 010 conserva la liquidación, confirma el evento y marca `PROCESSED` con la nota definida en el contrato. Un evento nuevo para la misma estancia, con los mismos datos de check-out y datos tributarios completos, reutiliza la liquidación existente y permite emitir la factura.

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

El `payload` de auditoría excluye `billingCustomer.name` y `billingCustomer.taxId`; conserva únicamente `has_billing_customer: boolean` para indicar si el evento los recibió. Los valores tributarios se usan en memoria para la cadena 007/006 y no se registran.

`registerIfAbsent(...)` crea atómicamente el registro `PENDING` o devuelve el existente. Un mensaje existente en `PENDING` reanuda el procesamiento; `PROCESSED`, `REJECTED` o `DEAD_LETTER` se confirma sin reprocesar.

Los eventos con JSON inválido o sobre no reconocible se publican persistentemente a `modulo3.checkout.dlq` por el exchange por defecto con `mandatory`; tras confirmación y sin `basic.return`, se registran con `event_id` y `payload` nulos, estado `REJECTED`, código `INVALID_CHECKOUT_EVENT` y motivo, sin guardar el cuerpo crudo, y se hace ack. Si la publicación falla, se devuelve con `basic.return` o no se confirma, se hace nack con reencolado y no se crea el registro `REJECTED`.

### Clave e idempotencia

`eventId` deduplica entregas del mismo mensaje. `stayId` UUID identifica la estancia y corresponde a la restricción `UNIQUE(stay_id)` de la liquidación de 007. Para un `eventId` nuevo, datos de check-out idénticos reutilizan la liquidación existente; datos contradictorios producen `SETTLEMENT_ALREADY_EXISTS` y conservan la original. Nunca se genera una segunda liquidación o factura por estancia.

### Errores y confirmación

| Resultado | Estado de auditoría | Mensaje |
|---|---|---|
| Éxito con factura o sin emisión por datos tributarios | `PROCESSED` | ack |
| Payload inválido | `REJECTED` después de confirmar la publicación a DLQ | Publicación persistente con `mandatory` al exchange por defecto; sin `basic.return`, registrar y hacer ack; si falla, nack con reencolado |
| Error de negocio no recuperable (`RESERVATION_NOT_FOUND`, `QUOTE_NOT_FOUND`, `MISSING_COMMISSION`, `INVALID_COMMISSION`, `SETTLEMENT_ALREADY_EXISTS`) | `DEAD_LETTER` después de confirmar la publicación a DLQ | Publicación persistente con `mandatory` al exchange por defecto; sin `basic.return`, escribir `error_code` y estado y hacer ack; si falla, conservar `PENDING` y hacer nack con reencolado |
| Dependencia transitoria (`MODULE2_UNAVAILABLE`, `VAT_RATE_UNAVAILABLE`, `DATABASE_UNAVAILABLE`) con `x-retry-count < 5` | `PENDING` | Publicar persistentemente a retry con contador incrementado y `mandatory`; sin `basic.return`, hacer ack; si falla, nack con reencolado |
| Dependencia transitoria con `x-retry-count >= 5` | `DEAD_LETTER` después de confirmar la publicación a DLQ | Publicar persistentemente a DLQ con `mandatory`; sin `basic.return`, conservar el último `error_code`, escribir estado y hacer ack; si falla, conservar `PENDING` y hacer nack con reencolado |
| `FINAL_SETTLEMENT_NOT_FOUND` o error no tipado | `DEAD_LETTER` después de confirmar la publicación a DLQ | Publicar persistentemente a DLQ con `mandatory`; registrar `UNEXPECTED_ERROR` en `error_code` para error no tipado; sin `basic.return`, escribir estado y hacer ack; si falla, conservar `PENDING` y hacer nack con reencolado |
| Duplicado en estado final (`PROCESSED`, `REJECTED`, `DEAD_LETTER`) | Sin cambio | ack inmediato |

Las fallas transitorias con `x-retry-count` menor que 5 se publican persistentemente a `modulo3.checkout.retry.30s` mediante el exchange por defecto, con el contador incrementado, `mandatory` activado y confirmación del broker antes del ack del original. La cola retry es durable, no tiene binding a `hospitua.events` y usa `x-message-ttl: 30000`, `x-dead-letter-exchange: ""` y `x-dead-letter-routing-key: modulo3.checkout`. Si `x-retry-count` está ausente, se interpreta como 0. El broker puede agregar `x-death` al devolver el mensaje por TTL, pero `x-death` no determina el límite de reintentos. Cuando el contador es 5, el siguiente fallo publica persistentemente a `modulo3.checkout.dlq` mediante el exchange por defecto con `mandatory`; tras confirmación y ausencia de `basic.return`, se conserva el último código y se registra `DEAD_LETTER`. Los errores terminales y payloads inválidos se publican persistentemente a la DLQ mediante el exchange por defecto con `mandatory`. La DLQ es durable y no tiene binding a `hospitua.events`; no se declara `hospitua.events.dlx`. Una publicación devuelta con `basic.return` o no confirmada se trata como fallida y causa nack con reencolado del mensaje original. La recuperación manual publica el mensaje a `modulo3.checkout` mediante el exchange por defecto.

La lista de códigos de auditoría y acciones se define en [EVENT-habitacion-checkout.md](contracts/EVENT-habitacion-checkout.md). `INVALID_CHECKOUT_EVENT` es código de auditoría y no un error HTTP.

### Consistencia con Consultar liquidación

El procesamiento del evento es asíncrono. Módulo 1 consulta normalmente antes de confirmar el check-out y no necesita volver a consultar después del evento. Si cualquier consulta coincide con el procesamiento, recibir el evento no implica que la liquidación final esté disponible de inmediato en `GET /api/settlements`: se devuelve la informativa antes de persistir la final o la final después, nunca un estado intermedio.

## Fases y tareas

### Setup

- [ ] **T001** Crear el módulo `checkout-ingestion`, el consumer y la estructura de auditoría.

### Foundational

- [ ] **T002** Definir `CheckoutEventLog`, sus estados y `CheckoutEventLogRepositoryPort`. Agregar el modelo `CheckoutEventLog` a `prisma/schema.prisma` con la migración correspondiente y `UNIQUE` parcial sobre `event_id`.
- [ ] **T003** Implementar `registerIfAbsent(...)` con deduplicación atómica por `eventId`.
- [ ] **T004** Configurar la topología RabbitMQ y el manejo de ack manual conforme al Plan Base. Declarar `modulo3.checkout.retry.30s` durable, sin binding a `hospitua.events`, con `x-message-ttl: 30000`, `x-dead-letter-exchange: ""` y `x-dead-letter-routing-key: modulo3.checkout`; declarar `modulo3.checkout.dlq` durable y sin binding a `hospitua.events`; no declarar `hospitua.events.dlx`; mantener la cola principal sin argumentos nuevos. Configurar publicaciones persistentes por el exchange por defecto con `mandatory` activado; hacer ack del original solo tras publisher confirm y ausencia de `basic.return`, y hacer nack con reencolado si la publicación falla, es devuelta o no se confirma.

### User Story 1 — Procesar check-out

**Pruebas primero**

- [ ] **T005** Pruebas unitarias de validación del sobre, lista blanca y fechas; validar `occurredAt` con `Z` y `-05:00`, y rechazar valores sin offset o con formato inválido.
- [ ] **T006** Pruebas unitarias de orquestación: generación de liquidación y factura, datos tributarios incompletos, reuso idempotente y contradicción de estancia.
- [ ] **T007** Pruebas de integración con Testcontainers para PostgreSQL y RabbitMQ: auditoría atómica, deduplicación, ack, nack terminal, `DATABASE_UNAVAILABLE`, `FINAL_SETTLEMENT_NOT_FOUND` y `UNEXPECTED_ERROR`. Verificar publicaciones persistentes a retry y DLQ con `mandatory`, publisher confirm y `basic.return`; una publicación devuelta, fallida o no confirmada debe causar nack con reencolado del original.
- [ ] **T008** Contract test del evento, campos de lista blanca, ejemplos y matriz de resultados del contrato; aceptar ambos formatos de `occurredAt` (`Z` y offset `-05:00`).
- [ ] **T009** Pruebas e2e del flujo de check-out completo y del flujo sin factura por datos tributarios incompletos.

**Implementación**

- [ ] **T010** Implementar validación del `EventEnvelope` y reconstrucción de payload por lista blanca.
- [ ] **T011** Implementar el registro inicial y transiciones de auditoría mediante `registerIfAbsent(...)`.
- [ ] **T012** Implementar `RegisterCheckoutService` (puerto `RegisterCheckoutUseCase`) con la secuencia 007 y 006, incluyendo la respuesta normal sin emisión de factura.
- [ ] **T013** Implementar el consumer adaptador con ack/nack según el resultado tipado. Publicar directamente a retry o DLQ por el exchange por defecto, con `mandatory` y mensajes persistentes; conservar cuerpo y headers e incrementar `x-retry-count` para retry. Hacer ack solo tras publisher confirm y ausencia de `basic.return`; ante fallo, devolución o falta de confirmación, hacer nack con reencolado.

### Polish

- [ ] **T014** Documentar la recuperación manual desde DLQ: corregir la causa, cambiar `DEAD_LETTER` a `PENDING` y mover el mensaje a la cola principal. Publicarlo a `modulo3.checkout` mediante el exchange por defecto, con `mandatory`, y esperar confirmación y ausencia de `basic.return` antes de finalizar la recuperación.
- [ ] **T015** Verificar privacidad: `checkout_event_log.payload` no contiene `billingCustomer.name` ni `billingCustomer.taxId` y conserva solamente `has_billing_customer`; comprobar además la unicidad por estancia y ausencia de duplicados.
- [ ] **T016** Probar la cola `modulo3.checkout.retry.30s`, su TTL de 30 s y la reentrega con `x-death` para fallas transitorias. Verificar que eventos nuevos de `hospitua.events` no llegan a retry; que al vencer el TTL el mensaje vuelve solo a `modulo3.checkout`; que `x-retry-count` gobierna el límite y `x-death` no lo determina; y que las publicaciones directas persistentes usan `mandatory`, publisher confirm y manejo de `basic.return`.
- [ ] **T017** Probar el límite de 5 reentregas y que el fallo siguiente preserve el último código en auditoría y enrute el evento a DLQ. Verificar que cada publicación a retry incrementa `x-retry-count`; al llegar a 5, la falla siguiente publica a DLQ, registra `DEAD_LETTER` y conserva el último `error_code` solo después de confirmación; si la publicación falla, se conserva `PENDING` y se hace nack con reencolado.

## Dependencies & Execution Order

`T001` precede a `T002`–`T004`. Las pruebas `T005`–`T009` preceden a la implementación `T010`–`T013`. La recuperación manual se documenta en `T014`; `T015`–`T017` cierran las verificaciones de privacidad y reentregas. `RegisterCheckoutService` requiere las exportaciones de 007 y 006.

## Notes

La lista blanca excluye datos migratorios y el cuerpo crudo. `stayId` es obligatorio para procesar la estancia y la liquidación; el consumer no deriva este identificador de otros datos.
