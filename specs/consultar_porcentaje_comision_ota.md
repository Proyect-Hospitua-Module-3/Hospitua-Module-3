# Especificación de funcionalidad: Consultar porcentaje de comisión OTA

**Creado**: 2026-09-07  

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Obtener el porcentaje de comisión pactado para el canal OTA de una reserva en el check-in (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero consultar el porcentaje de comisión pactado para el canal OTA de origen de una reserva en el momento del check-in, para usarlo como base de "Descontar comisión OTA" durante toda la estancia.

**Por qué esta prioridad**: Sin este porcentaje no puede calcularse cuánto debe descontarse del hospedaje bruto cuando la reserva proviene de un intermediario; es un insumo obligatorio de la Matriz de Liquidación Final (Comisión OTA = - (Valor Hospedaje x % Comisión)).

**Prueba independiente**: Se puede invocar la consulta en el check-in con un canal de origen OTA identificado (p. ej. Booking, Airbnb, Expedia) y verificar de forma independiente que el resultado incluya el porcentaje pactado para ese canal, sin necesidad de generar una liquidación completa.

**Escenarios de aceptación**:

1. **Escenario**: Consulta exitosa para un canal OTA con comisión pactada
   - **Dado** que la reserva identifica un canal OTA (p. ej. Booking) con un porcentaje de comisión pactado, recibido en el evento de check-in
   - **Cuando** "Descontar comisión OTA" invoca la consulta durante el check-in
   - **Entonces** el sistema devuelve el porcentaje pactado para ese canal, identificando el canal consultado

2. **Escenario**: Reserva de canal directo
   - **Dado** que la reserva no proviene de un intermediario (canal directo) o no tiene canal de origen registrado
   - **Cuando** se invoca la consulta
   - **Entonces** el sistema indica que no aplica comisión OTA, sin devolver un porcentaje de cero como si fuera un valor configurado

---

### Historia de usuario 2 - Obtener el porcentaje una sola vez en el check-in y mantenerlo fijo para toda la estancia (Prioridad: P1)

Como responsable de facturación, quiero que la consulta se realice una única vez por estancia, en el check-in, y que su resultado se mantenga fijo para toda la estancia (incluida la liquidación definitiva en el check-out), para que el monto de comisión sea consistente con lo pactado al inicio de la reserva.

**Por qué esta prioridad**: El evento de check-in (`registrar_checkin.md` FR-003/FR-010) es el único punto donde `Modulo2` suministra el porcentaje pactado; el evento de check-out (`registrar_checkout.md` FR-002) no incluye ese campo, por lo que no existe una fuente para obtener un valor distinto en ese momento.

**Prueba independiente**: Se puede invocar la consulta en el check-in de una estancia y verificar que devuelve un porcentaje; luego, verificar que ese mismo porcentaje se reutiliza sin volver a invocar la consulta cuando "Generar liquidación" recalcula el monto en el check-out.

**Escenarios de aceptación**:

1. **Escenario**: Consulta única en el check-in de la estancia
   - **Dado** que la reserva identifica un canal OTA con un porcentaje de comisión pactado, recibido en el evento de check-in
   - **Cuando** "Descontar comisión OTA" invoca la consulta por primera vez para esa estancia (en el check-in)
   - **Entonces** el sistema devuelve el porcentaje pactado y este queda fijado como el aplicable a toda la estancia

2. **Escenario**: El porcentaje fijado se reutiliza sin volver a consultarse
   - **Dado** que ya existe un porcentaje fijado para una estancia desde su check-in
   - **Cuando** "Generar liquidación" recalcula el monto de comisión en el check-out (por ejemplo, por un cambio en el número de noches)
   - **Entonces** el sistema reutiliza el mismo porcentaje ya fijado, sin invocar nuevamente la consulta

---

### Historia de usuario 3 - Rechazar la consulta cuando no exista comisión configurada (Prioridad: P1)

Como responsable de facturación, quiero que el sistema rechace la consulta cuando un canal OTA no tenga un porcentaje de comisión pactado, para evitar que se asuma una comisión de cero o un valor supuesto.

**Por qué esta prioridad**: Sustituir una configuración faltante por cero generaría una liquidación con una comisión incorrecta cuando en realidad el pacto con la OTA todavía no está definido.

**Prueba independiente**: Se puede invocar la consulta para un canal OTA sin porcentaje configurado y verificar que el sistema rechace la consulta en vez de devolver 0%.

**Escenarios de aceptación**:

1. **Escenario**: Canal OTA sin porcentaje configurado
   - **Dado** que la reserva identifica un canal OTA que no tiene ningún porcentaje de comisión pactado registrado
   - **Cuando** se invoca la consulta
   - **Entonces** el sistema rechaza la consulta e informa la ausencia de configuración, sin sustituirla por cero

2. **Escenario**: Canal OTA no reconocido
   - **Dado** que el canal de origen indicado no corresponde a ninguna OTA reconocida por `Modulo2`
   - **Cuando** se invoca la consulta
   - **Entonces** el sistema rechaza la consulta en vez de asumir un canal por defecto

### Casos límite

- El porcentaje de comisión pactado es exactamente 0%: debe distinguirse de la ausencia de configuración; un 0% explícito es un valor válido y debe devolverse como tal.
- El porcentaje configurado es negativo o mayor a 100%: el sistema debe rechazar la consulta en vez de propagar un valor inválido hacia la liquidación.
- Existen dos porcentajes vigentes simultáneamente para el mismo canal OTA (por ejemplo, por una renegociación mal cerrada): el sistema debe rechazar la consulta por ambigüedad, sin elegir uno arbitrariamente.
- El canal de origen no está identificado en la reserva: la consulta debe indicar que no aplica comisión, sin bloquear la generación de la liquidación de canal directo.
- El porcentaje pactado con la OTA cambia en `Modulo2` después del check-in de una estancia (por ejemplo, por una renegociación): ese cambio no afecta la estancia ya iniciada; la liquidación preliminar y la definitiva deben usar el mismo porcentaje capturado en el check-in, no el que quede vigente después.
- Se agrega una nueva OTA al sistema sin definir aún su porcentaje pactado: toda consulta para ese canal debe rechazarse hasta que se configure.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE consultar, en el check-in de la estancia, el porcentaje de comisión pactado para el canal OTA identificado como origen de una reserva, obteniéndolo de `Modulo2` (recibido en el evento de check-in); ese porcentaje queda fijado para toda la estancia.
- **FR-002**: El sistema DEBE indicar que no aplica comisión OTA cuando la reserva sea de canal directo o no tenga canal de origen registrado, sin devolver un porcentaje de cero como si fuera una configuración explícita.
- **FR-003**: El sistema DEBE devolver el porcentaje capturado en el evento de check-in de la estancia; una vez fijado, no debe reflejar cambios posteriores del pacto con la OTA en `Modulo2` hasta una nueva reserva.
- **FR-004**: El sistema DEBE rechazar la consulta y no devolver un valor sustituto cuando el canal OTA no tenga ningún porcentaje de comisión pactado configurado.
- **FR-005**: El sistema DEBE rechazar la consulta cuando se detecte más de un porcentaje vigente simultáneamente para el mismo canal OTA, sin resolver la ambigüedad de forma arbitraria.
- **FR-006**: El sistema DEBE rechazar la consulta cuando el porcentaje configurado sea inválido (negativo, mayor a 100%, o no numérico).
- **FR-007**: El sistema DEBE identificar el canal OTA específico consultado (p. ej. Booking, Airbnb, Expedia) en el resultado de la consulta.
- **FR-008**: El sistema NO DEBE modificar, negociar ni completar la configuración del porcentaje de comisión OTA en `Modulo2`; esta consulta es de solo lectura.
- **FR-009**: El sistema DEBE distinguir entre un porcentaje de comisión configurado en 0% y la ausencia total de configuración para un canal OTA.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Canal OTA**: Intermediario de reserva (p. ej. Booking, Airbnb, Expedia) gestionado y registrado por `Modulo2`, con un porcentaje de comisión pactado.
- **Porcentaje de comisión pactado**: Tasa acordada con un canal OTA, gestionada por `Modulo2`, recibida en el evento de check-in de cada reserva y fijada para toda la estancia; usada por Módulo 3 para descontar del valor de hospedaje bruto (ver `descontar_comision_ota.md`).
- **Canal de origen de la reserva**: Clasificación de la reserva como directo o como un canal OTA específico, de la cual depende si esta consulta aplica.
- **Resultado de consulta**: Porcentaje pactado devuelto (fijado para la estancia desde el check-in), indicación de que no aplica comisión (canal directo), o motivo de rechazo cuando no exista configuración válida.

### Reglas de negocio

- **BR-001**: Frontera arquitectónica: el canal OTA de una reserva y su porcentaje de comisión pactado son propiedad y responsabilidad de `Modulo2`. El Módulo 3 únicamente lo consulta, en el check-in, como insumo para "Descontar comisión OTA"; no lo configura, identifica, negocia ni almacena de forma independiente.
- **BR-002**: La ausencia de un porcentaje configurado para un canal OTA detiene la consulta; el sistema no sustituye el valor faltante por cero ni por un valor supuesto.
- **BR-003**: Un canal directo, o una reserva sin canal de origen registrado, no tiene comisión OTA aplicable; esto es distinto de un canal OTA con 0% configurado explícitamente.
- **BR-004**: El porcentaje devuelto debe ser el capturado en el evento de check-in de la estancia; "Generar liquidación" DEBE usar ese mismo porcentaje tanto para la liquidación preliminar como para la definitiva, sin que pueda diferir entre ambas.
- **BR-005**: Unicidad por canal: en el momento del check-in, cada canal OTA debe tener, como máximo, un porcentaje vigente; una consulta que detecte más de uno debe rechazarse en vez de elegir uno arbitrariamente.

## Requisitos no funcionales

- **NFR-001**: Determinismo: para el mismo canal OTA y el mismo estado de configuración en el momento del check-in, la consulta debe devolver siempre el mismo resultado.
- **NFR-002**: Rendimiento: la consulta debe completarse en un tiempo que no genere demoras perceptibles dentro del procesamiento del evento de check-in que la invoca.
- **NFR-003**: Estabilidad: una vez capturado el porcentaje en el check-in de una estancia, la consulta debe mantenerlo estable para toda esa estancia, sin verse afectado por cambios posteriores del pacto en `Modulo2`.
- **NFR-004**: Los mensajes de rechazo deben ser comprensibles para el personal de facturación y suficientemente específicos para identificar el canal OTA afectado.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las consultas con un porcentaje de comisión pactado en el check-in y sin ambigüedad devuelven el porcentaje correcto identificando el canal OTA.
- **SC-002**: El 100% de las consultas sobre reservas de canal directo o sin canal registrado indican que no aplica comisión, sin devolver un porcentaje sustituto.
- **SC-003**: El 100% de las consultas sobre canales OTA sin porcentaje configurado o con valores inválidos se rechazan sin devolver un valor sustituto.
- **SC-004**: El 100% de las liquidaciones (preliminar y definitiva) de una misma estancia usan el mismo porcentaje de comisión — el capturado en el check-in — sin importar si el pacto con la OTA cambió en `Modulo2` después.
- **SC-005**: El 0% de las consultas modifica o completa la configuración del porcentaje de comisión OTA.
