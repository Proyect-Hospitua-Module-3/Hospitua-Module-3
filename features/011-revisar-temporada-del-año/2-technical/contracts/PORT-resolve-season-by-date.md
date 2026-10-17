# Contrato de puerto interno: Resolver temporada por fecha

**Feature proveedora**: 011 Revisar temporada del año
**Consumidor**: Feature 005 Consultar tarifa dinámica
**Spec proveedor**: [revisar_temporada_del_año.md](../../1-functional/revisar_temporada_del_año.md)
**Plan proveedor**: [plan.md](../plan.md)
**Contrato de catálogo**: [PORT-get-season-rules.md](../../../009-modificar-precio-tarifa-segun-temporada/2-technical/contracts/PORT-get-season-rules.md)
**Plan base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)

**Etiquetas de origen**: `[SPEC]` proviene de la especificación funcional, `[BASE]` del plan técnico base, `[005]` de Consultar tarifa dinámica, `[009]` del contrato de catálogo/reglas y `[CONV]` es una convención de esta interfaz interna.

Es un puerto TypeScript dentro de `pricing`, no un endpoint de red. 011 es dueño de las asignaciones de fecha; 009 es dueño del catálogo/ajuste; 005 compone clasificación, regla y tarifa base.

## 1. Propósito

Devolver la única temporada efectiva para una fecha civil del hotel, con origen de clasificación y revisión del calendario, para que 005 aplique la misma clasificación administrativa que muestra el calendario [SPEC FR-006, BR-004] [005].

## 2. Invocación

```ts
// src/domain/ports/in/resolve-season-by-date.use-case.ts
resolve(query: ResolveSeasonByDateQuery): Promise<SeasonClassification>

export interface ResolveSeasonByDateQuery {
  date: string;  // YYYY-MM-DD, fecha civil
  asOf: Date;    // instante UTC común a calendario (011) y reglas (009)
}
```

`date` es fecha de calendario, no timestamp y no se convierte por offset UTC. `asOf` lo captura el caso de uso de 005 una vez por operación y lo reutiliza tanto para obtener las reglas de 009 como para la resolución de todas las noches de la estancia [CONV].

## 3. Resultado exitoso

```ts
export interface SeasonClassification {
  date: string;
  seasonId: string;
  source: 'BASE' | 'EXCEPTION' | 'DEFAULT';
  entryId: string | null;
  calendarYear: number;
  revision: number;              // 0 si aún no existe una revisión publicada
  calendarEffectiveAt: string | null;
  entryOwnerYear: number | null; // año propietario de la entrada aplicada; null para DEFAULT
  entryOwnerRevision: number | null;
  entryOwnerEffectiveAt: string | null;
}
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---:|---|
| `date` | date `YYYY-MM-DD` | Sí | Fecha resuelta |
| `seasonId` | UUID/string estable | Sí | Referencia al catálogo 009 |
| `source` | `BASE` \| `EXCEPTION` \| `DEFAULT` | Sí | Regla aplicada para clasificar la fecha |
| `entryId` | UUID \| `null` | Sí | Entrada base/excepción; `null` si se usa default |
| `calendarYear` | integer | Sí | Año civil del calendario consultado |
| `revision` | integer | Sí | Número de revisión del año efectiva en `asOf`; `0` representa calendario aún no publicado |
| `calendarEffectiveAt` | datetime ISO 8601 UTC \| `null` | Sí | Vigencia de la revisión; `null` para revisión implícita `0` |
| `entryOwnerYear` | integer \| `null` | Sí | Año cuya revisión contiene la entrada aplicada; `null` si la clasificación es `DEFAULT` |
| `entryOwnerRevision` | integer \| `null` | Sí | Revisión propietaria de la entrada aplicada; `null` para `DEFAULT` |
| `entryOwnerEffectiveAt` | datetime ISO 8601 UTC \| `null` | Sí | Vigencia de la revisión propietaria; `null` para `DEFAULT` |

El puerto devuelve el `seasonId`, no duplica nombre/color/porcentaje. 005 localiza ese ID en la instantánea obtenida de 009, donde obtiene ajuste, nombre/color y `defaultSeasonId` [009].

### Ejemplo

```json
{
  "date": "2026-07-04",
  "seasonId": "a2a61e70-57e3-41c4-9dc1-4b124a21a441",
  "source": "EXCEPTION",
  "entryId": "27c4d2a6-f4ec-42db-b143-8c817bdb8e98",
  "calendarYear": 2026,
  "revision": 5,
  "calendarEffectiveAt": "2026-10-09T21:55:00.000Z",
  "entryOwnerYear": 2026,
  "entryOwnerRevision": 5,
  "entryOwnerEffectiveAt": "2026-10-09T21:55:00.000Z"
}
```

Si la fecha es `2027-01-05` y está cubierta por una entrada BASE de la revisión 3 de 2026, `calendarYear`/`revision` identifican la revisión de 2027 (o `0` si aún no existe) y los campos `entryOwner*` identifican el año 2026 y su revisión 3.

## 4. Reglas de resolución

Para una fecha del año civil `N`, selecciona en una sola transacción las revisiones efectivas a `asOf` de `N` y `N-1`:

1. Si existe una única excepción para la fecha en la revisión de `N`, devuelve esa temporada con `source = EXCEPTION`.
2. De lo contrario, busca rangos BASE que contengan la fecha tanto en la revisión de `N` como en la revisión de `N-1`; los BASE del año anterior pueden cruzar el 31 de diciembre. Si existe exactamente uno, devuelve su temporada con `source = BASE`.
3. Si no existe asignación, devuelve el `defaultSeasonId` de 009, con `source = DEFAULT` y `entryId = null` [SPEC FR-003, BR-003].
4. Si se detectan varias excepciones para la fecha, rangos BASE solapados entre revisiones anuales o una temporada referenciada que falta del snapshot 009, falla explícitamente. No devuelve respuesta parcial ni decide por ID/orden de inserción [SPEC FR-004, BR-004, BR-005].
5. `calendarYear`, `revision` y `calendarEffectiveAt` identifican la revisión efectiva de `N`. Cuando se aplica una entrada, `entryOwnerYear`, `entryOwnerRevision` y `entryOwnerEffectiveAt` identifican la revisión propietaria de esa entrada; para `DEFAULT` son `null`. Si no existe revisión publicada para `N`, `revision = 0` y `calendarEffectiveAt = null`, pero aun así se consulta `N-1` por una entrada BASE heredada.

Para un rango de noches que cruza años, el consumidor llama a este puerto para cada fecha con el mismo `asOf`. Cada fecha puede seleccionar su propia revisión anual; no se promedia ni se elige un calendario global.

## 5. Consistencia y errores

- La lectura toma la revisión y todas sus entradas en una misma transacción de solo lectura/snapshot.
- `asOf` selecciona `effectiveAt <= asOf`; publicación posterior no entra en una consulta ya iniciada. La siguiente operación captura otro instante y puede ver la nueva revisión.
- La fecha inválida o el instante `asOf` inválido se rechazan como `INVALID_CALENDAR_RANGE`.
- Calendario inconsistente: `SeasonCalendarInconsistentError` (`SEASON_CALENDAR_INCONSISTENT`); la tarifa dinámica completa falla sin resultados parciales.
- Referencia `seasonId` ausente en el snapshot del catálogo 009: `SeasonCalendarInconsistentError` (`SEASON_CALENDAR_INCONSISTENT`); no se usa default como fallback para una referencia rota.
- Fallo transitorio de persistencia: `SeasonCalendarUnavailableError` (`SEASON_CALENDAR_UNAVAILABLE`); el consumidor puede reintentar la operación completa, nunca reutilizar una respuesta supuesta.

## 6. Garantías para 005

- **Fuente canónica**: usa la misma clasificación que revisa el Administrador [SPEC FR-006, SC-003].
- **Períodos entre años**: una entrada BASE pertenece al año de su fecha de inicio; la resolución de una fecha del año siguiente también considera la revisión propietaria del año anterior.
- **Determinismo**: mismo `date`, `asOf` y revisiones válidas producen el mismo `seasonId` [SPEC NFR-003].
- **Default explícito**: cualquier fecha no clasificada se identifica como default regular, no como clasificación ausente indefinida [SPEC FR-003, SC-004].
- **Excepción explícita**: la excepción puntual prevalece únicamente sobre la clasificación base de la misma fecha [SPEC FR-002, BR-002].
- **Sin mezcla de versiones**: 005 pasa el mismo `asOf` a este puerto y al puerto 009 para unir temporada y porcentaje coherentes.
- **Sin retroactividad de snapshots**: una cotización ya guardada no invoca de nuevo este puerto al liquidarse [BASE, SPEC NFR-004].
