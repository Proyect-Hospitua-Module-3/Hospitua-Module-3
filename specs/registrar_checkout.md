# Especificación de funcionalidad: Registrar Check-out

**Creado**: 2026-09-06  

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Cierre y consolidación de liquidación para reserva de Canal Directo tras Check-out (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero procesar el evento externo "Registrar Check-out" enviado por el actor Módulo 2 para una reserva de Canal Directo, para consolidar y cerrar la liquidación previamente abierta en el check-in, calculando el hospedaje final y emitiendo la factura fiscal definitiva.

**Por qué esta prioridad**: El check-out es el punto donde se conoce con certeza el número real de noches hospedadas y se cierra el ciclo financiero de la estancia. Sin este cierre, la liquidación abierta en el check-in nunca se formaliza como factura definitiva.

**Prueba independiente**: Se puede simular la emisión del evento "Registrar Check-out" desde el Módulo 2 para una estancia con liquidación abierta de Canal Directo, y comprobar de forma independiente que Módulo 3 recalcula el hospedaje final, cierra la liquidación y emite una factura con numeración consecutiva.

**Escenarios de aceptación**:

1. **Escenario**: Cierre de liquidación cuando la salida coincide con la fecha programada
	- **Dado** que existe una liquidación abierta para una reserva de Canal Directo y el actor Módulo 2 emite "Registrar Check-out" con la fecha de salida real igual a la programada
	- **Cuando** el Módulo 3 procesa el evento y ejecuta "Generar liquidación"
	- **Entonces** confirma el hospedaje ya calculado en el check-in, calcula el IVA definitivo, transiciona la liquidación a estado "Cerrada" y emite la factura final con numeración consecutiva oficial.

2. **Escenario**: Cierre de liquidación con salida anticipada
	- **Dado** que la fecha de salida real informada en "Registrar Check-out" es anterior a la fecha de salida originalmente programada
	- **Cuando** el Módulo 3 ejecuta "Generar liquidación"
	- **Entonces** recalcula el hospedaje sobre el número de noches efectivamente transcurridas entre el check-in y la salida real, sin aplicar penalidad por las noches restantes no disfrutadas, ajusta el IVA sobre esa nueva base y cierra la liquidación con el total definitivo correspondiente.

3. **Escenario**: Cierre de liquidación con extensión de estancia
	- **Dado** que la fecha de salida real informada es posterior a la fecha de salida originalmente programada
	- **Cuando** el Módulo 3 ejecuta "Generar liquidación"
	- **Entonces** invoca nuevamente "Aplicar tarifa dinámica" para calcular las noches adicionales según la regla de temporada que corresponda a cada una, suma el hospedaje adicional al ya calculado y cierra la liquidación con el total consolidado.

---

### Historia de usuario 2 - Cierre y consolidación de liquidación para reserva de canal OTA con comisión definitiva (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero procesar el evento externo "Registrar Check-out" enviado por el actor Módulo 2 para una reserva intermediada por una OTA, para recalcular la comisión sobre el hospedaje final y cerrar la liquidación con el ingreso neto definitivo del hotel.

**Por qué esta prioridad**: La comisión pactada con la OTA debe calcularse sobre el valor de hospedaje efectivamente resultante al cierre, no sobre el valor preliminar estimado en el check-in, para que el ingreso neto y el pasivo comercial con la OTA queden correctos.

**Prueba independiente**: Se puede emitir un evento "Registrar Check-out" para una estancia OTA con liquidación abierta, y verificar que la comisión final se recalcula sobre el hospedaje definitivo, el IVA se ajusta en consecuencia, y la liquidación cierra con el balance neto correcto.

**Escenarios de aceptación**:

1. **Escenario**: Comisión OTA recalculada sobre hospedaje definitivo sin cambios de fecha
	- **Dado** que existe una liquidación abierta de canal OTA con comisión pactada del 15% y el check-out ocurre en la fecha programada
	- **Cuando** el Módulo 3 ejecuta "Generar liquidación"
	- **Entonces** confirma la deducción de comisión ya calculada en el check-in, calcula el IVA definitivo y cierra la liquidación emitiendo la factura final.

2. **Escenario**: Comisión OTA recalculada tras ajuste de noches
	- **Dado** que la estancia de canal OTA tuvo una salida anticipada o extendida respecto a la fecha originalmente programada
	- **Cuando** el Módulo 3 recalcula el hospedaje final
	- **Entonces** vuelve a aplicar la fórmula `- (Valor Hospedaje * % Comisión)` sobre el nuevo valor de hospedaje definitivo, no sobre el valor preliminar del check-in.

### Casos límite

- **Check-out sin liquidación abierta asociada**: Si no existe una liquidación previamente abierta para el identificador de reserva/estancia informado en el evento, el sistema debe rechazar el check-out y no crear una liquidación nueva desde cero.
- **Fecha de salida real anterior a la fecha de check-in registrada**: El sistema debe rechazar el evento por inconsistencia de fechas, sin intentar calcular noches negativas.
- **Estancia de una sola noche cerrada en la fecha programada**: El sistema debe confirmar exactamente una noche de hospedaje, sin recalcular si la fecha real coincide con la programada.
- **Extensión de estancia que cruza a temporada alta**: Cada noche adicional debe recibir la regla de temporada que corresponda a su propia fecha, sin aplicar una sola regla a todas las noches extra.
- **Reenvío de evento de Check-out ya procesado (evento duplicado)**: Si se recibe nuevamente el evento "Registrar Check-out" para una estancia cuya liquidación ya está "Cerrada", el sistema debe responder con la liquidación ya cerrada sin volver a ejecutar el cálculo ni modificar el total definitivo.
- **Falla en dependencias al momento del cierre (tarifa para noches adicionales o alícuota de IVA)**: Si no es posible resolver la tarifa dinámica de una noche adicional o el porcentaje de IVA vigente, el cierre debe abortarse de forma atómica y la liquidación debe permanecer en estado "Abierta", no cerrarse con datos parciales.
- **Inclusión de datos migratorios en el payload del evento**: Si el Módulo 2 incluye datos del SIRE en el mensaje de check-out, el Módulo 3 debe omitirlos y no almacenarlos.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE recibir y procesar el evento externo "Registrar Check-out" emitido por el actor `Modulo2` como notificación de salida del huésped.
- **FR-002**: El sistema DEBE validar que el payload del evento "Registrar Check-out" contenga como mínimo: identificador único de la reserva/estancia y fecha real de salida.
- **FR-003**: El sistema DEBE localizar la liquidación previamente abierta en `Modulo3` para el identificador de reserva/estancia recibido; si no existe una liquidación abierta asociada, DEBE rechazar el evento.
- **FR-004**: El sistema DEBE ejecutar de forma automática y obligatoria el caso de uso `Generar liquidacion` (`<<include>>`) tras la recepción y validación satisfactoria del evento "Registrar Check-out".
- **FR-005**: Si la fecha real de salida difiere de la fecha de salida originalmente programada en el check-in, el sistema DEBE recalcular el número de noches efectivamente hospedadas e invocar nuevamente `Aplicar tarifa dinamica` (`<<include>>`) para las noches afectadas.
- **FR-006**: El sistema DEBE calcular el hospedaje final como la suma de las tarifas dinámicas correspondientes a cada noche efectivamente transcurrida entre el check-in y la fecha real de salida.
- **FR-007**: Si la reserva proviene de un canal `OTA`, el sistema DEBE recalcular la deducción de comisión (`Descontar comision OTA`, `<<extend>>`) sobre el valor de hospedaje final definitivo, no sobre el valor preliminar estimado en el check-in.
- **FR-008**: El sistema DEBE recalcular el IVA (`Calcular Impuesto (IVA)`, `<<include>>`) sobre la base gravable definitiva del hospedaje final.
- **FR-009**: El sistema DEBE transicionar el estado de la liquidación de "Abierta" a "Cerrada" una vez consolidados el hospedaje, la comisión (si aplica) y el IVA definitivos.
- **FR-010**: Al ejecutar `Generar factura final` (`<<include>>`) en el check-out, el sistema DEBE emitir un documento fiscal formal con numeración consecutiva oficial, a diferencia de la prefactura generada en el check-in.
- **FR-011**: El sistema DEBE persistir el desglose final auditable de la liquidación cerrada: hospedaje definitivo, ajuste dinámico por temporada, comisión OTA definitiva (si aplica), IVA definitivo y total liquidado final.
- **FR-012**: El sistema DEBE permitir que la liquidación cerrada sea consultada por los actores autorizados mediante el caso de uso `Consultar liquidacion`.
- **FR-013**: El sistema DEBE rechazar el procesamiento del evento "Registrar Check-out" y no cerrar la liquidación si la fecha real de salida es anterior a la fecha de check-in registrada, si no existe liquidación abierta asociada, o si no es posible resolver la tarifa dinámica o el porcentaje de IVA requeridos para el cierre.
- **FR-014**: El sistema DEBE garantizar un manejo idempotente ante reintentos del evento "Registrar Check-out" para una estancia cuya liquidación ya está "Cerrada", respondiendo con la liquidación final ya existente sin recalcular ni duplicar el cierre.
- **FR-015**: El sistema NO DEBE capturar, procesar ni persistir datos de control migratorio o archivos .TXT de SIRE, respetando la frontera de responsabilidad con `Modulo2`.
- **FR-016**: El sistema NO DEBE modificar estados físicos de ocupación de habitaciones ni controlar disponibilidad de inventario, respetando la frontera de responsabilidad con `Modulo1`.
- **FR-017**: Ante una salida anticipada, el sistema NO DEBE aplicar ningún cargo o penalidad sobre las noches no disfrutadas, limitándose a facturar el hospedaje de las noches efectivamente transcurridas.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Evento Registrar Check-out**: Estructura de mensaje recibida desde `Modulo2` que notifica la salida del huésped, incluyendo el identificador de reserva/estancia y la fecha real de salida.
- **Liquidación de estancia (cierre)**: La misma liquidación abierta en el check-in, actualizada al estado "Cerrada" con los valores definitivos de hospedaje, comisión (si aplica), IVA y total liquidado final.
- **Factura final (documento fiscal formal)**: Comprobante fiscal definitivo con numeración consecutiva oficial, emitido al cierre de la estancia, a diferencia de la prefactura generada en el check-in.
- **Ajuste de noches por salida anticipada o extendida**: Diferencia entre las noches originalmente programadas y las efectivamente transcurridas, con su correspondiente recálculo de tarifa dinámica.

### Reglas de negocio

- **BR-001**: Frontera arquitectónica: "Registrar Check-out" es un evento disparado por el actor `Modulo2`. El Módulo 3 no ejecuta el registro operativo del check-out ni gestiona el estado físico de la habitación.
- **BR-002**: Cierre obligatorio: cada evento válido de check-out cierra la única liquidación abierta asociada a la estancia, a través de la relación `<<include>>` hacia `Generar liquidacion`.
- **BR-003**: Determinación del hospedaje final: el hospedaje se calcula sobre el número de noches efectivamente transcurridas entre el check-in y la fecha real de salida, que puede diferir del rango originalmente programado.
- **BR-004**: Salida anticipada sin penalidad: ante una salida anticipada respecto a la fecha programada, el hospedaje se cobra únicamente por las noches efectivamente transcurridas, sin penalidad por las noches restantes no disfrutadas 
- **BR-005**: Formalización fiscal: a diferencia del check-in (que genera una prefactura/borrador), la factura emitida en el check-out mediante `Generar factura final` constituye un documento fiscal definitivo con numeración consecutiva.
- **BR-006**: La comisión OTA definitiva se calcula sobre el valor de hospedaje final, no sobre el valor preliminar estimado en el check-in.
- **BR-007**: El IVA definitivo se calcula sobre la base gravable final del hospedaje, aplicando el porcentaje vigente mantenido por el actor `Administrador` mediante `Actualizar porcentaje de IVA`.
- **BR-008**: Cierre atómico: si alguna dependencia de cálculo falla al momento del cierre, la liquidación permanece en estado "Abierta" y no se cierra con datos parciales o estimados.
- **BR-009**: Idempotencia operativa: la recepción repetida del evento "Registrar Check-out" para una liquidación ya cerrada debe retornar la liquidación final ya existente, sin recalcular ni duplicar el cierre.

## Requisitos no funcionales

- **NFR-001**: Determinismo y exactitud monetaria: el cálculo del cierre debe ser completamente determinista; para las mismas fechas reales, tarifa, canal y porcentaje de comisión, el desglose final y el total deben ser idénticos.
- **NFR-002**: Rendimiento y tiempo de respuesta: la recepción del evento de check-out y el cierre de la liquidación deben completarse en un tiempo que permita una interacción fluida y sin bloqueos perceptibles en la atención de recepción.
- **NFR-003**: Idempotencia y consistencia transaccional: el sistema debe garantizar que el procesamiento de eventos repetidos con el mismo identificador no genere cierres duplicados ni corrupción de saldos.
- **NFR-004**: Aislamiento de responsabilidades y privacidad: el Módulo 3 no debe procesar ni almacenar datos sensibles de identificación migratoria, limitándose estrictamente a la información financiera y de facturación.
- **NFR-005**: Trazabilidad y auditoría: cada cierre de liquidación debe registrar marca de tiempo del cierre, ajuste de noches (si lo hubo), comisión OTA definitiva, alícuota de IVA aplicada y número de factura formal emitido.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los eventos válidos de "Registrar Check-out" con liquidación abierta asociada consolidan un cierre con hospedaje, comisión (si aplica) e IVA definitivos.
- **SC-002**: El 100% de los check-out con salida anticipada o extendida recalculan el hospedaje sobre las noches efectivamente transcurridas.
- **SC-003**: El 100% de las liquidaciones de canal OTA cerradas reflejan la comisión calculada sobre el hospedaje final, no sobre el valor preliminar del check-in.
- **SC-004**: El 100% de los eventos sin liquidación abierta asociada, con fechas inconsistentes, o con dependencias de cálculo no resueltas, son rechazados sin cerrar liquidaciones parciales.
- **SC-005**: El 100% de las facturas emitidas en el check-out cuentan con numeración consecutiva oficial, a diferencia de las prefacturas del check-in.
- **SC-006**: El 0% de los registros generados en el cierre contiene datos de control migratorio.
- **SC-007**: El 100% de los cierres de liquidación quedan disponibles y consultables a través del caso de uso "Consultar liquidación".