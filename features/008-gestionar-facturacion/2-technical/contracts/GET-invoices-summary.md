# Contrato REST: Resumen consolidado de facturas por canal

**Feature**: 008 Gestionar facturación — HU3
**Spec**: [gestionar_facturacion.md](../../1-functional/gestionar_facturacion.md)
**Plan**: [plan.md](../plan.md)

**Etiquetas de origen**: `[SPEC]` viene de la spec funcional, `[PLAN]` del plan técnico de la 008, `[BASE]` del plan técnico base (`docs/plan-tecnico-base.md`) y `[CONV]` es una convención técnica elegida para este contrato.

## 1. Propósito

El Administrador obtiene, para un rango de fechas de emisión, los totales de hospedaje, comisión OTA e IVA agrupados por canal de origen, para conciliar el ingreso facturado a cada OTA y verificar que el canal directo no tenga descuentos indebidos. Es una operación de solo lectura [SPEC HU3, FR-011, FR-012].

## 2. Petición

`GET /invoices/summary` [BASE]

### Headers

| Header | Obligatorio | Valor | Origen |
|---|---|---|---|
| `Authorization` | Sí | `Bearer <token>`, JWT de usuario con `role = Administrador`, emitido por `POST /auth/login` | [SPEC FR-010] [BASE] |
| `Accept` | No | `application/json` | [CONV] |
| `X-Correlation-Id` | No | Cadena libre; si no llega, el sistema genera uno y lo registra en los logs | [BASE] |

### Query params

| Parámetro | Tipo | Obligatorio | Descripción | Origen |
|---|---|---|---|---|
| `issuedFrom` | date (`YYYY-MM-DD`) | Sí | Inicio del rango de emisión, en hora de Bogotá | [SPEC FR-011, NFR-006] |
| `issuedTo` | date (`YYYY-MM-DD`) | Sí | Fin del rango de emisión (inclusive), en hora de Bogotá | [SPEC FR-011, NFR-006] |

### Ejemplo

```http
GET /invoices/summary?issuedFrom=2026-12-01&issuedTo=2026-12-31
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Accept: application/json
```

## 3. Reglas de procesamiento

1. **Autorización antes de todo**: sin token o con token inválido → `401`; con un JWT de rol distinto a `Administrador` → `403` [SPEC FR-010, BR-002].
2. **Rango obligatorio y válido**: si falta alguna de las dos fechas, o `issuedFrom` es posterior a `issuedTo` → `400 INVALID_DATE_RANGE`, sin resultado parcial [SPEC FR-013, SC-007].
3. **Zona horaria**: las fechas se interpretan en `America/Bogota` y se convierten al intervalo `[issuedFrom 00:00, issuedTo + 1 día 00:00)`. La zona usada se devuelve en `timezone` [SPEC NFR-006].
4. **Un grupo por canal**: el canal directo forma un grupo y cada OTA forma su propio grupo. Los importes de canales distintos nunca se mezclan [SPEC FR-012].
5. **Canales sin facturas en cero**: el canal directo aparece siempre. Cada OTA que tenga al menos una factura histórica aparece aunque no tenga facturas en el rango, con totales en cero [SPEC FR-014, HU3 escenario 2] [PLAN].
6. **Totales tal como fueron emitidos**: los totales son la suma de los importes persistidos en cada factura; no se recalcula ningún valor [SPEC BR-004, SC-006].
7. **Orden de los grupos**: primero `DIRECT` y después las OTA en orden alfabético de `otaId`, para que la respuesta sea siempre igual con los mismos datos [SPEC NFR-002] [CONV].
8. **Solo lectura**: la consulta corre en una transacción `READ ONLY` [SPEC FR-006, NFR-004].

## 4. Respuesta exitosa

`200 OK` — `Content-Type: application/json`

| Campo | Tipo | Descripción | Origen |
|---|---|---|---|
| `range.issuedFrom` | date | Inicio del rango consultado | [SPEC FR-011] |
| `range.issuedTo` | date | Fin del rango consultado | [SPEC FR-011] |
| `timezone` | string | Zona horaria aplicada, `America/Bogota` | [SPEC NFR-006] |
| `currency` | string | Moneda de los importes, `COP` | [BASE] |
| `channels` | array | Un elemento por canal | [SPEC FR-011] |
| `channels[].channel` | `DIRECT` \| `OTA` | Canal de origen | [SPEC FR-012] |
| `channels[].otaId` | string \| null | OTA del grupo; `null` en el canal directo | [SPEC FR-012] |
| `channels[].invoiceCount` | integer | Cantidad de facturas del grupo en el rango | [PLAN] |
| `channels[].totalLodging` | string decimal | Total de hospedaje | [SPEC FR-012] |
| `channels[].totalOtaCommission` | string decimal | Total de comisión OTA; siempre `"0.00"` en el canal directo | [SPEC FR-012, HU3] |
| `channels[].totalVat` | string decimal | Total de IVA | [SPEC FR-012] |
| `channels[].totalInvoiced` | string decimal | Total facturado (con IVA) | [PLAN] |

Los importes van como decimal en texto para no perder precisión [CONV].

### Ejemplo con facturas en el período

```json
{
  "range": { "issuedFrom": "2026-12-01", "issuedTo": "2026-12-31" },
  "timezone": "America/Bogota",
  "currency": "COP",
  "channels": [
    {
      "channel": "DIRECT",
      "otaId": null,
      "invoiceCount": 14,
      "totalLodging": "9800000.00",
      "totalOtaCommission": "0.00",
      "totalVat": "1862000.00",
      "totalInvoiced": "11662000.00"
    },
    {
      "channel": "OTA",
      "otaId": "airbnb",
      "invoiceCount": 0,
      "totalLodging": "0.00",
      "totalOtaCommission": "0.00",
      "totalVat": "0.00",
      "totalInvoiced": "0.00"
    },
    {
      "channel": "OTA",
      "otaId": "booking",
      "invoiceCount": 6,
      "totalLodging": "4500000.00",
      "totalOtaCommission": "675000.00",
      "totalVat": "855000.00",
      "totalInvoiced": "5355000.00"
    }
  ]
}
```

En este ejemplo `airbnb` no tuvo facturas en diciembre, pero aparece en cero porque ya tiene facturas de meses anteriores [SPEC FR-014].

## 5. Errores

Todos los errores usan el formato `ApiError` del plan base: `{ errorCode, message, timestamp, path }` [BASE].

| HTTP | `errorCode` | Cuándo ocurre | Reintentable | Origen |
|---|---|---|---|---|
| 400 | `INVALID_DATE_RANGE` | Falta `issuedFrom` o `issuedTo`, o `issuedFrom` es posterior a `issuedTo` | No | [SPEC FR-013] |
| 400 | `INVALID_QUERY_PARAMS` | Alguna fecha no tiene el formato `YYYY-MM-DD` | No | [CONV] |
| 401 | `UNAUTHENTICATED` | Falta el token o es inválido o expiró | No | [SPEC FR-010] [BASE] |
| 403 | `FORBIDDEN` | El token es válido pero el rol no es `Administrador` | No | [SPEC FR-010, BR-002] |
| 503 | `DATABASE_UNAVAILABLE` | La base de datos no responde | Sí | [BASE] [CONV] |

### Ejemplo de error

```json
{
  "errorCode": "INVALID_DATE_RANGE",
  "message": "La fecha de inicio (2026-12-31) es posterior a la fecha de fin (2026-12-01).",
  "timestamp": "2026-12-31T18:30:00Z",
  "path": "/invoices/summary"
}
```
