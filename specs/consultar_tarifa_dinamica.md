# Feature Specification: Consultar tarifa dinámica

**Created**: 2026-09-04  

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consultar el precio de una estancia (Priority: P1)

Como huésped o agente de recepción, quiero consultar el precio de una habitación para unas fechas específicas, para conocer cuánto cuesta la estancia antes de continuar con la reserva.

**Why this priority**: La consulta de tarifa es la capacidad principal del caso de uso y permite tomar una decisión de reserva con un valor calculado de forma consistente.

**Independent Test**: Se puede probar proporcionando un tipo de habitación, una fecha de entrada y una fecha de salida válidas, y verificando que el sistema devuelva la tarifa aplicable por noche y el total de la estancia.

**Acceptance Scenarios**:

1. **Scenario**: Consultar una estancia en temporada regular
	- **Given** que existe una habitación con tarifa base configurada y las fechas solicitadas no pertenecen a temporada alta
	- **When** el usuario consulta la tarifa para una fecha de entrada y una fecha de salida válidas
	- **Then** el sistema muestra la tarifa base aplicable a cada noche y el total correspondiente al número de noches

2. **Scenario**: Consultar una estancia en temporada alta
	- **Given** que existe una habitación con tarifa base configurada y al menos una noche solicitada pertenece a un período de temporada alta
	- **When** el usuario consulta la tarifa
	- **Then** el sistema aplica la regla de tarifa dinámica definida para la temporada alta y muestra el desglose por noche y el total de la estancia

3. **Scenario**: Consultar fechas con tarifas diferentes
	- **Given** que la estancia atraviesa períodos con reglas de tarifa distintas
	- **When** el usuario consulta la tarifa
	- **Then** el sistema calcula cada noche con la regla que corresponde a su fecha y suma los valores para obtener el total

---

### User Story 2 - Consultar una tarifa transparente para la reserva (Priority: P2)

Como huésped o agente de recepción, quiero identificar cómo se compone la tarifa consultada, para entender el precio antes de confirmar la reserva.

**Why this priority**: La transparencia reduce errores de cobro y permite que el valor mostrado en la consulta pueda compararse con la liquidación posterior.

**Independent Test**: Se puede probar una consulta que incluya temporada alta y verificar que el resultado identifique la tarifa base, el ajuste dinámico, el valor por noche y el total, sin necesidad de crear una reserva.

**Acceptance Scenarios**:

1. **Scenario**: Mostrar el desglose de la tarifa
	- **Given** que la tarifa consultada tiene una tarifa base y una regla dinámica aplicable
	- **When** el usuario solicita la consulta
	- **Then** el sistema muestra la tarifa base, la condición de temporada aplicable, el valor de cada noche y el total del hospedaje

2. **Scenario**: Mantener la consistencia del valor consultado
	- **Given** que el usuario consulta una tarifa para unas fechas y un tipo de habitación determinados
	- **When** revisa el resultado de la consulta
	- **Then** el sistema identifica las fechas, el tipo de habitación, la moneda y la vigencia del valor mostrado

---

### User Story 3 - Informar cuando no es posible calcular la tarifa (Priority: P1)

Como huésped o agente de recepción, quiero recibir un mensaje claro cuando la consulta no pueda calcularse, para corregir los datos o solicitar asistencia.

**Why this priority**: Un resultado incompleto o ambiguo puede producir reservas con valores incorrectos y afectar la facturación.

**Independent Test**: Se puede probar enviando fechas inválidas, una habitación sin tarifa configurada y fechas sin una regla dinámica definida, verificando que el sistema informe la causa sin mostrar un total engañoso.

**Acceptance Scenarios**:

1. **Scenario**: Fechas inválidas
	- **Given** que la fecha de entrada no es anterior a la fecha de salida o que alguna fecha no tiene un formato válido
	- **When** el usuario intenta consultar la tarifa
	- **Then** el sistema rechaza la consulta, explica el error y no muestra un precio total

2. **Scenario**: Tarifa base inexistente
	- **Given** que el tipo de habitación seleccionado no tiene una tarifa base vigente
	- **When** el usuario intenta consultar la tarifa
	- **Then** el sistema informa que no es posible calcular el precio y no sustituye la tarifa faltante por cero

3. **Scenario**: Regla dinámica no definida
	- **Given** que una fecha está marcada como temporada alta pero no tiene una regla dinámica completa
	- **When** el usuario consulta la tarifa
	- **Then** el sistema informa que la tarifa requiere configuración y no confirma un valor parcial como definitivo

### Edge Cases

- La fecha de entrada coincide con el inicio de temporada alta: la regla aplicable debe estar definida sin ambigüedad.
- La fecha de salida coincide con el inicio de temporada alta: solo deben cobrarse las noches efectivamente incluidas en la estancia.
- La estancia cruza varios períodos de temporada: cada noche debe asociarse a un único período y regla.
- La consulta tiene una estancia de una sola noche: debe aceptarse cuando la fecha de salida sea el día siguiente a la entrada.
- La consulta contiene fechas pasadas: el sistema debe indicar si permite consultar históricamente la tarifa o si exige fechas actuales o futuras.
- La habitación está en mantenimiento, bloqueada u ocupada: el sistema debe diferenciar la disponibilidad de la consulta de tarifa y no presentar una tarifa como garantía de reserva.
- No existe una regla de temporada alta para las fechas: debe aplicarse la tarifa regular configurada, salvo que la política del hotel indique lo contrario.
- La tarifa base está configurada con un valor no válido: la consulta debe rechazarse y el problema debe quedar disponible para su corrección administrativa.
- La moneda o los impuestos aplicables no están configurados: el sistema debe indicarlo y evitar presentar un total que pueda confundirse con el total final de cobro.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow the user to select a type of room and provide a date of entry and a date of exit for the tariff query.
- **FR-002**: System MUST validate that the dates are valid and that the date of entry is earlier than the date of exit.
- **FR-003**: System MUST determine the number of nights from the requested entry and exit dates.
- **FR-004**: System MUST use the configured base tariff for the selected room type as the starting value for the calculation.
- **FR-005**: System MUST identify whether each night belongs to a configured high-season period.
- **FR-006**: System MUST apply the dynamic tariff rule associated with each applicable high-season period.
- **FR-007**: System MUST calculate each night independently when a stay crosses regular and high-season periods.
- **FR-008**: System MUST present the nightly values and the total lodging value for the requested stay.
- **FR-009**: System MUST identify the selected room type, requested dates, applicable tariff condition, currency, and tariff validity in the result.
- **FR-010**: System MUST distinguish a tariff inquiry from a room reservation; displaying a tariff MUST NOT block inventory or confirm availability.
- **FR-011**: System MUST reject the inquiry when the base tariff or required dynamic rule is missing, invalid, or incomplete.
- **FR-012**: System MUST provide an actionable error message when the inquiry cannot be calculated.
- **FR-013**: System MUST avoid showing a definitive total when currency, tax treatment, or another required pricing component is not configured.
- **FR-014**: System MUST preserve sufficient tariff detail for the value consulted to be compared with the lodging amount used in the final settlement.

### Key Entities *(include if feature involves data)*

- **Tipo de habitación**: Categoría de alojamiento consultada, con identificación, capacidad, servicios incluidos y tarifa base.
- **Tarifa base**: Valor regular asociado a un tipo de habitación y a un período de vigencia.
- **Período de temporada**: Rango de fechas que clasifica las noches como temporada regular o temporada alta.
- **Regla de tarifa dinámica**: Condición de negocio que determina cómo se ajusta la tarifa base durante un período de temporada alta.
- **Consulta de tarifa**: Solicitud con tipo de habitación, fechas, moneda y resultado calculado o motivo de rechazo.
- **Detalle de tarifa**: Valor calculado para cada noche, condición de temporada aplicada y total de hospedaje.

### Business Rules

- **BR-001**: El total del hospedaje debe corresponder a la suma de las tarifas de las noches comprendidas entre la fecha de entrada, inclusive, y la fecha de salida, exclusive.
- **BR-002**: Una noche no puede recibir simultáneamente dos reglas dinámicas; los períodos de temporada aplicables deben resolverse sin solapamientos.
- **BR-003**: La tarifa consultada debe diferenciar el valor del hospedaje de las comisiones de OTA y de los impuestos, que se liquidan según sus propias reglas.
- **BR-004**: La disponibilidad de una habitación no queda garantizada por consultar su tarifa.
- **BR-005**: El redondeo debe ser consistente entre el detalle por noche y el total mostrado.
- **BR-006**: El valor o porcentaje exacto del ajuste de temporada alta debe ser configurable por el negocio.

### Open Questions

- **OQ-001**: [NEEDS CLARIFICATION: definir si la tarifa dinámica se expresa como porcentaje sobre la tarifa base, valor fijo adicional u otra regla].
- **OQ-002**: [NEEDS CLARIFICATION: definir si los impuestos se muestran dentro del total de la consulta o solamente en la liquidación final].
- **OQ-003**: [NEEDS CLARIFICATION: definir las monedas admitidas y la política de redondeo aplicable].
- **OQ-004**: [NEEDS CLARIFICATION: definir si se permiten consultas de fechas pasadas y por cuánto tiempo se conserva la vigencia histórica].
- **OQ-005**: [NEEDS CLARIFICATION: definir qué debe ocurrir ante períodos de temporada solapados o reglas contradictorias].

## Non-Functional Requirements

- **NFR-001**: La respuesta de una consulta válida debe mostrarse en un tiempo que permita una interacción fluida durante el proceso de reserva.
- **NFR-002**: El cálculo debe producir el mismo resultado para los mismos datos de entrada, reglas vigentes y moneda.
- **NFR-003**: El resultado no debe exponer información personal de huéspedes ni datos que no sean necesarios para consultar la tarifa.
- **NFR-004**: Los errores de configuración deben poder identificarse mediante mensajes comprensibles para el usuario operativo.
- **NFR-005**: La solución debe soportar consultas que atraviesen múltiples períodos de temporada sin degradar la exactitud del desglose.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las consultas con fechas válidas, tarifa base vigente y reglas completas devuelve el desglose por noche y el total correcto.
- **SC-002**: El 100% de las consultas que atraviesan temporada regular y alta aplica la regla correspondiente a cada noche, sin clasificaciones ambiguas.
- **SC-003**: El 100% de las consultas con datos inválidos o configuración incompleta informa el motivo y evita mostrar un total definitivo.
- **SC-004**: Al menos el 95% de los usuarios de recepción puede obtener una tarifa válida en su primer intento durante una prueba de aceptación.
- **SC-005**: El valor de hospedaje consultado coincide con el valor utilizado para la liquidación en el 100% de las reservas que conservan las mismas fechas, habitación y reglas vigentes.
- **SC-006**: Ninguna consulta de tarifa produce por sí sola una reserva, bloqueo de inventario o confirmación de disponibilidad.
