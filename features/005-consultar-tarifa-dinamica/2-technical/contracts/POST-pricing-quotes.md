# Contrato REST: Cotizar hospedaje

**Feature**: 005 Consultar tarifa dinámica — HU4 (Cotización de hospedaje)
**Spec**: [consultar_tarifa_dinamica.md](../../1-functional/consultar_tarifa_dinamica.md)
**Plan**: [plan.md](../plan.md)
**Proyecto base**: [plan-tecnico-base.md](../../../../docs/plan-tecnico-base.md)
**Estado**: Operación que **guarda** una cotización; ruta `POST /pricing/quotes` según el Plan Base, acordada con Módulo 2

**Etiquetas de origen**:
- `[SPEC]`: Definido en la especificación funcional de la feature (`consultar_tarifa_dinamica.md`).
- `[PLAN]`: Decisión técnica del plan de esta feature (`features/005-consultar-tarifa-dinamica/2-technical/plan.md`).
- `[BASE]`: Definido en la plataforma compartida (`docs/plan-tecnico-base.md`).
- `[004]`, `[009]`, `[011]`: Definido en el plan o contrato de esas features, de las que 005 depende.
- `[CONV]`: Convención técnica adoptada para este contrato.

---

## 1. Propósito

**Módulo 2** solicita la cotización del hospedaje de **una habitación** cuando crea una reserva. Módulo 3 calcula la tarifa dinámica de cada noche, guarda la cotización y devuelve el valor de cada noche y el total [SPEC FR-012] [BASE].

Con esto el cliente ve el valor antes de confirmar y en el check-out se liquida exactamente ese valor: `Generar liquidación` (007) toma el valor de hospedaje de la cotización guardada y no lo recalcula [SPEC HU4; BASE].

La cotización es **inmutable**: no se modifica ni se recalcula aunque cambien después las reglas de temporada o la tarifa base [SPEC FR-013, BR-006].

---

## 2. Petición

`POST /pricing/quotes` [BASE]

### Autenticación y autorización

**Solo Módulo 2**, por llamada interna en la red de Docker Compose, **sin token** [BASE] [SPEC FR-016, BR-008].

Cualquier solicitud que traiga un JWT (de OTA o de Administrador) se rechaza con `403 FORBIDDEN`, porque este endpoint no se publica a personas ni a OTA [PLAN].

### Headers

| Header | Obligatorio | Valor | Descripción | Origen |
|---|---|---|---|---|
| `Content-Type` | Sí | `application/json` | Formato del cuerpo. | [CONV] |
| `Accept` | No | `application/json` | Tipo MIME esperado. | [CONV] |
| `X-Correlation-Id` | No | string | Identificador de trazabilidad distribuida; si no llega, Módulo 3 lo genera. | [BASE] |

### Cuerpo de la Petición

| Campo | Tipo | Obligatorio | Descripción | Origen |
|---|---|---|---|---|
| `roomType` | string | Sí | Tipo de habitación a cotizar (por ejemplo `DOBLE`). Es el mismo valor que Módulo 1 llama `categoryRoom`. | [SPEC FR-012] [BASE] |
| `checkInDate` | date `YYYY-MM-DD` | Sí | Fecha de entrada: primera noche cotizada. | [SPEC FR-012] [BASE] |
| `checkOutDate` | date `YYYY-MM-DD` | Sí | Fecha de salida, **exclusiva**: la noche de esa fecha no se cotiza. Posterior a `checkInDate`. | [SPEC FR-012] [BASE] |

Una solicitud corresponde a **una habitación**. Si la reserva incluye varias, Módulo 2 hace una solicitud por cada una y guarda la lista de `quoteId` en la reserva [BASE].

### Ejemplo de Petición

```http
POST /pricing/quotes
Content-Type: application/json
Accept: application/json
X-Correlation-Id: 4d7e1b2a-9c3f-4a58-8e60-1b2c3d4e5f60

{
  "roomType": "DOBLE",
  "checkInDate": "2026-12-23",
  "checkOutDate": "2026-12-26"
}
```

---

## 3. Reglas de Procesamiento

1. **Validación del rango primero**: `checkInDate < checkOutDate`. Si no, `400 INVALID_DATE_RANGE` y no se guarda nada [SPEC FR-015] [PLAN].
2. **Cálculo de cada noche**: se reutiliza el mismo cálculo de [`GET /pricing/dynamic-rate`](./GET-pricing-dynamic-rate.md) para las noches de `[checkInDate, checkOutDate)`, con un único `asOf` y un único snapshot de reglas de temporada. Así el valor cotizado coincide con el que Módulo 2 pudo consultar antes [SPEC FR-012] [PLAN] [009] [011].
3. **Tarifa base de Módulo 1**: cada noche pide su tarifa base a Módulo 1 mediante `GetBaseRateUseCase` de 004. Si Módulo 1 no reporta tarifa para **alguna** noche, o no está disponible, la solicitud falla completa y no se guarda nada, ni parcial ni estimada [SPEC FR-015, NFR-003] [004].
4. **Total**: suma exacta de la tarifa de cada noche, con `Money` (decimal, *half-up* a 2 decimales, moneda `COP`), nunca con `number` [PLAN].
5. **Identificador**: Módulo 3 genera un `quoteId` (UUID) al guardar la cotización y lo devuelve en la respuesta [PLAN].
6. **Qué se guarda**: la cotización (`quoteId`, `roomType`, `checkInDate`, `checkOutDate`, `currency`, `lodgingAmount`) y, por cada noche, `night_date`, `base_rate`, `season_name`, `adjustment_percent` y `rate`, para poder reconstruir cómo se compuso cada valor [SPEC FR-009, NFR-004] [PLAN].
7. **Todo o nada**: la cotización y todas sus noches se guardan en **una sola transacción**. Si falla el cálculo de cualquier noche o la inserción, no queda ninguna cotización parcial [SPEC FR-015, SC-008] [PLAN].
8. **Inmutable por diseño**: las tablas `lodging_quote` y `lodging_quote_night` solo reciben `INSERT`; no existe ningún camino de código que las actualice o borre [SPEC FR-013] [PLAN].
9. **Sin idempotencia**: dos solicitudes idénticas crean dos cotizaciones con `quoteId` distintos. 007 las trata como equivalentes (mismo tipo y mismas fechas) [PLAN].
10. **Salida anticipada**: el check-out nunca invoca esta operación; se liquida el valor de la cotización guardada [SPEC FR-014] [PLAN].

---

## 4. Respuesta Exitosa

`200 OK`

| Campo | Tipo | Requerido | Descripción | Origen |
|---|---|---|---|---|
| `quoteId` | UUID | Sí | Identificador de la cotización guardada. Módulo 2 lo conserva en la reserva. | [BASE] |
| `currency` | string | Sí | Moneda contractual (`"COP"`). | [BASE] |
| `nightlyRates` | array | Sí | Un elemento por noche cotizada, en orden cronológico. | [BASE] |
| `nightlyRates[].date` | date `YYYY-MM-DD` | Sí | Noche cotizada. | [BASE] |
| `nightlyRates[].rate` | string decimal | Sí | Tarifa dinámica de esa noche. | [BASE] |
| `lodgingAmount` | string decimal | Sí | Valor de hospedaje total de la habitación (suma de las noches). Es el valor que muestra Módulo 2 al cliente y el que usa 007. | [BASE] |

Los importes son **strings decimales con 2 decimales**, nunca `number` [PLAN] [CONV]. Si la reserva tiene varias habitaciones, `lodgingAmount` es el de **esa** habitación; Módulo 2 suma las de todas para mostrar el total al cliente [BASE].

### Ejemplo

```json
{
  "quoteId": "a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b",
  "currency": "COP",
  "nightlyRates": [
    { "date": "2026-12-23", "rate": "300000.00" },
    { "date": "2026-12-24", "rate": "360000.00" },
    { "date": "2026-12-25", "rate": "360000.00" }
  ],
  "lodgingAmount": "1020000.00"
}
```

---

## 5. Errores

Todos los errores siguen el estándar `ApiError` del plan base: `{ errorCode, message, timestamp, path }` [BASE]. Ninguna respuesta de este endpoint es 5xx [BASE]. En todos los casos de error **no se guarda ninguna cotización**.

| HTTP | `errorCode` | Cuándo ocurre | Reintentable | Origen |
|---|---|---|---|---|
| **400** | `INVALID_QUERY_PARAMS` | Faltan campos del cuerpo, tienen formato inválido o la fecha no es válida. (El código es el mismo que usa el plan base para parámetros inválidos.) | No | [PLAN] [CONV] |
| **400** | `INVALID_DATE_RANGE` | `checkOutDate` anterior o igual a `checkInDate`. | No | [SPEC FR-015] [PLAN] |
| **403** | `FORBIDDEN` | La solicitud trae un JWT (de OTA o de Administrador). | No | [SPEC FR-016, BR-008, SC-008] [PLAN] |
| **404** | `BASE_RATE_NOT_FOUND` | Módulo 1 no reporta tarifa base para alguna noche. | No | [SPEC FR-015] [BASE] |
| **424** | `MODULE1_UNAVAILABLE` | Módulo 1 no responde, hay timeout o el circuito está abierto. | Sí | [SPEC NFR-003] [BASE] |
| **422** | `UNEXPECTED_ERROR` | El calendario de 011 referencia una temporada que no está en el catálogo de 009, no se pueden leer las reglas o el calendario, falla la inserción, o hay cualquier otro error inesperado. | No (ver nota) | [PLAN] |

> **Reintentos**: como la operación no es idempotente, reintentar una solicitud cuyo resultado no se conoce (por ejemplo, un timeout del lado de Módulo 2 después de enviarla) puede crear una segunda cotización. Módulo 2 conserva solo los `quoteId` que recibió en una respuesta `200` [PLAN].

---

## 6. Garantías para quien llama

- **Valor que no cambia**: el `lodgingAmount` y el valor de cada noche devueltos son los que 007 usará al liquidar, sin recalcular [SPEC HU4, FR-013].
- **Todo o nada**: nunca existe una cotización parcial [SPEC FR-015].
- **Consistencia con la consulta**: el valor de cada noche sale del mismo cálculo que [`GET /pricing/dynamic-rate`](./GET-pricing-dynamic-rate.md) [PLAN].
- **Lectura posterior**: las cotizaciones guardadas se leen mediante [`LodgingQuoteQueryPort`](./PORT-find-lodging-quotes-by-ids.md), que es lo que consume 007 [PLAN].
- Un cambio en los campos, en el código de respuesta o en las reglas de cálculo requiere coordinar con Módulo 2 y con 007 y actualizar `test/contract/lodging-quote.contract.spec.ts` [PLAN] [BASE].
