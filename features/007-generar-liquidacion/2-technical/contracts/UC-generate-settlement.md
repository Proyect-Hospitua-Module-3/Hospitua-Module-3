# Contrato de caso de uso: Generar liquidación

**Feature**: 007 Generar liquidación — HU1, HU2, HU3
**Spec**: [generar_liquidacion.md](../../1-functional/generar_liquidacion.md)
**Plan**: [plan.md](../plan.md)

**Etiquetas de origen**: `[SPEC]` viene de la spec funcional, `[PLAN]` del plan técnico de la 007, `[BASE]` del plan técnico base (`docs/plan-tecnico-base.md`) y `[CONV]` es una convención técnica elegida para este contrato.

## 1. Propósito

`Generar liquidación` no expone endpoint REST ni consumer propio: es un caso de uso interno que solo invocan (`<<include>>`) `Registrar Check-out` (010) y `Generar factura final` (006). Este contrato define la entrada, la salida y los errores de `GenerateSettlementUseCase.generate`, que es lo que 010 y 006 necesitan para integrarse [SPEC FR-001, FR-019] [PLAN].

Genera la liquidación `Final` de la estancia de una habitación y es idempotente por `stayId` [SPEC FR-010, FR-011].

## 2. Invocación

```ts
// src/domain/ports/in/generate-settlement.use-case.ts
generate(command: GenerateSettlementCommand): Promise<Settlement>
```

Solo pueden inyectarlo `checkout-ingestion` (010) y `billing` (006); ningún controller lo usa [SPEC FR-001] [PLAN].

### `GenerateSettlementCommand`

010 lo arma a partir del `payload` del evento `habitacion.checkout`; 006 lo arma a partir de los datos de la liquidación/estancia que ya tiene [BASE] [PLAN].

| Campo | Tipo | Obligatorio | Descripción | Origen |
|---|---|---|---|---|
| `eventId` | UUID | Sí | `eventId` del evento de Módulo 1; se guarda como `source_event_id` | [BASE] [SPEC NFR-003] |
| `stayId` | UUID | Sí | Estancia (una habitación de la reserva); clave de idempotencia | [BASE] [SPEC FR-010] |
| `reservationRef` | string | Sí | Reserva que se consulta en Módulo 2, p. ej. `RES-000123` | [BASE] [SPEC FR-005] |
| `roomId` | UUID | Sí | Habitación liquidada | [SPEC FR-016, FR-020] |
| `roomType` | string | Sí | Tipo de habitación confirmado por Módulo 1; elige la cotización | [BASE] [SPEC FR-020] |
| `checkInDate` | date `YYYY-MM-DD` | Sí | Fecha **real** de entrada | [SPEC FR-016] |
| `checkOutDate` | date `YYYY-MM-DD` | Sí | Fecha **real** de salida; posterior a `checkInDate` | [SPEC FR-016] |
| `billingCustomer.name` | string | No | Nombre o razón social para la factura; se guarda tal cual para 006 | [BASE] [PLAN] |
| `billingCustomer.taxId` | string | No | Documento fiscal para la factura | [BASE] [PLAN] |

El comando nunca trae `channel`, `lodgingAmount` ni datos de la OTA: el canal y la comisión salen de la reserva de Módulo 2 y el hospedaje de la cotización guardada [BASE] [SPEC BR-010].

### Ejemplo

```json
{
  "eventId": "9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72",
  "stayId": "c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c",
  "reservationRef": "RES-000123",
  "roomId": "5f0e8a47-1b2c-4d3e-9f6a-7b8c9d0e1f23",
  "roomType": "DOBLE",
  "checkInDate": "2026-12-20",
  "checkOutDate": "2026-12-23",
  "billingCustomer": {
    "name": "Comercializadora Andina S.A.S.",
    "taxId": "900123456-7"
  }
}
```

## 3. Reglas de procesamiento

Se ejecutan en este orden; la primera que falla detiene el proceso y no se guarda nada.

1. **Validación del comando**: los campos obligatorios deben venir y `checkOutDate` debe ser posterior a `checkInDate`. 007 revalida las fechas con `DateRange` aunque 010 ya lo haya hecho [PLAN] [SPEC BR-007].
2. **Idempotencia**: se busca la liquidación por `stayId` [SPEC FR-011] [PLAN].
   - Existe y `reservationRef`, `roomId`, `roomType`, `checkInDate` y `checkOutDate` coinciden con el comando → devuelve la existente sin llamar a Módulo 2 ni recalcular [SPEC HU1 escenarios 3 y 4].
   - Existe con algún dato distinto → `SETTLEMENT_ALREADY_EXISTS`; la original no cambia [SPEC FR-010, HU3 escenario 2].
3. **Reserva**: consulta `GET /api/reservations/{reservationRef}` a Módulo 2 (ver [CLIENT-get-reservation.md](CLIENT-get-reservation.md)). 404 → `RESERVATION_NOT_FOUND`; timeout, 5xx o circuito abierto → `MODULE2_UNAVAILABLE` [SPEC FR-014, FR-021].
4. **Cotización**: lee las cotizaciones de `reservation.quoteIds` y elige la de `roomType` igual al del comando. Ninguna coincide → `QUOTE_NOT_FOUND`. Si varias coinciden se usa la de menor `quoteId`, para que el resultado sea siempre el mismo [SPEC FR-020, NFR-001] [PLAN].
5. **Canal**: `OTA` si la reserva lo informa; `DIRECT` si es otro canal o no informa ninguno [SPEC FR-003, FR-004].
   - `OTA` sin `otaCommissionPercentage` → `MISSING_COMMISSION`.
   - `OTA` con porcentaje menor a 0 o mayor a 100 → `INVALID_COMMISSION`.
   - Nunca se asume un porcentaje por defecto [SPEC FR-014, HU2 escenario 3].
6. **Cálculo** con `SettlementCalculator`, aritmética decimal exacta, redondeo half-up a 2 decimales, moneda de la cotización (`COP`) [SPEC FR-006, FR-007, FR-008, NFR-004] [PLAN]:
   - `lodgingAmount` = `lodgingAmount` de la cotización, sin recalcular la tarifa dinámica [SPEC FR-002, BR-004].
   - `DIRECT`: `otaCommissionAmount = 0.00`, `netIncome = lodgingAmount`.
   - `OTA`: `otaCommissionAmount = lodgingAmount × porcentaje / 100`, `netIncome = lodgingAmount − otaCommissionAmount`.
   - El IVA no entra en el cálculo; lo agrega 006 al facturar [SPEC FR-013, BR-005].
7. **Guardado** con `status = FINAL` y `generated_at` con la hora de la base de datos. Si otra entrega concurrente del mismo `stayId` ganó la inserción (`UNIQUE(stay_id)`), vuelve al paso 2 y aplica la misma regla de comparación [SPEC FR-009, FR-011] [PLAN].
8. **Sin efectos secundarios**: no modifica disponibilidad, ocupación ni bloqueo de la habitación, y no emite la factura [SPEC FR-018, FR-019, BR-008, BR-009].
9. **Inmutable**: la liquidación nunca se actualiza una vez creada [SPEC FR-009, FR-017].

## 4. Resultado exitoso

Devuelve la entidad `Settlement`, sea recién creada o la ya existente (el llamador no distingue una de otra) [SPEC FR-011].

| Campo | Tipo | Descripción | Origen |
|---|---|---|---|
| `settlementId` | UUID | Identificador de la liquidación | [PLAN] |
| `status` | `FINAL` | Siempre `FINAL` | [SPEC FR-009] |
| `stayId` | UUID | Estancia liquidada | [SPEC FR-016] |
| `reservationRef` | string | Reserva de la estancia | [SPEC FR-016] |
| `roomId` | UUID | Habitación | [SPEC FR-016] |
| `roomType` | string | Tipo de habitación | [SPEC FR-016] |
| `checkInDate`, `checkOutDate` | date | Fechas reales de la estancia | [SPEC FR-016] |
| `quoteId` | UUID | Cotización usada | [SPEC NFR-003, NFR-007] |
| `channel` | `DIRECT` \| `OTA` | Canal de origen | [SPEC FR-012] |
| `otaId` | string \| null | OTA; solo si `channel = OTA` | [SPEC FR-012] |
| `otaConfirmationCode` | string \| null | Código de confirmación de la OTA; solo si `channel = OTA` | [BASE] |
| `otaCommissionPercentage` | string decimal \| null | Porcentaje aplicado, p. ej. `"15.00"`; `null` en canal directo | [SPEC FR-012] |
| `currency` | string | Moneda de los importes, `COP` | [BASE] |
| `lodgingAmount` | string decimal | Valor de hospedaje de la cotización | [SPEC FR-012] |
| `otaCommissionAmount` | string decimal | Valor de la comisión; `"0.00"` en canal directo | [SPEC FR-012] |
| `netIncome` | string decimal | Hospedaje menos comisión, sin IVA | [SPEC FR-008, FR-013] |
| `billingCustomer` | `{ name, taxId }` \| null | Datos tributarios mínimos para 006 | [PLAN] |
| `sourceEventId` | UUID | Evento que la generó | [SPEC NFR-003] |
| `generatedAt` | datetime ISO 8601 | Fecha y hora de generación (hora de la base de datos) | [SPEC NFR-003] |

Los importes son decimales exactos (`Money`), nunca `number` de JavaScript; si se serializan van como texto [SPEC NFR-004] [CONV]. El resultado no incluye datos migratorios ni datos personales del huésped más allá de `billingCustomer` [SPEC NFR-006].

### Ejemplo (canal OTA, 15 %)

```json
{
  "settlementId": "4e2b8c1d-9a7f-4f3e-b6d5-0c1a2b3d4e5f",
  "status": "FINAL",
  "stayId": "c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c",
  "reservationRef": "RES-000123",
  "roomId": "5f0e8a47-1b2c-4d3e-9f6a-7b8c9d0e1f23",
  "roomType": "DOBLE",
  "checkInDate": "2026-12-20",
  "checkOutDate": "2026-12-23",
  "quoteId": "a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b",
  "channel": "OTA",
  "otaId": "booking",
  "otaConfirmationCode": "BKG-88421",
  "otaCommissionPercentage": "15.00",
  "currency": "COP",
  "lodgingAmount": "750000.00",
  "otaCommissionAmount": "112500.00",
  "netIncome": "637500.00",
  "billingCustomer": {
    "name": "Comercializadora Andina S.A.S.",
    "taxId": "900123456-7"
  },
  "sourceEventId": "9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72",
  "generatedAt": "2026-12-23T11:04:58-05:00"
}
```

## 5. Errores

007 no tiene respuesta HTTP: lanza errores de dominio tipados (`domain/errors/`) que el llamador traduce. El `errorCode` sigue el formato de `ApiError` del plan base [BASE]. Cada `message` dice qué falló y con qué dato (reserva, tipo de habitación, OTA) para que recepción o facturación puedan corregirlo [SPEC FR-015, NFR-005].

| Error de dominio | `errorCode` | Cuándo ocurre | Reintentable | Qué hace 010 con el evento | Origen |
|---|---|---|---|---|---|
| `ReservationNotFoundError` | `RESERVATION_NOT_FOUND` | Módulo 2 responde 404 para `reservationRef` | No | Dead-letter | [SPEC FR-014] [BASE] |
| `QuoteNotFoundError` | `QUOTE_NOT_FOUND` | Ninguna cotización de la reserva coincide con `roomType` | No | Dead-letter | [SPEC FR-014] [BASE] |
| `MissingCommissionError` | `MISSING_COMMISSION` | Canal OTA sin `otaCommissionPercentage` | No | Dead-letter | [SPEC FR-014, HU2 escenario 3] [BASE] |
| `InvalidCommissionError` | `INVALID_COMMISSION` | Porcentaje menor a 0 o mayor a 100 | No | Dead-letter | [SPEC casos límite] [PLAN] |
| `SettlementAlreadyExistsError` | `SETTLEMENT_ALREADY_EXISTS` | Ya existe liquidación para el `stayId` con datos de check-out distintos | No | Dead-letter | [SPEC FR-010, HU3 escenario 2] [BASE] |
| `Module2UnavailableError` | `MODULE2_UNAVAILABLE` | Timeout (500 ms), 5xx o circuito abierto al consultar Módulo 2 | **Sí** | No confirma (ack); RabbitMQ reentrega | [SPEC FR-021] [BASE] |

Un comando con campos obligatorios faltantes o fechas inconsistentes es un error de programación del llamador (010 ya valida el evento) y se rechaza antes de tocar Módulo 2 ni la base de datos [PLAN] [SPEC BR-007].

### Ejemplo de error

```json
{
  "errorCode": "MISSING_COMMISSION",
  "message": "La reserva RES-000123 es de la OTA 'booking' pero Módulo 2 no informó el porcentaje de comisión. No se generó la liquidación de la estancia c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c.",
  "timestamp": "2026-12-23T11:04:58Z",
  "path": "habitacion.checkout"
}
```

`path` es la routing key del evento que originó la llamada; cuando la llama 006 es el nombre del caso de uso [CONV].

## 6. Garantías para quien llama

- **Idempotente**: mismo `stayId` y mismos datos de check-out → misma liquidación, siempre, sin recalcular [SPEC FR-011, NFR-001, SC-009].
- **Una liquidación por estancia**: nunca existen dos `FINAL` para el mismo `stayId` [SPEC FR-010, SC-008].
- **Sin datos supuestos**: ante cualquier error no se guarda liquidación ni se produce ingreso neto parcial [SPEC BR-007, SC-004].
- **Sin transacción compartida con 006**: si 006 falla después de que 007 guardó, la reentrega vuelve a llamar a `generate`, que devuelve la existente, y 006 se reintenta [PLAN].
- **Rendimiento**: la generación cabe en 800 ms con Módulo 2 respondiendo, porque el timeout hacia Módulo 2 es de 500 ms [SPEC NFR-002] [PLAN].
