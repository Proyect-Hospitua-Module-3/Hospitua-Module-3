# Contrato REST administrativo: Revisar y publicar calendario de temporadas

**Feature**: 011 Revisar temporada del año — HU1, HU3
**Spec**: [revisar_temporada_del_año.md](../../1-functional/revisar_temporada_del_año.md)
**Plan**: [plan.md](../plan.md)

**Etiquetas de origen**: `[SPEC]` proviene de la especificación funcional, `[BASE]` del plan técnico base, `[009]` del contrato de catálogo/reglas de temporada, `[PLAN]` del plan técnico 011 y `[CONV]` es una convención técnica de este contrato.

Este contrato define la lectura administrativa de calendario y la publicación atómica de revisiones anuales. 011 administra fechas y referencias `seasonId`; 009 sigue siendo propietario del catálogo de temporadas (nombre/color) y sus reglas porcentuales. La ruta de escritura es la concreción técnica acordada para el alcance de 011.

## 1. Propósito

Revisar la temporada efectiva por fecha, mostrar huecos y excepciones, y reemplazar de forma atómica la configuración anual. Los períodos base no se solapan; una excepción puntual prevalece sobre una base; dos excepciones para la misma fecha son inválidas. Cada cambio queda asociado a una revisión, responsable e instante de vigencia [SPEC FR-001–FR-008, BR-002–BR-005].

## 2. Autenticación y rutas

Todas las rutas requieren un JWT válido con `role = Administrador`; sin token/incorrecto → `401`, otro rol → `403` [SPEC FR-005, BR-001] [BASE].

| Método y ruta | Uso |
|---|---|
| `GET /admin/season-calendar?year={YYYY}&from?={YYYY-MM-DD}&to?={YYYY-MM-DD}` | Consultar el calendario completo del año o una ventana |
| `PUT /admin/season-calendar/{year}` | Reemplazar/publicar la revisión completa del año |

Headers:

| Header | Obligatorio | Descripción |
|---|---:|---|
| `Authorization` | Sí | JWT de usuario Administrador |
| `Accept` | No | `application/json` |
| `Content-Type` | Sí para `PUT` | `application/json` |
| `X-Correlation-Id` | No | Si no llega, el servicio lo genera y lo incluye en logs |

### Query params de `GET`

| Parámetro | Tipo | Obligatorio | Validación |
|---|---|---:|---|
| `year` | integer `YYYY` | Sí | Año válido soportado por el calendario |
| `from` | date `YYYY-MM-DD` | No | Debe pertenecer a `year` |
| `to` | date `YYYY-MM-DD` | No | Debe pertenecer a `year`; con `from`, `from <= to` |
| `asOf` | datetime ISO 8601 UTC | No | Revisión efectiva en ese instante; por defecto hora DB actual |
| `revision` | integer | No | Selecciona una revisión histórica de ese año; mutuamente excluyente con `asOf` |

`from` y `to` se envían juntos o se omiten ambos. Al omitirlos se consulta el año completo. Un rango no puede cruzar de año; una consulta de varias noches que cruce años la compone 005 con una resolución por cada fecha. Si se omiten `revision` y `asOf`, se lee la revisión actualmente efectiva.

## 3. Cuerpo de `PUT`

`PUT /admin/season-calendar/{year}` crea una nueva revisión con la lista completa de clasificaciones para ese año. Si se omite un período o excepción de la revisión vigente, queda eliminado en la nueva versión. La revisión anterior permanece disponible para auditoría.

```json
{
  "expectedRevision": 4,
  "entries": [
    {
      "entryId": "e6cfa8ed-8b7f-4cb4-bbf8-0678180d1f91",
      "seasonId": "5dca644e-7a6a-4d2e-a9a5-1943188c4710",
      "kind": "BASE",
      "startDate": "2026-06-01",
      "endDate": "2026-08-31"
    },
    {
      "seasonId": "a2a61e70-57e3-41c4-9dc1-4b124a21a441",
      "kind": "EXCEPTION",
      "startDate": "2026-07-04",
      "endDate": "2026-07-04"
    }
  ]
}
```

| Campo | Tipo | Requerido | Descripción/validación |
|---|---|---:|---|
| Path `year` | integer `YYYY` | Sí | Año calendario que se publica |
| `expectedRevision` | integer \| `null` | No | Control optimista; si se envía debe coincidir con la revisión activa. `null` significa que se espera que aún no exista |
| `entries` | array | Sí | Conjunto completo de entradas; `[]` es válido y resuelve todas las fechas al default |
| `entries[].entryId` | UUID | No | Se conserva para entradas existentes; si no llega el sistema genera uno |
| `entries[].seasonId` | UUID/string | Sí | Debe existir en catálogo de 009 |
| `entries[].kind` | `BASE` \| `EXCEPTION` | Sí | Período base o excepción puntual |
| `entries[].startDate` | date `YYYY-MM-DD` | Sí | Inclusivo y dentro del año |
| `entries[].endDate` | date `YYYY-MM-DD` | Sí | Inclusivo; igual a `startDate` para excepción |

`changedBy`, revisión, fechas de vigencia y marcas temporales no se aceptan del cliente: se derivan del JWT y de la base de datos. No se aceptan `name`, `color` o `adjustmentPercent` en las entradas; esos campos pertenecen a 009.

## 4. Reglas de procesamiento

### `GET`

1. Autentica y autoriza Administrador antes de leer calendario.
2. Valida `year`, `from`, `to` y `asOf`; un rango inválido devuelve `400` sin resultado parcial.
3. Obtiene la revisión efectiva para el año e instante; si no hay ninguna publicada, retorna el calendario implícito vacío (`revision: 0`) y todas las fechas usan default. Una revisión histórica explícita inexistente sí devuelve `404`.
4. Combina las entradas con el catálogo de 009 para incluir nombre, color y ajuste efectivo de cada temporada.
5. Por fecha/rango solicitado, identifica `EXCEPTION` primero, luego `BASE`; si ninguna aplica, informa `DEFAULT` y la temporada regular.
6. Devuelve los conflictos que detecte en datos heredados con fecha/rango, entradas en conflicto y `blocking: true`; la revisión permanece visible para auditoría, pero no es consumible por el cálculo de tarifa.

### `PUT`

1. Autentica y autoriza antes de procesar.
2. Verifica año, forma del cuerpo, fechas civiles, rango dentro del año y `startDate <= endDate`.
3. Verifica en catálogo 009 que cada `seasonId` exista y que `expectedRevision` coincida con la revisión activa.
4. Valida el conjunto completo: los rangos `BASE` no se pueden solapar; `EXCEPTION` debe ser puntual; dos excepciones no pueden tener la misma fecha. Una excepción sí puede coincidir con un período base y lo sobrescribe.
5. Si alguna entrada/referencia/conflicto es inválido, rechaza todo el conjunto y conserva revisión activa e historial.
6. En una única transacción, crea la nueva revisión con número monotónico, `effectiveAt` de la base de datos, actor autenticado y todas las entradas; activa la nueva y conserva la anterior como histórica.
7. Un `expectedRevision` obsoleto produce `409 SEASON_CALENDAR_CONFLICT`; no se reintenta con una sobrescritura automática.

Las revisiones rigen cálculos iniciados con `asOf >= effectiveAt`. Una cotización persistida anteriormente no se recalcula ni se actualiza cuando cambia la clasificación [SPEC FR-008, NFR-004].

## 5. Respuestas exitosas

### `GET 200 OK`

```json
{
  "year": 2026,
  "asOf": "2026-10-09T22:00:00.000Z",
  "revision": 5,
  "effectiveAt": "2026-10-09T21:55:00.000Z",
  "changedBy": "f2d3b4a5-6c7d-4e8f-9012-3456789abcde",
  "changedAt": "2026-10-09T21:55:00.000Z",
  "defaultSeason": {
    "seasonId": "00000000-0000-4000-8000-000000000001",
    "name": "Regular",
    "color": "#808080",
    "adjustmentPercent": "0.00"
  },
  "entries": [
    {
      "entryId": "e6cfa8ed-8b7f-4cb4-bbf8-0678180d1f91",
      "kind": "BASE",
      "startDate": "2026-06-01",
      "endDate": "2026-08-31",
      "season": {
        "seasonId": "5dca644e-7a6a-4d2e-a9a5-1943188c4710",
        "name": "Verano",
        "color": "#C0392B",
        "adjustmentPercent": "25.00"
      }
    },
    {
      "entryId": "27c4d2a6-f4ec-42db-b143-8c817bdb8e98",
      "kind": "EXCEPTION",
      "startDate": "2026-07-04",
      "endDate": "2026-07-04",
      "season": {
        "seasonId": "a2a61e70-57e3-41c4-9dc1-4b124a21a441",
        "name": "Evento especial",
        "color": "#8E44AD",
        "adjustmentPercent": "50.00"
      }
    }
  ],
  "unclassifiedRanges": [
    { "from": "2026-01-01", "to": "2026-05-31", "resolvedAs": "DEFAULT" },
    { "from": "2026-09-01", "to": "2026-12-31", "resolvedAs": "DEFAULT" }
  ],
  "conflicts": []
}
```

`conflicts[]` tiene forma `{ code, blocking, dates, entryIds, message }`; cuando no hay conflictos es `[]`. Rangos no clasificados se devuelven compactados en secuencias contiguas, respetando la ventana consultada; no se crea una entrada persistida solo por usar default. Si se detectan datos heredados corruptos, `GET` los incluye con `blocking: true` para que el Administrador pueda revisarlos; el puerto de resolución para 005 devuelve error en vez de clasificación.

Si no existe revisión publicada y no se solicita una revisión histórica concreta, `GET` devuelve `200` con `revision: 0`, `effectiveAt`, `changedBy` y `changedAt` en `null`, `entries: []`, todo el rango consultado en `unclassifiedRanges` y la temporada default. `revision: 0` identifica el calendario implícito sin configuración, no una revisión persistida.

### `PUT 200 OK`

Devuelve los metadatos de la nueva revisión y el calendario efectivo: `year`, `revision`, `effectiveAt`, `changedBy`, `changedAt`, `entries[]` y `conflicts: []`. Los metadatos de catálogo se adjuntan como en `GET`.

## 6. Errores

Todos usan `{ errorCode, message, timestamp, path }` del `ApiError` compartido [BASE].

| HTTP | `errorCode` | Cuándo ocurre | Reintentable |
|---:|---|---|---:|
| 400 | `INVALID_CALENDAR_RANGE` | Año/fecha inválidos, fechas fuera del año, `from > to`, entrada no puntual marcada como excepción | No |
| 401 | `UNAUTHENTICATED` | JWT ausente/inválido/expirado | No |
| 403 | `FORBIDDEN` | JWT sin rol `Administrador` | No |
| 400 | `INVALID_CALENDAR_RANGE` | Se envían `revision` y `asOf` a la vez | No |
| 404 | `SEASON_CALENDAR_NOT_FOUND` | No existe la revisión histórica explícita solicitada | No |
| 409 | `OVERLAPPING_SEASON_CALENDAR` | Dos rangos base comparten al menos un día | No |
| 409 | `DUPLICATE_SEASON_EXCEPTION` | Más de una excepción para la misma fecha | No |
| 409 | `SEASON_CALENDAR_CONFLICT` | `expectedRevision` desactualizado o carrera concurrente | No |
| 422 | `SEASON_NOT_FOUND` | Un `seasonId` no existe en el catálogo de 009 | No |
| 503 | `SEASON_CALENDAR_UNAVAILABLE` | Fallo temporal al leer calendario/catálogo | Sí |
| 503 | `DATABASE_UNAVAILABLE` | Fallo temporal de escritura/lectura de PostgreSQL | Sí |

## 7. Garantías para quien llama

- **Autorización**: solo Administrador puede consultar o reemplazar el calendario [SPEC FR-005].
- **Clasificación única**: por fecha, el resultado válido es excepción, rango base o default; nunca hay elección implícita entre conflictos [SPEC FR-004, FR-006, BR-004].
- **Precedencia acotada**: una excepción puntual sobrescribe el rango base; dos excepciones para una fecha se rechazan [SPEC FR-002, BR-002, BR-005].
- **Default visible**: fechas no clasificadas usan el default regular y se señalan en la respuesta [SPEC FR-003, SC-001, SC-004].
- **Atómico/versionado**: todos los entries de una revisión se publican juntos; la revisión anterior no se sobrescribe [SPEC FR-008, NFR-004].
- **No retroactividad**: cotizaciones ya persistidas mantienen sus noches y precios [SPEC NFR-004] [BASE].
- **Identidad compartida**: IDs, nombres, colores y ajustes provienen del catálogo/contrato 009; no se crean categorías hardcodeadas [SPEC FR-002, BR-002].
- **Sin datos parciales**: si la entrada o la revisión es inconsistente, no se devuelve clasificación apta para cálculo y no se activa la revisión.
