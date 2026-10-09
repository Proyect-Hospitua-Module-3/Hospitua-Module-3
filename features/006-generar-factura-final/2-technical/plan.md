# Implementation Plan: Generar factura final

**Date**: 2026-10-09
**Spec**: [generar_factura_final.md](../1-functional/generar_factura_final.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Bounded context**: `billing`

## Summary

`Generar factura final` es un caso de uso interno del bounded context `billing`, disparado exclusivamente por el procesamiento del check-out. Orquesta `GenerateSettlementUseCase` (007) para obtener la liquidación `FINAL`, valida los datos tributarios recibidos en el evento de Módulo 1, obtiene el IVA vigente por `GetCurrentVatRateUseCase` (001), calcula con aritmética decimal exacta y persiste una factura fiscal inmutable.

La factura se identifica idempotentemente por `stayId`/`settlementId`: el mismo check-out devuelve el documento y número ya emitidos. El número oficial se asigna dentro de la misma transacción que persiste la factura, después de verificar que no existe una factura para esa liquidación. La comisión OTA y el ingreso neto se conservan como referencias de conciliación; el total cobrado al cliente es exclusivamente `lodgingAmount + vatAmount`.

No se expone endpoint ni se captura información tributaria por separado. `checkout-ingestion` (010) es el único punto de entrada externo; el caso de uso no recibe ni persiste datos migratorios.

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS
**Primary Dependencies**: NestJS 10.x, Prisma ORM, `decimal.js` dentro de `Money`, Jest, Testcontainers
**Storage**: PostgreSQL 16 — escritura en `invoice` y en el asignador transaccional de numeración; lectura de la `settlement` mediante el caso de uso 007 y del IVA mediante el caso de uso 001
**Testing**: Jest para dominio y aplicación; Jest + Testcontainers para concurrencia, atomicidad e idempotencia de persistencia; pruebas de integración para los casos de uso 001 y 007 con puertos simulados
**Target Platform**: Servicio backend Linux en contenedor Docker
**Project Type**: Servicio backend único (monolito modular hexagonal), bounded context `billing`, sin frontend
**Performance Goals**: La factura se emite durante el procesamiento asíncrono del check-out; las operaciones de aplicación y persistencia deben completarse sin esperas externas adicionales. Se conserva el timeout de 500 ms de Módulo 2 definido por 007 cuando sea necesario generar la liquidación.
**Constraints**: Una sola factura por liquidación; números oficiales únicos, estrictamente ordenados y sin huecos por fallos de transacción; idempotencia concurrente por estancia; factura inmutable; IVA fotografiado al emitir; datos tributarios completos antes de reservar número; `totalAmount = lodgingAmount + vatAmount`; comisión OTA solo informativa.
**Scale/Scope**: Un caso de uso interno, una entidad persistida (`invoice`), consumo de los casos de uso internos 007 y 001 y ningún endpoint o cliente HTTP nuevo.

## Project Structure

### Documentation (this feature)

```text
features/006-generar-factura-final/
├── 1-functional/
│   └── generar_factura_final.md
└── 2-technical/
    ├── plan.md
    └── contracts/
        ├── UC-generate-final-invoice.md
        └── PORT-get-current-vat-rate.md
```

### Source Code (repository root)

Solo se listan los archivos que 006 crea o modifica dentro de la arquitectura hexagonal definida en el plan base. Los casos de uso 001/007, los adaptadores HTTP de 008 y la entrada de mensajes de 010 son propiedad de sus respectivas features.

```text
src/
├── domain/
│   ├── model/
│   │   └── billing/
│   │       ├── invoice.ts                         # Factura ISSUED e inmutable
│   │       ├── invoice-breakdown.ts               # Snapshot de importes y tasa aplicada
│   │       └── billing-customer.ts                # Nombre/razón social y documento fiscal
│   ├── errors/
│   │   ├── billing-customer-data-missing.error.ts
│   │   ├── final-settlement-not-found.error.ts
│   │   ├── invoice-already-exists.error.ts        # Conflicto no idempotente, si aplica
│   │   └── invoice-number-allocation.error.ts
│   └── ports/
│       ├── in/
│       │   └── generate-final-invoice.use-case.ts
│       └── out/
│           └── invoice-issuance.repository.port.ts # Idempotencia + número + factura atómicos
│
├── application/
│   ├── services/
│   │   └── billing/
│   │       └── generate-final-invoice.service.ts
│   └── dto/
│       └── billing/
│           └── generate-final-invoice.command.ts   # Reutiliza los datos de entrada del check-out
│
└── infrastructure/
    ├── adapters/
    │   └── out/
    │       └── persistence/
    │           ├── mappers/
    │           │   └── invoice.mapper.ts
    │           └── repositories/
    │               └── prisma-invoice-issuance.repository.ts
    └── config/
        └── billing.module.ts                       # Wiring/exportación del caso de uso interno

prisma/
├── schema.prisma                                   # Invoice + estado transaccional del consecutivo
└── migrations/
    └── <timestamp>_create_invoice/
        └── migration.sql

test/
├── unit/
│   ├── domain/billing/invoice.spec.ts
│   └── application/billing/generate-final-invoice.service.spec.ts
├── integration/
│   └── persistence/billing/prisma-invoice-issuance.repository.spec.ts
└── contract/
    └── billing/
        └── generate-final-invoice.contract.spec.ts
```

**Structure Decision**: 006 se implementa dentro de `billing`, sin un bounded context adicional, endpoint propio ni acceso directo a las tablas de `settlement` o `vat_rate`. La persistencia usa Prisma, coherente con el stack base y los planes técnicos 007/008. La aplicación consume interfaces de los casos de uso 001/007; los controllers y el consumer de 010 no contienen lógica de facturación.

## Diseño técnico

### Entrada del caso de uso

`GenerateFinalInvoiceCommand` lleva los mismos datos de check-out que `GenerateSettlementCommand` de 007. `checkout-ingestion` (010) lo arma desde el mensaje `habitacion.checkout`; 006 reenvía esos datos a 007 cuando necesita generar u obtener la liquidación.

| Campo | Tipo | Obligatorio | Origen |
|---|---|---|---|
| `eventId` | UUID | Sí | `eventId` de Módulo 1; correlación y trazabilidad |
| `stayId` | UUID | Sí | Evento; idempotencia de liquidación y factura |
| `reservationRef` | string | Sí | Evento; reserva de la estancia |
| `roomId` | UUID | Sí | Evento; habitación liquidada |
| `roomType` | string | Sí | Evento; selección de cotización por 007 |
| `checkInDate`, `checkOutDate` | date `YYYY-MM-DD` | Sí | Evento; fechas reales validadas por 010 y revalidadas por 007 |
| `billingCustomer` | `{ name?, taxId? }` | No en el evento | Datos tributarios que Módulo 1 entrega en el check-out; obligatorios y completos para emitir |

El comando no acepta importes, IVA, comisión, canal, número de factura ni datos migratorios. Los importes/canal provienen de la liquidación inmutable de 007; el IVA proviene de 001; el número lo asigna la persistencia. Si el comando trae un objeto tributario parcial, se rechaza: nunca se mezclan nombre y documento de fuentes o intentos diferentes. Si no trae objeto tributario, se puede reutilizar el dato completo persistido en la liquidación; si ninguna fuente contiene ambos campos no vacíos, la emisión falla antes de asignar numeración. Un reenvío con los datos tributarios completados puede emitir la factura de una liquidación previamente generada sin modificarla.

### Puertos y dependencias

```ts
// Puerto de entrada, expuesto solo a checkout-ingestion (010)
export interface GenerateFinalInvoiceUseCase {
  generate(command: GenerateFinalInvoiceCommand): Promise<Invoice>;
}

// Dependencias internas ya definidas por las features 007 y 001:
// GenerateSettlementUseCase.generate(GenerateSettlementCommand): Promise<Settlement>
// GetCurrentVatRateUseCase.getCurrent(): Promise<VatRate>

// Puerto de salida de 006. `issueIfAbsent` reúne lectura, asignación
// transaccional del consecutivo y persistencia para no separar esos efectos.
export interface InvoiceIssuanceRepositoryPort {
  findByStayId(stayId: string): Promise<Invoice | null>;
  issueIfAbsent(draft: InvoiceDraft): Promise<Invoice>;
}
```

`InvoiceIssuanceRepositoryPort.issueIfAbsent` garantiza la idempotencia y la asignación/persistencia atómicas. Si otra solicitud ganó la emisión concurrente de la misma estancia, devuelve esa misma factura; la restricción `UNIQUE(settlement_id)` es la última defensa ante duplicados. El service solo depende de puertos y entidades, no de Prisma ni de NestJS.

### Flujo de `GenerateFinalInvoiceService.generate`

1. **Validar el comando**: requiere identificadores y fechas válidos; no hace I/O ni consume numeración si la entrada es inválida.
2. **Idempotencia rápida**: consulta `InvoiceIssuanceRepositoryPort.findByStayId(stayId)`. Si existe una factura emitida, la devuelve sin volver a leer el IVA, recalcularla o cambiar sus valores.
3. **Obtener la liquidación**: invoca `GenerateSettlementUseCase.generate` con los datos de check-out. 007 devuelve la liquidación `FINAL` existente o la genera idempotentemente. Sus errores tipados se propagan sin crear factura.
4. **Resolver cliente tributario**: usa el objeto completo del comando si se suministró; si no se suministró, usa el objeto completo persistido en la liquidación. Rechaza campos en blanco o un objeto parcial. No captura ni completa datos por inferencia.
5. **Obtener IVA vigente**: invoca `GetCurrentVatRateUseCase.getCurrent()` solo después de validar los datos tributarios. Guarda el valor exacto retornado como `vatRateApplied`, evitando que cambios posteriores afecten esta factura.
6. **Calcular el desglose** con `Money`/`decimal.js`, aritmética decimal exacta y redondeo half-up a dos decimales:
   - `vatAmount = lodgingAmount × vatRateApplied / 100`.
   - `totalAmount = lodgingAmount + vatAmount`.
   - `otaCommissionAmount` y `netIncome` se copian de la liquidación sin recalcularse. En canal directo la comisión sigue siendo `0.00`.
   - La comisión OTA y el neto son referencias de conciliación hotel/OTA; no se suman al total del huésped, no se restan del total y no se muestran como cargo.
7. **Emitir atómicamente**: entrega el draft a `issueIfAbsent`. En una transacción serializable por el asignador de números, la infraestructura vuelve a comprobar la factura por estancia, asigna el siguiente número oficial y guarda número + factura + datos de trazabilidad. Si ya existe por una carrera concurrente, devuelve el documento existente. Un rollback revierte tanto el contador como la factura.
8. **Devolver el documento persistido**: el caso de uso retorna la factura original o recién emitida; la reentrega del evento no crea otro documento ni número.

La persistencia de la liquidación y la de la factura no comparten una transacción distribuida. Si 007 guardó correctamente y falla la emisión, el evento no se confirma; al reintentarse, 007 devuelve la liquidación existente y 006 reintenta la factura. Si la factura se confirmó pero se perdió el ACK, el nuevo intento devuelve la misma factura.

### Modelo de dominio y persistencia

`Invoice` es un snapshot fiscal definitivo con estado `ISSUED`; no ofrece operaciones de modificación. `invoice` conserva los datos necesarios para las consultas de solo lectura de 008 y la consulta de liquidación definida por 002:

| Campo | Tipo/índice | Notas |
|---|---|---|
| `id` | UUID, PK | Identificador interno |
| `invoice_number` | bigint, UNIQUE | Consecutivo oficial asignado al emitir |
| `status` | text | Siempre `ISSUED` |
| `issued_at` | timestamptz | Hora de emisión |
| `settlement_id` | UUID, UNIQUE/FK | Liquidación `FINAL` de origen |
| `stay_id` | UUID, UNIQUE | Clave idempotente de la factura |
| `source_event_id` | UUID | Evento de check-out que originó la factura |
| `reservation_ref` | text | Copia inmutable para búsquedas de 008 |
| `channel`, `ota_id` | text, nullable | Copia inmutable de la liquidación; `ota_id` solo si es OTA |
| `customer_name`, `customer_tax_id` | text | Snapshot tributario autorizado para facturar |
| `currency` | char(3) | Moneda de la liquidación, actualmente `COP` |
| `lodging_amount`, `ota_commission_amount`, `net_income` | numeric(14,2) | Componentes exactos copiados de 007 |
| `vat_rate_applied` | numeric(5,2) | Tasa vigente al momento de emitir, no FK a `vat_rate` |
| `vat_amount`, `total_amount` | numeric(14,2) | Importes calculados y persistidos por 006 |

Las restricciones `UNIQUE(settlement_id)`, `UNIQUE(stay_id)` y `UNIQUE(invoice_number)` protegen la unicidad incluso ante concurrencia. Se crean índices para las búsquedas de 008 (`issued_at`, reserva/estancia, canal/OTA y cliente) según el plan de esa feature. La factura desnormaliza campos de lectura: 008 siempre lee los valores persistidos en `invoice` y nunca reconstruye ni recalcula el desglose.

### Numeración consecutiva y atomicidad

El consecutivo no se obtiene al validar el check-out, resolver el IVA ni construir el draft. La asignación se efectúa únicamente dentro de `issueIfAbsent`, que serializa brevemente la sección crítica de emisión, revalida `stayId`/`settlementId`, incrementa el último número y persiste el invoice en la misma transacción PostgreSQL. La fila de control del consecutivo se inicializa mediante migración y no se elimina ni reinicia al desplegar.

**Decisión frente al plan base**: el plan base propone una secuencia nativa de PostgreSQL. `nextval()` no se revierte al abortar una transacción y, por tanto, puede dejar huecos; tampoco se debe asumir que orden de asignación equivale a orden de commit bajo concurrencia. Para satisfacer la integridad consecutiva de FR-011/NFR-003 y los casos límite de la spec, 006 usa un contador transaccional bloqueado por fila. La asignación queda serializada y el incremento se revierte si la factura no se confirma. Antes de implementar, se debe reflejar esta excepción en el modelo transversal del plan base para que otros planes no vuelvan a asumir que una secuencia nativa ofrece numeración sin huecos.

La sección crítica debe ser corta y cubrir el segundo chequeo idempotente, actualización del contador e inserción. Fallos de constraint, almacenamiento o commit se reportan explícitamente; no se devuelve una factura simulada ni se confirma el evento. Una factura ya emitida nunca se borra para “reciclar” su número.

### Errores y respuesta de 010

006 no devuelve una respuesta HTTP y no crea un consumer; entrega errores de dominio tipados a 010, que aplica las reglas de ACK/DLQ del plan base:

| Error | `errorCode` | Reintentable | Acción de 010 |
|---|---|---:|---|
| `BillingCustomerDataMissingError` | `BILLING_CUSTOMER_DATA_MISSING` | No, requiere corregir datos del evento | Dead-letter; no se asignó número |
| `FinalSettlementNotFoundError` | `FINAL_SETTLEMENT_NOT_FOUND` | No | Dead-letter; no se creó factura |
| Errores tipados de 007 (reserva/cotización/comisión inválida) | Código original de 007 | No | Dead-letter |
| `Module2UnavailableError` propagado por 007 | `MODULE2_UNAVAILABLE` | Sí | No ACK; RabbitMQ reentrega |
| IVA vigente no disponible/error de lectura de 001 | `VAT_RATE_UNAVAILABLE` | Sí | No ACK; no se asignó número |
| Fallo transitorio de persistencia/commit | `DATABASE_UNAVAILABLE` | Sí | No ACK; transacción revierte contador y factura |
| Factura ya existente para la estancia | Sin error | No aplica | Se devuelve la factura existente |
| Conflicto de idempotencia con factura ganadora concurrente | Sin error | No aplica | Se devuelve la factura ganadora; nunca se crea otra |

Los errores siguen `ApiError` cuando se representen externamente, con mensaje accionable, sin incluir `billingCustomer` ni datos personales en logs. El evento solo se confirma después de que la factura esté persistida o se haya devuelto la existente.

### Observabilidad y privacidad

El log estructurado incluye `eventId`, `stayId`, `settlementId`, `invoiceId`/`invoiceNumber` si existe, resultado, `errorCode` y duración. No registra nombre, documento fiscal ni datos migratorios. La tabla de factura contiene únicamente los datos tributarios mínimos requeridos para el documento y trazabilidad financiera.

## Phase 1: Setup (específico de esta feature)

**Purpose**: Verificar los puertos internos y preparar el agregado `billing` para emitir.

- [ ] T001 Confirmar que el wiring de `billing` exporta `GenerateFinalInvoiceUseCase` solo a `checkout-ingestion` (010); ningún controller REST expone la operación.
- [ ] T002 Confirmar que 007 exporta `GenerateSettlementUseCase` y que su contrato acepta los datos del check-out más `billingCustomer`.
- [ ] T003 Confirmar que 001 exporta `GetCurrentVatRateUseCase.getCurrent()` y devuelve una tasa decimal validada; no consultar `vat_rate` directamente desde 006.
- [ ] T004 Acordar con 002/008 los campos copiados de la factura y mantener sus adaptadores en solo lectura.

**Checkpoint**: las dependencias internas están disponibles con contratos tipados y no hay un nuevo endpoint o integración externa.

## Phase 2: Foundational (prerrequisitos bloqueantes)

**Purpose**: Establecer las invariantes comunes a las dos historias.

- [ ] T005 Definir `BillingCustomer`, `InvoiceBreakdown` e `Invoice` inmutable en `domain/model/billing/`; validar montos no negativos, tasa válida, moneda y `totalAmount = lodgingAmount + vatAmount`.
- [ ] T006 Definir `GenerateFinalInvoiceCommand`, `GenerateFinalInvoiceUseCase` y `InvoiceIssuanceRepositoryPort` con sus tokens.
- [ ] T007 Definir `BillingCustomerDataMissingError`, `FinalSettlementNotFoundError` y `InvoiceNumberAllocationError`; registrar sus códigos y el error reintentable de IVA/BD en el mapeo compartido.
- [ ] T008 Crear esquema Prisma de `Invoice` con `UNIQUE(invoice_number)`, `UNIQUE(settlement_id)` y `UNIQUE(stay_id)`, campos snapshot y FK a `Settlement`.
- [ ] T009 Crear tabla/fila única transaccional para el consecutivo oficial, seed inicial documentado y migración atómica; no usar `nextval()` para este requisito de consecutivo sin huecos.
- [ ] T010 Implementar `InvoiceMapper` y `PrismaInvoiceIssuanceRepository.issueIfAbsent`: transacción con bloqueo del contador, segundo chequeo idempotente, incremento y creación atómicos; mapear conflictos de unicidad a la factura existente.
- [ ] T011 Configurar `BillingModule` para consumir 001/007 y exportar 006 al módulo de `checkout-ingestion`.

**Checkpoint**: entidad, almacenamiento, error handling y asignador de números preservan las invariantes bajo rollback y concurrencia.

## Phase 3: User Story 1 — Emitir factura final al registrar el check-out (Prioridad: P1)

**Goal**: Emitir una factura definitiva e idempotente para cada liquidación `FINAL` cuando los datos tributarios mínimos están disponibles.

**Independent Test**: procesar un check-out de canal directo con liquidación y cliente completos; verificar factura `ISSUED`, un número único, desglose correcto y mismo documento/número al repetir el mismo evento.

### Tests for User Story 1

- [ ] T012 [P] [US1] Unit tests de `Invoice`: solo acepta snapshots completos, estado `ISSUED`, moneda coherente y total igual a hospedaje más IVA; no ofrece mutadores.
- [ ] T013 [P] [US1] Unit tests de `GenerateFinalInvoiceService`: llama a 007, obtiene una liquidación `FINAL`, devuelve factura existente sin consultar IVA, y propaga errores de liquidación.
- [ ] T014 [P] [US1] Unit tests del flujo de validación tributaria: nombre y documento requeridos; ausente/parcial/vacío rechaza antes de IVA/persistencia; cliente completo nuevo permite reintentar liquidación existente que se guardó sin cliente.
- [ ] T015 [P] [US1] Unit tests de cálculo para canal directo: comisión `0.00`, IVA con redondeo half-up, total hospedaje + IVA.
- [ ] T016 [P] [US1] Unit tests de reenvío: misma estancia ya emitida devuelve número y valores originales incluso si cambió la tasa vigente.
- [ ] T017 [US1] Integration tests de `PrismaInvoiceIssuanceRepository` con Postgres: emisión, relectura por estancia, rollback y ausencia de incremento cuando falla la inserción.
- [ ] T018 [US1] Contract test interno del `GenerateFinalInvoiceUseCase`: comando válido, salida serializable decimal-string e invariantes de errores sin endpoint HTTP.

### Implementation for User Story 1

- [ ] T019 [US1] Implementar validación y resolución de `billingCustomer` desde el evento o, cuando el evento no lo trae, desde la liquidación existente; nunca combinar campos parciales.
- [ ] T020 [US1] Implementar `GenerateFinalInvoiceService.generate`: idempotencia, invocación de 007, validación tributaria, lectura de 001, cálculo y emisión mediante el puerto.
- [ ] T021 [US1] Implementar cálculo con `Money`/`decimal.js`, redondeo half-up a dos decimales; no usar `number` de JavaScript para importes.
- [ ] T022 [US1] Implementar el mapeo de errores para que 010 envíe fallos corregibles a DLQ y reintente indisponibilidad sin ACK.

**Checkpoint**: el flujo directo emite una factura una sola vez, sin número cuando falla una precondición.

## Phase 4: User Story 2 — Reflejar el desglose auditable, también para OTA (Prioridad: P2)

**Goal**: Exponer todos los valores de conciliación con semántica inequívoca y congelada al emitir.

**Independent Test**: con liquidación OTA de 750.000 COP, comisión 112.500 COP e IVA 19 %, verificar comisión y neto como referencias, IVA 142.500 COP y total huésped 892.500 COP; confirmar que comisión no altera ese total.

### Tests for User Story 2

- [ ] T023 [P] [US2] Unit test de canal OTA: conserva comisión/neto de 007, calcula IVA sobre hospedaje bruto y total sin restar ni sumar la comisión.
- [ ] T024 [P] [US2] Unit test de redondeo con fracciones de peso para IVA y total usando half-up a dos decimales.
- [ ] T025 [P] [US2] Integration test de lectura de factura: importes, canal, cliente mínimo, fecha y referencias coinciden exactamente con el snapshot emitido; no hay recálculo con el IVA actual.
- [ ] T026 [US2] Contract test con el modelo de detalle de 008: campos `invoiceNumber`, `ISSUED`, `immutable`, `settlementId`, `stayId`, `customer`, importes decimales string y timestamp.

### Implementation for User Story 2

- [ ] T027 [US2] Persistir el desglose explícito (`lodgingAmount`, `otaCommissionAmount`, `netIncome`, `vatRateApplied`, `vatAmount`, `totalAmount`) y `channel`/`otaId` como valores snapshot.
- [ ] T028 [US2] Documentar en el mapper/contrato que `commissionAmount` es referencia comercial, no componente cobrado al huésped; `totalAmount` siempre es `lodgingAmount + vatAmount`.
- [ ] T029 [US2] Verificar que 008 obtiene todos los importes exclusivamente desde `invoice` y que 002 puede consultar la factura sin recalcularla.

**Checkpoint**: los canales directo y OTA producen el desglose fiscal y de conciliación conforme a la spec.

## Phase 5: Integridad, concurrencia y privacidad

**Purpose**: Probar las condiciones límite que protegen consecutivo, idempotencia e inmutabilidad.

- [ ] T030 Integration test concurrente: dos emisiones del mismo `stayId` producen un solo invoice y un solo número; ambas reciben el mismo resultado.
- [ ] T031 Integration test concurrente de estancias distintas: números únicos estrictamente consecutivos; el orden de commit coincide con el orden asignado.
- [ ] T032 Integration test de fallo después de reservar el número pero antes de confirmar invoice: la transacción revierte tanto el contador como la factura; la próxima emisión reutiliza el siguiente consecutivo no consumido.
- [ ] T033 Test de arquitectura: 006 no importa adaptadores Prisma concretos en aplicación/dominio, no llama a `UpdateVatRateUseCase` y no expone endpoint externo.
- [ ] T034 Revisar logs y selección de campos para asegurar que no contienen datos migratorios ni `billingCustomer`.
- [ ] T035 Logging estructurado de resultado, correlación, IDs y duración sin datos personales.

**Checkpoint**: concurrencia, rollback y reintentos no duplican facturas ni abren huecos en el consecutivo; el documento queda inmutable.

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T036 Documentar el contrato de integración con 010, el puerto de IVA 001 y la salida de factura consumida por 008.
- [ ] T037 Confirmar la transacción de emisión es corta y solo serializa la sección crítica del consecutivo; no envolver llamadas a 001/007 en la transacción de Postgres.
- [ ] T038 Publicar/actualizar las definiciones de tipos compartidos que consumen 002 y 008 sin añadir rutas de escritura para invoices.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** depende del scaffolding y puertos compartidos del plan base y de que 001/007 expongan los casos de uso definidos en sus planes.
- **Foundational (Phase 2)** precede toda historia: entidad, migración, errores, concurrencia e inyección.
- **User Story 1 (Phase 3)** depende de 007 para obtener liquidación y de 001 para leer el IVA vigente.
- **User Story 2 (Phase 4)** depende de la entidad y el flujo de emisión de US1.
- **Integridad (Phase 5)** depende de la emisión implementada y cubre sus condiciones de concurrencia/rollback.
- **Polish (Phase 6)** depende de las fases anteriores y de los contratos de lectura de 002/008.

### Dependencias con otras features

- **010 Registrar Check-out** es el único adaptador de entrada que invoca este caso de uso y confirma el evento después de que 006 devuelve factura persistida o existente.
- **007 Generar liquidación** provee la liquidación `FINAL` idempotente y los importes de hospedaje, comisión y neto.
- **001 Actualizar porcentaje de IVA** provee `GetCurrentVatRateUseCase`; 006 solo lee la tasa actual y congela su valor en la factura.
- **002 Consultar liquidación** y **008 Gestionar facturación** consumen la factura persistida en modo de solo lectura.

## Notes

- El total de la factura interpreta el desglose de acuerdo con FR-003/BR-002: `lodgingAmount + vatAmount`. La comisión OTA se muestra para conciliación y no se agrega ni se resta del total cobrado al huésped, aunque FR-010 enumere hospedaje, comisión, IVA y total como campos del desglose.
- La numeración sin huecos requiere contador transaccional, no `nextval()` de PostgreSQL. Esta excepción al plan base se documenta para que se concilie en la arquitectura compartida antes de implementar la migración.
- El rechazo por falta de datos tributarios conserva la liquidación ya generada, no reserva número y puede reintentarse al recibir un evento con datos tributarios completos.
- No se implementa aquí emisión correctiva, anulación, reimpresión con nuevo número, endpoint de alta/edición de facturas ni captura interactiva de datos tributarios.
- Si una regla legal externa impone formato, prefijo, período o resolución de numeración, esos parámetros requieren una decisión regulatoria aparte; este plan cubre la secuencia consecutiva descrita en la spec.
