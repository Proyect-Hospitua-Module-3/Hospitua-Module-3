# Contrato REST administrativo: Gestionar temporadas y reglas de precio

**Feature**: 009 Modificar precio tarifa según temporada — HU1, HU3
**Spec**: [modificar_precio_tarifa_segun_temporada.md](../../1-functional/modificar_precio_tarifa_segun_temporada.md)
**Plan**: [plan.md](../plan.md)

**Etiquetas de origen**: `[SPEC]` proviene de la especificación funcional, `[BASE]` del plan técnico base, `[PLAN]` del plan técnico 009 y `[CONV]` es una convención técnica de este contrato.

El Administrador mantiene el catálogo y los ajustes por temporada en Módulo 3. Este contrato concreta y amplía la entrada `GET/PUT /admin/season-rules` del plan base para cubrir creación y eliminación que requiere FR-001. No administra las fechas de calendario ni sus excepciones, que son propiedad de 011.

## 1. Propósito

Crear temporadas con nombre/color, modificar su ajuste, revisar la regla vigente y borrar temporadas no protegidas ni referenciadas. Un cambio exitoso registra actor, hora, valor anterior y nuevo; la regla nueva se usa en cálculos futuros sin cambiar cotizaciones previas [SPEC FR-001, FR-003, FR-004, FR-006].

## 2. Autenticación y rutas

Todas las rutas requieren un token JWT válido con `role = Administrador`. No se aceptan llamadas sin token de otros módulos; son operaciones administrativas [SPEC FR-005] [BASE].

| Método y ruta | Propósito |
|---|---|
| `GET /admin/season-rules` | Obtener catálogo y reglas vigentes |
| `POST /admin/season-rules` | Crear una temporada y regla inicial |
| `PUT /admin/season-rules/{seasonId}` | Modificar nombre, color y/o ajuste |
| `DELETE /admin/season-rules/{seasonId}` | Eliminar una temporada permitida y no referenciada |

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
| `isDefault` | boolean | Respuesta, no modificable | Exactamente una temporada es la predeterminada; ajuste siempre `0.00` |
| `validFrom` | datetime ISO 8601 UTC | Respuesta | Inicio de vigencia de la versión de ajuste |
| `updatedBy` | UUID/string | Respuesta | Identificador del Administrador autenticado |
| `updatedAt` | datetime ISO 8601 UTC | Respuesta | Hora de base de datos del último cambio efectivo |

Se recomienda no aceptar `seasonId`, `isDefault`, `updatedBy`, `validFrom` ni metadatos de auditoría en los cuerpos de escritura: son generados o protegidos por el servidor.

## 3. Peticiones

### Consultar

```http
GET /admin/season-rules
Authorization: [JWT de Administrador]
Accept: application/json
```

No tiene query params; retorna todas las temporadas ordenadas por nombre normalizado e ID como desempate.

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
  "adjustmentPercent": "-10.00"
}
```

Se permiten cambios parciales de los campos `name`, `color` y `adjustmentPercent`; un objeto vacío se rechaza. `PUT` con valores idénticos a los actuales se acepta como no-op y no genera historial redundante. Para la temporada default no se permite cambiar el nombre reservado `Regular` ni ajustar su porcentaje de `0.00`; el color puede personalizarse.

### Eliminar

```http
DELETE /admin/season-rules/5dca644e-7a6a-4d2e-a9a5-1943188c4710
Authorization: [JWT de Administrador]
```

La temporada default no puede borrarse. Si una entrada o excepción del calendario 011 referencia `seasonId`, se devuelve conflicto; el servidor no borra ni reclasifica las fechas implícitamente.

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
      "adjustmentPercent": "0.00",
      "isDefault": true,
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

La temporada se eliminó sin contenido de respuesta.

## 5. Errores

El cuerpo de error sigue el formato compartido `ApiError`: `{ errorCode, message, timestamp, path }` [BASE].

| HTTP | `errorCode` | Cuándo ocurre | Reintentable |
|---:|---|---|---:|
| 400 | `INVALID_SEASON` | Nombre/color malformado, nombre vacío o cuerpo sin campos | No |
| 400 | `INVALID_SEASON_ADJUSTMENT` | Valor no decimal, exceso de precisión o fuera de `-100.00..100.00` | No |
| 401 | `UNAUTHENTICATED` | JWT ausente, inválido o expirado | No |
| 403 | `FORBIDDEN` | JWT válido sin rol `Administrador` | No |
| 404 | `SEASON_NOT_FOUND` | `seasonId` inexistente | No |
| 409 | `SEASON_NAME_CONFLICT` | El nombre normalizado ya está en uso | No |
| 409 | `DEFAULT_SEASON_IMMUTABLE` | Se intenta eliminar el default o cambiar su ajuste neutral | No |
| 409 | `SEASON_IN_USE` | Una entrada/excepción de calendario referencia la temporada | No |
| 409 | `SEASON_RULE_CONFLICT` | Conflicto concurrente/temporal al actualizar | No |
| 503 | `DATABASE_UNAVAILABLE` | Base de datos no disponible; la transacción se revirtió | Sí |

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
- **Default seguro**: la temporada `Regular` existe siempre, conserva su identidad/nombre, su regla es neutra y no se elimina [SPEC FR-001, FR-007] [005].
