# Contrato de mensajería: Evento Registrar Check-out (`facturacion.checkout`)

**Feature**: 010 Registrar Check-out
**Spec**: [registrar_checkout.md](../../1-functional/registrar_checkout.md)
**Plan**: [plan.md](../plan.md)
**Proyecto base**: [plan-tecnico-base.md](../../../../docs/plan-tecnico-base.md)

**Etiquetas de origen**: `[SPEC]` requisito funcional; `[PLAN]` decisión técnica de Módulo 3; `[BASE]` plataforma compartida; `[CONV]` convención de interoperabilidad.

## 1. Propósito

Módulo 1 publica `facturacion.checkout` al confirmar el check-out físico. Módulo 3 consume el sobre `EventEnvelope`, valida el evento y ejecuta en orden `GenerateSettlementUseCase` (007) y `GenerateFinalInvoiceUseCase` (006). 006 reutiliza de forma idempotente la liquidación ya creada por 007. Invocar la generación de factura no garantiza su emisión: se requieren datos tributarios completos [SPEC FR-001, FR-004, FR-009].

## 2. Mensaje

| Parámetro | Valor |
|---|---|
| Exchange | `hospitua.events` (topic) [BASE] |
| Routing key | `facturacion.checkout` [BASE] |
| Cola de Módulo 3 | `modulo3.checkout`, enlazada a `facturacion.checkout` en `hospitua.events` [BASE] |
| Cola de reintento | `modulo3.checkout.retry.30s`, durable, sin binding a `hospitua.events`; `x-message-ttl: 30000`, `x-dead-letter-exchange: ""` y `x-dead-letter-routing-key: modulo3.checkout` [PLAN] |
| Cola dead-letter | `modulo3.checkout.dlq`, durable y sin binding a `hospitua.events`; es el destino de la revisión manual definida en la spec [SPEC FR-008, FR-010] [PLAN] |
| Confirmación | Manual [BASE]. El consumer traduce el resultado de `RegisterCheckoutService` (`ACK` o `NACK_REQUEUE`) a ack o nack con reencolado. Las publicaciones directas a retry o DLQ las hace el servicio mediante `CheckoutMessagePublisherPort`: son persistentes, usan `mandatory` y se dan por exitosas solo con publisher confirm y sin `basic.return`; en cualquier otro caso el resultado es `NACK_REQUEUE` [PLAN] |

Módulo 3 lee directamente el `EventEnvelope` definido en el Plan Base.

### Sobre

| Campo | Tipo | Requisito |
|---|---|---|
| `eventId` | UUID | Obligatorio; identifica el mensaje para deduplicación. |
| `eventType` | string | Obligatorio; valor `CHECK_OUT`. [BASE] |
| `occurredAt` | fecha y hora ISO 8601 con offset de zona (se acepta `Z` o un offset como `-05:00`) | Obligatorio. [BASE] |
| `sourceModule` | string | Obligatorio; valor `MODULE_1`. [BASE] |
| `payload` | objeto | Obligatorio; datos de la estancia descritos abajo. |

### Payload

| Campo | Tipo | Requisito |
|---|---|---|
| `stayId` | UUID | Obligatorio; identifica la estancia y la liquidación única. |
| `reservationRef` | string | Obligatorio; referencia opaca de reserva. |
| `roomId` | UUID | Obligatorio; habitación de la estancia. |
| `categoryRoom` | string no vacío | Obligatorio; tipo de habitación informativo: no interviene en la elección de la cotización. |
| `checkInDate` | fecha `YYYY-MM-DD` | Obligatoria; fecha real de entrada. |
| `checkOutDate` | fecha `YYYY-MM-DD` | Obligatoria; fecha real de salida, igual o posterior a la entrada. |
| `billingCustomer` | objeto opcional | Datos tributarios para facturación. |
| `billingCustomer.name` | string opcional | Nombre o razón social; necesario y no vacío para emitir. |
| `billingCustomer.taxId` | string opcional | Identificación fiscal; necesaria y no vacía para emitir. |

La lista blanca del evento incluye los campos definidos en las tablas del sobre y el payload. Para `checkout_event_log.payload`, se conserva esa lista sin `billingCustomer.name` ni `billingCustomer.taxId` y se agrega únicamente `has_billing_customer: boolean`; el valor es `true` cuando el evento incluye el objeto `billingCustomer`, aunque esté incompleto, y `false` cuando no lo incluye. `Generar factura final` (006) determina si los datos bastan para emitir la factura; 010 no los persiste en su auditoría y los pasa exclusivamente a 006. `Generar liquidación` (007) no acepta ni persiste `billingCustomer`.

## 3. Reglas de procesamiento

1. Si el sobre es reconocible (JSON válido con un `eventId` con formato UUID), se registra el mensaje con estado `PENDING` mediante `registerIfAbsent(...)`. Si el sobre no es JSON válido o no es reconocible, se publica el mensaje persistente a `modulo3.checkout.dlq` mediante el exchange por defecto con `mandatory`. Si el broker devuelve el mensaje con `basic.return` o no confirma la publicación, se hace nack con reencolado. Después de una publicación confirmada y sin devolución, se registra `event_id` y `payload` nulos, `status = REJECTED`, `error_code = INVALID_CHECKOUT_EVENT` y el motivo, sin guardar el cuerpo crudo en la base de datos; el mensaje enviado a la DLQ conserva su contenido original, y se hace ack.
2. Se validan el sobre, los campos obligatorios y que `checkInDate <= checkOutDate`. `occurredAt` se valida como fecha-hora ISO 8601 con cualquier offset válido; un valor sin offset o con formato inválido hace que el evento se rechace con `INVALID_CHECKOUT_EVENT`. La categoría debe ser string no vacío. La ausencia o incompletitud de datos tributarios no invalida el evento. Si un evento reconocible tiene campos obligatorios o datos mínimos inválidos, su registro `PENDING` se mantiene y se publica el mensaje persistente a `modulo3.checkout.dlq` mediante el exchange por defecto con `mandatory`. Si el broker devuelve el mensaje con `basic.return` o no confirma la publicación, se hace nack con reencolado y el registro permanece en `PENDING`. Tras publisher confirm y sin `basic.return`, el registro pasa a `REJECTED` con `error_code = INVALID_CHECKOUT_EVENT` y se hace ack.
3. Con el evento válido, 010 invoca `GenerateSettlementUseCase` de 007 y luego `GenerateFinalInvoiceUseCase` de 006. 006 vuelve a invocar 007 internamente; la idempotencia por `stayId` permite devolver la liquidación existente sin duplicarla. `stayId` es UUID obligatorio y clave de idempotencia de negocio; 007 mantiene la unicidad de liquidación por estancia.
4. Un nuevo evento con la misma estancia y los mismos datos de check-out obtiene la liquidación existente sin recalcular. Si los datos de check-out contradicen la liquidación existente, se rechaza con `SETTLEMENT_ALREADY_EXISTS` y se conserva la liquidación original.
5. Si 006 recibe datos tributarios ausentes o incompletos, devuelve `BILLING_CUSTOMER_DATA_MISSING`. 010 lo trata como resultado normal: conserva la liquidación, no se asigna número de factura, el evento se confirma y la auditoría queda `PROCESSED` con `result_note = "Factura no emitida: datos tributarios ausentes o incompletos"`.
6. Los datos de canal, OTA, comisión y cotización se obtienen mediante 007; no forman parte del payload del evento [BASE].

## 4. Política de ack

| Resultado | Acción de mensajería | Estado de auditoría |
|---|---|---|
| Liquidación y factura procesadas, o liquidación procesada sin factura por datos tributarios incompletos | `ack` | `PROCESSED` |
| Reentrega con `eventId` ya `PROCESSED`, `REJECTED` o `DEAD_LETTER` | `ack` inmediato, sin reprocesar | Sin cambio |
| Evento con el mismo `eventId` en `PENDING` | Reanudar procesamiento sobre el registro existente | Según resultado final |
| JSON inválido o sobre irreconocible | Publicar persistentemente a `modulo3.checkout.dlq` con `mandatory`; tras confirmación y sin `basic.return`, registrar y hacer ack | `REJECTED` |
| Error de negocio no recuperable: `RESERVATION_NOT_FOUND`, `QUOTE_NOT_FOUND`, `MISSING_COMMISSION`, `INVALID_COMMISSION` o `SETTLEMENT_ALREADY_EXISTS` | Publicar persistentemente a `modulo3.checkout.dlq` con `mandatory`; tras confirmación y sin `basic.return`, escribir `error_code`, `reason` y estado, y hacer ack | `DEAD_LETTER` |
| Falla transitoria `MODULE2_UNAVAILABLE`, `VAT_RATE_UNAVAILABLE` o `DATABASE_UNAVAILABLE` con `x-retry-count < 5` | Publicar persistentemente a retry con `x-retry-count` incrementado y `mandatory`; tras confirmación y sin `basic.return`, hacer ack | `PENDING` cuando el registro existe |
| Falla transitoria con `x-retry-count >= 5` | Publicar persistentemente a `modulo3.checkout.dlq` con `mandatory`; tras confirmación y sin `basic.return`, registrar el código del fallo actual en `error_code`, escribir `reason` y el estado, y hacer ack | `DEAD_LETTER` |
| `FINAL_SETTLEMENT_NOT_FOUND` o error no tipado | Publicar persistentemente a `modulo3.checkout.dlq` con `mandatory`; tras confirmación y sin `basic.return`, escribir `error_code` (`UNEXPECTED_ERROR` para error no tipado), `reason` y estado, y hacer ack | `DEAD_LETTER` |
| Publicación a retry o DLQ fallida, devuelta con `basic.return` o no confirmada | `nack` con reencolado del mensaje original; para eventos reconocibles, el registro permanece en `PENDING` | Sin estado terminal |

Las fallas transitorias con `x-retry-count` menor que 5 se publican persistentemente a `modulo3.checkout.retry.30s` mediante el exchange por defecto, con el contador incrementado. La cola retry es durable, no tiene binding a `hospitua.events` y usa `x-message-ttl: 30000`, `x-dead-letter-exchange: ""` y `x-dead-letter-routing-key: modulo3.checkout`. `x-retry-count` es un entero no negativo; si está ausente, no es un entero o es negativo, se interpreta como 0. El broker puede agregar `x-death` al devolver el mensaje por TTL, pero `x-death` no determina el límite de reintentos. Cuando el contador es 5, el siguiente fallo publica el mensaje a `modulo3.checkout.dlq`; después de confirmación y sin devolución, se registra el código del fallo actual en `error_code`, el motivo en `reason` y el estado `DEAD_LETTER`. Las fallas de escritura de la auditoría de 010, incluida la de `registerIfAbsent(...)`, se tratan como `DATABASE_UNAVAILABLE` y siguen la misma ruta de retry; el registro se crea o se actualiza cuando una reentrega logra escribirlo. Se exceptúa la escritura del estado posterior a una publicación confirmada a la DLQ, que se rige por el nack con reencolado descrito a continuación. Los errores terminales y payloads inválidos se publican persistentemente a la DLQ mediante el exchange por defecto con `mandatory`. Toda publicación directa usa `mandatory`; una devolución `basic.return` o la falta de confirmación se trata como fallo y causa nack con reencolado. Si la publicación a la DLQ se confirma y falla la escritura del estado, el mensaje original recibe nack con reencolado y la reentrega repite la publicación: un evento reconocible encuentra su registro en `PENDING` y un sobre irreconocible se evalúa de nuevo como tal. La DLQ puede recibir una copia duplicada; la revisión manual la descarta por `eventId` cuando existe y, en un sobre irreconocible, por ser idéntica al mensaje original. La recuperación manual desde la DLQ corrige la causa, cambia el registro a `PENDING` y publica el mensaje a `modulo3.checkout` mediante el exchange por defecto con `x-retry-count` en 0, para iniciar un nuevo ciclo de reintentos.

## 5. Errores

Los códigos siguientes son resultados de procesamiento y auditoría, no respuestas HTTP.

| Código | Resultado |
|---|---|
| `INVALID_CHECKOUT_EVENT` | Sobre inválido o datos obligatorios ausentes/inválidos; publicación a DLQ confirmada y `REJECTED`. |
| `RESERVATION_NOT_FOUND` | Reserva no encontrada por 007; `DEAD_LETTER`. |
| `QUOTE_NOT_FOUND` | Cotización aplicable no encontrada por 007; `DEAD_LETTER`. |
| `MISSING_COMMISSION` | Comisión requerida ausente; `DEAD_LETTER`. |
| `INVALID_COMMISSION` | Comisión inválida; `DEAD_LETTER`. |
| `SETTLEMENT_ALREADY_EXISTS` | Datos de check-out contradicen la liquidación existente; `DEAD_LETTER`. |
| `MODULE2_UNAVAILABLE` | Dependencia transitoria no disponible; retry mediante `x-retry-count` mientras sea menor que 5. |
| `VAT_RATE_UNAVAILABLE` | Tasa de IVA no disponible; retry mediante `x-retry-count` mientras sea menor que 5. |
| `BILLING_CUSTOMER_DATA_MISSING` | Resultado normal sin emisión de factura; ack y `PROCESSED`. |
| `DATABASE_UNAVAILABLE` | Falla transitoria de persistencia, incluida la escritura de la auditoría de 010; retry mediante `x-retry-count` mientras sea menor que 5, aunque todavía no exista el registro; si ya es 5, publicación a DLQ con el código del fallo actual. |
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
  "occurredAt": "2026-10-08T06:05:00-05:00",
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
