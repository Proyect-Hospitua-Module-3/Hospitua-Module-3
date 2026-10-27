# Contrato REST: Consultar tarifa dinámica

**Feature**: 005 Consultar tarifa dinámica — HU1, HU2, HU4
**Spec**: [consultar_tarifa_dinamica.md](../../1-functional/consultar_tarifa_dinamica.md)
**Plan**: [plan.md](../plan.md)
**Proyecto base**: [plan-tecnico-base.md](../../../../docs/plan-tecnico-base.md)
**Estado**: Consulta de solo lectura; ruta `GET /pricing/dynamic-rate` según el Plan Base

**Etiquetas de origen**:
- `[SPEC]`: Definido en la especificación funcional de la feature (`consultar_tarifa_dinamica.md`).
- `[PLAN]`: Decisión técnica del plan de esta feature (`features/005-consultar-tarifa-dinamica/2-technical/plan.md`).
- `[BASE]`: Definido en la plataforma compartida (`docs/plan-tecnico-base.md`).
- `[004]`, `[009]`, `[011]`: Definido en el plan o contrato de esas features, de las que 005 depende.
- `[007]`: Definido en el plan o los contratos de 007; 005 reutiliza su `ReservationClientPort`.
- `[CONV]`: Convención técnica adoptada para este contrato.

---

## 1. Propósito

Devuelve la tarifa dinámica de una habitación para una noche o para un rango de noches, con el detalle de cada noche [SPEC FR-001, FR-003, FR-009]:
- **Módulo 2** la consulta para conocer el precio por noche de una estancia antes de cotizar la reserva [SPEC HU1, HU2].
- **La OTA** la consulta para las habitaciones de sus propias reservas [SPEC HU4, FR-001] [BASE].

Es una operación **exclusivamente de lectura**: no guarda nada, ni la tarifa dinámica ni ningún otro registro [SPEC BR-001, BR-004, FR-007]. Cada consulta refleja la tarifa base y la temporada vigentes al ejecutarse; no hay caché con vida propia [SPEC FR-007; PLAN].

El resultado **no depende de la reserva, del canal ni de quién consulta**: la misma habitación y fecha dan siempre la misma respuesta. La reserva que envía la OTA solo sirve para verificar su acceso [SPEC FR-011, BR-005].

---

## 2. Petición

`GET /pricing/dynamic-rate` [BASE]

### Autenticación y autorización

| Quién llama | Cómo se identifica | Resultado |
|---|---|---|
| **Módulo 2** | Llamada interna por la red de Docker Compose, **sin token** | Permitido [BASE] |
| **OTA** | `Authorization: Bearer <token>` con `role = OTA` y claim `otaId` | Permitido solo para habitaciones de sus reservas (regla 2) [BASE] |
| Token con otro rol (`Administrador`) | `Authorization: Bearer <token>` | `403 FORBIDDEN` [BASE] |
| Token inválido o expirado | `Authorization: Bearer <token>` | `401 UNAUTHENTICATED` [BASE] |

El acceso está reservado a `Módulo 2` y a la `OTA` [SPEC FR-010, BR-002, SC-005]. Si llega un token, el Guard del controller lo valida y exige `role = OTA`; si no llega, la llamada se trata como interna de Módulo 2. La regla de que la OTA solo consulte habitaciones de sus reservas depende de datos de negocio, así que se valida en el caso de uso, que recibe el actor [BASE] [PLAN].

### Headers

| Header | Obligatorio | Valor | Descripción | Origen |
|---|---|---|---|---|
| `Accept` | No | `application/json` | Tipo MIME esperado. | [CONV] |
| `Authorization` | Solo OTA | `Bearer <token>` | JWT emitido por `POST /auth/login`. Módulo 2 no lo envía. | [BASE] |
| `X-Correlation-Id` | No | string | Identificador de trazabilidad distribuida; si no llega, Módulo 3 lo genera. | [BASE] |

### Query Parameters

| Parámetro | Tipo | Obligatorio | Descripción | Origen |
|---|---|---|---|---|
| `roomId` | string (UUID) | Sí | Identificador de la habitación. | [SPEC FR-001] [PLAN] |
| `date` | date `YYYY-MM-DD` | Condicional | Una sola noche. Equivale a `checkInDate = date` y `checkOutDate = date + 1 día`. | [PLAN] |
| `checkInDate` | date `YYYY-MM-DD` | Condicional | Primera noche del rango (fecha de entrada). | [PLAN] |
| `checkOutDate` | date `YYYY-MM-DD` | Condicional | Fecha de salida del rango, **exclusiva**: la noche de esa fecha no se cobra. | [SPEC FR-008] [PLAN] |
| `reservationRef` | string | Solo OTA | Reserva a la que pertenece la habitación consultada. Obligatorio con token `role = OTA`; si falta, `400 INVALID_QUERY_PARAMS`. En una llamada interna (sin token) se ignora. | [BASE] |

Se envía **`date`** o el par **`checkInDate` + `checkOutDate`**. Cualquier otra combinación (ninguno, solo uno de los dos del rango, o `date` junto con el rango) se rechaza con `400 INVALID_QUERY_PARAMS` [CONV].

Las fechas son fechas civiles del hotel (`YYYY-MM-DD`), sin hora ni zona horaria.

### Ejemplos de Petición

#### Una sola noche (Módulo 2, llamada interna)
```http
GET /pricing/dynamic-rate?roomId=3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b&date=2026-12-24
Accept: application/json
X-Correlation-Id: c89b3f0e-2d11-4a9f-9c02-7a8b9c0d1e2f
```

#### Estancia de varias noches (Módulo 2, llamada interna)
```http
GET /pricing/dynamic-rate?roomId=3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b&checkInDate=2026-12-23&checkOutDate=2026-12-26
Accept: application/json
```

#### Estancia de varias noches (OTA)
```http
GET /pricing/dynamic-rate?roomId=3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b&checkInDate=2026-12-23&checkOutDate=2026-12-26&reservationRef=RES-000123
Accept: application/json
Authorization: Bearer <token>
```

---

## 3. Reglas de Procesamiento

1. **Validación del rango primero**: antes de llamar a cualquier otro componente se valida que `checkInDate < checkOutDate`. Si no, `400 INVALID_DATE_RANGE`, sin resultado parcial. Un rango de una noche se pide con `checkOutDate = checkInDate + 1 día`; fin igual al inicio equivale a cero noches y se rechaza [SPEC FR-008, SC-004, casos límite] [PLAN].
2. **Acceso de la OTA, antes de calcular**: solo con token `role = OTA`. Se consulta la reserva a Módulo 2 con `ReservationClientPort.getReservation(reservationRef)` de 007 (`GET /api/reservations/{reservationRef}`), se exige que la reserva sea de canal `OTA` y que su `otaId` sea el del token, y que alguna de sus cotizaciones (`LodgingQuoteQueryPort.findByIds(quoteIds)`) tenga el `roomId` consultado. Si algo no coincide, `403 FORBIDDEN` (`DynamicRateAccessDeniedError`) con el mismo mensaje exista o no la reserva: el 404 de Módulo 2 también se responde como 403 y la OTA nunca recibe `RESERVATION_NOT_FOUND`. Si Módulo 2 no responde, `424 MODULE2_UNAVAILABLE`. Esta verificación ocurre antes de llamar a Módulo 1, 009 u 011 [SPEC FR-010, HU4, casos límite] [BASE] [007].
3. **Una instantánea de reglas por consulta**: se captura `asOf` una sola vez, se obtiene un único snapshot del catálogo de temporadas con `GetEffectiveSeasonRulesUseCase.getAll(asOf)` y ese mismo `asOf` se usa para clasificar todas las noches. Un cambio de reglas durante la consulta no se mezcla en ella [009] [011] [PLAN].
4. **Por cada noche** del rango `[checkInDate, checkOutDate)`:
   - **Tarifa base**: se pide a Módulo 1 mediante `GetBaseRateUseCase` de 004 (`roomId` y fecha de la noche). 005 no calcula, guarda ni asume una tarifa base propia [SPEC FR-005] [004].
   - **Temporada**: se resuelve con el puerto de 011 (`resolve({ date, asOf })`), que devuelve el `seasonId` aplicable. Si no hay clasificación explícita, 011 devuelve la temporada por defecto, y se aplica el porcentaje de ajuste vigente de esa temporada en 009, sin suponer que sea cero [SPEC FR-004] [011].
   - **Ajuste**: se busca ese `seasonId` en el snapshot de 009 y se toma su `adjustmentPercent`, un porcentaje firmado de `-100.00` a `100.00` [009].
   - **Cálculo**: `dynamicRate = baseRate × (1 + adjustmentPercent / 100)`, con redondeo *half-up* a 2 decimales usando `Money` (decimal exacto, nunca `number`) [SPEC FR-002, SC-001] [PLAN].
5. **El ajuste sale solo del valor numérico**: positivo incrementa, negativo decrementa y cero no cambia la tarifa base, sin importar el nombre de la temporada. Aplica igual a `Alta`, `Baja`, `Regular` y a cualquier temporada que el Administrador configure [SPEC BR-007] [PLAN].
6. **Cada noche usa su propia temporada**: un rango que cruza varias temporadas nunca se promedia ni se homogeniza [SPEC FR-003, BR-003].
7. **Todo o nada (fail-fast)**: si la tarifa base de **cualquier** noche no se puede obtener, la consulta completa falla. No se devuelven las noches que sí tuvieron éxito [SPEC FR-006, NFR-003, SC-003] [PLAN].
8. **Total**: suma exacta de la `dynamicRate` de todas las noches, calculada con `Money` [PLAN].
9. **Orden**: las noches se devuelven en orden cronológico ascendente [CONV].
10. **Determinismo**: la misma consulta bajo la misma configuración vigente devuelve siempre el mismo resultado [SPEC NFR-001].
11. **Sin efectos secundarios**: no se escribe nada en base de datos ni se modifica ninguna liquidación o factura [SPEC BR-004].

---

## 4. Respuesta Exitosa

`200 OK`

| Campo | Tipo | Requerido | Descripción | Origen |
|---|---|---|---|---|
| `roomId` | string (UUID) | Sí | Habitación consultada. | [PLAN] |
| `currency` | string | Sí | Moneda contractual (`"COP"`). | [BASE] |
| `nights` | array | Sí | Un elemento por noche, en orden cronológico. | [SPEC FR-003] |
| `nights[].date` | date `YYYY-MM-DD` | Sí | Noche valorada. | [PLAN] |
| `nights[].baseRate` | string decimal | Sí | Tarifa base de origen, obtenida de Módulo 1. | [SPEC FR-009] |
| `nights[].seasonName` | string | Sí | Nombre de la temporada aplicada a esa noche. | [SPEC FR-009] |
| `nights[].seasonAdjustmentPercent` | string decimal | Sí | Ajuste firmado aplicado (de `-100.00` a `100.00`). | [SPEC FR-009] |
| `nights[].dynamicRate` | string decimal | Sí | Tarifa dinámica resultante de la noche. | [SPEC FR-009] |
| `total` | string decimal | Sí | Suma de la `dynamicRate` de todas las noches. | [PLAN] |

Los importes y porcentajes son **strings decimales con 2 decimales**, nunca `number`, para no perder exactitud [PLAN] [CONV]. Cada noche permite reconstruir cómo se compuso su valor: tarifa base, temporada y ajuste [SPEC FR-009, NFR-004].

### Ejemplo 1: Una sola noche en temporada alta

```json
{
  "roomId": "3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b",
  "currency": "COP",
  "nights": [
    {
      "date": "2026-12-24",
      "baseRate": "300000.00",
      "seasonName": "Alta",
      "seasonAdjustmentPercent": "20.00",
      "dynamicRate": "360000.00"
    }
  ],
  "total": "360000.00"
}
```

### Ejemplo 2: Estancia que cruza de temporada regular a alta

`checkInDate=2026-12-23&checkOutDate=2026-12-26` (3 noches: 23, 24 y 25; la noche del 26 no se cobra).

```json
{
  "roomId": "3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b",
  "currency": "COP",
  "nights": [
    {
      "date": "2026-12-23",
      "baseRate": "300000.00",
      "seasonName": "Regular",
      "seasonAdjustmentPercent": "0.00",
      "dynamicRate": "300000.00"
    },
    {
      "date": "2026-12-24",
      "baseRate": "300000.00",
      "seasonName": "Alta",
      "seasonAdjustmentPercent": "20.00",
      "dynamicRate": "360000.00"
    },
    {
      "date": "2026-12-25",
      "baseRate": "300000.00",
      "seasonName": "Alta",
      "seasonAdjustmentPercent": "20.00",
      "dynamicRate": "360000.00"
    }
  ],
  "total": "1020000.00"
}
```

---

## 5. Errores

Todos los errores siguen el estándar `ApiError` del plan base: `{ errorCode, message, timestamp, path }` [BASE]. Ninguna respuesta de este endpoint es 5xx [BASE].

| HTTP | `errorCode` | Cuándo ocurre | Reintentable | Origen |
|---|---|---|---|---|
| **400** | `INVALID_QUERY_PARAMS` | Faltan parámetros, tienen formato inválido (por ejemplo una fecha mal escrita), se combinan `date` y el rango, o la OTA no envía `reservationRef`. | No | [PLAN] [CONV] [BASE] |
| **400** | `INVALID_DATE_RANGE` | `checkOutDate` anterior o igual a `checkInDate`. | No | [SPEC FR-008] [PLAN] |
| **401** | `UNAUTHENTICATED` | El token es inválido o expiró. Sin token no aplica: es una llamada interna. | No | [BASE] |
| **403** | `FORBIDDEN` | El token no es de rol `OTA`, o la OTA consulta una habitación que no pertenece a una reserva suya (reserva de otra OTA, del canal directo, inexistente o sin esa habitación). Mismo mensaje en todos los casos. | No | [SPEC FR-010, SC-005] [BASE] |
| **404** | `ROOM_NOT_FOUND` | Módulo 1 informa que la habitación consultada no existe (no cuenta como fallo del circuit breaker). | No | [SPEC FR-006] [BASE] [004] |
| **424** | `INVALID_BASE_RATE` | Módulo 1 reporta para alguna noche una tarifa base menor o igual a cero (no cuenta como fallo del circuit breaker). | No | [SPEC FR-006] [BASE] [004] |
| **424** | `MODULE1_UNAVAILABLE` | Módulo 1 no responde, hay timeout o el circuito está abierto. | Sí | [SPEC NFR-003] [BASE] |
| **424** | `MODULE2_UNAVAILABLE` | Solo en consultas de la OTA: Módulo 2 no responde al verificar la reserva, hay timeout o el circuito está abierto. | Sí | [SPEC casos límite] [BASE] [007] |
| **422** | `UNEXPECTED_ERROR` | El calendario de 011 referencia una temporada que no está en el catálogo de 009, no se pueden leer las reglas o el calendario, o hay cualquier otro error inesperado. | Según la causa: sí, si falló temporalmente la lectura de las reglas o del calendario; no, si el calendario es inconsistente con el catálogo. | [PLAN] [009] [011] |

Un error en cualquier noche hace fallar la consulta completa: nunca se devuelve un resultado parcial ni estimado [SPEC FR-006, NFR-003].

---

## 6. Garantías para quien llama

- **Mismo resultado para la misma consulta**: no depende de la reserva, del canal ni de si consulta Módulo 2 o la OTA [SPEC FR-011, SC-006].
- **La OTA solo ve lo suyo**: nunca recibe la tarifa de una habitación que no pertenece a una reserva suya, ni una respuesta que revele si una reserva ajena existe [SPEC FR-010, HU4] [BASE].
- **Sin valores supuestos**: nunca se devuelve una tarifa calculada sobre una tarifa base en cero o supuesta [SPEC FR-006].
- **Sin retroactividad**: las cotizaciones ya guardadas (`POST /pricing/quotes`) no se ven afectadas por cambios posteriores de temporada o de tarifa base; esta consulta siempre refleja la configuración del momento en que se ejecuta [SPEC casos límite, HU3].
- **Sin persistencia**: la tarifa dinámica nunca se guarda [SPEC FR-007].
- Un cambio en los parámetros, en la forma de la respuesta o en las reglas de cálculo requiere coordinar con Módulo 2 (y avisar a las OTA) y actualizar `test/contract/dynamic-rate.contract.spec.ts` [PLAN].
