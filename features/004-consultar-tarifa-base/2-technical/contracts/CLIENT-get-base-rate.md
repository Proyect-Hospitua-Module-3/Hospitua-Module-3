# Contrato cliente HTTP: Consultar tarifa base

**Feature**: 004 Consultar tarifa base
**Spec**: [consultar_tarifa_base.md](../../1-functional/consultar_tarifa_base.md)
**Plan**: [plan.md](../plan.md)

**Etiquetas de origen**: `[SPEC]` requisito funcional; `[PLAN]` decisión de implementación de Módulo 3; `[BASE]` plataforma compartida; `[CONV]` convención de interoperabilidad.

## 1. Propósito

Define la llamada saliente que realiza el contexto `pricing` de Módulo 3 para obtener de Módulo 1 el importe de tarifa base correspondiente a una habitación identificada por su `roomId` y una fecha [SPEC FR-001]. Módulo 1 administra el dato; Módulo 3 lo consume sin persistirlo [SPEC FR-002, FR-005].

## 2. Petición

| Elemento | Valor |
|---|---|
| Método y ruta | `GET {MODULE1_BASE_URL}/api/rooms/{roomId}/base-rate?date=YYYY-MM-DD` |
| Autenticación | Sin token, comunicación interna [BASE] |
| `roomId` | UUID de la habitación en la ruta; Módulo 3 inserta el `roomId`, ya validado como UUID, en la ruta sin transformarlo [PLAN] |
| `date` | Fecha consultada, obligatoria, formato `YYYY-MM-DD` |
| Objetivo de Módulo 1 | p95 < 200 ms, acordado con Módulo 1 |
| Timeout | `MODULE1_TIMEOUT_MS = 500` [SPEC NFR-002] [PLAN] |
| Circuit breaker | opossum: se abre tras 5 fallos seguidos y prueba de nuevo a los 30 s [PLAN] |

Ejemplo:

```http
GET /api/rooms/550e8400-e29b-41d4-a716-446655440000/base-rate?date=2026-10-08
```

## 3. Respuesta esperada

Respuesta `200`:

```json
{
  "roomId": "550e8400-e29b-41d4-a716-446655440000",
  "date": "2026-10-08",
  "baseRate": "250000.00",
  "currency": "COP"
}
```

| Campo | Tipo | Regla |
|---|---|---|
| `roomId` | UUID | Igual al `roomId` enviado en la petición [PLAN] |
| `date` | string `YYYY-MM-DD` | Igual a la fecha enviada en la petición [PLAN] |
| `baseRate` | decimal en texto | Importe decimal estrictamente positivo [SPEC FR-001, FR-006] [PLAN] |
| `currency` | string | `COP` [BASE] [PLAN] |

## 4. Cómo interpreta cada respuesta

| Respuesta recibida | Resultado en Módulo 3 | Reintentable | Cuenta como fallo del circuit breaker | Origen |
|---|---|---|---|---|
| `200` con cuerpo válido | Devuelve `BaseRate` con importe y moneda | — | No | [SPEC FR-001] [PLAN] |
| `200` con `currency` distinta de `COP` | `MODULE1_UNAVAILABLE` | Sí | Sí | [PLAN] |
| `200` con `roomId` o `date` distintos de los solicitados | `MODULE1_UNAVAILABLE` | Sí | Sí | [PLAN] |
| `200` con `baseRate` como número JSON en vez de texto decimal | `MODULE1_UNAVAILABLE` | Sí | Sí | [PLAN] |
| `200` con `baseRate` decimal en texto menor o igual a cero | `INVALID_BASE_RATE` | No | No | [SPEC FR-006] [PLAN] |
| `200` con `baseRate` no decimal, cuerpo no JSON, campos ausentes o tipo incorrecto | `MODULE1_UNAVAILABLE` | Sí | Sí | [SPEC FR-006] [PLAN] |
| `404` con cuerpo estructurado `ROOM_NOT_FOUND` | `ROOM_NOT_FOUND`; detiene el cálculo invocante | No | No | [SPEC FR-004] [CONV] |
| `404` sin cuerpo estructurado | `MODULE1_UNAVAILABLE` | Sí | Sí | [PLAN] |
| Otro `4xx` | `MODULE1_UNAVAILABLE` | Sí | Sí | [PLAN] |
| Timeout, `5xx`, error de red o circuito abierto | `MODULE1_UNAVAILABLE` | Sí | Sí | [SPEC NFR-002] [PLAN] |

El cuerpo estructurado de error sigue la forma `ApiError` del Plan Base. Los campos adicionales del cuerpo, tanto en la respuesta `200` como en `ApiError` (por ejemplo `details`), se ignoran y no cuentan como cuerpo malformado. Módulo 3 no sustituye una respuesta inválida por un importe predeterminado [SPEC FR-004, FR-006]. Una respuesta malformada lanza `MalformedBaseRateResponseError` en el adaptador, cuenta como fallo del circuit breaker y se traduce a `MODULE1_UNAVAILABLE`; un importe decimal en texto menor o igual a cero lanza `InvalidBaseRateError`, no cuenta como fallo del circuit breaker y se traduce a `INVALID_BASE_RATE` [PLAN].

## 5. Garantías del cliente

- La consulta es de solo lectura y no persiste ni cachea una copia independiente [SPEC FR-002, FR-005].
- Cada fecha se consulta de forma independiente [SPEC FR-003].
- La habitación no encontrada y la tarifa inválida se distinguen de una falla de dependencia [SPEC FR-006].

## 6. Contract test

El contract test `test/contract/pricing/module1-base-rate.contract.spec.ts` verifica el cuerpo de éxito con `roomId` (UUID), `date`, `baseRate` decimal en texto positivo y `currency: COP`; el `404` con `ApiError` y `errorCode` `ROOM_NOT_FOUND`; el importe decimal en texto menor o igual a cero como `INVALID_BASE_RATE`; y respuestas malformadas, `404` sin `ROOM_NOT_FOUND`, otros `4xx`, timeout, `5xx`, error de red y circuito abierto como `MODULE1_UNAVAILABLE`. Verifica que los campos adicionales del cuerpo, en el `200` y en el `ApiError`, no cambian el resultado. Verifica también que solo los errores de dependencia cuentan como fallo del circuit breaker [PLAN].
