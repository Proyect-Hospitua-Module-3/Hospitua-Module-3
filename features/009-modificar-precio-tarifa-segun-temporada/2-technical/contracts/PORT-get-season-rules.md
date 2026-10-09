# Contrato de puerto interno: Consultar reglas de temporada efectivas

**Consumidores**: Feature 005 Consultar tarifa dinámica; Feature 011 Revisar temporada del año
**Proveedor**: Feature 009 Modificar precio tarifa según temporada
**Spec proveedor**: [modificar_precio_tarifa_segun_temporada.md](../../1-functional/modificar_precio_tarifa_segun_temporada.md)
**Plan proveedor**: [plan.md](../plan.md)
**Plan base**: [plan-tecnico-base.md](../../../docs/plan-tecnico-base.md)

**Etiquetas de origen**: `[SPEC]` proviene de la especificación funcional, `[BASE]` del plan técnico base, `[005]` de Consultar tarifa dinámica, `[011]` de Revisar temporada del año y `[CONV]` es una convención de interfaz interna.

Este es un puerto TypeScript dentro del bounded context `pricing`, no un endpoint HTTP ni una integración de red. 009 es dueño del catálogo y reglas; 005 lo usa para calcular precios y 011 para identificar etiquetas/colores. 009 no es dueño de las asignaciones por fecha del calendario.

## 1. Propósito

Entregar un snapshot consistente del catálogo y de la regla que estaba vigente en el instante de referencia, para que una consulta de tarifa dinámica use el ajuste correcto por noche y una vista administrativa pueda mostrar la etiqueta/color de cada temporada [SPEC FR-003, FR-006, FR-007] [005] [011].

## 2. Invocación

```ts
// src/domain/ports/in/get-effective-season-rules.use-case.ts
getAll(asOf: Date): Promise<EffectiveSeasonRules>
```

`asOf` es capturado una sola vez al comienzo de la operación consumidora, en UTC, y reutilizado para todas las noches de un rango. Así, un cambio concurrente no mezcla versiones dentro de una misma consulta. No se aceptan fechas inválidas ni se sustituye un error de lectura por valores supuestos.

## 3. Resultado

```ts
export interface EffectiveSeasonRules {
  asOf: string;
  defaultSeasonId: string;
  seasons: EffectiveSeasonRule[];
}

export interface EffectiveSeasonRule {
  seasonId: string;
  name: string;
  color: string;
  adjustmentPercent: string;
  isDefault: boolean;
  validFrom: string;
}
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---:|---|
| `asOf` | datetime ISO 8601 UTC | Sí | Instante común de lectura de la instantánea |
| `defaultSeasonId` | UUID/string | Sí | ID estable de la temporada por defecto |
| `seasons[].seasonId` | UUID/string | Sí | Identidad estable referenciada por el calendario de 011 |
| `seasons[].name` | string | Sí | Nombre/etiqueta actual |
| `seasons[].color` | `#RRGGBB` | Sí | Color de visualización actual |
| `seasons[].adjustmentPercent` | decimal string | Sí | Porcentaje firmado entre `-100.00` y `100.00` |
| `seasons[].isDefault` | boolean | Sí | Exactamente un elemento es `true` |
| `seasons[].validFrom` | datetime ISO 8601 UTC | Sí | Inicio de vigencia de la versión del ajuste |

El proveedor devuelve temporadas ordenadas determinísticamente por nombre normalizado e ID. El consumidor trata importes/porcentajes como decimales exactos, no como `number` para operaciones financieras.

### Ejemplo

```json
{
  "asOf": "2026-10-09T20:15:00.000Z",
  "defaultSeasonId": "00000000-0000-4000-8000-000000000001",
  "seasons": [
    {
      "seasonId": "00000000-0000-4000-8000-000000000001",
      "name": "Regular",
      "color": "#808080",
      "adjustmentPercent": "0.00",
      "isDefault": true,
      "validFrom": "2026-01-01T00:00:00.000Z"
    },
    {
      "seasonId": "5dca644e-7a6a-4d2e-a9a5-1943188c4710",
      "name": "Festival",
      "color": "#C0392B",
      "adjustmentPercent": "25.00",
      "isDefault": false,
      "validFrom": "2026-10-09T20:12:00.000Z"
    }
  ]
}
```

## 4. Interpretación por el consumidor

### 005 Consultar tarifa dinámica

1. Captura `asOf` al iniciar la consulta.
2. Obtiene un único snapshot de reglas para ese `asOf`.
3. Para cada noche, resuelve con 011 la temporada aplicable a la fecha. Si no hay clasificación explícita, usa `defaultSeasonId` [SPEC FR-004].
4. Busca el elemento con ese `seasonId`; aplica la regla firmada a la tarifa base de Módulo 1:
   - `dynamicRate = baseRate × (1 + adjustmentPercent / 100)`.
   - `-100.00` produce cero y `+100.00` duplica la base.
   - Redondeo half-up a dos decimales con `Money`.
5. Si el ID no está en el snapshot, falla explícitamente con error de integridad de calendario; no elige otra temporada ni usa ajuste cero [011].

El cálculo es por noche: un rango que cruza varias temporadas usa la regla de cada fecha individualmente [005 FR-003]. El consumidor no escribe el catálogo ni el historial.

### 011 Revisar temporada del año

011 combina IDs del calendario/excepciones con el catálogo para mostrar el nombre/color actual. Puede informar fechas sin clasificación explícita, pero el cálculo las resuelve al default. 011 no modifica porcentajes de ajuste a través de este puerto.

## 5. Consistencia y errores

- La operación devuelve una sola instantánea con regla seleccionada por intervalos `valid_from <= asOf < valid_to` (o `valid_to IS NULL` para la regla actual).
- Al inicio de un cálculo se captura un instante único; todas las noches usan esa instantánea. Una actualización confirmada después de `asOf` no se mezcla en esa operación; la siguiente consulta la observa [SPEC casos límite, NFR-002, NFR-003].
- Una lectura que no puede completarse se propaga como `SEASON_RULES_UNAVAILABLE`/`DATABASE_UNAVAILABLE`. No se devuelve lista vacía, temporada inventada, caché vencida ni porcentaje neutral como fallback.
- Una inconsistencia entre calendario y catálogo se informa como error de dominio identificable; la operación no retorna un resultado parcial.
- La temporada reservada `Regular` debe estar presente exactamente una vez, tener `isDefault = true` y `adjustmentPercent = "0.00"`. Si la invariante se rompe, falla la consulta explícitamente.

## 6. Garantías para quien llama

- **Snapshot determinista**: para el mismo `asOf`, calendario y catálogo, los consumidores observan los mismos valores.
- **No retroactividad**: los datos materializados por consultas/cotizaciones anteriores no se recalculan al cambiar una regla.
- **Responsabilidad separada**: 009 proporciona catálogo y ajuste; 011 es dueño de la clasificación por fecha; 005 compone temporada, ajuste y tarifa base.
- **Sin efecto sobre liquidación/factura**: 007 usa el `lodgingAmount` persistido en la cotización, y 006 congela ese valor en la factura; ninguno vuelve a leer reglas de temporada.
- **Sin caché silenciosa**: los cambios confirmados se reflejan en consultas que comienzan después de su vigencia.
- Cambios de identidad, semántica del porcentaje, límites o estructura de fecha requieren coordinación entre 009, 005 y 011 y actualización del test de contrato.
