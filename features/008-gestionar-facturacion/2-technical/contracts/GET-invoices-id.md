# Contrato REST: Consultar detalle de factura

**Feature**: 008 Gestionar facturación — HU2
**Spec**: [gestionar_facturacion.md](../../1-functional/gestionar_facturacion.md)
**Plan**: [plan.md](../plan.md)

**Etiquetas de origen**: `[SPEC]` viene de la spec funcional, `[PLAN]` del plan técnico de la 008, `[BASE]` del plan técnico base (`docs/plan-tecnico-base.md`) y `[CONV]` es una convención técnica elegida para este contrato.

## 1. Propósito

El Administrador abre una factura localizada con la búsqueda (`GET /invoices`) y ve su desglose completo (hospedaje, comisión OTA, IVA y total) y su trazabilidad (liquidación de origen, fecha y hora de emisión), tal como fue emitida por `Generar factura final`. Es una operación de solo lectura: no recalcula ni modifica nada [SPEC HU2, FR-004, FR-005, FR-006].

## 2. Petición

`GET /invoices/{invoiceId}` [BASE]

### Headers

| Header | Obligatorio | Valor | Origen |
|---|---|---|---|
| `Authorization` | Sí | `Bearer <token>`, JWT de usuario con `role = Administrador`, emitido por `POST /auth/login` | [SPEC FR-010] [BASE] |
| `Accept` | No | `application/json` | [CONV] |
| `X-Correlation-Id` | No | Cadena libre; si no llega, el sistema genera uno y lo registra en los logs | [BASE] |

### Path params

| Parámetro | Tipo | Obligatorio | Descripción | Origen |
|---|---|---|---|---|
| `invoiceId` | UUID | Sí | Identificador de la factura, obtenido de `items[].invoiceId` en la búsqueda | [PLAN] |

### Ejemplo

```http
GET /invoices/7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Accept: application/json
```

## 3. Reglas de procesamiento

1. **Autorización antes de todo**: sin token o con token inválido → `401`; con un JWT de rol distinto a `Administrador` → `403` [SPEC FR-010, BR-002].
2. **Formato del id**: si `invoiceId` no es un UUID válido → `400 INVALID_QUERY_PARAMS`, sin consultar la base de datos [CONV].
3. **Factura inexistente**: si no existe una factura con ese id → `404 INVOICE_NOT_FOUND` [PLAN].
4. **Importes tal como fueron emitidos**: todos los valores se leen de la factura persistida por la feature 006; nunca se recalculan ni se derivan por separado [SPEC FR-004, BR-004, SC-003].
5. **Lista blanca de campos**: la respuesta solo incluye los campos de la tabla de la sección 4. Nunca incluye datos migratorios (nacionalidad, tipo de documento, visa) ni datos personales del huésped [SPEC FR-009, NFR-003].
6. **Inmutable**: toda factura emitida tiene estado `ISSUED` y es inmutable; la respuesta lo indica explícitamente [SPEC HU2 escenario 1].
7. **Solo lectura**: la consulta corre en una transacción `READ ONLY` [SPEC FR-006, NFR-004].

## 4. Respuesta exitosa

`200 OK` — `Content-Type: application/json`

| Campo | Tipo | Descripción | Origen |
|---|---|---|---|
| `invoiceId` | UUID | Identificador de la factura | [PLAN] |
| `invoiceNumber` | integer | Número de la numeración consecutiva oficial | [SPEC HU2 escenario 1] |
| `status` | `ISSUED` | Estado de la factura; siempre `ISSUED` | [SPEC HU2 escenario 1] |
| `immutable` | boolean | Siempre `true`: la factura no se puede modificar | [SPEC HU2 escenario 1] |
| `issuedAt` | datetime ISO 8601 | Fecha y hora de emisión | [SPEC FR-005] |
| `settlementId` | UUID | Liquidación de origen | [SPEC FR-005] |
| `stayId` | UUID | Estancia facturada | [SPEC FR-001] |
| `reservationRef` | string | Reserva de la estancia | [SPEC FR-001] |
| `channel` | `DIRECT` \| `OTA` | Canal de origen | [SPEC FR-004] |
| `otaId` | string \| null | OTA, solo si `channel = OTA` | [PLAN] |
| `customer.name` | string | Nombre o razón social del cliente | [SPEC FR-001] |
| `customer.taxId` | string | Documento fiscal del cliente | [SPEC FR-001] |
| `currency` | string | Moneda de los importes, `COP` | [BASE] |
| `lodgingAmount` | string decimal | Valor de hospedaje (base gravable) | [SPEC FR-004] |
| `otaCommissionAmount` | string decimal | Comisión OTA informativa; `"0.00"` en canal directo | [SPEC FR-004] |
| `netIncome` | string decimal | Ingreso neto de la liquidación (hospedaje menos comisión) | [SPEC FR-004] |
| `vatRateApplied` | string decimal | Porcentaje de IVA aplicado al emitir, p. ej. `"19.00"` | [SPEC FR-004] |
| `vatAmount` | string decimal | Valor del IVA | [SPEC FR-004] |
| `totalAmount` | string decimal | Total facturado | [SPEC FR-004] |

Los importes van como decimal en texto para no perder precisión [CONV].

### Ejemplo (factura de canal OTA)

```json
{
  "invoiceId": "7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01",
  "invoiceNumber": 1042,
  "status": "ISSUED",
  "immutable": true,
  "issuedAt": "2026-12-23T11:05:12-05:00",
  "settlementId": "4e2b8c1d-9a7f-4f3e-b6d5-0c1a2b3d4e5f",
  "stayId": "c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c",
  "reservationRef": "RES-000123",
  "channel": "OTA",
  "otaId": "booking",
  "customer": {
    "name": "Comercializadora Andina S.A.S.",
    "taxId": "900123456-7"
  },
  "currency": "COP",
  "lodgingAmount": "750000.00",
  "otaCommissionAmount": "112500.00",
  "netIncome": "637500.00",
  "vatRateApplied": "19.00",
  "vatAmount": "142500.00",
  "totalAmount": "892500.00"
}
```

## 5. Errores

Todos los errores usan el formato `ApiError` del plan base: `{ errorCode, message, timestamp, path }` [BASE].

| HTTP | `errorCode` | Cuándo ocurre | Reintentable | Origen |
|---|---|---|---|---|
| 400 | `INVALID_QUERY_PARAMS` | `invoiceId` no es un UUID válido | No | [CONV] |
| 401 | `UNAUTHENTICATED` | Falta el token o es inválido o expiró | No | [SPEC FR-010] [BASE] |
| 403 | `FORBIDDEN` | El token es válido pero el rol no es `Administrador` | No | [SPEC FR-010, BR-002] |
| 404 | `INVOICE_NOT_FOUND` | No existe una factura con ese id | No | [BASE] [PLAN] |

### Ejemplo de error

```json
{
  "errorCode": "INVOICE_NOT_FOUND",
  "message": "No existe una factura con el identificador 7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01.",
  "timestamp": "2026-12-31T18:25:00Z",
  "path": "/invoices/7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01"
}
```
