# Implementation Plan: Consultar liquidación

**Date**: 2026-10-08
**Spec**: [consultar_liquidacion.md](../1-functional/consultar_liquidacion.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Contrato expuesto**: [GET-settlements.md](contracts/GET-settlements.md)

---

## Summary

`Consultar liquidación` es una funcionalidad **exclusivamente de solo lectura** perteneciente al *bounded context* `settlement` [BR-001; BASE]. Expone el servicio de consulta de liquidación para dos actores autorizados: **Módulo 1** en los pasos 2 y 3 del check-out de front-desk y **OTAs** para conciliación financiera tras la salida [FR-001, BR-002; BASE].

La consulta interna de Módulo 1 se realiza sin token en la red privada conforme al Plan Base. Las OTAs consultan `GET /api/settlements` con JWT (`role = OTA`, claim `otaId`). Módulo 1 envía `reservationRef`, `roomId` y `categoryRoom`; `reservationRef` es un string opaco y en esta iteración `categoryRoom` es `DOBLE`. Parámetros operativos adicionales se ignoran cuando están presentes.

La OTA consulta por `reservationRef` y el claim `otaId`; `roomId` y `categoryRoom` son opcionales para ese actor. Módulo 1 consulta por `reservationRef`, `roomId` y `categoryRoom`. La búsqueda final se realiza por `(reservationRef, roomId)` y `stayId` permanece como UUID independiente, único por liquidación (`UNIQUE(stay_id)`). La respuesta de M3 es anidada (`settlementType`, `breakdown`, `invoice`); la referencia de integración de M1 describe una forma plana y no establece un mapeo entre ambas.

---

## Technical Context

- **Language/Version**: TypeScript 5.x sobre Node.js 20 LTS (según proyecto base)
- **Primary Dependencies**: NestJS 10.x, Prisma ORM, Passport-JWT + Guards de NestJS, `class-validator` / `class-transformer`, `opossum` (circuit breaker hacia Módulo 2), `@nestjs/axios`
- **Storage**: PostgreSQL 16 — solo lectura sobre las tablas `settlement` (dueño: 007) e `invoice` (dueño: 006). Esta feature **no posee tablas propias ni escribe filas** [BR-001, FR-011]
- **Testing**:
  - Jest para pruebas unitarias de dominio y aplicación con puertos mockeados
  - Jest + Testcontainers (Postgres real) para pruebas de consultas en repositorios de lectura
  - Jest + servidor HTTP simulado para llamadas salientes a Módulo 2 (éxito, 404, indisponibilidad técnica, timeout)
  - Supertest para pruebas e2e y pruebas de contrato HTTP de `/api/settlements` e `/api/settlements`
- **Target Platform**: Servicio backend Linux en contenedor Docker (red interna Docker Compose)
- **Project Type**: Servicio backend único (monolito modular hexagonal)
- **Performance Goals**: Tiempo de respuesta total de la consulta informativa **< 800 ms** en el percentil 95 (objetivo propuesto por M1 en su plan con timeout de 3 s; M3 lo adopta como objetivo para operación ágil en recepción, complementando NFR-001). Timeout hacia Módulo 2 fijado en 500 ms [NFR-002 de 007; BASE]
- **Constraints**:
  - Exclusivamente de solo lectura: 0% de inserts o updates en `settlement` o `invoice` desde esta feature [FR-004, BR-001, SC-004]
  - Determinismo estricto: idéntica consulta produce idéntico resultado [NFR-002, SC-005]
  - Protección anti-enumeración para OTAs: ante reservas ajenas o no liquidadas se responde estrictamente `404 SETTLEMENT_NOT_FOUND` sin revelar la existencia de reservas de otros canales o clientes [NFR-003, SC-002]
  - Sin valores por defecto ni importes parciales: ante datos faltantes en Módulo 2 o fallas técnicas, la informativa no se calcula con supuestos [FR-012, BR-004, SC-009]
  - Privacidad total: 0% de exposición de datos migratorios o personales del huésped [FR-007, NFR-004]
- **Scale/Scope**: 3 historias de usuario, adaptadores HTTP para consulta interna y externa, 1 caso de uso (`GetSettlementUseCase`), 2 adaptadores de consulta de persistencia

---

## Project Structure

### Documentation (this feature)

```text
features/002-consultar-liquidacion/
├── 1-functional/
│   └── consultar_liquidacion.md           # Spec funcional (fuente de verdad de negocio)
└── 2-technical/
    ├── contracts/
    │   └── GET-settlements.md             # Contrato REST oficial del endpoint y alineación M1
    └── plan.md                            # Este archivo
```

### Source Code (repository root)

Archivos creados o modificados por esta feature dentro de la arquitectura hexagonal (`settlement` como subcarpeta de cada capa):

```text
src/
├── domain/
│   ├── model/
│   │   ├── shared/
│   │   │   ├── money.vo.ts                        # (reutilizado de fase base)
│   │   │   └── channel.vo.ts                      # (reutilizado)
│   │   └── settlement/
│   │       ├── settlement.ts                      # (reutilizado de 007) Entidad Liquidación Final
│   │       ├── settlement-calculator.ts           # (reutilizado de 007) Servicio de dominio puro de cálculo
│   │       └── settlement-query-result.ts         # Modelo de dominio del resultado (FINAL | INFORMATIVE)
│   ├── errors/
│   │   ├── settlement-not-found.error.ts          # 404 para OTA (inexistente o reserva ajena anti-enumeración)
│   │   ├── reservation-not-found.error.ts         # (reutilizado de 007) 404 al consultar M2
│   │   ├── quote-not-found.error.ts               # (reutilizado de 007) 404 sin cotización
│   │   └── module2-unavailable.error.ts           # (reutilizado de 007) M2 caído o timeout (código HTTP sustituto de 503 )
│   └── ports/
│       ├── in/
│       │   └── get-settlement.use-case.ts         # Puerto primario: GetSettlementUseCase
│       └── out/
│           ├── settlement-query.port.ts           # Puerto de lectura sobre la tabla settlement
│           ├── settlement-invoice-query.port.ts   # Puerto de lectura sobre invoice asociada
│           ├── reservation.client.port.ts         # (reutilizado de 007) Cliente HTTP de Módulo 2
│           └── lodging-quote-query.port.ts        # (reutilizado de 005) Lectura de cotizaciones
│
├── application/
│   ├── services/
│   │   └── settlement/
│   │       └── get-settlement.service.ts          # Orquesta: busca Final -> informativa (M1) o 404 (OTA)
│   └── dto/
│       └── settlement/
│           ├── get-settlement.query.ts            # Query interna con parámetros y contexto del actor
│           └── settlement-response.dto.ts         # DTO de respuesta estructurada
│
└── infrastructure/
    ├── adapters/
    │   ├── in/
    │   │   └── http/
    │   │       ├── settlements.controller.ts      # GET /api/settlements (acceso externo OTA con JWT, )
    │   │       ├── internal-settlements.controller.ts # GET /api/settlements (acceso interno M1 )
    │   │       └── dto/
    │   │           └── get-settlement-query.dto.ts # Validaciones de categoryRoom con class-validator
    │   └── out/
    │       └── persistence/
    │           └── repositories/
    │               ├── prisma-settlement-query.adapter.ts        # Implementa SettlementQueryPort (READ ONLY)
    │               └── prisma-settlement-invoice-query.adapter.ts # Implementa SettlementInvoiceQueryPort (READ ONLY)
    └── config/
        └── settlement.module.ts                   # Registra controllers, queries y binding de puertos

prisma/
└── schema.prisma                                  # Modelos settlement e invoice (la creación de índices se coordina con 007 y 006)
```

**Structure Decision**: La feature se ubica en `settlement`. Módulo 1 consulta internamente sin token por la red privada conforme al Plan Base; la OTA consulta `/api/settlements` con JWT. Los puertos `SettlementQueryPort` y `SettlementInvoiceQueryPort` son de solo lectura y permanecen desacoplados de los puertos de escritura de 007 y 006.

---

## Diseño Técnico

### 1. Alineación con Módulo 1 (Check-Out Front-Desk)

La integración con Módulo 1 (Java / Spring Boot) en los pasos 2 y 3 del check-out presenta diferencias que se alinean de forma tolerante en esta feature:

| Tema | Lo que espera Módulo 1 | Lo que ofrece Módulo 3 | Estado |
|---|---|---|---|
| **Ruta** | `GET /api/settlements` | `GET /api/settlements` (ruta definida en Plan Base; llamada interna sin token) | Definida en Plan Base |
| **Autenticación** | Sin token en red interna de Docker Compose | Llamada interna sin token por red Docker Compose (establecido en Plan Base). M3 no valida recepcionistas ni sus roles. | Alineada con Plan Base |
| **Categoría de habitación** | Envía `categoryRoom` | Requiere `categoryRoom`; para esta iteración el valor es `DOBLE`. | Alineada para esta iteración |
| **Parámetros adicionales** | Envía `eventType=CHECK_OUT`, `source`, `checkInDate`, `checkOutDate` | `reservationRef`, `roomId`, `categoryRoom` requeridos para M1. El resto se aceptan y se ignoran (`source` no se devuelve, coincidiendo con M1 que lo toma de `Stay.source`). | *Compatible (tolerante)* |
| **Formato de `reservationRef`** | String opaco (`reservation_ref VARCHAR`) | String opaco (ej. `RES-000123`). No se valida como UUID. | Compatible: string opaco |
| **Estructura de respuesta** | Plana con campos financieros | Anidada (`settlementType`, `breakdown`, `invoice`). La referencia de M1 no define un mapeo entre ambas formas. | Incompatibilidad de representación |
| **Cálculo de ingreso neto** | M1 usa en su ejemplo `425.00` (`500 - 75`) | `hospedaje - comisión` (`425.00`, sin IVA; el IVA es solo de la factura fiscal según FR-002/FR-003). | Alineado; M3 ratifica hospedaje − comisión (sin IVA) |
| **Liquidación informativa en paso 3** | En paso 3 de M1 se muestran únicamente: hospedaje, comisión e ingreso neto (`netIncome = accommodationAmount - commission`) | Antes del check-out `invoice` es estrictamente `null` (sin factura, IVA ni total final). El ingreso neto no debe confundirse con el total pagado por el huésped. | *Alineado con decisión confirmada* |
| **Formato de `invoiceNumber`** | Entero consecutivo | `integer` (ej. `1042`) en `invoice` definitiva (secuencia PostgreSQL); `null` en informativa. | Entero consecutivo (secuencia) |
| **Total a pagar (`totalToPay`)** | Total de hospedaje más IVA | Disponible como `invoice.totalAmount` únicamente cuando existe factura definitiva; `null` en informativa o sin factura. | La referencia M1 no documenta un mapeo para `null` |
| **Timeout y Rendimiento (SLA)** | Timeout de 3 s con circuit breaker y p95 < 800 ms (techo 2 s en SC-002 de M1) | Consulta informativa en memoria con p95 < 800 ms (< 500 ms hacia M2). | Compatible: objetivo propuesto por M1 en su plan (p95 < 800 ms, timeout 3 s); M3 lo adopta como objetivo |
| **Códigos de error** | M1 transforma respuestas de error a su estado interno | M3 usa los códigos `ApiError` del Plan Base. | Sin incompatibilidad funcional descrita |
| **Fechas y horas** | M1 no consume las marcas de tiempo financieras | M3 devuelve las marcas de tiempo definidas por sus contratos. | Sin incompatibilidad funcional descrita |

### 2. Control de Acceso y Rutas

Módulo 1 consulta `GET /api/settlements` sin token dentro de la red privada, conforme al Plan Base. Las OTAs consultan la misma ruta con JWT (`role = OTA`, claim `otaId`).


### 3. Parámetros de Entrada Tolerantes

El DTO `GetSettlementQueryDto` en la capa de infraestructura implementa las siguientes reglas:
- **Parámetro `categoryRoom`**: obligatorio para Módulo 1; en esta iteración el valor es `DOBLE`. No se define una validación contra un catálogo adicional en este contrato.
- **Parámetros ignorados**: `eventType` (así como `checkInDate`, `checkOutDate` y `source`) son aceptados sintácticamente y se ignoran por completo (no filtran ni cambian el resultado en base de datos ni en el cálculo financiero). M1 reporta `source` pero no espera que M3 lo devuelva, ya que M1 lo lee de su entidad local `Stay.source` y M3 lo consulta contractualmente en Módulo 2.
- **Formato de `reservationRef`**: Es un string opaco alfanumérico (ej. `RES-000123`, longitud 3–64); no se valida como UUID. M1 documenta este campo como UUID en sus contratos y debe corregirlo en su especificación interna.

---

### 4. Consulta de la OTA y Seguridad Anti-Enumeración (404)

1. **Parámetros OTA**: `reservationRef` es obligatorio; `roomId` y `categoryRoom` son opcionales para este actor, conforme a FR-001.


2. La consulta OTA usa `reservationRef` y el claim `otaId`; `otaConfirmationCode` no es parámetro de esta operación.
3. **Validación de pertenencia**:
   - Se valida contra la liquidación persistida: `settlement.otaId === token.otaId`.
4. **Protección Anti-Enumeración (HTTP 404)**:
   - Si la reserva consultada no pertenece a la OTA autenticada (pertenece a otra OTA o a canal directo), o si aún no tiene check-out:
   - **El sistema responde `404 Not Found` (`errorCode: SETTLEMENT_NOT_FOUND`), NUNCA 403 FORBIDDEN** [PLAN; NFR-003].
   - *Justificación*: Responder 403 confirmaría a un atacante que la reserva existe en el hotel pero no es suya. Responder 404 garantiza confidencialidad total y previene la enumeración de reservas ajenas [NFR-003, SC-002].
5. **Reservas multihabitación para OTAs**:
   - La respuesta definida por la operación es una liquidación individual; no se define una representación de colección para reservas OTA multihabitación.

---

### 5. Puertos

```ts
// src/domain/ports/in/get-settlement.use-case.ts
export const GET_SETTLEMENT_USE_CASE = Symbol('GET_SETTLEMENT_USE_CASE');

export interface GetSettlementUseCase {
  execute(query: GetSettlementQuery): Promise<SettlementResponseDto>;
}

// src/domain/ports/out/settlement-query.port.ts
export const SETTLEMENT_QUERY_PORT = Symbol('SETTLEMENT_QUERY_PORT');

export interface SettlementQueryPort {
  findByReservationAndRoom(
    reservationRef: string,
    roomId: string,
  ): Promise<Settlement | null>;

  findByReservationRef(
    reservationRef: string,
  ): Promise<Settlement[]>;
}

// src/domain/ports/out/settlement-invoice-query.port.ts
export const SETTLEMENT_INVOICE_QUERY_PORT = Symbol('SETTLEMENT_INVOICE_QUERY_PORT');

export interface SettlementInvoiceQueryPort {
  findInvoiceBySettlementId(settlementId: string): Promise<InvoiceReadModel | null>;
}
```

---

### 6. Orquestación del Servicio (`GetSettlementService`)

Flujo secuencial de ejecución:

```
[Petición de Consulta de Liquidación]
                 │
                 ▼
1. Validar parámetros sintácticos (reservationRef obligatorio; roomId opcional para OTA)
                 │
                 ▼
2. ¿Quién consulta?
   ├── OTA:
   │   a. Buscar liquidación en BD por reservationRef mediante SettlementQueryPort
   │   b. ¿Existe liquidación Y settlement.otaId === token.otaId?
   │      ├── NO (es ajena, de canal directo, o no existe):
   │      │   └── LANZAR 404 SettlementNotFoundError (SETTLEMENT_NOT_FOUND)
   │      │       [Anti-enumeración: jamás 403 para no revelar existencia]
   │      └── SÍ:
   │          Consultar factura asociada y retornar con settlementType = "FINAL"
   │
   └── MÓDULO 1:
       a. Buscar en BD por (reservationRef, roomId)
       b. ¿Existe Liquidación Final?
          ├── SÍ: Consultar factura asociada y retornar con settlementType = "FINAL"
          └── NO: CALCULAR LIQUIDACIÓN INFORMATIVA (< 800 ms objetivo M1/M3):
              - Consultar reserva en M2 (404 -> ReservationNotFoundError; falla técnica -> Module2UnavailableError [código HTTP ])
              - Consultar cotización guardada por categoryRoom (404 -> QuoteNotFoundError)
              - Calcular desglose en memoria con SettlementCalculator (de 007)
              - Retornar settlementType = "INFORMATIVE", invoice = null
              - ¡Sin escrituras en PostgreSQL!
```

---

### 7. Transacciones y concurrencia

- **Aislamiento `READ COMMITTED` y transacciones `READ ONLY`**:
  Todas las consultas a la base de datos PostgreSQL se ejecutan bajo transacciones explícitas `READ ONLY` con nivel de aislamiento `READ COMMITTED` [BASE]. Al ser operaciones de solo lectura, nunca adquieren bloqueos exclusivos ni interfieren con las transacciones de escritura de check-out ejecutadas por otras features.
- **Atomicidad y determinismo bajo concurrencia**:
  Una consulta que se ejecute en el instante exacto en que se está procesando un check-out devuelve de forma atómica y consistente el estado `FINAL` o el estado `INFORMATIVE`, **nunca un estado intermedio, incompleto o mixto** (lecturas sucias o parciales). Esto sustenta las garantías verificadas en los tests de integración concurrentes [T023] y la configuración de adaptadores [T026].
- **Ventana de consistencia asíncrona**:
  El evento `habitacion.checkout` se procesa de forma asíncrona. Cada consulta devuelve el estado disponible en el momento de lectura: `INFORMATIVE` si 007 aún no ha persistido la liquidación y `FINAL` una vez persistida.
- **Flujo de Check-Out en Módulo 1**:
  `Modulo1/plan-registrar-check-out.md` confirma que M1 consulta la liquidación en los pasos 2 (Liquidación) y 3 (Revisión) antes de confirmar la salida física, y publica el evento `habitacion.checkout` en el paso 5 sin re-consultar. En el paso 3 se presentan exclusivamente: valor del hospedaje, comisión e ingreso neto (`netIncome = accommodationAmount - commission`), con `invoice: null`.

---

## Phase 1: Setup (Infraestructura Compartida)

**Purpose**: Verificar dependencias, contratos y coordinación de esquemas

- [ ] T001 Confirmar que las Fases 1 y 2 del plan base están completas: VOs compartidos (`Money`, `Channel`, `DateRange`), `PrismaService`, login JWT con roles (`Administrador`, `OTA`) y `ExceptionFilter` global
- [ ] T002 Confirmar que la feature 007 (`settlement`) tiene implementados `SettlementCalculator`, el modelo `Settlement` en Prisma y el cliente HTTP `Module2ReservationClient` con timeout de 500 ms y circuit breaker `opossum`
- [ ] T003 Coordinar con las features 007 y 006 la creación de los índices de consulta en base de datos: `@@index([reservationRef, roomId])` y `@@index([reservationRef])` sobre la tabla `settlement` (feature 007), y `@@index([settlement_id])` sobre `invoice` (feature 006)

---

## Phase 2: Foundational (Prerrequisitos Bloqueantes)

**Purpose**: Errores de dominio, DTOs tolerantes, puertos y adaptadores de lectura

**⚠️ CRITICAL**: Ninguna historia de usuario puede implementarse sin completar esta fase.

- [ ] T004 [P] Crear el error de dominio `SettlementNotFoundError` en `src/domain/errors/settlement-not-found.error.ts` y registrarlo en `domain-exception.filter.ts` mapeado a HTTP 404
- [ ] T005 [P] Crear los DTOs de transporte `GetSettlementQueryDto` en `src/infrastructure/adapters/in/http/dto/`:
  - Definición del parámetro query `categoryRoom` como nombre contractual acordado
  - Validación de `categoryRoom = DOBLE` para esta iteración
  - Parámetros tolerados e ignorados (`eventType`, `checkInDate`, `checkOutDate`, `source`) que no filtran ni alteran el resultado
  - `roomId` y `categoryRoom` marcados como opcionales para llamadas de OTAs
  - Validación de `reservationRef` como string opaco alfanumérico (no UUID)
- [ ] T006 Definir el puerto de entrada `GetSettlementUseCase` en `src/domain/ports/in/get-settlement.use-case.ts`, y los puertos de salida `SettlementQueryPort` y `SettlementInvoiceQueryPort` con sus tokens `Symbol` en `src/domain/ports/out/`
- [ ] T007 Implementar `PrismaSettlementQueryAdapter` en `src/infrastructure/adapters/out/persistence/repositories/prisma-settlement-query.adapter.ts` con transacciones `READ ONLY`, implementando búsqueda por `(reservationRef, roomId)` y por `reservationRef`
- [ ] T008 Implementar `PrismaSettlementInvoiceQueryAdapter` en `src/infrastructure/adapters/out/persistence/repositories/prisma-settlement-invoice-query.adapter.ts` con transacciones `READ ONLY`
- [ ] T009 Configurar controllers y providers en `src/infrastructure/config/settlement.module.ts` preparando los endpoints de consulta

**Checkpoint**: Fundación lista — la implementación de historias de usuario puede comenzar.

---

## Phase 3: User Story 1 - La OTA consulta el ingreso neto y la comisión de su propia reserva (Priority: P1)

**Goal**: La OTA consulta la liquidación definitiva de una reserva intermediada por ella mediante `reservationRef` (sin conocer `roomId`), accede al desglose y a la factura (si fue emitida), y recibe 404 anti-enumeración ante reservas ajenas o no liquidadas.

**Independent Test**: Sembrar en Postgres liquidaciones definitivas de canal directo, de Booking y de Expedia. Probar con un JWT de Booking que consulta su reserva con solo `reservationRef`, que recibe 404 ante reservas de Expedia o directas (sin revelar su existencia), y 404 al consultar una estancia sin check-out [SC-001, SC-002, SC-003].

### Tests for User Story 1

- [ ] T010 [P] [US1] Unit test de `GetSettlementService` para actor OTA:
  - Consulta exitosa de liquidación propia mediante `reservationRef` sin enviar `roomId` ni `categoryRoom`
  - Consulta exitosa con factura definitiva asociada
  - Intento de consulta de reserva ajena o de canal directo → lanza `SettlementNotFoundError` (HTTP 404 anti-enumeración, validando contra `settlement.otaId`, jamás 403) [SC-002]
  - Consulta de estancia sin liquidación generada → lanza `SettlementNotFoundError` (404 sin datos en cero) [SC-003] en `test/unit/application/settlement/get-settlement.service.spec.ts`
- [ ] T011 [P] [US1] Integration test de `PrismaSettlementQueryAdapter` contra Postgres real (Testcontainers): búsqueda por `(reservationRef, roomId)` y por `reservationRef`
- [ ] T012 [P] [US1] Contract test de `GET /api/settlements` para OTA (): verificación de headers, JWT con `role = OTA`, consulta sin `roomId` ni `categoryRoom` mediante `reservationRef` opaco, estructura JSON canónica anidada de respuesta (`settlementType`, `breakdown`, `invoice`), y respuesta 404 `SETTLEMENT_NOT_FOUND` uniforme para reservas no liquidadas o ajenas (anti-enumeración)

### Implementation for User Story 1

- [ ] T013 [US1] Implementar validación de actor OTA y control de pertenencia contra `settlement.otaId` con respuesta 404 anti-enumeración en `GetSettlementService`
- [ ] T014 [US1] Implementar en `GetSettlementService` la resolución de liquidación para OTAs basada en `reservationRef` cuando no se aporta `roomId`
- [ ] T015 [US1] Implementar en `SettlementsController` el endpoint externo `/api/settlements` protegido por `JwtAuthGuard` y `RolesGuard` (`role = OTA`)

**Checkpoint**: HU1 completa y verificable para actores OTA con seguridad anti-enumeración.

---

## Phase 4: User Story 2 - Módulo 1 consulta el resultado financiero de una habitación antes y después del check-out (Priority: P1)

**Goal**: Módulo 1 consulta la liquidación de una habitación tolerando sus parámetros. Si no tiene check-out, recibe una liquidación informativa (< 800 ms) sin persistirla. Si ya tiene check-out, recibe la liquidación `Final` idéntica. Si Módulo 2 falla o la reserva no existe, se informa el motivo sin datos supuestos.

**Independent Test**: Consultar desde M1 una habitación antes del check-out enviando `categoryRoom` y parámetros de check-out, verificando que retorna `settlementType: "INFORMATIVE"` y que la tabla `settlement` permanece vacía. Simular el check-out y volver a consultar verificando que retorna `settlementType: "FINAL"` con idénticos valores financieros [SC-006, SC-007, SC-008, SC-009].

### Tests for User Story 2

- [ ] T016 [P] [US2] Unit test de `GetSettlementService` para actor Módulo 1:
  - Consulta antes del check-out: invoca `ReservationClientPort`, `LodgingQuoteQueryPort`, `SettlementCalculator` y retorna informativa sin llamar a métodos de guardado [SC-006, SC-007]
  - Validación de `categoryRoom = DOBLE`
  - Parámetros operativos ignorados (`eventType`, `checkInDate`, `checkOutDate`, `source`, etc.) sin impacto en el resultado

  - Reserva no existe en Módulo 2 → `ReservationNotFoundError` (404) [SC-009]
  - Cotización no existe para `categoryRoom` → `QuoteNotFoundError` (404) [SC-009]
  - Módulo 2 caído o timeout → `Module2UnavailableError` (código HTTP sustituto de 503 ) [SC-009]
  - Consulta después del check-out: retorna liquidación `Final` persistida sin llamar a Módulo 2
  - Coincidencia exacta de montos entre informativa y final [SC-008]
- [ ] T017 [P] [US2] Integration test contra servidor HTTP simulado de Módulo 2: validar comportamiento ante respuesta 200, 404 y timeout de 500 ms con circuit breaker `opossum`
- [ ] T018 [P] [US2] Contract test de la consulta de Módulo 1: llamada interna sin token; parámetros `reservationRef`, `roomId`, `categoryRoom = DOBLE`; estructura canónica anidada, `invoice: null` en informativa y sin factura; errores funcionales definidos en contrato.

### Implementation for User Story 2

- [ ] T019 [US2] Implementar en `GetSettlementService` el flujo de cálculo informativo al vuelo para Módulo 1 invocando `SettlementCalculator` y los puertos correspondientes
- [ ] T021 [US2] Integrar el mapeo de errores `ReservationNotFoundError`, `QuoteNotFoundError` y `Module2UnavailableError` hacia el formato `ApiError`

**Checkpoint**: HU2 completa; Módulo 1 obtiene informativas y finales de forma aislada y tolerante.

---

## Phase 5: User Story 3 - La consulta nunca deja ambigüedad entre "sin liquidación", "informativa" y "liquidación `Final`" (Priority: P2)

**Goal**: Garantizar que la respuesta expone un discriminador inequívoco (`settlementType: "FINAL" | "INFORMATIVE"`), que las consultas repetidas no tienen efectos colaterales, y que concurrencias con el check-out resuelven de forma atómica.

**Independent Test**: Ejecutar consultas concurrentes y repetidas contra la misma estancia antes y durante el check-out, confirmando determinismo absoluto, ausencia de recálculos en la `Final` y ausencia de estados intermedios.

### Tests for User Story 3

- [ ] T022 [P] [US3] Unit test: verificar que ninguna respuesta contiene importes en cero por defecto ante inexistencia y que el campo `settlementType` es siempre explícito [SC-003, SC-007]
- [ ] T023 [P] [US3] Integration test: pruebas de concurrencia simulando una consulta durante la ejecución de una transacción de guardado de check-out, verificando aislamiento y ausencia de estados parciales
- [ ] T024 [P] [US3] Test de arquitectura (`dependency-cruiser`): verificar que `GetSettlementService` no importa ningún método de escritura (`insert`, `update`, `save`, `delete`) de ningún repositorio ni puerto [SC-004]

### Implementation for User Story 3

- [ ] T025 [US3] Garantizar la asignación explícita del discriminador `settlementType` en `SettlementResponseDto` y blindar los DTOs contra campos nulos no controlados
- [ ] T026 [US3] Aplicar transacción `READ ONLY` explícita en todos los adaptadores de persistencia de lectura de la feature

**Checkpoint**: Las tres historias de usuario operan de forma coherente, segura e inde.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verificación de rendimiento SLA, observabilidad y privacidad

- [ ] T027 [P] Prueba de carga y rendimiento de la consulta informativa con Módulo 2 simulado, verificando que el tiempo total de respuesta se mantiene **< 800 ms** en el percentil 95 (según acuerdo con Módulo 1)
- [ ] T028 [P] Auditoría de privacidad y datos sensibles: verificar que ninguna respuesta JSON incluye datos migratorios (SIRE), tipo de visa, documento o nacionalidad del huésped [FR-007, NFR-004]
- [ ] T029 [P] Logging estructurado de métricas de consulta (`reservationRef`, `callerType`, `settlementType`, duración en ms), excluyendo datos personales [NFR-004]
- [ ] T030 E2E test integral: M1 consulta informativa con `categoryRoom` → M1 emite check-out → M1 consulta Final → OTA consulta su liquidación con solo `reservationRef` → OTA consulta reserva ajena (404) en `test/e2e/consultar-liquidacion.e2e-spec.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: requiere que el plan base y las piezas fundamentales de `pricing` (005) y `settlement` (007) estén definidas. Coordinación de índices de BD con 007 y 006.
- **Foundational (Phase 2)**: bloquea todas las historias de usuario.
- **User Stories (Phase 3 a 5)**: HU1 y HU2 pueden implementarse en paralelo una vez completada la fase 2. HU3 consolida las garantías de ambas.
- **Polish (Phase 6)**: depende de las tres historias de usuario.

### Dependencies with Other Features

- **Feature 007 (`Generar liquidación`)**: bloqueante. 002 reutiliza `SettlementCalculator`, `ReservationClientPort` y lee la tabla `settlement`.
- **Feature 005 (`Consultar tarifa dinámica`)**: 002 utiliza `LodgingQuoteQueryPort` para leer cotizaciones guardadas.
- **Feature 006 (`Generar factura final`)**: 002 lee la tabla `invoice` para adjuntar la factura definitiva cuando ya esté emitida.
- **Feature 010 (`Registrar Check-out`)**: 010 dispara la persistencia que transforma una estancia de estado "informativo" a "liquidación `Final`".

---
