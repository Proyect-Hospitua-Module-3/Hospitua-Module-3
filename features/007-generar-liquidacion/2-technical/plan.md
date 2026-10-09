# Implementation Plan: Generar liquidación

**Date**: 2026-10-07
**Spec**: [generar_liquidacion.md](../1-functional/generar_liquidacion.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)

## Summary

`Generar liquidación` produce la liquidación `Final` de la estancia de cada habitación cuando se registra su check-out. Es el caso de uso núcleo del *bounded context* `settlement` y no tiene endpoint propio: solo lo incluyen (`<<include>>`) `Registrar Check-out` (010) y `Generar factura final` (006) [FR-001, FR-019].

Enfoque técnico: el caso de uso `GenerateSettlementUseCase` recibe los datos del check-out (reserva, habitación, tipo de habitación y fechas reales), consulta la reserva a Módulo 2 para obtener sus `quoteIds`, el canal y, si es OTA, la OTA, su código de confirmación y la comisión. Luego elige la cotización guardada cuyo tipo de habitación coincide con el del check-out y calcula el ingreso neto con un servicio de dominio puro (`SettlementCalculator`): valor de hospedaje de la cotización menos la comisión OTA, sin IVA. Nunca recalcula la tarifa dinámica (regla 5 del plan base). La liquidación se guarda una sola vez por estancia (`UNIQUE(stay_id)`); un reenvío idéntico devuelve la existente y un intento con datos distintos se rechaza [FR-002, FR-005, FR-008, FR-010, FR-011, FR-020].

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS (según proyecto base)
**Primary Dependencies**: NestJS 10.x, Prisma ORM, `decimal.js` (aritmética decimal exacta dentro del VO `Money`), `opossum` (circuit breaker del cliente de Módulo 2), cliente HTTP de NestJS (`@nestjs/axios`)
**Storage**: PostgreSQL 16 — escribe en `settlement` (dueño de la tabla) y lee `lodging_quote` + `lodging_quote_night` (dueño: `pricing`, feature 005) a través de `LodgingQuoteQueryPort`
**Testing**: Jest (unitarias de dominio y del servicio con puertos mockeados), Jest + Testcontainers (repositorio contra Postgres real), Jest + servidor HTTP simulado (cliente de Módulo 2: 200, 404, timeout, 5xx, circuito abierto)
**Target Platform**: Servicio backend Linux en contenedor Docker
**Project Type**: Servicio backend único (monolito modular hexagonal) — sin frontend en este repositorio
**Performance Goals**: la generación (consulta a Módulo 2 + lectura de la cotización + cálculo + guardado) debe caber en el objetivo de 800 ms que Módulo 1 exige a `GET /api/settlements`, porque la feature 002 reutiliza el mismo cálculo para la liquidación informativa. Por eso el timeout de la llamada a Módulo 2 es de 500 ms [NFR-002]
**Constraints**: determinismo (NFR-001); una única liquidación `Final` por estancia (FR-010, BR-006); nunca recalcular la tarifa dinámica (FR-002, BR-004); nunca liquidar con datos supuestos si falta la reserva, la cotización o la comisión, o si Módulo 2 no responde (FR-014, FR-021, BR-007); sin IVA en el ingreso neto (FR-013); sin datos migratorios ni personales del huésped (NFR-006)
**Scale/Scope**: 3 historias de usuario, 1 caso de uso sin endpoint propio, 1 servicio de dominio de cálculo, 1 cliente HTTP saliente (Módulo 2), 1 tabla propia (`settlement`)

## Project Structure

### Documentation (this feature)

```text
features/007-generar-liquidacion/
├── 1-functional/
│   └── generar_liquidacion.md   # Spec funcional (fuente de verdad de negocio)
└── 2-technical/
    ├── plan.md                  # Este archivo
    └── contracts/
        ├── UC-generate-settlement.md   # Contrato del caso de uso (lo consumen 010 y 006)
        └── CLIENT-get-reservation.md   # Contrato del cliente saliente hacia Módulo 2
```

### Source Code (repository root)

Solo se listan los archivos que esta feature crea o modifica dentro de la estructura por capas del proyecto base (`settlement` como subcarpeta de cada capa).

```text
src/
├── domain/
│   ├── model/
│   │   ├── shared/
│   │   │   ├── money.vo.ts                        # (reutilizado) monto + moneda, redondeo half-up a 2 decimales
│   │   │   ├── channel.vo.ts                      # (reutilizado) Directo | OTA(otaId)
│   │   │   └── date-range.vo.ts                   # (reutilizado) fechas reales de la estancia
│   │   ├── pricing/
│   │   │   └── lodging-quote.ts                   # (reutilizado, de 005) cotización guardada
│   │   └── settlement/
│   │       ├── settlement.ts                      # Entidad Liquidación, siempre Final, inmutable
│   │       ├── commission-percentage.vo.ts        # Porcentaje 0–100 (rechaza negativo o > 100)
│   │       ├── reservation-data.ts                # Datos de la reserva leídos de Módulo 2
│   │       ├── checkout-data.ts                   # Datos del check-out que entrega 010
│   │       └── settlement-calculator.ts           # Servicio de dominio puro: cotización + canal → desglose
│   ├── errors/
│   │   ├── reservation-not-found.error.ts
│   │   ├── quote-not-found.error.ts
│   │   ├── missing-commission.error.ts            # (definido en el plan base)
│   │   ├── invalid-commission.error.ts
│   │   ├── module2-unavailable.error.ts           # Reintentable
│   │   └── settlement-already-exists.error.ts     # (definido en el plan base) datos distintos para la misma estancia
│   └── ports/
│       ├── in/
│       │   └── generate-settlement.use-case.ts    # GenerateSettlementUseCase
│       └── out/
│           ├── reservation.client.port.ts         # Consulta de reserva a Módulo 2
│           ├── lodging-quote-query.port.ts        # Solo lectura de cotizaciones (implementado en 005)
│           └── settlement.repository.port.ts      # SettlementRepositoryPort
│
├── application/
│   ├── services/
│   │   └── settlement/
│   │       └── generate-settlement.service.ts     # Orquesta: idempotencia → Módulo 2 → cotización → cálculo → guardado
│   └── dto/
│       └── settlement/
│           └── generate-settlement.command.ts     # Entrada del caso de uso (la arma 010 o 006)
│
└── infrastructure/
    ├── adapters/
    │   └── out/
    │       ├── http/
    │       │   └── module2-reservation.client.ts  # Implementa ReservationClientPort (timeout 500 ms + opossum)
    │       └── persistence/
    │           ├── mappers/
    │           │   └── settlement.mapper.ts       # Dominio <-> modelo Prisma
    │           └── repositories/
    │               └── prisma-settlement.repository.ts   # Implementa SettlementRepositoryPort
    └── config/
        └── settlement.module.ts                   # Binding de puertos y exporta GenerateSettlementUseCase para 010 y 006

prisma/
├── schema.prisma                                  # Modelo Settlement
└── migrations/
    └── <timestamp>_create_settlement/
        └── migration.sql

test/
├── unit/
│   ├── domain/settlement/
│   │   ├── settlement-calculator.spec.ts
│   │   └── commission-percentage.vo.spec.ts
│   └── application/settlement/
│       └── generate-settlement.service.spec.ts
├── integration/
│   ├── persistence/settlement/
│   │   └── prisma-settlement.repository.spec.ts
│   └── http/
│       └── module2-reservation.client.spec.ts
└── contract/
    └── settlement/
        └── module2-reservation.contract.spec.ts   # Forma de la respuesta de GET /api/reservations/{ref}
```

**Structure Decision**: se usa la estructura por capas del proyecto base con `settlement` como subcarpeta. El cálculo vive en un **servicio de dominio puro** (`SettlementCalculator`) separado del servicio de aplicación, para que la feature 002 pueda reutilizarlo al calcular la liquidación informativa sin persistirla, y para probarlo sin mocks. La feature no tiene adaptador de entrada propio: `settlement.module.ts` exporta `GenerateSettlementUseCase` para que lo inyecten `checkout-ingestion` (010) y `billing` (006).

## Diseño técnico

### Entrada del caso de uso

`GenerateSettlementCommand`, armado por 010 a partir del evento `habitacion.checkout` del plan base:

| Campo | Tipo | Obligatorio | Origen |
|---|---|---|---|
| `eventId` | UUID | Sí | Evento de Módulo 1 (trazabilidad, NFR-003) |
| `stayId` | UUID | Sí | Evento — clave de idempotencia |
| `reservationRef` | string | Sí | Evento — reserva a consultar en Módulo 2 |
| `roomId` | UUID | Sí | Evento — habitación liquidada (FR-016) |
| `categoryRoom` | string | Sí | Evento — tipo de habitación (nombre de Módulo 1); se compara con el `roomType` de la cotización para elegirla (FR-020) |
| `checkInDate`, `checkOutDate` | date | Sí | Evento — fechas **reales** (FR-016) |
| `billingCustomer` | `{ name, taxId }` | No | Evento — se guarda para que 006 emita la factura |

010 ya validó formato y fechas (FR-002/FR-003 de `registrar_checkout.md`); 007 vuelve a construir `DateRange` para no depender de esa validación.

### Puertos

```ts
// src/domain/ports/in/generate-settlement.use-case.ts
export interface GenerateSettlementUseCase {
  generate(command: GenerateSettlementCommand): Promise<Settlement>; // idempotente por stayId
}

// src/domain/ports/out/reservation.client.port.ts
export interface ReservationClientPort {
  getReservation(reservationRef: string): Promise<ReservationData>;
  // lanza ReservationNotFoundError (404) o Module2UnavailableError (timeout, 5xx, circuito abierto)
}

// src/domain/ports/out/lodging-quote-query.port.ts
export interface LodgingQuoteQueryPort {
  findByIds(quoteIds: string[]): Promise<LodgingQuote[]>;
}

// src/domain/ports/out/settlement.repository.port.ts
export interface SettlementRepositoryPort {
  findByStayId(stayId: string): Promise<Settlement | null>;
  insert(settlement: Settlement): Promise<Settlement | 'STAY_ALREADY_SETTLED'>; // conflicto controlado si viola UNIQUE(stay_id)
  // Solo lectura, para 002 y 003 (no las usa GenerateSettlementService):
  findByReservationAndRoom(reservationRef: string, roomId: string): Promise<Settlement | null>; // 002 consulta sin stayId
  findLatestByOtaId(otaId: string): Promise<Settlement | null>;                                 // 003: la Final más reciente de una OTA
}
```

### Flujo de `GenerateSettlementService.generate`

1. **Idempotencia primero**: `findByStayId(stayId)`.
   - Si existe y los datos del check-out coinciden (`reservationRef`, `roomId`, `categoryRoom`, `checkInDate`, `checkOutDate`) → devuelve la existente sin recalcular ni llamar a Módulo 2 [FR-011, HU1 escenarios 3 y 4].
   - Si existe con datos distintos → `SettlementAlreadyExistsError` y conserva la original [FR-010, HU3 escenario 2].
2. **Reserva en Módulo 2**: `getReservation(reservationRef)`.
   - 404 → `ReservationNotFoundError` [FR-014].
   - Timeout (500 ms), 5xx o circuito abierto → `Module2UnavailableError`, reintentable [FR-021].
3. **Elegir la cotización**: `findByIds(reservation.quoteIds)` y quedarse con las de `roomType` igual al `categoryRoom` del check-out (mismo valor, distinto nombre: `categoryRoom` es el nombre de Módulo 1 y `roomType` el de `pricing`) [FR-020].
   - Ninguna coincide → `QuoteNotFoundError` [FR-014].
   - Varias coinciden (mismo tipo y mismo valor) → se toma la de menor `quoteId` para que el resultado sea siempre el mismo [NFR-001, casos límite].
4. **Canal**: `Channel` a partir de `reservation.channel`; sin canal informado → Directo [FR-003, FR-004].
   - Si es OTA: `CommissionPercentage.create(reservation.otaCommissionPercentage)`. Ausente → `MissingCommissionError`; negativo o mayor a 100 → `InvalidCommissionError`. Nunca se asume un porcentaje por defecto [FR-014, HU2 escenario 3].
5. **Calcular** con `SettlementCalculator.calculate(quote, channel, commission)` (ver abajo) [FR-006, FR-007, FR-008].
6. **Guardar** la `Settlement` en estado `Final` con `insert` [FR-009].
   - Si dos entregas del mismo evento llegan a la vez y la segunda viola `UNIQUE(stay_id)`, el servicio vuelve al paso 1: lee la existente y aplica la misma regla de comparación [FR-011].
7. Devuelve la `Settlement` con su desglose [FR-012].

El servicio no modifica la disponibilidad ni el estado de la habitación [FR-018].

### Cálculo (`SettlementCalculator`)

Servicio de dominio puro, sin puertos ni I/O:

- `lodgingAmount` = `quote.lodgingAmount` (con la moneda de la cotización, `COP`) [FR-002, BR-004].
- Directo: `commissionAmount = 0`, `netIncome = lodgingAmount` [FR-007].
- OTA: `commissionAmount = lodgingAmount × porcentaje / 100`, redondeado half-up a 2 decimales con `Money`; `netIncome = lodgingAmount − commissionAmount` [FR-006, FR-008].
- El IVA no entra en el cálculo; lo agrega 006 al emitir la factura [FR-013, BR-005].
- Toda la aritmética usa `decimal.js` dentro de `Money`, nunca `number` de JavaScript [NFR-004].

Ejemplo: cotización de 750.000 COP, canal OTA con 15 % → comisión 112.500 y neto 637.500.

**Salida anticipada o extensión**: el valor es siempre el de la cotización vigente de la reserva. Una extensión ya llega como una nueva cotización que Módulo 2 dejó en `quoteIds` en lugar de la anterior; la liquidación solo registra las fechas reales [casos límite, BR-004].

### Modelo de datos (`settlement`)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `stay_id` | uuid | `UNIQUE` — una liquidación por estancia [FR-010] |
| `reservation_ref` | text | [FR-016] |
| `room_id` | uuid | [FR-016] |
| `category_room` | text | Tipo de habitación del check-out (nombre de Módulo 1) [FR-016] |
| `check_in_date`, `check_out_date` | date | Fechas reales del check-out [FR-016] |
| `quote_id` | uuid | Cotización usada [NFR-003, NFR-007] |
| `channel` | text | `DIRECT` \| `OTA` |
| `ota_id`, `ota_confirmation_code` | text, nullable | Solo canal OTA |
| `ota_commission_percentage` | numeric(5,2), nullable | Solo canal OTA; lo lee `ota-commission` (003) |
| `currency` | char(3) | `COP` |
| `lodging_amount`, `ota_commission_amount`, `net_income` | numeric(14,2) | Desglose [FR-012] |
| `billing_customer_name`, `billing_customer_tax_id` | text, nullable | Datos tributarios mínimos para 006; nada más del huésped [NFR-006] |
| `status` | text | Siempre `FINAL` [FR-009] |
| `source_event_id` | uuid | Evento que la generó [NFR-003] |
| `generated_at` | timestamptz | Hora de la base de datos [NFR-003] |

Índices de lectura para las features que consultan la tabla: `(reservation_ref, room_id)` para 002, que identifica la habitación por reserva y habitación y no conoce el `stayId`, y `(ota_id, generated_at DESC)` para 003 [FR-017]. 007 solo los crea; la lógica de esas consultas es de 002 y 003.

La tabla no tiene `UPDATE` en ningún camino de código: la liquidación es inmutable una vez creada [FR-009, FR-017].

### Cliente de Módulo 2

- `GET {MODULE2_BASE_URL}/api/reservations/{reservationRef}`, sin token, por la red interna (contrato del plan base).
- Timeout de 500 ms y circuit breaker `opossum` (se abre tras 5 fallos seguidos y vuelve a probar a los 30 s).
- 200 → `ReservationData` (`reservationRef`, `quoteIds`, `channel` y, si es OTA, `otaId`, `otaConfirmationCode`, `otaCommissionPercentage`).
- 404 → `ReservationNotFoundError`. Timeout, 5xx o circuito abierto → `Module2UnavailableError`.
- Configuración en `.env`: `MODULE2_BASE_URL`, `MODULE2_TIMEOUT_MS=500`.

### Errores y qué hace quien llama

007 no tiene endpoint, así que sus errores los recibe 010 (para decidir el `ack` del evento) o 006. El `errorCode` sigue el formato `ApiError` del plan base [FR-015, NFR-005]:

| Error | `errorCode` | Reintentable | Qué hace 010 con el evento |
|---|---|---|---|
| `ReservationNotFoundError` | `RESERVATION_NOT_FOUND` | No | Dead-letter para revisión manual |
| `QuoteNotFoundError` | `QUOTE_NOT_FOUND` | No | Dead-letter |
| `MissingCommissionError` | `MISSING_COMMISSION` | No | Dead-letter |
| `InvalidCommissionError` | `INVALID_COMMISSION` | No | Dead-letter |
| `SettlementAlreadyExistsError` | `SETTLEMENT_ALREADY_EXISTS` | No | Dead-letter (datos distintos para una estancia ya liquidada) |
| `Module2UnavailableError` | `MODULE2_UNAVAILABLE` | Sí | No confirma el evento; RabbitMQ lo reentrega |

007 no devuelve ninguna respuesta HTTP, así que no genera 5xx. Los 5xx que aparecen en este plan son los que *recibimos* de Módulo 2. Si un endpoint que reutilice este cálculo (002) recibe `Module2UnavailableError`, lo responde como 424 con `MODULE2_UNAVAILABLE` (plan base); no es una decisión de 007.

Cada mensaje dice qué falló y con qué dato (reserva, tipo de habitación, OTA), para que recepción o facturación puedan corregirlo [NFR-005].

### Relación con 010, 006 y 002

- **010** llama a `generate` después de validar el evento y, con el resultado, a `Generar factura final` (006). El evento solo se confirma cuando ambos terminaron. Si 006 falla después de que 007 guardó, la reentrega llega a 007, que devuelve la liquidación existente (paso 1) y 006 se reintenta. La idempotencia evita tener que envolver a 007 y 006 en una sola transacción.
- **006** también puede llamar a `generate` (FR-019); por la idempotencia siempre obtiene la misma liquidación `Final`.
- **003** lee la liquidación `Final` más reciente de una OTA con `findLatestByOtaId`; `GenerateSettlementService` nunca lo llama, porque el porcentaje sale solo de la reserva de Módulo 2 (FR-003 de `consultar_porcentaje_comision_ota.md`).
- **002** también consulta por `findByReservationAndRoom`, y reutiliza `SettlementCalculator` y los mismos puertos para calcular la liquidación informativa sin guardarla, antes del check-out.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verificar que la base del proyecto y las piezas de `pricing` están disponibles

- [ ] T001 Confirmar que el proyecto base (Fases 1 y 2 de `docs/plan-tecnico-base.md`) está completo: VOs compartidos (`Money`, `Channel`, `DateRange`), `PrismaService`, `ExceptionFilter` global y errores de dominio base
- [ ] T002 Confirmar con la feature 005 que `lodging_quote` y `lodging_quote_night` existen y que `PrismaLodgingQuoteRepository` implementa `LodgingQuoteQueryPort.findByIds`; si aún no, acordarlo con su responsable antes de seguir
- [ ] T003 Agregar `MODULE2_BASE_URL` y `MODULE2_TIMEOUT_MS=500` a `.env.example` y al módulo de configuración; agregar las dependencias `decimal.js`, `opossum` y `@nestjs/axios`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Piezas compartidas por las tres historias

**⚠️ CRITICAL**: Ninguna historia puede empezar hasta completar esta fase

- [ ] T004 [P] Crear los errores de dominio `ReservationNotFoundError`, `QuoteNotFoundError`, `InvalidCommissionError` y `Module2UnavailableError` en `src/domain/errors/` y registrarlos en el `ExceptionFilter` global con su `errorCode`
- [ ] T005 [P] Implementar el VO `CommissionPercentage` (0–100) en `src/domain/model/settlement/commission-percentage.vo.ts`
- [ ] T006 [P] Implementar `ReservationData` y `CheckoutData` en `src/domain/model/settlement/`
- [ ] T007 Implementar la entidad `Settlement` (estado siempre `Final`, sin métodos de modificación) en `src/domain/model/settlement/settlement.ts`
- [ ] T008 Definir `GenerateSettlementUseCase`, `ReservationClientPort` y `SettlementRepositoryPort` con sus tokens en `src/domain/ports/`
- [ ] T009 Agregar el modelo `Settlement` a `prisma/schema.prisma` y crear la migración `<timestamp>_create_settlement` con `UNIQUE(stay_id)`
- [ ] T010 Implementar `PrismaSettlementRepository` y `SettlementMapper` (`findByStayId`, `insert` que traduce la violación de `UNIQUE(stay_id)` a un conflicto controlado, `findByReservationAndRoom`, `findLatestByOtaId` y los dos índices de lectura)
- [ ] T011 Implementar `Module2ReservationClient` con timeout de 500 ms y circuit breaker `opossum`
- [ ] T012 Registrar el binding de los puertos y exportar `GenerateSettlementUseCase` en `src/infrastructure/config/settlement.module.ts`

**Checkpoint**: Fundación lista — las historias pueden implementarse

---

## Phase 3: User Story 1 - Generar la liquidación `Final` al registrar el check-out (Priority: P1)

**Goal**: Cada check-out de habitación produce una liquidación `Final` con el valor de hospedaje de su cotización guardada, de forma idempotente, y sin liquidar con datos supuestos

**Independent Test**: Sembrar una cotización y simular en Módulo 2 una reserva de canal directo con dos habitaciones de distinto tipo; generar la liquidación de cada habitación y verificar que cada una usa la cotización de su tipo, tiene estado `Final` e ingreso neto igual al hospedaje; reenviar el mismo comando y verificar que no hay duplicado

### Tests for User Story 1

- [ ] T013 [P] [US1] Unit test de `SettlementCalculator` para canal directo (neto = hospedaje, comisión 0, sin IVA) en `test/unit/domain/settlement/settlement-calculator.spec.ts`
- [ ] T014 [P] [US1] Unit test de `GenerateSettlementService` con puertos mockeados: cotización elegida por `categoryRoom`, varias habitaciones, reenvío idéntico devuelve la existente sin llamar a Módulo 2, reserva inexistente → `ReservationNotFoundError`, sin cotización del tipo → `QuoteNotFoundError`, Módulo 2 caído → `Module2UnavailableError`, varias cotizaciones del mismo tipo → siempre la misma, en `test/unit/application/settlement/generate-settlement.service.spec.ts`
- [ ] T015 [P] [US1] Integration test de `Module2ReservationClient` contra un servidor HTTP simulado: 200, 404, timeout de 500 ms, 5xx y circuito abierto, en `test/integration/http/module2-reservation.client.spec.ts`
- [ ] T016 [P] [US1] Contract test de la respuesta de `GET /api/reservations/{reservationRef}` (campos y tipos acordados con Módulo 2) en `test/contract/settlement/module2-reservation.contract.spec.ts`
- [ ] T017 [P] [US1] Integration test de `PrismaSettlementRepository` contra Postgres (Testcontainers): `insert`, `findByStayId` y dos `insert` simultáneos del mismo `stayId` que terminan en una sola fila, en `test/integration/persistence/settlement/prisma-settlement.repository.spec.ts`

### Implementation for User Story 1

- [ ] T018 [US1] Implementar `SettlementCalculator` para canal directo en `src/domain/model/settlement/settlement-calculator.ts`
- [ ] T019 [US1] Implementar `GenerateSettlementService.generate` (pasos 1 a 7 del flujo) en `src/application/services/settlement/generate-settlement.service.ts`
- [ ] T020 [US1] Implementar `GenerateSettlementCommand` en `src/application/dto/settlement/`

**Checkpoint**: La liquidación de canal directo funciona y es idempotente

---

## Phase 4: User Story 2 - Aplicar el descuento de comisión cuando la reserva proviene de una OTA (Priority: P1)

**Goal**: El ingreso neto descuenta exactamente el porcentaje de comisión que informa Módulo 2, y nunca se asume uno por defecto

**Independent Test**: Simular en Módulo 2 una reserva OTA con 15 % de comisión y una cotización de 750.000 COP; verificar comisión 112.500 y neto 637.500; repetir sin porcentaje y con 120 % y verificar el rechazo

### Tests for User Story 2

- [ ] T021 [P] [US2] Unit test de `CommissionPercentage`: acepta 0 y 100, rechaza negativo y mayor a 100, en `test/unit/domain/settlement/commission-percentage.vo.spec.ts`
- [ ] T022 [P] [US2] Unit test de `SettlementCalculator` para OTA: comisión y neto exactos, redondeo half-up a 2 decimales, sin IVA
- [ ] T023 [P] [US2] Unit test del servicio: OTA sin porcentaje → `MissingCommissionError`; porcentaje inválido → `InvalidCommissionError`; reserva sin canal → Directo sin comisión

### Implementation for User Story 2

- [ ] T024 [US2] Extender `SettlementCalculator` con el canal OTA
- [ ] T025 [US2] Construir `Channel` y `CommissionPercentage` en el paso 4 del servicio y guardar `ota_id`, `ota_confirmation_code` y `ota_commission_percentage`

**Checkpoint**: HU1 y HU2 funcionan de forma independiente

---

## Phase 5: User Story 3 - Impedir liquidación antes del check-out o más de una por estancia (Priority: P2)

**Goal**: Nunca existe una liquidación `Final` sin check-out ni dos para la misma estancia

**Independent Test**: Verificar que no hay ninguna forma de generar una liquidación fuera de 010/006; generar una liquidación y luego intentar otra para el mismo `stayId` con fechas distintas, y verificar el rechazo y que la original no cambió

### Tests for User Story 3

- [ ] T026 [P] [US3] Unit test: mismo `stayId` con datos distintos → `SettlementAlreadyExistsError` y la original intacta
- [ ] T027 [P] [US3] Integration test: violación de `UNIQUE(stay_id)` con datos distintos termina en `SettlementAlreadyExistsError` y no en un error genérico
- [ ] T028 [P] [US3] Test de arquitectura (`dependency-cruiser`): solo `checkout-ingestion` (010) y `billing` (006) pueden importar `GenerateSettlementUseCase`; ningún controller lo usa [FR-001]

### Implementation for User Story 3

- [ ] T029 [US3] Implementar la comparación de datos del check-out en el paso 1 y el reintento de lectura tras un conflicto de `UNIQUE(stay_id)` en el paso 6
- [ ] T030 [US3] Agregar la regla de `dependency-cruiser` de T028

**Checkpoint**: Las tres historias funcionan de forma independiente

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Garantías transversales de la feature

- [ ] T031 Verificar que la tabla `settlement` no tiene ningún `UPDATE` en el código (búsqueda en el repositorio + test que compara la fila antes y después de un reenvío) [FR-009, FR-017]
- [ ] T032 Logging estructurado de cada generación (`stayId`, `reservationRef`, canal, `quoteId`, resultado o `errorCode`, duración), sin datos personales del huésped [NFR-003, NFR-006]
- [ ] T033 Medir el tiempo de `generate` con Módulo 2 simulado y confirmar que cabe en el objetivo de 800 ms [NFR-002]
- [ ] T034 Coordinar con 010 el manejo de errores de la tabla "Errores y qué hace quien llama" (dead-letter o reentrega) y con 002 la reutilización de `SettlementCalculator`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: depende del proyecto base y de la cotización de la feature 005 (T016 del plan base)
- **Foundational (Phase 2)**: depende de Setup — BLOQUEA todas las historias
- **User Stories (Phase 3–5)**: dependen de Foundational; HU2 extiende el cálculo de HU1, así que se recomienda el orden P1 (HU1) → P1 (HU2) → P2 (HU3)
- **Polish (Phase 6)**: depende de las tres historias
- **Features que dependen de esta**: 010 Registrar Check-out, 002 Consultar liquidación, 006 Generar factura final y 003 Consultar porcentaje de comisión OTA (Phase 4–6 del plan base)

### User Story Dependencies

- **User Story 1 (P1)**: solo depende de Foundational
- **User Story 2 (P1)**: depende de `SettlementCalculator` de HU1
- **User Story 3 (P2)**: depende del flujo de HU1

### Within Each User Story

- Tests antes que implementación
- Dominio (VOs, calculador) antes que servicio de aplicación
- Servicio de aplicación antes que wiring en el módulo

## Notes

- [Story] label mapea cada tarea a su historia para trazabilidad
- Ante cualquier conflicto, la spec funcional `generar_liquidacion.md` es la fuente de verdad; para stack, capas y contratos con Módulo 1 y Módulo 2 manda `docs/plan-tecnico-base.md`
- Commit después de cada tarea o grupo lógico
- Evitar: llamar al cálculo de `pricing` desde `settlement` (regla 5 del plan base), usar `number` para importes, asumir un canal o una comisión cuando Módulo 2 no los informa, actualizar una liquidación ya guardada
