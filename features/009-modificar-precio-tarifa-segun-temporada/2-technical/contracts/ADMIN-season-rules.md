# Contrato REST administrativo: Gestionar temporadas y reglas de precio

**Feature**: 009 Modificar precio tarifa según temporada — HU1, HU3
**Spec**: [modificar_precio_tarifa_segun_temporada.md](../../1-functional/modificar_precio_tarifa_segun_temporada.md)
**Plan**: [plan.md](../plan.md)

**Etiquetas de origen**: `[SPEC]` proviene de la especificación funcional, `[BASE]` del plan técnico base, `[PLAN]` del plan técnico 009 y `[CONV]` es una convención técnica de este contrato.

El Administrador mantiene el catálogo y los ajustes por temporada en Módulo 3. Este contrato detalla las operaciones `GET`, `POST`, `PUT` y `DELETE` de `/admin/season-rules` definidas en la matriz del plan base y requeridas por FR-001. No administra las fechas de calendario ni sus excepciones, que son propiedad de 011.

## 1. Propósito

Crear temporadas con nombre/color, modificar su ajuste, revisar la regla vigente y retirar (borrado lógico) temporadas no protegidas ni asignadas en una revisión activa del calendario. Un cambio exitoso registra actor, hora, valor anterior y nuevo; la regla nueva se usa en cálculos futuros sin cambiar cotizaciones previas [SPEC FR-001, FR-003, FR-004, FR-006].

## 2. Autenticación y rutas

Todas las rutas requieren un token JWT válido con `role = Administrador`. No se aceptan llamadas sin token de otros módulos; son operaciones administrativas [SPEC FR-005] [BASE].

| Método y ruta | Propósito |
|---|---|
| `GET /admin/season-rules` | Obtener catálogo y reglas vigentes |
| `POST /admin/season-rules` | Crear una temporada y regla inicial |
| `PUT /admin/season-rules/{seasonId}` | Modificar nombre, color y/o ajuste |
| `DELETE /admin/season-rules/{seasonId}` | Retirar (borrado lógico) una temporada permitida y no asignada en una revisión activa del calendario |

Headers:

| Header | Requerido | Descripción |
|---|---:|---|
| `Authorization` | Sí | `Bearer` con JWT de usuario con rol `Administrador` |
| `Accept` | No | `application/json` |
| `Content-Type` | Sí en `POST`/`PUT` | `application/json` |
| `X-Correlation-Id` | No | Se genera si no llega; se propaga a logs |

### Campos de temporada

| Campo | Tipo | Requerido | Validación |
|---|---|---:|---|
| `seasonId` | UUID/string estable | Respuesta | Identidad usada por calendario 011; no cambia al renombrar |
| `name` | string | Sí al crear; opcional al actualizar | No vacío tras trim; único sin distinguir mayúsculas; el default conserva el nombre reservado `Regular` |
| `color` | string `#RRGGBB` | Sí al crear; opcional al actualizar | Hexadecimal RGB de seis dígitos |
| `adjustmentPercent` | decimal string | Sí al crear; opcional al actualizar | Porcentaje firmado entre `-100.00` y `100.00`, hasta dos decimales |
| `isDefault` | boolean | Respuesta, no modificable | Exactamente una temporada es la predeterminada; su ajuste sigue el rango firmado y puede ser distinto de cero |
| `version` | integer | Respuesta | Versión de la temporada; se incrementa con cada cambio efectivo de nombre, color o ajuste |
| `expectedVersion` | integer | No, solo en `PUT` | Control optimista: si se envía y no coincide con `version` vigente, la actualización se rechaza con `409 SEASON_RULE_CONFLICT` |
| `validFrom` | datetime ISO 8601 UTC | Respuesta | Inicio de vigencia de la versión de ajuste |
| `updatedBy` | UUID/string | Respuesta | Identificador del Administrador autenticado |
| `updatedAt` | datetime ISO 8601 UTC | Respuesta | Hora de base de datos del último cambio efectivo |

Se recomienda no aceptar `seasonId`, `isDefault`, `version`, `updatedBy`, `validFrom` ni metadatos de auditoría en los cuerpos de escritura: son generados o protegidos por el servidor.

## 3. Peticiones

### Consultar

```http
GET /admin/season-rules
Authorization: [JWT de Administrador]
Accept: application/json
```

No tiene query params; retorna todas las temporadas no retiradas, ordenadas por nombre normalizado e ID como desempate.

### Crear

```http
POST /admin/season-rules
Authorization: [JWT de Administrador]
Content-Type: application/json

{
  "name": "Festival",
  "color": "#C0392B",
  "adjustmentPercent": "25.00"
}
```

El servidor crea un ID estable y la primera versión de la regla. La temporada default existe por migración y no se crea por esta ruta.

### Actualizar

```http
PUT /admin/season-rules/5dca644e-7a6a-4d2e-a9a5-1943188c4710
Authorization: [JWT de Administrador]
Content-Type: application/json

{
  "expectedVersion": 3,
  "adjustmentPercent": "-10.00"
}
```

Se permiten cambios parciales de los campos `name`, `color` y `adjustmentPercent`; un objeto sin ninguno de ellos se rechaza. Se usa `PUT` con semántica de actualización parcial porque es el verbo acordado en la matriz del plan base. `expectedVersion` es opcional: si se envía y no coincide con la versión vigente, se responde `409 SEASON_RULE_CONFLICT`; si se omite, el cambio se aplica sobre la versión vigente. Las modificaciones de una misma temporada se serializan, así que nunca quedan dos versiones vigentes. `PUT` con valores idénticos a los actuales se acepta como no-op y no genera historial redundante. Para la temporada default no se permite cambiar el nombre reservado `Regular`, ni eliminarla o renombrarla; su porcentaje puede cambiar dentro del rango firmado y el color puede personalizarse.

### Eliminar

```http
DELETE /admin/season-rules/5dca644e-7a6a-4d2e-a9a5-1943188c4710
Authorization: [JWT de Administrador]
```

El retiro es lógico: la temporada deja de aparecer en el catálogo, no se puede modificar ni asignar en el calendario y su nombre queda libre, pero se conservan su historial de reglas y las revisiones históricas del calendario que la usaron. La temporada default no puede retirarse. Si una entrada o excepción de una **revisión activa** del calendario 011 (de cualquier año) referencia `seasonId`, se devuelve conflicto; las revisiones históricas no bloquean el retiro. El servidor no borra ni reclasifica las fechas implícitamente.

## 4. Respuestas exitosas

### `GET 200 OK`

```json
{
  "asOf": "2026-10-09T20:15:00.000Z",
  "seasons": [
    {
      "seasonId": "00000000-0000-4000-8000-000000000001",
      "name": "Regular",
      "color": "#808080",
      "adjustmentPercent": "-2.50",
      "isDefault": true,
      "version": 2,
      "validFrom": "2026-01-01T00:00:00.000Z",
      "updatedBy": "f2d3b4a5-6c7d-4e8f-9012-3456789abcde",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "seasonId": "5dca644e-7a6a-4d2e-a9a5-1943188c4710",
      "name": "Festival",
      "color": "#C0392B",
      "adjustmentPercent": "25.00",
      "isDefault": false,
      "version": 1,
      "validFrom": "2026-10-09T20:12:00.000Z",
      "updatedBy": "f2d3b4a5-6c7d-4e8f-9012-3456789abcde",
      "updatedAt": "2026-10-09T20:12:00.000Z"
    }
  ]
}
```

### `POST 201 Created` / `PUT 200 OK`

Devuelven el objeto de temporada y regla vigente correspondiente, con el mismo esquema que cada elemento de `seasons[]`. La respuesta usa decimal string para evitar pérdida de precisión.

### `DELETE 204 No Content`

La temporada se retiró del catálogo; la respuesta no tiene contenido.

## 5. Errores

El cuerpo de error sigue el formato compartido `ApiError`: `{ errorCode, message, timestamp, path }` [BASE].

| HTTP | `errorCode` | Cuándo ocurre | Reintentable |
|---:|---|---|---:|
| 400 | `INVALID_SEASON` | Nombre/color malformado, nombre vacío o cuerpo sin campos | No |
| 400 | `INVALID_SEASON_ADJUSTMENT` | Valor no decimal, exceso de precisión o fuera de `-100.00..100.00` | No |
| 401 | `UNAUTHENTICATED` | JWT ausente, inválido o expirado | No |
| 403 | `FORBIDDEN` | JWT válido sin rol `Administrador` | No |
| 404 | `SEASON_NOT_FOUND` | `seasonId` inexistente o temporada ya retirada | No |
| 409 | `SEASON_NAME_CONFLICT` | El nombre normalizado ya lo usa otra temporada no retirada | No |
| 409 | `DEFAULT_SEASON_IMMUTABLE` | Se intenta retirar o renombrar el default | No |
| 409 | `SEASON_IN_USE` | Una entrada/excepción de una revisión activa del calendario referencia la temporada | No |
| 409 | `SEASON_RULE_CONFLICT` | `expectedVersion` no coincide con la versión vigente (otro Administrador la modificó) | No |
| 422 | `UNEXPECTED_ERROR` | Fallo inesperado de base de datos; el `ExceptionFilter` global registra el error con id de correlación y lo incluye en el mensaje; la transacción se revirtió | Sí |

Ejemplo:

```json
{
  "errorCode": "INVALID_SEASON_ADJUSTMENT",
  "message": "El ajuste debe ser un porcentaje decimal entre -100.00 y 100.00.",
  "timestamp": "2026-10-09T20:15:00Z",
  "path": "/admin/season-rules/5dca644e-7a6a-4d2e-a9a5-1943188c4710"
}
```

## 6. Garantías

- **Autorización**: solo el rol `Administrador` puede leer o modificar este recurso [SPEC FR-005, BR-001].
- **Atómico**: cambio vigente y fila de auditoría se confirman o revierten juntos [SPEC FR-003, FR-004, NFR-001].
- **Sin versiones simultáneas**: se conserva un único ajuste vigente por temporada y un historial de versiones no solapadas [SPEC FR-003, BR-005].
- **No retroactivo**: se conserva el ajuste anterior para trazabilidad; cotizaciones/materializaciones previas no se actualizan [SPEC FR-006, BR-004].
- **Sin cambio de base**: este endpoint solo administra ajuste/catálogo; nunca escribe o almacena la tarifa base de Módulo 1 [SPEC FR-009, BR-002].
- **No-op limpio**: solicitud idéntica se acepta sin registrar una versión redundante [SPEC casos límite].
- **Retiro sin pérdida de historial**: retirar una temporada nunca borra su historial de reglas ni las revisiones históricas del calendario que la referencian [SPEC FR-001, FR-004].
- **Default seguro**: la temporada `Regular` existe siempre, conserva su identidad/nombre, su regla sigue el rango firmado y no se retira ni renombra [SPEC FR-001, FR-007] [005].
