# Implementación: Generar factura final (006)

**Spec**: [generar_factura_final.md](../1-functional/generar_factura_final.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contratos**: [UC-generate-final-invoice.md](../2-technical/contracts/UC-generate-final-invoice.md) (caso de uso interno para 010) · [PORT-get-current-vat-rate.md](../2-technical/contracts/PORT-get-current-vat-rate.md) (lectura del IVA de 001)
**Rama**: `feature/006-generar-factura-final`

Este documento es el mapa de dónde está el código de la 006. El código no vive en esta carpeta: sigue la arquitectura hexagonal del plan base, así que está repartido por capas en `src/` y `test/`, siempre dentro de una subcarpeta `billing/`.

> Para encontrar todos los archivos de la 006 en VS Code: `Ctrl+Shift+F` y buscar `Feature 006`.

**Alcance de esta entrega**: Historias de usuario 1 y 2 completas. La 006 **no tiene endpoint**: es un caso de uso interno que invoca 010 (Registrar check-out) por cada evento de check-out válido; la prueba manual de punta a punta está en el [TC-010](../../010-registrar-checkout/4-testing/TC-010-registrar-checkout.md), sección 6. Aquí se verifica con pruebas automáticas (sección 4), organizadas por escenario en el caso de prueba [TC-006](../4-testing/TC-006-generar-factura-final.md). [revisar-facturas.sql](../4-testing/revisar-facturas.sql) tiene consultas de solo lectura para revisar las facturas y el consecutivo en la base.

---

## 1. Qué hace

Cuando se registra el check-out de una habitación, la 006 emite la **factura fiscal definitiva** de su liquidación `Final` (007):

```text
IVA   = hospedaje × IVA vigente / 100      half-up a 2 decimales (IVA de 001, congelado al emitir)
total = hospedaje + IVA                    lo que se cobra al huésped
comisión OTA e ingreso neto                se copian de 007 como referencia: no tocan el total
```

Ejemplo del plan: hospedaje de 750 000 por Booking (comisión 112 500, neto 637 500) con IVA 19 % → IVA **142 500** y total **892 500**.

| Dato | De dónde sale |
|---|---|
| Estancia, reserva, habitación, fechas, `eventId` | El evento de check-out (lo entrega 010 en el comando) |
| Nombre o razón social y documento fiscal | `billingCustomer` del mismo evento; nunca de la liquidación |
| Hospedaje, comisión, neto, canal, OTA | La liquidación `Final` de 007, sin recalcular |
| Porcentaje de IVA | `GetCurrentVatRateUseCase` de 001 |
| Número oficial y fecha de emisión | La base de datos, en la transacción que guarda la factura |

La factura **nunca cambia** y existe **una sola por estancia**: un reenvío del check-out devuelve la misma, con el mismo número, aunque el IVA haya cambiado.

---

## 2. Recorrido de una emisión

```text
010 ─► LoggedGenerateFinalInvoiceUseCase   log JSON: evento, estancia, factura, número, errorCode, duración (sin cliente)
    ─► GenerateFinalInvoiceService
         1. CheckoutData.of (007)        UUID, textos, fechas                                  → INVALID_CHECKOUT_EVENT
         2. findByStayId                 ¿ya hay factura? → la devuelve (sin 007 ni IVA)
         3. GenerateSettlementUseCase    liquidación Final existente o nueva (sin billingCustomer) → errores de 007
            guarda: Final y de esa estancia                                                    → FINAL_SETTLEMENT_NOT_FOUND
         4. BillingCustomer.tryFrom      nombre y documento completos; si no → NOT_ISSUED (sin número)
         5. GetCurrentVatRateUseCase     IVA vigente                                           → VAT_RATE_NOT_CONFIGURED / VAT_RATE_UNAVAILABLE
         6. InvoiceBreakdown.calculate   desglose con Money (DOMINIO, sin IO)
         7. issueIfAbsent                transacción: FOR UPDATE del consecutivo → 2.º chequeo → número + 1 → INSERT
                                                                                               → DATABASE_UNAVAILABLE
◄─── { status: 'ISSUED', invoice } | { status: 'NOT_ISSUED', reason: 'BILLING_CUSTOMER_DATA_MISSING' }
```

**Idea clave para explicar:** el número se asigna **solo** en el paso 7, dentro de la misma transacción que guarda la factura. Si algo falla antes, no se toca el consecutivo; si falla la transacción, el rollback revierte el número y la factura juntos. Por eso no se usa `nextval()`: una secuencia de PostgreSQL no se revierte y dejaría huecos.

---

## 3. Archivos por capa

### Dominio — reglas de negocio puras (sin NestJS ni Prisma)

| Archivo | Qué hace | Requisito |
|---|---|---|
| [billing-customer.ts](../../../src/domain/model/billing/billing-customer.ts) | Nombre y documento fiscal; `tryFrom` devuelve `null` si faltan o están en blanco | FR-008, FR-009, BR-004 |
| [invoice-breakdown.ts](../../../src/domain/model/billing/invoice-breakdown.ts) | Liquidación + IVA → desglose; `verified` comprueba `total = hospedaje + IVA` y `neto = hospedaje − comisión` | FR-002, FR-003, FR-004, FR-010 |
| [invoice.ts](../../../src/domain/model/billing/invoice.ts) | La factura: siempre `ISSUED`, `immutable`, congelada y sin métodos; `prepare` arma el borrador y `restore` la reconstruye | FR-006, FR-012 |
| [money.vo.ts](../../../src/domain/model/shared/money.vo.ts) | **Compartido.** La 006 agrega `isNegative` y `equals` | — |
| [errors/billing/](../../../src/domain/errors/billing/) | 2 errores nuevos: `FINAL_SETTLEMENT_NOT_FOUND` y `DATABASE_UNAVAILABLE` | FR-009, NFR-003 |
| [generate-final-invoice.use-case.ts](../../../src/domain/ports/in/billing/generate-final-invoice.use-case.ts) | Puerto de entrada, `GenerateFinalInvoiceCommand` y `GenerateFinalInvoiceResult` | FR-001, BR-001 |
| [invoice-issuance.repository.port.ts](../../../src/domain/ports/out/billing/invoice-issuance.repository.port.ts) | Puerto de salida: `findByStayId` e `issueIfAbsent` | FR-005, FR-007, FR-011 |

### Aplicación — caso de uso

| Archivo | Qué hace |
|---|---|
| [generate-final-invoice.service.ts](../../../src/application/services/billing/generate-final-invoice.service.ts) | Orquesta los pasos 1 a 7 del recorrido. Sin decoradores de NestJS |

### Infraestructura — adaptadores

| Archivo | Qué hace |
|---|---|
| [invoice.mapper.ts](../../../src/infrastructure/adapters/out/persistence/mappers/billing/invoice.mapper.ts) | Dominio ↔ fila de Prisma; importes como texto, número `bigint` ↔ entero |
| [prisma-invoice-issuance.repository.ts](../../../src/infrastructure/adapters/out/persistence/repositories/billing/prisma-invoice-issuance.repository.ts) | `READ COMMITTED` + `SELECT … FOR UPDATE` sobre el consecutivo, segundo chequeo, incremento e `INSERT` en una transacción. Ningún `UPDATE`/`DELETE` de `invoice`. Los fallos de conexión/timeout salen como `DATABASE_UNAVAILABLE`; un `CHECK` o una FK se propagan tal cual |
| [transient-persistence-error.ts](../../../src/infrastructure/adapters/out/persistence/transient-persistence-error.ts) | `isTransientPersistenceError`: decide qué errores de Prisma son transitorios (decisión 6). Lo comparten este repositorio y el decorador de 010 que traduce las fallas de 007 |
| [logged-generate-final-invoice.use-case.ts](../../../src/infrastructure/logging/billing/logged-generate-final-invoice.use-case.ts) | Log JSON por intento (T035), sin nombre ni documento fiscal (T034) |
| [billing.module.ts](../../../src/infrastructure/config/billing.module.ts) | Wiring por token. Importa `SettlementModule` (007). Sin controller nuevo. Exporta `GENERATE_FINAL_INVOICE_USE_CASE` para 010 |

### Base de datos

Migración [20261106120000_create_invoice](../../../prisma/migrations/20261106120000_create_invoice/migration.sql) y modelos `Invoice` e `InvoiceNumberCounter` en [schema.prisma](../../../prisma/schema.prisma):

- `invoice`: `UNIQUE(invoice_number)`, `UNIQUE(settlement_id)` (FK a `settlement`) y `UNIQUE(stay_id)`. Copia `reservation_ref`, `channel` y `ota_id` para que 008 no tenga que unir con `settlement`.
- `issued_at` con `clock_timestamp()` y no `now()`: `now()` es la hora en que empezó la transacción, antes de esperar el bloqueo, y desordenaría la fecha respecto del número.
- `invoice_number_counter`: una sola fila (`id = 1`, `last_number = 0`), creada por la migración y nunca reiniciada.
- `CHECK` escritos a mano: estado `ISSUED`, número > 0, moneda `COP`, cliente no vacío, datos de OTA coherentes con el canal, IVA de 0 a 100, importes no negativos y que el desglose cuadre.
- Los índices de búsqueda **no** están aquí: los agrega 008 en su propia migración (ver su plan).

---

## 4. Pruebas

| Archivo | Qué comprueba |
|---|---|
| [billing-customer.spec.ts](../../../test/unit/domain/billing/billing-customer.spec.ts) | Datos completos; casos ausentes, parciales o en blanco → `null` (T014) |
| [invoice-breakdown.spec.ts](../../../test/unit/domain/billing/invoice-breakdown.spec.ts) | Directo y OTA (ejemplo del plan), half-up con fracciones, IVA 0 %, hospedaje 0, determinismo, rechazos de integridad (T015, T023, T024) |
| [invoice.spec.ts](../../../test/unit/domain/billing/invoice.spec.ts) | `prepare` con los campos del contrato; `ISSUED`, inmutable y sin métodos; número, total y canal inválidos (T012) |
| [money.vo.spec.ts](../../../test/unit/domain/shared/money.vo.spec.ts) | `isNegative` y `equals` que agrega la 006 |
| [generate-final-invoice.service.spec.ts](../../../test/unit/application/billing/generate-final-invoice.service.spec.ts) | Las 2 historias con puertos simulados: directo, OTA, consecutivos, reenvío sin 007 ni IVA, IVA cambiado, carrera, `NOT_ISSUED` sin número, cada error sin número (T013–T016, T023) |
| [logged-generate-final-invoice.use-case.spec.ts](../../../test/unit/infrastructure/billing/logged-generate-final-invoice.use-case.spec.ts) | Log de `ISSUED`, `NOT_ISSUED` y rechazo; nunca el cliente (T034, T035) |
| [generate-final-invoice.contract.spec.ts](../../../test/contract/billing/generate-final-invoice.contract.spec.ts) | JSON exacto del ejemplo OTA del contrato, decimales como texto, `NOT_ISSUED`, campos ajenos ignorados, sin datos migratorios (T018, T026) |
| [prisma-invoice-issuance.repository.spec.ts](../../../test/integration/persistence/billing/prisma-invoice-issuance.repository.spec.ts) | PostgreSQL real: emitir y releer, OTA, reenvío, 5 emisiones simultáneas → 1 número, estancias en paralelo → consecutivos sin huecos, rollback sin consumir número, `CHECK` (T017, T025, T030–T032) |
| [generate-final-invoice.flow.spec.ts](../../../test/integration/billing/generate-final-invoice.flow.spec.ts) | De punta a punta como lo llama 010: 007 real con Módulo 2 simulado por HTTP + 001 + PostgreSQL. OTA y directo, reenvío con IVA cambiado, 3 entregas simultáneas, sin datos tributarios, IVA sin configurar y reintento, Módulo 2 caído, menos de 800 ms |
| [billing-dependencies.spec.ts](../../../test/architecture/billing-dependencies.spec.ts) | Solo 010 y 006 importan el caso de uso; ningún controller; dominio/aplicación sin Prisma ni NestJS; sin `UpdateVatRateUseCase`; sin `UPDATE`/`DELETE` de `invoice` ni `nextval` (T033) |

Las dos suites de integración necesitan `TEST_DATABASE_URL` con una base ya migrada (igual que las de 007). Con el PostgreSQL de `docker compose up -d` y las variables del `.env` cargadas:

```bash
DATABASE_URL="postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public" npx prisma migrate deploy
set -a; . ./.env; set +a; npm test
```

```powershell
$env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"
npm test
```

Las pruebas contra PostgreSQL se ejecutan con las suites de repositorio y flujo.

**Las dos suites se turnan** con [billing-test-database-lock.ts](../../../test/support/database/billing-test-database-lock.ts) (`pg_advisory_lock` con clave propia, igual que las de pricing): las dos emiten contra el mismo consecutivo global y comparan el contador antes y después. En paralelo, la otra suite podía emitir en medio y el contador quedaba adelantado (esperado 4, recibido 5). No era un fallo de la emisión, sino de las pruebas.

Dobles de prueba propios: [fake-invoice-ports.ts](../../../test/support/billing/fake-invoice-ports.ts) (007, IVA y emisión en memoria con consecutivo, y los datos de ejemplo del contrato).

---

## 5. Trazabilidad: requisito → código → prueba

| Requisito de la spec | Dónde se cumple | Dónde se prueba |
|---|---|---|
| FR-001 / BR-001 Interno, incluye a 007 | Sin endpoint; el servicio llama a `GenerateSettlementUseCase` | servicio; arquitectura |
| FR-002 / BR-005 IVA vigente, congelado | `GetCurrentVatRateUseCase` una vez por emisión nueva; `vat_rate_applied` sin FK | servicio ("IVA cambiado"); breakdown |
| FR-003 / FR-004 / BR-002 / SC-002 Total = hospedaje + IVA; comisión solo referencia | `InvoiceBreakdown` + `CHECK` | breakdown OTA; contrato; repositorio (CHECK) |
| FR-005 / FR-011 / NFR-003 / SC-001 Consecutivo único, en orden, sin huecos; toda liquidación `Final` con datos tributarios se factura | Contador con `FOR UPDATE` en la transacción de emisión | repositorio (concurrencia y rollback) |
| FR-006 / BR-003 / SC-005 Inmutable | `Invoice` congelada y sin métodos; repositorio sin `UPDATE`/`DELETE` | invoice.spec; arquitectura |
| FR-007 / SC-003 Reenvío idempotente | Paso 2 y segundo chequeo bajo el bloqueo | servicio; repositorio |
| FR-008 / FR-009 / BR-004 / SC-004 Datos tributarios del evento | `BillingCustomer.tryFrom` → `NOT_ISSUED` antes del IVA | billing-customer; servicio |
| FR-009 Sin liquidación Final → sin factura | Errores de 007 y guarda `FINAL_SETTLEMENT_NOT_FOUND` | servicio |
| FR-010 Desglose completo | Columnas de `invoice` y `InvoiceBreakdown.verified` | breakdown; contrato |
| FR-012 / NFR-004 Trazabilidad | `settlement_id`, `source_event_id`, `issued_at`; log | invoice.spec; repositorio; log |
| FR-013 / NFR-005 Sin datos migratorios ni personales de más | El comando no los acepta; el log no registra el cliente | contrato; log |
| FR-014 Consultable sin recalcular | La factura guarda todos los importes; 008/002 solo leen | (lo usan 008 y 002) |
| NFR-001 Determinismo | Cálculo puro con `Money` | breakdown |
| NFR-002 Emisión sin demoras perceptibles | Una sola transacción de emisión; sin llamadas externas salvo 007 | flujo (la emisión cabe en el presupuesto de 800 ms) |

---

## 6. Estado de las tareas del plan

| Tarea | Estado |
|---|---|
| T001–T003 (confirmar puertos de 010, 007 y 001) | Hecho: 007 y 001 exportan sus casos de uso; `GenerateFinalInvoiceUseCase` queda exportado para 010 |
| T004 (acordar campos con 002/008) | Hecho |
| T005–T011 (fundación) | Hecho |
| T012–T016, T018 (pruebas HU1) | Hecho |
| T017 (integración con Postgres) | Hecho: repositorio y flujo completo pasan contra PostgreSQL (ver sección 4) |
| T019–T022 (implementación HU1) | Hecho. T022: los códigos quedan listos; el mapeo a retry/DLQ lo hace 010 |
| T023, T024, T026 (pruebas HU2) | Hecho |
| T025 (lectura de factura) | Hecho: pasa contra PostgreSQL |
| T027–T028 (implementación HU2) | Hecho |
| T029 (008 y 002 leen solo de `invoice`) | Hecho |
| T030–T032 (concurrencia y rollback) | Hecho: pasan contra PostgreSQL |
| T033–T035 (arquitectura, privacidad, log) | Hecho |
| T036–T038 (documentación y tipos compartidos) | Hecho: este documento, el [TC-006](../4-testing/TC-006-generar-factura-final.md) y los tipos en el puerto de entrada |

---

## 7. Decisiones de implementación

Lo que no fijaban la spec, el plan ni los contratos:

1. **Comando y resultado junto al puerto de entrada** (`ports/in/billing/`), como en 005 y 007.
2. **Validación del comando con `CheckoutData` de 007**: mismos campos y mismo código (`INVALID_CHECKOUT_EVENT`), con el que 010 ya manda un evento inválido a dead-letter. Los UUID quedan en minúsculas.
3. **`billingCustomer` sin espacios sobrantes**: se guarda recortado; un campo solo con espacios cuenta como ausente.
4. **`sourceEventId` de la factura = `eventId` del comando** (el evento que la originó), no el de la liquidación; en operación normal coinciden.
5. **Segundo chequeo por estancia o por liquidación** (`OR`), porque las dos son únicas; la `UNIQUE` es la última defensa y, si salta, se devuelve la factura existente.
6. **Errores de base de datos**: solo los transitorios (conexión, timeout, conflicto de transacción: `P1001`, `P1002`, `P1008`, `P1017`, `P2024`, `P2028`, `P2034`, y errores de inicialización) son `DATABASE_UNAVAILABLE`. Un `CHECK` o una FK no se reintentan: salen como inesperados y 010 los manda a DLQ. La lista vive en [transient-persistence-error.ts](../../../src/infrastructure/adapters/out/persistence/transient-persistence-error.ts) y 010 la reutiliza para las fallas de 007, que llegan sin tipo.
7. **`issued_at` con `clock_timestamp()`**, por la misma razón que el historial de IVA de 001.
8. **Sin índices de búsqueda**: el plan de 008 los define y los crea en su migración; aquí solo están las `UNIQUE`.
9. **Migración `20261106120000`**, para no coincidir con la de 010 (`20261106000000_create_checkout_event_log`).
