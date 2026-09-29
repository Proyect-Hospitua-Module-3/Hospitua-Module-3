# Especificación de funcionalidad: Revisar temporada del año

**Creado**: 2026-09-21

## Escenarios de usuario y pruebas _(obligatorio)_

### Historia de usuario 1 - El Administrador revisa la clasificación estacional del año (Prioridad: P1)

Como Administrador, quiero revisar la temporada asignada a cada fecha o rango del año, para validar la política de precios que será aplicada a la tarifa base y asegurar que la estacionalidad del hotel está correctamente definida.

**Por qué esta prioridad**: La temporada es la base de cálculo de la tarifa dinámica; sin revisar esta clasificación, el Administrador no puede verificar que la lógica aplicada a `Consultar tarifa dinámica` sea correcta ni que los cambios del calendario anual estén alineados con la estrategia comercial del hotel.

**Prueba independiente**: Se puede definir un calendario anual con varias fechas en temporada alta, baja y regular y verificar que el sistema presenta exactamente la clasificación asignada para cada fecha o rango sin ambiguar entre períodos.

**Escenarios de aceptación**:

1. **Escenario**: Revisión del calendario anual
   - **Dado** que el hotel define una clasificación anual con fechas o rangos en temporada alta, baja y regular
   - **Cuando** el Administrador revisa el calendario
   - **Entonces** el sistema muestra la temporada asignada a cada periodo y permite identificar claramente la regla aplicable a cada fecha

2. **Escenario**: Fecha sin clasificación explícita
   - **Dado** que existen fechas dentro del año que no tienen una temporada asignada explícitamente
   - **Cuando** el Administrador consulta la temporada del año
   - **Entonces** el sistema identifica esa ausencia y asume automáticamente temporada regular para ese caso, sin ocultar la condición

---

### Historia de usuario 2 - La clasificación anual sirve como referencia para los cálculos de tarifa dinámica (Prioridad: P1)

Como sistema de facturación, quiero que la revisión del calendario anual sea la fuente oficial de clasificación para la tarifa dinámica, para que cualquier cálculo de precio por fecha se base en una misma referencia verificable y consistente.

**Por qué esta prioridad**: `Consultar tarifa dinámica` calcula el precio de cada noche usando la temporada aplicable a esa fecha. Si la clasificación revisada por el Administrador no es coherente o no está disponible para todos los cálculos, el valor final del hospedaje podría variar de un cálculo a otro o quedar desalineado con la estrategia comercial del hotel.

**Prueba independiente**: Se puede seleccionar una fecha de temporada alta, consultar la tarifa dinámica de esa noche y verificar que el resultado corresponde a la temporada que el Administrador revisó como alta para ese periodo.

**Escenarios de aceptación**:

1. **Escenario**: Fecha en temporada alta
   - **Dado** que una fecha concreta está clasificada como temporada alta
   - **Cuando** el sistema calcula la tarifa dinámica para esa fecha
   - **Entonces** la tarifa resultante refleja el ajuste asociado a temporada alta según la regla vigente

2. **Escenario**: Fecha sin clasificación explícita
   - **Dado** que una fecha no tiene un registro de temporada en el calendario anual
   - **Cuando** se consulta su tarifa dinámica
   - **Entonces** el sistema usa temporada regular como criterio por defecto y no falla ni genera una regla inconsistente

---

### Historia de usuario 3 - El Administrador valida la coherencia del calendario anual antes de confirmar cambios de precios (Prioridad: P2)

Como Administrador, quiero revisar el calendario de temporadas antes de actualizar o confirmar ajustes de tarifa, para asegurar que los cambios de porcentaje por temporada se aplican sobre un panorama anual consistente y sin solapamientos.

**Por qué esta prioridad**: La revisión del calendario anual resulta útil antes de modificar reglas de temporada; aun cuando la operación de modificación es posible, no debería hacerse sobre un mapa de fechas ambiguo o con solapamientos que generen resultados inconsistentes.

**Prueba independiente**: Se puede abrir la clasificación anual con varios rangos y verificar que no existan solapamientos ni fechas no cubiertas sin que el sistema lo señale como una condición no válida.

**Escenarios de aceptación**:

1. **Escenario**: Calendario consistente
   - **Dado** que cada fecha o rango del año está asociado a una sola temporada
   - **Cuando** el Administrador revisa la clasificación
   - **Entonces** el sistema valida que no haya conflictos ni superposiciones en la misma fecha

2. **Escenario**: Solapamiento de fechas
   - **Dado** que dos rangos del calendario anual se superponen o asignan la misma fecha a dos temporadas distintas
   - **Cuando** se revisa la clasificación
   - **Entonces** el sistema informa el conflicto para corregirlo antes de usar la configuración en cálculos de tarifa

### Casos límite

- Fechas fuera del rango definido del calendario anual: el sistema debe tratarlas como temporada regular por defecto cuando no haya clasificación explícita.
- Rango de fechas inválido en la revisión del calendario: la consulta no debe aceptar una fecha de fin anterior a la fecha de inicio.
- Solapamiento entre temporadas: el sistema debe señalar el conflicto y no asumir una prioridad implícita.
- Duplicidad de la misma fecha en más de un período: debe rechazarse o destacarse como inconsistente antes de su uso operativo.
- Actor distinto al Administrador intenta revisar la temporada del año: el sistema debe restringir el acceso.
- Cambio de temporada para un período que aún no está vigente: debe quedar registrado como próximo cambio y no afectar fechas ya calculadas.

## Requisitos _(obligatorio)_

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir al actor `Administrador` revisar la clasificación estacional del año para cada fecha o rango de fechas.
- **FR-002**: El sistema DEBE representar el calendario anual con la temporada aplicada a cada fecha, distinguiendo los periodos de temporada alta, regular y baja.
- **FR-003**: El sistema DEBE considerar temporada regular por defecto cuando una fecha no tenga una clasificación explícita configurada.
- **FR-004**: El sistema DEBE detectar conflictos de solapamiento o duplicidad en la clasificación anual y señalar la inconsistencia antes de usar la información en cálculo de tarifa.
- **FR-005**: El sistema DEBE restringir la revisión del calendario anual exclusivamente al actor `Administrador`.
- **FR-006**: El sistema DEBE permitir que la clasificación anual sea la referencia única para determinar la temporada aplicada por `Consultar tarifa dinámica`.
- **FR-007**: El sistema DEBE rechazar o advertir explícitamente un rango de fechas inválido al revisar la temporada del año, sin devolver un resultado parcial.
- **FR-008**: El sistema DEBE registrar la vigencia de los cambios de clasificación anual, para que la temporada aplicada pueda ser trazada en el tiempo.

### Entidades clave _(incluir si la funcionalidad maneja datos)_

- **Calendario anual de temporadas**: Definición temporal de la clasificación estacional del hotel para cada fecha o rango de fechas.
- **Temporada del año**: Etiqueta que asigna a cada fecha la categoría `alta`, `regular` o `baja`.
- **Conflicto de clasificación**: Condición en la que una fecha o rango recibe más de una temporada o presenta una configuración inconsistente.

### Reglas de negocio

- **BR-001**: Solo el Administrador puede revisar la temporada del año.
- **BR-002**: La temporada puede ser `alta`, `regular` o `baja`, y cada fecha debe pertenecer a una sola clasificación válida.
- **BR-003**: Si una fecha no tiene una temporada configurada explícitamente, el sistema la toma como temporada regular para cálculos de tarifa.
- **BR-004**: La clasificación anual es la fuente oficial de la temporada aplicable a cada fecha; debe ser coherente y no ambigua antes de usarse en la tarifa dinámica.
- **BR-005**: Un rango de fechas inválido o una superposición de temporadas no puede resolverse implícitamente; debe ser rechazado o identificado como inconsistencia explícita.

## Requisitos no funcionales

- **NFR-001**: Claridad operativa: la vista del calendario anual debe permitir identificar a simple vista la temporada y el ajuste aplicado por cada periodo.
- **NFR-002**: Consistencia: la clasificación anual no debe permitir duplicidad ni solapamiento entre temporadas en la misma fecha.
- **NFR-003**: Determinismo: la misma fecha y la misma configuración del calendario deben producir siempre la misma temporada aplicable.
- **NFR-004**: Trazabilidad: cada cambio de clasificación debe quedar asociado a una vigencia y a un responsable, para permitir auditoría.
- **NFR-005**: Robustez: la revisión debe manejar fechas sin clasificación con un comportamiento explícito y seguro, sin error o resultado indefinido.

## Criterios de éxito _(obligatorio)_

### Resultados medibles

- **SC-001**: El 100% de las fechas del calendario anual quedan clasificadas en una sola temporada válida o claramente marcadas como régimen regular por defecto.
- **SC-002**: El 100% de los conflictos de solapamiento o duplicidad son detectados y señalados antes de usar la configuración en cálculos.
- **SC-003**: El 100% de las consultas de tarifa dinámica sobre una fecha consultan la misma clasificación anual revisada por el Administrador.
- **SC-004**: El 100% de las fechas sin clasificación explícita son tratadas como temporada regular y no generan resultados ambiguos.
- **SC-005**: El 100% de los accesos a `Revisar temporada del año` quedan restringidos al actor `Administrador`.
