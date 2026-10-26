# Especificación de funcionalidad: Consultar liquidación

**Creado**: 2026-09-15

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - La OTA consulta las liquidaciones de su reserva (Prioridad: P1)

Como OTA (Booking, Airbnb, Expedia), quiero consultar las liquidaciones `Final` de las habitaciones de una reserva que yo intermedié, para verificar el ingreso neto y la comisión que se me reconoce y conciliar esos valores con mis propios registros.

**Por qué esta prioridad**: Sin esta consulta la OTA no puede verificar de manera independiente que la comisión pactada se aplicó correctamente, lo que es indispensable para su conciliación comercial con el hotel.

**Prueba independiente**: Se puede generar la liquidación de cada habitación con check-out de una reserva OTA y verificar que, al consultar la reserva como esa OTA, se reciben sus liquidaciones `Final` con el desglose calculado por `Generar liquidación`.

**Escenarios de aceptación**:

1. **Escenario**: Consulta de una reserva con habitaciones liquidadas
   - **Dado** que una reserva intermediada por la OTA tiene liquidaciones `Final` para una o más habitaciones
   - **Cuando** la OTA consulta la reserva usando su propia identidad
   - **Entonces** el sistema devuelve las liquidaciones `Final` de las habitaciones que tuvieron check-out, cada una identificada por su habitación y tipo de habitación, con su desglose —incluido `dynamicAdjustmentAmount`, para que la OTA vea la parte dinámica del hospedaje— y la factura definitiva asociada cuando haya sido emitida

2. **Escenario**: Consulta de una reserva sin habitaciones con check-out
   - **Dado** que ninguna habitación de la reserva intermediada por la OTA tiene check-out
   - **Cuando** la OTA consulta la reserva usando su propia identidad
   - **Entonces** el sistema informa que no existe liquidación, sin devolver desglose parcial ni valores en cero

3. **Escenario**: La OTA intenta consultar reservas ajenas
   - **Dado** que la reserva pertenece al canal directo o fue intermediada por otra OTA
   - **Cuando** una OTA consulta la reserva
   - **Entonces** el sistema no revela información financiera de esa reserva

4. **Escenario**: Consulta de una reserva OTA sin identidad válida
   - **Dado** que una solicitud autenticada presenta un token inválido o un token válido cuyo rol no es OTA, o que una solicitud sin token no incluye los datos mínimos de una consulta interna de Módulo 1 (`reservationRef` y `roomId`)
   - **Cuando** se consulta la reserva
   - **Entonces** el sistema rechaza la solicitud, no la trata como consulta de OTA y no revela información financiera

---

### Historia de usuario 2 - Módulo 1 consulta la liquidación informativa antes del check-out (Prioridad: P1)

Como Módulo 1, quiero consultar la liquidación de una habitación de una reserva antes de formalizar su check-out, para conocer el valor de hospedaje, la comisión y el ingreso neto correspondientes.

**Por qué esta prioridad**: Módulo 1 consulta el resultado financiero antes de formalizar la salida y emitir el evento asíncrono de check-out; necesita ese desglose para completar la revisión previa en recepción.

**Prueba independiente**: Se puede consultar una habitación con reserva y cotización válidas antes del check-out y verificar que el sistema devuelve su liquidación informativa, sin guardarla.

**Escenarios de aceptación**:

1. **Escenario**: Consulta informativa antes del check-out
   - **Dado** que una habitación de una reserva aún no ha tenido check-out y existen la reserva y su cotización de hospedaje
   - **Cuando** Módulo 1 consulta la liquidación de esa habitación
   - **Entonces** el sistema devuelve el desglose calculado con la cotización guardada y la comisión correspondiente al canal de la reserva, identificado como informativo y sin guardarlo. En este resultado `lodgingAmount` sale de la cotización; `baseLodgingAmount` es la suma de `baseRate` de sus noches y `dynamicAdjustmentAmount = lodgingAmount − baseLodgingAmount`, por lo que siempre se cumple `lodgingAmount = baseLodgingAmount + dynamicAdjustmentAmount`; `categoryRoom` es `null`.

2. **Escenario**: La informativa y la liquidación `Final` son coherentes
   - **Dado** que Módulo 1 obtuvo una liquidación informativa de una habitación y luego el check-out generó su liquidación `Final`, sin cambios en la reserva ni en la cotización
   - **Cuando** se comparan ambos resultados
   - **Entonces** coinciden en `baseLodgingAmount`, `dynamicAdjustmentAmount`, `lodgingAmount`, comisión e ingreso neto. `lodgingAmount` sale de la cotización (o de la liquidación FINAL); `baseLodgingAmount` es la suma de `baseRate` de las noches de la cotización y `dynamicAdjustmentAmount = lodgingAmount − baseLodgingAmount`, por lo que siempre se cumple `lodgingAmount = baseLodgingAmount + dynamicAdjustmentAmount`.

3. **Escenario**: La liquidación informativa no puede calcularse
   - **Dado** que no existe la reserva o la cotización consultada mediante `reservationRef` y `roomId`, la comisión de una reserva OTA está ausente, Módulo 2 no responde o devuelve una respuesta con estructura inválida, o la comisión recibida es un valor numérico menor que 0 o mayor que 100
   - **Cuando** Módulo 1 consulta una habitación sin check-out
   - **Entonces** el sistema informa por separado la ausencia de datos, la falla de comunicación y la comisión inválida, y no devuelve valores parciales

4. **Escenario**: La consulta no expone datos migratorios
   - **Dado** que la información de una reserva incluye datos de control migratorio
   - **Cuando** Módulo 1 consulta la liquidación
   - **Entonces** el resultado no expone esos datos

---

### Historia de usuario 3 - Cada actor recibe el resultado permitido durante el check-out asíncrono (Prioridad: P2)

Como `Módulo 1` o como OTA identificada con su propia identidad, quiero recibir el resultado que corresponde a mi consulta si coincide con el procesamiento asíncrono del check-out, para distinguir la liquidación informativa de la `Final`.

**Por qué esta prioridad**: Módulo 1 consulta normalmente antes de formalizar el check-out y puede recibir la liquidación informativa o la `Final` durante el procesamiento asíncrono; la OTA solo recibe una `Final` de sus reservas y, mientras no exista, recibe que no existe liquidación.

**Prueba independiente**: Se puede consultar concurrentemente con el procesamiento del evento como Módulo 1 y como OTA, y verificar que cada actor recibe únicamente el resultado permitido, sin presentar un estado intermedio o parcial.

**Escenarios de aceptación**:

1. **Escenario**: Consulta mientras se procesa el check-out
   - **Dado** que el evento de check-out está en procesamiento y aún no existe una liquidación `Final`
   - **Cuando** Módulo 1 consulta la habitación
   - **Entonces** el sistema devuelve la liquidación informativa; una vez que existe la `Final`, Módulo 1 recibe esta última, sin resultado intermedio

2. **Escenario**: Consultas repetidas de una liquidación `Final`
   - **Dado** que existe una liquidación `Final`
   - **Cuando** un actor autorizado la consulta repetidamente sin cambios en los datos
   - **Entonces** el sistema devuelve el mismo resultado sin efectos secundarios ni recálculos

3. **Escenario**: La OTA consulta antes de que exista la liquidación `Final`
   - **Dado** que una habitación de una reserva OTA aún no tiene liquidación `Final`
   - **Cuando** la OTA consulta la reserva con su propia identidad
   - **Entonces** el sistema informa que no existe liquidación para esa habitación y no devuelve una liquidación informativa ni valores en cero

### Casos límite

- Módulo 1 consulta normalmente antes de formalizar el check-out; si la consulta coincide con el procesamiento asíncrono, Módulo 1 recibe la liquidación informativa o la `Final`, mientras que una OTA solo recibe la `Final` existente o que no existe liquidación. Ningún actor recibe un estado intermedio.
- Una OTA consulta una reserva sin habitaciones con check-out: el sistema informa que no existe liquidación, sin generar un registro vacío ni devolver valores en cero.
- Una OTA consulta una reserva de canal directo o intermediada por otra OTA: el sistema no revela información financiera de esa reserva.
- Una solicitud con token inválido o con un rol distinto de OTA, o una solicitud sin token que no incluye `reservationRef` y `roomId`: se rechaza y no se revela información financiera.
- Módulo 2 no responde o devuelve una respuesta con estructura inválida, la reserva o cotización no existe, la comisión OTA está ausente o su valor numérico es menor que 0 o mayor que 100: el sistema informa el motivo sin devolver valores parciales. La estructura inválida se informa como falla de comunicación; la reserva, cotización o comisión ausente se informa como ausencia de datos; una comisión numérica fuera del rango permitido se informa como comisión inválida.
- Cambian las reglas de temporada o la tarifa base entre la consulta informativa y el check-out: ambas liquidaciones conservan el valor de la cotización guardada.
- Una reserva cancelada antes del check-out nunca tiene liquidación `Final` porque no hubo check-out; la OTA recibe que no existe liquidación. La liquidación informativa se calcula con los datos que devuelve Módulo 2; Módulo 3 no evalúa el estado de la reserva.
- El resultado de la consulta contiene datos de control migratorio: el sistema no los expone.
- Salida anticipada o salida el mismo día de la entrada: la liquidación informativa usa el valor de la cotización guardada y coincide con la `Final`; las fechas reales no modifican el valor de hospedaje.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir a `Módulo 1` consultar la liquidación de una habitación de una reserva mediante `reservationRef` y `roomId`. `categoryRoom` puede incluirse como dato informativo; no interviene en la selección ni validación de la consulta y su ausencia no la impide. En la respuesta `FINAL`, `categoryRoom` DEBE proceder de la liquidación; en la respuesta `INFORMATIVE`, DEBE ser `null` porque la cotización no contiene `categoryRoom` ni `roomType`. Nunca se toma del parámetro de la petición. Una OTA DEBE consultar mediante la reserva y su propia identidad como OTA.
- **FR-002**: El sistema DEBE devolver el desglose de cada liquidación `Final` existente —`lodgingAmount`, `baseLodgingAmount` y `dynamicAdjustmentAmount`, además del canal de origen, comisión OTA cuando aplique e ingreso neto— y la factura definitiva asociada cuando haya sido emitida. Para una OTA, la respuesta DEBE incluir la liquidación de cada habitación de la reserva que haya tenido check-out, identificada por habitación y tipo de habitación; las habitaciones sin check-out no se incluyen. La OTA DEBE recibir `dynamicAdjustmentAmount` en el desglose de cada liquidación `Final`, para ver la parte dinámica del hospedaje. El IVA no forma parte del desglose de liquidación y se obtiene únicamente de la factura definitiva.
- **FR-003**: El sistema DEBE incluir la factura definitiva asociada, tal como fue generada por `Generar factura final`, cuando ya haya sido emitida; la liquidación informativa nunca incluye factura.
- **FR-004**: El sistema NO DEBE recalcular la liquidación `Final` ni su factura como efecto de una consulta. La consulta es de solo lectura sobre los resultados existentes; la única operación de cálculo es la liquidación informativa descrita en FR-009.
- **FR-005**: El sistema DEBE informar explícitamente cuando no exista liquidación `Final` y no corresponda devolver una liquidación informativa, sin generar un registro vacío ni un valor por defecto. Si ninguna habitación de una reserva consultada por una OTA tiene check-out, DEBE informar que no existe liquidación.
- **FR-006**: El sistema DEBE restringir a cada OTA la consulta a sus propias reservas, identificadas mediante su identidad como OTA.
- **FR-007**: El sistema NO DEBE exponer datos de control migratorio ni `billingCustomer` en el resultado de la consulta, respetando la frontera de responsabilidad con Módulo 2.
- **FR-008**: El sistema DEBE devolver el mismo resultado ante consultas repetidas sobre una liquidación `Final` sin cambios en los datos. La liquidación informativa DEBE coincidir con la `Final` en `baseLodgingAmount`, `dynamicAdjustmentAmount`, `lodgingAmount`, comisión e ingreso neto cuando no cambien los datos de la reserva ni de la cotización. `lodgingAmount` sale de la cotización (o de la liquidación FINAL); `baseLodgingAmount` es la suma de `baseRate` de las noches de la cotización y `dynamicAdjustmentAmount = lodgingAmount − baseLodgingAmount`, por lo que siempre se cumple `lodgingAmount = baseLodgingAmount + dynamicAdjustmentAmount`.
- **FR-009**: El sistema DEBE calcular y devolver una liquidación informativa cuando `Módulo 1` consulte una habitación de una reserva que aún no tiene liquidación `Final`. DEBE obtener la reserva mediante `ReservationClientPort`, tomar sus `quoteIds` y llamar a `LodgingQuoteQueryPort.findByIds`; entre las cotizaciones devueltas, DEBE elegir la que tenga `roomId` igual al consultado. `categoryRoom` no interviene en la selección ni validación. `lodgingAmount` DEBE salir de la cotización; `baseLodgingAmount` DEBE ser la suma de `baseRate` de las noches de la cotización y `dynamicAdjustmentAmount = lodgingAmount − baseLodgingAmount`, por lo que siempre se cumple `lodgingAmount = baseLodgingAmount + dynamicAdjustmentAmount`. El sistema DEBE usar el canal, la OTA y la comisión informados por Módulo 2 y las mismas reglas de cálculo que `Generar liquidación`. Si la reserva no informa canal, DEBE tratarse como canal directo y no aplicar comisión. En la respuesta informativa, `categoryRoom` DEBE ser `null`, nunca proceder de la cotización ni del parámetro de la petición.
- **FR-010**: El sistema DEBE identificar explícitamente toda liquidación informativa y distinguirla de una liquidación `Final`.
- **FR-011**: El sistema NO DEBE guardar la liquidación informativa ni tratarla como liquidación existente de la estancia.
- **FR-012**: El sistema DEBE informar el motivo cuando no pueda calcular la liquidación informativa porque no existe la reserva o la cotización identificada mediante `reservationRef` y `roomId`, falta la comisión de una reserva OTA, Módulo 2 no responde o devuelve una respuesta con estructura inválida, o la comisión recibida es un valor numérico menor que 0 o mayor que 100. DEBE informar la respuesta estructuralmente inválida como falla de comunicación, distinguirla de la ausencia de datos y de una comisión inválida, y no devolver valores parciales.
- **FR-013**: El sistema DEBE tratar una solicitud sin token como una consulta interna de Módulo 1 cuando incluye `reservationRef` y `roomId`; si falta alguno de los dos, DEBE rechazarla sin revelar información financiera. Una solicitud autenticada con token inválido o con un rol distinto de OTA DEBE rechazarse sin revelar información financiera. Solo una OTA con identidad válida puede consultar las liquidaciones de sus reservas y solo Módulo 1, como módulo interno, puede recibir la liquidación informativa.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Consulta de liquidación**: Solicitud de `Módulo 1` para una habitación de una reserva o de una OTA para una reserva propia, que obtiene las liquidaciones `Final` disponibles o una liquidación informativa para Módulo 1.
- **Liquidación informativa**: Resultado calculado al consultar una habitación sin check-out, solo para `Módulo 1`; muestra el desglose que tendría la liquidación `Final`, no se guarda y no es base de una factura.
- **Resultado de consulta**: Desglose de `baseLodgingAmount`, `dynamicAdjustmentAmount`, `lodgingAmount`, comisión OTA e ingreso neto, con identificación del resultado como `Final` o informativo y la factura definitiva asociada cuando ya exista; o indicación explícita de ausencia o imposibilidad de cálculo. `lodgingAmount` sale de la cotización (o de la liquidación FINAL); `baseLodgingAmount` es la suma de `baseRate` de las noches de la cotización y `dynamicAdjustmentAmount = lodgingAmount − baseLodgingAmount`, por lo que siempre se cumple `lodgingAmount = baseLodgingAmount + dynamicAdjustmentAmount`.
- **Ámbito de acceso por actor**: `Módulo 1` consulta la liquidación de la habitación de una reserva que gestiona; una OTA consulta las liquidaciones de las habitaciones con check-out de sus propias reservas.

### Reglas de negocio

- **BR-001**: `Consultar liquidación` no crea, modifica ni recalcula la liquidación `Final` ni su factura asociada. La liquidación informativa se calcula al consultar y no se guarda.
- **BR-002**: El acceso está restringido a `Módulo 1` y OTA; cada OTA solo accede a sus propias reservas. Solo `Módulo 1` recibe la liquidación informativa.
- **BR-003**: El desglose refleja los valores producidos por `Generar liquidación` y `Generar factura final`, sin reinterpretarlos; la liquidación informativa refleja los valores que tendría la `Final` con los mismos datos.
- **BR-004**: Una liquidación inexistente nunca se representa con valores en cero; su ausencia se informa explícitamente.
- **BR-005**: La liquidación informativa no es una liquidación guardada, no puede consultarse como registro posterior y no sustituye ni condiciona la liquidación `Final` que genera el check-out.
- **BR-006**: Una solicitud sin token es una consulta interna de Módulo 1 solo si incluye `reservationRef` y `roomId`. Una solicitud autenticada requiere la identidad válida de la OTA correspondiente; con token inválido o con un rol distinto de OTA no accede a liquidaciones de reservas OTA. La liquidación informativa se reserva a Módulo 1.

## Requisitos no funcionales

- **NFR-001**: Rendimiento: el 95% de las consultas responde en menos de 800 ms en condiciones normales.
- **NFR-002**: Consistencia: una consulta de Módulo 1 concurrente con el procesamiento asíncrono del check-out debe devolver la liquidación informativa o la `Final`, nunca un estado intermedio o un desglose parcial. La informativa debe coincidir con la `Final` en `baseLodgingAmount`, `dynamicAdjustmentAmount`, `lodgingAmount`, comisión e ingreso neto cuando no cambien los datos de la reserva ni de la cotización. `lodgingAmount` sale de la cotización (o de la liquidación FINAL); `baseLodgingAmount` es la suma de `baseRate` de las noches de la cotización y `dynamicAdjustmentAmount = lodgingAmount − baseLodgingAmount`, por lo que siempre se cumple `lodgingAmount = baseLodgingAmount + dynamicAdjustmentAmount`.
- **NFR-003**: Confidencialidad: ninguna OTA debe acceder a liquidaciones de reservas de canal directo o de otra OTA.
- **NFR-004**: Privacidad: el resultado no debe exponer información personal del huésped, datos migratorios ni `billingCustomer`.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las consultas de una OTA sobre sus propias reservas devuelve las liquidaciones `Final` disponibles con el desglose correcto y la identificación de cada habitación y tipo de habitación.
- **SC-002**: El 0% de las consultas de una OTA expone liquidaciones de reservas que no le pertenecen.
- **SC-003**: El 100% de las consultas de una OTA sobre una reserva sin habitaciones con check-out informa que no existe liquidación.
- **SC-004**: El 0% de las consultas recalcula o modifica la liquidación `Final` o su factura asociada.
- **SC-005**: El 100% de las consultas repetidas sobre una liquidación `Final` sin cambios en los datos devuelve un resultado idéntico.
- **SC-006**: El 100% de las consultas de Módulo 1 sobre una habitación sin check-out, con reserva y cotización válidas, devuelve la liquidación informativa.
- **SC-007**: El 100% de las liquidaciones informativas se identifica como informativo y el 0% se guarda como liquidación de la estancia.
- **SC-008**: El 100% de las liquidaciones informativas coincide con la `Final` en `baseLodgingAmount`, `dynamicAdjustmentAmount`, `lodgingAmount`, comisión e ingreso neto cuando no cambian los datos de la reserva ni de la cotización. `lodgingAmount` sale de la cotización (o de la liquidación FINAL); `baseLodgingAmount` es la suma de `baseRate` de las noches de la cotización y `dynamicAdjustmentAmount = lodgingAmount − baseLodgingAmount`, por lo que siempre se cumple `lodgingAmount = baseLodgingAmount + dynamicAdjustmentAmount`.
- **SC-009**: El 100% de las consultas informativas que no pueden calcularse por ausencia de reserva, cotización o comisión, respuesta estructuralmente inválida de Módulo 2 o comisión numérica menor que 0 o mayor que 100 informa el motivo correspondiente sin valores parciales, distinguiendo falla de comunicación, ausencia de datos y comisión inválida.
- **SC-010**: El 100% de las solicitudes autenticadas con token inválido o con un rol distinto de OTA, y de las solicitudes sin token que no incluyen `reservationRef` y `roomId`, se rechaza sin revelar información financiera de reservas OTA.
