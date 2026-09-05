# Especificación de funcionalidad: Calcular tarifa dinámica

**Creado**: 2026-09-04  

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Calcular la tarifa de una estancia (Prioridad: P1)

Como sistema de gestión hotelera, quiero calcular la tarifa de hospedaje para un tipo de habitación y un período determinado, para obtener un valor correcto según la tarifa base y la temporada aplicable.

**Por qué esta prioridad**: El cálculo es la capacidad central que permite mostrar precios consistentes y alimentar posteriormente la reserva y la liquidación financiera.

**Prueba independiente**: Se puede proporcionar una tarifa base, un rango de fechas y un calendario de temporada, y comprobar que el resultado sea la suma de la tarifa aplicable a cada noche.

**Escenarios de aceptación**:

1. **Escenario**: Calcular una estancia en temporada regular
	- **Dado** que el tipo de habitación tiene una tarifa base vigente y ninguna noche pertenece a temporada alta
	- **Cuando** el sistema calcula la tarifa para el período solicitado
	- **Entonces** devuelve la tarifa base por cada noche y el total de hospedaje correspondiente

2. **Escenario**: Calcular una estancia en temporada alta
	- **Dado** que el tipo de habitación tiene una tarifa base vigente y las noches solicitadas pertenecen a un período de temporada alta con una regla configurada
	- **Cuando** el sistema calcula la tarifa
	- **Entonces** aplica el ajuste dinámico definido para cada noche de temporada alta y devuelve el total calculado

3. **Escenario**: Calcular una estancia que cruza temporadas
	- **Dado** que el período contiene noches de temporada regular y de temporada alta
	- **Cuando** el sistema calcula la tarifa
	- **Entonces** aplica a cada noche la regla que corresponde a su fecha y suma los resultados sin aplicar una única regla a toda la estancia

---

### Historia de usuario 2 - Entregar un desglose auditable del cálculo (Prioridad: P1)

Como agente de recepción o responsable de facturación, quiero consultar el desglose del cálculo, para verificar cómo se obtuvo el total antes de usarlo en una reserva o liquidación.

**Por qué esta prioridad**: Un desglose verificable permite detectar errores de configuración y mantiene la trazabilidad entre la tarifa consultada y el valor facturado.

**Prueba independiente**: Se puede ejecutar un cálculo con al menos una noche regular y una noche de temporada alta, y verificar que el resultado incluya la fecha, la tarifa base, el ajuste y el valor final de cada noche.

**Escenarios de aceptación**:

1. **Escenario**: Mostrar los componentes del cálculo
	- **Dado** que existe una tarifa base y una regla dinámica aplicable
	- **Cuando** el sistema finaliza el cálculo
	- **Entonces** informa la tarifa base, la regla o condición de temporada, el valor resultante por noche y el total de hospedaje

2. **Escenario**: Mantener el mismo resultado con los mismos datos
	- **Dado** que no han cambiado la tarifa base, las reglas, las fechas ni la moneda
	- **Cuando** se ejecuta nuevamente el cálculo
	- **Entonces** el sistema devuelve el mismo resultado y el mismo desglose

---

### Historia de usuario 3 - Rechazar cálculos inválidos o incompletos (Prioridad: P1)

Como responsable de la operación hotelera, quiero que el sistema rechace cálculos con datos inconsistentes, para impedir que valores incorrectos lleguen a una reserva o a la facturación.

**Por qué esta prioridad**: Un cálculo incorrecto afecta directamente los ingresos, la confianza del huésped y la liquidación con intermediarios.

**Prueba independiente**: Se puede ejecutar el cálculo con fechas inválidas, tarifa base inexistente, reglas incompletas o períodos solapados, y verificar que no devuelva un total definitivo.

**Escenarios de aceptación**:

1. **Escenario**: Rango de fechas inválido
	- **Dado** que la fecha de entrada no es anterior a la fecha de salida o alguna fecha no es válida
	- **Cuando** el sistema intenta calcular la tarifa
	- **Entonces** rechaza la operación, identifica el problema y no devuelve un total

2. **Escenario**: Configuración de tarifa incompleta
	- **Dado** que falta la tarifa base o que la regla de temporada alta no tiene todos los valores requeridos
	- **Cuando** el sistema intenta calcular una noche afectada
	- **Entonces** rechaza el cálculo con un mensaje identificable y no sustituye el valor faltante por cero

3. **Escenario**: Reglas de temporada en conflicto
	- **Dado** que una misma noche pertenece a más de un período incompatible
	- **Cuando** el sistema intenta determinar la tarifa aplicable
	- **Entonces** rechaza el cálculo hasta que el conflicto sea resuelto

### Casos límite

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

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE aceptar como entradas un tipo de habitación, fecha de entrada, fecha de salida, moneda aplicable y configuración tarifaria.
- **FR-002**: El sistema DEBE validar que todas las fechas sean válidas y que la fecha de entrada preceda a la fecha de salida.
- **FR-003**: El sistema DEBE calcular las noches facturables desde la entrada, inclusive, hasta la salida, sin incluirla.
- **FR-004**: El sistema DEBE obtener la tarifa base vigente para el tipo de habitación y cada noche facturable.
- **FR-005**: El sistema DEBE clasificar cada noche facturable como temporada regular o temporada alta según el calendario configurado.
- **FR-006**: El sistema DEBE aplicar la regla de temporada alta configurada únicamente a las noches que pertenezcan a dicha temporada.
- **FR-007**: El sistema DEBE calcular las noches de forma independiente cuando la estancia atraviese períodos tarifarios o temporadas diferentes.
- **FR-008**: El sistema DEBE calcular el total del hospedaje como la suma de los valores nocturnos válidos después de aplicar los ajustes correspondientes.
- **FR-009**: El sistema DEBE devolver un desglose con cada noche, tarifa base, temporada aplicable, ajuste dinámico, valor nocturno final y total del hospedaje.
- **FR-010**: El sistema DEBE identificar la configuración tarifaria o el contexto de vigencia utilizado para el cálculo.
- **FR-011**: El sistema DEBE aplicar de forma consistente la precisión monetaria y la política de redondeo configuradas.
- **FR-012**: El sistema DEBE rechazar los cálculos cuando falten datos tarifarios requeridos o estos sean inválidos, estén vencidos o sean contradictorios.
- **FR-013**: El sistema DEBE devolver un error accionable que explique el motivo del rechazo del cálculo.
- **FR-014**: El sistema DEBE mantener diferenciados el hospedaje, los impuestos y las comisiones OTA; el cálculo dinámico del hospedaje NO DEBE incluirlos silenciosamente.
- **FR-015**: El sistema NO DEBE reservar, bloquear ni confirmar la disponibilidad de una habitación como efecto secundario del cálculo.
- **FR-016**: El sistema DEBE proporcionar suficiente detalle para reutilizar y comparar el valor calculado durante la reserva y la liquidación final.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Tipo de habitación**: Categoría de alojamiento a la que se asocia la tarifa base.
- **Tarifa base**: Valor regular de una noche, con período de vigencia y moneda.
- **Calendario de temporada**: Conjunto de períodos que clasifica cada fecha como temporada regular o temporada alta.
- **Regla de tarifa dinámica**: Regla que determina el ajuste aplicable a la tarifa base durante una temporada alta.
- **Configuración de redondeo**: Precisión y criterio utilizados para expresar los valores monetarios.
- **Cálculo de tarifa**: Resultado de procesar los datos de entrada, reglas vigentes, detalle por noche, total y eventuales errores.
- **Detalle nocturno**: Registro del cálculo de una noche, incluyendo fecha, tarifa base, temporada, ajuste y tarifa final.

### Reglas de negocio

- **BR-001**: El total del hospedaje debe ser la suma de los valores finales de todas las noches entre la entrada, inclusive, y la salida, sin incluirla.
- **BR-002**: Cada noche debe tener una única tarifa aplicable; los períodos de temporada no pueden generar una clasificación ambigua.
- **BR-003**: La tarifa dinámica debe partir de la tarifa base vigente para el tipo de habitación y la noche calculada.
- **BR-004**: La regla exacta del ajuste de temporada alta debe ser configurable por el negocio y debe indicar cómo se obtiene el valor final.
- **BR-005**: El cálculo debe distinguir el hospedaje base y dinámico de los impuestos y de la comisión OTA descritos en la matriz de liquidación.
- **BR-006**: La disponibilidad de la habitación no forma parte del cálculo de precio y no se modifica al ejecutarlo.
- **BR-007**: El redondeo debe producir resultados consistentes entre el desglose nocturno, el total calculado y la posterior liquidación.
- **BR-008**: Un dato faltante o contradictorio debe detener el cálculo, no producir un valor estimado silenciosamente.

### Preguntas abiertas

- **OQ-001**: [REQUIERE ACLARACIÓN: definir si el ajuste de temporada alta se calcula como porcentaje, valor fijo, multiplicador u otra fórmula].
- **OQ-002**: [REQUIERE ACLARACIÓN: definir si el redondeo ocurre por noche, al total o en ambos niveles].
- **OQ-003**: [REQUIERE ACLARACIÓN: definir si el cálculo incluye impuestos o entrega exclusivamente el valor de hospedaje].
- **OQ-004**: [REQUIERE ACLARACIÓN: definir la política para tarifas históricas y cambios de tarifa durante una estancia].
- **OQ-005**: [REQUIERE ACLARACIÓN: definir la prioridad o el rechazo requerido para períodos de temporada solapados].
- **OQ-006**: [REQUIERE ACLARACIÓN: definir las monedas admitidas y la conversión, si una consulta utiliza una moneda diferente a la tarifa base].

## Requisitos no funcionales

- **NFR-001**: El cálculo debe ser determinista: las mismas entradas y configuraciones vigentes deben producir el mismo resultado.
- **NFR-002**: El resultado debe estar disponible en un tiempo adecuado para una interacción de reserva sin generar esperas perceptibles.
- **NFR-003**: El cálculo debe mantener exactitud monetaria conforme a la precisión de la moneda configurada.
- **NFR-004**: Los errores deben ser comprensibles para el personal operativo y suficientemente específicos para corregir la configuración.
- **NFR-005**: El cálculo debe soportar estancias que atraviesen múltiples períodos sin perder noches, duplicarlas ni asignarles reglas ambiguas.
- **NFR-006**: El resultado no debe exponer datos personales de huéspedes ni información ajena al cálculo de la tarifa.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los cálculos con entradas y configuraciones válidas devuelve un total igual a la suma de sus valores nocturnos.
- **SC-002**: El 100% de las noches de una estancia que cruza temporadas recibe la regla correspondiente a su propia fecha.
- **SC-003**: El 100% de los cálculos con datos obligatorios faltantes, inválidos o contradictorios se rechaza sin devolver un total definitivo.
- **SC-004**: El 100% de los resultados válidos incluye el detalle necesario para reconstruir el total y distinguir los ajustes dinámicos.
- **SC-005**: El 100% de los cálculos mantiene separados el hospedaje, los impuestos y las comisiones OTA.
- **SC-006**: Ningún cálculo de tarifa modifica el estado de disponibilidad, reserva o bloqueo de una habitación.
- **SC-007**: Al menos el 95% de los cálculos válidos finaliza dentro del tiempo objetivo definido para el flujo de reserva.
