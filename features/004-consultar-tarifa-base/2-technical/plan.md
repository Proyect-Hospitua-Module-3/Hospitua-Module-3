# Implementation Plan: Consultar tarifa base

**Date**: 2026-10-07
**Spec**: [consultar_tarifa_base.md](../1-functional/consultar_tarifa_base.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Contrato consumido**: [GET-rooms-base-rate.md](contracts/GET-rooms-base-rate.md)

---

## Summary

`Consultar tarifa base` es un caso de uso **interno, reactivo y exclusivamente de solo lectura** perteneciente al *bounded context* `pricing` de Módulo 3. No expone un endpoint REST propio ni cuenta con controllers HTTP de entrada: su único propósito es ser consumido internamente por el servicio de tarifa dinámica (`GetDynamicRateService`, feature 005) y por el servicio de cotización de hospedaje (`CreateLodgingQuoteService`, feature 005) [FR-001, FR-007; BASE].

Enfoque técnico: Módulo 3 solicita síncronamente a Módulo 1 la tarifa base regular vigente para una categoría de habitación (`roomType`) y fecha específica mediante el puerto de salida `BaseRateClientPort`, implementado por el adaptador HTTP `Module1BaseRateClient`. La llamada se ejecuta por la red interna sin token, con timeout de 500 ms y circuit breaker (`opossum`) como decisiones internas de Módulo 3. El servicio de aplicación `GetBaseRateService` valida categoría y fecha, invoca al cliente y construye `BaseRate` a partir del importe y la vigencia aplicables recibidos. El contrato disponible no define el esquema JSON de la respuesta. Módulo 1 es el dueño absoluto del dato: Módulo 3 no guarda, no persiste en PostgreSQL y no cachea la tarifa base bajo ninguna circunstancia [FR-002, NFR-003, BR-001]. La no retroactividad [BR-004] la garantizan las cotizaciones guardadas en la feature 005 (`lodging_quote`); la feature 004 es exclusivamente de lectura y no hace nada adicional.

---

## Technical Context

- **Language/Version**: TypeScript 5.x sobre Node.js 20 LTS (según proyecto base)
- **Primary Dependencies**: NestJS 10.x, `decimal.js` (aritmética decimal exacta dentro del VO `Money`), `opossum` (circuit breaker del cliente HTTP hacia Módulo 1), `@nestjs/axios` (cliente HTTP NestJS basado en Axios)
- **Storage**: N/A — No aplica persistencia. Módulo 3 no posee tablas de tarifa base en PostgreSQL ni utiliza mecanismos de caché en memoria o Redis; cada consulta refleja el estado vivo en Módulo 1 [FR-002, NFR-003]
- **Testing**:
  - Jest para pruebas unitarias de dominio (`BaseRate`, validación de montos y períodos) y de aplicación (`GetBaseRateService` con puertos mockeados)
  - Jest + servidor HTTP simulado para pruebas de integración de `Module1BaseRateClient` (200 OK, 404s específicos, timeout, fallas 5xx y circuito abierto opossum; HTTP 503 excluido por restricción académica)
  - Contract testing del payload JSON devuelto por Módulo 1
  - Tests de arquitectura (`dependency-cruiser` / Jest) para verificar ausencia de persistencia y caché
- **Target Platform**: Servicio backend Linux en contenedor Docker (red interna Docker Compose)
- **Project Type**: Servicio backend único (monolito modular hexagonal) — componente interno sin controller REST propio
- **Performance Goals**: La consulta a Módulo 1 debe completarse en un tiempo que no genere demoras perceptibles dentro del cálculo de tarifa dinámica [NFR-002]; timeout configurable propuesto de 500 ms (`MODULE1_TIMEOUT_MS=500`)
- **Constraints**:
  - Frontera arquitectónica estricta: Módulo 1 es dueño del dato; Módulo 3 solo consulta y nunca altera ni guarda la tarifa [FR-002, FR-007, BR-001]
  - Determinismo estricto: idéntica consulta e idéntico estado producen siempre el mismo resultado [NFR-001]
  - No retroactividad [BR-004]: la inmutabilidad de los cálculos previos la garantiza el guardado de cotizaciones en 005; 004 no hace nada adicional
  - Sin valores por defecto ni ceros: ante ausencia de tarifa o falla técnica, se detiene el proceso sin asumir tarifas ni ceros [BR-003]
  - Unicidad por fecha y detección de ambigüedad: solapamiento de vigencias reportado por Módulo 1 detiene el cálculo [FR-005, BR-002]
  - Consulta noche a noche: quien requiera un rango de fechas (feature 005) consulta fecha por fecha [FR-003]
  - Distinción taxativa entre ausencia de tarifa (error de negocio 404) y falla de comunicación técnica (timeout / 5xx / circuito abierto) [FR-008]
- **Scale/Scope**: 1 historia de usuario (HU1), 1 caso de uso interno (`GetBaseRateUseCase`), 1 cliente HTTP saliente (`Module1BaseRateClient`), sin endpoints ni tablas propias

---

## Project Structure

### Documentation (this feature)

```text
features/004-consultar-tarifa-base/
├── 1-functional/
│   └── consultar_tarifa_base.md           # Spec funcional (fuente de verdad de negocio)
└── 2-technical/
    ├── contracts/
    │   └── GET-rooms-base-rate.md         # Operación de tarifa base definida en Plan Base
    └── plan.md                            # Este archivo
```

### Source Code (repository root)

Solo se listan los archivos que esta feature crea o utiliza dentro de la estructura hexagonal por capas del proyecto base (`pricing` como subcarpeta de cada capa).

```text
src/
├── domain/
│   ├── model/
│   │   ├── shared/
│   │   │   └── money.vo.ts                         # (reutilizado de fase 2 base) monto con decimal.js + moneda COP
│   │   └── pricing/
│   │       ├── base-rate.ts                        # Entidad/VO Tarifa base (roomType, date, rate: Money, validityPeriod)
│   │       └── validity-period.vo.ts               # Value Object del período de vigencia (validFrom, validTo)
│   ├── errors/
│   │   ├── domain.error.ts                         # (reutilizado de fase 2 base) Error base de dominio
│   │   ├── base-rate-not-found.error.ts            # FR-006: no existe tarifa base aplicable
│   │   ├── invalid-room-type.error.ts              # FR-009 (tipo inexistente en catálogo)
│   │   ├── invalid-base-rate-query.error.ts        # FR-001 (fecha con formato o valor calendario inválido)
│   │   ├── ambiguous-base-rate.error.ts            # FR-005, BR-002 (vigencias solapadas)
│   │   ├── invalid-base-rate.error.ts              # FR-006 (valor <= 0, no numérico o moneda distinta de COP)
│   │   └── module1-unavailable.error.ts            # FR-008 (falla técnica: timeout, 5xx, 400/4xx inesperado, circuito abierto)
│   └── ports/
│       ├── in/
│       │   └── get-base-rate.use-case.ts           # Puerto de entrada primario: GetBaseRateUseCase y GetBaseRateQuery
│       └── out/
│           └── base-rate.client.port.ts            # Puerto de salida secundario: BaseRateClientPort
│
├── application/
│   └── services/
│       └── pricing/
│           └── get-base-rate.service.ts            # Orquesta: validación, consulta a Módulo 1, solapamiento y armado
│
└── infrastructure/
    ├── adapters/
    │   └── out/
    │       └── http/
    │           ├── module1-base-rate.client.ts     # Implementa BaseRateClientPort con opossum y timeout de 500 ms
    │           └── dto/
    │               └── module1-base-rate-response.dto.ts # DTO con tipado de la respuesta HTTP de Módulo 1
    └── config/
        └── pricing.module.ts                       # Binding de BaseRateClientPort y exportación de GetBaseRateUseCase

test/
├── unit/
│   ├── domain/pricing/
│   │   └── base-rate.spec.ts                       # Validaciones de BaseRate (<=0, no numérico, Money, vigencia)
│   └── application/pricing/
│       └── get-base-rate.service.spec.ts           # Pruebas del servicio con BaseRateClientPort mockeado
├── integration/
│   └── http/
│       └── module1-base-rate.client.spec.ts        # Cliente real contra servidor HTTP simulado (200, 404s, timeout, CB)
├── contract/
│   └── pricing/
│       └── module1-base-rate.contract.spec.ts      # Validación del esquema JSON de respuesta de Módulo 1
└── architecture/
    └── pricing/
        └── base-rate-no-persistence.spec.ts        # Verificación de que 004 no persiste en BD ni implementa caché
```

**Structure Decision**: La feature se ubica enteramente en el *bounded context* `pricing`, respetando el aislamiento estricto de capas. No incluye adaptadores de entrada HTTP (`controllers`) ni consumers de mensajería porque ningún actor externo la invoca directamente; `pricing.module.ts` expone el token de `GetBaseRateUseCase` para que lo inyecte `GetDynamicRateService` (feature 005). La capa `domain/` no contiene referencias a NestJS ni dependencias de infraestructura de red; toda interacción con Axios y `opossum` se confina a `Module1BaseRateClient`.

---

## Diseño técnico

### Entrada y salida del caso de uso

El caso de uso recibe una consulta de solo lectura (`GetBaseRateQuery`):

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `roomType` | string | Sí | Categoría de la habitación (p. ej. `DOBLE`, `SUITE`) [FR-001, FR-009] |
| `date` | string | Sí | Fecha calendario de la noche consultada en formato `YYYY-MM-DD` [FR-001, FR-003] |

Devuelve la entidad inmutable `BaseRate`:

| Campo | Tipo | Descripción |
|---|---|---|
| `roomType` | string | Categoría de habitación validada |
| `date` | string | Fecha calendario consultada (`YYYY-MM-DD`) |
| `rate` | `Money` | Importe monetario exacto (`decimal.js`), moneda `COP`, estrictamente mayor que cero [FR-006] |
| `validityPeriod` | `ValidityPeriod` | Período temporal que respalda la tarifa (`validFrom`, `validTo`) [FR-001] |

### Puertos

```ts
// src/domain/ports/in/get-base-rate.use-case.ts
export const GET_BASE_RATE_USE_CASE = Symbol('GET_BASE_RATE_USE_CASE');

export interface GetBaseRateQuery {
  roomType: string;
  date: string;
}

export interface GetBaseRateUseCase {
  execute(query: GetBaseRateQuery): Promise<BaseRate>;
}

// src/domain/ports/out/base-rate.client.port.ts
export const BASE_RATE_CLIENT_PORT = Symbol('BASE_RATE_CLIENT_PORT');

export interface BaseRateClientPort {
  getBaseRate(roomType: string, date: string): Promise<BaseRate>;
}

export interface Module1BaseRateResult {
  amount: Money;
  validityPeriod: ValidityPeriod;
}
```

### Flujo de `GetBaseRateService.execute`

1. Valida `roomType` y `date` (`YYYY-MM-DD`) como parámetros de la consulta.
2. Invoca `BaseRateClientPort.getBaseRate(roomType, date)`.
3. Ante `404 BASE_RATE_NOT_FOUND`, informa que no hay tarifa aplicable; el contrato no distingue entre categoría desconocida y falta de vigencia. Ante `424 MODULE1_UNAVAILABLE` o falla técnica de comunicación, detiene la consulta sin estimar un importe.
4. Cuando existe tarifa aplicable, construye el resultado interno con el importe y el período de vigencia que cubre la fecha. La documentación disponible no define el esquema JSON de la respuesta de Módulo 1, por lo que el plan no prescribe nombres de campos externos.

El servicio es de solo lectura y nunca realiza escrituras en base de datos ni mutaciones en Módulo 1 [FR-002, FR-007].

### Cliente HTTP de Módulo 1 (`Module1BaseRateClient`)

- Realiza una petición `GET {MODULE1_BASE_URL}/rooms/{roomType}/base-rate?date={date}` utilizando `@nestjs/axios`.
- **Sin token de autenticación**: Comunicación intermódulo por la red interna Docker sin cabeceras de autorización [BASE Autenticación].
- Inyecta cabecera `X-Correlation-Id` si existe en el contexto para trazabilidad distribuida.
- **Circuit Breaker con `opossum`**:
  - Configuración: `timeout: 500` (`MODULE1_TIMEOUT_MS`), `volumeThreshold: 5`, `errorThresholdPercentage: 50`, `resetTimeout: 30000` (configuración interna de Módulo 3).
  - El circuito se abre cuando, habiéndose registrado al menos 5 llamadas en la ventana, el 50% o más de ellas fallan por causas técnicas.
  - El circuit breaker envuelve únicamente la llamada HTTP cruda; el mapeo a errores de dominio se ejecuta fuera de él.
  - `errorFilter`: en Opossum, si la función devuelve `true`, ese error NO incrementa el contador de fallos. Devuelve `true` (se ignora) únicamente para los 404 estructurados con `errorCode` en `{BASE_RATE_NOT_FOUND}`. Devuelve `false` (siguen contando como fallo técnico): timeout, errores de red (`ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`), respuestas 5xx, 404 sin cuerpo estructurado o con código desconocido, 400 (`INVALID_QUERY_PARAMS`) y cualquier otro 4xx inesperado (401, 403, 405, 422...).
  - Cuando el circuito está abierto, lanza de inmediato `Module1UnavailableError` sin ejecutar la petición de red.
- **Mapeo de respuestas y errores HTTP a Dominio**:
  - `200 OK`: Parsea el payload tipado `Module1BaseRateResult` y devuelve `Module1BaseRateResult`.
  - `404 Not Found`:
    - Con cuerpo `{ errorCode: "BASE_RATE_NOT_FOUND" }`: lanza el error funcional de ausencia de tarifa aplicable. El contrato no permite discriminar si la categoría no existe, no tiene tarifa configurada o la vigencia no cubre la fecha.
    - Sin cuerpo estructurado o con código desconocido: lanza `Module1UnavailableError` [FR-008], garantizando que una falla técnica de integración nunca se trate como ausencia de tarifa [BR-003].
  - `400 Bad Request` u otros 4xx no listados en el contrato (401, 403, 405, 422...): dado que Módulo 3 valida los parámetros antes de llamar, indican violación del contrato o defecto propio. Se registra log en nivel `error` con el `errorCode` recibido y el `X-Correlation-Id`, computa como fallo técnico en el breaker y lanza `Module1UnavailableError` [FR-008].
  - `Timeout`, errores de red (`ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`), `5xx` o Circuito Abierto: lanza `Module1UnavailableError(message)` marcando explícitamente falla técnica [FR-008].

### Errores de dominio y `errorCode`

| Situación | Resultado |
|---|---|
| No existe tarifa base aplicable | `404 BASE_RATE_NOT_FOUND` [BASE] |
| Módulo 1 no está disponible | `424 MODULE1_UNAVAILABLE` [BASE] |
| La petición no cumple el formato contractual | Validación de entrada conforme al contrato de la operación. |

Módulo 3 no sustituye la tarifa ausente ni una falla de integración por cero o por un valor supuesto [FR-008, BR-003].

### Within Each User Story

- Pruebas unitarias y de integración antes de cerrar la implementación
- Errores de dominio y modelos antes que el servicio de aplicación
- Servicio de aplicación antes que el binding final en el módulo NestJS

---

## Notes

- `[US1]` mapea cada tarea a la Historia de Usuario 1 para trazabilidad estricta
- La spec funcional `consultar_tarifa_base.md` es la **fuente de verdad de negocio**; para stack, capas y contratos manda `docs/plan-tecnico-base.md`
- No realizar commits con código que viole el aislamiento de capas (el dominio no debe conocer a NestJS ni HTTP)
- Prohibido sustituir tarifas faltantes o fallas de red por ceros o valores asumidos [BR-003, FR-008]
- Prohibido implementar tablas en base de datos o almacenamiento en caché para tarifas base [FR-002, NFR-003]

---
