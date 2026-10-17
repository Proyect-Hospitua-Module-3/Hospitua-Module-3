# Contrato cliente HTTP: Consultar tarifa base

**Feature**: 004 Consultar tarifa base
**Spec**: [consultar_tarifa_base.md](../../1-functional/consultar_tarifa_base.md)
**Plan**: [plan.md](../plan.md)

**Etiquetas de origen**: `[SPEC]` requisito funcional; `[PLAN]` decisión de implementación de Módulo 3; `[BASE]` plataforma compartida.

## 1. Propósito

Define la llamada saliente que realiza el contexto `pricing` de Módulo 3 para obtener de Módulo 1 el importe de tarifa base correspondiente a una habitación identificada por su `roomId` y una fecha [SPEC FR-001]. Módulo 1 administra el dato; Módulo 3 lo consume sin persistirlo [SPEC FR-002, FR-005].

## 2. Petición

| Elemento | Valor |
|---|---|
| Método y ruta | `GET /api/rooms/{roomId}/base-rate?date=YYYY-MM-DD` |
| Autenticación | Sin token, comunicación interna [BASE] |
| `roomId` | UUID de la habitación en la ruta; Módulo 3 inserta el `roomId`, ya validado como UUID, en la ruta sin transformarlo [PLAN] |
| `date` | Fecha consultada, formato `YYYY-MM-DD` |
| Timeout y circuit breaker | Timeout de 500 ms [SPEC NFR-002]; circuit breaker opossum: se abre tras 5 fallos seguidos y prueba de nuevo a los 30 s [PLAN] |

## 3. Respuesta que Módulo 3 requiere de Módulo 1

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

| Respuesta recibida | Resultado en Módulo 3 | Cuenta como fallo del circuit breaker |
|---|---|---|
| `200` con cuerpo válido | Devuelve `BaseRate` con importe y moneda | No |
| `200` con `currency` distinta de `COP` | `MODULE1_UNAVAILABLE` | Sí |
| `200` con `roomId` o `date` distintos de los solicitados | `MODULE1_UNAVAILABLE` | Sí |
| `200` con `baseRate` como número JSON en vez de texto decimal | `MODULE1_UNAVAILABLE` | Sí |
| `200` con `baseRate` decimal en texto menor o igual a cero | `INVALID_BASE_RATE` | No |
| `200` con `baseRate` no decimal, cuerpo no JSON, campos ausentes o tipo incorrecto | `MODULE1_UNAVAILABLE` | Sí |
| `404` con cuerpo estructurado `BASE_RATE_NOT_FOUND` | `BASE_RATE_NOT_FOUND`; detiene el cálculo invocante | No |
| `404` sin cuerpo estructurado | `MODULE1_UNAVAILABLE` | Sí |
| Otro `4xx` | `MODULE1_UNAVAILABLE` | Sí |
| Timeout, `5xx`, error de red o circuito abierto | `MODULE1_UNAVAILABLE` | Sí |

El cuerpo estructurado de error sigue la forma `ApiError` del Plan Base. Módulo 3 no sustituye una respuesta inválida por un importe predeterminado [SPEC FR-004, FR-006]. Una respuesta malformada lanza `MalformedBaseRateResponseError` en el adaptador, cuenta como fallo del circuit breaker y se traduce a `MODULE1_UNAVAILABLE`; un importe decimal en texto menor o igual a cero lanza `InvalidBaseRateError`, no cuenta como fallo del circuit breaker y se traduce a `INVALID_BASE_RATE` [PLAN].

## 5. Garantías del cliente

- La consulta es de solo lectura y no persiste ni cachea una copia independiente [SPEC FR-002, FR-005].
- Cada fecha se consulta de forma independiente [SPEC FR-003].
- La ausencia de tarifa y la tarifa inválida se distinguen de una falla de dependencia [SPEC FR-006].

## 6. Contract test

El contract test verifica el cuerpo de éxito con `roomId` (UUID), `date`, `baseRate` decimal en texto positivo y `currency: COP`; la interpretación de `BASE_RATE_NOT_FOUND` estructurado; y un importe decimal en texto menor o igual a cero como `INVALID_BASE_RATE`, sin contabilizarlo como fallo del circuit breaker. Las respuestas malformadas se clasifican como falla de dependencia [PLAN].
