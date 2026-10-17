# Implementation Plan: Consultar tarifa base

**Fecha**: 2026-10-09
**Spec**: [consultar_tarifa_base.md](../1-functional/consultar_tarifa_base.md)
**Plan Base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Contrato**: [CLIENT-get-base-rate.md](contracts/CLIENT-get-base-rate.md)

## Summary

El servicio interno `GetBaseRateService` (puerto `GetBaseRateUseCase`) del contexto `pricing` consulta a Módulo 1 el importe de tarifa base por `roomId` y fecha. No expone controller ni consumer de entrada; `pricing.module.ts` exporta el puerto para los servicios de la feature 005 [FR-001, FR-005].

## Technical Context

**Language/Version**: TypeScript 5.x sobre Node.js 20 LTS, según el Plan Base.
**Primary Dependencies**: NestJS 10.x, cliente HTTP de NestJS (`@nestjs/axios`) y `opossum` para el circuit breaker.
**Storage**: Sin persistencia ni caché de tarifa base; el importe se obtiene de Módulo 1 en cada consulta.
**Testing**: Jest (dominio y servicio con puertos mockeados), Jest + servidor HTTP simulado (200, 404 estructurado, 404 sin cuerpo, timeout, 5xx y circuito abierto), contract test de la respuesta definida en el contrato.
**Target Platform**: Servicio backend Linux en contenedor Docker, dentro del monolito modular del Módulo 3.
**Project Type**: Servicio interno saliente en arquitectura hexagonal; no expone controller ni consumer.
**Performance Goals**: Cada consulta se resuelve o falla en máximo 500 ms.
**Constraints**: Módulo 1 administra la tarifa base; lectura por `roomId` y fecha; respuestas y errores según `CLIENT-get-base-rate.md`; timeout de 500 ms [SPEC NFR-002]; circuit breaker opossum: se abre tras 5 fallos seguidos y prueba de nuevo a los 30 s [PLAN].
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
│   │   ├── malformed-base-rate-response.error.ts
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

`GetBaseRateService` valida que `roomId` tenga formato UUID y que la fecha sea válida en formato `YYYY-MM-DD` antes de invocar `BaseRateClientPort`. Si la entrada no es válida, lanza `InvalidBaseRateQueryError` con `INVALID_QUERY_PARAMS` (HTTP 400) sin llamar a Módulo 1. El puerto de entrada `GetBaseRateUseCase` expone `execute(roomId: string, date: string): Promise<BaseRate>`.

```ts
interface GetBaseRateUseCase {
  execute(roomId: string, date: string): Promise<BaseRate>;
}

interface BaseRateClientPort {
  getBaseRate(roomId: string, date: string): Promise<BaseRate>;
}
```

`BaseRate` contiene el importe como `Money` de `domain/model/shared/` y la moneda COP, sin usar punto flotante. Su construcción garantiza un importe estrictamente positivo. No incluye período de vigencia ni una respuesta-unión externa.

### Adaptador HTTP

El adaptador implementa la petición del contrato `CLIENT-get-base-rate.md`. Inserta el `roomId`, ya validado como UUID, en la ruta sin transformarlo. Si `baseRate` es texto decimal con valor menor o igual a cero, lanza `InvalidBaseRateError`; este error no cuenta como fallo del circuit breaker y se traduce a `INVALID_BASE_RATE`. La estructura inválida, el cuerpo no JSON, los campos ausentes, el tipo incorrecto, `baseRate` como número JSON o no decimal, la moneda distinta de COP y el eco discordante de `roomId` o `date` lanzan `MalformedBaseRateResponseError`; este error cuenta como fallo del circuit breaker y se traduce a `MODULE1_UNAVAILABLE`. El timeout es de 500 ms y el circuit breaker opossum se abre tras 5 fallos seguidos y prueba de nuevo a los 30 s. El adaptador no persiste ni cachea datos.

### Errores

La feature no expone un controller. Los códigos HTTP son códigos `ApiError` que consume la feature 005 al invocar el servicio; no son respuestas HTTP propias de 004.

| Error de dominio | Código ApiError | HTTP |
|---|---|---:|
| `BaseRateNotFoundError` | `BASE_RATE_NOT_FOUND` | 404 |
| `InvalidBaseRateQueryError` | `INVALID_QUERY_PARAMS` | 400 |
| `InvalidBaseRateError` | `INVALID_BASE_RATE` | 424 |
| `MalformedBaseRateResponseError` | `MODULE1_UNAVAILABLE` | 424 |
| `Module1UnavailableError` | `MODULE1_UNAVAILABLE` | 424 |

## Fases y tareas

## Phase 1: Setup

- [ ] T001 [P] Crear la estructura `pricing` y configurar el módulo NestJS conforme al Plan Base.

## Phase 2: Foundational

- [ ] T002 [P] Definir `BaseRateClientPort`, el modelo `BaseRate` y los errores de dominio `InvalidBaseRateQueryError`, `InvalidBaseRateError` y `MalformedBaseRateResponseError`.
- [ ] T003 Registrar el adaptador HTTP y exportar el puerto `GetBaseRateUseCase` desde `pricing.module.ts`.

## Phase 3: User Story 1 — Consulta exitosa por habitación y fecha (Priority: P1)

**Goal**: Obtener de Módulo 1 una tarifa base válida para la habitación identificada por su `roomId` y la fecha consultados.

**Independent Test**: Verificar el modelo, el servicio, la respuesta HTTP válida y el contrato de éxito.

### Tests for User Story 1

- [ ] T004 [P] [US1] Crear pruebas unitarias del modelo `BaseRate` para `Money` positivo y moneda COP [SPEC FR-001, FR-006].
- [ ] T005 [P] [US1] Crear pruebas unitarias de `GetBaseRateService` para el camino exitoso y consultas independientes por fecha [SPEC FR-001, FR-003].
- [ ] T006 [P] [US1] Crear pruebas de integración del cliente HTTP para una respuesta `200` válida, timeout de 500 ms y circuit breaker que se abre tras 5 fallos seguidos y prueba de nuevo a los 30 s.
- [ ] T007 [P] [US1] Crear contract test del éxito definido en `CLIENT-get-base-rate.md` [SPEC SC-001].

### Implementation for User Story 1

- [ ] T008 [P] [US1] Implementar el modelo `BaseRate` con `Money` y los errores de dominio `InvalidBaseRateError` y `MalformedBaseRateResponseError`.
- [ ] T009 [US1] Implementar `GetBaseRateService` y su puerto de salida.
- [ ] T010 [US1] Implementar el adaptador HTTP con validación y traducción diferenciada: importe decimal no positivo a `InvalidBaseRateError` y respuestas malformadas a `MalformedBaseRateResponseError`.
- [ ] T011 [US1] Exportar el puerto `GetBaseRateUseCase` para consumo interno desde `pricing.module.ts`.

## Phase 4: User Story 2 — El cálculo se detiene sin tarifa utilizable (Priority: P1)

**Goal**: Detener el cálculo invocante cuando falte una tarifa utilizable o la entrada no sea válida.

**Independent Test**: Verificar ausencia estructurada, respuestas inválidas y fallas de dependencia, y comprobar que entradas inválidas no llaman al puerto.

### Tests for User Story 2

- [ ] T012 [P] [US2] Crear pruebas de servicio para `roomId` sin formato UUID y fecha inválida, verificando que no invocan el puerto.
- [ ] T013 [P] [US2] Crear pruebas de integración HTTP para `404` estructurado, `404` sin cuerpo, importe decimal no positivo, moneda distinta, `roomId` o fecha discordantes, `baseRate` numérico o no decimal, cuerpo no JSON, campos ausentes, tipo incorrecto, timeout, `5xx` y circuito abierto [SPEC FR-004, SC-002, SC-003]. El importe decimal no positivo debe producir `INVALID_BASE_RATE` y no incrementar el contador ni abrir el circuito; las respuestas malformadas deben producir `MODULE1_UNAVAILABLE` y contar como fallos del circuito.

### Implementation for User Story 2

- [ ] T014 [US2] Completar la validación de entrada en `GetBaseRateService` y la traducción de errores en el adaptador.

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T015 Ejecutar las suites unitarias, de integración y contract test; verificar que cada fecha se consulta independientemente, que no se persiste ni cachea tarifa base, que el timeout es de 500 ms y que el circuit breaker se abre tras 5 fallos seguidos y prueba de nuevo a los 30 s [SPEC FR-002, FR-003, FR-005, SC-004, SC-005].

## Dependencies & Execution Order

`T001` precede a `T002` y `T003`. Las pruebas de User Story 1 (`T004`–`T007`) preceden a la implementación (`T008`–`T011`). Las pruebas de User Story 2 (`T012`–`T013`) preceden a `T014`. `T015` cierra ambas fases. Los consumidores internos de 005 dependen de la exportación del puerto de entrada.

## Notes

004 consulta una fecha por llamada y satisface FR-003 al resolver cada fecha de forma independiente, sin caché ni agrupación. La iteración del rango de noches (entrada inclusiva y salida exclusiva) corresponde a la feature 005. La respuesta del cliente y la clasificación de errores se describen en `CLIENT-get-base-rate.md` [SPEC FR-006, SC-002, SC-003, SC-005].
