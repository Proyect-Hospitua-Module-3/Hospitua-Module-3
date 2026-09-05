# Feature Specification: Calcular tarifa dinámica

**Created**: 2026-09-04  

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Calcular la tarifa de una estancia (Priority: P1)

Como sistema de gestión hotelera, quiero calcular la tarifa de hospedaje para un tipo de habitación y un período determinado, para obtener un valor correcto según la tarifa base y la temporada aplicable.

**Why this priority**: El cálculo es la capacidad central que permite mostrar precios consistentes y alimentar posteriormente la reserva y la liquidación financiera.

**Independent Test**: Se puede proporcionar una tarifa base, un rango de fechas y un calendario de temporada, y comprobar que el resultado sea la suma de la tarifa aplicable a cada noche.

**Acceptance Scenarios**:

1. **Scenario**: Calcular una estancia en temporada regular
	- **Given** que el tipo de habitación tiene una tarifa base vigente y ninguna noche pertenece a temporada alta
	- **When** el sistema calcula la tarifa para el período solicitado
	- **Then** devuelve la tarifa base por cada noche y el total de hospedaje correspondiente

2. **Scenario**: Calcular una estancia en temporada alta
	- **Given** que el tipo de habitación tiene una tarifa base vigente y las noches solicitadas pertenecen a un período de temporada alta con una regla configurada
	- **When** el sistema calcula la tarifa
	- **Then** aplica el ajuste dinámico definido para cada noche de temporada alta y devuelve el total calculado

3. **Scenario**: Calcular una estancia que cruza temporadas
	- **Given** que el período contiene noches de temporada regular y de temporada alta
	- **When** el sistema calcula la tarifa
	- **Then** aplica a cada noche la regla que corresponde a su fecha y suma los resultados sin aplicar una única regla a toda la estancia

---

### User Story 2 - Entregar un desglose auditable del cálculo (Priority: P1)

Como agente de recepción o responsable de facturación, quiero consultar el desglose del cálculo, para verificar cómo se obtuvo el total antes de usarlo en una reserva o liquidación.

**Why this priority**: Un desglose verificable permite detectar errores de configuración y mantiene la trazabilidad entre la tarifa consultada y el valor facturado.

**Independent Test**: Se puede ejecutar un cálculo con al menos una noche regular y una noche de temporada alta, y verificar que el resultado incluya la fecha, la tarifa base, el ajuste y el valor final de cada noche.

**Acceptance Scenarios**:

1. **Scenario**: Mostrar los componentes del cálculo
	- **Given** que existe una tarifa base y una regla dinámica aplicable
	- **When** el sistema finaliza el cálculo
	- **Then** informa la tarifa base, la regla o condición de temporada, el valor resultante por noche y el total de hospedaje

2. **Scenario**: Mantener el mismo resultado con los mismos datos
	- **Given** que no han cambiado la tarifa base, las reglas, las fechas ni la moneda
	- **When** se ejecuta nuevamente el cálculo
	- **Then** el sistema devuelve el mismo resultado y el mismo desglose

---

### User Story 3 - Rechazar cálculos inválidos o incompletos (Priority: P1)

Como responsable de la operación hotelera, quiero que el sistema rechace cálculos con datos inconsistentes, para impedir que valores incorrectos lleguen a una reserva o a la facturación.

**Why this priority**: Un cálculo incorrecto afecta directamente los ingresos, la confianza del huésped y la liquidación con intermediarios.

**Independent Test**: Se puede ejecutar el cálculo con fechas inválidas, tarifa base inexistente, reglas incompletas o períodos solapados, y verificar que no devuelva un total definitivo.

**Acceptance Scenarios**:

1. **Scenario**: Rango de fechas inválido
	- **Given** que la fecha de entrada no es anterior a la fecha de salida o alguna fecha no es válida
	- **When** el sistema intenta calcular la tarifa
	- **Then** rechaza la operación, identifica el problema y no devuelve un total

2. **Scenario**: Configuración de tarifa incompleta
	- **Given** que falta la tarifa base o que la regla de temporada alta no tiene todos los valores requeridos
	- **When** el sistema intenta calcular una noche afectada
	- **Then** rechaza el cálculo con un mensaje identificable y no sustituye el valor faltante por cero

3. **Scenario**: Reglas de temporada en conflicto
	- **Given** que una misma noche pertenece a más de un período incompatible
	- **When** el sistema intenta determinar la tarifa aplicable
	- **Then** rechaza el cálculo hasta que el conflicto sea resuelto

### Edge Cases

- La estancia tiene una sola noche: debe calcularse cuando la salida es el día siguiente a la entrada.
- La fecha de salida coincide con el comienzo de una temporada: la noche de salida no debe incluirse en el cálculo.
- La fecha de entrada coincide con el comienzo de temporada alta: la primera noche debe usar la regla de temporada alta.
- La estancia atraviesa dos o más temporadas altas con reglas diferentes: cada noche debe usar su regla correspondiente.
- El ajuste dinámico es cero: el cálculo debe conservar la tarifa base y reportar el ajuste aplicado.
- El ajuste dinámico produciría un valor negativo o una tarifa no válida: el sistema debe rechazar la configuración o el cálculo.
- La tarifa base tiene más decimales que los permitidos por la moneda: debe aplicarse una política de redondeo definida y consistente.
- La tarifa base cambia durante el período: el sistema debe usar la tarifa vigente para cada noche según su fecha.
- Se solicita una fecha pasada: debe aplicarse la política definida para históricos o rechazarse con una causa clara.
- La habitación está ocupada, en mantenimiento o bloqueada: el cálculo de precio debe mantenerse separado de la disponibilidad y no debe crear una reserva.
- Los impuestos o la comisión de OTA no están configurados: el cálculo de hospedaje debe diferenciarlos y no inventar sus valores.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept a room type, entry date, exit date, applicable currency, and pricing configuration as inputs to the calculation.
- **FR-002**: System MUST validate that all dates are valid and that the entry date precedes the exit date.
- **FR-003**: System MUST calculate the number of billable nights as the dates from entry, inclusive, to exit, exclusive.
- **FR-004**: System MUST retrieve the base tariff that is valid for the room type and each billable night.
- **FR-005**: System MUST classify each billable night as regular season or high season according to the configured calendar.
- **FR-006**: System MUST apply the configured high-season rule only to nights that belong to that season.
- **FR-007**: System MUST calculate nights independently when the stay crosses tariff periods or seasons.
- **FR-008**: System MUST calculate the lodging total as the sum of all valid nightly values after the applicable adjustments.
- **FR-009**: System MUST return a breakdown containing each night, base tariff, applicable season, dynamic adjustment, final nightly value, and lodging total.
- **FR-010**: System MUST identify the tariff configuration or validity context used for the calculation.
- **FR-011**: System MUST apply the configured currency precision and rounding policy consistently to nightly values and the total.
- **FR-012**: System MUST reject calculations when required tariff data is missing, invalid, expired, or contradictory.
- **FR-013**: System MUST return an actionable error explaining the reason when a calculation is rejected.
- **FR-014**: System MUST keep lodging, taxes, and OTA commissions as distinguishable amounts; the dynamic lodging calculation MUST NOT silently include either taxes or commissions.
- **FR-015**: System MUST NOT reserve, block, or confirm room availability as a side effect of calculating a tariff.
- **FR-016**: System MUST provide enough calculation detail for the resulting lodging value to be reused and compared during reservation and final settlement.

### Key Entities *(include if feature involves data)*

- **Tipo de habitación**: Categoría de alojamiento a la que se asocia la tarifa base.
- **Tarifa base**: Valor regular de una noche, con período de vigencia y moneda.
- **Calendario de temporada**: Conjunto de períodos que clasifica cada fecha como temporada regular o temporada alta.
- **Regla de tarifa dinámica**: Regla que determina el ajuste aplicable a la tarifa base durante una temporada alta.
- **Configuración de redondeo**: Precisión y criterio utilizados para expresar los valores monetarios.
- **Cálculo de tarifa**: Resultado de procesar los datos de entrada, reglas vigentes, detalle por noche, total y eventuales errores.
- **Detalle nocturno**: Registro del cálculo de una noche, incluyendo fecha, tarifa base, temporada, ajuste y tarifa final.

### Business Rules

- **BR-001**: El total del hospedaje debe ser la suma de los valores finales de todas las noches entre la entrada, inclusive, y la salida, exclusive.
- **BR-002**: Cada noche debe tener una única tarifa aplicable; los períodos de temporada no pueden generar una clasificación ambigua.
- **BR-003**: La tarifa dinámica debe partir de la tarifa base vigente para el tipo de habitación y la noche calculada.
- **BR-004**: La regla exacta del ajuste de temporada alta debe ser configurable por el negocio y debe indicar cómo se obtiene el valor final.
- **BR-005**: El cálculo debe distinguir el hospedaje base y dinámico de los impuestos y de la comisión OTA descritos en la matriz de liquidación.
- **BR-006**: La disponibilidad de la habitación no forma parte del cálculo de precio y no se modifica al ejecutarlo.
- **BR-007**: El redondeo debe producir resultados consistentes entre el desglose nocturno, el total calculado y la posterior liquidación.
- **BR-008**: Un dato faltante o contradictorio debe detener el cálculo, no producir un valor estimado silenciosamente.

### Open Questions

- **OQ-001**: [NEEDS CLARIFICATION: definir si el ajuste de temporada alta se calcula como porcentaje, valor fijo, multiplicador u otra fórmula].
- **OQ-002**: [NEEDS CLARIFICATION: definir si el redondeo ocurre por noche, al total o en ambos niveles].
- **OQ-003**: [NEEDS CLARIFICATION: definir si el cálculo incluye impuestos o entrega exclusivamente el valor de hospedaje].
- **OQ-004**: [NEEDS CLARIFICATION: definir la política para tarifas históricas y cambios de tarifa durante una estancia].
- **OQ-005**: [NEEDS CLARIFICATION: definir la prioridad o el rechazo requerido para períodos de temporada solapados].
- **OQ-006**: [NEEDS CLARIFICATION: definir las monedas admitidas y la conversión, si una consulta utiliza una moneda diferente a la tarifa base].

## Non-Functional Requirements

- **NFR-001**: El cálculo debe ser determinista: las mismas entradas y configuraciones vigentes deben producir el mismo resultado.
- **NFR-002**: El resultado debe estar disponible en un tiempo adecuado para una interacción de reserva sin generar esperas perceptibles.
- **NFR-003**: El cálculo debe mantener exactitud monetaria conforme a la precisión de la moneda configurada.
- **NFR-004**: Los errores deben ser comprensibles para el personal operativo y suficientemente específicos para corregir la configuración.
- **NFR-005**: El cálculo debe soportar estancias que atraviesen múltiples períodos sin perder noches, duplicarlas ni asignarles reglas ambiguas.
- **NFR-006**: El resultado no debe exponer datos personales de huéspedes ni información ajena al cálculo de la tarifa.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los cálculos con entradas y configuraciones válidas devuelve un total igual a la suma de sus valores nocturnos.
- **SC-002**: El 100% de las noches de una estancia que cruza temporadas recibe la regla correspondiente a su propia fecha.
- **SC-003**: El 100% de los cálculos con datos obligatorios faltantes, inválidos o contradictorios se rechaza sin devolver un total definitivo.
- **SC-004**: El 100% de los resultados válidos incluye el detalle necesario para reconstruir el total y distinguir los ajustes dinámicos.
- **SC-005**: El 100% de los cálculos mantiene separados el hospedaje, los impuestos y las comisiones OTA.
- **SC-006**: Ningún cálculo de tarifa modifica el estado de disponibilidad, reserva o bloqueo de una habitación.
- **SC-007**: Al menos el 95% de los cálculos válidos finaliza dentro del tiempo objetivo definido para el flujo de reserva.
