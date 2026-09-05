# Especificación de funcionalidad: Revisar temporada del año

**Creado**: 2026-09-04  

## Objetivos de negocio

- Mantener un calendario confiable para identificar los períodos de temporada regular y temporada alta.
- Evitar cálculos de tarifas ambiguos causados por períodos solapados, fechas inválidas o reglas incompletas.
- Permitir que el personal autorizado revise la configuración antes de que afecte reservas, consultas y liquidaciones.

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Revisar el calendario de temporadas (Prioridad: P1)

Como responsable de la operación hotelera, quiero consultar los períodos de temporada configurados, para conocer qué fechas tienen una condición de temporada alta y qué regla dinámica les corresponde.

**Por qué esta prioridad**: El calendario de temporadas controla la aplicación de tarifas dinámicas y debe ser visible antes de que se utilice en el cálculo de hospedaje.

**Prueba independiente**: Se puede abrir la revisión del calendario y verificar que cada período muestre sus fechas, clasificación, estado, regla asociada y posibles advertencias sin necesidad de ejecutar una reserva.

**Escenarios de aceptación**:

1. **Escenario**: Revisar un período configurado
	- **Dado** que existe un período de temporada con fechas de inicio y fin, clasificación y regla dinámica configuradas
	- **Cuando** el usuario revisa el calendario
	- **Entonces** el sistema muestra la información completa del período y su vigencia

2. **Escenario**: Identificar temporadas por fecha
	- **Dado** que el calendario contiene períodos regulares y de temporada alta
	- **Cuando** el usuario revisa una fecha determinada
	- **Entonces** el sistema indica la temporada aplicable y la regla dinámica asociada, si existe

3. **Escenario**: Revisar períodos futuros
	- **Dado** que existen períodos configurados para fechas futuras
	- **Cuando** el usuario consulta el calendario para un rango futuro
	- **Entonces** el sistema muestra los períodos aplicables ordenados cronológicamente y su estado de configuración

---

### Historia de usuario 2 - Validar la consistencia del calendario (Prioridad: P1)

Como responsable de tarifas, quiero validar el calendario de temporadas, para detectar conflictos antes de que afecten el precio de una habitación.

**Por qué esta prioridad**: Una configuración inconsistente puede asignar dos reglas a la misma noche o dejar noches de temporada alta sin un ajuste válido.

**Prueba independiente**: Se puede ejecutar la validación sobre un calendario con períodos válidos, solapados y con reglas incompletas, y comprobar que cada caso reciba el estado y mensaje correspondiente.

**Escenarios de aceptación**:

1. **Escenario**: Calendario válido
	- **Dado** que los períodos tienen fechas válidas, no se solapan y las temporadas altas tienen reglas completas
	- **Cuando** el usuario valida el calendario
	- **Entonces** el sistema lo marca como válido y no muestra advertencias críticas

2. **Escenario**: Períodos solapados
	- **Dado** que dos períodos asignan condiciones incompatibles a una misma fecha
	- **Cuando** el usuario valida el calendario
	- **Entonces** el sistema identifica los períodos en conflicto, las fechas afectadas y bloquea su uso para calcular tarifas hasta resolverlos

3. **Escenario**: Temporada alta sin regla
	- **Dado** que un período está marcado como temporada alta pero no tiene una regla dinámica completa
	- **Cuando** el usuario valida el calendario
	- **Entonces** el sistema lo marca como incompleto e indica qué configuración falta

---

### Historia de usuario 3 - Corregir y confirmar la configuración de temporada (Prioridad: P2)

Como usuario autorizado, quiero crear, modificar o desactivar períodos de temporada, para mantener actualizado el calendario según la operación del hotel.

**Por qué esta prioridad**: La revisión debe permitir mantener la fuente de verdad del calendario, pero los cambios necesitan control para no introducir tarifas ambiguas.

**Prueba independiente**: Se puede crear o modificar un período, ejecutar la validación y confirmar que solo una configuración válida pueda quedar activa para los cálculos futuros.

**Escenarios de aceptación**:

1. **Escenario**: Guardar un período válido
	- **Dado** que el usuario autorizado proporciona fechas válidas, una clasificación y la regla requerida
	- **Cuando** guarda el período
	- **Entonces** el sistema valida la configuración, la registra y la deja disponible según su vigencia

2. **Escenario**: Rechazar un período inválido
	- **Dado** que la fecha de inicio es posterior o igual a la fecha de fin, o faltan datos obligatorios
	- **Cuando** el usuario intenta guardar el período
	- **Entonces** el sistema rechaza el cambio, explica los errores y conserva la configuración anterior

3. **Escenario**: Desactivar un período
	- **Dado** que existe un período que ya no debe aplicarse a nuevas consultas
	- **Cuando** el usuario autorizado lo desactiva
	- **Entonces** el sistema conserva su historial, evita aplicarlo a cálculos futuros y muestra el cambio de estado

### Casos límite

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

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir que los usuarios autorizados revisen los períodos de temporada configurados para un rango de fechas o año seleccionado.
- **FR-002**: El sistema DEBE mostrar para cada período las fechas de inicio y fin, clasificación, estado, alcance por habitación si corresponde y regla de tarifa dinámica asociada.
- **FR-003**: El sistema DEBE identificar la temporada y la regla aplicable a una fecha solicitada según el calendario activo.
- **FR-004**: El sistema DEBE validar que cada período tenga fechas válidas y que su fecha de inicio preceda a la fecha de fin.
- **FR-005**: El sistema DEBE detectar períodos solapados que puedan asignar clasificaciones o reglas tarifarias incompatibles a una misma fecha.
- **FR-006**: El sistema DEBE detectar períodos de temporada alta sin una regla de tarifa dinámica completa.
- **FR-007**: El sistema DEBE informar cada problema de validación con el período afectado, el rango de fechas, la severidad y la información correctiva.
- **FR-008**: El sistema DEBE permitir a los usuarios autorizados crear, actualizar, activar y desactivar períodos de temporada.
- **FR-009**: El sistema DEBE validar un período antes de guardarlo o activarlo.
- **FR-010**: El sistema DEBE rechazar cambios inválidos o conflictivos sin reemplazar la última configuración válida.
- **FR-011**: El sistema DEBE conservar el historial de cambios de los períodos, incluyendo actor, fecha, valor anterior, valor nuevo y motivo cuando se proporcione.
- **FR-012**: El sistema DEBE distinguir las configuraciones activas, inactivas, pendientes de validación e inválidas.
- **FR-013**: El sistema DEBE impedir que configuraciones de temporada inválidas o no resueltas se utilicen en cálculos de tarifa dinámica.
- **FR-014**: El sistema DEBE distinguir el calendario de temporadas de la disponibilidad de habitaciones; revisar o modificar una temporada NO DEBE reservar ni bloquear una habitación.
- **FR-015**: El sistema DEBE aplicar la zona horaria oficial del hotel al determinar los límites de las fechas.
- **FR-016**: El sistema DEBE conservar el contexto tarifario histórico cuando cambie una configuración de temporada después de confirmar un cálculo o una reserva.
- **FR-017**: El sistema DEBE mostrar un mensaje claro cuando no exista configuración de temporada para el rango de fechas solicitado.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Período de temporada**: Rango de fechas que clasifica noches como temporada regular o temporada alta.
- **Calendario de temporadas**: Conjunto ordenado de períodos activos que determina la condición aplicable a cada fecha.
- **Regla de tarifa dinámica**: Configuración que define el ajuste asociado a un período de temporada alta.
- **Resultado de revisión**: Estado de validez del calendario, advertencias, errores y fechas afectadas.
- **Historial de configuración**: Registro de cambios realizados sobre un período, su autor, momento y valores anteriores y nuevos.
- **Usuario autorizado**: Actor con permisos para revisar o modificar la configuración según su rol.

### Reglas de negocio

- **BR-001**: Un período debe tener una fecha de inicio anterior a su fecha de fin y debe representar al menos una noche.
- **BR-002**: La fecha de inicio se considera incluida y la fecha de fin se considera excluida al clasificar noches, de forma consistente con el cálculo de hospedaje.
- **BR-003**: Una noche no puede quedar asociada a dos períodos activos incompatibles.
- **BR-004**: Todo período marcado como temporada alta debe tener una regla dinámica completa y vigente antes de utilizarse en el cálculo.
- **BR-005**: Los períodos inactivos o inválidos no deben afectar nuevas consultas ni cálculos de tarifa.
- **BR-006**: Un cambio de configuración no debe modificar retroactivamente el valor de una reserva o liquidación ya confirmada.
- **BR-007**: La clasificación de fechas debe realizarse según la zona horaria oficial del hotel.
- **BR-008**: La disponibilidad, ocupación y estado físico de una habitación son independientes de la clasificación de temporada.
- **BR-009**: La política para períodos que atraviesan años debe estar definida explícitamente y no inferirse de forma ambigua.

### Preguntas abiertas

- **OQ-001**: [REQUIERE ACLARACIÓN: confirmar si la fecha de fin se manejará siempre como exclusiva o si la administración usará fechas inclusivas en pantalla].
- **OQ-002**: [REQUIERE ACLARACIÓN: definir si las temporadas se configuran por año específico, como períodos recurrentes o con ambas modalidades].
- **OQ-003**: [REQUIERE ACLARACIÓN: definir si pueden coexistir temporadas por hotel, tipo de habitación o canal de venta].
- **OQ-004**: [REQUIERE ACLARACIÓN: definir los roles autorizados para crear, modificar, activar y desactivar períodos].
- **OQ-005**: [REQUIERE ACLARACIÓN: definir si un calendario sin temporada alta debe aplicar automáticamente la tarifa base o requiere una configuración explícita de temporada regular].
- **OQ-006**: [REQUIERE ACLARACIÓN: definir la política para cambios sobre períodos ya usados en reservas o cálculos confirmados].
- **OQ-007**: [REQUIERE ACLARACIÓN: definir la zona horaria oficial de cada establecimiento si la plataforma opera con múltiples hoteles].

## Requisitos no funcionales

- **NFR-001**: La revisión del calendario debe mostrar resultados en un tiempo adecuado para la operación diaria del hotel.
- **NFR-002**: La validación debe ser determinista: la misma configuración debe producir el mismo resultado y las mismas advertencias.
- **NFR-003**: Los mensajes de error deben ser comprensibles para usuarios operativos y suficientemente precisos para corregir la configuración.
- **NFR-004**: Los cambios de configuración deben conservar trazabilidad y ser consultables por usuarios autorizados.
- **NFR-005**: El sistema debe mantener la consistencia del calendario al revisar períodos que cubren múltiples años o rangos extensos.
- **NFR-006**: La información de configuración debe protegerse según el rol del usuario y no debe exponer datos personales innecesarios.
- **NFR-007**: La revisión y validación no deben producir cambios colaterales en reservas, disponibilidad o estados de habitaciones.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los períodos activos mostrados incluye fechas, clasificación, estado y regla dinámica aplicable o una advertencia explícita si está incompleto.
- **SC-002**: El 100% de los períodos con fechas inválidas o solapamientos incompatibles se identifica antes de poder activarse.
- **SC-003**: El 100% de las fechas consultadas con configuración activa devuelve una única clasificación de temporada o un error explícito de configuración.
- **SC-004**: El 100% de los cambios aceptados queda registrado con usuario, fecha y valores modificados.
- **SC-005**: El 100% de los cambios inválidos conserva la última configuración válida y no afecta cálculos futuros.
- **SC-006**: Al menos el 95% de los usuarios autorizados puede identificar y corregir un conflicto de calendario en una prueba de aceptación.
- **SC-007**: Ninguna revisión, validación o modificación del calendario altera por sí sola la disponibilidad, reserva o bloqueo de una habitación.
