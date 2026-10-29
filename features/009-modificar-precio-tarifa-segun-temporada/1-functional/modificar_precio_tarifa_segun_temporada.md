# Especificación de funcionalidad: Modificar precio tarifa según temporada

**Creado**: 2026-09-21

## Escenarios de usuario y pruebas _(obligatorio)_

### Historia de usuario 1 - El Administrador ajusta el porcentaje de incremento o descuento por temporada (Prioridad: P1)

Como Administrador, quiero modificar el precio o el factor de ajuste aplicado a la tarifa base según la temporada vigente, para mantener el precio del alojamiento alineado con la estacionalidad del mercado y las políticas comerciales del hotel.

**Por qué esta prioridad**: `Consultar tarifa dinámica` depende directamente de la regla de temporada para transformar la tarifa base en el precio final de cada noche (FR-002 de `consultar_tarifa_dinamica.md`). Si esta configuración no puede modificarse, el sistema quedaría bloqueado con precios estáticos o desactualizados y no reflejaría los cambios de temporada ni la estrategia comercial del hotel.

**Prueba independiente**: Se puede definir una temporada alta con un ajuste válido, guardarlo como regla vigente, y verificar que una fecha clasificada como alta pasa a calcularse con el nuevo factor sin alterar otras temporadas ni la tarifa base original.

**Escenarios de aceptación**:

1. **Escenario**: Ajuste exitoso de una temporada
   - **Dado** que existe una temporada (alta, baja o regular) con una regla de ajuste vigente
   - **Cuando** el Administrador modifica el porcentaje o factor de precio asociado a esa temporada
   - **Entonces** el sistema guarda la nueva regla como la vigente y la usa en las consultas futuras de tarifa dinámica

2. **Escenario**: Rechazo de un ajuste inválido
   - **Dado** que el Administrador intenta guardar un valor de ajuste fuera del rango permitido o con formato inválido
   - **Cuando** se envía la modificación
   - **Entonces** el sistema rechaza el cambio, informa el motivo y conserva la regla anterior sin aplicarla parcialmente

---

### Historia de usuario 2 - El cambio de regla de temporada rige desde el momento de la actualización y no altera datos ya calculados (Prioridad: P1)

Como Administrador, quiero que cualquier modificación de la tarifa por temporada se aplique de manera clara y consistente en el tiempo, para no afectar cálculos ya realizados sobre estancias o liquidaciones previas que ya fueron consolidados.

**Por qué esta prioridad**: La lógica de tarifa dinámica se calcula sobre la configuración vigente al momento de la consulta, pero los cálculos ya materializados en una liquidación o factura deben permanecer inmutables. Esta regla evita inconsistencias de negocio y asegura que la configuración del Administrador sirva como referente futuro, no como modificación retroactiva de resultados ya emitidos.

**Prueba independiente**: Se puede consultar una tarifa dinámica antes y después de cambiar la regla de temporada, y verificar que la consulta anterior mantiene su valor original mientras las nuevas consultas usan la regla actualizada.

**Escenarios de aceptación**:

1. **Escenario**: Cambio aplicado solo a nuevas consultas
   - **Dado** que ya existen consultas de tarifa dinámica realizadas bajo una regla de temporada anterior
   - **Cuando** el Administrador modifica la regla de una temporada
   - **Entonces** las consultas nuevas usan la regla nueva, mientras que las consultas ya realizadas no se recomputan ni se alteran

2. **Escenario**: Cambio de temporada no afecta a otras temporadas
   - **Dado** que la temporada alta tiene un ajuste configurado y la temporada baja tiene otra configuración distinta
   - **Cuando** el Administrador modifica solo la regla de la temporada alta
   - **Entonces** la temporada baja y la regular conservan sus ajustes vigentes sin ser tocados ni mezclados

---

### Historia de usuario 3 - El Administrador revisa el catálogo de temporadas y su ajuste vigente (Prioridad: P2)

Como Administrador, quiero revisar las temporadas configuradas y el ajuste vigente de cada una, para validar que la estrategia de precios esté coherente con la demanda y los objetivos del hotel.

**Por qué esta prioridad**: La regla de tarifa por temporada se usa por varios casos de uso y varios actores; sin una vista de revisión clara y legible, la administración puede cometer errores de configuración que luego afecten la tarifa dinámica sin darse cuenta.

**Prueba independiente**: Se puede abrir el catálogo de temporadas y verificar que cada temporada muestre su nombre, color y ajuste vigente, y que la temporada predeterminada aparezca identificada como tal, sin posibilidad de confusión entre temporadas.

La asignación de temporadas a fechas y rangos del año (calendario anual, períodos y excepciones) se revisa en `Revisar temporada del año` (`revisar_temporada_del_año.md`), que usa este catálogo para mostrar el nombre, el color y el ajuste de cada período.

**Escenarios de aceptación**:

1. **Escenario**: Revisión del catálogo vigente
   - **Dado** que existen varias temporadas configuradas con su ajuste
   - **Cuando** el Administrador abre el catálogo de temporadas
   - **Entonces** el sistema muestra cada temporada con su nombre, color y el ajuste exacto aplicable a la tarifa base

2. **Escenario**: Temporada predeterminada identificable
   - **Dado** que `Regular` es la temporada predeterminada
   - **Cuando** el Administrador revisa el catálogo
   - **Entonces** el sistema la identifica explícitamente como la temporada que se aplica a las fechas sin clasificación en el calendario anual, junto con su ajuste vigente

### Casos límite

- Actualización con un ajuste fuera del rango permitido o con formato inválido para una temporada: el sistema debe rechazar la modificación y conservar la regla anterior. Un ajuste negativo es válido: representa un descuento sobre la tarifa base.
- Modificación concurrente por dos Administradores casi al mismo tiempo: el sistema debe garantizar una sola versión vigente de la regla, sin dejarla en un estado ambiguo. Si un Administrador envía un cambio basado en una versión que ya fue modificada por otro, el cambio se rechaza para que revise el valor vigente antes de reintentar.
- Eliminación de una temporada asignada en el calendario vigente: el sistema debe rechazarla e indicar que primero se retire del calendario.
- Cambio de ajuste a un valor idéntico al ya vigente: la operación debe aceptarse como válida, pero sin generar un cambio efectivo o un historial redundante.
- Fechas que no tienen temporada explícita configurada: el sistema debe aplicar temporada regular por defecto y no permitir que queden sin clasificación sin notificación.
- Actor distinto al Administrador intenta modificar la regla: el sistema debe rechazar la operación.
- Cambio de regla durante una operación de consulta en curso: la consulta debe usar la versión de configuración vigente en el momento exacto de la ejecución, sin mezclas ni resultados intermedios.

## Requisitos _(obligatorio)_

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir al actor `Administrador` crear temporadas con nombre y color definidos libremente, eliminarlas excepto `Regular` y modificar el ajuste aplicado a la tarifa base para cada temporada configurada. `Regular` DEBE existir como temporada por defecto y no DEBE poder eliminarse ni renombrarse. Eliminar una temporada la retira del catálogo para nuevas asignaciones, sin borrar su historial de ajustes ni las revisiones anteriores del calendario que la usaron; no se puede eliminar una temporada asignada en el calendario vigente.
- **FR-002**: El sistema DEBE validar que el porcentaje o factor de ajuste sea numérico y esté dentro de un rango comercial razonable antes de aceptarlo como vigente. El ajuste puede ser positivo (incremento) o negativo (descuento).
- **FR-003**: El sistema DEBE mantener una única regla vigente por temporada en cada periodo de validez, sin dejar reglas parcialmente aplicadas o contradictorias.
- **FR-004**: El sistema DEBE registrar quién modificó la regla, cuándo y cuál era el valor anterior, para fines de trazabilidad y auditoría.
- **FR-005**: El sistema DEBE restringir la modificación de los precios de temporada exclusivamente al actor `Administrador`.
- **FR-006**: El sistema DEBE aplicar la nueva regla a nuevas consultas de tarifa dinámica, sin recalcular ni alterar resultados ya emitidos o ya consolidados en liquidaciones o facturas.
- **FR-007**: El sistema DEBE permitir que la temporada regular actúe como valor por defecto cuando una fecha no tenga una clasificación explícita configurada.
- **FR-008**: El sistema DEBE aceptar únicamente ajustes coherentes con el modelo comercial del hotel y con la lógica de temporada usada por `Consultar tarifa dinámica`.
- **FR-009**: El sistema NO DEBE permitir que una modificación de temporada altere la tarifa base registrada en Módulo 1; solo cambia el ajuste aplicable sobre esa tarifa base.

### Entidades clave _(incluir si la funcionalidad maneja datos)_

- **Regla de temporada**: Parámetro que define el ajuste (incremento, decremento o neutro) que se aplica a la tarifa base para una temporada concreta.
- **Temporada**: Elemento del catálogo de temporadas del hotel, con nombre y color definidos por el Administrador (no se limita a baja, regular o alta). `Regular` es la temporada predeterminada. Su ajuste determina el sentido y la magnitud del cambio de precio.
- **Historial de ajustes**: Registro de cada cambio de regla, con el valor anterior, el nuevo valor, el Administrador responsable y la marca temporal.

### Reglas de negocio

- **BR-001**: Solo el Administrador puede modificar la regla de precios por temporada.
- **BR-002**: La regla por temporada modifica el ajuste aplicado sobre la tarifa base, no la tarifa base en sí misma.
- **BR-003**: Cuando una fecha no figura con clasificación explícita en el calendario anual, el sistema asume temporada regular para el cálculo.
- **BR-004**: Un cambio en la regla de temporada afecta únicamente a nuevas consultas y cálculos futuros; no retroactiva resultados ya consolidados.
- **BR-005**: La regla vigente debe ser única por temporada y por período de vigencia. Las reglas sobre los períodos del calendario (no solapamiento de períodos base y precedencia de las excepciones puntuales) pertenecen a `Revisar temporada del año` (BR-005 y BR-006 de `revisar_temporada_del_año.md`).

## Requisitos no funcionales

- **NFR-001**: Auditabilidad: cada modificación debe quedar registrada con responsable y marca horaria verificable.
- **NFR-002**: Consistencia: ante modificaciones concurrentes, debe quedar una sola regla vigente para cada temporada y período.
- **NFR-003**: Determinismo: la misma temporada, la misma tarifa base y la misma regla vigente deben devolver siempre el mismo ajuste.
- **NFR-004**: Integridad temporal: los cambios aplicados deben respetar el principio de no retroactividad sobre cálculos ya generados y consolidados.
- **NFR-005**: Usabilidad administrativa: la configuración debe poder revisarse y modificarse sin ambigüedad, incluso cuando hay varios periodos del año definidos.

## Criterios de éxito _(obligatorio)_

### Resultados medibles

- **SC-001**: El 100% de las modificaciones exitosas de regla por temporada quedan registradas con Administrador y fecha-hora.
- **SC-002**: El 100% de los cambios con un valor inválido son rechazados sin aplicar un ajuste parcial.
- **SC-003**: El 100% de las nuevas consultas de tarifa dinámica usan la regla vigente más reciente tras una modificación exitosa.
- **SC-004**: El 0% de las liquidaciones o facturas ya emitidas se altera por un cambio posterior de regla de temporada.
- **SC-005**: El 100% de los intentos de modificación por un actor distinto al Administrador son rechazados.
