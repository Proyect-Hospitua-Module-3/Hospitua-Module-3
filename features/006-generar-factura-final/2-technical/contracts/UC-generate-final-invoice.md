# Contrato de caso de uso: Generar factura final

**Feature**: 006 Generar factura final — HU1, HU2
**Spec**: [generar_factura_final.md](../../1-functional/generar_factura_final.md)
**Plan**: [plan.md](../plan.md)

**Etiquetas de origen**: `[SPEC]` proviene de la especificación funcional, `[PLAN]` del plan técnico 006, `[BASE]` del plan técnico base, `[007]` del contrato de Generar liquidación, `[001]` del plan técnico de Actualizar porcentaje de IVA y `[CONV]` es una convención técnica del contrato.

Este caso de uso es interno: lo invoca `checkout-ingestion` (010), no un actor externo. Incluye `GenerateSettlementUseCase` (007), consume la tasa vigente a través de 001 y persiste una factura inmutable. No expone endpoint ni consumer propio [SPEC FR-001, BR-001] [BASE].

## 1. Propósito

Emitir un documento fiscal definitivo para una liquidación `FINAL`, con número oficial consecutivo, instantánea del IVA vigente, desglose auditable e idempotencia por estancia. No recalcula los valores de 007 salvo el IVA que corresponde añadir a hospedaje, no convierte la comisión OTA en un cargo al huésped y no procesa información migratoria.

## 2. Invocación

```ts
// src/domain/ports/in/generate-final-invoice.use-case.ts
generate(command: GenerateFinalInvoiceCommand): Promise<Invoice>
```

Solo `checkout-ingestion` (010) recibe permiso de inyección del caso de uso. No hay controller ni operación REST pública [SPEC FR-001] [PLAN].

### `GenerateFinalInvoiceCommand`

El comando conserva la forma de `GenerateSettlementCommand` de 007 para que 010 pueda pasar el payload validado del evento. Los campos se validan en 010 y 007 vuelve a validar su propio contrato [BASE] [007].

| Campo | Tipo | Obligatorio | Descripción | Origen |
|---|---|---|---|---|
| `eventId` | UUID | Sí | Evento de check-out; correlación y trazabilidad | [BASE] |
| `stayId` | UUID | Sí | Estancia de una habitación; clave idempotente | [BASE] [SPEC FR-007] |
| `reservationRef` | string | Sí | Reserva asociada a la estancia | [BASE] |
| `roomId` | UUID | Sí | Habitación que se factura | [BASE] |
| `roomType` | string | Sí | Tipo de habitación para seleccionar la cotización en 007 | [BASE] [007] |
| `checkInDate` | date `YYYY-MM-DD` | Sí | Fecha real de entrada | [BASE] [007] |
| `checkOutDate` | date `YYYY-MM-DD` | Sí | Fecha real de salida, posterior a `checkInDate` | [BASE] [007] |
| `billingCustomer.name` | string | No en el evento; obligatorio para emitir | Nombre o razón social, no vacío | [SPEC FR-008] |
| `billingCustomer.taxId` | string | No en el evento; obligatorio para emitir | Identificación tributaria/documento fiscal, no vacío | [SPEC FR-008] |

El evento puede omitir los datos tributarios para que 007 genere la liquidación. Para emitir, ambos campos deben estar completos: se usa el objeto completo del comando si está presente; si no, se puede usar el objeto completo persistido en la liquidación. Un objeto parcial o con valores en blanco no se mezcla con la fuente alternativa: se rechaza. Un nuevo evento con datos completos puede emitir factura para una liquidación ya generada sin actualizar la liquidación inmutable [SPEC FR-008, FR-009, BR-004] [PLAN].

El comando no permite establecer `lodgingAmount`, `channel`, comisión, porcentaje/importe de IVA, número, total, moneda ni estado de factura. Nunca contiene ni persiste datos migratorios [SPEC FR-003, FR-013].

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

1. **Validación**: requiere los campos estructurales del comando y fechas válidas. Una entrada incompleta falla antes de I/O [PLAN].
2. **Factura existente**: busca por `stayId`. Si ya hay factura `ISSUED`, devuelve exactamente la factura persistida con su número; no consulta nuevamente 001, no recalcula y no modifica el documento [SPEC FR-006, FR-007] [BASE].
3. **Liquidación `FINAL`**: llama a `GenerateSettlementUseCase.generate` (007) con los campos de check-out. Recibe liquidación existente o recién generada de forma idempotente. No solicita el documento fiscal a Módulo 1/Módulo 2 por otro canal [SPEC FR-001] [007].
4. **Datos tributarios**: valida nombre/razón social y documento fiscal antes de solicitar el IVA o asignar número. Sin ambos campos completos → `BILLING_CUSTOMER_DATA_MISSING`; la liquidación puede permanecer guardada, no se crea factura ni se reserva consecutivo [SPEC FR-008, FR-009].
5. **IVA vigente**: consume `GetCurrentVatRateUseCase.getCurrent()` de 001. El valor leído se congela en `vatRateApplied`; una actualización posterior nunca cambia la factura [SPEC FR-002, BR-005] [001].
6. **Cálculo**: emplea `Money`/`decimal.js`, sin `number` binario para importes y con redondeo half-up a 2 decimales [BASE] [PLAN]:
   - `vatAmount = lodgingAmount × vatRateApplied / 100`.
   - `totalAmount = lodgingAmount + vatAmount`.
   - `otaCommissionAmount` y `netIncome` se copian de la liquidación; no se recalculan en 006.
   - La comisión OTA es una referencia para conciliación con la OTA y no forma parte del total cobrado al cliente [SPEC FR-003, FR-004, BR-002].
7. **Emisión transaccional**: `issueIfAbsent` vuelve a buscar por estancia/liquidación bajo el bloqueo del contador. Si no existe, incrementa el consecutivo transaccional e inserta la factura en la misma transacción. Si ya existe por una carrera, devuelve esa factura [SPEC FR-005, FR-007, FR-011] [PLAN].
8. **Atomicidad y reintento**: un rollback revierte el contador y el invoice. Si el invoice quedó confirmado pero el evento no recibió ACK, la reentrega devuelve el documento guardado sin consumir un número adicional [SPEC FR-007, NFR-003] [BASE].
9. **Inmutabilidad**: la factura emitida no tiene ruta de escritura/edición y las consultas de 002/008 son de solo lectura [SPEC FR-006, BR-003] [BASE].

No existe transacción distribuida entre 007 y 006: si 007 persiste y 006 falla, el mensaje no se ACKea; la reentrega recupera la liquidación idempotente y reintenta la emisión [PLAN] [007].

## 4. Resultado exitoso

Devuelve la entidad `Invoice` persistida, ya sea recién emitida o recuperada en un reintento. Todos los importes decimales se serializan como texto; nunca se usan valores JavaScript `number` para el dinero [BASE] [CONV].

| Campo | Tipo | Descripción | Origen |
|---|---|---|---|
| `invoiceId` | UUID | Identificador interno | [PLAN] |
| `invoiceNumber` | integer | Número consecutivo oficial único | [SPEC FR-005, FR-011] |
| `status` | `ISSUED` | Estado definitivo | [PLAN] [008] |
| `immutable` | boolean (`true`) | Factura no modificable | [SPEC FR-006] [008] |
| `issuedAt` | datetime ISO 8601 | Instante de emisión | [SPEC FR-012] |
| `settlementId` | UUID | Liquidación `FINAL` de origen | [SPEC FR-012] |
| `stayId` | UUID | Estancia facturada | [SPEC FR-007] |
| `sourceEventId` | UUID | Evento que originó el check-out | [SPEC NFR-004] |
| `reservationRef` | string | Reserva asociada | [BASE] [008] |
| `channel` | `DIRECT` \| `OTA` | Canal de la liquidación | [007] |
| `otaId` | string \| null | Identificador OTA si aplica | [007] [008] |
| `customer.name` | string | Nombre/razón social facturado | [SPEC FR-008] |
| `customer.taxId` | string | Documento fiscal facturado | [SPEC FR-008] |
| `currency` | string | Moneda, actualmente `COP` | [BASE] |
| `lodgingAmount` | string decimal | Hospedaje bruto; base del IVA | [SPEC FR-003] |
| `otaCommissionAmount` | string decimal | Comisión OTA informativa, `0.00` en directo | [SPEC FR-004] |
| `netIncome` | string decimal | Ingreso neto persistido por 007 | [007] |
| `vatRateApplied` | string decimal | IVA vigente al emitir, por ejemplo `"19.00"` | [SPEC FR-002, BR-005] |
| `vatAmount` | string decimal | IVA calculado sobre hospedaje | [SPEC FR-002] |
| `totalAmount` | string decimal | Total al cliente: hospedaje + IVA | [SPEC FR-003] |

### Ejemplo de canal OTA

```json
{
  "invoiceId": "7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01",
  "invoiceNumber": 1042,
  "status": "ISSUED",
  "immutable": true,
  "issuedAt": "2026-12-23T11:05:12-05:00",
  "settlementId": "4e2b8c1d-9a7f-4f3e-b6d5-0c1a2b3d4e5f",
  "stayId": "c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c",
  "sourceEventId": "9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72",
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

La conciliación distingue las relaciones: `lodgingAmount - otaCommissionAmount = netIncome` y `lodgingAmount + vatAmount = totalAmount`. La comisión no se suma al total del huésped [SPEC FR-003, FR-004, FR-010].

## 5. Errores

006 no tiene respuesta HTTP. Propaga errores tipados a 010; el consumer usa ACK manual conforme a las reglas del plan base. `message` debe ser accionable y no incluir valores personales [BASE] [010].

| Error de dominio | `errorCode` | Cuándo ocurre | Reintentable | Acción de 010 |
|---|---|---|---:|---|
| `BillingCustomerDataMissingError` | `BILLING_CUSTOMER_DATA_MISSING` | Falta nombre/razón social o documento fiscal | No; requiere corregir datos | Dead-letter; no hay factura/número |
| `FinalSettlementNotFoundError` | `FINAL_SETTLEMENT_NOT_FOUND` | 007 no puede proporcionar liquidación `FINAL` | No | Dead-letter |
| `ReservationNotFoundError` | `RESERVATION_NOT_FOUND` | Módulo 2 informa reserva inexistente mediante 007 | No | Dead-letter |
| `QuoteNotFoundError` | `QUOTE_NOT_FOUND` | 007 no encuentra cotización coincidente | No | Dead-letter |
| `MissingCommissionError` / `InvalidCommissionError` | `MISSING_COMMISSION` / `INVALID_COMMISSION` | Inconsistencia OTA reportada por 007 | No | Dead-letter |
| `Module2UnavailableError` | `MODULE2_UNAVAILABLE` | Timeout, 5xx o circuito abierto en 007 | Sí | No ACK; RabbitMQ reentrega |
| `VatRateUnavailableError` | `VAT_RATE_UNAVAILABLE` | No se pudo leer IVA vigente por 001 | Sí | No ACK; no hay número asignado |
| `InvoicePersistenceUnavailableError` | `DATABASE_UNAVAILABLE` | Fallo de BD/commit al emitir | Sí | No ACK; rollback del contador y factura |

No hay un error de “factura ya existe” para un reenvío compatible: el resultado es el invoice original. La unicidad de la estancia, liquidación y número se verifica en persistencia incluso ante carreras.

### Ejemplo de error

```json
{
  "errorCode": "BILLING_CUSTOMER_DATA_MISSING",
  "message": "No se emitió la factura de la estancia c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c: faltan el nombre o el documento fiscal del responsable.",
  "timestamp": "2026-12-23T11:04:58Z",
  "path": "habitacion.checkout"
}
```

## 6. Garantías para quien llama

- **Idempotencia**: `stayId` ya facturado devuelve la misma factura y número; una carrera concurrente no crea un segundo documento [SPEC FR-007, SC-003].
- **Sin número ante rechazo previo**: liquidación ausente o datos tributarios incompletos no consumen numeración oficial [SPEC FR-009, SC-004].
- **Consecutivo transaccional**: el número solo avanza al confirmar la factura; rollback revierte ambos cambios [SPEC FR-011, NFR-003] [PLAN].
- **Inmutabilidad**: total, tasa, desglose, cliente, liquidación y número se conservan como snapshot y no se recalculan ni actualizan [SPEC FR-006, BR-003, BR-005].
- **Desglose no ambiguo**: total cliente = hospedaje + IVA; la comisión OTA es informativa [SPEC FR-003, FR-004].
- **Privacidad**: no se acepta ni persiste información migratoria; los datos de facturación no se incluyen en logs [SPEC FR-013, NFR-005].
- **Límite de transacción**: la emisión local es atómica; la liquidación de 007 puede quedar persistida si luego falla la factura y se recupera idempotentemente al reintentar [007] [PLAN].
