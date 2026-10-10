# Contrato de puerto interno: Consultar cotizaciones de hospedaje por id

**Proveedor**: Feature 005 Consultar tarifa dinámica
**Consumidor**: Feature 007 Generar liquidación (`settlement`)
**Spec proveedor**: [consultar_tarifa_dinamica.md](../../1-functional/consultar_tarifa_dinamica.md)
**Plan proveedor**: [plan.md](../plan.md)
**Contrato de creación**: [POST-pricing-quotes.md](./POST-pricing-quotes.md)
**Plan base**: [plan-tecnico-base.md](../../../../docs/plan-tecnico-base.md)

**Etiquetas de origen**: `[SPEC]` proviene de la especificación funcional de 005, `[PLAN]` del plan técnico de 005, `[BASE]` del plan técnico base, `[007]` del plan de Generar liquidación y `[CONV]` es una convención de interfaz interna.

Es un puerto TypeScript dentro de la aplicación, no un endpoint HTTP ni una integración de red. 005 es dueño de las tablas `lodging_quote` y `lodging_quote_night` y de la creación de cotizaciones; `settlement` (007) solo las **lee** a través de este puerto.

## 1. Propósito

Entregar a `settlement` las cotizaciones guardadas que Módulo 2 dejó en la reserva (`quoteIds`), para que tome de ellas el valor de hospedaje **sin recalcular la tarifa dinámica** [SPEC HU4, FR-013] [BASE] [007].

## 2. Invocación

```ts
// src/domain/ports/out/lodging-quote-query.port.ts
export interface LodgingQuoteQueryPort {
  findByIds(quoteIds: string[]): Promise<LodgingQuote[]>;
}
```

| Parámetro | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `quoteIds` | `string[]` (UUID) | Sí | `quoteId` de las cotizaciones a leer; son los que Módulo 2 devuelve en `GET /api/reservations/{reservationRef}` [BASE]. |

Lo implementa `PrismaLodgingQuoteRepository` de 005 y se registra en `pricing.module.ts` [PLAN].

## 3. Resultado

```ts
export interface LodgingQuote {
  quoteId: string;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  currency: string;
  lodgingAmount: string;
  nights: LodgingQuoteNight[];
}

export interface LodgingQuoteNight {
  date: string;
  baseRate: string;
  seasonName: string;
  adjustmentPercent: string;
  rate: string;
}
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `quoteId` | UUID | Sí | Identificador de la cotización. |
| `roomType` | string | Sí | Tipo de habitación cotizado. 007 lo compara con el `categoryRoom` del check-out para elegir la cotización de la habitación (mismo valor, distinto nombre) [007]. |
| `checkInDate` | date `YYYY-MM-DD` | Sí | Fecha de entrada reservada. |
| `checkOutDate` | date `YYYY-MM-DD` | Sí | Fecha de salida reservada (exclusiva). |
| `currency` | string | Sí | Moneda (`"COP"`). |
| `lodgingAmount` | decimal string | Sí | Valor de hospedaje total de la habitación. Es el que usa 007 como `lodgingAmount` de la liquidación [007]. |
| `nights[].date` | date `YYYY-MM-DD` | Sí | Noche cotizada. |
| `nights[].baseRate` | decimal string | Sí | Tarifa base de origen con la que se calculó la noche. |
| `nights[].seasonName` | string | Sí | Temporada aplicada a la noche. |
| `nights[].adjustmentPercent` | decimal string | Sí | Ajuste firmado aplicado a la noche. |
| `nights[].rate` | decimal string | Sí | Tarifa dinámica de la noche. |

Los importes y porcentajes son decimales exactos en `string`; el consumidor no los trata como `number` en operaciones financieras [PLAN] [CONV].

### Ejemplo

```json
[
  {
    "quoteId": "a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b",
    "roomType": "DOBLE",
    "checkInDate": "2026-12-23",
    "checkOutDate": "2026-12-26",
    "currency": "COP",
    "lodgingAmount": "1020000.00",
    "nights": [
      { "date": "2026-12-23", "baseRate": "300000.00", "seasonName": "Regular", "adjustmentPercent": "0.00", "rate": "300000.00" },
      { "date": "2026-12-24", "baseRate": "300000.00", "seasonName": "Alta", "adjustmentPercent": "20.00", "rate": "360000.00" },
      { "date": "2026-12-25", "baseRate": "300000.00", "seasonName": "Alta", "adjustmentPercent": "20.00", "rate": "360000.00" }
    ]
  }
]
```

## 4. Reglas de la lectura

- **Solo lectura**: no ejecuta `INSERT`, `UPDATE` ni `DELETE`, y nunca invoca el cálculo de tarifa dinámica ni consulta a Módulo 1, a 009 ni a 011 [SPEC BR-004, FR-013] [PLAN].
- **Valores tal como se guardaron**: devuelve exactamente lo que se guardó al crear la cotización, sin recalcular, aunque las reglas de temporada o la tarifa base hayan cambiado después [SPEC FR-013, SC-008] [PLAN].
- **Un `quoteId` que no existe no produce error**: simplemente no aparece en el resultado. Una lista vacía de `quoteIds` devuelve una lista vacía [CONV]. Decidir qué hacer cuando ninguna cotización coincide con el `categoryRoom` (`QUOTE_NOT_FOUND`) es responsabilidad de 007, no de este puerto [007].
- **Sin orden garantizado**: el consumidor no debe depender del orden del resultado. Cuando varias cotizaciones coinciden, 007 elige por su cuenta la de menor `quoteId` [007] [CONV].
- **Fallo de lectura**: si la base de datos no puede responder, el error se propaga al consumidor. Nunca se devuelve una lista vacía ni valores supuestos como reemplazo [CONV].

## 5. Garantías para quien llama

- **Inmutabilidad**: una cotización leída hoy tiene los mismos valores que mañana; las tablas solo reciben `INSERT` [SPEC FR-013] [PLAN].
- **Determinismo**: los mismos `quoteIds` devuelven siempre los mismos datos [SPEC NFR-001].
- **Sin recalcular**: 007 usa `lodgingAmount` tal cual; 006 congela ese valor en la factura. Ninguno vuelve a leer reglas de temporada [SPEC HU4] [BASE] [007].
- **Frontera protegida**: `settlement` puede importar este puerto y el modelo `LodgingQuote`, pero nunca `GetDynamicRateService` ni `CreateLodgingQuoteService`. Una regla de `dependency-cruiser` lo verifica, por lo que un check-out, también una salida anticipada, nunca genera una cotización [SPEC FR-014] [PLAN] [BASE].
- Un cambio en los campos de `LodgingQuote`, en la firma de `findByIds` o en el tratamiento de ids inexistentes requiere coordinar con 007 y actualizar `test/contract/lodging-quote-query.port.spec.ts` [PLAN].
