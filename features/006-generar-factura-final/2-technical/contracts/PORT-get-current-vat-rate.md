# Contrato de dependencia interna: Leer el porcentaje de IVA vigente

**Consumidor**: Feature 006 Generar factura final
**Proveedor**: Feature 001 Actualizar porcentaje de IVA
**Spec consumidora**: [generar_factura_final.md](../../1-functional/generar_factura_final.md)
**Plan consumidor**: [plan.md](../plan.md)
**Plan proveedor**: [plan.md](../../../001-actualizar-porcentaje-iva/2-technical/plan.md)

**Etiquetas de origen**: `[SPEC]` proviene de la especificación funcional, `[BASE]` del plan técnico base, `[PROVIDER]` del plan técnico de 001 y `[CONV]` es una convención de esta interfaz interna.

Esta interfaz es un puerto interno TypeScript entre dos partes del bounded context `billing`; no es un endpoint REST ni un contrato de red. 006 no lee la tabla `vat_rate` directamente y solo consume la consulta de solo lectura de 001 [PROVIDER].

## 1. Propósito

Obtener una sola vez el porcentaje de IVA vigente para congelarlo en la factura al emitirla. Una modificación posterior del porcentaje no altera ninguna factura previamente emitida [SPEC FR-002, BR-005] [PROVIDER].

## 2. Invocación

```ts
// Implementado/provisto por feature 001
export interface GetCurrentVatRateUseCase {
  getCurrent(): Promise<VatRate>;
}
```

No recibe argumentos: el porcentaje vigente es global para el módulo. No acepta `invoiceId`, fecha histórica, estancia ni una tasa enviada por quien emite, para evitar que 006 solicite una tasa retroactiva o sustituya el valor administrado [SPEC FR-002] [CONV].

## 3. Resultado

```ts
export interface VatRate {
  value: VatRateValue; // VO de 001: decimal exacto 0..100, máx. 2 decimales, serializable como string decimal
}
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `value` | decimal exacto 0–100 | Sí | Porcentaje vigente; 19 % se representa como `"19.00"` internamente/string al serializar |

001 es responsable de mantener un valor vigente válido y disponible; el consumidor no lee una tabla ni inventa una tasa predeterminada. 006 convierte `value` a su objeto decimal del dominio, calcula `vatAmount` con half-up a dos decimales y persiste el valor retornado en `vat_rate_applied` [SPEC FR-002, BR-005] [PROVIDER].

### Ejemplo

```json
{
  "value": "19.00"
}
```

La representación JSON ilustra el valor decimal; el uso real es una llamada de interfaz dentro del proceso, no un mensaje HTTP.

## 4. Errores y garantías

| Resultado/problema | Error de aplicación | Comportamiento de 006 | Reintentable |
|---|---|---|---:|
| Tasa vigente válida | — | Continúa con el cálculo y guarda snapshot | — |
| Nunca se registró un porcentaje (estado inicial de 001, sin valor por defecto) | `VatRateNotConfiguredError` / `VAT_RATE_NOT_CONFIGURED` | No emite ni asigna número; propaga a 010, que publica de inmediato a `modulo3.checkout.dlq` sin reintentos. Tras registrar el IVA, el evento se reprocesa desde la DLQ | No |
| Lectura de base de datos temporalmente fallida | `VatRateUnavailableError` / `VAT_RATE_UNAVAILABLE` | No emite ni asigna número; propaga a 010, que publica a `modulo3.checkout.retry.30s` cada 30 s con `x-retry-count` incrementado, hasta 5 reintentos; agotados, publica a `modulo3.checkout.dlq` | Sí |
| Valor almacenado fuera de 0–100 (no debería ocurrir: lo impide el `CHECK` de la tabla en 001) | Error no tipado de integridad | No usa cero, tasa anterior cacheada ni valor por defecto; falla explícitamente y 010 lo envía a la DLQ como `UNEXPECTED_ERROR` | No |

Se distinguen los dos primeros casos porque un IVA nunca configurado no se resuelve reintentando: es un problema de configuración que requiere al Administrador.

La consulta debe ocurrir después de validar liquidación y datos tributarios y antes de entrar a la transacción que asigna el número. El invoice persiste `vatRateApplied`, `vatAmount` y `totalAmount`; no conserva una referencia viva a `vat_rate` [SPEC FR-009, NFR-003] [PROVIDER].

## 5. Independencia de la factura

- La tasa se lee una vez por intento de emisión nuevo; una factura existente se devuelve primero y no se recalcula con la tasa actual [SPEC FR-006, FR-007].
- Las llamadas a `GetCurrentVatRateUseCase` nunca quedan dentro de la transacción de emisión ni del bloqueo del consecutivo [PLAN].
- 006 puede consumir `GetCurrentVatRateUseCase` y `GenerateSettlementUseCase`, pero no `UpdateVatRateUseCase` ni `VatRateRepositoryPort` directamente [PROVIDER].
- Cambios a la firma o representación de `VatRate` deben coordinarse entre 001 y 006 y actualizar el test de contrato del puerto.
