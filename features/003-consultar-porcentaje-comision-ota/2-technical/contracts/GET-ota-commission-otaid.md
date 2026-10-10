# Contrato REST: Consultar porcentaje de comisión OTA

**Feature**: 003 Consultar porcentaje de comisión OTA — HU1, HU2, HU3
**Spec**: [consultar_porcentaje_comision_ota.md](../../1-functional/consultar_porcentaje_comision_ota.md)
**Plan**: [plan.md](../plan.md)
**Proyecto base**: [plan-tecnico-base.md](../../../../docs/plan-tecnico-base.md)
**Estado**: Consulta de solo lectura; ruta `GET /ota-commission/{otaId}` según el Plan Base

**Etiquetas de origen**:
- `[SPEC]`: Definido en la especificación funcional de la feature (`consultar_porcentaje_comision_ota.md`).
- `[PLAN]`: Decisión técnica del plan de esta feature (`features/003-consultar-porcentaje-comision-ota/2-technical/plan.md`).
- `[BASE]`: Definido en la plataforma compartida (`docs/plan-tecnico-base.md`).
- `[007]`: Definido en el plan de Generar liquidación (`features/007-generar-liquidacion/2-technical/plan.md`), dueño de la tabla `settlement`.
- `[CONV]`: Convención técnica adoptada para este contrato.

---

## 1. Propósito

Devuelve el porcentaje de comisión que quedó registrado en la liquidación `Final` **más reciente** de una OTA, junto con la fecha de esa liquidación [SPEC FR-001, HU1]:
- **Módulo 2** lo consulta como referencia histórica antes de informar el porcentaje de esa OTA en una nueva reserva [SPEC HU1].
- **OTA (Booking, Airbnb, Expedia)** lo consulta para verificar el porcentaje registrado en sus propias liquidaciones [SPEC HU3].

El dato es **histórico y referencial**: no es una tarifa contractual ni la gestiona o garantiza Módulo 3. La fuente del porcentaje de una reserva sigue siendo Módulo 2 [SPEC FR-002, BR-001].

Es una operación **exclusivamente de lectura** sobre liquidaciones ya generadas: no crea, corrige ni fija porcentajes [SPEC FR-005, BR-002, SC-004].

**`Generar liquidación` nunca invoca esta consulta**: obtiene el porcentaje únicamente de la reserva que consulta a Módulo 2. Esta dependencia es asimétrica: esta consulta lee de `settlement`, pero `settlement` no puede importar nada de `ota-commission`, y una regla de CI lo verifica [SPEC FR-003, BR-004, HU2] [PLAN].

---

## 2. Petición

`GET /ota-commission/{otaId}` [BASE]

### Autenticación y autorización

| Quién llama | Cómo se identifica | Alcance | Origen |
|---|---|---|---|
| **Módulo 2** | Llamada interna por la red de Docker Compose, **sin token** | Cualquier `otaId` | [BASE] [PLAN] |
| **OTA** | `Authorization: Bearer <token>` con `role = OTA` y claim `otaId` | **Solo su propio** `otaId` | [SPEC FR-009, BR-003] [PLAN] |
| Administrador u otro rol | JWT con un rol distinto de `OTA` | Rechazado con `403 FORBIDDEN` | [PLAN] |

Si llega un token, se valida y se aplican las reglas de OTA; si no llega, se trata como llamada interna de un módulo [BASE]. El plan base no distingue qué módulo llama en la red interna, por lo que el Guard no valida si es Módulo 1 o Módulo 2; la spec limita el caso de uso a Módulo 2 y OTA [PLAN].

La comparación entre el claim `otaId` del token y el `{otaId}` de la ruta es una regla de negocio y se hace en el caso de uso, **antes de leer `settlement`** [BASE regla 9] [PLAN].

### Headers

| Header | Obligatorio | Valor | Descripción | Origen |
|---|---|---|---|---|
| `Authorization` | Condicional | `Bearer <token>` | Solo para OTA (`role = OTA`, claim `otaId`). No lo envía Módulo 2 en la red interna. | [BASE] |
| `Accept` | No | `application/json` | Tipo MIME esperado. | [CONV] |
| `X-Correlation-Id` | No | string | Identificador de trazabilidad distribuida; si no llega, Módulo 3 lo genera. | [BASE] |

### Path Parameters

| Parámetro | Tipo | Obligatorio | Descripción | Origen |
|---|---|---|---|---|
| `otaId` | string | Sí | Identificador de la OTA (por ejemplo `booking`). Es el mismo valor que guarda `settlement.ota_id` y que lleva el claim `otaId` del JWT de la OTA. Módulo 3 no modela una tabla de OTAs. | [SPEC FR-009] [PLAN] |

El valor reservado **`DIRECT`** identifica al canal directo, que no es una OTA: la consulta se rechaza con `400 INVALID_QUERY_PARAMS` y nunca devuelve 0% como si fuera una comisión válida [SPEC FR-006, NFR-004] [PLAN].

No hay query params ni cuerpo.

### Ejemplos de Petición

#### Llamada de Módulo 2 (red interna, sin token)
```http
GET /ota-commission/booking
Accept: application/json
X-Correlation-Id: c89b3f0e-2d11-4a9f-9c02-7a8b9c0d1e2f
```

#### Llamada de una OTA a su propio historial
```http
GET /ota-commission/booking
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Accept: application/json
```

---

## 3. Reglas de Procesamiento

1. **Identificar al actor**: sin token es una llamada interna; con token se valida (inválido o expirado → `401 UNAUTHENTICATED`) y debe tener `role = OTA` (otro rol → `403 FORBIDDEN`) [SPEC FR-007, SC-005] [PLAN].
2. **Canal directo**: si `otaId` es `DIRECT`, se rechaza con `400 INVALID_QUERY_PARAMS` sin consultar `settlement` [SPEC FR-006] [PLAN].
3. **Alcance de la OTA**: si el actor es una OTA, `claim.otaId` debe ser igual a `{otaId}`; si no, `403 FORBIDDEN`, sin haber leído nada de `settlement`. Una OTA nunca accede al historial de otra [SPEC FR-009, BR-003, SC-006] [PLAN].
4. **Lectura**: se busca en `settlement` la liquidación del canal `OTA` con ese `otaId` y el `generated_at` más reciente (ver sección 4) [SPEC FR-001] [PLAN].
5. **Con liquidación**: responde `200` con `historical: true`, el porcentaje y la fecha de esa liquidación [SPEC HU1 escenario 1].
6. **Sin liquidación**: responde `200` con `historical: false`, sin porcentaje ni fecha. "Sin historial" es un resultado válido, no un `404`, para no confundirlo con un recurso inexistente [SPEC FR-004, SC-002] [PLAN].
7. **La más reciente, sin promediar**: si la OTA tuvo distintos porcentajes en el tiempo, se devuelve el de la liquidación más reciente; nunca un promedio ni uno arbitrario [SPEC casos límite].
8. **Sin vencimiento por antigüedad**: una OTA cuya única liquidación es muy antigua sigue devolviendo ese dato como su referencia más reciente. No hay caché con vida propia [SPEC casos límite] [PLAN].
9. **Determinismo**: consultas repetidas, sin liquidaciones nuevas, devuelven siempre el mismo resultado [SPEC FR-008, NFR-001].
10. **Sin efectos secundarios**: no se escribe nada, ni siquiera de forma transaccional. Ningún método del puerto ni del adaptador puede crear, actualizar ni corregir porcentajes [SPEC FR-005] [PLAN].

---

## 4. Fuente de datos

003 no tiene tablas propias. Lee, sin escribir nunca, la tabla `settlement` cuyo dueño es 007 [PLAN] [007]:

| Columna de `settlement` | Qué aporta a la respuesta |
|---|---|
| `ota_id` | Filtro por la OTA consultada; origen de `otaId`. |
| `channel` | Se filtra `channel = 'OTA'`, de modo que el canal directo nunca se devuelve. |
| `ota_commission_percentage` | Origen de `percentage` (`numeric(5,2)`, solo canal OTA). |
| `generated_at` | Orden (la más reciente) y origen de `settlementDate` (hora de la base de datos). |
| `id` | Origen de `settlementId`. |

`settlement` solo guarda liquidaciones `Final` (`status` siempre `FINAL`), por lo que la consulta ya devuelve únicamente liquidaciones `Final` [BASE] [007].

La consulta es un `SELECT` ordenado por `generated_at` descendente con límite 1, y usa el índice `(ota_id, generated_at DESC)` que 007 crea para esta feature [PLAN] [007].

**Coordinación con 007**: 003 lee `settlement` con su propio puerto de lectura (`ota-commission-query.port.ts`), definido en el plan base, y no depende del repositorio de `settlement`. 007 ya no expone una consulta equivalente (`findLatestByOtaId`); solo crea las columnas y el índice `(ota_id, generated_at DESC)` que 003 lee [PLAN] [007].

---

## 5. Respuesta Exitosa

`200 OK`

| Campo | Tipo | Requerido | Descripción | Origen |
|---|---|---|---|---|
| `otaId` | string | Sí | OTA consultada. | [PLAN] |
| `historical` | boolean | Sí | `true` si existe una liquidación `Final` de la OTA; `false` si no hay historial. Con `true`, el dato es histórico y referencial, no contractual. | [SPEC FR-002, FR-004] [PLAN] |
| `percentage` | string decimal | Solo si `historical = true` | Porcentaje de comisión de la liquidación `Final` más reciente, con 2 decimales (de `0.00` a `100.00`). | [SPEC FR-001] [PLAN] |
| `settlementId` | UUID | Solo si `historical = true` | Liquidación de la que proviene el porcentaje. | [PLAN] |
| `settlementDate` | datetime ISO 8601 UTC | Solo si `historical = true` | Fecha (`generated_at`) de esa liquidación. | [SPEC HU1] [PLAN] |

El porcentaje es un **string decimal exacto**, nunca `number` [PLAN] [CONV]. Con `historical = false` no se envían `percentage`, `settlementId` ni `settlementDate`: no hay ningún valor por defecto ni en cero [SPEC FR-004].

La respuesta contiene solo estos campos: ningún dato del huésped ni de liquidaciones de otras OTA [SPEC NFR-003] [PLAN].

### Ejemplo 1: OTA con liquidaciones previas

```json
{
  "otaId": "booking",
  "historical": true,
  "percentage": "15.00",
  "settlementId": "7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01",
  "settlementDate": "2026-10-08T16:02:00Z"
}
```

### Ejemplo 2: OTA sin liquidaciones previas

```json
{
  "otaId": "expedia",
  "historical": false
}
```

---

## 6. Errores

Todos los errores siguen el estándar `ApiError` del plan base: `{ errorCode, message, timestamp, path }` [BASE]. Ninguna respuesta de este endpoint es 5xx [BASE].

| HTTP | `errorCode` | Cuándo ocurre | Reintentable | Origen |
|---|---|---|---|---|
| **400** | `INVALID_QUERY_PARAMS` | `otaId` es `DIRECT` (canal directo, no es una OTA). | No | [SPEC FR-006] [PLAN] |
| **401** | `UNAUTHENTICATED` | Llega un token JWT inválido o expirado. | No | [BASE] [PLAN] |
| **403** | `FORBIDDEN` | Una OTA consulta el `otaId` de otra OTA, o el token tiene un rol distinto de `OTA`. | No | [SPEC FR-009, BR-003] [PLAN] |
| **422** | `UNEXPECTED_ERROR` | Error inesperado. | Sí | [PLAN] |

- **No existe `404`**: una OTA sin liquidaciones recibe `200` con `historical: false`.
- **Sin fuga de información en el `403`**: el mensaje es genérico y el cuerpo es el mismo exista o no historial de la otra OTA. La validación del alcance ocurre antes de leer `settlement`, así que ni el contenido ni el tiempo de respuesta delatan si la otra OTA tiene liquidaciones [SPEC SC-006, NFR-003] [PLAN].

### Ejemplo de error

```json
{
  "errorCode": "FORBIDDEN",
  "message": "No tiene permiso para consultar la información de esta OTA.",
  "timestamp": "2026-10-10T14:40:00Z",
  "path": "/ota-commission/expedia"
}
```

---

## 7. Garantías para quien llama

- **Solo el propio historial**: una OTA nunca ve el porcentaje de otra OTA [SPEC BR-003, SC-006].
- **Sin valores por defecto**: nunca se devuelve 0% ni un porcentaje supuesto; ni para una OTA sin historial ni para el canal directo [SPEC FR-004, FR-006, SC-002].
- **Siempre referencial**: el resultado no es fuente de verdad del porcentaje de ninguna reserva ni afecta a `Generar liquidación` [SPEC FR-002, BR-001, BR-004, SC-003].
- **Solo lectura y determinista**: sin efectos secundarios y con el mismo resultado ante la misma entrada [SPEC FR-005, FR-008, SC-004].
- **Privacidad**: no expone datos del huésped ni de otras OTA [SPEC NFR-003, NFR-004].
- Un cambio en los campos de la respuesta o en el identificador `DIRECT` requiere coordinar con Módulo 2 y con las OTA y actualizar `test/contract/ota-commission.contract.spec.ts` [PLAN].
