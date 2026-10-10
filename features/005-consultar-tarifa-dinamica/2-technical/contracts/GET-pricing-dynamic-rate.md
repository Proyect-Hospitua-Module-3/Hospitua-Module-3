# Contrato REST: Consultar tarifa dinámica

**Feature**: 005 Consultar tarifa dinámica — HU1, HU2, HU3
**Spec**: [consultar_tarifa_dinamica.md](../../1-functional/consultar_tarifa_dinamica.md)
**Plan**: [plan.md](../plan.md)
**Proyecto base**: [plan-tecnico-base.md](../../../../docs/plan-tecnico-base.md)
**Estado**: Consulta de solo lectura; ruta `GET /pricing/dynamic-rate` según el Plan Base

**Etiquetas de origen**:
- `[SPEC]`: Definido en la especificación funcional de la feature (`consultar_tarifa_dinamica.md`).
- `[PLAN]`: Decisión técnica del plan de esta feature (`features/005-consultar-tarifa-dinamica/2-technical/plan.md`).
- `[BASE]`: Definido en la plataforma compartida (`docs/plan-tecnico-base.md`).
- `[004]`, `[009]`, `[011]`: Definido en el plan o contrato de esas features, de las que 005 depende.
- `[CONV]`: Convención técnica adoptada para este contrato.

---

## 1. Propósito

Devuelve la tarifa dinámica de un tipo de habitación para una noche o para un rango de noches, con el detalle de cada noche [SPEC FR-001, FR-003, FR-009]:
- **Módulo 2** la consulta para conocer el precio por noche de una estancia antes de cotizar la reserva [SPEC HU1, HU2].
- **OTA (Booking, Airbnb, Expedia)** la consulta para mantener la paridad de precios con el hotel [SPEC HU3].

Es una operación **exclusivamente de lectura**: no guarda nada, ni la tarifa dinámica ni ningún otro registro [SPEC BR-001, BR-004, FR-007]. Cada consulta refleja la tarifa base y la temporada vigentes al ejecutarse; no hay caché con vida propia [SPEC FR-007; PLAN].

El resultado es **idéntico para cualquier actor autorizado**. El actor solo se usa para autorizar el acceso, nunca para alterar el resultado [SPEC FR-011, BR-005].

---

## 2. Petición

`GET /pricing/dynamic-rate` [BASE]

### Autenticación y autorización

| Quién llama | Cómo se identifica | Resultado |
|---|---|---|
| **Módulo 2** | Llamada interna por la red de Docker Compose, **sin token** | Permitido [BASE] |
| **OTA** | `Authorization: Bearer <token>` con `role = OTA` | Permitido [BASE] |
| Token con otro rol (por ejemplo `Administrador`) | `Authorization` con `role` distinto de `OTA` | `403 FORBIDDEN` [PLAN] |
| Token inválido o expirado | `Authorization` presente pero no válido | `401 UNAUTHENTICATED` [PLAN] |

Si llega un token se valida y se aplican las reglas de OTA; si no llega, se trata como llamada interna de un módulo [BASE]. La autorización vive en el Guard del controller; el caso de uso no recibe el actor [PLAN].

### Headers

| Header | Obligatorio | Valor | Descripción | Origen |
|---|---|---|---|---|
| `Authorization` | Condicional | `Bearer <token>` | Solo para OTA (`role = OTA`). No lo envía Módulo 2 en la red interna. | [BASE] |
| `Accept` | No | `application/json` | Tipo MIME esperado. | [CONV] |
| `X-Correlation-Id` | No | string | Identificador de trazabilidad distribuida; si no llega, Módulo 3 lo genera. | [BASE] |

### Query Parameters

| Parámetro | Tipo | Obligatorio | Descripción | Origen |
|---|---|---|---|---|
| `roomType` | string | Sí | Tipo de habitación (por ejemplo `DOBLE`). Es el mismo valor que Módulo 1 llama `categoryRoom`. | [SPEC FR-001] [BASE] |
| `date` | date `YYYY-MM-DD` | Condicional | Una sola noche. Equivale a `checkInDate = date` y `checkOutDate = date + 1 día`. | [PLAN] |
| `checkInDate` | date `YYYY-MM-DD` | Condicional | Primera noche del rango (fecha de entrada). | [PLAN] |
| `checkOutDate` | date `YYYY-MM-DD` | Condicional | Fecha de salida del rango, **exclusiva**: la noche de esa fecha no se cobra. | [SPEC FR-008] [PLAN] |

Se envía **`date`** o el par **`checkInDate` + `checkOutDate`**. Cualquier otra combinación (ninguno, solo uno de los dos del rango, o `date` junto con el rango) se rechaza con `400 INVALID_QUERY_PARAMS` [CONV].

Las fechas son fechas civiles del hotel (`YYYY-MM-DD`), sin hora ni zona horaria.

### Ejemplos de Petición

#### Una sola noche (Módulo 2, llamada interna)
```http
GET /pricing/dynamic-rate?roomType=DOBLE&date=2026-12-24
Accept: application/json
X-Correlation-Id: c89b3f0e-2d11-4a9f-9c02-7a8b9c0d1e2f
```

#### Estancia de varias noches (Módulo 2, llamada interna)
```http
GET /pricing/dynamic-rate?roomType=DOBLE&checkInDate=2026-12-23&checkOutDate=2026-12-26
Accept: application/json
```

#### Llamada de una OTA
```http
GET /pricing/dynamic-rate?roomType=DOBLE&checkInDate=2026-12-23&checkOutDate=2026-12-26
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Accept: application/json
```

---

## 3. Reglas de Procesamiento

1. **Validación del rango primero**: antes de llamar a cualquier otro componente se valida que `checkInDate < checkOutDate`. Si no, `400 INVALID_DATE_RANGE`, sin resultado parcial. Un rango de una noche se pide con `checkOutDate = checkInDate + 1 día`; fin igual al inicio equivale a cero noches y se rechaza [SPEC FR-008, casos límite] [PLAN].
2. **Una instantánea de reglas por consulta**: se captura `asOf` una sola vez, se obtiene un único snapshot del catálogo de temporadas con `GetEffectiveSeasonRulesUseCase.getAll(asOf)` y ese mismo `asOf` se usa para clasificar todas las noches. Un cambio de reglas durante la consulta no se mezcla en ella [009] [011] [PLAN].
3. **Por cada noche** del rango `[checkInDate, checkOutDate)`:
   - **Tarifa base**: se pide a Módulo 1 mediante `GetBaseRateUseCase` de 004 (`roomType` y fecha de la noche). 005 no calcula, guarda ni asume una tarifa base propia [SPEC FR-005] [004].
   - **Temporada**: se resuelve con el puerto de 011 (`resolve({ date, asOf })`), que devuelve el `seasonId` aplicable. Si no hay clasificación explícita, 011 devuelve la temporada por defecto (`Regular`) [SPEC FR-004] [011].
   - **Ajuste**: se busca ese `seasonId` en el snapshot de 009 y se toma su `adjustmentPercent`, un porcentaje firmado de `-100.00` a `100.00` [009].
   - **Cálculo**: `dynamicRate = baseRate × (1 + adjustmentPercent / 100)`, con redondeo *half-up* a 2 decimales usando `Money` (decimal exacto, nunca `number`) [SPEC FR-002] [PLAN].
4. **El ajuste sale solo del valor numérico**: positivo incrementa, negativo decrementa y cero no cambia la tarifa base, sin importar el nombre de la temporada. Aplica igual a `Alta`, `Baja`, `Regular` y a cualquier temporada que el Administrador configure [SPEC BR-007] [PLAN].
5. **Cada noche usa su propia temporada**: un rango que cruza varias temporadas nunca se promedia ni se homogeniza [SPEC FR-003, BR-003].
6. **Todo o nada (fail-fast)**: si la tarifa base de **cualquier** noche no se puede obtener, la consulta completa falla. No se devuelven las noches que sí tuvieron éxito [SPEC FR-006, NFR-003] [PLAN].
7. **Total**: suma exacta de la `dynamicRate` de todas las noches, calculada con `Money` [PLAN].
8. **Orden**: las noches se devuelven en orden cronológico ascendente [CONV].
9. **Determinismo**: la misma consulta bajo la misma configuración vigente devuelve siempre el mismo resultado [SPEC NFR-001].
10. **Sin efectos secundarios**: no se escribe nada en base de datos ni se modifica ninguna liquidación o factura [SPEC BR-004].

---

## 4. Respuesta Exitosa

`200 OK`

| Campo | Tipo | Requerido | Descripción | Origen |
|---|---|---|---|---|
| `roomType` | string | Sí | Tipo de habitación consultado. | [PLAN] |
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
  "roomType": "DOBLE",
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
  "roomType": "DOBLE",
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
| **400** | `INVALID_QUERY_PARAMS` | Faltan parámetros, tienen formato inválido (por ejemplo una fecha mal escrita) o se combinan `date` y el rango. | No | [PLAN] [CONV] |
| **400** | `INVALID_DATE_RANGE` | `checkOutDate` anterior o igual a `checkInDate`. | No | [SPEC FR-008] [PLAN] |
| **401** | `UNAUTHENTICATED` | Llega un token JWT inválido o expirado. | No | [PLAN] |
| **403** | `FORBIDDEN` | Llega un token válido con un rol distinto de `OTA`. | No | [PLAN] |
| **404** | `BASE_RATE_NOT_FOUND` | Módulo 1 no reporta tarifa base para alguna noche del rango. | No | [SPEC FR-006] [BASE] |
| **424** | `MODULE1_UNAVAILABLE` | Módulo 1 no responde, hay timeout o el circuito está abierto. | Sí | [SPEC NFR-003] [BASE] |
| **422** | `UNEXPECTED_ERROR` | El calendario de 011 referencia una temporada que no está en el catálogo de 009, no se pueden leer las reglas o el calendario, o hay cualquier otro error inesperado. | No | [PLAN] |

Un error en cualquier noche hace fallar la consulta completa: nunca se devuelve un resultado parcial ni estimado [SPEC FR-006, NFR-003].

---

## 6. Garantías para quien llama

- **Mismo resultado para todos**: Módulo 2 y una OTA reciben exactamente la misma respuesta para la misma consulta [SPEC FR-011, SC-006].
- **Sin valores supuestos**: nunca se devuelve una tarifa calculada sobre una tarifa base en cero o supuesta [SPEC FR-006].
- **Sin retroactividad**: las cotizaciones ya guardadas (`POST /pricing/quotes`) no se ven afectadas por cambios posteriores de temporada o de tarifa base; esta consulta siempre refleja la configuración del momento en que se ejecuta [SPEC casos límite, HU4].
- **Sin persistencia**: la tarifa dinámica nunca se guarda [SPEC FR-007].
- Un cambio en los parámetros, en la forma de la respuesta o en las reglas de cálculo requiere coordinar con Módulo 2 y con las OTA y actualizar `test/contract/dynamic-rate.contract.spec.ts` [PLAN].
