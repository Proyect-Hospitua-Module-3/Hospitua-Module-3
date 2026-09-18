# Especificación de funcionalidad: Consultar liquidación

**Creado**: 2026-09-15

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - La OTA consulta el ingreso neto y la comisión de su propia reserva (Prioridad: P1)

Como OTA (Booking, Airbnb, Expedia), quiero consultar la liquidación de una reserva que yo intermedié, para verificar el ingreso neto del hotel, la comisión que se me reconoce y conciliar ese valor con mis propios registros.

**Por qué esta prioridad**: Sin esta consulta la OTA no tiene forma de verificar de manera independiente que la comisión pactada se aplicó correctamente, lo que es indispensable para la conciliación comercial periódica con el hotel.

**Prueba independiente**: Se puede generar la liquidación de una reserva OTA con comisión conocida y verificar que, al consultarla como esa OTA después del check-out, el resultado muestre el valor de hospedaje, el porcentaje y valor de la comisión, y el ingreso neto, coincidiendo con lo calculado por `Generar liquidación`.

**Escenarios de aceptación**:

1. **Escenario**: Consulta de una liquidación `Final` propia
   - **Dado** que existe una liquidación `Final` de una reserva intermediada por la OTA que consulta
   - **Cuando** la OTA solicita la liquidación de esa reserva
   - **Entonces** el sistema devuelve el valor de hospedaje, el porcentaje y valor de la comisión aplicada, el IVA y el ingreso neto, tal como fueron calculados originalmente

2. **Escenario**: Consulta antes del check-out
   - **Dado** que la estancia intermediada por la OTA aún no ha tenido check-out
   - **Cuando** la OTA consulta esa reserva
   - **Entonces** el sistema informa explícitamente que aún no existe liquidación, sin devolver un desglose parcial ni valores en cero

---

### Historia de usuario 2 - Módulo 1 y Módulo 2 confirman el resultado financiero tras el check-out (Prioridad: P1)

Como Módulo 1 (que emite el evento de check-out) o Módulo 2 (módulo de reservas), quiero consultar la liquidación de una estancia después del check-out, para confirmar que Módulo 3 procesó el evento correctamente y poder reflejar el monto correspondiente a recepción o al huésped.

**Por qué esta prioridad**: Módulo 1 emite el evento que dispara `Generar liquidación` de forma asíncrona; sin una forma de consultar el resultado, no puede cerrar su propio flujo operativo con la certeza de que la liquidación se generó.

**Prueba independiente**: Se puede emitir el evento de check-out para una estancia y verificar que, al consultarla inmediatamente después como Módulo 1 o Módulo 2, el resultado refleje exactamente el desglose producido por ese evento.

**Escenarios de aceptación**:

1. **Escenario**: Confirmación tras un check-out
   - **Dado** que Módulo 1 acaba de emitir el evento `Registrar Check-out` para una estancia
   - **Cuando** Módulo 1 o Módulo 2 consulta la liquidación de esa estancia
   - **Entonces** el sistema devuelve la liquidación `Final` recién generada, con el hospedaje, la comisión (si aplica) y el IVA calculados en ese check-out

2. **Escenario**: Consulta de una estancia sin check-out
   - **Dado** que una estancia todavía no ha tenido check-out
   - **Cuando** Módulo 1 o Módulo 2 consulta su liquidación
   - **Entonces** el sistema informa explícitamente que aún no existe liquidación para esa estancia

---

### Historia de usuario 3 - La consulta nunca deja ambigüedad entre "sin liquidación" y "liquidación `Final`" (Prioridad: P2)

Como actor autorizado (Módulo 1, Módulo 2 u OTA), quiero que cada respuesta de `Consultar liquidación` indique con claridad si la liquidación ya existe (`Final`) o si la estancia todavía no ha llegado al check-out, para no tratar por error la ausencia de datos como un ingreso neto en cero.

**Por qué esta prioridad**: Complementa a HU1 y HU2 dándoles una garantía adicional de interpretación correcta; no es indispensable para obtener el valor en sí, pero previene errores de conciliación o de cobro, por lo que su prioridad es menor.

**Prueba independiente**: Se puede consultar la misma estancia antes y después del check-out y verificar que la primera respuesta indica ausencia de liquidación y la segunda entrega el desglose `Final` completo, sin que ninguna de las dos se confunda con un resultado vacío por error.

**Escenarios de aceptación**:

1. **Escenario**: Cambio de resultado entre dos consultas de la misma estancia
   - **Dado** que una estancia todavía no tiene liquidación
   - **Cuando** se consulta antes del check-out y nuevamente después de que este ocurra
   - **Entonces** la primera respuesta indica explícitamente que no existe liquidación, y la segunda entrega el desglose `Final` completo

2. **Escenario**: Consultas repetidas sin cambios
   - **Dado** que existe una liquidación `Final` ya generada
   - **Cuando** el mismo actor autorizado la consulta varias veces seguidas
   - **Entonces** el sistema devuelve siempre el mismo resultado, sin efectos secundarios ni recálculos

### Casos límite

- Consulta de una estancia sin check-out registrado: el sistema debe informar que no existe liquidación, sin generar un registro vacío ni valores en cero.
- Una OTA intenta consultar una reserva de canal directo o intermediada por otra OTA: el sistema debe rechazar la consulta, sin exponer datos financieros de reservas ajenas.
- Consulta ejecutada en el instante exacto en que se está procesando el check-out: el sistema debe devolver un único resultado consistente (existe o no existe), nunca un estado intermedio o parcial.
- Consultas repetidas e inmediatas sobre la misma liquidación: deben devolver siempre el mismo resultado, sin efectos secundarios ni recálculos.
- Consulta que incluye, en su contexto, datos de control migratorio de la estancia: el sistema no debe exponerlos, respetando la frontera de responsabilidad con Módulo 2.
- Estancia cuya reserva fue cancelada en Módulo 2 antes del check-out: nunca existió liquidación para esa estancia; la consulta debe informar su ausencia igual que para cualquier estancia sin check-out.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir a los actores autorizados (`Módulo 1`, `Módulo 2`, `OTA`) consultar la liquidación de una estancia identificada por su reserva/estancia.
- **FR-002**: El sistema DEBE devolver, cuando la liquidación exista, el desglose completo: valor de hospedaje, canal de origen, porcentaje y valor de la comisión OTA (si aplica), IVA y el ingreso neto resultante.
- **FR-003**: El sistema DEBE incluir en la respuesta la factura definitiva asociada, tal como fue generada por `Generar factura final`, sin necesidad de recalcularla.
- **FR-004**: El sistema NO DEBE recalcular la liquidación ni ninguno de sus componentes como efecto de una consulta; `Consultar liquidación` es una operación exclusivamente de lectura.
- **FR-005**: El sistema DEBE informar de manera explícita cuando no exista ninguna liquidación para la estancia consultada (por no haber ocurrido aún el check-out), sin generar un registro vacío ni un valor por defecto.
- **FR-006**: El sistema DEBE restringir a `OTA` la consulta exclusivamente a las liquidaciones de sus propias reservas, identificadas por su código de confirmación externo y canal.
- **FR-007**: El sistema NO DEBE exponer datos de control migratorio en el resultado de la consulta, respetando la frontera de responsabilidad con Módulo 2.
- **FR-008**: El sistema DEBE devolver siempre el mismo resultado ante consultas repetidas sobre la misma liquidación, garantizando que la consulta no tenga efectos secundarios.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Consulta de liquidación**: Solicitud de un actor autorizado (`Módulo 1`, `Módulo 2`, `OTA`) para obtener el desglose de la liquidación `Final` de una estancia, o la confirmación explícita de que aún no existe.
- **Resultado de consulta**: Desglose de hospedaje, comisión OTA, IVA e ingreso neto, junto con la factura definitiva asociada, cuando la liquidación existe; o una indicación explícita de ausencia, cuando no.
- **Ámbito de acceso por actor**: Regla que determina qué liquidaciones puede ver cada actor; `Módulo 1` y `Módulo 2` acceden a las de las estancias que gestionan, `OTA` únicamente a las de las reservas que ella misma intermedió.

### Reglas de negocio

- **BR-001**: `Consultar liquidación` es una operación exclusivamente de lectura; no crea, modifica ni recalcula la liquidación ni su factura asociada.
- **BR-002**: El acceso está restringido a los actores autorizados `Módulo 1`, `Módulo 2` y `OTA`; una OTA solo accede a las liquidaciones de las reservas que ella misma intermedió.
- **BR-003**: El desglose devuelto debe reflejar fielmente el producido por `Generar liquidación` y `Generar factura final`, sin reinterpretarlo.
- **BR-004**: Una liquidación inexistente nunca se representa como un resultado con valores en cero; su ausencia se informa de forma explícita.

## Requisitos no funcionales

- **NFR-001**: Rendimiento: la consulta debe responder en un tiempo adecuado para no bloquear la interacción de Módulo 1 o Módulo 2 con recepción ni la conciliación periódica de la OTA.
- **NFR-002**: Determinismo: para la misma liquidación, la consulta debe devolver siempre el mismo resultado.
- **NFR-003**: Confidencialidad: ninguna OTA debe poder acceder a liquidaciones de reservas de canal directo o de otra OTA.
- **NFR-004**: Privacidad: el resultado no debe exponer información personal del huésped ni datos migratorios que no sean necesarios para el proceso financiero.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las consultas de una OTA sobre sus propias reservas devuelven el desglose completo y correcto.
- **SC-002**: El 0% de las consultas de una OTA expone liquidaciones de reservas que no le pertenecen.
- **SC-003**: El 100% de las consultas sobre estancias sin check-out informan explícitamente la ausencia de liquidación.
- **SC-004**: El 0% de las consultas recalcula o modifica la liquidación o su factura asociada.
- **SC-005**: El 100% de las consultas repetidas sobre una liquidación devuelven un resultado idéntico.
