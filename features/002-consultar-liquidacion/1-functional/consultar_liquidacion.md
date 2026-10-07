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
   - **Entonces** el sistema devuelve el valor de hospedaje, el porcentaje y valor de la comisión aplicada, y el ingreso neto, tal como fueron calculados por `Generar liquidación`, junto con la factura definitiva asociada (con su IVA) cuando ya haya sido emitida

2. **Escenario**: Consulta antes del check-out
   - **Dado** que la estancia intermediada por la OTA aún no ha tenido check-out
   - **Cuando** la OTA consulta esa reserva
   - **Entonces** el sistema informa explícitamente que aún no existe liquidación, sin devolver un desglose parcial ni valores en cero

---

### Historia de usuario 2 - Módulo 1 consulta el resultado financiero de una habitación antes y después del check-out (Prioridad: P1)

Como Módulo 1, quiero consultar la liquidación de una habitación de una reserva antes de confirmar su check-out, para conocer el monto que corresponde a recepción o al huésped, y volver a consultarla después del check-out para confirmar que Módulo 3 procesó el evento correctamente.

**Por qué esta prioridad**: Módulo 1 consulta el resultado financiero antes de confirmar la salida y de emitir el evento que dispara `Generar liquidación`; sin un valor disponible en ese momento no puede informar el monto, y sin consultarlo después no puede cerrar su flujo operativo con la certeza de que la liquidación se generó.

**Prueba independiente**: Se puede consultar una habitación de una reserva antes de su check-out y verificar que el resultado se identifique como informativo, y luego emitir el evento de check-out y verificar que la consulta inmediata devuelva la liquidación `Final` con el mismo desglose.

**Escenarios de aceptación**:

1. **Escenario**: Consulta antes del check-out
   - **Dado** que una habitación de una reserva todavía no ha tenido check-out y la reserva y su cotización de hospedaje existen
   - **Cuando** Módulo 1 consulta la liquidación de esa habitación
   - **Entonces** el sistema devuelve una liquidación informativa, calculada en ese momento con el valor de hospedaje de la cotización guardada y la comisión que corresponde al canal de la reserva, identificada explícitamente como informativa y sin guardarla

2. **Escenario**: Confirmación tras un check-out
   - **Dado** que Módulo 1 acaba de emitir el evento `Registrar Check-out` para una habitación de una reserva
   - **Cuando** Módulo 1 consulta la liquidación de esa habitación
   - **Entonces** el sistema devuelve la liquidación `Final` recién generada, con el hospedaje y la comisión (si aplica) calculados en ese check-out

3. **Escenario**: La informativa coincide con la `Final`
   - **Dado** que Módulo 1 consultó la liquidación informativa de una habitación y los datos de la reserva y de la cotización no cambiaron
   - **Cuando** se registra el check-out de esa habitación y Módulo 1 vuelve a consultarla
   - **Entonces** la liquidación `Final` devuelta tiene el mismo valor de hospedaje, comisión e ingreso neto que la informativa

4. **Escenario**: Liquidación informativa que no se puede calcular
   - **Dado** que la reserva o su cotización para el tipo de habitación no existen, o que Módulo 2 no responde
   - **Cuando** Módulo 1 consulta la liquidación de una habitación sin check-out
   - **Entonces** el sistema informa el motivo, distinguiendo una reserva o cotización inexistente de una falla de comunicación, sin devolver un desglose parcial ni valores en cero

---

### Historia de usuario 3 - La consulta nunca deja ambigüedad entre "sin liquidación", "informativa" y "liquidación `Final`" (Prioridad: P2)

Como actor autorizado (Módulo 1 u OTA), quiero que cada respuesta de `Consultar liquidación` indique con claridad si corresponde a una liquidación `Final`, a una liquidación informativa o a la ausencia de liquidación, para no tratar por error un cálculo informativo como un valor definitivo ni la ausencia de datos como un ingreso neto en cero.

**Por qué esta prioridad**: Complementa a HU1 y HU2 dándoles una garantía adicional de interpretación correcta; no es indispensable para obtener el valor en sí, pero previene errores de conciliación o de cobro, por lo que su prioridad es menor.

**Prueba independiente**: Se puede consultar la misma estancia antes y después del check-out y verificar que la primera respuesta indica explícitamente que no es definitiva (informativa o ausencia, según el actor) y la segunda entrega el desglose `Final` completo, sin que ninguna se confunda con la otra.

**Escenarios de aceptación**:

1. **Escenario**: Cambio de resultado entre dos consultas de la misma estancia
   - **Dado** que una estancia todavía no tiene liquidación `Final`
   - **Cuando** se consulta antes del check-out y nuevamente después de que este ocurra
   - **Entonces** la primera respuesta indica explícitamente una liquidación informativa (Módulo 1) o la ausencia de liquidación (OTA), y la segunda entrega el desglose `Final` completo

2. **Escenario**: Consultas repetidas sin cambios
   - **Dado** que existe una liquidación `Final` ya generada
   - **Cuando** el mismo actor autorizado la consulta varias veces seguidas
   - **Entonces** el sistema devuelve siempre el mismo resultado, sin efectos secundarios ni recálculos

### Casos límite

- Consulta de Módulo 1 sobre una estancia sin check-out registrado: el sistema devuelve la liquidación informativa, sin guardarla ni generar un registro de liquidación.
- Consulta de una OTA sobre una estancia sin check-out registrado: el sistema debe informar que no existe liquidación, sin generar un registro vacío ni valores en cero.
- Una OTA intenta consultar una reserva de canal directo o intermediada por otra OTA: el sistema debe rechazar la consulta, sin exponer datos financieros de reservas ajenas.
- Consulta ejecutada en el instante exacto en que se está procesando el check-out: el sistema debe devolver un único resultado consistente (informativa o `Final`), nunca un estado intermedio o parcial.
- Consultas repetidas e inmediatas sobre la misma liquidación: deben devolver siempre el mismo resultado, sin efectos secundarios ni recálculos.
- Consulta que incluye, en su contexto, datos de control migratorio de la estancia: el sistema no debe exponerlos, respetando la frontera de responsabilidad con Módulo 2.
- Reserva o cotización inexistente, o Módulo 2 sin respuesta, al consultar una habitación sin check-out: la liquidación informativa no se calcula; el sistema informa el motivo y no devuelve valores parciales.
- Cambiaron las reglas de temporada o la tarifa base entre la consulta informativa y el check-out: el valor de hospedaje proviene de la cotización guardada, por lo que la liquidación `Final` no difiere de la informativa por ese motivo.
- Estancia cuya reserva fue cancelada en Módulo 2 antes del check-out: nunca existió liquidación `Final` para esa estancia; la consulta no debe devolver una liquidación `Final`.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir a los actores autorizados (`Módulo 1`, `OTA`) consultar la liquidación de una habitación de una reserva, identificada por el identificador de la reserva, el identificador de la habitación y el tipo de habitación.
- **FR-002**: El sistema DEBE devolver, cuando la liquidación exista, el desglose completo: valor de hospedaje, canal de origen, porcentaje y valor de la comisión OTA (si aplica), y el ingreso neto resultante. El IVA no forma parte de este desglose; se obtiene únicamente a través de la factura definitiva asociada (ver FR-003), cuando esta ya haya sido emitida.
- **FR-003**: El sistema DEBE incluir en la respuesta la factura definitiva asociada, tal como fue generada por `Generar factura final`, cuando esta ya haya sido emitida, sin necesidad de recalcularla. La liquidación informativa nunca incluye factura.
- **FR-004**: El sistema NO DEBE recalcular la liquidación `Final` ni su factura como efecto de una consulta; `Consultar liquidación` es de solo lectura sobre lo ya generado, y su única operación de cálculo es la liquidación informativa descrita en FR-009.
- **FR-005**: El sistema DEBE informar de manera explícita cuando no exista liquidación `Final` para la estancia consultada y no corresponda devolver una informativa (consulta de una `OTA`, o liquidación informativa no calculable), sin generar un registro vacío ni un valor por defecto.
- **FR-006**: El sistema DEBE restringir a `OTA` la consulta exclusivamente a las liquidaciones de sus propias reservas, identificadas por su código de confirmación externo y canal.
- **FR-007**: El sistema NO DEBE exponer datos de control migratorio en el resultado de la consulta, respetando la frontera de responsabilidad con Módulo 2.
- **FR-008**: El sistema DEBE devolver siempre el mismo resultado ante consultas repetidas sobre la misma liquidación `Final`, y sobre la misma liquidación informativa mientras no cambien los datos de la reserva ni de la cotización, garantizando que la consulta no tenga efectos secundarios.
- **FR-009**: El sistema DEBE calcular y devolver una liquidación informativa cuando `Módulo 1` consulte una habitación de una reserva que aún no tiene liquidación `Final`, usando el valor de hospedaje de la cotización guardada de esa habitación y el canal, la OTA y la comisión que informa Módulo 2 para la reserva, con las mismas reglas de cálculo de la liquidación `Final`.
- **FR-010**: El sistema DEBE identificar explícitamente toda liquidación informativa como informativa, distinguiéndola de una liquidación `Final` en la misma respuesta.
- **FR-011**: El sistema NO DEBE guardar la liquidación informativa ni tratarla como liquidación existente de la estancia.
- **FR-012**: El sistema DEBE rechazar el cálculo de la liquidación informativa, informando el motivo, cuando la reserva o la cotización para el tipo de habitación no existan o cuando Módulo 2 no responda, distinguiendo ambos casos y sin devolver valores parciales.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Consulta de liquidación**: Solicitud de un actor autorizado (`Módulo 1`, `OTA`) para obtener el desglose de la liquidación de una habitación de una reserva, o la confirmación explícita de que aún no existe.
- **Liquidación informativa**: Resultado calculado en el momento de la consulta para una habitación sin check-out, solo para `Módulo 1`; muestra el desglose que tendría la liquidación `Final`, no se guarda y no es base de ninguna factura.
- **Resultado de consulta**: Desglose de hospedaje, comisión OTA e ingreso neto, indicando si es `Final` o informativo, junto con la factura definitiva asociada (que contiene el IVA) cuando exista; o una indicación explícita de ausencia o de imposibilidad de calcular, cuando corresponda.
- **Ámbito de acceso por actor**: Regla que determina qué liquidaciones puede ver cada actor; `Módulo 1` accede a las de las estancias que gestiona, `OTA` únicamente a las de las reservas que ella misma intermedió.

### Reglas de negocio

- **BR-001**: `Consultar liquidación` no crea, modifica ni recalcula la liquidación `Final` ni su factura asociada; la liquidación informativa se calcula en el momento de la consulta y no se guarda.
- **BR-002**: El acceso está restringido a los actores autorizados `Módulo 1` y `OTA`; una OTA solo accede a las liquidaciones de las reservas que ella misma intermedió, y solo `Módulo 1` recibe la liquidación informativa.
- **BR-003**: El desglose devuelto debe reflejar fielmente el producido por `Generar liquidación` y `Generar factura final`, sin reinterpretarlo; la liquidación informativa debe reflejar el que tendría la liquidación `Final`.
- **BR-004**: Una liquidación inexistente nunca se representa como un resultado con valores en cero; su ausencia se informa de forma explícita.
- **BR-005**: La liquidación informativa no es una liquidación: no existe como registro de la estancia, no puede ser consultada posteriormente y no sustituye ni condiciona la liquidación `Final` que genera el check-out.

## Requisitos no funcionales

- **NFR-001**: Rendimiento: la consulta debe responder en un tiempo adecuado para no bloquear la interacción de Módulo 1 con recepción, incluido el paso previo a la confirmación del check-out, ni la conciliación periódica de la OTA.
- **NFR-002**: Determinismo: para la misma liquidación, la consulta debe devolver siempre el mismo resultado; la liquidación informativa debe coincidir con la `Final` cuando no cambian los datos de la reserva ni de la cotización.
- **NFR-003**: Confidencialidad: ninguna OTA debe poder acceder a liquidaciones de reservas de canal directo o de otra OTA.
- **NFR-004**: Privacidad: el resultado no debe exponer información personal del huésped ni datos migratorios que no sean necesarios para el proceso financiero.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las consultas de una OTA sobre sus propias reservas devuelven el desglose completo y correcto.
- **SC-002**: El 0% de las consultas de una OTA expone liquidaciones de reservas que no le pertenecen.
- **SC-003**: El 100% de las consultas de una OTA sobre estancias sin check-out informan explícitamente la ausencia de liquidación.
- **SC-004**: El 0% de las consultas recalcula o modifica la liquidación `Final` o su factura asociada.
- **SC-005**: El 100% de las consultas repetidas sobre una liquidación `Final` devuelven un resultado idéntico.
- **SC-006**: El 100% de las consultas de Módulo 1 sobre una habitación sin check-out, con reserva y cotización válidas, devuelven la liquidación informativa.
- **SC-007**: El 100% de las liquidaciones informativas se identifican como informativas y el 0% se guarda como liquidación de la estancia.
- **SC-008**: El 100% de las liquidaciones informativas coinciden con la liquidación `Final` posterior cuando no cambian los datos de la reserva ni de la cotización.
- **SC-009**: El 100% de las consultas de Módulo 1 con reserva o cotización inexistentes, o con Módulo 2 sin respuesta, informan el motivo sin valores parciales.