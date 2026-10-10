# Contrato REST: Consultar liquidación

**Feature**: 002 Consultar liquidación
**Spec**: [consultar_liquidacion.md](../../1-functional/consultar_liquidacion.md)
**Plan**: [plan.md](../plan.md)
**Plan Base**: [plan-tecnico-base.md](../../../../docs/plan-tecnico-base.md)

**Etiquetas de origen**: `[SPEC]` requisito funcional; `[PLAN]` diseño técnico de Módulo 3; `[BASE]` plataforma compartida; `[CONV]` convención de respuesta.

## 1. Propósito

Permite a Módulo 1 consultar una liquidación informativa o final de una habitación, y a una OTA consultar las liquidaciones finales de habitaciones con check-out de una reserva propia [SPEC FR-001, FR-002, FR-009]. La operación es de lectura y no crea ni modifica liquidaciones o facturas [SPEC FR-004].

## 2. Petición

### Ruta y autenticación

`GET /api/settlements` [BASE]. Una llamada interna de Módulo 1 no envía token. Una petición autenticada valida el token y requiere `role = OTA` y claim `otaId`; cualquier otro rol recibe `403 FORBIDDEN` [BASE].

### Parámetros

| Parámetro | Tipo | Módulo 1 | OTA | Descripción |
|---|---|---|---|---|
| `reservationRef` | string | Obligatorio | Obligatorio | Referencia opaca de reserva, de 3 a 64 caracteres; no es UUID. |
| `roomId` | UUID | Obligatorio | Se ignora si llega | Identificador de habitación solicitado por Módulo 1. |
| `categoryRoom` | string no vacío | Obligatorio | Se ignora si llega | Tipo de habitación solicitado por Módulo 1. |
| `checkInDate` | fecha | Opcional, ignorado | Ignorado | No filtra el resultado. |
| `checkOutDate` | fecha | Opcional, ignorado | Ignorado | No filtra el resultado. |
| `source` | string | Opcional, ignorado | Ignorado | El canal procede de la reserva consultada. |

Otros parámetros no listados se ignoran [CONV].

Ejemplos:

```http
GET /api/settlements?reservationRef=RES-000123&roomId=f47ac10b-58cc-4372-a567-0e02b2c3d479&categoryRoom=DOBLE
```

```http
GET /api/settlements?reservationRef=RES-000123
Authorization: Bearer <token OTA>
```

## 3. Respuesta

### Respuesta de Módulo 1

Devuelve un objeto individual con `settlementType` `FINAL` o `INFORMATIVE` y los campos de respuesta descritos a continuación. Si existe una liquidación `FINAL` para `(reservationRef, roomId)`, se devuelve sin comparar `categoryRoom`; este parámetro solo se usa para calcular la informativa. La liquidación informativa solo está disponible para Módulo 1 y lleva `invoice: null` [SPEC FR-003, FR-009, FR-010].

```json
{
  "settlementType": "INFORMATIVE",
  "reservationRef": "RES-000789",
  "roomId": "9c8b7a6f-5e4d-4c2b-9a0f-123456789abc",
  "categoryRoom": "DOBLE",
  "channel": "OTA",
  "otaId": "expedia",
  "currency": "COP",
  "breakdown": {
    "lodgingAmount": "1200000.00",
    "otaCommissionPercentage": "18.00",
    "otaCommissionAmount": "216000.00",
    "netIncome": "984000.00"
  },
  "invoice": null,
  "generatedAt": "2026-10-08T11:45:00-05:00"
}
```

### Respuesta de OTA

Devuelve todas las liquidaciones `FINAL` de habitaciones de la reserva que ya tuvieron check-out, ordenadas por `roomId`. Habitaciones sin check-out no aparecen. Sin liquidaciones disponibles, o si la reserva es directa o pertenece a otra OTA, responde `404 SETTLEMENT_NOT_FOUND` [SPEC HU1, FR-002, FR-005, FR-006].

```json
{
  "reservationRef": "RES-000123",
  "settlements": [
    {
      "settlementType": "FINAL",
      "reservationRef": "RES-000123",
      "roomId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "categoryRoom": "DOBLE",
      "channel": "OTA",
      "otaId": "booking",
      "currency": "COP",
      "breakdown": {
        "lodgingAmount": "750000.00",
        "otaCommissionPercentage": "15.00",
        "otaCommissionAmount": "112500.00",
        "netIncome": "637500.00"
      },
      "invoice": {
        "invoiceId": "7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01",
        "invoiceNumber": 1042,
        "issuedAt": "2026-10-08T11:05:12-05:00",
        "vatRateApplied": "19.00",
        "vatAmount": "142500.00",
        "totalAmount": "892500.00",
        "status": "ISSUED"
      },
      "generatedAt": "2026-10-08T11:02:00-05:00"
    }
  ]
}
```

### Objeto de liquidación

| Campo | Tipo | Descripción |
|---|---|---|
| `settlementType` | string | `FINAL` para liquidación definitiva o `INFORMATIVE` para informativa. |
| `reservationRef` | string | Referencia opaca de reserva. |
| `roomId` | UUID | Habitación de la reserva. |
| `categoryRoom` | string | Tipo de habitación. |
| `channel` | string | `DIRECT` o `OTA`, obtenido de la reserva. |
| `otaId` | string o null | Identidad de OTA si aplica. |
| `currency` | string | `COP`. |
| `breakdown` | objeto | `lodgingAmount`, `otaCommissionPercentage`, `otaCommissionAmount`, `netIncome`. Importes decimales en texto; el ingreso neto es hospedaje menos comisión y no incluye IVA. |
| `invoice` | objeto o null | Subconjunto de factura 006/008: `invoiceId`, `invoiceNumber`, `issuedAt`, `vatRateApplied`, `vatAmount`, `totalAmount`, `status`. Nulo si no hay factura emitida o si es informativa. |
| `generatedAt` | fecha y hora ISO 8601 | Momento del cálculo o generación. |

Para Módulo 1, una consulta sin liquidación final calcula en memoria una informativa a partir de `SettlementCalculator` de 007, la reserva obtenida por `ReservationClientPort` y la cotización consultada mediante `LodgingQuoteQueryPort`. No la persiste. Para OTA, no se devuelve una informativa [SPEC FR-009, FR-011].

## 4. Cómo interpreta cada respuesta

- La liquidación `FINAL` se lee sin recalcularla; la factura se obtiene por `settlementId` y se adjunta solo si ya fue emitida [SPEC FR-003, FR-004].
- `Cache-Control: no-store` evita almacenar respuestas financieras y `X-Correlation-Id` identifica la solicitud [CONV].
- Las lecturas de persistencia usan una transacción `READ ONLY` [PLAN]. Una lectura concurrente con el check-out entrega `INFORMATIVE` o `FINAL`, nunca un estado intermedio [SPEC NFR-002].
- Una reserva OTA sin comisión o con comisión inválida durante el cálculo informativo produce el error correspondiente, sin valores parciales [SPEC FR-012].

## 5. Errores

Los errores siguen la estructura `ApiError` del Plan Base.

| HTTP | Código | Condición |
|---:|---|---|
| 400 | `INVALID_QUERY_PARAMS` | Falta o tiene formato inválido un parámetro obligatorio para el actor. |
| 401 | `UNAUTHENTICATED` | Token ausente o inválido en una petición autenticada. |
| 403 | `FORBIDDEN` | Token válido con rol distinto de OTA. |
| 404 | `SETTLEMENT_NOT_FOUND` | No hay liquidaciones finales para la consulta OTA o la reserva es ajena/directa. |
| 404 | `RESERVATION_NOT_FOUND` | No existe la reserva consultada para el cálculo informativo. |
| 404 | `QUOTE_NOT_FOUND` | No existe cotización aplicable para el cálculo informativo. |
| 424 | `MODULE2_UNAVAILABLE` | Módulo 2 no responde o entrega una respuesta no utilizable durante el cálculo informativo. |
| 409 | `MISSING_COMMISSION` | Reserva OTA sin comisión requerida para el cálculo informativo. |
| 409 | `INVALID_COMMISSION` | Comisión de la reserva OTA inválida para el cálculo informativo. |
