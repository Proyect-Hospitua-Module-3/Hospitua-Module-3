# Contrato REST: Consultar liquidación

**Feature**: 002 Consultar liquidación — HU1, HU2, HU3
**Spec**: [consultar_liquidacion.md](../../1-functional/consultar_liquidacion.md)
**Plan**: [plan.md](../plan.md)
**Proyecto base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)
**Estado**: Consulta de solo lectura; ruta canónica `GET /api/settlements` según el Plan Base

**Etiquetas de origen**:
- `[SPEC]`: Definido en la especificación funcional de la feature (`consultar_liquidacion.md`).
- `[PLAN]`: Decisión técnica del plan de esta feature (`features/002-consultar-liquidacion/2-technical/plan.md`).
- `[BASE]`: Definido en la plataforma compartida (`docs/plan-tecnico-base.md`).
- `[CONV]`: Convención técnica adoptada para este contrato.

---

## 1. Propósito

Permite a los actores autorizados consultar el estado y desglose financiero de una habitación de una reserva [SPEC FR-001, BR-002]:
- **Módulo 1** consulta en los pasos 2 (Liquidación) y 3 (Pago) del check-out antes de confirmar la salida para conocer el resultado financiero informativo proyectado (< 800 ms), y después del check-out para confirmar que la liquidación `Final` fue generada exitosamente [SPEC HU2; BASE].
- **OTA (Booking, Airbnb, Expedia)** consulta después del check-out para verificar el ingreso neto, la comisión liquidada y conciliar sus registros respecto a reservas que ella intermedió [SPEC HU1].

Es una operación **exclusivamente de solo lectura**; nunca crea, actualiza ni recalcula una liquidación `Final` existente ni su factura [SPEC FR-004, BR-001, SC-004].

---

## 2. Alineación con Módulo 1 (Check-Out Front-Desk)

Módulo 1 (desarrollado en Java / Spring Boot) contempla en su plan "Consulta de Liquidación en Check-Out" la invocación de este servicio. La siguiente tabla contrasta lo que espera Módulo 1 frente a lo que ofrece Módulo 3:

| Tema | Lo que espera Módulo 1 | Lo que ofrece Módulo 3 | Estado |
|---|---|---|---|
| **Ruta** | `GET /api/settlements` | `GET /api/settlements` (ruta definida en Plan Base; llamada interna sin token) | Definida en Plan Base |
| **Autenticación** | JWT del recepcionista con rol `RECEPTIONIST` o `ADMINISTRATOR` | Llamada interna sin token por red Docker Compose (establecido en plan base). M3 no valida usuarios de M1 ni sus roles. | *Alineación con M1 (M3 no valida recepcionistas)* |
| **Categoría de habitación** | Envía `categoryRoom` | Requiere `categoryRoom`; para esta iteración el valor es `DOBLE`. | Definida para esta iteración |
| **Parámetros adicionales** | Envía `eventType=CHECK_OUT`, `source`, `checkInDate`, `checkOutDate` | Requiere solo `reservationRef`, `roomId`, `categoryRoom` para M1. Tolera e ignora `eventType`, `source` y fechas (`source` no se devuelve, coincidiendo con M1 que lo toma de `Stay.source`). | *Compatible (tolerante)* |
| **Formato de `reservationRef`** | Descrito y validado como UUID | String opaco (ej. `RES-000123`, generado por M2). No se valida como UUID. | *Resuelto en M3: string opaco sin validación UUID* |
| **Estructura de respuesta** | Plana con 6 campos numéricos/string (`accommodationTotalAmount`, `otaCommissionPercentage`, `otaCommissionAmount`, `netIncomeAmount`, `taxAmount`, `invoiceNumber`/`totalToPay`) | Estructura canónica anidada (`settlementType`, `breakdown`, `invoice`) con strings decimales exactos. | Las estructuras no coinciden; la documentación disponible no define el mapeo. |
| **Cálculo de ingreso neto** | M1 usa en su ejemplo `425.00` (`500 - 75`) | `hospedaje - comisión` (`425.00`, sin IVA; el IVA es solo de la factura fiscal según FR-002/FR-003). | Resuelto: M3 ratifica hospedaje − comisión (sin IVA) |
| **Liquidación informativa en paso 3** | En paso 3 de M1 se muestran únicamente: hospedaje, comisión e ingreso neto (`netIncome = accommodationAmount - commission`) | Antes del check-out la liquidación es estrictamente informativa: `invoice: null` (sin factura, sin IVA y sin total final). El ingreso neto no es el total pagado por el huésped. | *Alineado con decisión confirmada* |
| **Formato de `invoiceNumber`** | Entero consecutivo | `integer` consecutivo (ej. `1042`) en `invoice` definitiva (secuencia PostgreSQL); `null` en informativa. | Entero consecutivo (secuencia) |
| **Total a pagar (`totalToPay`)** | Total de hospedaje más IVA | `invoice.totalAmount` cuando existe factura definitiva; `null` en informativa o sin factura. | La referencia M1 no define mapeo para `null` |
| **Timeout y Rendimiento (SLA)** | Timeout de 3 s con circuit breaker y p95 < 800 ms (techo 2 s en SC-002 de M1) | Consulta informativa en memoria con p95 < 800 ms (< 500 ms hacia M2). | Compatible: objetivo propuesto por M1 en su plan (p95 < 800 ms, timeout 3 s); M3 lo adopta como objetivo |
| **Códigos de error** | En español (`PARAMETROS_INVALIDOS`) y HTTP 422 para fechas | `ApiError` en inglés (`INVALID_QUERY_PARAMS`) y HTTP 400. M1 traduce errores a estado interno `UNAVAILABLE`. | *Menor: M1 no lee el cuerpo de error* |
| **Fechas y horas** | Sin horas en contratos de negocio | Marcas de tiempo ISO 8601 con hora en `generatedAt` e `invoice.issuedAt`. | *Menor: M1 no consume marcas de tiempo* |

> **Compatibilidad de respuesta**: M3 conserva la respuesta anidada definida por su contrato. La referencia de integración de M1 describe una forma plana y no documenta un mapeo entre ambas representaciones.

---

## 3. Petición

### Rutas
- **Ruta canónica compartida (Plan Base)**: `GET /api/settlements` [BASE]
  - **Acceso externo (OTA)**: `GET /api/settlements`, requiriendo cabecera `Authorization: Bearer <token>` con `role = OTA` y claim `otaId` [BASE].
  - **Acceso interno (Módulo 1)**: La llamada a esta ruta dentro de la red privada de Docker Compose se realiza sin token [BASE].

> [!NOTE]
> **Autenticación intermódulo (Decisión establecida en Plan Base)**:
> La arquitectura compartida (`docs/plan-tecnico-base.md`, líneas 186-188) establece que la comunicación entre módulos en la red interna de contenedores se ejecuta sin token. Módulo 3 no puede validar tokens de recepcionistas de M1 ni sus roles (`RECEPTIONIST`/`ADMINISTRATOR`), dado que pertenecen a otro proveedor de identidad y M3 solo administra roles `Administrador` y `OTA`. Se mantiene la ruta interna sin token en la red Docker como decisión establecida.

---

### Headers

| Header | Obligatorio | Valor | Descripción | Origen |
|---|---|---|---|---|
| `Authorization` | Condicional | `Bearer <token>` | **Obligatorio para OTAs** (`role = OTA`, claim `otaId`). No enviado por Módulo 1 en red interna. | [SPEC FR-001, BR-002; BASE] |
| `Accept` | No | `application/json` | Tipo MIME esperado. | [CONV] |
| `X-Correlation-Id` | No | string | Identificador de trazabilidad distribuida; si no llega, M3 lo genera. | [BASE] |

---

### Query Parameters

| Parámetro | Tipo | Obligatorio M1 | Obligatorio OTA | Descripción y Comportamiento | Origen |
|---|---|---|---|---|---|
| `reservationRef` | string | Sí | Sí | Referencia de la reserva (ej. `RES-000123`). **Es un string opaco**, no se valida como UUID. M1 lo documenta como UUID y debe corregirlo. | [SPEC FR-001] [BASE] |
| `roomId` | UUID | Sí | **No (Opcional)** | Habitación física. M1 la conoce; la OTA no la conoce. *(Ver sección de consulta OTA)*. | [SPEC FR-001] [PLAN] |
| `categoryRoom` | string | Sí | **No (Opcional)** | Categoría de la habitación (nombre contractual acordado). En esta iteración el check-out usa `DOBLE`. | [SPEC FR-001] [PLAN] [BASE] |
| `eventType` | string | No | No | Enviado por M1 (`eventType=CHECK_OUT`). **Aceptado e ignorado**; no filtra ni altera el resultado. | [PLAN] |
| `checkInDate` | date | No | No | Fecha real enviada por M1. **Opcional e ignorada**; no filtra ni altera el resultado. | [PLAN] |
| `checkOutDate` | date | No | No | Fecha real enviada por M1. **Opcional e ignorada**; no filtra ni altera el resultado. | [PLAN] |
| `source` | string | No | No | Canal reportado por M1. **Opcional e ignorado**; la fuente contractual es M2. | [PLAN] [BASE] |

---

### Ejemplos de Petición

#### Llamada de Módulo 1 en Check-Out (Tolerante con todos sus parámetros)
```http
GET /api/settlements?reservationRef=RES-000123&roomId=f47ac10b-58cc-4372-a567-0e02b2c3d479&categoryRoom=DOBLE&eventType=CHECK_OUT&checkInDate=2026-10-05&checkOutDate=2026-10-08&source=DIRECTA
Accept: application/json
X-Correlation-Id: c89b3f0e-2d11-4a9f-9c02-7a8b9c0d1e2f
```

#### Llamada Externa de OTA
```http
GET /api/settlements?reservationRef=RES-000456
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Accept: application/json
```

---

## 4. Reglas de Procesamiento

1. **Autenticación y Control de Acceso**:
   - Peticiones externas con JWT: se valida `role === 'OTA'` y claim `otaId`.
   - Peticiones sin token: deben ingresar por `/api/settlements` o provenir de la subred privada de Docker Compose. Toda petición sin token en la ruta pública se rechaza con `401 UNAUTHENTICATED`.
2. **Identificación de la Consulta para Módulo 1**:
   - M1 aporta `reservationRef`, `roomId` y `categoryRoom`.
   - En esta iteración, `categoryRoom` es `DOBLE`.
   - La liquidación `Final` se busca unívocamente por el par `(reservationRef, roomId)` en la tabla `settlement`.
3. **Identificación de la Consulta para la OTA (FR-006)**:
   - Dado que las OTAs no gestionan el inventario físico, `roomId` y `categoryRoom` son opcionales para este actor en la consulta.
   - La consulta OTA se identifica por `reservationRef` y se restringe al `otaId` del token. `otaConfirmationCode` no es parámetro contractual de esta operación.
   - **Validación de pertenencia**: se verifica que `settlement.otaId === token.otaId`.
   - **Protección anti-enumeración**: si la reserva pertenece a canal directo o a otra OTA, o si aún no tiene check-out, **el sistema responde siempre `404 SETTLEMENT_NOT_FOUND`, jamás 403**, para no confirmar la existencia de reservas ajenas [NFR-003, SC-002].
   - El contrato define una respuesta de liquidación individual. Para la consulta OTA, `roomId` es opcional y no se define una respuesta de colección para reservas multihabitación.
4. **Flujo cuando la Liquidación `Final` EXISTE**:
   - Se devuelve el desglose almacenado tal cual fue generado por 007, sin recalcular [SPEC FR-002, FR-004, BR-001].
   - `settlementType = "FINAL"`. La fila conserva `stayId` como identificador UUID independiente y único (`UNIQUE(stay_id)`); no se deriva de `reservationRef` ni de `roomId`.
   - Se consulta `invoice` por `settlement_id`. Si ya fue emitida por 006, se adjunta el objeto `invoice` con su IVA. Si no ha sido emitida aún, se devuelve `invoice: null` [SPEC FR-002, FR-003].
   - El desglose de liquidación (`lodgingAmount`, `otaCommissionAmount`, `netIncome`) **nunca incluye IVA** [SPEC FR-002].
5. **Flujo cuando la Liquidación `Final` NO EXISTE**:
   - **Para OTA**: responde `404 SETTLEMENT_NOT_FOUND` explícito, sin registros vacíos ni valores en cero [SPEC FR-005, BR-004, SC-003].
   - **Para Módulo 1**: calcula la **liquidación informativa** en memoria (< 800 ms) usando `SettlementCalculator` (de 007), la reserva viva de M2 y la cotización guardada en M3 [SPEC FR-009, SC-006].
   - `settlementType = "INFORMATIVE"` e `invoice: null`.
   - **No se persiste nada en base de datos** [SPEC FR-011, BR-005, SC-007].
6. **Privacidad**: Nunca se exponen datos migratorios (SIRE) ni información personal del huésped [SPEC FR-007, NFR-004].
7. **Transacciones, Concurrencia y Ventana de Consistencia Asíncrona**:
   - Las consultas se ejecutan bajo transacciones `READ ONLY` con nivel de aislamiento `READ COMMITTED` en PostgreSQL [BASE]. Una consulta ejecutada en concurrencia durante el guardado del check-out devuelve de forma atómica `FINAL` o `INFORMATIVE`, nunca un estado parcial o lectura sucia.
   - **Consistencia asíncrona**: cada consulta refleja el estado persistido al momento de lectura. Antes de que 007 persista la liquidación se responde `INFORMATIVE`; después, `FINAL`. La respuesta informativa conserva los importes de la cotización y no se persiste.
   - **Flujo verificado en Módulo 1**: `Modulo1/plan-registrar-check-out.md` confirma que M1 consulta la liquidación en los pasos 2 (Liquidación) y 3 (Revisión) antes de confirmar la salida física, y publica el evento `habitacion.checkout` en el paso 5 sin realizar re-consultas posteriores. En el paso 3 se muestran exclusivamente: valor del hospedaje, comisión e ingreso neto (`netIncome = accommodationAmount - commission`), manteniendo `invoice: null` (sin factura, IVA ni total final).

---

## 5. Respuesta Exitosa Canónica

`200 OK`

### Headers de Respuesta

| Header | Valor | Descripción | Origen |
|---|---|---|---|
| `Content-Type` | `application/json` | Formato de la carga útil JSON. | [CONV] |
| `Cache-Control` | `no-store` | Previene el almacenamiento en caché de respuestas financieras (esperado por M1 y coherente con FR-008 y SC-005). | [SPEC FR-008, SC-005; PLAN] |

| Campo | Tipo | Requerido | Descripción | Origen |
|---|---|---|---|---|
| `settlementType` | `"FINAL"` \| `"INFORMATIVE"` | Sí | Identificador explícito de estado de liquidación. | [SPEC FR-010, HU3] |
| `reservationRef` | string | Sí | Referencia contractual de la reserva. | [SPEC FR-001] |
| `roomId` | UUID | Sí | Habitación física liquidada. | [SPEC FR-001] |
| `categoryRoom` | string | Sí | Categoría de habitación validada. | [SPEC FR-001] [BASE] |
| `channel` | `"DIRECT"` \| `"OTA"` | Sí | Canal de origen obtenido de Módulo 2. | [SPEC FR-002] |
| `otaId` | string \| null | Condicional | Identificador de la OTA (ej. `booking`), solo si `channel = OTA`. | [SPEC FR-002] |
| `currency` | string | Sí | Moneda contractual (`"COP"`). | [BASE] |
| `breakdown` | object | Sí | Desglose financiero sin impuestos. | [SPEC FR-002] |
| `breakdown.lodgingAmount` | string decimal | Sí | Valor bruto de hospedaje (cotización guardada). | [SPEC FR-002, BR-004] [CONV] |
| `breakdown.otaCommissionPercentage` | string decimal \| null | Condicional | Porcentaje de comisión (0.00 a 100.00); `null` en canal directo. | [SPEC FR-002] [CONV] |
| `breakdown.otaCommissionAmount` | string decimal | Sí | Monto descontado por comisión (`"0.00"` en directo). | [SPEC FR-002] [CONV] |
| `breakdown.netIncome` | string decimal | Sí | Ingreso neto (`lodgingAmount - otaCommissionAmount`). | [SPEC FR-002] |
| `invoice` | object \| null | Sí | Factura fiscal definitiva asociada; `null` si no ha sido emitida o en informativa. | [SPEC FR-003] |
| `invoice.invoiceId` | UUID | Sí (si `invoice` != null) | Identificador de la factura en M3. | [BASE] |
| `invoice.invoiceNumber` | integer | Sí (si `invoice` != null) | Número consecutivo oficial asignado a la factura. | [BASE] |
| `invoice.issuedAt` | datetime ISO 8601 | Sí (si `invoice` != null) | Fecha y hora de emisión (con zona horaria). | [BASE] |
| `invoice.vatRateApplied` | string decimal | Sí (si `invoice` != null) | Porcentaje de IVA aplicado al emitir (ej. `"19.00"`). | [BASE] |
| `invoice.vatAmount` | string decimal | Sí (si `invoice` != null) | Monto del IVA calculado sobre el hospedaje. | [BASE] |
| `invoice.totalAmount` | string decimal | Sí (si `invoice` != null) | Total facturado al cliente (`lodgingAmount + vatAmount`). | [BASE] |
| `invoice.status` | string | Sí (si `invoice` != null) | Siempre `"ISSUED"`. | [BASE] |
| `generatedAt` | datetime ISO 8601 | Sí | Momento de generación o cálculo (con zona horaria). | [BASE] |

---

### Ejemplo 1: Liquidación `FINAL` con Factura Definitiva (Canal OTA)

```json
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
```

### Ejemplo 2: Liquidación `INFORMATIVE` (Consultada por M1 Antes del Check-Out)

```json
{
  "settlementType": "INFORMATIVE",
  "reservationRef": "RES-000789",
  "roomId": "9c8b7a6f-5e4d-3c2b-1a0f-123456789abc",
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

---

## 6. Errores

Todos los errores siguen el estándar `ApiError` del plan base: `{ errorCode, message, timestamp, path }` [BASE].

| HTTP | `errorCode` | Cuándo Ocurre | Destinatario | Reintentable | Origen |
|---|---|---|---|---|---|
| **400** | `INVALID_QUERY_PARAMS` | Parámetros mal formados, UUID inválido o campos obligatorios inválidos. | M1 / OTA | No | [PLAN] [CONV] |
| **401** | `UNAUTHENTICATED` | Petición externa sin token JWT o con token inválido/expirado. | Externo | No | [BASE] |
| **403** | `FORBIDDEN` | Token con rol no autorizado (distinto a `OTA`). | Externo | No | [BASE] |
| **404** | `SETTLEMENT_NOT_FOUND` | OTA consulta reserva antes de check-out **O** reserva ajena/directa (anti-enumeración). | OTA | No | [SPEC FR-005, SC-003; PLAN] |
| **404** | `RESERVATION_NOT_FOUND` | Módulo 1 consulta informativa y M2 responde 404 para `reservationRef`. | M1 | No | [SPEC FR-012, SC-009] |
| **404** | `QUOTE_NOT_FOUND` | Módulo 1 consulta informativa y no existe cotización para `categoryRoom`. | M1 | No | [SPEC FR-012, SC-009] |
| **424** | `MODULE2_UNAVAILABLE` | Módulo 2 no está disponible durante la consulta informativa. | M1 | Sí | [BASE] |

---
