# Contrato REST: Buscar facturas

**Feature**: 008 Gestionar facturación — HU1
**Spec**: [gestionar_facturacion.md](../../1-functional/gestionar_facturacion.md)
**Plan**: [plan.md](../plan.md)

**Etiquetas de origen**: `[SPEC]` viene de la spec funcional, `[PLAN]` del plan técnico de la 008, `[BASE]` del plan técnico base (`docs/plan-tecnico-base.md`) y `[CONV]` es una convención técnica elegida para este contrato.

## 1. Propósito

El Administrador busca facturas fiscales definitivas (emitidas por `Generar factura final`, feature 006) usando uno o varios criterios: estancia, reserva, cliente, canal o rango de fechas de emisión. El resultado es paginado, determinista y muestra el número oficial de cada factura. Es una operación de solo lectura [SPEC HU1, FR-001, FR-006].

## 2. Petición

`GET /invoices` [BASE]

### Headers

| Header | Obligatorio | Valor | Origen |
|---|---|---|---|
| `Authorization` | Sí | `Bearer <token>`, JWT de usuario con `role = Administrador`, emitido por `POST /auth/login` | [SPEC FR-010] [BASE] |
| `Accept` | No | `application/json` | [CONV] |
| `X-Correlation-Id` | No | Cadena libre; si no llega, el sistema genera uno y lo registra en los logs | [BASE] |

### Query params

Todos son opcionales, pero debe llegar **al menos un criterio** (los marcados con ✔ en la columna "Criterio") [SPEC FR-002].

| Parámetro | Tipo | Criterio | Descripción | Origen |
|---|---|---|---|---|
| `stayId` | UUID | ✔ | Estancia (una habitación de la reserva) | [SPEC FR-001] |
| `reservationRef` | string | ✔ | Referencia de la reserva, p. ej. `RES-000123` | [SPEC FR-001] |
| `customerName` | string | ✔ | Nombre o razón social del cliente | [SPEC FR-001] |
| `customerMatch` | `EXACT` \| `PARTIAL` | | Tipo de coincidencia para `customerName`. Por defecto `EXACT` | [SPEC casos límite] [PLAN] |
| `customerTaxId` | string | ✔ | Documento fiscal del cliente (siempre coincidencia exacta) | [SPEC FR-001] |
| `channel` | `DIRECT` \| `OTA` | ✔ | Canal de origen | [SPEC FR-001] |
| `otaId` | string | | OTA específica; solo válido con `channel=OTA` | [PLAN] |
| `issuedFrom` | date (`YYYY-MM-DD`) | ✔ (junto con `issuedTo`) | Inicio del rango de emisión, en hora de Bogotá | [SPEC FR-001, NFR-006] |
| `issuedTo` | date (`YYYY-MM-DD`) | ✔ (junto con `issuedFrom`) | Fin del rango de emisión (inclusive), en hora de Bogotá | [SPEC FR-001, NFR-006] |
| `page` | integer ≥ 1 | | Página solicitada. Por defecto `1` | [SPEC FR-007] |
| `pageSize` | integer 1–100 | | Facturas por página. Por defecto `20`, máximo `100` | [SPEC FR-007] [PLAN] |
| `asOf` | datetime ISO 8601 | | Foto de la búsqueda. No se envía en la primera página; en las siguientes se reenvía el `asOf` recibido | [SPEC NFR-002] [PLAN] |

### Ejemplo

```http
GET /invoices?channel=OTA&otaId=booking&issuedFrom=2026-12-01&issuedTo=2026-12-31&page=1&pageSize=20
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Accept: application/json
```

## 3. Reglas de procesamiento

1. **Autorización antes de todo**: sin token o con token inválido → `401`; con un JWT de rol distinto a `Administrador` → `403` [SPEC FR-010, BR-002].
2. **Al menos un criterio**: `page`, `pageSize`, `asOf` y `customerMatch` no cuentan como criterio. Sin criterios → `400 MISSING_SEARCH_CRITERIA`, sin consultar la base de datos [SPEC FR-002].
3. **Rango de fechas**: `issuedFrom` e `issuedTo` van juntos; si llega solo uno, o `issuedFrom` es posterior a `issuedTo` → `400 INVALID_DATE_RANGE`, sin resultado parcial [SPEC FR-013, SC-007].
4. **Zona horaria**: las fechas se interpretan en `America/Bogota` y se convierten al intervalo `[issuedFrom 00:00, issuedTo + 1 día 00:00)` [SPEC NFR-006].
5. **Coincidencia de cliente**: `EXACT` compara el nombre completo sin distinguir mayúsculas; `PARTIAL` busca el texto dentro del nombre y exige al menos 3 caracteres. La respuesta siempre indica el modo aplicado en `customerMatchMode` [SPEC casos límite].
6. **Foto de la búsqueda (`asOf`)**: si no llega, el sistema lo fija con la hora de la base de datos y lo devuelve. Solo se incluyen facturas con `issuedAt <= asOf`, así que las facturas emitidas mientras se navega no mueven las páginas. `asOf` no puede ser futuro [SPEC NFR-002] [PLAN].
7. **Orden**: siempre por fecha de emisión descendente y, en empate, por número oficial descendente [SPEC NFR-002].
8. **Sin coincidencias**: responde `200` con `items` vacío y `resultStatus: "NO_MATCHES"`, nunca un error [SPEC FR-008].
9. **Solo lectura**: la consulta corre en una transacción `READ ONLY` y no modifica facturas ni liquidaciones [SPEC FR-006, NFR-004].
10. **Privacidad**: los resultados no incluyen datos migratorios ni datos personales del huésped [SPEC FR-009, NFR-003].

## 4. Respuesta exitosa

`200 OK` — `Content-Type: application/json`

| Campo | Tipo | Descripción | Origen |
|---|---|---|---|
| `items` | array | Facturas de la página solicitada | [SPEC FR-001] |
| `items[].invoiceId` | UUID | Identificador de la factura; se usa para abrir el detalle | [PLAN] |
| `items[].invoiceNumber` | integer | Número de la numeración consecutiva oficial | [SPEC FR-003] |
| `items[].issuedAt` | datetime ISO 8601 | Fecha y hora de emisión | [SPEC FR-005] |
| `items[].stayId` | UUID | Estancia facturada | [SPEC FR-001] |
| `items[].reservationRef` | string | Reserva de la estancia | [SPEC FR-001] |
| `items[].channel` | `DIRECT` \| `OTA` | Canal de origen | [SPEC FR-001] |
| `items[].otaId` | string \| null | OTA, solo si `channel = OTA` | [PLAN] |
| `items[].customerName` | string | Nombre o razón social del cliente | [SPEC FR-001] |
| `items[].customerTaxId` | string | Documento fiscal del cliente | [SPEC FR-001] |
| `items[].currency` | string | Moneda de los importes, `COP` | [BASE] |
| `items[].totalAmount` | string decimal | Total facturado (con IVA), tal como fue emitido | [SPEC BR-004] [CONV] decimal como texto para no perder precisión |
| `page` | integer | Página devuelta | [SPEC FR-007] |
| `pageSize` | integer | Tamaño de página aplicado | [SPEC FR-007] |
| `totalItems` | integer | Total de facturas que cumplen los criterios (todas las páginas) | [SPEC FR-007] |
| `totalPages` | integer | Total de páginas | [SPEC FR-007] |
| `asOf` | datetime ISO 8601 | Foto usada; el cliente la reenvía al pedir otras páginas | [PLAN] |
| `resultStatus` | `MATCHES` \| `NO_MATCHES` | Indica explícitamente si hubo coincidencias | [SPEC FR-008] |
| `customerMatchMode` | `EXACT` \| `PARTIAL` \| null | Modo de coincidencia aplicado al nombre; `null` si no se buscó por nombre | [SPEC casos límite] |

### Ejemplo con resultados

```json
{
  "items": [
    {
      "invoiceId": "7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01",
      "invoiceNumber": 1042,
      "issuedAt": "2026-12-23T11:05:12-05:00",
      "stayId": "c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c",
      "reservationRef": "RES-000123",
      "channel": "OTA",
      "otaId": "booking",
      "customerName": "Comercializadora Andina S.A.S.",
      "customerTaxId": "900123456-7",
      "currency": "COP",
      "totalAmount": "892500.00"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "totalItems": 1,
  "totalPages": 1,
  "asOf": "2026-12-31T18:20:00.000-05:00",
  "resultStatus": "MATCHES",
  "customerMatchMode": null
}
```

### Ejemplo sin coincidencias

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "totalItems": 0,
  "totalPages": 0,
  "asOf": "2026-12-31T18:20:00.000-05:00",
  "resultStatus": "NO_MATCHES",
  "customerMatchMode": "PARTIAL"
}
```

## 5. Errores

Todos los errores usan el formato `ApiError` del plan base: `{ errorCode, message, timestamp, path }` [BASE].

| HTTP | `errorCode` | Cuándo ocurre | Reintentable | Origen |
|---|---|---|---|---|
| 400 | `MISSING_SEARCH_CRITERIA` | No llegó ningún criterio de búsqueda | No | [SPEC FR-002] |
| 400 | `INVALID_DATE_RANGE` | Llegó solo una de las dos fechas, o `issuedFrom` es posterior a `issuedTo` | No | [SPEC FR-013] |
| 400 | `INVALID_QUERY_PARAMS` | Formato inválido: UUID o fecha mal escritos, `pageSize` fuera de 1–100, `asOf` futuro, `otaId` sin `channel=OTA`, `PARTIAL` con menos de 3 caracteres | No | [PLAN] [CONV] |
| 401 | `UNAUTHENTICATED` | Falta el token o es inválido o expiró | No | [SPEC FR-010] [BASE] |
| 403 | `FORBIDDEN` | El token es válido pero el rol no es `Administrador` | No | [SPEC FR-010, BR-002] |

### Ejemplo de error

```json
{
  "errorCode": "MISSING_SEARCH_CRITERIA",
  "message": "Debe indicar al menos un criterio de búsqueda: estancia, reserva, cliente, canal o rango de fechas de emisión.",
  "timestamp": "2026-12-31T18:20:00Z",
  "path": "/invoices"
}
```
