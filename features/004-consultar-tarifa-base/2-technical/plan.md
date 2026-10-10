# Implementation Plan: Consultar tarifa base

**Fecha**: 2026-10-09
**Spec**: [consultar_tarifa_base.md](../1-functional/consultar_tarifa_base.md)
**Plan Base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Contrato**: [CLIENT-get-base-rate.md](contracts/CLIENT-get-base-rate.md)

## Summary

El servicio interno `GetBaseRateService` (puerto `GetBaseRateUseCase`) del contexto `pricing` consulta a Módulo 1 el importe de tarifa base por tipo de habitación y fecha. No expone controller ni consumer de entrada; `pricing.module.ts` exporta el puerto para los servicios de la feature 005 [FR-001, FR-005].

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS, según el Plan Base.
**Primary Dependencies**: NestJS 10.x, cliente HTTP de NestJS (`@nestjs/axios`) y `opossum` para el circuit breaker.
**Storage**: Sin persistencia ni caché de tarifa base; el importe se obtiene de Módulo 1 en cada consulta.
**Testing**: Jest (dominio y servicio con puertos mockeados), Jest + servidor HTTP simulado (200, 404 estructurado, 404 sin cuerpo, timeout, 5xx y circuito abierto), contract test de la respuesta definida en el contrato.
**Target Platform**: Servicio backend Linux en contenedor Docker, dentro del monolito modular del Módulo 3.
**Project Type**: Servicio interno saliente en arquitectura hexagonal; no expone controller ni consumer.
**Performance Goals**: Cada consulta se resuelve o falla en máximo 500 ms.
**Constraints**: Módulo 1 administra la tarifa base; lectura por tipo de habitación y fecha; respuestas y errores según `CLIENT-get-base-rate.md`; resiliencia según la configuración por cliente del Plan Base.
**Scale/Scope**: Un servicio de consulta, un puerto de salida HTTP y un modelo `BaseRate`, exportado para uso interno de la feature 005.

## Project Structure

```text
src/
├── domain/
│   ├── model/
│   │   ├── shared/money.vo.ts (reutilizado del Plan Base)
│   │   └── pricing/base-rate.ts
│   ├── errors/
│   │   ├── base-rate-not-found.error.ts
│   │   ├── invalid-base-rate.error.ts
│   │   ├── invalid-base-rate-query.error.ts
│   │   └── module1-unavailable.error.ts
│   └── ports/
│       ├── in/get-base-rate.use-case.ts
│       └── out/base-rate.client.port.ts
├── application/
│   └── services/pricing/get-base-rate.service.ts
└── infrastructure/
    ├── adapters/out/http/module1-base-rate.client.ts
    └── config/pricing.module.ts

test/
├── unit/
│   ├── domain/pricing/base-rate.spec.ts
│   └── application/pricing/get-base-rate.service.spec.ts
├── integration/http/module1-base-rate.client.spec.ts
└── contract/pricing/module1-base-rate.contract.spec.ts
```

**Structure Decision**: Se usa la estructura por capas del plan base con `pricing` como subcarpeta. No hay controllers ni consumers: `pricing.module.ts` exporta `GetBaseRateUseCase` para los servicios de la feature 005.

## Diseño técnico

### Servicio y puerto

`GetBaseRateService` valida que el tipo de habitación no esté vacío y que la fecha sea válida en formato `YYYY-MM-DD` antes de invocar `BaseRateClientPort`. Si la entrada no es válida, lanza `InvalidBaseRateQueryError` con `INVALID_QUERY_PARAMS` (HTTP 400) sin llamar a Módulo 1. El puerto de entrada `GetBaseRateUseCase` expone `execute(roomType, date): Promise<BaseRate>`.

```ts
interface GetBaseRateUseCase {
  execute(roomType: string, date: string): Promise<BaseRate>;
}

interface BaseRateClientPort {
  getBaseRate(roomType: string, date: string): Promise<BaseRate>;
}
```

`BaseRate` contiene el importe como `Money` de `domain/model/shared/` y la moneda COP, sin usar punto flotante. Su construcción garantiza un importe estrictamente positivo. No incluye período de vigencia ni una respuesta-unión externa.

### Adaptador HTTP

El adaptador implementa la petición del contrato `CLIENT-get-base-rate.md`. Codifica `roomType` en la URL con `encodeURIComponent` y envía el valor recibido sin transformarlo. Valida los campos presentes, que `baseRate` sea texto decimal estrictamente positivo, que `currency` sea `COP` y que los valores de `roomType` y `date` coincidan con los solicitados antes de construir `BaseRate`. Una respuesta inválida lanza `InvalidBaseRateError`; el circuit breaker la cuenta como fallo y el servicio la traduce a `MODULE1_UNAVAILABLE`. El timeout y el circuit breaker siguen la configuración por cliente del Plan Base. El adaptador no persiste ni cachea datos.

### Errores

La feature no expone un controller. Los códigos HTTP son códigos `ApiError` que consume la feature 005 al invocar el servicio; no son respuestas HTTP propias de 004.

| Error de dominio | Código ApiError | HTTP |
|---|---|---:|
| `BaseRateNotFoundError` | `BASE_RATE_NOT_FOUND` | 404 |
| `InvalidBaseRateQueryError` | `INVALID_QUERY_PARAMS` | 400 |
| `InvalidBaseRateError` | `MODULE1_UNAVAILABLE` | 424 |
| `Module1UnavailableError` | `MODULE1_UNAVAILABLE` | 424 |

## Fases y tareas

## Phase 1: Setup

- [ ] T001 [P] Crear la estructura `pricing` y configurar el módulo NestJS conforme al Plan Base.

## Phase 2: Foundational

- [ ] T002 [P] Definir `BaseRateClientPort`, el modelo `BaseRate` y los errores de dominio, incluido `InvalidBaseRateQueryError`.
- [ ] T003 Registrar el adaptador HTTP y exportar el puerto `GetBaseRateUseCase` desde `pricing.module.ts`.

## Phase 3: User Story 1 — Consulta exitosa por tipo y fecha (Priority: P1)

**Goal**: Obtener de Módulo 1 una tarifa base válida para el tipo de habitación y la fecha consultados.

**Independent Test**: Verificar el modelo, el servicio, la respuesta HTTP válida y el contrato de éxito.

### Tests for User Story 1

- [ ] T004 [P] [US1] Crear pruebas unitarias del modelo `BaseRate` para `Money` positivo y moneda COP [SPEC FR-001, FR-006].
- [ ] T005 [P] [US1] Crear pruebas unitarias de `GetBaseRateService` para el camino exitoso y consultas independientes por fecha [SPEC FR-001, FR-003].
- [ ] T006 [P] [US1] Crear prueba de integración del cliente HTTP para una respuesta `200` válida.
- [ ] T007 [P] [US1] Crear contract test del éxito definido en `CLIENT-get-base-rate.md` [SPEC SC-001].

### Implementation for User Story 1

- [ ] T008 [P] [US1] Implementar el modelo `BaseRate` con `Money` y los errores de dominio.
- [ ] T009 [US1] Implementar `GetBaseRateService` y su puerto de salida.
- [ ] T010 [US1] Implementar el adaptador HTTP con validación y traducción de respuestas del contrato.
- [ ] T011 [US1] Exportar el puerto `GetBaseRateUseCase` para consumo interno desde `pricing.module.ts`.

## Phase 4: User Story 2 — El cálculo se detiene sin tarifa utilizable (Priority: P1)

**Goal**: Detener el cálculo invocante cuando falte una tarifa utilizable o la entrada no sea válida.

**Independent Test**: Verificar ausencia estructurada, respuestas inválidas y fallas de dependencia, y comprobar que entradas inválidas no llaman al puerto.

### Tests for User Story 2

- [ ] T012 [P] [US2] Crear pruebas de servicio para tipo vacío y fecha inválida, verificando que no invocan el puerto.
- [ ] T013 [P] [US2] Crear pruebas de integración HTTP para `404` estructurado, `404` sin cuerpo, importe inválido, moneda distinta, tipo o fecha discordantes, `baseRate` numérico, cuerpo no JSON, campos ausentes, timeout, `5xx` y circuito abierto [SPEC FR-004, SC-002, SC-003].

### Implementation for User Story 2

- [ ] T014 [US2] Completar la validación de entrada en `GetBaseRateService` y la traducción de errores en el adaptador.

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T015 Ejecutar las suites unitarias, de integración y contract test; verificar que cada fecha se consulta independientemente y que no se persiste ni cachea tarifa base [SPEC FR-002, FR-003, FR-005, SC-004, SC-005].

## Dependencies & Execution Order

`T001` precede a `T002` y `T003`. Las pruebas de User Story 1 (`T004`–`T007`) preceden a la implementación (`T008`–`T011`). Las pruebas de User Story 2 (`T012`–`T013`) preceden a `T014`. `T015` cierra ambas fases. Los consumidores internos de 005 dependen de la exportación del puerto de entrada.

## Notes

004 consulta una fecha por llamada y satisface FR-003 al resolver cada fecha de forma independiente, sin caché ni agrupación. La iteración del rango de noches (entrada inclusiva y salida exclusiva) corresponde a la feature 005. La respuesta del cliente y la clasificación de errores se describen en `CLIENT-get-base-rate.md` [SPEC FR-006, SC-002, SC-003, SC-005].
