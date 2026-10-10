# Contrato de Mensajería: Evento Registrar Check-out (`habitacion.checkout`)

**Feature**: 010 Registrar Check-out — HU1
**Spec**: [registrar_checkout.md](../../1-functional/registrar_checkout.md)
**Plan**: [plan.md](../plan.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)

**Etiquetas de origen**:
- `[SPEC]`: Definido en la especificación funcional de la feature (`registrar_checkout.md`).
- `[PLAN]`: Decisión técnica del plan de esta feature (`features/010-registrar-checkout/2-technical/plan.md`).
- `[BASE]`: Definido en la plataforma compartida (`docs/plan-tecnico-base.md`).
- `[CONV]`: Convención técnica adoptada para este contrato.

---

## 1. Propósito

Módulo 1 publica el evento `habitacion.checkout` en el broker RabbitMQ al momento de confirmar el Check-Out físico de una habitación en recepción. Módulo 3 consume este mensaje de forma asíncrona mediante `@nestjs/microservices` (`Transport.RMQ`). Es el **único evento externo** que dispara el procesamiento financiero de una estancia en Módulo 3, orquestando secuencialmente la invocación obligatoria a `Generar liquidación` (feature 007) [SPEC FR-001, FR-004, BR-001, BR-002; BASE] y a continuación a `Generar factura final` (feature 006) [BASE; SPEC 006; SPEC 007].

Módulo 3 invoca a la feature 006 tras generar la liquidación. Si faltan datos tributarios, la liquidación generada por 007 permanece en estado `Final`, no se emite factura ni se asigna número de factura, conforme al comportamiento de Feature 006 [SPEC 006; SPEC 010 FR-002].

El evento es **por habitación**: una reserva con varias habitaciones genera un evento independiente por cada una [BASE; SPEC 007 FR-020].

---

## 2. Mensaje

### Parámetros de Broker y Cola

| Parámetro | Valor definido en Plan Base | Alternativa Convención M1 | Estado | Origen |
|---|---|---|---|---|
| **Exchange** | `hospitua.events` (Tipo: `topic`, durable: `true`) | Exchange topic compartido | Confirmado | [BASE, M1] |
| **Routing Key** | `habitacion.checkout` | `habitacion.checkout` | Confirmado | [BASE, M1] |
| **Queue Principal** | `modulo3.checkout` (durable: `true`) | `modulo3.checkout` declarada por M3 | Confirmado | [BASE] |
| **Dead-Letter Exchange (DLX)** | `hospitua.events.dlx` (Tipo: `topic`, durable: `true`) | Exchange directo de DLQ | Definido por la topología de M3 | [BASE] [PLAN] |
| **Dead-Letter Routing Key** | `modulo3.checkout.dlq` | `m3.habitacion.checkout.dlq` | Definido por la topología de M3 | [BASE] [PLAN] |
| **Dead-Letter Queue (DLQ)** | `modulo3.checkout.dlq` (durable: `true`) | `m3.habitacion.checkout.dlq` | Definido por la topología de M3 | [BASE] [PLAN] |
| **Colas de Reintento con Espera** | `modulo3.checkout.retry.5s`, `modulo3.checkout.retry.15s`, `modulo3.checkout.retry.45s` | Colas con TTL equivalente | Definido por la topología de M3 | [PLAN] |
| **Tipo de Entrega** | Persistent (deliveryMode: 2) | Persistent | Propuesto [BASE] | [CONV] |
| **Ack Mode** | Manual (`noAck: false`), confirmado tras procesar | Manual | Propuesto [BASE] | [BASE] |

> [!IMPORTANT]
> **Propiedad y Declaración de Colas**:
> M1 se limita a publicar mensajes al exchange `hospitua.events` con routing key `habitacion.checkout` y declara únicamente sus colas hacia M2. Módulo 3 es dueña exclusiva de la declaración de su topología (`modulo3.checkout`, colas diferidas de reintento con TTL `modulo3.checkout.retry.*`, DLX `hospitua.events.dlx` y DLQ `modulo3.checkout.dlq`).

---

### Estructura del Sobre (`EventEnvelope<CheckoutPayload>`)

Todos los eventos compartidos entre módulos viajan en la envoltura estándar `EventEnvelope` [BASE].

| Campo Envoltura | Tipo | Obligatorio | Descripción | Origen |
|---|---|---|---|---|
| `eventId` | UUIDv4 | Sí | Identificador único del evento para deduplicación y auditoría. Si el valor recibido no es un UUID válido, se registra en `received_event_id` y el evento se rechaza con estado `REJECTED`. | [BASE, NFR-004] |
| `eventType` | string | Sí | Debe ser estrictamente `"CHECK_OUT"` | [BASE] |
| `occurredAt` | string (ISO-8601 UTC) | Sí | Marca de tiempo de emisión física en Módulo 1 (ej. `2026-10-08T10:30:00Z`) | [BASE] |
| `sourceModule` | string | Sí | Debe ser estrictamente `"MODULE_1"` | [BASE] |
| `payload` | object | Sí | Datos de la estancia física (ver detalle abajo) | [BASE] |

> [!NOTE]
> **Compatibilidad del Transporte (@nestjs/microservices vs Spring AMQP)**:
> `@nestjs/microservices` con `Transport.RMQ` espera por defecto mensajes con la estructura `{ pattern: string, data: any }`. Módulo 1 emite envolturas `EventEnvelope` planas mediante Spring AMQP (sin propiedad `pattern`). Para garantizar la interoperabilidad sin forzar cambios en el publicador de M1, Módulo 3 resuelve la deserialización de forma interna mediante un deserializador personalizado (`RmqRecordDeserializer`) o un consumidor desacoplado sobre `amqplib`, mapeando la routing key `habitacion.checkout` directamente al sobre `EventEnvelope`.

---

### Estructura del `payload`

| Campo Payload | Tipo | Obligatorio | Descripción | Origen |
|---|---|---|---|---|
| `reservationRef` | string | Sí | Referencia contractual de la reserva (ej. `RES-000123`). String opaco; **no se valida como UUID**. Parte de la llave de idempotencia. | [SPEC FR-002] [BASE] |
| `roomId` | UUID | Sí | Identificador unívoco de la habitación física desocupada. Parte de la llave de idempotencia. | [SPEC FR-002] [BASE] |
| `categoryRoom` | string | Sí | Categoría de la habitación. Para esta iteración se adopta contractualmente el valor `DOBLE`. Debe coincidir exactamente con el `roomType` de la cotización asociada en Feature 007 / Módulo 2; si no coincide, termina en `QUOTE_NOT_FOUND` → DLQ [BASE; SPEC 007]. | [SPEC FR-002] [BASE] |
| `checkInDate` | string (`YYYY-MM-DD`) | Sí | Fecha real de ingreso del huésped. | [SPEC FR-002] [BASE] |
| `checkOutDate` | string (`YYYY-MM-DD`) | Sí | Fecha real de salida del huésped. Debe ser estrictamente posterior a `checkInDate`. | [SPEC FR-002, FR-003] [BASE] |
| `stayId` | UUID | Sí (Requerido por M3) | Identificador único de la estancia física. Requerido contractualmente por el Plan Base y los contratos de liquidación (feature 007) y facturación (feature 006) bajo restricción `UNIQUE(stay_id)`. El Plan Base incluye `stayId` como UUID obligatorio en el evento. | [BASE] [SPEC 007] [SPEC 006] |
| `billingCustomer` | object | No (Opcional) | Datos tributarios del pagador. Si no viene en el evento, la liquidación se genera en 007 con estado `Final`, pero la emisión de la factura en 006 falla con `BILLING_CUSTOMER_DATA_MISSING` → DLQ sin numeración asignada [SPEC 006; SPEC FR-002]. | [SPEC FR-002, casos límite] [PLAN] |
| `billingCustomer.name` | string | Sí (si `billingCustomer` está presente) | Nombre completo o razón social del pagador. | [SPEC FR-002] |
| `billingCustomer.taxId` | string | Sí (si `billingCustomer` está presente) | Documento de identificación o NIT fiscal. | [SPEC FR-002] |

> [!NOTE]
> **Sin datos de canal ni OTA**: El evento de check-out de Módulo 1 **no contiene el campo `source`** ni datos de OTA. La fuente de verdad contractual del canal y comisión es exclusivamente Módulo 2 [BASE].

> [!IMPORTANT]
> **Lista Blanca Estricta y Privacidad (FR-006, NFR-003)**:
> El payload que se persiste en `checkout_event_log.payload` y se transfiere al dominio se reconstruye **exclusivamente con las claves declaradas en la lista blanca**:
> - Sobre: `eventId`, `eventType`, `occurredAt`, `sourceModule`.
> - Payload: `reservationRef`, `roomId`, `categoryRoom`, `checkInDate`, `checkOutDate`, `stayId`, `billingCustomer.name`, `billingCustomer.taxId`.
> Cualquier dato adicional (pasaporte, número de documento no tributario, nacionalidad, tipo de visa, registros SIRE) es **descartado de inmediato en la deserialización** y **nunca se persiste el cuerpo crudo**, ni siquiera ante sobre malformado o JSON roto [FR-006, NFR-003].

---

### Ejemplo JSON: Mensaje con Datos Tributarios

```json
{
  "eventId": "a5d8b76e-3f91-4c22-b88a-9e67d4f91012",
  "eventType": "CHECK_OUT",
  "occurredAt": "2026-10-08T11:00:00Z",
  "sourceModule": "MODULE_1",
  "payload": {
    "reservationRef": "RES-000123",
    "roomId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "categoryRoom": "DOBLE",
    "checkInDate": "2026-10-05",
    "checkOutDate": "2026-10-08",
    "stayId": "d1e4c7b8-2a55-4e31-89d2-b0a112233445",
    "billingCustomer": {
      "name": "Comercializadora Andina S.A.S.",
      "taxId": "900123456-7"
    }
  }
}
```

### Ejemplo JSON: Mensaje Válido Sin Datos Tributarios (Con `stayId`)

```json
{
  "eventId": "b7e9c112-4a02-4d33-a11b-8e55d3f82033",
  "eventType": "CHECK_OUT",
  "occurredAt": "2026-10-08T11:05:00Z",
  "sourceModule": "MODULE_1",
  "payload": {
    "reservationRef": "RES-000456",
    "roomId": "a11bc20c-69dd-4483-b678-1f13c3d4e580",
    "categoryRoom": "DOBLE",
    "checkInDate": "2026-10-07",
    "checkOutDate": "2026-10-08",
    "stayId": "e3f5d8c9-3b66-4f42-9a03-c1b223344556"
  }
}
```

---

### 3. Reglas de Procesamiento

1. **Registro Inicial en Auditoría (`checkout_event_log`)**:
   - Todo mensaje recibido se persiste primero en `checkout_event_log` mediante operación atómica (`upsertInitial`) con estado `PENDING`, reconstruido estrictamente por lista blanca (descartando datos migratorios y sin persistir cuerpo crudo).
   - Para permitir registrar mensajes con sobre malformado o identificadores inválidos sin violar restricciones de integridad:
     - Llave primaria subrogada `id uuid PK DEFAULT gen_random_uuid()`.
     - Columna `event_id uuid NULLABLE` con índice único parcial `CREATE UNIQUE INDEX ... WHERE event_id IS NOT NULL`.
     - Columna `received_event_id text NULLABLE` para almacenar la cadena textual original recibida cuando no cumpla formato UUID.
     - Columnas individuales (`reservation_ref`, `room_id`, `category_room`, `check_in_date`, `check_out_date`, `stay_id`) nulables en tabla.
2. **Validación Sintáctica y Envoltura**:
   - Si `eventType !== 'CHECK_OUT'`, `eventId` no es UUID o faltan datos obligatorios (`reservationRef`, `roomId`, `categoryRoom`, `stayId`, fechas), se actualiza el log a `REJECTED`, se registra como rechazo conforme al flujo de consumo y se envía el mensaje a DLQ (`nack` sin requeue) [SPEC FR-002, FR-005, SC-002].
3. **Consistencia Cronológica**:
   - `checkInDate < checkOutDate`. Si `checkInDate >= checkOutDate`, el evento es inválido (`REJECTED`) [SPEC FR-003, casos límite]. Estancias de 1 noche son válidas (`checkOutDate = checkInDate + 1 día`) [SPEC HU1 escenario 2].
4. **Idempotencia a Nivel de Mensaje (`eventId`)**:
   - Ante la recepción de un `eventId` ya existente en `checkout_event_log`, el comportamiento cubre exhaustivamente todos los estados:
     - `PROCESSED`: confirmación inmediata (`channel.ack`) sin reprocesar [SPEC NFR-004; BASE].
     - `PENDING`: reentrega concurrente o por reconexión antes de concluir el procesamiento inicial; se reutiliza el registro existente y se continúa el procesamiento, sin intentar insertar otro registro ni colisionar con la restricción UNIQUE.
     - `RETRYING`: reingreso programado desde colas diferidas de reintento o por reconexión; se reutiliza el registro existente y se continúa el procesamiento, sin crear otro registro ni duplicar el evento.
     - `REJECTED`: confirmación inmediata (`channel.ack`) sin volver a procesarlo automáticamente.
     - `DEAD_LETTER`: confirmación inmediata (`channel.ack`) sin volver a procesarlo automáticamente. La reprocesación debe realizarse exclusivamente mediante el mecanismo manual de recuperación de la DLQ ya previsto (T023), no mediante una nueva entrega ordinaria.
5. **Idempotencia de Negocio (`stayId`)**:
   - La estancia física y su liquidación se identifican unívocamente mediante `stayId` (con restricción `UNIQUE(stay_id)` en base de datos según Plan Base y Feature 007).
   - Si ya existe liquidación `Final` para ese `stayId` con idénticos datos, `GenerateSettlementUseCase` retorna la existente sin recalcular [SPEC BR-004, SC-005; SPEC 007 FR-011].
   - Si existe con datos distintos, se detiene con error de conflicto `SettlementAlreadyExistsError` (`SETTLEMENT_ALREADY_EXISTS`) → se marca `DEAD_LETTER`, se registra el rechazo y se envía a DLQ (`nack` sin requeue) sin reintento [SPEC 007 FR-010].
6. **Inclusión de Casos de Uso Subordinados**:
   - **Paso A**: Se invoca obligatoriamente `GenerateSettlementUseCase.generate(...)` (feature 007) [SPEC FR-004, BR-002; BASE].
   - **Paso B**: Se invoca secuencialmente `GenerateFinalInvoiceUseCase.generate(...)` (feature 006) [BASE; SPEC 006; SPEC 007].
7. **Tratamiento de la Factura (Feature 006)**:
   - Feature 006 requiere datos tributarios completos (`billingCustomer.name` y `billingCustomer.taxId`) para emitir la factura fiscal.
   - Si faltan datos tributarios, feature 006 lanza `BillingCustomerDataMissingError` (`BILLING_CUSTOMER_DATA_MISSING`):
     - La liquidación ya guardada en 007 se conserva intacta en la base de datos con estado `Final` [SPEC 006, 007].
     - No se asigna número de factura ni se crea el registro de factura.
     - Al ser un error de validación de datos no transitorio, el log se actualiza a `DEAD_LETTER`, el evento se envía a la DLQ (`channel.nack(msg, false, false)`).
     - La ausencia de datos tributarios impide emitir factura; la liquidación `FINAL` se consulta con `invoice: null` [SPEC 006].
   - Si 006 sufre una falla transitoria documentada (ej. `VatRateUnavailableError` / `VAT_RATE_UNAVAILABLE` al consultar el IVA vigente en 001):
     1. La liquidación ya guardada en 007 se conserva intacta en la base de datos con estado `Final`.
     2. El procesamiento entra en el mecanismo de reintentos diferidos existente (máximo 3 reintentos con retardos de 5 s, 15 s y 45 s).
     3. Al reingresar el mensaje desde la cola de espera con TTL, 007 recupera la liquidación ya creada de forma idempotente por `stayId`, sin duplicarla ni recalcular.
     4. La integración vuelve a intentar la emisión de la factura en 006.
     5. Si se agotan los reintentos (>= 3), el evento pasa a `DEAD_LETTER`, se envía a la DLQ (`nack` sin requeue).
8. **Notificación de Rechazo a Módulo 1 (FR-008)**:
   - Conforme a FR-008, el sistema debe informar a Módulo 1 el dato faltante o inválido cada vez que rechace un evento.
   - FR-008 exige informar a Módulo 1 el dato rechazado. No hay contrato receptor definido; este contrato no prescribe transporte ni formato.
9. **Confirmación Manual (Ack)**:
   - El mensaje original solo se confirma (`channel.ack(msg)`) cuando la persistencia en base de datos (`settlement`, `invoice` si aplicó, y `checkout_event_log`) concluye exitosamente [BASE].

---

## 4. Política de Ack / Nack / Reintentos Diferidos / Dead-Letter

Dado que la cola principal `modulo3.checkout` tiene configurado dead-lettering directo a la DLQ ante `nack(requeue: false)`, un error transitorio **no puede hacer nack**, pues se iría a la DLQ sin reintentarse.

### Mecanismo de Reintento Diferido (Anti-Hot-Loop)

1. Ante una falla de comunicación transitoria hacia dependencias externas (`MODULE2_UNAVAILABLE`) o una falla transitoria documentada en 006 (`VAT_RATE_UNAVAILABLE`):
   - Se lee el header `x-retry-count` del mensaje (por defecto 0).
   - Si `x-retry-count < 3`:
     - Se incrementa el contador (`x-retry-count = count + 1`).
     - Se publica una copia del mensaje en la cola de espera correspondiente a su nivel de retardo:
       - Intento 1: cola con TTL de 5 s (`modulo3.checkout.retry.5s`)
       - Intento 2: cola con TTL de 15 s (`modulo3.checkout.retry.15s`)
       - Intento 3: cola con TTL de 45 s (`modulo3.checkout.retry.45s`)
     - Estas colas no tienen consumidores; al expirar su TTL, su DLX devuelve el mensaje automáticamente a la cola principal `modulo3.checkout`.
     - **Se confirma el mensaje original en la cola principal**: `channel.ack(originalMsg)`.
     - Se actualiza `checkout_event_log` a `RETRYING`.
   - Si `x-retry-count >= 3`:
     - Se agota el cupo de reintentos: se emite `channel.nack(originalMsg, false, false)` enviando el mensaje a la DLQ definitiva (`modulo3.checkout.dlq`).
     - Se actualiza `checkout_event_log` a `DEAD_LETTER`.
     - Se informa el agotamiento de reintentos conforme a FR-008.

### Matriz de Destino por Tipo de Resultado

| Escenario | Condición | Acción en RabbitMQ | Destino / Persistencia |
|---|---|---|---|
| **Éxito Completo** | Liquidación generada + Factura emitida. | `channel.ack(msg)` | `settlement` e `invoice` guardadas, log `PROCESSED`. |
| **Falta de Datos Tributarios** | Liquidación generada en 007 + 006 falla por falta de datos tributarios (`BILLING_CUSTOMER_DATA_MISSING`). | Registrar el rechazo y ejecutar `channel.nack(msg, false, false)`; FR-008 no tiene transporte receptor definido. | DLQ (`modulo3.checkout.dlq`), `settlement` guardada en `Final`, sin número de factura, log `DEAD_LETTER`. |
| **Reenvío Idempotente Terminado** | Evento ya procesado previamente (`PROCESSED`, `REJECTED`, `DEAD_LETTER`). | `channel.ack(msg)` | Sin cambios en BD; ack inmediato sin reprocesar. |
| **Redelivery en Curso** | Mensaje redelivered con registro existente en `PENDING` o `RETRYING`. | Continuar procesamiento | Se reutiliza el registro existente sin reinsertar ni violar `UNIQUE(event_id)`. |
| **Payload Inválido** | Faltan campos mínimos, fechas invertidas o sobre malformado. | Registrar el rechazo y ejecutar `channel.nack(msg, false, false)`; FR-008 no tiene transporte receptor definido. | Dead-Letter Queue (`modulo3.checkout.dlq`), log `REJECTED`. |
| **Error No Recuperable** | Negocio no recuperable: `RESERVATION_NOT_FOUND`, `QUOTE_NOT_FOUND`, `MISSING_COMMISSION`, `INVALID_COMMISSION`, o `SETTLEMENT_ALREADY_EXISTS`. | Registrar el rechazo y ejecutar `channel.nack(msg, false, false)`; FR-008 no tiene transporte receptor definido. | Dead-Letter Queue (`modulo3.checkout.dlq`), log `DEAD_LETTER`. |
| **Falla Transitoria** | Timeout M2 (> 500 ms), circuit breaker abierto hacia M2 (`MODULE2_UNAVAILABLE`), o falla transitoria de IVA en 006 (`VAT_RATE_UNAVAILABLE`). | Publicar a cola de retry con TTL + `channel.ack(msg)` original | Cola de espera con retardo exponencial (máx. 3 intentos). |

---

## 5. Matriz de Errores y Rechazos

| Error Code | Componente | Causa | Destino Mensaje | Acción Operativa |
|---|---|---|---|---|
| `INVALID_CHECKOUT_EVENT` | 010 Ingestión | Faltan campos mínimos del payload, fechas invertidas o sobre malformado. | DLQ | El requisito FR-008 obliga a informar el dato; no hay transporte receptor definido. |
| `RESERVATION_NOT_FOUND` | 007 Settlement | La reserva no existe en Módulo 2 (`404 Not Found`). Error no recuperable. | DLQ | FR-008 exige informar el dato; el contrato no define el transporte. |
| `QUOTE_NOT_FOUND` | 007 Settlement | No existe cotización para `categoryRoom` (`DOBLE`) entre los `quoteIds` de la reserva. Error no recuperable. | DLQ | FR-008 exige informar el dato; el contrato no define el transporte. |
| `MISSING_COMMISSION` | 007 Settlement | Reserva de canal OTA sin porcentaje de comisión informado por M2. Error no recuperable. | DLQ | FR-008 exige informar el dato; el contrato no define el transporte. |
| `INVALID_COMMISSION` | 007 Settlement | Porcentaje de comisión negativo o superior al 100%. Error no recuperable. | DLQ | FR-008 exige informar el dato; el contrato no define el transporte. |
| `SETTLEMENT_ALREADY_EXISTS`| 007 Settlement | Ya existe liquidación para la estancia con fechas o montos contradictorios. Error no recuperable. | DLQ | FR-008 exige informar el dato; el contrato no define el transporte. |
| `MODULE2_UNAVAILABLE` | 007 / Infra | Falla de red, timeout (> 500 ms) o circuito abierto hacia Módulo 2. | Cola Retry (3x) → DLQ | Esperar recuperación automática de M2. |
| `BILLING_CUSTOMER_DATA_MISSING` | 006 Billing | Datos tributarios ausentes o incompletos al intentar emitir factura (`BillingCustomerDataMissingError`). Error no recuperable en este intento. | DLQ | **La liquidación queda generada en `Final`**. Log queda `DEAD_LETTER`. No se asigna número. No se emite factura ni se asigna número mientras falten los datos [SPEC 006]. |
| `VAT_RATE_UNAVAILABLE` | 006 Billing | No se puede obtener la tasa de IVA vigente desde Feature 001 (`VatRateUnavailableError`). | Cola Retry (3x) → DLQ | Reintentar flujo (007 devuelve existente por idempotencia y 006 reintenta emisión). Al agotarse los reintentos, el evento va a DLQ. |

> [!IMPORTANT]
> **Listado taxativo de errores no recuperables**:
> Los errores de negocio no recuperables actualizan el log de auditoría y desvían el mensaje a la DLQ según esta política. FR-008 conserva la obligación de informar a Módulo 1; el contrato disponible no define el mecanismo receptor.

---

## 6. Notificación a Módulo 1 ante Rechazo (FR-008 / SC-006)

El requisito funcional **FR-008** ("El sistema DEBE informar a Módulo 1 el dato faltante o inválido cada vez que rechace un evento") y el criterio de éxito **SC-006** exigen formalmente comunicar a Módulo 1 cualquier rechazo de check-out.

Sin embargo, los contratos técnicos vigentes de Módulo 1 no definen ningún listener, cola de entrada en RabbitMQ ni endpoint REST receptor para consumir notificaciones de rechazo emitidas por Módulo 3.

Por consiguiente:
- Se conserva la obligación funcional de FR-008. No hay contrato receptor ni transporte de notificación definido en la documentación disponible.
- No hay contrato receptor de notificaciones en la documentación disponible; este documento no define transporte ni formato de mensaje. FR-008 conserva la obligación funcional de informar el dato rechazado a Módulo 1.

---

## 7. Ventana de Consistencia con Feature 002 (Consultar Liquidación)

El procesamiento del evento de check-out en Módulo 3 es **completamente asíncrono**. En el flujo operativo de recepción de Módulo 1, el paso 2 de consulta de liquidación (feature 002) se invoca reactivamente mediante REST GET (`GET /api/v1/settlements`).

> [!WARNING]
> **Recepción y ACK no garantizan disponibilidad inmediata**:
> La recepción del evento en RabbitMQ y la emisión del ACK **no implican que la liquidación final ni la factura definitiva estén disponibles al instante** para la consulta de Módulo 1.

Durante esta ventana de consistencia eventual, Módulo 1 puede experimentar distintos estados de lectura al consultar `GET /api/v1/settlements`:
- `settlementType: "INFORMATIVE"`: Si el mensaje de check-out aún está encolado o procesándose en 010/007.
- `settlementType: "FINAL"` con `invoice: null`: Si la liquidación definitiva ya fue persistida por 007 pero la factura fiscal definitiva aún está emitiéndose en 006, o si el evento se desvió a DLQ por ausencia de datos fiscales (`billingCustomer`).
- `settlementType: "FINAL"` con factura completa: Cuando el flujo concluyó exitosamente con la factura emitida y numerada.

La consulta refleja el estado disponible en ese momento: `INFORMATIVE` antes de que 007 persista la liquidación y `FINAL` después. Cuando Feature 006 no haya emitido factura, la liquidación `FINAL` se consulta con `invoice: null`.

---
