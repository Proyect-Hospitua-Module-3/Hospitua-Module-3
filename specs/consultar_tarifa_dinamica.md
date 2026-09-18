# Especificación de funcionalidad: Consultar tarifa dinámica

**Creado**: 2026-09-18

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Módulo 2 obtiene la tarifa dinámica de una noche para calcular el valor de hospedaje (Prioridad: P1)

Como Módulo 2 (módulo de reservas), quiero consultar la tarifa dinámica de un tipo de habitación para una fecha específica, para poder calcular el valor de hospedaje que reportaré posteriormente en el evento de check-out a `Generar liquidación`.

**Por qué esta prioridad**: `Generar liquidación` no calcula ni recalcula la tarifa dinámica por su cuenta (FR-002 de `generar_liquidacion.md`); el valor de hospedaje debe llegar ya calculado en el evento de check-out. Sin esta consulta, Módulo 2 no tendría forma de obtener ese valor de forma consistente con las reglas de temporada que administra Módulo 3.

**Prueba independiente**: Se puede configurar una tarifa base en Módulo 1 y una regla de temporada en Módulo 3 para una fecha determinada, consultar la tarifa dinámica de esa fecha, y verificar que el resultado refleja el ajuste correspondiente (incremento en temporada alta, decremento en temporada baja, sin cambio en temporada regular).

**Escenarios de aceptación**:

1. **Escenario**: Consulta de una noche en temporada alta
   - **Dado** que la fecha consultada está clasificada como temporada alta y la habitación tiene una tarifa base registrada en Módulo 1
   - **Cuando** Módulo 2 consulta la tarifa dinámica de esa habitación para esa fecha
   - **Entonces** el sistema devuelve la tarifa base incrementada según la regla de temporada alta vigente

2. **Escenario**: Consulta de una noche sin temporada explícita
   - **Dado** que la fecha consultada no tiene una clasificación de temporada configurada
   - **Cuando** Módulo 2 consulta la tarifa dinámica de esa fecha
   - **Entonces** el sistema asume temporada regular y devuelve la tarifa base sin ajuste

---

### Historia de usuario 2 - Módulo 2 obtiene el valor de hospedaje de una estancia completa (Prioridad: P1)

Como Módulo 2, quiero consultar la tarifa dinámica de cada noche dentro de un rango de fechas de una estancia, para sumar los valores y obtener el valor de hospedaje bruto total, incluso cuando la estancia cruce más de una temporada.

**Por qué esta prioridad**: El valor de hospedaje (bruto) se define como la suma de las tarifas dinámicas de todas las noches de la estancia (`diccionario.md`); sin poder consultar el detalle noche por noche, Módulo 2 no podría construir ese total de forma correcta cuando la estancia atraviesa distintas temporadas.

**Prueba independiente**: Se puede configurar una estancia cuyo rango de fechas cruce de temporada baja a temporada alta, consultar la tarifa dinámica de ese rango, y verificar que cada noche refleja su propia temporada, sin homogeneizar todo el rango a una sola.

**Escenarios de aceptación**:

1. **Escenario**: Rango que cruza dos temporadas
   - **Dado** que un rango de fechas incluye noches en temporada baja y noches en temporada alta
   - **Cuando** Módulo 2 consulta la tarifa dinámica de ese rango
   - **Entonces** el sistema devuelve un resultado por cada noche, con la temporada y el ajuste que corresponde individualmente a esa fecha

2. **Escenario**: Rango de fechas inválido
   - **Dado** que la fecha de fin del rango consultado es anterior a la fecha de inicio
   - **Cuando** Módulo 2 ejecuta la consulta
   - **Entonces** el sistema rechaza la consulta y no devuelve ningún resultado parcial

### Casos límite

- La habitación o tipo de habitación consultado no tiene tarifa base registrada en Módulo 1: el sistema rechaza la consulta; no debe devolver una tarifa dinámica calculada sobre una tarifa base en cero o supuesta.
- Módulo 1 no responde o no está disponible al consultar la tarifa base: la consulta de tarifa dinámica falla de forma explícita, sin devolver un resultado parcial ni estimado.
- La regla de temporada o la tarifa base cambian después de que Módulo 2 ya utilizó una consulta anterior para construir parte del valor de hospedaje de una estancia en curso: `Consultar tarifa dinámica` siempre refleja la configuración vigente en el momento exacto de cada consulta; no re-evalúa ni corrige consultas anteriores ya realizadas.
- Consulta repetida para la misma habitación y fecha sin cambios de configuración: debe devolver siempre el mismo resultado.
- Rango de fechas de una sola noche: se trata igual que cualquier rango, devolviendo el resultado de esa única noche.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir a Módulo 2 consultar la tarifa dinámica de un tipo de habitación para una fecha específica o para un rango de fechas.
- **FR-002**: El sistema DEBE calcular la tarifa dinámica ajustando la tarifa base obtenida de Módulo 1 (mediante `Consultar tarifa base`) según la regla de temporada vigente aplicable a cada noche consultada (temporada alta = incremento, temporada baja = decremento, temporada regular = ajuste neutro), conforme a la clasificación que administra el Administrador en `Revisar temporada del año` y `Modificar precio tarifa según temporada`.
- **FR-003**: Cuando la consulta cubra un rango de varias noches, el sistema DEBE devolver el resultado de cada noche de forma individual, sin promediar ni aplicar una única temporada a todo el rango.
- **FR-004**: El sistema DEBE asumir temporada regular cuando una fecha consultada no tenga una clasificación de temporada explícita configurada.
- **FR-005**: El sistema NO DEBE calcular, almacenar ni asumir una tarifa base propia; DEBE obtenerla de Módulo 1 en cada consulta mediante `Consultar tarifa base`.
- **FR-006**: El sistema DEBE rechazar la consulta cuando Módulo 1 no reporte una tarifa base para la habitación o tipo de habitación solicitado, sin devolver una tarifa dinámica basada en un valor supuesto o en cero.
- **FR-007**: El sistema NO DEBE persistir un valor fijo de "tarifa dinámica" para una fecha; cada consulta refleja la configuración de temporada y la tarifa base vigentes en el momento en que se ejecuta.
- **FR-008**: El sistema DEBE rechazar una consulta cuyo rango de fechas sea inválido (fecha de fin anterior a la fecha de inicio), sin devolver un resultado parcial.
- **FR-009**: El resultado de la consulta DEBE identificar, para cada noche, la tarifa base de origen, la temporada aplicada y la tarifa dinámica resultante, para que Módulo 2 pueda trazar cómo se compuso el valor de hospedaje que reportará en el check-out.
- **FR-010**: El sistema DEBE restringir el acceso a `Consultar tarifa dinámica` exclusivamente al actor Módulo 2.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Tarifa dinámica**: Valor resultante de ajustar la tarifa base según la temporada aplicable a una noche específica; se calcula en el momento de la consulta, no se almacena como valor independiente.
- **Consulta de tarifa**: Solicitud de Módulo 2 identificando el tipo de habitación y una fecha o rango de fechas.
- **Resultado por noche**: Tarifa base de origen, temporada aplicada y tarifa dinámica resultante para una noche específica dentro del rango consultado.

### Reglas de negocio

- **BR-001**: La tarifa dinámica es siempre una función de la tarifa base vigente en Módulo 1 y la regla de temporada vigente administrada por el Administrador en el momento de la consulta; no es un valor almacenado de forma independiente.
- **BR-002**: El acceso a `Consultar tarifa dinámica` está reservado a Módulo 2, único actor externo con la necesidad de calcular el valor de hospedaje de una estancia antes de reportarlo en el evento de check-out.
- **BR-003**: Cada noche de una estancia se valora con la temporada que corresponde a esa fecha específica; una estancia que abarca más de una temporada nunca se homogeniza a una sola.
- **BR-004**: `Consultar tarifa dinámica` es una operación exclusivamente de lectura: no crea ni modifica la tarifa base, la clasificación de temporada, ni ningún registro de liquidación o factura.

## Requisitos no funcionales

- **NFR-001**: Determinismo: la misma habitación o tipo, la misma fecha y la misma configuración vigente deben producir siempre el mismo resultado.
- **NFR-002**: Rendimiento: la consulta debe responder en un tiempo adecuado para no bloquear operaciones de front-desk en Módulo 2 (cotización, check-in, cálculo de extensiones).
- **NFR-003**: Consistencia entre módulos: si Módulo 1 no está disponible o no devuelve una tarifa base válida, la consulta debe fallar de forma explícita, nunca con un resultado parcial o estimado.
- **NFR-004**: Trazabilidad: el resultado debe permitir reconstruir, para cada noche, cómo se llegó a la tarifa dinámica final a partir de la tarifa base y la temporada aplicada.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las consultas sobre una fecha con temporada configurada aplican el ajuste correspondiente sin excepción.
- **SC-002**: El 100% de las estancias que cruzan más de una temporada reciben el valor correcto por cada noche, verificable sumando manualmente.
- **SC-003**: El 0% de las consultas devuelve una tarifa dinámica cuando Módulo 1 no reporta una tarifa base válida.
- **SC-004**: El 100% de las consultas con un rango de fechas inválido son rechazadas sin devolver un resultado parcial.
- **SC-005**: El 100% de los accesos a `Consultar tarifa dinámica` quedan restringidos al actor Módulo 2.
