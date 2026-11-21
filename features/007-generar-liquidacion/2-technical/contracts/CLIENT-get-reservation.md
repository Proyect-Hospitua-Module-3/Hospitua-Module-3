# Contrato de cliente saliente: Consultar reserva en Módulo 2

**Feature**: 007 Generar liquidación — HU1, HU2
**Spec**: [generar_liquidacion.md](../../1-functional/generar_liquidacion.md)
**Plan**: [plan.md](../plan.md)

**Etiquetas de origen**: `[SPEC]` viene de la spec funcional, `[PLAN]` del plan técnico de la 007, `[BASE]` del plan técnico base (`docs/plan-tecnico-base.md`) y `[CONV]` es una convención técnica elegida para este contrato.

Este endpoint **lo expone Módulo 2**; Módulo 3 es el cliente. Está acordado con Módulo 2 en el plan base [BASE]. Este documento fija qué espera `settlement` de él y cómo interpreta cada respuesta, y es la base del contract test `module2-reservation.contract.spec.ts` [PLAN].

## 1. Propósito

Obtener de la reserva indicada en el evento de check-out sus cotizaciones (`quoteIds`), el canal de origen y, si es OTA, la OTA, su código de confirmación y el porcentaje de comisión pactado. Módulo 3 no mantiene tabla propia de convenios de comisión [SPEC FR-005, BR-010].

## 2. Petición

`GET {MODULE2_BASE_URL}/api/reservations/{reservationRef}` [BASE]

| Elemento | Valor | Origen |
|---|---|---|
| Autenticación | Sin token. Cabecera `X-Internal-Key` con `OUTBOUND_KEY_MODULE2`, la clave que Módulo 2 asignó a Módulo 3; sin valor no se envía. Sin ella, o con una incorrecta, Módulo 2 responde `401 INVALID_INTERNAL_KEY` | [BASE] |
| `X-Client` | `MODULE3`. Módulo 2 exige identificar al módulo que llama; sin ella responde `400 INVALID_CLIENT` | [BASE] |
| `Accept` | `application/json` | [CONV] |
| `X-Correlation-Id` | Se propaga el identificador de correlación de la generación | [CONV] |
| Path param `reservationRef` | string, p. ej. `RES-000123`, codificado en URL | [BASE] |
| Timeout | `MODULE2_TIMEOUT_MS`: 500 ms por defecto (`.env.example` y pruebas); 1500 ms en el despliegue de Render, porque la primera llamada por internet con TLS supera los 500 ms. Siempre por debajo de los 3 s que Módulo 1 y Módulo 2 esperan a Módulo 3 | [PLAN] |
| Circuit breaker | `opossum`: se abre tras 5 fallos seguidos y prueba de nuevo a los 30 s | [PLAN] |
| Reintentos propios | Ninguno; el reintento lo hace 010 con la cola de reintento del evento (30 s, hasta 5 veces) | [PLAN] [BASE] |

```http
GET /api/reservations/RES-000123
Accept: application/json
X-Client: MODULE3
X-Internal-Key: <clave asignada por Módulo 2>
X-Correlation-Id: 9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72
```

## 3. Respuesta esperada

`200 OK` — `Content-Type: application/json`

| Campo | Tipo | Obligatorio | Descripción | Origen |
|---|---|---|---|---|
| `reservationRef` | string | Sí | Debe coincidir con el solicitado | [BASE] |
| `quoteIds` | UUID[] | Sí | Una cotización por habitación de la reserva | [BASE] |
| `channel` | string | No | `OTA` o un canal directo (recepción, teléfono, portal propio). Ausente o `null` → directo | [BASE] [SPEC FR-004] |
| `otaId` | string | Si `channel = OTA` | Identificador de la OTA | [BASE] |
| `otaConfirmationCode` | string | Si `channel = OTA` | Código de confirmación de la OTA | [BASE] |
| `otaCommissionPercentage` | number \| string | Si `channel = OTA` | Porcentaje pactado, de 0 a 100 | [BASE] [SPEC FR-005] |
| `rooms` | `{ roomId: string, quoteId: UUID }[]` | No | Habitación actual (id de Módulo 1) de cada cotización. Si la reserva cambió de habitación antes del check-in, la nueva hereda el `quoteId` de la anterior. Ausente o `null` → se elige la cotización por `roomId`; vacía en reservas de Booking. Acordado con Módulo 2 el 2026-11-20 | [SPEC FR-020] |

Con `rooms`, la cotización de una habitación es la que `rooms` le asigna aunque la cotización guardada tenga otro `roomId`; si la habitación no está en `rooms`, se usa la de `roomId` igual al del check-out [SPEC FR-020].

Los campos desconocidos se ignoran. Cualquier `channel` distinto de `OTA` se trata como canal directo y se ignoran los campos de OTA que lleguen [SPEC FR-007, BR-003].

### Ejemplo (reserva OTA con dos habitaciones)

```json
{
  "reservationRef": "RES-000123",
  "quoteIds": [
    "a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b",
    "b7c8d9e0-f1a2-4b3c-8d4e-5f6a7b8c9d0e"
  ],
  "channel": "OTA",
  "otaId": "booking",
  "otaConfirmationCode": "BKG-88421",
  "otaCommissionPercentage": 15
}
```

### Ejemplo (cambio de habitación: la 205 reemplazó a otra y hereda su cotización)

```json
{
  "reservationRef": "RES-000125",
  "quoteIds": [
    "a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b",
    "b7c8d9e0-f1a2-4b3c-8d4e-5f6a7b8c9d0e"
  ],
  "channel": "DIRECT",
  "rooms": [
    { "roomId": "a0000000-0000-0000-0000-000000000201", "quoteId": "a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b" },
    { "roomId": "a0000000-0000-0000-0000-000000000205", "quoteId": "b7c8d9e0-f1a2-4b3c-8d4e-5f6a7b8c9d0e" }
  ]
}
```

### Ejemplo (canal directo)

```json
{
  "reservationRef": "RES-000124",
  "quoteIds": ["c9d0e1f2-a3b4-4c5d-8e6f-7a8b9c0d1e2f"]
}
```

## 4. Cómo interpreta cada respuesta

| Respuesta de Módulo 2 | Resultado en Módulo 3 | Reintentable | Origen |
|---|---|---|---|
| `200` con datos válidos | `ReservationData` | — | [BASE] |
| `200` con `channel = OTA` sin `otaCommissionPercentage` (ausente o `null`) | `MISSING_COMMISSION` (lo lanza el servicio, no el cliente) | No | [SPEC FR-014] |
| `200` con `otaCommissionPercentage` < 0 o > 100 | `INVALID_COMMISSION` (lo lanza el servicio) | No | [SPEC casos límite] |
| `200` con `channel = OTA` y `quoteIds` vacío (Booking: Módulo 2 nunca cotiza las reservas OTA y siempre envía la lista vacía, confirmado el 2026-11-20) | El servicio cotiza la estancia en el check-out [SPEC FR-022] | — | [SPEC FR-022] |
| `200` de canal directo con `quoteIds` vacío, sin ninguna cuyo `roomId` coincida con el del check-out o con un `quoteId` de `rooms` que no está guardado | `QUOTE_NOT_FOUND` (lo lanza el servicio) | No | [SPEC FR-014] |
| `200` con cuerpo que no cumple esta forma (falta `reservationRef` o `quoteIds`, tipos incorrectos, `rooms` que no es una lista de `{ roomId, quoteId UUID }`) | `MODULE2_UNAVAILABLE`; se registra la discrepancia de contrato | Sí | [CONV] |
| `404` | `RESERVATION_NOT_FOUND` | No | [BASE] [SPEC FR-014] |
| Timeout (`MODULE2_TIMEOUT_MS`), `5xx` o fallo de red | `MODULE2_UNAVAILABLE` | Sí | [SPEC FR-021] [BASE] |
| Circuito abierto | `MODULE2_UNAVAILABLE` sin llamar a Módulo 2 | Sí | [PLAN] |
| Otro `4xx` (400 `INVALID_CLIENT` o `INVALID_RESERVATION_CODE`, 401 `INVALID_INTERNAL_KEY`, 403) | `MODULE2_UNAVAILABLE`; indica un problema de configuración o de contrato, no de negocio | Sí | [CONV] [BASE] |

Un `404` no cuenta como fallo para el circuit breaker; timeout, `5xx` y errores de red sí [CONV]. La falla de comunicación y la reserva inexistente nunca se confunden ni se sustituyen por datos supuestos [SPEC FR-021, BR-007].

## 5. Garantías del cliente

- **Sin datos personales**: de la respuesta solo se usan los campos de la tabla; el resto se descarta y no se registra en logs [SPEC NFR-006].
- **Solo lectura**: la consulta no modifica nada en Módulo 2 [CONV].
- **Sin caché**: cada generación consulta la reserva, porque el canal o la comisión pueden corregirse hasta el check-out [PLAN] [SPEC casos límite].
- **Configuración**: `MODULE2_BASE_URL`, `MODULE2_TIMEOUT_MS` (500 por defecto, 1500 en Render) y `OUTBOUND_KEY_MODULE2` en `.env` [PLAN] [BASE].

## 6. Contract test

`test/contract/settlement/module2-reservation.contract.spec.ts` verifica contra ejemplos de Módulo 2: reserva OTA, reserva directa, reserva sin `channel`, `quoteIds` con varias cotizaciones, `404` y cuerpo malformado. Cualquier cambio de campos en este endpoint debe acordarse con Módulo 2 antes de modificar el cliente [PLAN] [BASE].
