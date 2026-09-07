# Especificación de funcionalidad: Consultar tarifa dinámica

**Creado**: 2026-09-04

## Escenarios de usuario y pruebas _(obligatorio)_

### Historia de usuario 1 - Consultar el precio de una estancia (Prioridad: P1)

Como huésped o agente de recepción, quiero consultar el precio de una habitación para unas fechas específicas, para conocer cuánto cuesta la estancia antes de continuar con la reserva.

**Por qué esta prioridad**: La consulta de tarifa es la capacidad principal del caso de uso y permite tomar una decisión de reserva con un valor calculado de forma consistente.

**Prueba independiente**: Se puede probar proporcionando un tipo de habitación, una fecha de entrada y una fecha de salida válidas, y verificando que el sistema devuelva la tarifa aplicable por noche y el total de la estancia.

**Escenarios de aceptación**:

1. **Escenario**: Consultar una estancia en temporada regular
   - **Dado** que existe una habitación con tarifa base configurada y las fechas solicitadas pertenecen a temporada regular
   - **Cuando** el usuario consulta la tarifa para una fecha de entrada y una fecha de salida válidas
   - **Entonces** el sistema muestra la tarifa base aplicable a cada noche y el total correspondiente al número de noches

2. **Escenario**: Consultar una estancia en temporada baja, regular o alta
   - **Dado** que existe una habitación con tarifa base configurada y al menos una noche solicitada pertenece a un período de temporada configurado
   - **Cuando** el usuario consulta la tarifa
   - **Entonces** el sistema aplica el porcentaje de ajuste definido para la temporada correspondiente y muestra el desglose por noche y el total de la estancia

3. **Escenario**: Consultar fechas con tarifas diferentes
   - **Dado** que la estancia atraviesa períodos con reglas de tarifa distintas
   - **Cuando** el usuario consulta la tarifa
   - **Entonces** el sistema calcula cada noche con la regla que corresponde a su fecha y suma los valores para obtener el total

---

### Historia de usuario 2 - Consultar una tarifa transparente para la reserva (Prioridad: P2)

Como huésped o agente de recepción, quiero identificar cómo se compone la tarifa consultada, para entender el precio antes de confirmar la reserva.

**Por qué esta prioridad**: La transparencia reduce errores de cobro y permite que el valor mostrado en la consulta pueda compararse con la liquidación posterior.

**Prueba independiente**: Se puede probar una consulta que incluya cualquiera de las tres temporadas y verificar que el resultado identifique la tarifa base, el ajuste dinámico, el valor por noche, los impuestos y el total, sin necesidad de crear una reserva.

**Escenarios de aceptación**:

1. **Escenario**: Mostrar el desglose de la tarifa
   - **Dado** que la tarifa consultada tiene una tarifa base y una regla dinámica aplicable a la temporada baja, regular o alta
   - **Cuando** el usuario solicita la consulta
   - **Entonces** el sistema muestra la tarifa base, la condición de temporada aplicable, el porcentaje de ajuste, el valor de cada noche y el total del hospedaje, incluidos los impuestos aplicables

2. **Escenario**: Mantener la consistencia del valor consultado
   - **Dado** que el usuario consulta una tarifa para unas fechas y un tipo de habitación determinados
   - **Cuando** revisa el resultado de la consulta
   - **Entonces** el sistema identifica las fechas, el tipo de habitación, la moneda y la vigencia del valor mostrado

---

### Caso borde - Imposibilidad de calcular la tarifa

Cuando la consulta contiene fechas inválidas o una configuración tarifaria incompleta, el sistema debe informar la causa y evitar presentar un total engañoso.

**Prueba independiente**: Se puede probar una consulta con fechas inválidas, una habitación sin tarifa configurada y una fecha sin porcentaje dinámico definido, verificando que cada situación sea rechazada con un mensaje accionable y sin total definitivo.

**Escenarios de aceptación**:

1. **Escenario**: Fechas inválidas
   - **Dado** que la fecha de entrada no es anterior a la fecha de salida o que alguna fecha no tiene un formato válido
   - **Cuando** el usuario intenta consultar la tarifa
   - **Entonces** el sistema rechaza la consulta, explica el error y no muestra un precio total

2. **Escenario**: Tarifa base inexistente
   - **Dado** que el tipo de habitación seleccionado no tiene una tarifa base vigente
   - **Cuando** el usuario intenta consultar la tarifa
   - **Entonces** el sistema informa que no es posible calcular el precio y no sustituye la tarifa faltante por cero

3. **Escenario**: Regla dinámica no definida
   - **Dado** que una fecha está marcada como temporada baja, regular o alta pero no tiene una regla dinámica completa
   - **Cuando** el usuario consulta la tarifa
   - **Entonces** el sistema informa que la tarifa requiere configuración y no confirma un valor parcial como definitivo

### Casos límite

- La fecha de entrada coincide con el inicio de una temporada: la regla aplicable debe estar definida sin ambigüedad.
- La fecha de salida coincide con el inicio de una temporada: solo deben cobrarse las noches efectivamente incluidas en la estancia.
- La estancia cruza varios períodos de temporada: cada noche debe asociarse a un único período y regla, y el total debe prorratearse según los días comprendidos en cada período.

- Existen períodos de temporada solapados: para una consulta de un solo día se aplica el porcentaje correspondiente a la temporada de mayor tarifa; para una consulta de varios días se prorratea el valor según la participación de cada período aplicable.
- La consulta tiene una estancia de una sola noche: debe aceptarse cuando la fecha de salida sea el día siguiente a la entrada.
- La consulta contiene fechas pasadas: el sistema debe indicar si permite consultar históricamente la tarifa o si exige fechas actuales o futuras.
- La habitación está en mantenimiento, bloqueada u ocupada: el sistema debe diferenciar la disponibilidad de la consulta de tarifa y no presentar una tarifa como garantía de reserva.
- No existe una regla para la temporada baja, regular o alta de las fechas: el sistema debe indicar que la tarifa requiere configuración y no mostrar un total definitivo.
- La tarifa base está configurada con un valor no válido: la consulta debe rechazarse y el problema debe quedar disponible para su corrección administrativa.
- La moneda o los impuestos aplicables no están configurados: el sistema debe indicarlo y evitar presentar un total que pueda confundirse con el total final de cobro.

## Requisitos _(obligatorio)_

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir seleccionar un tipo de habitación y proporcionar una fecha de entrada y una fecha de salida para consultar la tarifa.
- **FR-002**: El sistema DEBE validar que las fechas sean válidas y que la fecha de entrada sea anterior a la fecha de salida.
- **FR-003**: El sistema DEBE determinar el número de noches a partir de las fechas de entrada y salida solicitadas.
- **FR-004**: El sistema DEBE utilizar la tarifa base configurada para el tipo de habitación seleccionado como valor inicial del cálculo.
- **FR-005**: El sistema DEBE identificar si cada noche pertenece a un período configurado de temporada baja, regular o alta.
- **FR-006**: El sistema DEBE aplicar el porcentaje de ajuste asociado a cada período de temporada correspondiente.
- **FR-007**: El sistema DEBE calcular cada noche de forma independiente cuando la estancia atraviese períodos de temporada baja, regular y alta.
- **FR-008**: El sistema DEBE presentar los valores nocturnos y el valor total del hospedaje solicitado.
- **FR-009**: El sistema DEBE identificar en el resultado el tipo de habitación, las fechas solicitadas, la condición tarifaria, la moneda y la vigencia de la tarifa.
- **FR-010**: El sistema DEBE distinguir una consulta de tarifa de una reserva; mostrar una tarifa NO DEBE bloquear inventario ni confirmar disponibilidad.
- **FR-011**: El sistema DEBE rechazar la consulta cuando falte la tarifa base o la regla dinámica requerida, o cuando sea inválida o incompleta.
- **FR-012**: El sistema DEBE proporcionar un mensaje de error accionable cuando no pueda calcularse la consulta.
- **FR-013**: El sistema DEBE incluir los impuestos aplicables tanto en la consulta como en la liquidación final, y evitar mostrar un total definitivo cuando la moneda, el tratamiento tributario u otro componente requerido no esté configurado.
- **FR-014**: El sistema DEBE conservar suficiente detalle tarifario para comparar el valor consultado con el importe de hospedaje utilizado en la liquidación final.
- **FR-015**: El sistema DEBE conservar una trazabilidad anual de la tarifa base, los porcentajes de temporada, los impuestos y los resultados consultados para fines financieros.

### Entidades clave _(incluir si la funcionalidad maneja datos)_

- **Tipo de habitación**: Categoría de alojamiento consultada, con identificación, capacidad, servicios incluidos y tarifa base.
- **Tarifa base**: Valor regular asociado a un tipo de habitación y a un período de vigencia.
- **Período de temporada**: Rango de fechas que clasifica las noches como temporada baja, regular o alta.
- **Regla de tarifa dinámica**: Porcentaje configurable que ajusta la tarifa base durante un período de temporada baja, regular o alta.
- **Consulta de tarifa**: Solicitud con tipo de habitación, fechas, moneda y resultado calculado o motivo de rechazo.
- **Detalle de tarifa**: Valor calculado para cada noche, condición de temporada aplicada y total de hospedaje.

### Reglas de negocio

- **BR-001**: El total del hospedaje debe corresponder a la suma de las tarifas de las noches comprendidas entre la fecha de entrada, inclusive, y la fecha de salida, sin incluirla.
- **BR-002**: Una noche debe resolverse con una única tarifa efectiva. Si existen períodos solapados y la consulta corresponde a un solo día, debe aplicarse la regla de la temporada con mayor tarifa.
- **BR-003**: Si la consulta comprende varios días con períodos solapados, el importe debe prorratearse según la participación de cada período aplicable.
- **BR-004**: La tarifa consultada debe diferenciar el valor del hospedaje de las comisiones de OTA y de los impuestos, que deben mostrarse tanto en la consulta como en la liquidación final según sus reglas.
- **BR-005**: La disponibilidad de una habitación no queda garantizada por consultar su tarifa.
- **BR-006**: El redondeo debe ser consistente entre el detalle por noche y el total mostrado.
- **BR-007**: El porcentaje exacto del ajuste de cada temporada debe ser configurable por el negocio.
- **BR-008**: La tarifa base, los porcentajes de temporada, los impuestos y los resultados de consulta deben conservar trazabilidad durante al menos un año calendario para fines del área de finanzas.

## Requisitos no funcionales

- **NFR-001**: La respuesta de una consulta válida debe mostrarse en un tiempo que permita una interacción fluida durante el proceso de reserva.
- **NFR-002**: El cálculo debe producir el mismo resultado para los mismos datos de entrada, reglas vigentes y moneda.
- **NFR-003**: El resultado no debe exponer información personal de huéspedes ni datos que no sean necesarios para consultar la tarifa.
- **NFR-004**: Los errores de configuración deben poder identificarse mediante mensajes comprensibles para el usuario operativo.
- **NFR-005**: La solución debe soportar consultas que atraviesen múltiples períodos de temporada sin degradar la exactitud del desglose.

## Criterios de éxito _(obligatorio)_

### Resultados medibles

- **SC-001**: El 100% de las consultas con fechas válidas, tarifa base vigente y reglas completas devuelve el desglose por noche y el total correcto.
- **SC-002**: El 100% de las consultas que atraviesan temporada baja, regular y alta aplica la regla correspondiente a cada noche, sin clasificaciones ambiguas.
- **SC-003**: El 100% de las consultas con datos inválidos o configuración incompleta informa el motivo y evita mostrar un total definitivo.
- **SC-004**: Al menos el 95% de los usuarios de recepción puede obtener una tarifa válida en su primer intento durante una prueba de aceptación.
- **SC-005**: El valor de hospedaje consultado coincide con el valor utilizado para la liquidación en el 100% de las reservas que conservan las mismas fechas, habitación y reglas vigentes.
- **SC-006**: Ninguna consulta de tarifa produce por sí sola una reserva, bloqueo de inventario o confirmación de disponibilidad.
