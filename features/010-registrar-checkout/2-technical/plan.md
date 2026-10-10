# Implementation Plan: Registrar Check-out

**Date**: 2026-10-08
**Spec**: [registrar_checkout.md](../1-functional/registrar_checkout.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Contrato consumido**: [EVENT-habitacion-checkout.md](contracts/EVENT-habitacion-checkout.md)

---

## Summary

`Registrar Check-out` es el único punto de entrada asíncrono y proactivo que dispara el procesamiento financiero de una estancia física en el Módulo 3 [BR-001; BASE]. Pertenece al *bounded context* `checkout-ingestion`. No expone endpoints HTTP; consume mensajes del broker RabbitMQ publicados por `Módulo 1` mediante `@nestjs/microservices` (`Transport.RMQ`) [FR-001; BASE].

Enfoque técnico y separación arquitectónica:
- El adaptador de transporte `CheckoutRegisteredConsumer` recibe el mensaje AMQP, extrae el sobre y el header `x-retry-count`, construye el comando de aplicación `RegisterCheckoutCommand` (sin `rawMessage` ni dependencias AMQP) y delega en el puerto primario `RegisterCheckoutUseCase` (definido con la interfaz pura de dominio `RegisterCheckoutInput`).
- El servicio de aplicación `RegisterCheckoutService` actúa como **único responsable** de:
  1. Registrar y actualizar `checkout_event_log` mediante persistencia atómica (`upsertInitial`) evitando condiciones de carrera con la restricción UNIQUE.
  2. Decidir las transiciones de estado del evento (`PENDING`, `RETRYING`, `PROCESSED`, `REJECTED`, `DEAD_LETTER`).
  3. Determinar si un fallo es transitorio o irrecuperable.
  4. Mantener el requisito funcional FR-008. La documentación disponible no define un contrato receptor para implementar su transporte.
- La reconstrucción del evento se realiza estrictamente a partir de una **lista blanca** de campos autorizados (descartando de raíz cualquier dato migratorio, pasaporte, visa, nacionalidad o SIRE, y sin persistir jamás el cuerpo crudo completo ni ante mensajes malformados) [FR-006, NFR-003, NFR-004].
- La idempotencia a nivel de mensaje (`eventId`) cubre exhaustivamente todos los estados ante reentregas:
  1. `PROCESSED`: reconocimiento inmediato (`channel.ack`) sin reprocesar.
  2. `PENDING`: reutiliza el registro existente y continúa el procesamiento sin intentar insertar otra fila ni colisionar.
  3. `RETRYING`: reutiliza el registro existente y reanuda el procesamiento sin crear otro registro ni duplicar el evento.
  4. `REJECTED`: reconocimiento inmediato (`channel.ack`) sin volver a procesarlo automáticamente.
  5. `DEAD_LETTER`: reconocimiento inmediato (`channel.ack`) sin reprocesarlo de forma ordinaria (la recuperación se gestiona exclusivamente por el mecanismo manual de la DLQ en T023).
- Para mensajes con sobre malformado (cuando `eventId` no es UUID válido o datos obligatorios faltan), se almacena el identificador textual recibido en `received_event_id` con `event_id` nulo (índice único parcial `WHERE event_id IS NOT NULL`), registrando el rechazo seguro (`REJECTED`). FR-008 exige informar a M1 el dato rechazado, pero no hay transporte receptor definido.
- El caso de uso valida el payload mínimo (`reservationRef` como string opaco, `roomId`, `categoryRoom` adoptando `DOBLE` en esta iteración, `checkInDate < checkOutDate`, y `stayId` obligatorio UUID del evento según Plan Base, requerido para procesar conforme a Plan Base y Feature 007 bajo la restricción `UNIQUE(stay_id)`), incluye obligatoriamente (`<<include>>`) a `GenerateSettlementUseCase` (feature 007) [FR-004, BR-002; BASE] y encadena a continuación `GenerateFinalInvoiceUseCase` (feature 006) [BASE; SPEC 006].
- Tratamiento de factura conforme a Feature 006: si faltan datos fiscales (`BILLING_CUSTOMER_DATA_MISSING`), la liquidación `Final` queda persistida, no se emite ni numera factura y el resultado consultable puede tener `invoice: null`. Los errores transitorios documentados de dependencia siguen la política técnica vigente de reintentos.

---

## Technical Context

- **Language/Version**: TypeScript 5.x sobre Node.js 20 LTS (según proyecto base)
- **Primary Dependencies**: NestJS 10.x, `@nestjs/microservices` (`Transport.RMQ`), Prisma ORM, `class-validator` / `class-transformer`
- **Storage**: PostgreSQL 16 — dueño de la tabla `checkout_event_log` (`id uuid PK`, `event_id uuid` nullable con índice único parcial `WHERE event_id IS NOT NULL`, `received_event_id text` nullable, columnas individuales nulables y `payload jsonb` por lista blanca estricta); no persiste liquidaciones ni facturas directamente (delega en `settlement` y `billing`)
- **Messaging**: RabbitMQ — Exchange `hospitua.events` (Topic) [BASE]. M3 es dueña exclusiva de la declaración de su topología (`modulo3.checkout`, DLX `hospitua.events.dlx`, DLQ `modulo3.checkout.dlq` y colas de retry con TTL `modulo3.checkout.retry.5s`, `.15s`, `.45s`) para evitar `PRECONDITION_FAILED`. Compatibilidad de transporte resuelta internamente en M3 mediante deserializador personalizado (`RmqRecordDeserializer`) o consumidor desacoplado con `amqplib` para recibir el `EventEnvelope` plano de Spring AMQP sin imponer cambios a Módulo 1 [BASE]
- **Testing**:
  - Jest para pruebas unitarias de validación de eventos, DTOs (lista blanca, `categoryRoom`), y lógica de orquestación del servicio con puertos mockeados
  - Jest + Testcontainers (PostgreSQL y RabbitMQ reales) para pruebas de integración del consumidor y repositorios
  - Contract testing del mensaje `habitacion.checkout` (esquema propuesto por M3)
  - Tests E2E del flujo asíncrono completo evento → liquidación → factura
- **Target Platform**: Servicio backend Linux en contenedor Docker (red interna Docker Compose)
- **Project Type**: Servicio backend único (monolito modular hexagonal) — componente de ingestión por mensajería
- **Performance Goals**: Tiempo de procesamiento adecuado que permita una interacción fluida en el flujo operativo de recepción de Módulo 1 [NFR-002] (sin objetivo numérico en la spec)
- **Constraints**:
  - Idempotencia absoluta ante reenvíos del mismo mensaje de RabbitMQ (`eventId` cubriendo exhaustivamente los estados `PENDING`, `RETRYING`, `PROCESSED`, `REJECTED`, `DEAD_LETTER` con upsert atómico concurrente) y de la estancia física (`stayId` con `UNIQUE(stay_id)` en `settlement`) [BASE, 007, BR-004, NFR-001, SC-005]
  - Ack manual (`noAck: false`): nunca perder un evento ante caídas a mitad de ejecución [BASE]
  - Aislamiento de privacidad: reconstrucción estricta por lista blanca; 0% de almacenamiento o exposición de datos migratorios (SIRE), pasaporte, nacionalidad o visa en BD o logs [FR-006, NFR-003, SC-004]
  - Separación de responsabilidades: Módulo 3 no decide nada financiero en este caso de uso ni modifica disponibilidad de inventario físico [FR-007, BR-002]
- **Scale/Scope**: 1 historia de usuario (HU1), 1 consumidor RabbitMQ, 1 caso de uso (`RegisterCheckoutUseCase`), 1 tabla de auditoría (`checkout_event_log`)

---

## Project Structure

### Documentation (this feature)

```text
features/010-registrar-checkout/
├── 1-functional/
│   └── registrar_checkout.md              # Spec funcional (fuente de verdad de negocio)
└── 2-technical/
    ├── contracts/
    │   └── EVENT-habitacion-checkout.md   # Contrato detallado del mensaje RabbitMQ
    └── plan.md                            # Este archivo
```

### Source Code (repository root)

Archivos creados o modificados por esta feature dentro de la arquitectura hexagonal (`checkout-ingestion` como subcarpeta de cada capa):

```text
src/
├── domain/
│   ├── model/
│   │   ├── shared/
│   │   │   ├── date-range.vo.ts                   # (reutilizado) validación checkInDate < checkOutDate
│   │   │   └── channel.vo.ts                      # (reutilizado)
│   │   └── checkout-ingestion/
│   │       ├── checkout-event.ts                  # Entidad de dominio con el payload validado por whitelist
│   │       ├── checkout-event-log.ts              # Entidad de trazabilidad y auditoría (con receivedEventId)
│   │       └── checkout-status.enum.ts            # PENDING | PROCESSED | REJECTED | RETRYING | DEAD_LETTER
│   ├── errors/
│   │   ├── invalid-checkout-event.error.ts        # Faltan datos obligatorios, fechas inválidas o sobre corrupto
│   │   ├── checkout-non-recoverable.error.ts      # Errores irrecuperables de negocio (404 M2, comisión, liquidación contradictoria)
│   │   └── checkout-transient.error.ts            # Fallas temporales de comunicación externa (MODULE2_UNAVAILABLE, VAT_RATE_UNAVAILABLE)
│   └── ports/
│       ├── in/
│       │   └── register-checkout.use-case.ts      # Puerto primario: RegisterCheckoutUseCase e interfaz pura RegisterCheckoutInput
│   │   └── out/
│   │       ├── checkout-event-log.repository.port.ts # Puerto secundario: persistencia y upsertInitial del log

│
├── application/
│   ├── services/
│   │   └── checkout-ingestion/
│   │       └── register-checkout.service.ts       # Único dueño: orquesta log, validación, 007 y 006
│   └── dto/
│       └── checkout-ingestion/
│           ├── register-checkout.command.ts       # Comando de aplicación (implementa RegisterCheckoutInput, sin dependencias AMQP)
│           └── checkout-event-envelope.dto.ts     # DTO de transporte para EventEnvelope<T>
│
└── infrastructure/
    ├── adapters/
    │   ├── in/
    │   │   └── messaging/
    │   │       ├── checkout-registered.consumer.ts # Consumer AMQP (traductor a UseCase)
    │   │       └── dto/
    │   │           └── checkout-payload.dto.ts    # Whitelist estricta con categoryRoom y class-validator
    │   └── out/
    │       ├── messaging/

    │       └── persistence/
    │           ├── mappers/
    │           │   └── checkout-event-log.mapper.ts # Dominio <-> modelo Prisma
    │           └── repositories/
    │               └── prisma-checkout-event-log.repository.ts # Implementa CheckoutEventLogRepositoryPort (con upsert atómico)
    └── config/
        ├── rabbitmq.config.ts                     # Configuración exchange, colas, DLX, DLQ y colas de retry (propiedad M3)
        └── checkout-ingestion.module.ts           # Inyección de dependencias y registro del consumer

prisma/
├── schema.prisma                                  # Modelo CheckoutEventLog (received_event_id, event_id nullable con índice único parcial)
└── migrations/
    └── <timestamp>_create_checkout_event_log/
        └── migration.sql

test/
├── unit/
│   ├── domain/checkout-ingestion/
│   │   └── checkout-event.spec.ts                 # Validación de fechas, whitelist estricta y omisión de SIRE/pasaporte
│   └── application/checkout-ingestion/
│       └── register-checkout.service.spec.ts      # Flujo de orquestación, idempotencia, reintentos diferidos y errores tipados
├── integration/
│   ├── messaging/
│   │   └── checkout-registered.consumer.spec.ts   # Consumer real con RabbitMQ Testcontainer (ack, retry diferido, DLQ)
│   └── persistence/checkout-ingestion/
│       └── prisma-checkout-event-log.repository.spec.ts # Persistencia en Postgres Testcontainer (upsert, índices y estados)
├── contract/
│   └── messaging/
│       └── checkout-event.contract.spec.ts        # Validación de estructura del sobre y payload propuesto por M3
└── e2e/
    └── checkout-flow.e2e-spec.ts                  # Mensaje RabbitMQ -> Liquidación en Postgres -> Factura
```

**Structure Decision**: El comando de aplicación `RegisterCheckoutCommand` se ubica en `src/application/dto/checkout-ingestion/register-checkout.command.ts` e implementa la interfaz pura de dominio `RegisterCheckoutInput` definida en el puerto primario `src/domain/ports/in/register-checkout.use-case.ts`. Esto elimina cualquier dependencia incorrecta desde `domain/ports/in` hacia la capa de aplicación o infraestructura, aislando por completo al dominio de librerías y conceptos AMQP (`rawMessage` eliminado). Se define **un único responsable** del ciclo de vida del evento: el servicio `RegisterCheckoutService` administra la persistencia del log, la invocación subordinada a 007 y 006, el registro del resultado del procesamiento; FR-008 conserva la obligación funcional de informar el rechazo, sin contrato receptor definido y decide las transiciones de estado y errores tipados. El adaptador de entrada `CheckoutRegisteredConsumer` se limita exclusivamente a traducir el transporte AMQP, extraer headers como `x-retry-count`, invocar al caso de uso y ejecutar las acciones de transporte (`ack`, `nack` a DLQ o publicación diferida a colas de reintento). La compatibilidad entre el sobre plano emitido por M1 y NestJS se resuelve internamente en M3 mediante un deserializador personalizado, sin alterar los contratos externos.

---

## Diseño Técnico

### 1. Consumer RabbitMQ con `@nestjs/microservices` y Compatibilidad de Transporte

Por defecto, `@nestjs/microservices` con `Transport.RMQ` espera mensajes en formato `{ pattern: string, data: any }`. En contraste, el publicador Spring AMQP de `Módulo 1` emite el sobre plano `EventEnvelope` directamente en el cuerpo del mensaje (sin propiedad `pattern`). Para garantizar la interoperabilidad sin forzar cambios en el publicador de M1, Módulo 3 resuelve la deserialización de forma interna mediante un deserializador personalizado (`RmqRecordDeserializer`) o un consumidor desacoplado sobre `amqplib`, mapeando la routing key `habitacion.checkout` directamente al sobre `EventEnvelope`.

El consumidor actúa estrictamente como **adaptador de transporte** (no inyecta repositorios de base de datos). Su única responsabilidad es traducir el mensaje AMQP, invocar al caso de uso y traducir los resultados o excepciones tipadas a confirmaciones o desvíos:

```ts
@Controller()
export class CheckoutRegisteredConsumer {
  constructor(
    @Inject(REGISTER_CHECKOUT_USE_CASE)
    private readonly registerCheckoutUseCase: RegisterCheckoutUseCase,
  ) {}

  @EventPattern('habitacion.checkout')
  public async handleCheckoutEvent(
    @Payload() envelope: EventEnvelope<CheckoutPayloadDto>,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    const retryCount = (originalMsg.properties.headers?.['x-retry-count'] as number) || 0;
    const receivedEventId = typeof envelope?.eventId === 'string' ? envelope.eventId : undefined;

    try {
      await this.registerCheckoutUseCase.execute({
        eventId: envelope?.eventId,
        receivedEventId,
        eventType: envelope?.eventType,
        occurredAt: envelope?.occurredAt,
        sourceModule: envelope?.sourceModule,
        payload: envelope?.payload,
        retryCount,
      });
      channel.ack(originalMsg);
    } catch (error) {
      if (error instanceof InvalidCheckoutEventError || error instanceof CheckoutNonRecoverableError) {
        // Error no recuperable o reintentos agotados: el caso de uso ya actualizó el log y notificó a M1
        channel.nack(originalMsg, false, false); // Envío directo a DLQ
      } else if (error instanceof CheckoutTransientError) {
        // Error transitorio con reintentos disponibles: el caso de uso ya actualizó el log a RETRYING
        await this.handleTransientRetry(originalMsg, channel, error.nextRetryCount);
      } else {
        channel.nack(originalMsg, false, false);
      }
    }
  }

  private async handleTransientRetry(msg: Message, channel: Channel, nextRetryCount: number): Promise<void> {
    const nextQueue = `modulo3.checkout.retry.${nextRetryCount === 1 ? '5s' : nextRetryCount === 2 ? '15s' : '45s'}`;
    channel.sendToQueue(nextQueue, msg.content, {
      headers: { ...msg.properties.headers, 'x-retry-count': nextRetryCount },
      persistent: true,
    });
    channel.ack(msg); // Libera la cola principal y evita bucles calientes
  }
}
```

---

### 2. Validación del Payload, Lista Blanca y Sanitización de Privacidad

La privacidad y sanitización se gobiernan estrictamente mediante una **LISTA BLANCA** [FR-006, NFR-003]:
- **Reconstrucción estricta por Whitelist**: Tanto el payload almacenado en `checkout_event_log` como el transferido al dominio se reconstruyen **únicamente** con las claves declaradas:
  - Claves de sobre: `eventId` (o `receivedEventId`), `eventType`, `occurredAt`, `sourceModule`.
  - Claves de payload: `reservationRef`, `roomId`, `categoryRoom`, `checkInDate`, `checkOutDate`, `stayId`, `billingCustomer.name`, `billingCustomer.taxId`.
  - **Nunca se persiste el cuerpo crudo**, ni siquiera cuando el payload llega corrupto o con campos inválidos. Cualquier campo migratorio, tipo de visa, documento o archivo SIRE es ignorado en el filtrado inicial y jamás llega a la base de datos ni a los logs de aplicación [FR-006, NFR-003, SC-004].
- **Campo Contractual `categoryRoom`**:
  - El nombre contractual definitivo es `categoryRoom`.
  - **Valor adoptado**: Para esta iteración se define contractualmente el valor `DOBLE`. Debe coincidir exactamente con el `roomType` de la cotización asociada en Feature 007 / Módulo 2; de lo contrario, Feature 007 arrojará `QuoteNotFoundError` (`QUOTE_NOT_FOUND`) → DLQ [BASE, 007].
- **Formato de `reservationRef`**:
  - Es un string opaco alfanumérico (ej. `RES-000123`). No se valida como UUID.
- **Validaciones de Dominio en `CheckoutEvent.create(...)`** [FR-002, FR-003, BR-003]:
  - `reservationRef`: string no vacío (3-64 caracteres).
  - `roomId`: UUID válido.
  - `categoryRoom`: string no vacío (valor contractual `DOBLE`).
  - `checkInDate` y `checkOutDate`: fechas válidas `YYYY-MM-DD`.
  - `checkInDate < checkOutDate`: validado mediante el VO `DateRange`. Si `checkInDate >= checkOutDate`, lanza `InvalidCheckoutEventError` [FR-003]. Estancias de una noche (`checkOutDate = checkInDate + 1 día`) son válidas.

---

### 3. Modelo de Persistencia: `checkout_event_log`

Para permitir auditar tanto eventos válidos como eventos rechazados con datos incompletos o sobre malformado, la tabla almacena el payload reconstruido por lista blanca y gestiona la nulabilidad de los campos:

| Columna | Tipo | Restricción | Propósito |
|---|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` | ID interno de auditoría generado por M3 |
| `event_id` | uuid | NULLABLE, `UNIQUE` parcial (`WHERE event_id IS NOT NULL`) | Identificador del evento (null si el sobre no traía UUID válido) |
| `received_event_id` | text | NULLABLE | Cadena textual original recibida en el sobre (sea o no UUID) |
| `event_type` | text | NOT NULL | Tipo de evento (`CHECK_OUT`) |
| `occurred_at` | timestamptz | NOT NULL | Marca de tiempo de emisión en Módulo 1 |
| `payload` | jsonb | NOT NULL | Payload reconstruido exclusivamente con la lista blanca (sin datos crudos ni SIRE) |
| `reservation_ref` | text | NULLABLE | Referencia opaca de reserva (null si el payload vino roto) |
| `room_id` | uuid | NULLABLE | Habitación física (null si vino roto) |
| `category_room` | text | NULLABLE | Categoría de habitación validada (`DOBLE`) |
| `stay_id` | uuid | NULLABLE | ID de estancia física requerido para procesar; nullable en tabla únicamente para permitir auditar eventos rechazados que vengan sin identificador |
| `check_in_date` | date | NULLABLE | Fecha de entrada |
| `check_out_date` | date | NULLABLE | Fecha de salida |
| `status` | text | NOT NULL | `PENDING` \| `PROCESSED` \| `REJECTED` \| `RETRYING` \| `DEAD_LETTER` |
| `error_code` | text | NULLABLE | Código de error si falló |
| `rejection_reason` | text | NULLABLE | Motivo legible del rechazo |
| `retry_count` | integer | NOT NULL, default 0 | Número de reintentos acumulados |
| `processed_at` | timestamptz | NULLABLE | Momento de finalización |
| `created_at` | timestamptz | NOT NULL, default `now()` | Momento de recepción del evento |

---

### 4. Puertos

```ts
// src/domain/ports/in/register-checkout.use-case.ts
export interface RegisterCheckoutInput {
  readonly eventId?: string | null;
  readonly receivedEventId?: string;
  readonly eventType?: string;
  readonly occurredAt?: Date | string;
  readonly sourceModule?: string;
  readonly payload?: {
    readonly reservationRef?: string;
    readonly roomId?: string;
    readonly categoryRoom?: string;
    readonly checkInDate?: string;
    readonly checkOutDate?: string;
    readonly stayId?: string;
    readonly billingCustomer?: {
      readonly name?: string;
      readonly taxId?: string;
    };
    readonly [key: string]: unknown; // para permitir filtrado estricto por lista blanca en el caso de uso
  };
  readonly retryCount?: number;
}

export const REGISTER_CHECKOUT_USE_CASE = Symbol('REGISTER_CHECKOUT_USE_CASE');

export interface RegisterCheckoutUseCase {
  execute(command: RegisterCheckoutInput): Promise<void>;
}

// src/application/dto/checkout-ingestion/register-checkout.command.ts
export class RegisterCheckoutCommand implements RegisterCheckoutInput {
  constructor(
    public readonly eventId: string | null | undefined,
    public readonly receivedEventId: string | undefined,
    public readonly eventType: string | undefined,
    public readonly occurredAt: Date | string | undefined,
    public readonly sourceModule: string | undefined,
    public readonly payload: Record<string, unknown> | undefined,
    public readonly retryCount: number = 0,
  ) {}
}

// src/domain/ports/out/checkout-event-log.repository.port.ts
export const CHECKOUT_EVENT_LOG_REPOSITORY_PORT = Symbol('CHECKOUT_EVENT_LOG_REPOSITORY_PORT');

export interface CheckoutEventLogRepositoryPort {
  findByEventId(eventId: string): Promise<CheckoutEventLog | null>;

  // Método atómico que crea la fila PENDING o recupera la existente bajo concurrencia,
  // evitando condiciones de carrera y colisiones de la restricción UNIQUE(event_id) parcial
  upsertInitial(data: {
    receivedEventId?: string;
    eventId?: string | null;
    eventType: string;
    occurredAt: Date;
    payload: Record<string, unknown>;
    reservationRef?: string;
    roomId?: string;
    categoryRoom?: string;
    checkInDate?: Date;
    checkOutDate?: Date;
    stayId?: string;
  }): Promise<{ log: CheckoutEventLog; isNew: boolean }>;

  updateStatus(
    logId: string,
    status: CheckoutStatus,
    data?: {
      errorCode?: string;
      reason?: string;
      retryCount?: number;
      processedAt?: Date;
    },
  ): Promise<void>;
}

```

### 5. Orquestación del Servicio (`RegisterCheckoutService`)

`RegisterCheckoutService` actúa como **único responsable** de la lógica de aplicación: coordina la persistencia atómica en `checkout_event_log`, decide las transiciones de estado, evalúa el carácter de los errores (recuperables vs no recuperables) y registra el resultado del rechazo; no hay contrato receptor para notificar a Módulo 1. El consumidor RabbitMQ no duplica esta lógica.

Flujo secuencial:

```
[Mensaje habitacion.checkout]
              │
              ▼
1. Idempotencia a nivel de mensaje: upsertInitial en checkout_event_log
   ├── Ya existe con PROCESSED? ──► [Retorna sin reprocesar -> Consumer emite ACK inmediato]
   ├── Ya existe con PENDING? ──► [Reutilizar registro existente y reanudar procesamiento sin insertar fila]
   ├── Ya existe con RETRYING? ──► [Reutilizar registro existente y reanudar procesamiento sin crear otro registro ni duplicar]
   ├── Ya existe con REJECTED? ──► [Retorna sin reprocesar -> Consumer emite ACK inmediato]
   ├── Ya existe con DEAD_LETTER? ──► [Retorna sin reprocesar -> Consumer emite ACK inmediato (recuperación manual en T023)]
   └── No existe? ──► [Insertar log atómicamente con status = PENDING y payload por lista blanca]
              │
              ▼
2. Validar CheckoutEvent (dominio)
   ├── Fechas inválidas (checkInDate >= checkOutDate), obligatorios faltantes o sobre malformado?
   │   ├── Actualizar log a REJECTED con error_code y rejection_reason
   │   ├── Registrar el rechazo; FR-008 exige informar a M1, sin transporte receptor documentado
   │   └── Lanzar InvalidCheckoutEventError ──► Consumer emite channel.nack(msg, false, false) a DLQ
   └── Válido? Actualizar campos normalizados en el log
              │
              ▼
3. Invocar GenerateSettlementUseCase.generate(...) (Feature 007)
   ├── Error de negocio no recuperable de 007 o conflicto de unicidad?
   │   (RESERVATION_NOT_FOUND, QUOTE_NOT_FOUND, MISSING_COMMISSION, INVALID_COMMISSION, SETTLEMENT_ALREADY_EXISTS)
   │   ├── Actualizar log a DEAD_LETTER
   │   ├── Registrar el rechazo conforme a FR-008; sin contrato receptor documentado
   │   └── Lanzar CheckoutNonRecoverableError ──► Consumer emite channel.nack(msg, false, false) a DLQ sin reintentar
   ├── Error transitorio (timeout 500ms M2 o circuit breaker abierto hacia M2 — MODULE2_UNAVAILABLE)?
   │   ├── Si retryCount < 3:
   │   │   ├── Actualizar log a RETRYING con retryCount = retryCount + 1
   │   │   └── Lanzar CheckoutTransientError(nextRetryCount) ──► Consumer publica a cola con TTL (5s, 15s, 45s) y emite ack(originalMsg)
   │   └── Si retryCount >= 3 (reintentos agotados):
   │       ├── Actualizar log a DEAD_LETTER con errorCode = 'RETRIES_EXHAUSTED'
   │       ├── Registrar el rechazo conforme a FR-008; sin contrato receptor documentado
   │       └── Lanzar CheckoutNonRecoverableError ──► Consumer emite channel.nack(msg, false, false) a DLQ
   └── Éxito (Settlement Final persistida o devuelta por idempotencia)
              │
              ▼
4. Invocar a GenerateFinalInvoiceUseCase.generate(...) (Feature 006) [BASE; SPEC 006]
   ├── Éxito: Factura emitida y guardada; log se actualiza a PROCESSED, processed_at
   ├── Falta de datos fiscales (BILLING_CUSTOMER_DATA_MISSING):
   │   └── La liquidación se conserva en estado Final; al ser un error de validación tributaria, no se asigna número de factura, log se actualiza a DEAD_LETTER, se registra el rechazo y se desvía a DLQ (nack sin requeue) [SPEC 006]. La ausencia de datos tributarios impide emitir factura; la liquidación `Final` permanece disponible con `invoice: null`.
   └── Falla transitoria al emitir factura (VAT_RATE_UNAVAILABLE al consultar IVA vigente):
       └── La liquidación ya guardada se conserva en base de datos. Se trata como error transitorio:
           ├── Si retryCount < 3: log a RETRYING con retryCount + 1, lanza CheckoutTransientError.
           │   Consumer publica en cola diferida con TTL y confirma mensaje original. Al reingresar tras TTL, 007 devuelve la liquidación
           │   existente por idempotencia (stayId) sin duplicar, y se reintenta 006.
           └── Si retryCount >= 3: log a DEAD_LETTER con errorCode = 'RETRIES_EXHAUSTED', mantiene el requisito FR-008 sin prescribir un transporte de notificación y lanza CheckoutNonRecoverableError ──► DLQ
              │
              ▼
5. Consumer emite channel.ack(msgOriginal) tras finalizar exitosamente el caso de uso
```

---

### 6. Mecanismo de Reintento Diferido y Anti-Hot-Loop

En RabbitMQ, la cola principal `modulo3.checkout` tiene configurado dead-lettering hacia la DLQ ante `nack(requeue: false)`. Por ende, un reintento transitorio **no puede hacer nack**, pues caería a la DLQ de inmediato sin reintentarse.

**Mecanismo implementado**:
1. Ante contingencias transitorias de comunicación externa (`Module2UnavailableError` hacia Módulo 2 o `VatRateUnavailableError` en Feature 006):
   - El caso de uso evalúa el `retryCount` recibido en el comando.
   - Si `retryCount < 3`:
     - El caso de uso actualiza `checkout_event_log` con estado `RETRYING` y `retryCount: retryCount + 1`.
     - El caso de uso lanza `CheckoutTransientError(nextRetryCount = retryCount + 1)`.
     - El consumidor captura el error y publica una copia del mensaje en la cola diferida según el tramo:
       - Intento 1: cola `modulo3.checkout.retry.5s` (TTL: 5.000 ms)
       - Intento 2: cola `modulo3.checkout.retry.15s` (TTL: 15.000 ms)
       - Intento 3: cola `modulo3.checkout.retry.45s` (TTL: 45.000 ms)
     - Estas colas no tienen consumidores; al expirar su TTL, su dead-letter exchange devuelve el mensaje automáticamente a la cola principal.
     - **El consumidor confirma el mensaje original con `channel.ack(originalMsg)`**, liberando la cola principal y evitando bucles calientes.
     - *Reentrada tras reintento en fallo de 006*: cuando el mensaje reingresa tras un error transitorio, `GenerateSettlementUseCase` detecta la liquidación previa por idempotencia (`stayId`) y la retorna intacta; 006 se invoca de nuevo únicamente dentro de esa política de reintento transitorio.
   - Si `retryCount >= 3`:
     - Se agotan los reintentos: el caso de uso actualiza el log a `DEAD_LETTER` con código `RETRIES_EXHAUSTED`.
     - FR-008 exige informar a Módulo 1 del rechazo; no hay contrato receptor ni mecanismo de transporte definido.
     - El caso de uso lanza `CheckoutNonRecoverableError`.
     - El consumidor captura el error y emite `channel.nack(originalMsg, false, false)` enviándolo a `modulo3.checkout.dlq`.
2. **Justificación del diseño de colas múltiples**:
   - En RabbitMQ, el TTL por mensaje (`expiration`) en una sola cola sufre de *head-of-line blocking* (un mensaje con TTL mayor al frente bloquea la expiración de mensajes posteriores con menor TTL). Usar colas dedicadas por tramo de retardo (`5s`, `15s`, `45s`) garantiza que los mensajes expiren y regresen a la cola principal de manera precisa e independiente.

---

### 7. Ventana de Consistencia con Feature 002 (Consultar Liquidación)

El procesamiento del evento de check-out en Módulo 3 es **completamente asíncrono**. En el flujo operativo de front-desk, Módulo 1 ejecuta el paso 2 de consulta de liquidación (feature 002) reactivamente mediante REST GET (`GET /api/v1/settlements`).

> [!WARNING]
> **Recepción y ACK no implican disponibilidad inmediata**:
> La recepción del mensaje de checkout y su confirmación (`channel.ack`) en RabbitMQ **no implican de ninguna manera que la liquidación final o la factura definitiva estén disponibles al instante** para la consulta de Módulo 1.

Durante esta ventana de consistencia eventual, Módulo 1 puede experimentar distintos estados de lectura al consultar:
- `settlementType: "INFORMATIVE"`: Si el mensaje de check-out aún está encolado o procesándose en 010/007.
- `settlementType: "FINAL"` con `invoice: null`: Si la liquidación definitiva ya fue persistida por 007 pero la factura fiscal definitiva aún está emitiéndose en 006, o si el evento se desvió a DLQ por ausencia de datos fiscales (`billingCustomer`).
- `settlementType: "FINAL"` con factura completa: Cuando el flujo concluyó exitosamente con factura emitida y numerada.

La consulta refleja el estado disponible al momento de lectura: `INFORMATIVE` antes de persistir la liquidación y `FINAL` después. Si no existe factura emitida, la respuesta `FINAL` contiene `invoice: null`.

---

## Phase 1: Setup (Infraestructura Compartida)

**Purpose**: Configuración de mensajería con `@nestjs/microservices` y topología de colas

- [ ] T001 Confirmar que las Fases 1 y 2 del plan base están completas: VOs compartidos (`DateRange`, `Channel`), `PrismaService`, conexión RabbitMQ base y logger estructurado
- [ ] T002 Configurar la topología de mensajería en `src/infrastructure/config/rabbitmq.config.ts`:
  - Declarar la topología de M3 (cola principal `modulo3.checkout`, colas diferidas de retry con TTL `modulo3.checkout.retry.5s`, `.15s`, `.45s`, DLX `hospitua.events.dlx`, DLQ `modulo3.checkout.dlq`)
  - Exchange `hospitua.events` (Topic)
  - Configurar el deserializador personalizado de transporte para procesar el sobre plano emitido por M1
- [ ] T003 Confirmar que la feature 007 expone `GENERATE_SETTLEMENT_USE_CASE` en `SettlementModule` y que la feature 006 expone `GENERATE_FINAL_INVOICE_USE_CASE` en `BillingModule`

---

## Phase 2: Foundational (Prerrequisitos Bloqueantes)

**Purpose**: Entidades, errores, puertos y modelo de datos de ingestión

**⚠️ CRITICAL**: Ninguna tarea de historia de usuario puede comenzar sin completar esta fase.

- [ ] T004 [P] Crear los errores de dominio `InvalidCheckoutEventError`, `CheckoutNonRecoverableError` y `CheckoutTransientError` en `src/domain/errors/`
- [ ] T005 [P] Implementar el enum `CheckoutStatus` (`PENDING`, `PROCESSED`, `REJECTED`, `RETRYING`, `DEAD_LETTER`) y la entidad `CheckoutEventLog` en `src/domain/model/checkout-ingestion/` (con campo `receivedEventId`)
- [ ] T006 [P] Implementar la entidad de dominio `CheckoutEvent` con sanitización estricta por lista blanca (descarte total de campos migratorios, pasaporte, visa, nacionalidad y SIRE, validación del campo contractual `categoryRoom` con valor `DOBLE`, validación de fechas y `stayId` obligatorio) en `src/domain/model/checkout-ingestion/checkout-event.ts`
- [ ] T007 Definir la interfaz pura de dominio `RegisterCheckoutInput` y el puerto primario `RegisterCheckoutUseCase` en `src/domain/ports/in/register-checkout.use-case.ts`; definir el comando de aplicación `RegisterCheckoutCommand` (sin dependencias AMQP ni `rawMessage`) en `src/application/dto/checkout-ingestion/register-checkout.command.ts`; y definir los puertos secundarios `CheckoutEventLogRepositoryPort` (con método atómico `upsertInitial` para evitar colisiones UNIQUE bajo concurrencia) en `src/domain/ports/out/`
- [ ] T008 Agregar el modelo `CheckoutEventLog` a `prisma/schema.prisma` con `id uuid PK default gen_random_uuid()`, `event_id uuid nullable` con índice único parcial `WHERE event_id IS NOT NULL`, `received_event_id text nullable`, columnas individuales nulables (`reservation_ref`, `room_id`, `category_room`, `dates`, `stay_id`) para permitir registrar mensajes malformados sin violar restricciones de esquema, y columna `payload jsonb` reconstruida por lista blanca. Generar la migración `<timestamp>_create_checkout_event_log`
- [ ] T009 Implementar `PrismaCheckoutEventLogRepository` y `CheckoutEventLogMapper` en `src/infrastructure/adapters/out/persistence/` implementando el método atómico `upsertInitial` con control de concurrencia (`ON CONFLICT (event_id) WHERE event_id IS NOT NULL`) para crear o recuperar la fila sin colisionar con la restricción de unicidad
- [ ] T010 Conservar la obligación FR-008 de informar el dato rechazado; no definir adaptador de transporte sin contrato receptor

**Checkpoint**: Fundación lista — el consumidor y el servicio pueden implementarse.

---

## Phase 3: User Story 1 - Disparar la liquidación de una estancia al Check-out (Priority: P1)

**Goal**: Procesar el evento `habitacion.checkout`, validarlo por lista blanca, asegurar idempotencia por `eventId` (todos los estados) y de la estancia por `stayId` (`UNIQUE(stay_id)`), invocar a 007 y a 006, manejar reintentos con colas de espera, y conservar la obligación funcional FR-008 de informar a M1; no existe transporte receptor definido [FR-001 a FR-008, SC-001 a SC-006].

**Independent Test**: Publicar eventos en RabbitMQ (válido con datos fiscales, válido sin datos fiscales, estancia de 1 noche, reenvío duplicado, datos incompletos, fechas invertidas, sobre sin UUID, campos migratorios extra, y Módulo 2 caído) y comprobar que el estado en `checkout_event_log`, en `settlement` y en las colas RabbitMQ coincide exactamente con lo esperado [SC-001 a SC-006].

### Tests for User Story 1

- [ ] T011 [P] [US1] Unit test de `CheckoutEvent.create(...)`:
  - Validación de lista blanca estricta: eliminación y descarte total de campos no declarados (`passport`, `nationality`, `visa`, `SIRE`, datos migratorios), garantizando que el objeto de dominio queda limpio [FR-006, NFR-003, SC-004]
  - Validación del campo contractual `categoryRoom` con valor `DOBLE`
  - Validación de `checkInDate < checkOutDate`, estancia de 1 noche válida, fechas iguales o invertidas rechazadas
  - Validación de `stayId` como UUID obligatorio y `reservationRef` como string opaco en `test/unit/domain/checkout-ingestion/checkout-event.spec.ts`
- [ ] T012 [P] [US1] Unit test de `RegisterCheckoutService`:
  - Flujo completo exitoso: invoca 007 y 006, actualiza log a `PROCESSED`
  - Flujo sin datos fiscales (`BILLING_CUSTOMER_DATA_MISSING`): 007 genera liquidación `Final`, 006 lanza error por falta de datos fiscales, log queda `DEAD_LETTER`, se conserva la obligación FR-008; los contratos no definen transporte receptor, y el evento va a DLQ
  - Deduplicación y redelivery por `eventId` cubriendo exhaustivamente todos los estados: `PROCESSED` emite ack inmediato sin reprocesar; `PENDING` reutiliza el registro existente y reanuda el procesamiento sin reinsertar; `RETRYING` reutiliza el registro existente y reanuda el procesamiento sin crear otro registro ni duplicar el evento; `REJECTED` emite ack sin reprocesar; `DEAD_LETTER` emite ack sin reprocesar ordinariamente
  - Concurrencia en la creación u obtención del registro por `eventId`
  - Errores de negocio no recuperables: `RESERVATION_NOT_FOUND`, `QUOTE_NOT_FOUND`, `MISSING_COMMISSION`, `INVALID_COMMISSION`, `SETTLEMENT_ALREADY_EXISTS`, `BILLING_CUSTOMER_DATA_MISSING` actualizan log a `DEAD_LETTER`, conservan la obligación FR-008 sin transporte receptor definido y envían a DLQ sin reintentar
  - Falla transitoria al emitir factura en 006 (`VAT_RATE_UNAVAILABLE` al consultar IVA vigente): la liquidación ya guardada en 007 se conserva, se lanza error transitorio hacia cola de retry; al reingresar, 007 devuelve la existente por idempotencia (`stayId`) sin duplicar y 006 se vuelve a invocar
  - Agotamiento de reintentos (>= 3): actualiza log a `DEAD_LETTER`, conserva la obligación funcional FR-008 sin transporte receptor definido y envía a DLQ
  - Evento con sobre malformado o `eventId` no UUID: log `REJECTED` con `received_event_id`, obligación de FR-008 con identificadores nulables y envío a DLQ
  - Privacidad estricta: verificación de que campos no permitidos (`passport`, `nationality`, `visa`, `SIRE`) jamás aparecen en el log persistido ni en logs de aplicación en `test/unit/application/checkout-ingestion/register-checkout.service.spec.ts`
- [ ] T013 [P] [US1] Contract test de `habitacion.checkout`: validación de que el payload del evento recibido cumple con el esquema propuesto por Módulo 3 en `test/contract/messaging/checkout-event.contract.spec.ts`
- [ ] T014 [P] [US1] Integration test de `PrismaCheckoutEventLogRepository` contra PostgreSQL real (Testcontainers): inserción y recuperación atómica con método `upsertInitial` bajo concurrencia, índice único parcial sobre `event_id`, persistencia de `received_event_id` ante identificadores malformados, persistencia de registros de rechazo con campos nulos y actualización de todos los estados
- [ ] T015 [P] [US1] Integration test del consumidor con RabbitMQ y Postgres reales (Testcontainers):
  - Mensaje válido → `ack` emitido y log `PROCESSED`
  - Reenvío idéntico en `PROCESSED` → `ack` inmediato y sin duplicación en BD [SC-005]
  - Redelivery en los estados `PENDING`, `RETRYING`, `REJECTED` y `DEAD_LETTER`: verificación de comportamiento esperado (reutilización de registro en PENDING/RETRYING sin colisión UNIQUE; ACK inmediato sin reprocesar en REJECTED/DEAD_LETTER)
  - Control de concurrencia y colisiones de restricción única
  - Payload inválido o sobre malformado → `nack` a DLQ y log `REJECTED` [SC-002, SC-006]
  - Error transitorio hacia M2 (`MODULE2_UNAVAILABLE`) o de IVA en 006 (`VAT_RATE_UNAVAILABLE`) → publicación en cola de retry con retardo, `ack` del mensaje original y reingreso tras TTL sin bucle caliente
  - Agotamiento de reintentos (>= 3) → log a `DEAD_LETTER`, obligación de FR-008 y `nack` a DLQ
- [ ] T016 [P] [US1] Implementar DTOs de entrada `CheckoutPayloadDto` y `EventEnvelopeDto` con validaciones de `class-validator`, filtrado estricto por lista blanca, descarte inmediato de datos migratorios y validación del campo contractual `categoryRoom` (`DOBLE`)
- [ ] T017 [US1] Implementar el servicio `RegisterCheckoutService` en `src/application/services/checkout-ingestion/register-checkout.service.ts` como único responsable de la orquestación: `upsertInitial` atómico, validación, invocación a 007, invocación a 006, evaluación de errores recuperables vs no recuperables, reintentos diferidos, obligación de FR-008 y actualización de estados
- [ ] T018 [US1] Implementar el consumidor RabbitMQ `CheckoutRegisteredConsumer` en `src/infrastructure/adapters/in/messaging/checkout-registered.consumer.ts` como adaptador AMQP desacoplado (sin inyectar repositorios de log), delegando en `RegisterCheckoutUseCase` y gestionando ack/nack/retry con el deserializador del sobre plano definido en el Plan Base
- [ ] T019 [US1] Mantener FR-008 en el límite del caso de uso; no implementar integración de notificación sin contrato receptor

**Checkpoint**: El consumidor procesa eventos reales de check-out, garantiza idempotencia y protege el sistema ante contingencias.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Auditoría, observabilidad y blindaje de límites arquitectónicos

- [ ] T020 [P] Implementar logging estructurado en cada evento procesado (`eventId`, `receivedEventId`, `reservationRef`, `roomId`, `status`, tiempo de ejecución), garantizando en pruebas la ausencia total de datos personales sensibles, pasaporte, nacionalidad, visa o migratorios (SIRE) en logs [NFR-003, NFR-004]
- [ ] T021 [P] Test de arquitectura (`dependency-cruiser`): verificar que `checkout-ingestion` no importa dependencias directas de infraestructura de `settlement` o `billing`, ni expone controllers REST [BR-001]
- [ ] T022 [P] E2E test del flujo completo: publicación de mensaje en RabbitMQ → generación de liquidación en `settlement` → emisión de factura en `invoice` → confirmación manual del mensaje en `test/e2e/checkout-flow.e2e-spec.ts`
- [ ] T023 Documentar en el manual operativo los procedimientos para inspeccionar mensajes en la DLQ `modulo3.checkout.dlq` y reprocesarlos manualmente

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: requiere que el plan base (RabbitMQ y Postgres) y los contratos de 007 (`GenerateSettlementUseCase`) y 006 (`GenerateFinalInvoiceUseCase`) estén definidos.
- **Foundational (Phase 2)**: bloquea toda la lógica de ingestión.
- **User Story 1 (Phase 3)**: depende de Foundational y de la disponibilidad de `settlement.module.ts` y `billing.module.ts`.
- **Polish (Phase 4)**: se ejecuta tras completar la historia 1.

### Dependencies with Other Features

- **Feature 007 (`Generar liquidación`)**: bloqueante directo. 010 incluye (`<<include>>`) a 007 y no puede concluir sin ella [FR-004, BR-002]. 010 se adapta al contrato vigente de 007 y al Plan Base requiriendo `stayId` para cumplir con la restricción `UNIQUE(stay_id)` en la tabla `settlement` [BASE, 007].
- **Feature 006 (`Generar factura final`)**: orquestación técnica secuencial tras la liquidación exitosa de 007. Si faltan datos fiscales (`BILLING_CUSTOMER_DATA_MISSING`), la liquidación persiste en `Final` sin número ni factura conforme a Feature 006 [SPEC 006].
- **Feature 002 (`Consultar liquidación`)**: 002 consulta el resultado financiero que 010 y 007 generan en este flujo. La naturaleza asíncrona de 010 genera una ventana de consistencia eventual al check-out (liquidación informativa previa vs. liquidación definitiva con o sin factura asociada).

---
