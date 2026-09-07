# Especificación de funcionalidad: Consultar tarifa base

**Creado**: 2026-09-06  

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Obtener la tarifa base vigente para un tipo de habitación (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero consultar la tarifa base vigente de un tipo de habitación para una fecha específica, para usarla como valor inicial dentro de "Calcular tarifa dinámica".

**Por qué esta prioridad**: La tarifa base es el punto de partida de todo cálculo de hospedaje. Sin una consulta confiable a esta información (propiedad del Módulo 1), ningún cálculo de tarifa dinámica ni liquidación puede completarse.

**Prueba independiente**: Se puede invocar la consulta con un tipo de habitación y una fecha válidos, y verificar de forma independiente que el resultado incluya el valor de la tarifa, la moneda y el período de vigencia que la respalda.

**Escenarios de aceptación**:

1. **Escenario**: Consulta exitosa de tarifa base vigente
	- **Dado** que el tipo de habitación solicitado tiene una tarifa base configurada en `Modulo1`, vigente para la fecha consultada
	- **Cuando** `Calcular tarifa dinámica` invoca "Consultar tarifa base"
	- **Entonces** el sistema devuelve el valor de la tarifa, la moneda y el período de vigencia correspondiente, sin modificar ni almacenar una copia independiente de esa configuración.

2. **Escenario**: Consulta para una estancia que cruza un cambio de tarifa base
	- **Dado** que la tarifa base del tipo de habitación cambió de valor durante el rango de fechas de la estancia solicitada
	- **Cuando** se consulta la tarifa base para cada noche
	- **Entonces** el sistema devuelve el valor vigente correspondiente a la fecha específica de cada noche, no un único valor para toda la estancia.

### Casos límite

- **Tipo de habitación sin tarifa base configurada**: Si no existe ninguna tarifa base registrada en `Modulo1` para el tipo de habitación, el sistema debe informar la ausencia y no devolver un valor en cero ni un valor por defecto.
- **Tarifa base existente pero no vigente para la fecha solicitada**: Si el tipo de habitación tiene tarifas registradas, pero ninguna cubre la fecha específica consultada, el sistema debe informarlo, distinguiendo este caso de la ausencia total de configuración.
- **Tipo de habitación inexistente o inválido**: Si el identificador de tipo de habitación no corresponde a ningún registro conocido, el sistema debe rechazar la consulta en vez de asumir un tipo por defecto.
- **Períodos de vigencia solapados para el mismo tipo de habitación**: Si `Modulo1` reporta más de una tarifa base vigente simultáneamente para la misma fecha, el sistema debe rechazar la consulta por ambigüedad, sin elegir arbitrariamente una de las dos.
- **Tarifa base con valor no válido**: Si el valor reportado es negativo, cero, o no numérico, el sistema debe rechazar la consulta en vez de propagarlo al cálculo de tarifa dinámica.
- **Cambio de tarifa base durante una estancia ya liquidada en el check-in**: Un cambio posterior en `Modulo1` no debe alterar retroactivamente un cálculo ya persistido; la consulta solo afecta cálculos nuevos a partir del cambio.
- **Diferencia de moneda entre la tarifa base y la moneda de la transacción solicitada**: El sistema debe informar la discrepancia y no realizar una conversión implícita de moneda.
- **Indisponibilidad técnica de Módulo 1 al momento de la consulta**: Si la consulta hacia `Modulo1` falla por un problema de comunicación (no porque falte la tarifa, sino porque el módulo no responde), el sistema debe detener el cálculo que la invoca sin asumir que la tarifa no existe ni sustituirla por un valor supuesto.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE consultar la tarifa base vigente para un tipo de habitación y una fecha específica, obteniendo el valor, la moneda y el período de vigencia gestionados por `Modulo1`.
- **FR-002**: El sistema NO DEBE almacenar una copia persistente e independiente de la configuración de tarifa base; cada consulta DEBE reflejar el estado vigente al momento de la invocación.
- **FR-003**: El sistema DEBE resolver la tarifa base de forma independiente para cada noche cuando la estancia consultada cruce un cambio de valor de tarifa base.
- **FR-004**: El sistema DEBE rechazar la consulta y no devolver un valor sustituto cuando el tipo de habitación no tenga ninguna tarifa base configurada, o cuando exista tarifa base configurada pero ninguna vigente para la fecha solicitada.
- **FR-005**: El sistema DEBE rechazar la consulta cuando se detecten períodos de vigencia solapados para el mismo tipo de habitación y fecha, sin resolver la ambigüedad de forma arbitraria.
- **FR-006**: El sistema DEBE rechazar la consulta cuando el valor de la tarifa base reportado sea inválido (negativo, cero, o no numérico).
- **FR-007**: El sistema DEBE informar una discrepancia de moneda entre la tarifa base y la moneda de la transacción solicitada, sin realizar una conversión implícita.
- **FR-008**: El sistema NO DEBE modificar, corregir ni completar la configuración de tarifa base en `Modulo1`; esta consulta es de solo lectura.
- **FR-009**: El sistema DEBE distinguir entre la ausencia de una tarifa base (Módulo1 responde que no existe) y una falla de comunicación con Módulo1 (no se obtiene respuesta); en ambos casos DEBE detener el cálculo que invoca la consulta, pero sin tratar una falla técnica como si fuera una configuración faltante.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Tarifa base**: Valor regular de una noche para un tipo de habitación, con período de vigencia y moneda, gestionado y mantenido por `Modulo1`.
- **Tipo de habitación**: Categoría de alojamiento a la que se asocia la tarifa base consultada.
- **Período de vigencia**: Rango de fechas durante el cual un valor específico de tarifa base es aplicable.
- **Resultado de consulta**: Valor de tarifa base, moneda y período de vigencia devueltos, o el motivo de rechazo cuando no exista una tarifa aplicable.

### Reglas de negocio

- **BR-001**: Frontera arquitectónica: la tarifa base es propiedad y responsabilidad de `Modulo1`. El Módulo 3 únicamente la consulta como insumo para `Calcular tarifa dinámica`; no la configura, corrige ni almacena de forma independiente.
- **BR-002**: Unicidad por fecha: cada tipo de habitación debe tener, como máximo, una tarifa base vigente por fecha; una consulta que detecte más de una debe rechazarse en vez de elegir una arbitrariamente.
- **BR-003**: Ausencia de valores por defecto: la falta de una tarifa base vigente detiene el cálculo que la invoca; el sistema no sustituye el valor faltante por cero ni por un valor supuesto.
- **BR-004**: Consistencia de moneda: la tarifa base debe consultarse en su moneda original; cualquier conversión de moneda, si aplica, es responsabilidad de un proceso distinto, no de esta consulta.

## Requisitos no funcionales

- **NFR-001**: Determinismo: para el mismo tipo de habitación, fecha y estado de configuración en `Modulo1`, la consulta debe devolver siempre el mismo resultado.
- **NFR-002**: Rendimiento: la consulta debe completarse en un tiempo que no genere demoras perceptibles dentro de los procesos de cálculo de tarifa dinámica que la invocan.
- **NFR-003**: Actualidad: la consulta debe reflejar siempre el estado más reciente de la configuración en `Modulo1`, sin depender de una copia cacheada desactualizada.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las consultas con tarifa base vigente y sin ambigüedad devuelven el valor, la moneda y el período de vigencia correctos.
- **SC-002**: El 100% de las consultas sin tarifa base configurada o sin vigencia para la fecha solicitada se rechazan sin devolver un valor sustituto.
- **SC-003**: El 100% de las consultas con períodos de vigencia solapados se rechazan por ambigüedad, sin resolución arbitraria.
- **SC-004**: El 0% de las consultas modifica o corrige la configuración de tarifa base en `Modulo1`.