# Contrato de mensajería: Evento Registrar Check-out (`habitacion.checkout`)

**Feature**: 010 Registrar Check-out
**Spec**: [registrar_checkout.md](../../1-functional/registrar_checkout.md)
**Plan**: [plan.md](../plan.md)
**Plan Base**: [plan-tecnico-base.md](../../../../docs/plan-tecnico-base.md)

**Etiquetas de origen**: `[SPEC]` requisito funcional; `[PLAN]` decisión técnica de Módulo 3; `[BASE]` plataforma compartida; `[CONV]` convención de interoperabilidad.

## 1. Propósito

Módulo 1 publica `habitacion.checkout` al confirmar el check-out físico. Módulo 3 consume el sobre `EventEnvelope`, valida el evento y ejecuta en orden `GenerateSettlementUseCase` (007) y `GenerateFinalInvoiceUseCase` (006). 006 reutiliza de forma idempotente la liquidación ya creada por 007. Invocar la generación de factura no garantiza su emisión: se requieren datos tributarios completos [SPEC FR-001, FR-004, FR-009].

## 2. Mensaje

| Parámetro | Valor |
|---|---|
| Exchange | `hospitua.events` (topic) [BASE] |
| Routing key | `habitacion.checkout` [BASE] |
| Cola de Módulo 3 | `modulo3.checkout` [BASE] |
| Cola de reintento | `modulo3.checkout.retry.30s`, TTL de 30 s, vinculada a `hospitua.events` con routing key `habitacion.checkout` [PLAN] |
| Dead-letter exchange | `hospitua.events.dlx` [BASE] |
| Cola dead-letter | `modulo3.checkout.dlq` [BASE] |
| Confirmación | Manual, ack/nack según la política de esta interfaz [BASE] |

Módulo 3 lee directamente el `EventEnvelope` definido en el Plan Base.

### Sobre

| Campo | Tipo | Requisito |
|---|---|---|
| `eventId` | UUID | Obligatorio; identifica el mensaje para deduplicación. |
| `eventType` | string | Obligatorio; valor `CHECK_OUT`. |
| `occurredAt` | fecha y hora ISO 8601 UTC | Obligatorio. |
| `sourceModule` | string | Obligatorio; valor `MODULE_1`. |
| `payload` | objeto | Obligatorio; datos de la estancia descritos abajo. |

### Payload

| Campo | Tipo | Requisito |
|---|---|---|
| `stayId` | UUID | Obligatorio; identifica la estancia y la liquidación única. |
| `reservationRef` | string | Obligatorio; referencia opaca de reserva. |
| `roomId` | UUID | Obligatorio; habitación de la estancia. |
| `categoryRoom` | string no vacío | Obligatorio; tipo de habitación. |
| `checkInDate` | fecha `YYYY-MM-DD` | Obligatoria; fecha real de entrada. |
| `checkOutDate` | fecha `YYYY-MM-DD` | Obligatoria; fecha real de salida, posterior a la entrada. |
| `billingCustomer` | objeto opcional | Datos tributarios para facturación. |
| `billingCustomer.name` | string opcional | Nombre o razón social; necesario y no vacío para emitir. |
| `billingCustomer.taxId` | string opcional | Identificación fiscal; necesaria y no vacía para emitir. |

La lista blanca del evento incluye los campos definidos en las tablas del sobre y el payload. Para `checkout_event_log.payload`, se conserva esa lista sin `billingCustomer.name` ni `billingCustomer.taxId` y se agrega únicamente `has_billing_customer: boolean`; los datos tributarios se procesan en memoria. Los campos adicionales, incluidos datos migratorios, se descartan; el cuerpo crudo no se almacena [SPEC FR-006, NFR-003] [PLAN].

## 3. Reglas de procesamiento

1. Se registra el mensaje con estado `PENDING` mediante `registerIfAbsent(...)`. Si el sobre no es JSON válido o no es reconocible, se registra `event_id` y `payload` nulos, `status = REJECTED`, `error_code = INVALID_CHECKOUT_EVENT` y el motivo; el cuerpo crudo no se guarda.
2. Se validan el sobre, los campos obligatorios y que `checkInDate < checkOutDate`. La categoría debe ser string no vacío. La ausencia o incompletitud de datos tributarios no invalida el evento.
3. Con el evento válido, 010 invoca `GenerateSettlementUseCase` de 007 y luego `GenerateFinalInvoiceUseCase` de 006. 006 vuelve a invocar 007 internamente; la idempotencia por `stayId` permite devolver la liquidación existente sin duplicarla. `stayId` es UUID obligatorio y clave de idempotencia de negocio; 007 mantiene la unicidad de liquidación por estancia.
4. Un nuevo evento con la misma estancia y los mismos datos de check-out obtiene la liquidación existente sin recalcular. Si los datos de check-out contradicen la liquidación existente, se rechaza con `SETTLEMENT_ALREADY_EXISTS` y se conserva la liquidación original.
5. Si 006 recibe datos tributarios ausentes o incompletos, devuelve `BILLING_CUSTOMER_DATA_MISSING`. 010 lo trata como resultado normal: conserva la liquidación, no se asigna número de factura, el evento se confirma y la auditoría queda `PROCESSED` con `result_note = "Factura no emitida: datos tributarios ausentes o incompletos"`. Un nuevo evento (otro `eventId`) con los mismos datos de check-out y datos tributarios completos reutiliza la liquidación y permite emitir la factura sin duplicar registros.
6. Los datos de canal, OTA, comisión y cotización se obtienen mediante 007; no forman parte del payload del evento [BASE].

## 4. Política de ack

| Resultado | Acción de mensajería | Estado de auditoría |
|---|---|---|
| Liquidación y factura procesadas, o liquidación procesada sin factura por datos tributarios incompletos | `ack` | `PROCESSED` |
| Reentrega con `eventId` ya `PROCESSED`, `REJECTED` o `DEAD_LETTER` | `ack` inmediato, sin reprocesar | Sin cambio |
| Evento con el mismo `eventId` en `PENDING` | Reanudar procesamiento sobre el registro existente | Según resultado final |
| JSON inválido o sobre irreconocible | `nack` sin reencolar; DLX a `modulo3.checkout.dlq` | `REJECTED` |
| Error de negocio no recuperable: `RESERVATION_NOT_FOUND`, `QUOTE_NOT_FOUND`, `MISSING_COMMISSION`, `INVALID_COMMISSION` o `SETTLEMENT_ALREADY_EXISTS` | `nack` sin reencolar; DLX a `modulo3.checkout.dlq` | `DEAD_LETTER` |
| Falla transitoria `MODULE2_UNAVAILABLE`, `VAT_RATE_UNAVAILABLE` o `DATABASE_UNAVAILABLE` | `nack` con reencolado diferido por la cola TTL de 30 s; máximo 5 reentregas | `PENDING` |
| `FINAL_SETTLEMENT_NOT_FOUND` | `nack` sin reencolar; DLX a `modulo3.checkout.dlq` | `DEAD_LETTER` |
| Error no tipado | `nack` sin reencolar; se registra `UNEXPECTED_ERROR` y se enruta a DLQ | `DEAD_LETTER` |

Las fallas transitorias se enrutan a `modulo3.checkout.retry.30s` y regresan a la cola principal al vencer el TTL. `x-death` cuenta las reentregas; tras 5, el fallo siguiente conserva su código en `error_code`, cambia el registro a `DEAD_LETTER` y enruta el mensaje a `modulo3.checkout.dlq`. La recuperación manual desde la DLQ corrige la causa, cambia el registro a `PENDING` y mueve el mensaje a `modulo3.checkout`, para reanudarlo.

## 5. Errores

Los códigos siguientes son resultados de procesamiento y auditoría, no respuestas HTTP.

| Código | Resultado |
|---|---|
| `INVALID_CHECKOUT_EVENT` | Sobre inválido o datos obligatorios ausentes/inválidos; `REJECTED` y DLQ. |
| `RESERVATION_NOT_FOUND` | Reserva no encontrada por 007; `DEAD_LETTER`. |
| `QUOTE_NOT_FOUND` | Cotización aplicable no encontrada por 007; `DEAD_LETTER`. |
| `MISSING_COMMISSION` | Comisión requerida ausente; `DEAD_LETTER`. |
| `INVALID_COMMISSION` | Comisión inválida; `DEAD_LETTER`. |
| `SETTLEMENT_ALREADY_EXISTS` | Datos de check-out contradicen la liquidación existente; `DEAD_LETTER`. |
| `MODULE2_UNAVAILABLE` | Dependencia transitoria no disponible; redelivery. |
| `VAT_RATE_UNAVAILABLE` | Tasa de IVA no disponible; redelivery. |
| `BILLING_CUSTOMER_DATA_MISSING` | Resultado normal sin emisión de factura; ack y `PROCESSED`. |
| `DATABASE_UNAVAILABLE` | Falla transitoria de persistencia; reencolado diferido, hasta 5 reentregas. |
| `FINAL_SETTLEMENT_NOT_FOUND` | No existe liquidación final requerida por 006; `DEAD_LETTER`. |
| `UNEXPECTED_ERROR` | Error no tipado; `DEAD_LETTER`. |

## 6. Ejemplos JSON

### Con datos tributarios

```json
{
  "eventId": "a5d8b76e-3f91-4c22-b88a-9e67d4f91012",
  "eventType": "CHECK_OUT",
  "occurredAt": "2026-10-08T11:00:00Z",
  "sourceModule": "MODULE_1",
  "payload": {
    "stayId": "d1e4c7b8-2a55-4e31-89d2-b0a112233445",
    "reservationRef": "RES-000123",
    "roomId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "categoryRoom": "DOBLE",
    "checkInDate": "2026-10-05",
    "checkOutDate": "2026-10-08",
    "billingCustomer": {
      "name": "Comercializadora Andina S.A.S.",
      "taxId": "900123456-7"
    }
  }
}
```

### Sin datos tributarios

```json
{
  "eventId": "b7e9c112-4a02-4d33-a11b-8e55d3f82033",
  "eventType": "CHECK_OUT",
  "occurredAt": "2026-10-08T11:05:00Z",
  "sourceModule": "MODULE_1",
  "payload": {
    "stayId": "e3f5d8c9-3b66-4f42-9a03-c1b223344556",
    "reservationRef": "RES-000456",
    "roomId": "a11bc20c-69dd-4483-b678-1f13c3d4e580",
    "categoryRoom": "DOBLE",
    "checkInDate": "2026-10-07",
    "checkOutDate": "2026-10-08"
  }
}
```
