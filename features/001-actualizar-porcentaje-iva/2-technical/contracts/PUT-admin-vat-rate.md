# Contrato REST administrativo: Actualizar porcentaje de IVA

**Feature**: 001 Actualizar porcentaje de IVA — HU1, HU2
**Spec**: [actualizar_porcentaje_iva.md](../../1-functional/actualizar_porcentaje_iva.md)
**Plan**: [plan.md](../plan.md)
**Proyecto base**: [plan-tecnico-base.md](../../../../docs/plan-tecnico-base.md)
**Estado**: Operación que **escribe**; ruta `PUT /admin/vat-rate` según el Plan Base

**Etiquetas de origen**:
- `[SPEC]`: Definido en la especificación funcional de la feature (`actualizar_porcentaje_iva.md`).
- `[PLAN]`: Decisión técnica del plan de esta feature (`features/001-actualizar-porcentaje-iva/2-technical/plan.md`).
- `[BASE]`: Definido en la plataforma compartida (`docs/plan-tecnico-base.md`).
- `[CONV]`: Convención técnica adoptada para este contrato.

---

## 1. Propósito

El **Administrador** registra o actualiza el porcentaje de IVA vigente que `Generar factura final` (006) aplica al hospedaje en el momento de emitir cada factura [SPEC FR-001; BASE].

- **No existe un valor inicial**: mientras el Administrador no registre el primer porcentaje, el sistema no emite facturas ni asume uno por defecto. El primer registro y las actualizaciones siguientes usan esta misma operación [SPEC FR-003, casos límite] [PLAN].
- **Una actualización nunca altera facturas ya emitidas**: 006 guarda el porcentaje aplicado en la propia factura (`vat_rate_applied`) y no mantiene ninguna referencia viva al porcentaje vigente [SPEC FR-004, BR-002] [PLAN].

Esta feature no expone ninguna consulta HTTP del porcentaje vigente. La lectura la hace 006 por un puerto interno, documentado en [`PORT-get-current-vat-rate.md`](../../../006-generar-factura-final/2-technical/contracts/PORT-get-current-vat-rate.md) (de 006), que 001 implementa sin modificarlo [PLAN].

---

## 2. Petición

`PUT /admin/vat-rate` [BASE]

### Autenticación y autorización

Requiere un JWT válido con `role = Administrador`, emitido por Módulo 3 [SPEC FR-006, BR-001] [BASE]. Es una operación administrativa: no acepta llamadas internas sin token de otros módulos ni de una OTA.

La autorización la resuelve el Guard del controller (`@Roles("Administrador")`); el caso de uso recibe el identificador del actor para dejar la trazabilidad, no para decidir el permiso [PLAN].

### Headers

| Header | Obligatorio | Valor | Descripción | Origen |
|---|---|---|---|---|
| `Authorization` | Sí | `Bearer <token>` | JWT de usuario con `role = Administrador`. | [BASE] |
| `Content-Type` | Sí | `application/json` | Formato del cuerpo. | [CONV] |
| `Accept` | No | `application/json` | Tipo MIME esperado. | [CONV] |
| `X-Correlation-Id` | No | string | Identificador de trazabilidad distribuida; si no llega, Módulo 3 lo genera. | [BASE] |

### Cuerpo de la Petición

| Campo | Tipo | Obligatorio | Descripción | Origen |
|---|---|---|---|---|
| `value` | string decimal | Sí | Nuevo porcentaje de IVA. Entre `0` y `100`, ambos inclusive, con **a lo sumo 2 decimales** (por ejemplo `"19.00"`, `"5"`, `"0"`, `"100"`). | [SPEC FR-002, NFR-004] [PLAN] |

El valor viaja como **string decimal exacto**, nunca como `number` de coma flotante [PLAN]. Si llega como número JSON, se rechaza con `400 INVALID_VAT_RATE` [CONV].

El Administrador no envía quién ni cuándo: el actor sale del token (`sub`) y la hora la fija la base de datos [SPEC FR-005] [PLAN].

### Ejemplos de Petición

#### Actualización válida
```http
PUT /admin/vat-rate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
Accept: application/json

{
  "value": "19.00"
}
```

#### Valor inválido (fuera de rango)
```http
PUT /admin/vat-rate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "value": "120.00"
}
```

---

## 3. Reglas de Procesamiento

1. **Autorización**: sin token → `401 UNAUTHENTICATED`; token válido con rol distinto de `Administrador` (por ejemplo `OTA`) → `403 FORBIDDEN`. No se toca ningún dato [SPEC FR-006, SC-005] [PLAN].
2. **Validación del valor**: debe ser un decimal exacto entre `0` y `100` inclusive, con a lo sumo 2 decimales. Si no, `400 INVALID_VAT_RATE`, se informa el motivo y **el porcentaje vigente anterior queda sin modificar** [SPEC FR-002, SC-003] [PLAN].
3. **Todo en una sola transacción**, que hace en este orden [PLAN]:
   - toma un bloqueo (`pg_advisory_xact_lock`) que serializa todas las actualizaciones, incluido el primer registro cuando la tabla aún está vacía;
   - lee el valor vigente actual, que puede no existir;
   - guarda el nuevo valor como el único vigente (fila única de `vat_rate`);
   - inserta una entrada en el historial `vat_rate_history` con `value_before` (nulo en el primer registro), `value_after`, `changed_by` y `changed_at`.
4. **Trazabilidad obligatoria**: si la inserción en el historial falla por cualquier motivo, la transacción completa se revierte y la actualización se reporta como fallida. No existe un cambio del porcentaje vigente sin su registro [SPEC FR-005, NFR-001, casos límite] [PLAN].
5. **Hora verificable**: `updated_at` y `changed_at` son la hora de la base de datos (`now()`), no la del servidor de aplicación [SPEC NFR-001] [PLAN].
6. **Un único porcentaje vigente**: una vez configurado, existe en todo momento exactamente uno [SPEC FR-003, BR-003].
7. **Actualizaciones concurrentes**: se ejecutan una detrás de otra. Cada una termina con `200` y el vigente final es el de la última que se confirma; nunca queda un estado mixto ni dos porcentajes vigentes. El historial refleja una secuencia coherente: el `value_before` de la segunda es el `value_after` de la primera. No se rechaza la segunda escritura [SPEC FR-007, NFR-002] [PLAN].
8. **Valor idéntico al vigente**: se acepta como operación válida y **sí** genera una entrada de historial, porque toda actualización exitosa queda trazada [SPEC casos límite, FR-005] [PLAN].
9. **Disponibilidad inmediata**: el nuevo porcentaje rige desde que la transacción se confirma; no hay caché con vida propia, así que la siguiente lectura por `GetCurrentVatRateUseCase` ya lo devuelve [SPEC NFR-003] [PLAN].
10. **No toca facturas**: esta operación solo escribe en `vat_rate` y `vat_rate_history`; no lee ni modifica ninguna factura ni liquidación [SPEC FR-004, BR-002, SC-002] [PLAN].

---

## 4. Respuesta Exitosa

`200 OK`

| Campo | Tipo | Requerido | Descripción | Origen |
|---|---|---|---|---|
| `value` | string decimal | Sí | Porcentaje de IVA que quedó vigente, con 2 decimales. | [PLAN] |
| `updatedBy` | string | Sí | Identificador del Administrador que hizo el cambio (el `sub` del token). | [SPEC FR-005] [PLAN] |
| `updatedAt` | datetime ISO 8601 | Sí | Hora del cambio, tomada de la base de datos (con zona horaria). | [SPEC FR-005, NFR-001] [PLAN] |

El valor se devuelve como string decimal para no perder exactitud [PLAN] [CONV].

### Ejemplo

```json
{
  "value": "19.00",
  "updatedBy": "f2d3b4a5-6c7d-4e8f-9012-3456789abcde",
  "updatedAt": "2026-10-10T14:32:05Z"
}
```

---

## 5. Errores

Todos los errores siguen el estándar `ApiError` del plan base: `{ errorCode, message, timestamp, path }` [BASE]. Ninguna respuesta de este endpoint es 5xx [BASE]. En todos los casos de error **el porcentaje vigente anterior queda sin modificar** [SPEC FR-002].

| HTTP | `errorCode` | Cuándo ocurre | Reintentable | Origen |
|---|---|---|---|---|
| **400** | `INVALID_VAT_RATE` | `value` ausente, negativo, mayor a 100, no numérico, con más de 2 decimales o enviado como número JSON. | No | [SPEC FR-002, SC-003] [PLAN] |
| **401** | `UNAUTHENTICATED` | Sin token, o token inválido o expirado. | No | [PLAN] [BASE] |
| **403** | `FORBIDDEN` | Token válido con rol distinto de `Administrador` (por ejemplo `OTA`). | No | [SPEC FR-006, SC-005] [PLAN] |
| **422** | `UNEXPECTED_ERROR` | Error inesperado, incluido el fallo al escribir el historial (la transacción se revierte). | Sí (ver nota) | [PLAN] |

> **Reintentos**: como una actualización a un valor idéntico también se acepta y deja su propia entrada de historial, reintentar una solicitud cuyo resultado no se conoce no daña el porcentaje vigente, pero puede dejar dos entradas de historial con el mismo valor [PLAN].

### Ejemplo de error

```json
{
  "errorCode": "INVALID_VAT_RATE",
  "message": "El porcentaje de IVA debe estar entre 0 y 100, con a lo sumo 2 decimales.",
  "timestamp": "2026-10-10T14:33:10Z",
  "path": "/admin/vat-rate"
}
```

---

## 6. Garantías

- **Solo el Administrador**: cualquier otro actor es rechazado sin efecto alguno [SPEC FR-006, BR-001, SC-005].
- **Nunca un valor inválido**: un porcentaje fuera de rango o mal formado jamás queda registrado [SPEC FR-002, SC-003].
- **Atómico y trazado**: el cambio del vigente y su entrada de historial se confirman o se revierten juntos; cada actualización exitosa queda con su responsable y su hora [SPEC FR-005, SC-004, NFR-001].
- **Un solo vigente, siempre**: ni siquiera con actualizaciones simultáneas hay dos porcentajes vigentes ni un estado ambiguo [SPEC FR-003, FR-007, NFR-002].
- **Facturas intactas**: una factura ya emitida conserva su porcentaje, su IVA y su total originales, sin recalcularse [SPEC FR-004, BR-002, SC-002].
- **Facturas nuevas con el valor nuevo**: toda factura emitida después de una actualización aplica el nuevo porcentaje [SPEC SC-001].
- **Sin valor supuesto**: sin un primer registro, 006 no emite facturas; nunca se usa cero ni un valor por defecto [SPEC FR-003, BR-003].
- Un cambio en el campo `value`, en sus límites o en la forma de la respuesta requiere coordinar con el Administrador que lo usa y actualizar `test/e2e/vat-rate.e2e-spec.ts` [PLAN].
