# Feature Specification: Modificar Precio de Tarifa

**Created**: 2026-09-04

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Modificar precio de tarifa según temporada (Priority: P1)

Como Administrador, quiero modificar el precio de una tarifa asociada a una temporada del año (Alta/Baja) para que el sistema aplique el valor correcto en el cálculo de la tarifa dinámica al momento de liquidar la estancia de un huésped.

**Why this priority**: Es prerrequisito de "Calcular tarifa dinámica" y de toda la Matriz de Liquidación Final del Módulo 3: sin esta capacidad no se puede diferenciar el cobro entre temporada alta y baja.

> **Supuesto a confirmar**: En el diagrama, la línea de asociación del actor Administrador llega explícitamente a "Revisar temporada del año" y a "Gestionar facturación", pero no hay una línea directa dibujada hacia "Modificar precio de tarifa según temporada". Se asume que el Administrador es el actor de este caso de uso por contexto de dominio (es quien gestiona facturación y tarifas), pero se recomienda confirmar con el autor del diagrama si falta esa línea de asociación o si existe otro actor previsto.

**Independent Test**: Se puede probar por completo ingresando como Administrador, seleccionando una tarifa existente, cambiando su precio para una temporada dada, guardando el cambio, y verificando que el nuevo precio se refleje al consultar la tarifa dinámica para una fecha dentro de esa temporada.

**Acceptance Scenarios**:

1. **Scenario**: Modificación exitosa de precio en temporada alta
   - **Given** el Administrador ha iniciado sesión y existe una Tarifa por Temporada configurada para la temporada "Alta"
   - **When** el Administrador ingresa un nuevo valor de precio para esa temporada y confirma el guardado
   - **Then** el sistema actualiza el precio de la tarifa y lo deja disponible para el cálculo de tarifa dinámica en fechas de esa temporada

2. **Scenario**: Revisión de temporada incluida antes de aplicar el cambio
   - **Given** el Administrador selecciona una tarifa para modificar
   - **When** el sistema procesa la solicitud de modificación
   - **Then** el sistema ejecuta la revisión de la temporada del año asociada (según la relación `<<include>>` Revisar temporada del año) para asegurar que el precio se aplique al periodo correcto

3. **Scenario**: Intento de modificación con precio inválido
   - **Given** el Administrador está editando el precio de una tarifa
   - **When** ingresa un valor negativo, cero o no numérico
   - **Then** el sistema rechaza el cambio, muestra un mensaje de error y no persiste la modificación

4. **Scenario**: El precio actualizado se propaga a la tarifa dinámica (efecto observable, no una historia aparte)
   - **Given** el Administrador modificó y guardó el precio de la tarifa de temporada alta
   - **When** cualquier consumidor (p. ej. una OTA) consulta la tarifa dinámica para una fecha de esa temporada
   - **Then** el sistema retorna el precio actualizado

> **Nota de alcance**: "Consultar tarifa dinámica" y "Calcular tarifa dinámica" son casos de uso propios del diagrama (actor OTA) y se especifican en su propio documento. Aquí solo se cubre que la modificación del Administrador se propague correctamente hacia ellos (ver FR-006); no se especifica el comportamiento interno de esos casos de uso.

---

### Edge Cases

- ¿Qué pasa si el Administrador intenta modificar el precio de una tarifa para una temporada que no existe o no está configurada en el calendario?
- ¿Cómo maneja el sistema una modificación de precio cuando las fechas de dos temporadas se solapan parcialmente?
- ¿Qué ocurre si dos administradores intentan modificar el precio de la misma tarifa al mismo tiempo (conflicto de concurrencia)?
- ¿Qué pasa con reservas ya confirmadas con el precio anterior cuando se modifica el precio de la tarifa: se respeta el precio original de la reserva o se recalcula?
- ¿Qué sucede si el nuevo precio ingresado es idéntico al precio vigente (sin cambio real)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir al Administrador seleccionar la Tarifa por Temporada de una habitación/tipo de habitación y modificar su valor de precio. Esto NO incluye modificar la Tarifa Base de la habitación, que pertenece al Módulo 1 y se consulta como dato externo de solo lectura.
- **FR-002**: El sistema DEBE asociar cada modificación de precio a una temporada del año [NEEDS CLARIFICATION: ¿cuántas temporadas maneja el sistema (solo Alta/Baja) o hay más categorías intermedias?].
- **FR-003**: El sistema DEBE ejecutar la revisión de la temporada del año vigente antes de confirmar la modificación del precio, conforme a la relación `<<include>>` "Revisar temporada del año" del diagrama de casos de uso.
- **FR-004**: El sistema DEBE validar que el nuevo precio ingresado sea numérico y mayor a cero antes de persistir el cambio.
- **FR-005**: El sistema DEBE registrar el historial de cambios de precio de tarifa (precio anterior, precio nuevo, temporada, usuario que modifica, fecha de modificación) [NEEDS CLARIFICATION: ¿se requiere explícitamente un historial/auditoría de cambios, o solo debe persistirse el valor vigente?].
- **FR-006**: El sistema DEBE reflejar el precio actualizado de forma inmediata en "Calcular tarifa dinámica" para toda consulta posterior a la modificación.
- **FR-007**: El sistema DEBE restringir la modificación del precio de tarifa exclusivamente al rol Administrador.
- **FR-008**: El sistema DEBE aplicar un tratamiento consistente a las reservas ya confirmadas con el precio anterior cuando se modifica el precio de una tarifa [NEEDS CLARIFICATION: ¿se conserva el precio congelado en la reserva existente (snapshot al momento de reservar), o se recalcula con el nuevo precio?].
- **FR-009**: El sistema DEBE rechazar la modificación de precio si la temporada indicada no está configurada en el calendario, mostrando un mensaje de error sin persistir el cambio.
- **FR-010**: El sistema DEBE manejar solicitudes concurrentes de modificación sobre la misma tarifa [NEEDS CLARIFICATION: ¿última escritura gana, bloqueo optimista con reintento, o bloqueo exclusivo mientras un Administrador edita?].
- **FR-011**: El sistema DEBE almacenar el nuevo precio de temporada con una semántica clara y consistente [NEEDS CLARIFICATION: ¿es un valor absoluto que reemplaza el precio para esa temporada, o es un porcentaje/incremento que "Calcular tarifa dinámica" combinará con la Tarifa Base? La acción de combinar ambos valores es responsabilidad de "Calcular tarifa dinámica", no de este caso de uso — este solo debe garantizar que lo que guarda sea inequívoco para quien lo consuma].

### Key Entities *(include if feature involves data)*

- **Tarifa Base**: Precio base de una habitación; es un atributo propio de la entidad Habitación gestionada por el **Módulo 1** (Gestión de Habitaciones). Este caso de uso NO la modifica; solo se consulta como dato de solo lectura (ver "Consultar tarifa base" en el diagrama, actor Módulo1).
- **Tarifa por Temporada** (nombre provisional): Valor o ajuste de precio propio de **Módulo 3**, asociado a una Temporada específica, que este caso de uso SÍ crea/modifica. Es el insumo que usa "Calcular tarifa dinámica" junto con la Tarifa Base para determinar el precio final a cobrar.
- **Temporada**: Periodo del año (p. ej. Alta, Baja) definido por un rango de fechas, usado para determinar qué Tarifa por Temporada aplicar.
- **Administrador**: Usuario con permisos para gestionar facturación y modificar tarifas (actor asumido para este caso de uso; ver nota de supuesto arriba).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El Administrador puede modificar el precio de una tarifa en menos de 1 minuto desde que inicia la edición.
- **SC-002**: El 100% de las consultas de tarifa dinámica realizadas después de una modificación reflejan el precio actualizado, sin retrasos de propagación.
- **SC-003**: El sistema rechaza el 100% de los intentos de modificación con valores de precio inválidos (negativos, cero o no numéricos).
- **SC-004**: Cero discrepancias de precio entre lo configurado por el Administrador y lo consultado por las OTAs para una misma fecha/temporada.
