# Especificación de funcionalidad: Registrar Check-in

**Creado**: 2026-09-05  

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Apertura de liquidación para reserva de Canal Directo tras Check-in (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero procesar el evento externo "Registrar Check-in" enviado por el actor Módulo 2 para una reserva de Canal Directo, para inicializar de manera obligatoria el caso de uso "Generar liquidación", calculando el hospedaje dinámico y los impuestos correspondientes sin aplicar deducciones de comisión por intermediarios.

**Por qué esta prioridad**: La recepción del evento de check-in es el punto de partida financiero de la estancia. Ejecutar obligatoriamente (`<<include>>`) "Generar liquidación" garantiza que desde la llegada física del huésped exista una cuenta de liquidación inicial con el hospedaje y los impuestos calculados conforme a las tarifas dinámicas vigentes.

**Prueba independiente**: Se puede simular la emisión del evento "Registrar Check-in" desde el Módulo 2 con canal directo (0% comisión), tipo de habitación válido y fechas válidas, y comprobar de forma independiente que Módulo 3 cree un registro de liquidación inicial con el hospedaje calculado noche a noche, el IVA correspondiente, cero descuento de comisión OTA y estado abierto.

**Escenarios de aceptación**:

1. **Escenario**: Generación de liquidación inicial para estancia de Canal Directo en temporada regular
	- **Dado** que el actor Módulo 2 emite el evento "Registrar Check-in" para una reserva de Canal Directo con fechas en temporada regular y una habitación con tarifa base configurada en Módulo 1
	- **Cuando** el Módulo 3 procesa el evento y ejecuta obligatoriamente el caso de uso "Generar liquidación"
	- **Entonces** invoca "Aplicar tarifa dinámica" (que ejecuta "Calcular tarifa dinámica", consulta la tarifa base en Módulo 1 y verifica la temporada en "Revisar temporada del año"), invoca "Generar factura final" con el cálculo de IVA mediante "Calcular Impuesto (IVA)", no ejecuta "Descontar comisión OTA" y persiste la liquidación inicial con saldo de comisión en cero.

2. **Escenario**: Generación de liquidación inicial para estancia de Canal Directo que cruza temporadas
	- **Dado** que el actor Módulo 2 emite el evento "Registrar Check-in" para una reserva de Canal Directo cuyas fechas programadas comprenden noches de temporada regular y de temporada alta
	- **Cuando** el Módulo 3 ejecuta "Generar liquidación"
	- **Entonces** invoca "Aplicar tarifa dinámica" para que cada noche reciba la tarifa correspondiente a su estacionalidad y suma los valores para establecer el subtotal de hospedaje de la liquidación inicial.

3. **Escenario**: Omisión del descuento de comisión en Canal Directo
	- **Dado** que el evento "Registrar Check-in" indica que el canal de origen es directo (0% comisión pactada)
	- **Cuando** el Módulo 3 ejecuta "Generar liquidación"
	- **Entonces** evalúa la condición de intermediario y no dispara el caso de uso extendido "Descontar comisión OTA", consolidando un descuento de intermediario igual a cero.

---

### Historia de usuario 2 - Apertura de liquidación para reserva de canal OTA con deducción de comisión (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero procesar el evento externo "Registrar Check-in" enviado por el actor Módulo 2 para una reserva intermediada por una OTA (Booking, Airbnb, Expedia), para generar la liquidación inicial aplicando la tarifa dinámica, deduciendo condicionalmente la comisión pactada con la OTA y determinando los impuestos aplicables.

**Por qué esta prioridad**: Las reservas intermediadas conllevan acuerdos comerciales específicos de comisión. Ejecutar la relación `<<extend>> (si y solo si hay intermediario)` hacia "Descontar comisión OTA" en el momento de la liquidación inicial permite establecer con exactitud el ingreso neto del hotel y el pasivo comercial con la OTA desde el inicio de la estancia.

**Prueba independiente**: Se puede emitir un evento "Registrar Check-in" indicando canal OTA con código de confirmación externo y porcentaje de comisión pactado, y verificar que la liquidación generada refleje el subtotal de hospedaje dinámico, el descuento de comisión calculado según la fórmula `- (Valor Hospedaje * % Comisión)`, el cálculo de IVA y el balance neto liquidable.

**Escenarios de aceptación**:

1. **Escenario**: Liquidación inicial con aplicación de comisión OTA
	- **Dado** que el actor Módulo 2 emite el evento "Registrar Check-in" con origen OTA, código de confirmación externo y un porcentaje de comisión pactado del 15%
	- **Cuando** el Módulo 3 procesa el evento y ejecuta "Generar liquidación"
	- **Entonces** al detectar la condición de intermediario, ejecuta el caso de uso extendido "Descontar comisión OTA", invoca "Consultar porcentaje de comisión OTA", calcula la deducción como `- (Valor Hospedaje * 0.15)` y la desglosa en la liquidación inicial junto con el hospedaje y el IVA.

2. **Escenario**: Registro del identificador y código de confirmación de la OTA
	- **Dado** que el evento "Registrar Check-in" incluye el código de confirmación externo emitido por la plataforma OTA
	- **Cuando** el Módulo 3 genera la liquidación inicial
	- **Entonces** vincula dicho código de confirmación a la liquidación para garantizar la trazabilidad contable en futuras consultas y conciliaciones.

3. **Escenario**: Cálculo de comisión sobre estancia con tarifa dinámica
	- **Dado** que una reserva originada en OTA incluye noches con ajuste de temporada alta
	- **Cuando** se ejecuta "Descontar comisión OTA" dentro de "Generar liquidación"
	- **Entonces** la deducción de comisión se calcula sobre el total de hospedaje efectivamente resultante de la tarifa dinámica aplicada.

### Casos límite

- **Estancia de una sola noche**: La fecha de salida programada es el día inmediatamente posterior a la fecha de check-in; el sistema debe generar la liquidación calculando exactamente una noche de hospedaje base/dinámico, su IVA y comisión si aplica.
- **Check-in el mismo día de inicio de temporada alta**: La primera noche de la estancia debe ser clasificada como temporada alta por "Revisar temporada del año" y liquidada con la regla de tarifa dinámica respectiva.
- **Estancia que cruza múltiples períodos de temporada**: Cada noche comprendida entre el check-in (inclusive) y el check-out programado (exclusive) debe evaluarse individualmente, garantizando que ninguna noche quede sin tarifa o reciba reglas solapadas.
- **Reserva de canal OTA con comisión pactada del 0%**: El sistema debe ejecutar "Descontar comisión OTA", calcular un descuento de 0.00 y dejar constancia del canal intermediario y su código de confirmación.
- **Canal OTA sin código de confirmación o porcentaje de comisión pactado**: Si el evento indica origen OTA pero carece de código de confirmación externo o no provee/resuelve el porcentaje de comisión pactado, el sistema debe detener la liquidación e informar el insumo faltante a Módulo 2.
- **Porcentaje de comisión fuera de rango legal o lógico (negativo o mayor al 100%)**: El sistema debe rechazar el evento de check-in e informar el error de parametrización.
- **Rango de fechas inválido o invertido**: Si la fecha de check-in es posterior o igual a la fecha de salida programada, el sistema debe rechazar el evento, retornar un mensaje de error descriptivo a Módulo 2 y no generar la liquidación.
- **Ausencia de tarifa base vigente en Módulo 1**: Si el tipo de habitación solicitado no cuenta con tarifa base definida y vigente en Módulo 1, el sistema debe abortar atómicamente la liquidación inicial sin registrar montos en cero ni persistir registros contables parciales.
- **Porcentaje de IVA no configurado o inválido**: Si el porcentaje de IVA no ha sido configurado por el Administrador o contiene un valor inválido (ej. negativo o no numérico), la liquidación inicial debe detenerse de forma atómica para evitar facturación con base gravable incompleta o errónea, de forma equivalente a la falta de tarifa base en FR-017.
- **Reenvío de evento de Check-in ya procesado (evento duplicado)**: Si se recibe nuevamente el evento "Registrar Check-in" para una estancia que ya posee una liquidación inicial abierta, el sistema debe responder con la liquidación previamente generada de forma idempotente, sin duplicar registros contables ni recalcular cargos acumulados.
- **Inclusión de datos migratorios en el payload del evento**: Si el Módulo 2 incluye datos del SIRE (documentos, visas, etc.) en el mensaje, el Módulo 3 debe omitirlos y no almacenarlos, preservando la separación de alcance.
- **Diferencia o ambigüedad en la moneda de liquidación**: Si el evento no especifica moneda o utiliza una no admitida respecto a la tarifa base, el sistema debe rechazar la liquidación hasta resolver la configuración.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE recibir y procesar el evento externo "Registrar Check-in" emitido por el actor `Modulo2` como notificación de ingreso del huésped.
- **FR-002**: El sistema DEBE validar que el payload del evento "Registrar Check-in" contenga los siguientes datos mínimos: identificador único de la reserva/estancia, identificador del tipo de habitación o habitación asignada, fecha de entrada (check-in), fecha programada de salida (check-out), canal de origen de la reserva (`Canal Directo` o `OTA`), moneda de la transacción y datos mínimos de identificación tributaria del cliente responsable de la facturación (nombre o razón social, y número de identificación tributaria/documento fiscal), exclusivamente para fines de emisión de factura — sin incluir nacionalidad, tipo de visa, ni ningún otro dato de control migratorio, que permanece bajo responsabilidad del Módulo 2.
- **FR-003**: Cuando el canal de origen sea `OTA`, el sistema DEBE exigir la presencia del código de confirmación externo y el porcentaje de comisión pactado como insumos obligatorios para la liquidación.
- **FR-004**: El sistema DEBE ejecutar de forma automática y obligatoria el caso de uso `Generar liquidacion` (`<<include>>`) tras la recepción y validación satisfactoria del evento "Registrar Check-in".
- **FR-005**: Al ejecutar `Generar liquidacion`, el sistema DEBE inicializar una cuenta de liquidación única asociada a la estancia con estado "Abierta" (o en curso), registrando la fecha y hora de apertura.
- **FR-006**: Dentro de `Generar liquidacion`, el sistema DEBE invocar de forma obligatoria el caso de uso `Aplicar tarifa dinamica` (`<<include>>`) para calcular el subtotal de hospedaje de todas las noches programadas entre la fecha de check-in (inclusive) y la de check-out (exclusive).
- **FR-007**: El caso de uso `Aplicar tarifa dinamica` DEBE incluir obligatoriamente a `Calcular tarifa dinamica` (`<<include>>`), el cual a su vez consulta la tarifa base de `Modulo1` mediante `Consultar tarifa base` y revisa la estacionalidad de cada fecha mediante `Revisar temporada del año`.
- **FR-008**: Dentro de `Generar liquidacion`, el sistema DEBE evaluar el canal de la reserva y, si y solo si la reserva proviene de un intermediario (`OTA`), ejecutar el caso de uso extendido `Descontar comision OTA` (`<<extend>> (si y solo si hay intermediario)`).
- **FR-009**: Cuando el canal de origen sea `Canal Directo`, el sistema NO DEBE ejecutar `Descontar comision OTA`, estableciendo el rubro de descuento por comisión en 0.00.
- **FR-010**: Al ejecutar `Descontar comision OTA`, el sistema DEBE invocar obligatoriamente `Consultar porcentaje de comision OTA` (`<<include>>`) para validar o recuperar el porcentaje de comisión contractual pactado con la plataforma `OTA`.
- **FR-011**: El sistema DEBE calcular el importe de la comisión OTA a descontar aplicando la regla de la matriz de liquidación: `- (Valor Hospedaje * % Comisión)`.
- **FR-012**: Dentro de `Generar liquidacion`, el sistema DEBE invocar obligatoriamente el caso de uso `Generar factura final` (`<<include>>`) para estructurar una prefactura o borrador tributario preliminar asociado a la liquidación abierta (estableciendo los rubros facturables iniciales sin emitir un documento fiscal definitivo ni asignar numeración consecutiva oficial, reservándose esto para el cierre de estancia en `Registrar Check-out`).
- **FR-013**: Al ejecutar `Generar factura final` en el check-in, el sistema DEBE invocar obligatoriamente el caso de uso `Calcular Impuesto (IVA)` (`<<include>>`) sobre la base imponible preliminar del hospedaje, quedando dicho cálculo sujeto a liquidación y ajuste definitivo al cierre de la estancia.
- **FR-014**: Al ejecutar `Calcular Impuesto (IVA)`, el sistema DEBE consultar internamente la tasa impositiva legal vigente, la cual es un valor de configuración mantenido por el actor `Administrador` mediante el caso de uso `Actualizar porcentaje de IVA` (invocado/consultado internamente, sin requerir llamadas a terceros externos).
- **FR-015**: El sistema DEBE persistir la liquidación inicial generada con el desglose auditable de hospedaje base, ajuste dinámico por temporada, descuento de comisión OTA (si aplica), IVA calculado y total liquidado preliminar.
- **FR-016**: El sistema DEBE permitir que la liquidación generada en el check-in pueda ser consultada por los actores autorizados (`Modulo2`, `OTA`) mediante el caso de uso `Consultar liquidacion`.
- **FR-017**: El sistema DEBE rechazar el procesamiento del evento "Registrar Check-in", retornar un mensaje de error descriptivo hacia el actor `Modulo2` y no persistir liquidaciones parciales si los datos obligatorios son inválidos o inconsistentes (incluyendo un rango de fechas donde la entrada sea posterior o igual a la salida), si en canales OTA falta el código de confirmación externo o el porcentaje de comisión pactado, si no se encuentra la tarifa base en `Modulo1`, o si el porcentaje de IVA no está configurado o es inválido en el sistema.
- **FR-018**: El sistema DEBE garantizar un manejo idempotente ante reintentos del evento "Registrar Check-in" con el mismo identificador de estancia, respondiendo con la liquidación inicial ya existente sin duplicar registros contables ni recalcular cargos acumulados.
- **FR-019**: El sistema NO DEBE capturar, procesar ni persistir datos de control migratorio o archivos .TXT de SIRE, respetando la frontera de responsabilidad con `Modulo2`.
- **FR-020**: El sistema NO DEBE modificar estados físicos de ocupación de habitaciones ni controlar disponibilidad de inventario, respetando la frontera de responsabilidad con `Modulo1`.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Evento Registrar Check-in**: Estructura de mensaje recibida desde `Modulo2` que notifica la llegada del huésped e incluye identificadores de reserva/estancia, habitación, fechas pactadas, canal de origen y datos mínimos de identificación tributaria del cliente (nombre o razón social y documento fiscal, excluyendo cualquier dato de control migratorio).
- **Liquidación de estancia** (`Generar liquidacion`): Registro maestro financiero en Módulo 3 vinculado unívocamente a la estancia. Almacena el estado ("Abierta"), fechas, subtotales de hospedaje, deducciones de intermediarios, impuestos y saldo liquidable, contemplando exclusivamente el hospedaje dinámico, la deducción de comisión OTA (si aplica) y el IVA, sin incluir otros consumos o cargos adicionales.
- **Detalle de Hospedaje Dinámico** (`Aplicar tarifa dinamica` / `Calcular tarifa dinamica`): Desglose noche a noche que especifica fecha, tarifa base obtenida de `Modulo1`, condición de temporada (`Revisar temporada del año`), ajuste dinámico y subtotal resultante.
- **Deducción de Comisión OTA** (`Descontar comision OTA`): Registro del descuento comercial aplicado al hospedaje para reservas intermediadas, detallando el código de confirmación externo, la plataforma `OTA`, el porcentaje aplicado (`Consultar porcentaje de comision OTA`) y el importe deducido.
- **Canal de Reserva**: Clasificación del origen de la venta (`Canal Directo` con 0% de comisión vs `OTA` con comisión porcentual pactada y código externo).
- **Factura Inicial / Estructura Fiscal** (`Generar factura final`): Registro de prefacturación o borrador fiscal en estado preliminar asociado a la liquidación abierta, con base gravable estimada, alícuota de IVA (mantenida por el actor `Administrador` mediante `Actualizar porcentaje de IVA`) y monto de impuesto calculado (`Calcular Impuesto (IVA)`), sin constituir documento fiscal formal con numeración consecutiva hasta el `Registrar Check-out`.

### Reglas de negocio

- **BR-001**: Frontera arquitectónica: "Registrar Check-in" es un evento disparado por el actor `Modulo2`. El Módulo 3 no ejecuta el registro de check-in operativo ni valida identidad o visas para SIRE.
- **BR-002**: Disparo obligatorio de liquidación: Cada evento válido de check-in genera una única cuenta de liquidación inicial en Módulo 3 a través de la relación `<<include>>` hacia `Generar liquidacion`.
- **BR-003**: Determinación del hospedaje: El hospedaje se liquida multiplicando la tarifa dinámica correspondiente a cada noche por el número de noches comprendidas entre la fecha de check-in (inclusive) y la fecha de check-out programada (exclusive).
- **BR-004**: Condición de intermediación (Extensión OTA): La relación `<<extend>>` hacia `Descontar comision OTA` se activa única y exclusivamente si el canal de la reserva corresponde a una `OTA`. En reservas de `Canal Directo`, la comisión es estrictamente cero y el caso de uso extendido no se ejecuta.
- **BR-005**: Fórmula de liquidación de comisión OTA: La deducción por comisión de intermediario se calcula como `- (Valor Hospedaje * % Comisión)`.
- **BR-006**: Cálculo de impuestos (IVA): El IVA se calcula aplicando sobre el valor de los servicios de hospedaje el porcentaje legal vigente, el cual corresponde a un valor de configuración interna mantenido por el actor `Administrador` a través del caso de uso `Actualizar porcentaje de IVA`.
- **BR-007**: Estado de la liquidación al Check-in: La liquidación se inicializa en estado "Abierta" (preliminar), contemplando exclusivamente el hospedaje dinámico, la deducción de comisión OTA (si aplica) e IVA, y sirviendo de base para que al momento del `Registrar Check-out` se consolide el balance final y cierre de facturación.
- **BR-008**: Atomicidad en la inicialización: Si alguna de las dependencias o configuraciones requeridas (`Consultar tarifa base`, `Calcular tarifa dinamica`, o la alícuota de IVA configurada mediante `Actualizar porcentaje de IVA`) falla, no está configurada o entrega datos inconsistentes, la creación de la liquidación debe abortarse en su totalidad sin persistir estados financieros parciales ni sustituir valores faltantes por cero.
- **BR-009**: Idempotencia operativa: La recepción repetida del evento "Registrar Check-in" para una misma estancia debe retornar la liquidación ya creada sin duplicar registros ni alterar los valores calculados previamente.

### Preguntas abiertas

- **OQ-001**: [REQUIERE ACLARACIÓN: ¿El porcentaje de comisión de la OTA debe ser provisto siempre en el payload del evento por `Modulo2`, o el Módulo 3 debe mantener una tabla propia de convenios por OTA para resolver dicho porcentaje a través de `Consultar porcentaje de comision OTA`?].
- **OQ-002**: [REQUIERE ACLARACIÓN: ¿Cuál es el protocolo a seguir si tras haber generado la liquidación inicial por Check-in, el Módulo 2 notifica la anulación inmediata del check-in (por ejemplo, por rechazo migratorio en SIRE o desistimiento del huésped en recepción)? Nota: no existe actualmente en el diagrama un caso de uso para anular o revertir una liquidación. Recomendación preliminar a validar con el equipo: la anulación no debería eliminar el registro, sino transicionar la liquidación a un estado 'Anulada' que preserve trazabilidad, dado que en este punto del flujo aún no se ha emitido factura formal ni ejecutado cobro real a la OTA.].

## Requisitos no funcionales

- **NFR-001**: Determinismo y exactitud monetaria: El cálculo de la liquidación debe ser completamente determinista; para las mismas fechas, tarifa base, canal y porcentaje de comisión, el desglose e importe total deben ser idénticos, respetando la precisión de decimales y reglas de redondeo de la moneda configurada.
- **NFR-002**: Rendimiento y tiempo de respuesta: La recepción del evento de check-in y la persistencia de la liquidación inicial con todos sus cálculos incluidos deben completarse en un tiempo que permita una interacción fluida y sin bloqueos perceptibles en la atención de recepción.
- **NFR-003**: Idempotencia y consistencia transaccional: El sistema debe garantizar que el procesamiento de eventos repetidos con el mismo identificador no genere liquidaciones duplicadas ni corrupción de saldos.
- **NFR-004**: Aislamiento de responsabilidades y privacidad: El Módulo 3 no debe procesar ni almacenar datos sensibles de identificación migratoria (pasaportes, números de visa, nacionalidades con fines SIRE), limitándose estrictamente a la información financiera y de facturación.
- **NFR-005**: Trazabilidad y auditoría: Cada liquidación inicial debe registrar marcas de tiempo de generación, tarifas base aplicadas, factores estacionales utilizados, porcentaje de comisión OTA deducido, alícuota de IVA aplicada e identificador de origen del evento de `Modulo2`.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los eventos válidos de "Registrar Check-in" recibidos desde el `Modulo2` generan satisfactoriamente una liquidación inicial con el hospedaje y los impuestos calculados.
- **SC-002**: El 100% de las reservas provenientes de canales OTA aplican la deducción de comisión pactada mediante "Descontar comisión OTA" conforme a la fórmula `- (Valor Hospedaje * % Comisión)`.
- **SC-003**: El 100% de las reservas de `Canal Directo` registran una comisión de intermediario de 0.00 y no ejecutan el caso de uso "Descontar comisión OTA".
- **SC-004**: El 100% de los eventos que contengan fechas inconsistentes, tipos de habitación sin tarifa configurada o parámetros tributarios no configurados o inválidos son rechazados sin persistir liquidaciones parciales.
- **SC-005**: El 0% de los registros generados en Módulo 3 contiene datos de control migratorio o referencias al archivo .TXT de SIRE.
- **SC-006**: El 100% de las liquidaciones iniciales generadas quedan disponibles y consultables a través del caso de uso "Consultar liquidación" por los actores autorizados (`Modulo2`, `OTA`).
- **SC-007**: El 100% de las generaciones de liquidación asociadas al Check-in se completan de manera fluida y sin bloqueos perceptibles para el personal de recepción durante pruebas de aceptación operativa.

