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
**Constraints**: `stayId` UUID obligatorio e idempotencia por estancia; lista blanca sin valores de `billingCustomer`; `GenerateSettlementUseCase` precede a `GenerateFinalInvoiceUseCase`; errores terminales a DLQ y fallas transitorias con hasta 5 reentregas separadas por 30 s.
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
| `occurred_at` | timestamptz nullable | Fecha de emisión reconocida. |
| `payload` | jsonb nullable | Campos de lista blanca y el indicador `has_billing_customer`; nunca guarda `billingCustomer`; nulo si no se reconoce el sobre. |
| `stay_id` | UUID nullable | Identificador de estancia reconocido. |
| `status` | string | `PENDING`, `PROCESSED`, `REJECTED` o `DEAD_LETTER`. |
| `error_code` | string nullable | Código de resultado o rechazo. |
| `reason` | string nullable | Motivo registrado. |
| `result_note` | string nullable | Nota del resultado de procesamiento. |
| `processed_at` | timestamptz nullable | Momento de cierre del procesamiento. |
| `created_at` | timestamptz | Momento de registro. |

El `payload` de auditoría excluye `billingCustomer.name` y `billingCustomer.taxId`; conserva únicamente `has_billing_customer: boolean` para indicar si el evento los recibió. Los valores tributarios se usan en memoria para la cadena 007/006 y no se registran.

`registerIfAbsent(...)` crea atómicamente el registro `PENDING` o devuelve el existente. Un mensaje existente en `PENDING` reanuda el procesamiento; `PROCESSED`, `REJECTED` o `DEAD_LETTER` se confirma sin reprocesar. Los eventos con JSON inválido o sobre no reconocible se registran con `event_id` y `payload` nulos, estado `REJECTED`, código `INVALID_CHECKOUT_EVENT` y motivo.

### Clave e idempotencia

`eventId` deduplica entregas del mismo mensaje. `stayId` UUID identifica la estancia y corresponde a la restricción `UNIQUE(stay_id)` de la liquidación de 007. Para un `eventId` nuevo, datos de check-out idénticos reutilizan la liquidación existente; datos contradictorios producen `SETTLEMENT_ALREADY_EXISTS` y conservan la original. Nunca se genera una segunda liquidación o factura por estancia.

### Errores y confirmación

| Resultado | Estado de auditoría | Mensaje |
|---|---|---|
| Éxito con factura o sin emisión por datos tributarios | `PROCESSED` | ack |
| Payload inválido | `REJECTED` | nack sin reencolar a DLQ |
| Error de negocio no recuperable (`RESERVATION_NOT_FOUND`, `QUOTE_NOT_FOUND`, `MISSING_COMMISSION`, `INVALID_COMMISSION`, `SETTLEMENT_ALREADY_EXISTS`) | `DEAD_LETTER` | nack sin reencolar a DLQ |
| Dependencia transitoria (`MODULE2_UNAVAILABLE`, `VAT_RATE_UNAVAILABLE`, `DATABASE_UNAVAILABLE`) | `PENDING` | nack con reencolado diferido; máximo 5 reentregas cada 30 s |
| `FINAL_SETTLEMENT_NOT_FOUND` | `DEAD_LETTER` | nack sin reencolar a DLQ |
| Error no tipado | `DEAD_LETTER`, `UNEXPECTED_ERROR` | nack sin reencolar a DLQ |
| Duplicado en estado final (`PROCESSED`, `REJECTED`, `DEAD_LETTER`) | Sin cambio | ack inmediato |

Las fallas transitorias se envían a `modulo3.checkout.retry.30s`, cola con TTL de 30 s vinculada al exchange `hospitua.events` y a la routing key `habitacion.checkout`; el vencimiento devuelve el evento a `modulo3.checkout`. El metadato `x-death` del broker cuenta las reentregas. Tras 5 reentregas, el siguiente fallo deja el registro en `DEAD_LETTER` con el código del último error y enruta el mensaje a `modulo3.checkout.dlq`.

La lista de códigos de auditoría y acciones se define en [EVENT-habitacion-checkout.md](contracts/EVENT-habitacion-checkout.md). `INVALID_CHECKOUT_EVENT` es código de auditoría y no un error HTTP.

### Consistencia con Consultar liquidación

El procesamiento del evento es asíncrono. Módulo 1 consulta normalmente antes de confirmar el check-out y no necesita volver a consultar después del evento. Si cualquier consulta coincide con el procesamiento, recibir el evento no implica que la liquidación final esté disponible de inmediato en `GET /api/settlements`: se devuelve la informativa antes de persistir la final o la final después, nunca un estado intermedio.

## Fases y tareas

### Setup

- [ ] **T001** Crear el módulo `checkout-ingestion`, el consumer y la estructura de auditoría.

### Foundational

- [ ] **T002** Definir `CheckoutEventLog`, sus estados y `CheckoutEventLogRepositoryPort`. Agregar el modelo `CheckoutEventLog` a `prisma/schema.prisma` con la migración correspondiente y `UNIQUE` parcial sobre `event_id`.
- [ ] **T003** Implementar `registerIfAbsent(...)` con deduplicación atómica por `eventId`.
- [ ] **T004** Configurar la topología RabbitMQ y el manejo de ack manual conforme al Plan Base.

### User Story 1 — Procesar check-out

**Pruebas primero**

- [ ] **T005** Pruebas unitarias de validación del sobre, lista blanca y fechas.
- [ ] **T006** Pruebas unitarias de orquestación: generación de liquidación y factura, datos tributarios incompletos, reuso idempotente y contradicción de estancia.
- [ ] **T007** Pruebas de integración con Testcontainers para PostgreSQL y RabbitMQ: auditoría atómica, deduplicación, ack, nack terminal, `DATABASE_UNAVAILABLE`, `FINAL_SETTLEMENT_NOT_FOUND` y `UNEXPECTED_ERROR`.
- [ ] **T008** Contract test del evento, campos de lista blanca, ejemplos y matriz de resultados del contrato.
- [ ] **T009** Pruebas e2e del flujo de check-out completo y del flujo sin factura por datos tributarios incompletos.

**Implementación**

- [ ] **T010** Implementar validación del `EventEnvelope` y reconstrucción de payload por lista blanca.
- [ ] **T011** Implementar el registro inicial y transiciones de auditoría mediante `registerIfAbsent(...)`.
- [ ] **T012** Implementar `RegisterCheckoutService` (puerto `RegisterCheckoutUseCase`) con la secuencia 007 y 006, incluyendo la respuesta normal sin emisión de factura.
- [ ] **T013** Implementar el consumer adaptador con ack/nack según el resultado tipado.

### Polish

- [ ] **T014** Documentar la recuperación manual desde DLQ: corregir la causa, cambiar `DEAD_LETTER` a `PENDING` y mover el mensaje a la cola principal.
- [ ] **T015** Verificar privacidad: `checkout_event_log.payload` no contiene `billingCustomer.name` ni `billingCustomer.taxId` y conserva solamente `has_billing_customer`; comprobar además la unicidad por estancia y ausencia de duplicados.
- [ ] **T016** Probar la cola `modulo3.checkout.retry.30s`, su TTL de 30 s y la reentrega con `x-death` para fallas transitorias.
- [ ] **T017** Probar el límite de 5 reentregas y que el fallo siguiente preserve el último código en auditoría y enrute el evento a DLQ.

## Dependencies & Execution Order

`T001` precede a `T002`–`T004`. Las pruebas `T005`–`T009` preceden a la implementación `T010`–`T013`. La recuperación manual se documenta en `T014`; `T015`–`T017` cierran las verificaciones de privacidad y reentregas. `RegisterCheckoutService` requiere las exportaciones de 007 y 006.

## Notes

La lista blanca excluye datos migratorios y el cuerpo crudo. `stayId` es obligatorio para procesar la estancia y la liquidación; el consumer no deriva este identificador de otros datos.
