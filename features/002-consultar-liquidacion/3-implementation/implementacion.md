# Implementación: Consultar liquidación (002)

**Spec**: [consultar_liquidacion.md](../1-functional/consultar_liquidacion.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contrato**: [GET-settlements.md](../2-technical/contracts/GET-settlements.md) (REST)
**Rama**: `implementation/002-consultar-liquidacion`

Este documento es el mapa de dónde está el código de la 002. El código no vive en esta carpeta: sigue la arquitectura hexagonal del plan base, así que está repartido por capas en `src/` y `test/`, siempre dentro de una subcarpeta `settlement/` (el mismo bounded context de la 007).

> Para encontrar todos los archivos de la 002 en VS Code: `Ctrl+Shift+F` y buscar `Feature 002`.

**Alcance**: las 3 Historias de usuario. Todo el plan está hecho (20 de 20 tareas).

---

## 1. Qué hace

Una sola ruta, `GET /api/settlements`, para dos actores:

| Quién | Cómo llama | Qué recibe |
|---|---|---|
| **Módulo 1** | Sin token, por la red interna, con `reservationRef` y `roomId` (`categoryRoom` es opcional e informativo) | **Una** liquidación. Si la habitación ya tuvo check-out, la `FINAL` que guardó la 007, con su factura si la 006 ya la emitió. Si no, una `INFORMATIVE` calculada en ese momento, **que no se guarda** |
| **La OTA** | Con su token (rol OTA y claim `otaId`) y `reservationRef` | **Todas** las liquidaciones `FINAL` de las habitaciones de su reserva que ya tuvieron check-out, ordenadas por `roomId`, cada una con su factura si existe. Nunca una informativa |

La consulta **solo lee**: no crea, cambia ni recalcula liquidaciones ni facturas. La informativa se calcula con las mismas piezas que la 007 (`channelTermsOf` y `SettlementCalculator`), así que da los mismos importes que tendrá la `FINAL`:

```text
lodgingAmount           = valor de la cotización (005)
baseLodgingAmount       = suma de la tarifa base de cada noche de la cotización
dynamicAdjustmentAmount = lodgingAmount − baseLodgingAmount      (puede ser negativo)
otaCommissionAmount     = lodgingAmount × % comisión / 100        (0.00 en canal directo)
netIncome               = lodgingAmount − otaCommissionAmount     (sin IVA: el IVA está solo en la factura)
```

Ejemplo de los datos del TC-002: cotización de 2 noches con tarifa base 300 000 en temporada Baja (−10 %) → hospedaje **540 000**, base 600 000, ajuste **−60 000**; con 15 % de comisión → comisión 81 000 y neto **459 000**.

Para la OTA, una reserva sin check-out, una reserva directa y una reserva de otra OTA dan **la misma respuesta** `404 SETTLEMENT_NOT_FOUND`, con el mismo mensaje, para que no pueda averiguar qué reservas existen.

---

## 2. Recorrido de una petición

```text
HTTP ─► NoStoreMiddleware            Cache-Control: no-store (también en los errores)
     ─► CorrelationIdMiddleware      X-Correlation-Id (de la base)
     ─► OptionalJwtAuthGuard         sin Authorization = Módulo 1; token inválido o vencido   → 401
     ─► SettlementAccessGuard        con token: rol distinto de OTA                             → 403
                                                 OTA sin claim otaId                            → 401
     ─► SettlementsController        pasa los parámetros tal cual + quién consulta + correlación
     ─► GetSettlementService
          parseSettlementQuery       reservationRef obligatorio; Módulo 1: roomId UUID           → 400
          ├─ OTA ─► PrismaSettlementQueryAdapter (READ ONLY): Final de la reserva con su otaId
          │         se vuelve a filtrar por OTA; ninguna                                        → 404
          │         ordenar por roomId; factura de cada una (PrismaSettlementInvoiceQueryAdapter)
          │   ◄── 200 { reservationRef, settlements: [ … ] }
          └─ Módulo 1 ─► 007 findByReservationAndRoom(reservationRef, roomId en minúsculas)
                    ├─ hay FINAL ─► su factura ◄── 200 { settlementType: "FINAL", … }
                    └─ no hay ─► 007 getReservation (Módulo 2)                                 → 404 / 424
                                 005 findByIds(quoteIds); la de ese roomId                      → 404
                                 007 channelTermsOf (canal y comisión)                          → 409
                                 007 SettlementCalculator (sin guardar nada)
                                 ◄── 200 { settlementType: "INFORMATIVE", categoryRoom: null, invoice: null, … }
```

---

## 3. Archivos por capa

### Dominio — reglas de negocio puras (sin NestJS ni Prisma)

| Archivo | Qué hace | Requisito |
|---|---|---|
| [settlement-query.ts](../../../src/domain/model/settlement/settlement-query.ts) | `parseSettlementQuery`: valida los parámetros según quién consulta (`SettlementCaller`: Módulo 1 o la OTA con su `otaId`) | FR-001, FR-013, BR-006 |
| [settlement-query-result.ts](../../../src/domain/model/settlement/settlement-query-result.ts) | La forma de la respuesta (`SettlementQueryResult`, `InvoiceSummary`), `finalSettlementResult` (la Final tal como se guardó) e `informativeSettlementResult` | FR-002, FR-003, FR-009, FR-010 |
| [settlement-not-found.error.ts](../../../src/domain/errors/settlement/settlement-not-found.error.ts) | `SETTLEMENT_NOT_FOUND` (404), con un único mensaje fijo | FR-005, FR-006 |
| [invalid-settlement-query.error.ts](../../../src/domain/errors/settlement/invalid-settlement-query.error.ts) | `INVALID_QUERY_PARAMS` (400), sin datos de la reserva | FR-013 |
| [get-settlement.use-case.ts](../../../src/domain/ports/in/settlement/get-settlement.use-case.ts) | Puerto de entrada `GetSettlementUseCase` | — |
| [settlement-query.port.ts](../../../src/domain/ports/out/settlement/settlement-query.port.ts) | Puerto de salida: Final de una reserva para una OTA | FR-002, FR-006 |
| [settlement-invoice-query.port.ts](../../../src/domain/ports/out/settlement/settlement-invoice-query.port.ts) | Puerto de salida: factura de una liquidación | FR-003 |

### Aplicación — caso de uso

| Archivo | Qué hace |
|---|---|
| [get-settlement.service.ts](../../../src/application/services/settlement/get-settlement.service.ts) | Orquesta el recorrido de la sección 2. Recibe un reloj (`now`) para que las pruebas tengan una hora fija. Sin decoradores de NestJS |

### Infraestructura — adaptadores

| Archivo | Qué hace |
|---|---|
| [settlements.controller.ts](../../../src/infrastructure/adapters/in/http/settlement/settlements.controller.ts) | `GET /api/settlements` y su documentación Swagger |
| [settlement-access.guard.ts](../../../src/infrastructure/adapters/in/http/settlement/settlement-access.guard.ts) | Sin token deja pasar (Módulo 1); con token exige rol OTA (403) y `otaId` (401) |
| [no-store.middleware.ts](../../../src/infrastructure/adapters/in/http/settlement/no-store.middleware.ts) | `Cache-Control: no-store` |
| [dto/settlement.dto.ts](../../../src/infrastructure/adapters/in/http/settlement/dto/settlement.dto.ts) | Parámetros y respuesta para Swagger |
| [prisma-settlement-query.adapter.ts](../../../src/infrastructure/adapters/out/persistence/repositories/settlement/prisma-settlement-query.adapter.ts) | `SELECT` de las Final por `reservationRef`, `otaId` y canal OTA |
| [prisma-settlement-invoice-query.adapter.ts](../../../src/infrastructure/adapters/out/persistence/repositories/settlement/prisma-settlement-invoice-query.adapter.ts) | `SELECT` de los 7 campos de la factura del contrato; lee la tabla `invoice` sin usar código de `billing` |
| [read-only-transaction.ts](../../../src/infrastructure/adapters/out/persistence/repositories/settlement/read-only-transaction.ts) | Transacción `READ ONLY` de los dos adaptadores anteriores |

### Archivos compartidos que tocó la 002

| Archivo | Cambio |
|---|---|
| [domain-exception.filter.ts](../../../src/infrastructure/adapters/in/http/domain-exception.filter.ts) | Una línea: `SETTLEMENT_NOT_FOUND: 404` |
| [settlement.module.ts](../../../src/infrastructure/config/settlement.module.ts) | Registra el controller, los dos adaptadores y el servicio; importa `AuthModule` para los guards; aplica el middleware `no-store` a `api/settlements` |

Se reutilizan sin cambios: de la 007, `findByReservationAndRoom`, `ReservationClientPort` (cliente de Módulo 2), `channelTermsOf`, `SettlementCalculator`, `SettlementMapper` y sus errores; de la 005, `LodgingQuoteQueryPort.findByIds`; de la base, `OptionalJwtAuthGuard` y `CorrelationIdMiddleware`.

### Base de datos

No hay migración: la 002 solo lee `settlement` (007), `invoice` (006) y, para la informativa, `lodging_quote` y `lodging_quote_night` (005) a través del puerto de la 005. Usa el índice `(reservation_ref, room_id)` que creó la 007.

---

## 4. Pruebas

Contadas con `jest --json` el 2026-11-07: **116 pruebas de la 002**, todas pasan.

| Archivo | Tipo | Pruebas | Qué verifica |
|---|---|---:|---|
| [settlement-query.spec.ts](../../../test/unit/domain/settlement/settlement-query.spec.ts) | Unitaria | 14 | Parámetros por actor, repetidos o que no son texto |
| [settlement-access.guard.spec.ts](../../../test/unit/infrastructure/settlement/settlement-access.guard.spec.ts) | Unitaria | 7 | Sin token, OTA con y sin `otaId`, otro rol |
| [no-store.middleware.spec.ts](../../../test/unit/infrastructure/settlement/no-store.middleware.spec.ts) | Unitaria | 1 | La cabecera |
| [settlements.controller.spec.ts](../../../test/unit/infrastructure/settlement/settlements.controller.spec.ts) | Unitaria | 5 | Quién consulta, correlación, fechas ISO, 404 del filtro |
| [get-settlement.service.spec.ts](../../../test/unit/application/settlement/get-settlement.service.spec.ts) | Unitaria | 13 | HU1: filtro por OTA, orden, anti-enumeración, errores |
| [get-settlement-module1.service.spec.ts](../../../test/unit/application/settlement/get-settlement-module1.service.spec.ts) | Unitaria | 22 | HU2: Final primero, informativa, coincidencia con la 007, no guarda, errores |
| [settlements.contract.spec.ts](../../../test/contract/settlement/settlements.contract.spec.ts) | Contrato | 23 | Forma exacta de las dos respuestas y de cada error del contrato |
| [prisma-settlement-query.adapter.spec.ts](../../../test/integration/persistence/settlement/prisma-settlement-query.adapter.spec.ts) | Integración (PostgreSQL) | 6 | Filtro por OTA, orden, `READ ONLY` rechaza escrituras |
| [prisma-settlement-invoice-query.adapter.spec.ts](../../../test/integration/persistence/settlement/prisma-settlement-invoice-query.adapter.spec.ts) | Integración (PostgreSQL) | 4 | Solo los campos del contrato, nunca los datos del cliente |
| [settlement-query-consistency.spec.ts](../../../test/integration/persistence/settlement/settlement-query-consistency.spec.ts) | Integración (PostgreSQL) | 5 | HU3: consulta durante el check-out, sin estado intermedio; la consulta no cambia nada |
| [settlements.e2e-spec.ts](../../../test/e2e/settlement/settlements.e2e-spec.ts) | E2E | 16 | De punta a punta; para Módulo 1, con el cliente HTTP real de la 007 contra un Módulo 2 simulado |

Proyecto completo el mismo día, con PostgreSQL: `npm test` 1048 pasan y 10 se omiten (las de RabbitMQ de la 010); `npm run test:e2e` 145 pasan y 3 se omiten. La prueba de arquitectura de la 007 (`settlement-dependencies.spec.ts`) pasa: ningún archivo de la 002 importa `billing` ni el cálculo de `pricing`.

Además se rompieron a propósito 23 reglas de la 002, una por vez (filtro por OTA, orden, 404, `READ ONLY`, número de factura, Final primero, minúsculas, elección y desempate de la cotización, correlación, comisión, reloj, `categoryRoom` nulo, entre otras): en cada caso alguna prueba falló, y el código se dejó como estaba.

---

## 5. Trazabilidad: requisito → código → prueba

| Requisito | Código | Prueba |
|---|---|---|
| FR-001 (parámetros por actor; `categoryRoom`) | `settlement-query.ts`, `informativeSettlementResult` | `settlement-query.spec`, contrato «categoryRoom nunca se refleja» |
| FR-002, SC-001 (desglose y habitaciones con check-out) | `forOta`, `finalSettlementResult` | `get-settlement.service.spec`, contrato OTA, e2e OTA |
| FR-003 (factura cuando existe) | `PrismaSettlementInvoiceQueryAdapter` | integración de facturas, contrato |
| FR-004, BR-001, SC-004 (solo lectura) | `read-only-transaction.ts`; sin escrituras en la 002 | integración «READ ONLY» y «no cambia ninguna liquidación ni factura» |
| FR-005, BR-004, SC-003 (sin liquidación = 404, nunca ceros) | `SettlementNotFoundError` | unitarias HU1, e2e anti-enumeración |
| FR-006, NFR-003, SC-002 (solo sus reservas) | adaptador + segundo filtro en el servicio | unitaria «aunque el adaptador no filtre», integración, e2e «otra OTA» |
| FR-007, NFR-004 (sin datos del huésped ni `billingCustomer`) | proyección del adaptador de facturas y de los DTO | contrato (campos prohibidos), integración de facturas |
| FR-008, NFR-002, SC-005, SC-008 (mismo resultado; informativa = Final) | mismas piezas que la 007 en `forModule1` | unitaria «coincide con Generar liquidación», repetidas, integración de consistencia |
| FR-009, FR-010, SC-006 (informativa identificada) | `forModule1`, `informativeSettlementResult` | unitarias HU2, contrato y e2e Módulo 1 |
| FR-011, BR-005, SC-007 (no se guarda) | el servicio no tiene puerto de escritura | unitaria «no guarda nada», TC-002 Sección 2 paso 3 |
| FR-012, SC-009 (motivo del error, sin parciales) | errores de la 007 | unitarias, contrato y e2e de errores |
| FR-013, BR-002, BR-006, SC-010 (acceso por actor) | guards + `parseSettlementQuery` | guard, contrato 400/401/403, e2e «sin token y sin roomId» |
| NFR-001 (p95 < 800 ms) | — | [medir-tiempos.js](../4-testing/medir-tiempos.js), ver sección 7 |

---

## 6. Estado de las tareas del plan

Las 20 tareas están marcadas en el [plan](../2-technical/plan.md):

| Fase | Tareas | Qué quedó |
|---|---|---|
| 1–2 | T001–T004 | Middleware, puertos, guard, errores y controller |
| 3 (HU1) | T005–T011 | Consulta de la OTA |
| 4 (HU2) | T012–T016 | Final o informativa para Módulo 1 |
| 5 (HU3) | T017 | Pruebas con PostgreSQL de lectura durante el check-out |
| 6 | T018–T020 | Tiempos, revisión final y esta documentación |

---

## 7. Decisiones de implementación

- **Un guard propio** (`SettlementAccessGuard`): `RolesGuard` responde 401 sin token, y aquí sin token es Módulo 1; el guard de la 005 vive en `pricing` y no exige `otaId`.
- **Validación en el dominio y no con un DTO de class-validator**: lo obligatorio depende de si hay token, y un parámetro puede llegar repetido o vacío.
- **Sin importar `billing`**: lo exige la prueba de arquitectura de la 007. Por eso `InvoiceSummary` se define en `settlement` y la factura se lee directo de la tabla `invoice`.
- **El adaptador ya filtra por OTA y el servicio vuelve a filtrar**: así, si alguien cambia el adaptador, ninguna liquidación ajena llega a la respuesta.
- **`roomId` en minúsculas antes de buscar**, igual que lo guarda la 007.
- **Desempate de cotizaciones como la 007**: si dos cotizaciones de la reserva fueran de la misma habitación (no debería pasar), se usa la de menor `quoteId`, para que la informativa coincida con la Final.
- **`findByReservationAndRoom` de la 007 se usa tal cual**, sin envolverlo en `READ ONLY`: es un único `SELECT`, que PostgreSQL ya lee de una sola instantánea, y envolverlo exigía cambiar código de la 007.
- **Mensaje de `RESERVATION_NOT_FOUND`**: es el de la 007 y dice «Verifica el código de reserva del check-out». En una consulta sería más claro otro texto; cambiarlo es tocar la 007, así que se dejó.
- **Tiempo de respuesta (T018)**: medido el 2026-11-07 con la aplicación compilada, PostgreSQL en Docker y el Módulo 2 simulado tardando 450 ms (casi el timeout de 500 ms), 200 consultas por tipo y 4 a la vez. OTA p95 45 ms, Final p95 27 ms, informativa p95 493 ms; **p95 total 478 ms < 800 ms**. Con 16 consultas a la vez y Módulo 2 a 450 ms, 9 de 200 informativas pasaron el timeout y respondieron `424 MODULE2_UNAVAILABLE`, como dice el contrato. **Riesgo**: con carga alta, un Módulo 2 tan lento hace fallar algunas informativas (solo se midió con 450 ms). Habrá que repetir la medición con Módulo 2 real.

---

## 8. Dependencias con otras features

| Feature | Qué usa la 002 |
|---|---|
| 007 Generar liquidación | La tabla `settlement`, `findByReservationAndRoom`, el cliente de Módulo 2, `channelTermsOf`, `SettlementCalculator` y sus errores |
| 006 Generar factura final | La tabla `invoice` (solo lectura) |
| 005 Consultar tarifa dinámica | `LodgingQuoteQueryPort.findByIds` (las cotizaciones guardadas) |
| 010 Registrar check-out | Es quien genera las Final y las facturas en la operación real |
| 003 Consultar comisión OTA | No depende de la 002 |

---

## 9. Cómo mostrarlo funcionando

Seguir el [TC-002](../4-testing/TC-002-consultar-liquidacion.md): carga los datos con [datos-tc-002.sql](../4-testing/datos-tc-002.sql), levanta el [Módulo 2 simulado](../4-testing/modulo2-simulado.js) y prueba en Swagger (<http://localhost:3000/docs>) la consulta de la OTA, la de Módulo 1 (Final e informativa) y los errores.
