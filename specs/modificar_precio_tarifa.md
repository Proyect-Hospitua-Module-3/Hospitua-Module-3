# Especificación de funcionalidad: Modificar precio de tarifa según temporada

**Creado**: 2026-09-04  

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Modificar precio de tarifa según temporada (Prioridad: P1)

Como Administrador, quiero modificar el precio de una tarifa asociada a una temporada del año (baja, regular o alta) para que el sistema aplique el valor correcto en el cálculo de la tarifa dinámica al momento de liquidar la estancia de un huésped.

**Por qué esta prioridad**: Es prerrequisito de "Calcular tarifa dinámica" y de toda la Matriz de Liquidación Final del Módulo 3 (Hospedaje Base = Tarifa según temporada x Noches): sin esta capacidad no se puede diferenciar el cobro entre temporada alta, regular o baja.

> **Supuesto a confirmar**: En el diagrama de casos de uso del Módulo 3 (`HOSPITUA-Modulo-3.png`), la línea de asociación del actor Administrador llega explícitamente a "Revisar temporada del año" y a "Gestionar facturación", pero no hay una línea directa dibujada hacia "Modificar precio de tarifa según temporada". Se asume que el Administrador es el actor de este caso de uso por contexto de dominio (es quien gestiona facturación y tarifas), pero se recomienda confirmar con el autor del diagrama si falta esa línea de asociación o si existe otro actor previsto.

**Prueba independiente**: Se puede probar por completo ingresando como Administrador, seleccionando una tarifa existente, cambiando su precio para una temporada dada, guardando el cambio, y verificando que el nuevo precio se refleje al consultar la tarifa dinámica para una fecha dentro de esa temporada.

**Escenarios de aceptación**:

1. **Escenario**: Modificación exitosa de precio en temporada alta
   - **Dado** que el Administrador ha iniciado sesión y existe una Tarifa por Temporada configurada para la temporada "Alta"
   - **Cuando** el Administrador ingresa un nuevo valor de precio para esa temporada y confirma el guardado
   - **Entonces** el sistema actualiza el precio de la tarifa y lo deja disponible para el cálculo de tarifa dinámica en fechas de esa temporada

2. **Escenario**: Revisión de temporada incluida antes de aplicar el cambio
   - **Dado** que el Administrador selecciona una tarifa para modificar
   - **Cuando** el sistema procesa la solicitud de modificación
   - **Entonces** el sistema ejecuta la revisión de la temporada del año asociada (relación `<<include>>` "Revisar temporada del año" del diagrama de casos de uso) para asegurar que el precio se aplique al periodo correcto

3. **Escenario**: El precio actualizado se propaga a la tarifa dinámica (efecto observable de esta historia, no una historia aparte)
   - **Dado** que el Administrador modificó y guardó el precio de la tarifa de temporada alta
   - **Cuando** cualquier consumidor (p. ej. una OTA a través de "Consultar tarifa dinámica") consulta la tarifa dinámica para una fecha de esa temporada
   - **Entonces** el sistema retorna el precio actualizado

> **Nota de alcance**: "Consultar tarifa dinámica" y "Calcular tarifa dinámica" son casos de uso propios del diagrama (actor OTA) y se especifican en su propio documento (`calcular_tarifa_dinamica.md`). Aquí solo se cubre que la modificación del Administrador se propague correctamente hacia ellos (ver FR-006); no se especifica el comportamiento interno de esos casos de uso.

---

### Historia de usuario 2 - Rechazar modificaciones con datos inválidos o temporada no configurada (Prioridad: P1)

Como Administrador, quiero que el sistema rechace una modificación de precio cuando el valor ingresado o la temporada indicada no sean válidos, para evitar que datos incorrectos afecten la facturación y la Matriz de Liquidación Final.

**Por qué esta prioridad**: Un precio de tarifa inválido persistido se propaga directamente al Hospedaje Base de cada liquidación (Hospedaje Base = Tarifa según temporada x Noches), afectando ingresos y confianza del huésped; por eso la validación es tan crítica como la modificación misma.

**Prueba independiente**: Se puede ejecutar el flujo de modificación con un precio negativo, cero, no numérico, o con una temporada inexistente en el calendario, y verificar que el sistema rechace el cambio, muestre un mensaje de error y no persista ninguna modificación.

**Escenarios de aceptación**:

1. **Escenario**: Intento de modificación con precio inválido
   - **Dado** que el Administrador está editando el precio de una tarifa
   - **Cuando** ingresa un valor negativo, cero o no numérico
   - **Entonces** el sistema rechaza el cambio, muestra un mensaje de error y no persiste la modificación

2. **Escenario**: Intento de modificación sobre una temporada no configurada
   - **Dado** que el Administrador indica una temporada para asociar el nuevo precio
   - **Cuando** esa temporada no existe o no está configurada en el calendario (revisado mediante "Revisar temporada del año")
   - **Entonces** el sistema rechaza la modificación, muestra un mensaje de error y no persiste el cambio

### Casos límite

- Si dos temporadas se solapan parcialmente en el calendario, esa ambigüedad debe quedar resuelta por la revisión de temporada antes de llegar a este caso de uso; si aun así se recibe una temporada en conflicto, el sistema debe rechazar la modificación (ver BR-008, FR-009).
- Si dos Administradores intentan modificar el precio de la misma tarifa al mismo tiempo, el sistema debe aplicar una política de concurrencia definida para evitar que un cambio sobrescriba al otro sin control (ver OQ-002).
- Si el nuevo precio ingresado es idéntico al precio vigente, el sistema debe aceptar el guardado sin error, tratándolo como una operación sin cambio real (no-op).
- Si existen reservas ya confirmadas con el precio anterior al momento de la modificación, el importe ya confirmado permanece congelado y no se recalcula automáticamente; solo los cálculos nuevos posteriores al cambio usan el precio actualizado (ver BR-007).
- La temporada indicada no está configurada en el calendario: el sistema rechaza la modificación sin persistir el cambio (ver FR-009).

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir al Administrador seleccionar la Tarifa por Temporada de una habitación/tipo de habitación y modificar su valor de precio. Esto NO incluye modificar la Tarifa Base de la habitación, que pertenece al Módulo 1 (Gestión de Habitaciones) y se consulta como dato externo de solo lectura mediante "Consultar tarifa base".
- **FR-002**: El sistema DEBE asociar cada modificación de precio a una de las temporadas reconocidas por el Módulo 3 (temporada baja, temporada regular o temporada alta), validado mediante "Revisar temporada del año".
- **FR-003**: El sistema DEBE ejecutar la revisión de la temporada del año vigente antes de confirmar la modificación del precio, conforme a la relación `<<include>>` "Revisar temporada del año" del diagrama de casos de uso.
- **FR-004**: El sistema DEBE validar que el nuevo precio ingresado sea numérico y mayor a cero antes de persistir el cambio.
- **FR-005**: El sistema DEBE registrar el historial de cambios de precio de tarifa (precio anterior, precio nuevo, temporada, usuario que modifica, fecha de modificación), siguiendo el mismo patrón de auditoría que otros casos de uso del Módulo 3 ya exigen para cambios de temporada y de tarifas aplicadas.
- **FR-006**: El sistema DEBE reflejar el precio actualizado de forma inmediata en "Calcular tarifa dinámica" para toda consulta posterior a la modificación, sin retrasos de propagación.
- **FR-007**: El sistema DEBE restringir la modificación del precio de tarifa exclusivamente al rol Administrador.
- **FR-008**: El sistema NO DEBE alterar retroactivamente el importe de hospedaje ya confirmado de una reserva; una modificación de precio de tarifa solo debe afectar cálculos nuevos realizados después del cambio, en línea con el principio de no retroactividad que ya siguen otros casos de uso del Módulo 3 relacionados con tarifas y temporadas.
- **FR-009**: El sistema DEBE rechazar la modificación de precio si la temporada indicada no está configurada en el calendario, mostrando un mensaje de error sin persistir el cambio.
- **FR-010**: El sistema DEBE manejar solicitudes concurrentes de modificación sobre la misma tarifa sin generar inconsistencias de datos.
- **FR-011**: El sistema DEBE almacenar el nuevo precio de temporada con una semántica clara y consistente para quien lo consuma, en particular para "Calcular tarifa dinámica".

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Tarifa Base**: Precio base de una habitación; es un atributo propio de la entidad Habitación gestionada por el Módulo 1 (Gestión de Habitaciones). Este caso de uso NO la modifica; solo se consulta como dato de solo lectura (ver "Consultar tarifa base" en el diagrama, actor Módulo1).
- **Tarifa por Temporada** (nombre provisional): Valor o ajuste de precio propio de Módulo 3, asociado a una Temporada específica, que este caso de uso SÍ crea/modifica. Es el insumo que usa "Calcular tarifa dinámica" junto con la Tarifa Base para determinar el precio final a cobrar (Hospedaje Base = Tarifa según temporada x Noches, según la Matriz de Liquidación Final).
- **Temporada**: Periodo del año (baja, regular o alta) definido por un rango de fechas, usado para determinar qué Tarifa por Temporada aplicar. Gestionada por "Revisar temporada del año".
- **Administrador**: Usuario con permisos para gestionar facturación y modificar tarifas (actor asumido para este caso de uso; ver nota de supuesto en la Historia 1).

### Reglas de negocio

- **BR-001**: La modificación del precio de tarifa está restringida exclusivamente al rol Administrador, el mismo actor que gestiona facturación y revisa la temporada del año en el diagrama de casos de uso del Módulo 3.
- **BR-002**: Toda modificación de precio de tarifa DEBE ejecutar el caso de uso incluido "Revisar temporada del año" antes de confirmarse, conforme a la relación `<<include>>` del diagrama.
- **BR-003**: La Tarifa Base de la habitación (Módulo 1) es de solo lectura para este caso de uso; cualquier modificación de la Tarifa Base corresponde exclusivamente al Módulo 1.
- **BR-004**: El precio de tarifa por temporada modificado debe quedar disponible como insumo directo de "Calcular tarifa dinámica" (ambos casos de uso comparten la inclusión de "Revisar temporada del año"), sin que este caso de uso ejecute el cálculo dinámico en sí.
- **BR-005**: El valor guardado por esta funcionalidad impacta directamente el Hospedaje Base de la Matriz de Liquidación Final (Hospedaje Base = Tarifa según temporada x Noches), por lo que debe quedar inequívoco para el cálculo posterior.
- **BR-006**: El Módulo 3 reconoce tres categorías de temporada para efectos de tarifas dinámicas: temporada baja, temporada regular y temporada alta.
- **BR-007**: Una vez que el importe de hospedaje de una reserva queda confirmado, esta modificación de precio de tarifa NO lo afecta retroactivamente; es el mismo principio de no retroactividad que se repite de forma consistente en otros casos de uso del Módulo 3 relacionados con tarifas, temporadas e impuestos.
- **BR-008**: La detección y el bloqueo de temporadas con fechas solapadas es responsabilidad de "Revisar temporada del año", no de este caso de uso; este caso de uso confía en que la temporada indicada ya fue validada por esa revisión antes de permitir la modificación de precio, conforme a la relación `<<include>>` de FR-003.
- **BR-009**: El precio modificado por este caso de uso se propaga por la cadena de casos de uso del Módulo 3: Modificar precio de tarifa → Revisar temporada del año / Calcular tarifa dinámica → Aplicar tarifa dinámica (confirma y congela el importe) → Generar liquidación (reutiliza el importe sin recalcularlo) → Calcular Impuesto (IVA). Ninguno de esos casos de uso posteriores recalcula el precio de tarifa por su cuenta.

### Preguntas abiertas

- **OQ-001**: [REQUIERE ACLARACIÓN: el precio guardado por esta funcionalidad, ¿es un valor absoluto que reemplaza la tarifa de esa temporada, o es un porcentaje/incremento que "Calcular tarifa dinámica" combinará con la Tarifa Base? Esta ambigüedad no es exclusiva de este documento: otros casos de uso del Módulo 3 que consumen la tarifa dinámica tampoco definen aún esa fórmula. Se recomienda resolverla una sola vez y mantener la definición consistente en todos los documentos relacionados].
- **OQ-002**: [REQUIERE ACLARACIÓN: qué política de concurrencia debe aplicarse cuando dos Administradores modifican la misma tarifa al mismo tiempo: última escritura gana, bloqueo optimista con reintento, o bloqueo exclusivo mientras un Administrador edita].

## Requisitos no funcionales

- **NFR-001**: La modificación del precio debe completarse en un tiempo adecuado para no interrumpir la operación de recepción/facturación (ver SC-001).
- **NFR-002**: El precio actualizado debe propagarse de forma inmediata y consistente hacia "Calcular tarifa dinámica", sin generar discrepancias entre lo configurado por el Administrador y lo consultado por las OTAs (ver SC-002, SC-004).
- **NFR-003**: Los mensajes de error de validación deben ser comprensibles y accionables para el Administrador, indicando específicamente qué dato es inválido.
- **NFR-004**: El sistema debe mantener la integridad referencial entre la Tarifa por Temporada modificada y la Temporada del calendario asociada, evitando estados huérfanos o inconsistentes tras la modificación.
- **NFR-005**: El registro de historial de cambios (FR-005) no debe exponer datos personales de huéspedes; solo debe contener información de configuración tarifaria y del usuario administrador que realizó el cambio.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El Administrador puede modificar el precio de una tarifa en menos de 1 minuto desde que inicia la edición.
- **SC-002**: El 100% de las consultas de tarifa dinámica realizadas después de una modificación reflejan el precio actualizado, sin retrasos de propagación.
- **SC-003**: El sistema rechaza el 100% de los intentos de modificación con valores de precio inválidos (negativos, cero o no numéricos) o con temporadas no configuradas.
- **SC-004**: Cero discrepancias de precio entre lo configurado por el Administrador y lo consultado por las OTAs para una misma fecha/temporada.
