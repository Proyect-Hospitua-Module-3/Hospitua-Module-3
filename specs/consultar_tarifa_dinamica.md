# Especificación de funcionalidad: Consultar tarifa dinámica

**Creado**: 2026-09-04  

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Consultar el precio de una estancia (Prioridad: P1)

Como huésped o agente de recepción, quiero consultar el precio de una habitación para unas fechas específicas, para conocer cuánto cuesta la estancia antes de continuar con la reserva.

**Por qué esta prioridad**: La consulta de tarifa es la capacidad principal del caso de uso y permite tomar una decisión de reserva con un valor calculado de forma consistente.

**Prueba independiente**: Se puede probar proporcionando un tipo de habitación, una fecha de entrada y una fecha de salida válidas, y verificando que el sistema devuelva la tarifa aplicable por noche y el total de la estancia.

**Escenarios de aceptación**:

1. **Escenario**: Consultar una estancia en temporada regular
	- **Dado** que existe una habitación con tarifa base configurada y las fechas solicitadas no pertenecen a temporada alta
	- **Cuando** el usuario consulta la tarifa para una fecha de entrada y una fecha de salida válidas
	- **Entonces** el sistema muestra la tarifa base aplicable a cada noche y el total correspondiente al número de noches

2. **Escenario**: Consultar una estancia en temporada alta
	- **Dado** que existe una habitación con tarifa base configurada y al menos una noche solicitada pertenece a un período de temporada alta
	- **Cuando** el usuario consulta la tarifa
	- **Entonces** el sistema aplica la regla de tarifa dinámica definida para la temporada alta y muestra el desglose por noche y el total de la estancia

3. **Escenario**: Consultar fechas con tarifas diferentes
	- **Dado** que la estancia atraviesa períodos con reglas de tarifa distintas
	- **Cuando** el usuario consulta la tarifa
	- **Entonces** el sistema calcula cada noche con la regla que corresponde a su fecha y suma los valores para obtener el total

---

### Historia de usuario 2 - Consultar una tarifa transparente para la reserva (Prioridad: P2)

Como huésped o agente de recepción, quiero identificar cómo se compone la tarifa consultada, para entender el precio antes de confirmar la reserva.

**Por qué esta prioridad**: La transparencia reduce errores de cobro y permite que el valor mostrado en la consulta pueda compararse con la liquidación posterior.

**Prueba independiente**: Se puede probar una consulta que incluya temporada alta y verificar que el resultado identifique la tarifa base, el ajuste dinámico, el valor por noche y el total, sin necesidad de crear una reserva.

**Escenarios de aceptación**:

1. **Escenario**: Mostrar el desglose de la tarifa
	- **Dado** que la tarifa consultada tiene una tarifa base y una regla dinámica aplicable
	- **Cuando** el usuario solicita la consulta
	- **Entonces** el sistema muestra la tarifa base, la condición de temporada aplicable, el valor de cada noche y el total del hospedaje

2. **Escenario**: Mantener la consistencia del valor consultado
	- **Dado** que el usuario consulta una tarifa para unas fechas y un tipo de habitación determinados
	- **Cuando** revisa el resultado de la consulta
	- **Entonces** el sistema identifica las fechas, el tipo de habitación, la moneda y la vigencia del valor mostrado

---

### Historia de usuario 3 - Informar cuando no es posible calcular la tarifa (Prioridad: P1)

Como huésped o agente de recepción, quiero recibir un mensaje claro cuando la consulta no pueda calcularse, para corregir los datos o solicitar asistencia.

**Por qué esta prioridad**: Un resultado incompleto o ambiguo puede producir reservas con valores incorrectos y afectar la facturación.

**Prueba independiente**: Se puede probar enviando fechas inválidas, una habitación sin tarifa configurada y fechas sin una regla dinámica definida, verificando que el sistema informe la causa sin mostrar un total engañoso.

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
	- **Dado** que una fecha está marcada como temporada alta pero no tiene una regla dinámica completa
	- **Cuando** el usuario consulta la tarifa
	- **Entonces** el sistema informa que la tarifa requiere configuración y no confirma un valor parcial como definitivo

### Casos límite

- La fecha de entrada coincide con el inicio de temporada alta: la regla aplicable debe estar definida sin ambigüedad.
- La fecha de salida coincide con el inicio de temporada alta: solo deben cobrarse las noches efectivamente incluidas en la estancia.
- La estancia cruza varios períodos de temporada: cada noche debe asociarse a un único período y regla.
- La consulta tiene una estancia de una sola noche: debe aceptarse cuando la fecha de salida sea el día siguiente a la entrada.
- La consulta contiene fechas pasadas: el sistema debe indicar si permite consultar históricamente la tarifa o si exige fechas actuales o futuras.
- La habitación está en mantenimiento, bloqueada u ocupada: el sistema debe diferenciar la disponibilidad de la consulta de tarifa y no presentar una tarifa como garantía de reserva.
- No existe una regla de temporada alta para las fechas: debe aplicarse la tarifa regular configurada, salvo que la política del hotel indique lo contrario.
- La tarifa base está configurada con un valor no válido: la consulta debe rechazarse y el problema debe quedar disponible para su corrección administrativa.
- La moneda o los impuestos aplicables no están configurados: el sistema debe indicarlo y evitar presentar un total que pueda confundirse con el total final de cobro.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir seleccionar un tipo de habitación y proporcionar una fecha de entrada y una fecha de salida para consultar la tarifa.
- **FR-002**: El sistema DEBE validar que las fechas sean válidas y que la fecha de entrada sea anterior a la fecha de salida.
- **FR-003**: El sistema DEBE determinar el número de noches a partir de las fechas de entrada y salida solicitadas.
- **FR-004**: El sistema DEBE utilizar la tarifa base configurada para el tipo de habitación seleccionado como valor inicial del cálculo.
- **FR-005**: El sistema DEBE identificar si cada noche pertenece a un período configurado de temporada alta.
- **FR-006**: El sistema DEBE aplicar la regla de tarifa dinámica asociada a cada período de temporada alta correspondiente.
- **FR-007**: El sistema DEBE calcular cada noche de forma independiente cuando la estancia atraviese períodos regulares y de temporada alta.
- **FR-008**: El sistema DEBE presentar los valores nocturnos y el valor total del hospedaje solicitado.
- **FR-009**: El sistema DEBE identificar en el resultado el tipo de habitación, las fechas solicitadas, la condición tarifaria, la moneda y la vigencia de la tarifa.
- **FR-010**: El sistema DEBE distinguir una consulta de tarifa de una reserva; mostrar una tarifa NO DEBE bloquear inventario ni confirmar disponibilidad.
- **FR-011**: El sistema DEBE rechazar la consulta cuando falte la tarifa base o la regla dinámica requerida, o cuando sea inválida o incompleta.
- **FR-012**: El sistema DEBE proporcionar un mensaje de error accionable cuando no pueda calcularse la consulta.
- **FR-013**: El sistema DEBE evitar mostrar un total definitivo cuando la moneda, el tratamiento tributario u otro componente requerido no esté configurado.
- **FR-014**: El sistema DEBE conservar suficiente detalle tarifario para comparar el valor consultado con el importe de hospedaje utilizado en la liquidación final.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Tipo de habitación**: Categoría de alojamiento consultada, con identificación, capacidad, servicios incluidos y tarifa base.
- **Tarifa base**: Valor regular asociado a un tipo de habitación y a un período de vigencia.
- **Período de temporada**: Rango de fechas que clasifica las noches como temporada regular o temporada alta.
- **Regla de tarifa dinámica**: Condición de negocio que determina cómo se ajusta la tarifa base durante un período de temporada alta.
- **Consulta de tarifa**: Solicitud con tipo de habitación, fechas, moneda y resultado calculado o motivo de rechazo.
- **Detalle de tarifa**: Valor calculado para cada noche, condición de temporada aplicada y total de hospedaje.

### Reglas de negocio

- **BR-001**: El total del hospedaje debe corresponder a la suma de las tarifas de las noches comprendidas entre la fecha de entrada, inclusive, y la fecha de salida, sin incluirla.
- **BR-002**: Una noche no puede recibir simultáneamente dos reglas dinámicas; los períodos de temporada aplicables deben resolverse sin solapamientos.
- **BR-003**: La tarifa consultada debe diferenciar el valor del hospedaje de las comisiones de OTA y de los impuestos, que se liquidan según sus propias reglas.
- **BR-004**: La disponibilidad de una habitación no queda garantizada por consultar su tarifa.
- **BR-005**: El redondeo debe ser consistente entre el detalle por noche y el total mostrado.
- **BR-006**: El valor o porcentaje exacto del ajuste de temporada alta debe ser configurable por el negocio.

### Preguntas abiertas

- **OQ-001**: [REQUIERE ACLARACIÓN: definir si la tarifa dinámica se expresa como porcentaje sobre la tarifa base, valor fijo adicional u otra regla].
- **OQ-002**: [REQUIERE ACLARACIÓN: definir si los impuestos se muestran dentro del total de la consulta o solamente en la liquidación final].
- **OQ-003**: [REQUIERE ACLARACIÓN: definir las monedas admitidas y la política de redondeo aplicable].
- **OQ-004**: [REQUIERE ACLARACIÓN: definir si se permiten consultas de fechas pasadas y por cuánto tiempo se conserva la vigencia histórica].
- **OQ-005**: [REQUIERE ACLARACIÓN: definir qué debe ocurrir ante períodos de temporada solapados o reglas contradictorias].

## Requisitos no funcionales

- **NFR-001**: La respuesta de una consulta válida debe mostrarse en un tiempo que permita una interacción fluida durante el proceso de reserva.
- **NFR-002**: El cálculo debe producir el mismo resultado para los mismos datos de entrada, reglas vigentes y moneda.
- **NFR-003**: El resultado no debe exponer información personal de huéspedes ni datos que no sean necesarios para consultar la tarifa.
- **NFR-004**: Los errores de configuración deben poder identificarse mediante mensajes comprensibles para el usuario operativo.
- **NFR-005**: La solución debe soportar consultas que atraviesen múltiples períodos de temporada sin degradar la exactitud del desglose.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las consultas con fechas válidas, tarifa base vigente y reglas completas devuelve el desglose por noche y el total correcto.
- **SC-002**: El 100% de las consultas que atraviesan temporada regular y alta aplica la regla correspondiente a cada noche, sin clasificaciones ambiguas.
- **SC-003**: El 100% de las consultas con datos inválidos o configuración incompleta informa el motivo y evita mostrar un total definitivo.
- **SC-004**: Al menos el 95% de los usuarios de recepción puede obtener una tarifa válida en su primer intento durante una prueba de aceptación.
- **SC-005**: El valor de hospedaje consultado coincide con el valor utilizado para la liquidación en el 100% de las reservas que conservan las mismas fechas, habitación y reglas vigentes.
- **SC-006**: Ninguna consulta de tarifa produce por sí sola una reserva, bloqueo de inventario o confirmación de disponibilidad.
