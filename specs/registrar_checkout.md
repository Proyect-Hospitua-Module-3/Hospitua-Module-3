# Especificación de funcionalidad: Registrar Check-out

**Creado**: 2026-09-17

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Generar la liquidación y factura de una reserva de Canal Directo al Check-out (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero procesar el evento externo `Registrar Check-out` enviado por el actor `Módulo 1` para una reserva de Canal Directo, para calcular el hospedaje dinámico completo de la estancia, generar la liquidación `Final` y emitir la factura fiscal definitiva, todo en un único paso.

**Por qué esta prioridad**: El check-out es el único evento que Módulo 3 recibe de una estancia; no existe una liquidación previa que cerrar. Sin este procesamiento no hay liquidación ni factura para ninguna reserva.

**Prueba independiente**: Se puede emitir el evento `Registrar Check-out` con los datos completos de una estancia de Canal Directo (fechas, tipo de habitación, datos tributarios del cliente) y verificar que Módulo 3 genere una liquidación `Final` con el hospedaje calculado noche a noche, el IVA correspondiente, comisión en cero, y una factura fiscal definitiva con numeración consecutiva.

**Escenarios de aceptación**:

1. **Escenario**: Generación completa para una estancia de Canal Directo
	- **Dado** que `Módulo 1` emite el evento `Registrar Check-out` con fecha de entrada, fecha de salida, tipo de habitación con tarifa base vigente, canal `Directo` y datos tributarios completos del cliente
	- **Cuando** el sistema procesa el evento
	- **Entonces** ejecuta `Generar liquidación` (`<<include>>`), que calcula el hospedaje dinámico de cada noche entre la entrada (inclusive) y la salida (exclusive), no aplica comisión, persiste la liquidación en estado `Final`, y ejecuta `Generar factura final` (`<<include>>`) para emitir la factura definitiva con numeración consecutiva oficial.

2. **Escenario**: Estancia que cruza distintas temporadas
	- **Dado** que las fechas de la estancia comprenden noches de más de una temporada (baja, regular o alta)
	- **Cuando** el sistema calcula el hospedaje dentro de `Generar liquidación`
	- **Entonces** cada noche recibe la tarifa correspondiente a su propia fecha, y la suma de todas las noches conforma el hospedaje total de la liquidación `Final`.

3. **Escenario**: Estancia de una sola noche
	- **Dado** que la fecha de salida es el día inmediatamente posterior a la fecha de entrada
	- **Cuando** el sistema procesa el evento
	- **Entonces** genera la liquidación `Final` calculando exactamente una noche de hospedaje y su IVA correspondiente.

---

### Historia de usuario 2 - Generar la liquidación y factura de una reserva de canal OTA con comisión (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero procesar el evento `Registrar Check-out` de una reserva intermediada por una OTA, para descontar la comisión pactada del hospedaje bruto y reflejar el ingreso neto del hotel en la liquidación `Final` y en la factura.

**Por qué esta prioridad**: Las reservas OTA representan un pasivo comercial distinto al de canal directo; sin este descuento, el ingreso neto reportado sería incorrecto.

**Prueba independiente**: Se puede emitir el evento con canal `OTA`, código de confirmación externo y porcentaje de comisión vigente, y verificar que la liquidación `Final` refleje el hospedaje bruto, la comisión descontada, el IVA calculado sobre el hospedaje (no sobre la comisión), y el ingreso neto correcto.

**Escenarios de aceptación**:

1. **Escenario**: Descuento de comisión sobre hospedaje bruto
	- **Dado** que el evento indica canal `OTA` con un porcentaje de comisión vigente del 15%
	- **Cuando** el sistema ejecuta `Generar liquidación`
	- **Entonces** invoca `Descontar comisión OTA` (`<<extend>> si y solo si hay intermediario`), que a su vez consulta `Consultar porcentaje de comisión OTA`, calcula la deducción como `- (Valor Hospedaje * 0.15)`, y la liquidación `Final` persiste el hospedaje bruto, la comisión y el ingreso neto por separado.

2. **Escenario**: Factura sin exponer la comisión como cargo al huésped
	- **Dado** que la liquidación `Final` de una estancia OTA ya tiene la comisión calculada
	- **Cuando** el sistema ejecuta `Generar factura final`
	- **Entonces** la factura muestra la comisión únicamente como referencia informativa del pasivo con la OTA, y el total facturado al huésped corresponde al ingreso neto más el IVA, sin incluir la comisión como un cargo adicional.

### Casos límite

- **Datos mínimos incompletos en el evento** (falta tipo de habitación, alguna de las dos fechas, o canal de origen): el sistema debe rechazar el evento y no generar ninguna liquidación.
- **Rango de fechas inválido o invertido**: si la fecha de entrada es posterior o igual a la fecha de salida, el sistema debe rechazar el evento sin intentar calcular noches negativas.
- **Canal OTA sin código de confirmación o sin porcentaje de comisión resoluble**: el sistema debe detener la generación de la liquidación e informar el insumo faltante a `Módulo 1`.
- **Ausencia de tarifa base vigente en `Módulo 1` para el tipo de habitación**: el sistema debe abortar atómicamente la generación, sin registrar montos en cero.
- **Porcentaje de IVA no configurado o inválido**: la generación de la liquidación debe detenerse de forma atómica; no debe sustituirse por un valor de cero.
- **Datos tributarios mínimos del cliente ausentes** (nombre/razón social, documento fiscal): la liquidación `Final` sí se genera y persiste con su desglose, pero `Generar factura final` rechaza la emisión de la factura y no asigna numeración oficial hasta que esos datos se completen.
- **Reenvío del mismo evento de Check-out (evento duplicado)**: si ya existe una liquidación `Final` para esa reserva/estancia, el sistema debe responder con la liquidación y factura ya existentes, sin recalcular ni duplicar registros.
- **Inclusión de datos migratorios (SIRE) en el payload del evento**: el sistema debe omitirlos y no almacenarlos, preservando la frontera de responsabilidad con `Módulo 2` (dueño original del dato migratorio, independientemente de qué módulo emita el evento de check-out).

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE recibir y procesar el evento externo `Registrar Check-out` emitido por el actor `Módulo 1` como notificación única y completa de una estancia finalizada.
- **FR-002**: El sistema DEBE validar que el payload del evento contenga como mínimo: identificador único de la reserva/estancia, tipo de habitación, fecha de entrada, fecha de salida, canal de origen (`Directo` u `OTA`), y datos tributarios mínimos del cliente responsable de la facturación.
- **FR-003**: El sistema DEBE validar que la fecha de entrada sea anterior a la fecha de salida antes de continuar el procesamiento.
- **FR-004**: Cuando el canal de origen sea `OTA`, el sistema DEBE exigir la presencia del código de confirmación externo y un porcentaje de comisión resoluble mediante `Consultar porcentaje de comisión OTA`.
- **FR-005**: El sistema DEBE ejecutar de forma automática y obligatoria el caso de uso `Generar liquidación` (`<<include>>`) tras la validación satisfactoria del evento.
- **FR-006**: Dentro de `Generar liquidación`, el sistema DEBE calcular el hospedaje dinámico de cada noche comprendida entre la fecha de entrada (inclusive) y la fecha de salida (exclusive), según la tarifa base y la temporada aplicable a cada fecha.
- **FR-007**: Dentro de `Generar liquidación`, el sistema DEBE evaluar el canal de la reserva y, si y solo si proviene de un intermediario `OTA`, ejecutar `Descontar comisión OTA` (`<<extend>>`); en canal `Directo`, la comisión queda en 0.00 sin ejecutar dicho caso de uso.
- **FR-008**: El sistema DEBE persistir la liquidación resultante en un único estado `Final`, con el desglose auditable de hospedaje, comisión OTA (si aplica) e ingreso neto.
- **FR-009**: El sistema DEBE ejecutar `Generar factura final` (`<<include>>`) para calcular el IVA sobre el hospedaje y emitir la factura fiscal definitiva con numeración consecutiva oficial.
- **FR-010**: Si faltan los datos tributarios mínimos del cliente, el sistema DEBE persistir la liquidación `Final` de todas formas, pero DEBE rechazar la emisión de la factura sin asignar numeración oficial hasta que esos datos se completen.
- **FR-011**: El sistema DEBE rechazar el procesamiento del evento y no generar ninguna liquidación si los datos obligatorios son inválidos o inconsistentes, si no se encuentra la tarifa base vigente en `Módulo 1`, o si el porcentaje de IVA no está configurado o es inválido.
- **FR-012**: El sistema DEBE garantizar un manejo idempotente ante reintentos del evento para una misma reserva/estancia, respondiendo con la liquidación y factura ya existentes sin recalcular ni duplicar registros.
- **FR-013**: El sistema DEBE permitir que la liquidación generada sea consultada por los actores autorizados (`Módulo 1`, `Módulo 2`, `OTA`) mediante `Consultar liquidación`.
- **FR-014**: El sistema NO DEBE capturar, procesar ni persistir datos de control migratorio o archivos .TXT de SIRE, respetando la frontera de responsabilidad con `Módulo 2`.
- **FR-015**: El sistema NO DEBE modificar estados físicos de ocupación de habitaciones ni controlar disponibilidad de inventario; esa transición (`Occupied` → `PendingCleaning`) es responsabilidad exclusiva de `Módulo 1`, incluso siendo el mismo módulo que emite el evento hacia Módulo 3.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Evento `Registrar Check-out`**: Estructura de mensaje única recibida desde `Módulo 1`, con todos los datos de la estancia finalizada: reserva/estancia, tipo de habitación, fechas de entrada y salida, canal de origen, y datos tributarios del cliente.
- **Liquidación `Final`**: Registro financiero único por estancia, generado por `Generar liquidación`, con el desglose de hospedaje, comisión OTA (si aplica) e ingreso neto. Es el único estado positivo posible; no existe una fase preliminar previa.
- **Factura fiscal definitiva**: Documento generado por `Generar factura final`, con numeración consecutiva oficial e inmutable, condicionado a la presencia de los datos tributarios mínimos del cliente.

### Reglas de negocio

- **BR-001**: Frontera arquitectónica: `Registrar Check-out` es el único evento que dispara el procesamiento de Módulo 3 para una estancia, disparado por el actor `Módulo 1`; no existe un evento de check-in que abra una liquidación previa.
- **BR-002**: Disparo obligatorio: cada evento válido de check-out genera, en un único paso, la liquidación `Final` de la estancia mediante `Generar liquidación`.
- **BR-003**: Determinación del hospedaje: el hospedaje se calcula multiplicando la tarifa dinámica correspondiente a cada noche por el número de noches entre la fecha de entrada (inclusive) y la fecha de salida (exclusive).
- **BR-004**: Condición de intermediación: la relación `<<extend>>` hacia `Descontar comisión OTA` se activa única y exclusivamente si el canal de la reserva es `OTA`; en canal `Directo` la comisión es estrictamente cero.
- **BR-005**: El IVA se calcula una única vez, sobre el hospedaje total de la estancia, usando el porcentaje vigente en el momento del check-out; al no existir una fase preliminar previa, no hay porcentajes distintos que conservar por bloques de noches.
- **BR-006**: La factura emitida por `Generar factura final` es siempre un documento fiscal definitivo con numeración consecutiva; no existe una prefactura o borrador intermedio en este modelo.
- **BR-007**: Los datos tributarios mínimos del cliente son una condición para emitir la factura, pero no para generar la liquidación `Final`; su ausencia bloquea únicamente el documento fiscal.
- **BR-008**: Atomicidad: si alguna dependencia de cálculo falla (tarifa base, porcentaje de IVA, porcentaje de comisión OTA cuando corresponde), la generación de la liquidación debe abortarse en su totalidad, sin persistir estados financieros parciales.
- **BR-009**: Idempotencia operativa: la recepción repetida del evento para una misma reserva/estancia debe retornar la liquidación y factura ya generadas, sin duplicar registros ni alterar los valores calculados.

## Requisitos no funcionales

- **NFR-001**: Determinismo y exactitud monetaria: para los mismos datos de entrada y configuraciones vigentes, el desglose y el total deben ser siempre idénticos.
- **NFR-002**: Rendimiento: la recepción del evento y la generación completa de la liquidación y la factura deben completarse en un tiempo que permita una interacción fluida en el flujo operativo de `Módulo 1`.
- **NFR-003**: Idempotencia y consistencia transaccional: el procesamiento de eventos repetidos con el mismo identificador no debe generar liquidaciones ni facturas duplicadas.
- **NFR-004**: Aislamiento de responsabilidades y privacidad: Módulo 3 no debe procesar ni almacenar datos sensibles de identificación migratoria.
- **NFR-005**: Trazabilidad y auditoría: cada liquidación y factura deben registrar marca de tiempo de generación, tarifa base aplicada, factores estacionales, comisión OTA (si aplica), alícuota de IVA aplicada, y número de factura emitido.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los eventos válidos de `Registrar Check-out` generan una liquidación `Final` con hospedaje e IVA calculados.
- **SC-002**: El 100% de las reservas de canal `OTA` reflejan la comisión descontada del hospedaje bruto, conforme a la fórmula `- (Valor Hospedaje * % Comisión)`.
- **SC-003**: El 100% de las reservas de canal `Directo` registran comisión en 0.00, sin ejecutar `Descontar comisión OTA`.
- **SC-004**: El 100% de los eventos con datos obligatorios inválidos, tarifa base no encontrada, o porcentaje de IVA no configurado son rechazados sin generar liquidaciones parciales.
- **SC-005**: El 100% de las liquidaciones `Final` generadas cuentan con una factura fiscal definitiva y numeración consecutiva, salvo que falten datos tributarios mínimos del cliente.
- **SC-006**: El 0% de los registros generados contiene datos de control migratorio.
- **SC-007**: El 100% de los reenvíos del mismo evento devuelven la liquidación y factura ya existentes, sin duplicar registros.