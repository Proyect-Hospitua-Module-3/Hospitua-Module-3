# Feature Specification: Revisar temporada del año

**Created**: 2026-09-04  

## Business Objectives

- Mantener un calendario confiable para identificar los períodos de temporada regular y temporada alta.
- Evitar cálculos de tarifas ambiguos causados por períodos solapados, fechas inválidas o reglas incompletas.
- Permitir que el personal autorizado revise la configuración antes de que afecte reservas, consultas y liquidaciones.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Revisar el calendario de temporadas (Priority: P1)

Como responsable de la operación hotelera, quiero consultar los períodos de temporada configurados, para conocer qué fechas tienen una condición de temporada alta y qué regla dinámica les corresponde.

**Why this priority**: El calendario de temporadas controla la aplicación de tarifas dinámicas y debe ser visible antes de que se utilice en el cálculo de hospedaje.

**Independent Test**: Se puede abrir la revisión del calendario y verificar que cada período muestre sus fechas, clasificación, estado, regla asociada y posibles advertencias sin necesidad de ejecutar una reserva.

**Acceptance Scenarios**:

1. **Scenario**: Revisar un período configurado
	- **Given** que existe un período de temporada con fechas de inicio y fin, clasificación y regla dinámica configuradas
	- **When** el usuario revisa el calendario
	- **Then** el sistema muestra la información completa del período y su vigencia

2. **Scenario**: Identificar temporadas por fecha
	- **Given** que el calendario contiene períodos regulares y de temporada alta
	- **When** el usuario revisa una fecha determinada
	- **Then** el sistema indica la temporada aplicable y la regla dinámica asociada, si existe

3. **Scenario**: Revisar períodos futuros
	- **Given** que existen períodos configurados para fechas futuras
	- **When** el usuario consulta el calendario para un rango futuro
	- **Then** el sistema muestra los períodos aplicables ordenados cronológicamente y su estado de configuración

---

### User Story 2 - Validar la consistencia del calendario (Priority: P1)

Como responsable de tarifas, quiero validar el calendario de temporadas, para detectar conflictos antes de que afecten el precio de una habitación.

**Why this priority**: Una configuración inconsistente puede asignar dos reglas a la misma noche o dejar noches de temporada alta sin un ajuste válido.

**Independent Test**: Se puede ejecutar la validación sobre un calendario con períodos válidos, solapados y con reglas incompletas, y comprobar que cada caso reciba el estado y mensaje correspondiente.

**Acceptance Scenarios**:

1. **Scenario**: Calendario válido
	- **Given** que los períodos tienen fechas válidas, no se solapan y las temporadas altas tienen reglas completas
	- **When** el usuario valida el calendario
	- **Then** el sistema lo marca como válido y no muestra advertencias críticas

2. **Scenario**: Períodos solapados
	- **Given** que dos períodos asignan condiciones incompatibles a una misma fecha
	- **When** el usuario valida el calendario
	- **Then** el sistema identifica los períodos en conflicto, las fechas afectadas y bloquea su uso para calcular tarifas hasta resolverlos

3. **Scenario**: Temporada alta sin regla
	- **Given** que un período está marcado como temporada alta pero no tiene una regla dinámica completa
	- **When** el usuario valida el calendario
	- **Then** el sistema lo marca como incompleto e indica qué configuración falta

---

### User Story 3 - Corregir y confirmar la configuración de temporada (Priority: P2)

Como usuario autorizado, quiero crear, modificar o desactivar períodos de temporada, para mantener actualizado el calendario según la operación del hotel.

**Why this priority**: La revisión debe permitir mantener la fuente de verdad del calendario, pero los cambios necesitan control para no introducir tarifas ambiguas.

**Independent Test**: Se puede crear o modificar un período, ejecutar la validación y confirmar que solo una configuración válida pueda quedar activa para los cálculos futuros.

**Acceptance Scenarios**:

1. **Scenario**: Guardar un período válido
	- **Given** que el usuario autorizado proporciona fechas válidas, una clasificación y la regla requerida
	- **When** guarda el período
	- **Then** el sistema valida la configuración, la registra y la deja disponible según su vigencia

2. **Scenario**: Rechazar un período inválido
	- **Given** que la fecha de inicio es posterior o igual a la fecha de fin, o faltan datos obligatorios
	- **When** el usuario intenta guardar el período
	- **Then** el sistema rechaza el cambio, explica los errores y conserva la configuración anterior

3. **Scenario**: Desactivar un período
	- **Given** que existe un período que ya no debe aplicarse a nuevas consultas
	- **When** el usuario autorizado lo desactiva
	- **Then** el sistema conserva su historial, evita aplicarlo a cálculos futuros y muestra el cambio de estado

### Edge Cases

- La fecha de inicio coincide con la fecha de fin: el período debe rechazarse porque no contiene noches.
- La fecha de inicio es posterior a la fecha de fin: el período debe rechazarse.
- Dos temporadas altas comparten exactamente una fecha: el sistema debe detectarlo como conflicto si las reglas son incompatibles.
- Un período termina el mismo día que otro comienza: debe aplicarse una convención clara de fechas y no debe existir doble clasificación para la misma noche.
- Un período de temporada alta no tiene ajuste, moneda o vigencia completa: debe quedar incompleto y no utilizarse para calcular tarifas.
- Existen períodos de años diferentes con el mismo rango de mes y día: el sistema debe diferenciarlos por año o por la periodicidad explícitamente configurada.
- Un período pasado se modifica: el sistema debe preservar la trazabilidad histórica y evitar alterar silenciosamente cálculos ya confirmados.
- Se intenta desactivar el único período que cubre una fecha futura: el sistema debe advertir si el cambio dejará fechas sin configuración requerida.
- El usuario no tiene permisos de administración: puede revisar la configuración según su rol, pero no modificarla.
- El calendario está vacío: el sistema debe informar que no hay temporadas configuradas y explicar el efecto sobre el cálculo de tarifas.
- La zona horaria del hotel afecta el cambio de fecha: la clasificación debe utilizar la zona horaria oficial del establecimiento.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow authorized users to review the configured season periods for a selected date range or year.
- **FR-002**: System MUST display for each period its start date, end date, classification, status, applicable room scope if any, and associated dynamic pricing rule.
- **FR-003**: System MUST identify the season and applicable rule for a requested date according to the active calendar.
- **FR-004**: System MUST validate that every period has valid dates and that its start date precedes its end date.
- **FR-005**: System MUST detect overlapping periods that could assign incompatible classifications or pricing rules to the same date.
- **FR-006**: System MUST detect high-season periods without a complete dynamic pricing rule.
- **FR-007**: System MUST report each validation issue with the affected period, date range, severity, and corrective information.
- **FR-008**: System MUST allow authorized users to create, update, activate, and deactivate season periods.
- **FR-009**: System MUST validate a period before saving it or activating it.
- **FR-010**: System MUST reject invalid or conflicting changes without replacing the last valid configuration.
- **FR-011**: System MUST preserve the history of changes to season periods, including the actor, date, previous value, new value, and reason when provided.
- **FR-012**: System MUST distinguish active, inactive, pending-validation, and invalid configurations.
- **FR-013**: System MUST prevent invalid or unresolved season configurations from being used in dynamic tariff calculations.
- **FR-014**: System MUST distinguish the season calendar from room availability; reviewing or modifying a season MUST NOT reserve or block a room.
- **FR-015**: System MUST apply the hotel's official time zone when determining date boundaries.
- **FR-016**: System MUST preserve historical tariff context when a season configuration changes after a calculation or reservation has been confirmed.
- **FR-017**: System MUST show a clear message when no season configuration exists for the requested date range.

### Key Entities *(include if feature involves data)*

- **Período de temporada**: Rango de fechas que clasifica noches como temporada regular o temporada alta.
- **Calendario de temporadas**: Conjunto ordenado de períodos activos que determina la condición aplicable a cada fecha.
- **Regla de tarifa dinámica**: Configuración que define el ajuste asociado a un período de temporada alta.
- **Resultado de revisión**: Estado de validez del calendario, advertencias, errores y fechas afectadas.
- **Historial de configuración**: Registro de cambios realizados sobre un período, su autor, momento y valores anteriores y nuevos.
- **Usuario autorizado**: Actor con permisos para revisar o modificar la configuración según su rol.

### Business Rules

- **BR-001**: Un período debe tener una fecha de inicio anterior a su fecha de fin y debe representar al menos una noche.
- **BR-002**: La fecha de inicio se considera incluida y la fecha de fin se considera excluida al clasificar noches, de forma consistente con el cálculo de hospedaje.
- **BR-003**: Una noche no puede quedar asociada a dos períodos activos incompatibles.
- **BR-004**: Todo período marcado como temporada alta debe tener una regla dinámica completa y vigente antes de utilizarse en el cálculo.
- **BR-005**: Los períodos inactivos o inválidos no deben afectar nuevas consultas ni cálculos de tarifa.
- **BR-006**: Un cambio de configuración no debe modificar retroactivamente el valor de una reserva o liquidación ya confirmada.
- **BR-007**: La clasificación de fechas debe realizarse según la zona horaria oficial del hotel.
- **BR-008**: La disponibilidad, ocupación y estado físico de una habitación son independientes de la clasificación de temporada.
- **BR-009**: La política para períodos que atraviesan años debe estar definida explícitamente y no inferirse de forma ambigua.

### Open Questions

- **OQ-001**: [NEEDS CLARIFICATION: confirmar si la fecha de fin se manejará siempre como exclusiva o si la administración usará fechas inclusivas en pantalla].
- **OQ-002**: [NEEDS CLARIFICATION: definir si las temporadas se configuran por año específico, como períodos recurrentes o con ambas modalidades].
- **OQ-003**: [NEEDS CLARIFICATION: definir si pueden coexistir temporadas por hotel, tipo de habitación o canal de venta].
- **OQ-004**: [NEEDS CLARIFICATION: definir los roles autorizados para crear, modificar, activar y desactivar períodos].
- **OQ-005**: [NEEDS CLARIFICATION: definir si un calendario sin temporada alta debe aplicar automáticamente la tarifa base o requiere una configuración explícita de temporada regular].
- **OQ-006**: [NEEDS CLARIFICATION: definir la política para cambios sobre períodos ya usados en reservas o cálculos confirmados].
- **OQ-007**: [NEEDS CLARIFICATION: definir la zona horaria oficial de cada establecimiento si la plataforma opera con múltiples hoteles].

## Non-Functional Requirements

- **NFR-001**: La revisión del calendario debe mostrar resultados en un tiempo adecuado para la operación diaria del hotel.
- **NFR-002**: La validación debe ser determinista: la misma configuración debe producir el mismo resultado y las mismas advertencias.
- **NFR-003**: Los mensajes de error deben ser comprensibles para usuarios operativos y suficientemente precisos para corregir la configuración.
- **NFR-004**: Los cambios de configuración deben conservar trazabilidad y ser consultables por usuarios autorizados.
- **NFR-005**: El sistema debe mantener la consistencia del calendario al revisar períodos que cubren múltiples años o rangos extensos.
- **NFR-006**: La información de configuración debe protegerse según el rol del usuario y no debe exponer datos personales innecesarios.
- **NFR-007**: La revisión y validación no deben producir cambios colaterales en reservas, disponibilidad o estados de habitaciones.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los períodos activos mostrados incluye fechas, clasificación, estado y regla dinámica aplicable o una advertencia explícita si está incompleto.
- **SC-002**: El 100% de los períodos con fechas inválidas o solapamientos incompatibles se identifica antes de poder activarse.
- **SC-003**: El 100% de las fechas consultadas con configuración activa devuelve una única clasificación de temporada o un error explícito de configuración.
- **SC-004**: El 100% de los cambios aceptados queda registrado con usuario, fecha y valores modificados.
- **SC-005**: El 100% de los cambios inválidos conserva la última configuración válida y no afecta cálculos futuros.
- **SC-006**: Al menos el 95% de los usuarios autorizados puede identificar y corregir un conflicto de calendario en una prueba de aceptación.
- **SC-007**: Ninguna revisión, validación o modificación del calendario altera por sí sola la disponibilidad, reserva o bloqueo de una habitación.
