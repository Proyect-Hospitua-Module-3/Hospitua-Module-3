# Especificación de funcionalidad: Consultar liquidación

**Creado**: 2026-09-07

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - La OTA consulta el ingreso neto y la comisión de su propia reserva (Prioridad: P1)

Como OTA (Booking, Airbnb, Expedia), quiero consultar la liquidación de una reserva que yo intermedié, para verificar el ingreso neto del hotel, la comisión que se me reconoce y conciliar ese valor con mis propios registros.

**Por qué esta prioridad**: Sin esta consulta la OTA no tiene forma de verificar de manera independiente que la comisión pactada se aplicó correctamente, lo que es indispensable para la conciliación comercial periódica con el hotel.

**Prueba independiente**: Se puede generar la liquidación de una reserva OTA con comisión conocida y verificar que, al consultarla como esa OTA, el resultado muestre el valor de hospedaje, el porcentaje y valor de la comisión, y el ingreso neto, coincidiendo con lo calculado por "Generar liquidación".

**Escenarios de aceptación**:

1. **Escenario**: Consulta de una liquidación definitiva propia
   - **Dado** que existe una liquidación definitiva de una reserva intermediada por la OTA que consulta
   - **Cuando** la OTA solicita la liquidación de esa reserva
   - **Entonces** el sistema devuelve el valor de hospedaje, el porcentaje y valor de la comisión aplicada, el IVA y el ingreso neto, tal como fueron calculados originalmente

2. **Escenario**: Consulta de una liquidación preliminar propia
   - **Dado** que la estancia intermediada por la OTA aún no ha tenido check-out y solo existe una liquidación preliminar
   - **Cuando** la OTA consulta esa reserva
   - **Entonces** el sistema devuelve el mismo desglose disponible hasta el momento, marcado como preliminar

---

### Historia de usuario 2 - Módulo 2 confirma el resultado financiero tras un evento de check-in o check-out (Prioridad: P1)

Como Módulo 2 (módulo de reservas), quiero consultar la liquidación de una estancia después de emitir un evento de check-in o check-out, para confirmar que Módulo 3 procesó el evento correctamente y poder reflejar el monto correspondiente a recepción o al huésped.

**Por qué esta prioridad**: Módulo 2 emite los eventos que disparan "Generar liquidación" de forma asíncrona; sin una forma de consultar el resultado, no puede cerrar su propio flujo operativo con la certeza de que la liquidación se generó.

**Prueba independiente**: Se puede emitir un evento de check-in o de check-out para una estancia y verificar que, al consultarla inmediatamente después como Módulo 2, el resultado refleje exactamente el desglose y el estado producidos por ese evento.

**Escenarios de aceptación**:

1. **Escenario**: Confirmación tras un check-in
   - **Dado** que Módulo 2 acaba de emitir el evento "Registrar Check-in" para una estancia
   - **Cuando** Módulo 2 consulta la liquidación de esa estancia
   - **Entonces** el sistema devuelve la liquidación preliminar recién generada, con el hospedaje, la comisión (si aplica) y el IVA calculados en ese check-in

2. **Escenario**: Confirmación tras un check-out
   - **Dado** que Módulo 2 acaba de emitir el evento "Registrar Check-out" para una estancia con liquidación previamente abierta
   - **Cuando** Módulo 2 consulta la liquidación de esa estancia
   - **Entonces** el sistema devuelve la liquidación ya cerrada con los valores definitivos, sin importar que la consulta ocurra inmediatamente después del cierre

---

### Historia de usuario 3 - La consulta distingue explícitamente si el valor es preliminar o definitivo (Prioridad: P2)

Como actor autorizado (Módulo 2 u OTA), quiero que cada respuesta de "Consultar liquidación" indique de forma explícita si el estado es preliminar o definitivo, para no tratar por error un valor estimado como si fuera el ingreso neto final.

**Por qué esta prioridad**: Complementa a HU1 y HU2 dándoles una garantía adicional de interpretación correcta; no es indispensable para obtener el valor en sí, pero previene errores de conciliación o de cobro si un preliminar se confunde con un definitivo, por lo que su prioridad es menor.

**Prueba independiente**: Se puede consultar la misma estancia antes y después del check-out y verificar que el estado devuelto cambia explícitamente de preliminar a definitivo, sin que el desglose deje nunca ambigüedad sobre cuál de los dos es.

**Escenarios de aceptación**:

1. **Escenario**: Cambio de estado visible entre dos consultas de la misma estancia
   - **Dado** que una estancia tiene una liquidación preliminar generada en el check-in
   - **Cuando** se consulta la liquidación antes del check-out y nuevamente después de que este ocurra
   - **Entonces** la primera respuesta indica estado preliminar y la segunda indica estado definitivo, sin que ambas parezcan el mismo tipo de valor

2. **Escenario**: Liquidación anulada
   - **Dado** que el check-in de una estancia fue anulado y su liquidación transicionó a estado anulado
   - **Cuando** un actor autorizado consulta esa estancia
   - **Entonces** el sistema indica explícitamente el estado anulado, sin presentar el desglose como si estuviera vigente

### Casos límite

- Consulta de una estancia sin check-in ni check-out registrado: el sistema debe informar que no existe liquidación, sin generar un registro vacío ni valores en cero.
- Una OTA intenta consultar una reserva de canal directo o intermediada por otra OTA: el sistema debe rechazar la consulta, sin exponer datos financieros de reservas ajenas.
- Consulta ejecutada en el instante exacto de la transición de preliminar a definitivo (durante el procesamiento del check-out): el sistema debe devolver un único estado consistente, nunca una mezcla de valores preliminares y definitivos.
- Consultas repetidas e inmediatas sobre la misma liquidación sin cambios de estado: deben devolver siempre el mismo resultado, sin efectos secundarios ni recálculos.
- Consulta de una liquidación cuya estancia fue anulada tras el check-in: el sistema debe reflejar el estado anulado de forma explícita, no como preliminar ni definitiva.
- Consulta que incluye, en su contexto, datos de control migratorio de la estancia: el sistema no debe exponerlos, respetando la frontera de responsabilidad con Módulo 2.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir a los actores autorizados (`Módulo 2`, `OTA`) consultar la liquidación de una estancia identificada por su reserva/estancia.
- **FR-002**: El sistema DEBE devolver, en cada consulta, el desglose completo de la liquidación: valor de hospedaje, canal de origen, porcentaje y valor de la comisión OTA (si aplica), IVA y el ingreso neto resultante.
- **FR-003**: El sistema DEBE incluir en la respuesta el documento de factura asociado (prefactura o factura definitiva) tal como fue generado por "Generar factura final", sin necesidad de recalcularlo.
- **FR-004**: El sistema NO DEBE recalcular la liquidación ni ninguno de sus componentes como efecto de una consulta; "Consultar liquidación" es una operación exclusivamente de lectura.
- **FR-005**: El sistema DEBE indicar explícitamente en cada respuesta si el estado de la liquidación consultada es preliminar o definitivo, para que el actor no confunda un valor estimado con uno definitivo.
- **FR-006**: El sistema DEBE restringir a `OTA` la consulta exclusivamente a las liquidaciones de sus propias reservas, identificadas por su código de confirmación externo y canal.
- **FR-007**: El sistema DEBE informar de manera explícita cuando no exista ninguna liquidación para la estancia consultada, sin generar un registro vacío ni un valor por defecto.
- **FR-008**: El sistema DEBE reflejar el estado anulado cuando la liquidación consultada corresponda a un check-in anulado, sin presentar cifras como si estuvieran vigentes.
- **FR-009**: El sistema NO DEBE exponer datos de control migratorio en el resultado de la consulta, respetando la frontera de responsabilidad con Módulo 2.
- **FR-010**: El sistema DEBE devolver siempre el mismo resultado ante consultas repetidas sobre la misma liquidación mientras su estado no cambie, garantizando que la consulta no tenga efectos secundarios.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Consulta de liquidación**: Solicitud de un actor autorizado (`Módulo 2`, `OTA`) para obtener el desglose y estado de la liquidación de una estancia.
- **Resultado de consulta**: Desglose de hospedaje, comisión OTA, IVA e ingreso neto, junto con el estado (preliminar, definitivo o anulado) y la factura asociada (prefactura o definitiva).
- **Ámbito de acceso por actor**: Regla que determina qué liquidaciones puede ver cada actor; `Módulo 2` accede a las que gestiona, `OTA` únicamente a las de las reservas que ella misma intermedió.

### Reglas de negocio

- **BR-001**: "Consultar liquidación" es una operación exclusivamente de lectura; no crea, modifica ni recalcula la liquidación ni su factura asociada.
- **BR-002**: El acceso está restringido a los actores autorizados `Módulo 2` y `OTA`; una OTA solo accede a las liquidaciones de las reservas que ella misma intermedió.
- **BR-003**: El estado devuelto (preliminar, definitivo o anulado) debe reflejar fielmente el producido por "Generar liquidación" y "Generar factura final", sin reinterpretarlo.
- **BR-004**: Una liquidación inexistente nunca se representa como un resultado con valores en cero; su ausencia se informa de forma explícita.

## Requisitos no funcionales

- **NFR-001**: Rendimiento: la consulta debe responder en un tiempo adecuado para no bloquear la interacción de Módulo 2 con recepción ni la conciliación periódica de la OTA.
- **NFR-002**: Determinismo: para la misma liquidación y el mismo estado, la consulta debe devolver siempre el mismo resultado.
- **NFR-003**: Confidencialidad: ninguna OTA debe poder acceder a liquidaciones de reservas de canal directo o de otra OTA.
- **NFR-004**: Privacidad: el resultado no debe exponer información personal del huésped ni datos migratorios que no sean necesarios para el proceso financiero.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las consultas de una OTA sobre sus propias reservas devuelven el desglose completo y correcto.
- **SC-002**: El 0% de las consultas de una OTA expone liquidaciones de reservas que no le pertenecen.
- **SC-003**: El 100% de las consultas indican explícitamente si el estado es preliminar, definitivo o anulado.
- **SC-004**: El 0% de las consultas recalcula o modifica la liquidación o su factura asociada.
- **SC-005**: El 100% de las consultas sobre estancias sin liquidación informan su ausencia sin generar un registro vacío.
- **SC-006**: El 100% de las consultas repetidas sobre una liquidación sin cambios de estado devuelven un resultado idéntico.
