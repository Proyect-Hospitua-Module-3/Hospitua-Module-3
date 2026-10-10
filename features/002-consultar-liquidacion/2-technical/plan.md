# Implementation Plan: Consultar liquidación

**Fecha**: 2026-10-09
**Spec**: [consultar_liquidacion.md](../1-functional/consultar_liquidacion.md)
**Plan Base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Contrato**: [GET-settlements.md](contracts/GET-settlements.md)

## Summary

La feature expone `GET /api/settlements` en un único `settlements.controller.ts`. Módulo 1 obtiene una liquidación individual final o informativa; una OTA obtiene la colección de liquidaciones finales de la reserva propia. La consulta de resultados finales no muta datos [FR-001–FR-011].

## Technical Context

- NestJS y arquitectura hexagonal según el Plan Base.
- Autenticación: llamada interna sin token para Módulo 1; con token se valida `role = OTA` y `otaId`. Otros roles reciben 403.
- La consulta informativa usa `SettlementCalculator`, `ReservationClientPort` y `LodgingQuoteQueryPort`, sin persistencia [SPEC FR-009, FR-011].
- La llamada a Módulo 2 utiliza timeout de 500 ms y circuit breaker como en 007. Objetivo de la consulta informativa: p95 menor a 800 ms.
- Las lecturas de persistencia usan transacción `READ ONLY`. La respuesta se marca `Cache-Control: no-store` y acepta/propaga `X-Correlation-Id` [CONV].

## Project Structure

```text
src/
├── domain/
│   ├── model/settlement/
│   │   └── settlement-query-result.ts
│   └── ports/
│       ├── in/get-settlement.use-case.ts
│       └── out/
│           ├── settlement-query.port.ts
│           └── settlement-invoice-query.port.ts
├── application/
│   ├── services/settlement/get-settlement.service.ts
│   └── dto/settlement/settlement-response.dto.ts
└── infrastructure/
    ├── adapters/
    │   ├── in/http/settlements.controller.ts
    │   └── out/persistence/repositories/
    │       ├── prisma-settlement-query.adapter.ts
    │       └── prisma-settlement-invoice-query.adapter.ts
    └── config/settlement.module.ts

test/
├── unit/application/settlement/get-settlement.service.spec.ts
├── integration/persistence/settlement/prisma-settlement-query.adapter.spec.ts
├── contract/settlement/settlements.contract.spec.ts
└── e2e/consultar-liquidacion.e2e-spec.ts
```

**Structure Decision**: Se usa la estructura por capas del plan base con settlement como subcarpeta. Un único settlements.controller.ts atiende a Módulo 1 y a la OTA; GetSettlementService concentra la orquestación.

## Diseño técnico

### Entrada y autorización

`settlements.controller.ts` implementa la única ruta `GET /api/settlements`. El guard distingue la llamada interna sin token de la petición con token: la petición autenticada requiere rol OTA y claim `otaId`. La validación de parámetros y la separación de respuestas siguen [GET-settlements.md](contracts/GET-settlements.md).

### Casos de consulta

Para Módulo 1, se busca primero por `(reservationRef, roomId)` usando `SettlementRepositoryPort.findByReservationAndRoom` de 007. Si existe, se devuelve la `FINAL` y su factura si está emitida. Si no existe, se calcula `INFORMATIVE` con `SettlementCalculator`, datos de reserva de `ReservationClientPort` y cotización de `LodgingQuoteQueryPort`; no se persiste.

Para OTA, `SettlementQueryPort.findByReservationRef(reservationRef): Settlement[]` devuelve los resultados finales visibles para el `otaId` autenticado. Las liquidaciones se ordenan por `roomId`. La ausencia, reserva directa o reserva perteneciente a otra OTA produce `SETTLEMENT_NOT_FOUND` para conservar la respuesta anti-enumeración.

`PrismaSettlementQueryAdapter` implementa `SettlementQueryPort`; `PrismaSettlementInvoiceQueryAdapter` implementa `SettlementInvoiceQueryPort`, consulta la factura por `settlementId` y proyecta exclusivamente el subconjunto definido en el contrato. 002 no define ni crea índices de persistencia.

### Puertos

```ts
interface SettlementQueryPort {
  findByReservationRef(reservationRef: string): Promise<Settlement[]>;
}

interface SettlementInvoiceQueryPort {
  findBySettlementId(settlementId: string): Promise<InvoiceSummary | null>;
}
```

`SettlementRepositoryPort.findByReservationAndRoom` se reutiliza desde 007 y no se redefine aquí.

### Errores

| Condición | Código | HTTP |
|---|---|---:|
| Parámetros obligatorios inválidos | `INVALID_QUERY_PARAMS` | 400 |
| Token ausente/inválido en petición autenticada | `UNAUTHENTICATED` | 401 |
| Token con rol distinto de OTA | `FORBIDDEN` | 403 |
| Sin resultado visible para OTA | `SETTLEMENT_NOT_FOUND` | 404 |
| Reserva inexistente en cálculo informativo | `RESERVATION_NOT_FOUND` | 404 |
| Cotización inexistente | `QUOTE_NOT_FOUND` | 404 |
| Módulo 2 no disponible | `MODULE2_UNAVAILABLE` | 424 |
| Comisión ausente o inválida | `MISSING_COMMISSION` / `INVALID_COMMISSION` | 409 |

### Consistencia

Cada lectura se ejecuta como transacción `READ ONLY`. Si el check-out se procesa al mismo tiempo, la consulta ve la liquidación informativa antes de que se guarde la `FINAL` o la liquidación `FINAL` después del guardado; nunca observa un estado intermedio. Módulo 1 consulta antes de confirmar el check-out y no necesita consultar después del evento asíncrono.

## Fases y tareas

### Setup

- [ ] **T001** Crear el módulo de consulta y la estructura de entrada HTTP.

### Foundational

- [ ] **T002** Definir puertos de consulta de liquidaciones por reserva y factura por `settlementId`.
- [ ] **T003** Configurar el guard y el mapeo de errores `ApiError` para acceso interno y OTA.

### User Story 1 — OTA consulta finales de su reserva

**Pruebas primero**

- [ ] **T004** Pruebas unitarias para autorización OTA, filtro de pertenencia, colección ordenada y resultado vacío.
- [ ] **T005** Pruebas de integración de lectura de liquidaciones y factura asociada, sin mutación.
- [ ] **T006** Contract test de la respuesta OTA como colección y objeto de liquidación del contrato.
- [ ] **T007** Pruebas e2e de `GET /api/settlements` con token OTA y respuestas anti-enumeración.

**Implementación**

- [ ] **T008** Implementar `PrismaSettlementQueryAdapter` para consultar finales por `reservationRef` y proyectarlas ordenadas por habitación.
- [ ] **T009** Implementar `PrismaSettlementInvoiceQueryAdapter` para consultar la factura por `settlementId` y aplicar la proyección contractual.
- [ ] **T010** Implementar el `GetSettlementService` (puerto `GetSettlementUseCase`) para consulta OTA y su respuesta `SETTLEMENT_NOT_FOUND` para reservas no visibles.

### User Story 2 — Módulo 1 consulta resultado individual

**Pruebas primero**

- [ ] **T011** Pruebas unitarias de selección `FINAL`/`INFORMATIVE`, ausencia de reserva/cotización y comisión ausente/inválida.
- [ ] **T012** Pruebas de integración de `READ ONLY` y lectura concurrente sin estado intermedio.
- [ ] **T013** Contract test de respuesta individual y errores de cálculo informativo.
- [ ] **T014** Pruebas e2e de llamada interna sin token, parámetros requeridos y headers de no-cache/correlación.

**Implementación**

- [ ] **T015** Reutilizar `SettlementRepositoryPort.findByReservationAndRoom` de 007.
- [ ] **T016** Implementar cálculo informativo con los puertos de 005/007, sin persistir.
- [ ] **T017** Implementar el único controller `settlements.controller.ts` y mapear los errores.

### Polish

- [ ] **T018** Verificar el objetivo p95 menor a 800 ms con Módulo 2 respondiendo dentro del timeout de 500 ms.
- [ ] **T019** Revisar que la consulta final sea de solo lectura y que todas las respuestas coincidan con el contrato.

## Dependencies & Execution Order

`T001` precede a `T002`–`T003`. La User Story 1 puede implementarse tras Foundational; la User Story 2 depende además de los puertos y servicios de consulta de 005/007. `GetSettlementService` implementa el puerto `GetSettlementUseCase`. Las pruebas de cada historia preceden a su implementación. `T018`–`T019` cierran la feature.

## Notes

Los puertos de liquidación existentes en 007 se reutilizan. 002 agrega únicamente las consultas descritas aquí y no administra índices ni escritura de liquidaciones.
