# Contrato REST (Cliente): Consultar tarifa base a Módulo 1

**Feature**: 004 Consultar tarifa base — HU1
**Spec**: [consultar_tarifa_base.md](../../1-functional/consultar_tarifa_base.md)
**Plan**: [plan.md](../plan.md)
**Estado**: Módulo 3 consume la operación definida en el Plan Base.

## 1. Propósito

Módulo 3 consulta la tarifa base regular de una categoría de habitación para una fecha. El resultado funcional debe aportar el importe aplicable y su período de vigencia para que la funcionalidad de tarifa dinámica pueda calcular su resultado. La consulta es de solo lectura y Módulo 1 conserva la responsabilidad sobre la tarifa base [SPEC FR-001, FR-002, FR-007; BASE].

## 2. Petición

`GET {MODULE1_BASE_URL}/rooms/{roomType}/base-rate?date=YYYY-MM-DD` [BASE]

| Parámetro | Ubicación | Tipo | Obligatorio | Descripción |
|---|---|---|---|---|
| `roomType` | path | string | Sí | Tipo de habitación para el que se consulta la tarifa base. |
| `date` | query | date (`YYYY-MM-DD`) | Sí | Fecha cuya tarifa base se consulta. |

La comunicación entre módulos se realiza por la red interna, sin token de autenticación [BASE]. El Plan Base define la ruta y los parámetros; la documentación disponible no establece el esquema JSON de la respuesta.

## 3. Resultado funcional

Cuando existe tarifa base aplicable, Módulo 3 obtiene el importe y la vigencia asociada a `roomType` y `date`. La consulta no calcula la tarifa dinámica ni aplica temporadas: esa responsabilidad corresponde a las funcionalidades que determinan la tarifa dinámica. Módulo 3 no persiste ni sustituye tarifas base [SPEC FR-001, FR-002, BR-001].

## 4. Resultados y errores definidos

- `200 OK`: existe tarifa base aplicable; la respuesta debe permitir a Módulo 3 disponer del importe y la vigencia. El formato de sus campos no está definido en los documentos de contrato disponibles.
- `404 BASE_RATE_NOT_FOUND`: no existe tarifa base aplicable [BASE].
- `424 MODULE1_UNAVAILABLE`: Módulo 1 no está disponible para atender la dependencia [BASE].

Los errores siguen la estructura `ApiError` establecida en el Plan Base. No se definen aquí otros códigos ni una forma de respuesta JSON que no esté documentada.
