# Especificación de funcionalidad: Registrar Check-out

**Creado**: 2026-09-22

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Procesar un evento válido de check-out (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero procesar el evento `Registrar Check-out` enviado por `Módulo 1` con los datos de la estancia física, para incluir (`<<include>>`) a `Generar liquidación` y dar lugar después a la generación de la factura final cuando corresponda.

**Por qué esta prioridad**: El check-out es el evento que inicia el procesamiento financiero de una estancia; sin su validación y procesamiento, no se genera su liquidación ni puede producirse la factura definitiva.

**Prueba independiente**: Se puede procesar un evento válido con el identificador UUID de la estancia y verificar que se incluye a `Generar liquidación`, seguida de `Generar factura final` cuando existen los datos tributarios completos.

**Escenarios de aceptación**:

1. **Escenario**: Generación completa para una estancia
   - **Dado** que `Módulo 1` informa el identificador UUID de la estancia, la reserva, la habitación, el tipo de habitación, las fechas reales de entrada y salida y los datos tributarios completos
   - **Cuando** el sistema procesa el evento
   - **Entonces** incluye a `Generar liquidación` y, después de que esta se genera, da lugar a `Generar factura final`

2. **Escenario**: Estancia de una sola noche
   - **Dado** que la fecha de salida es el día inmediatamente posterior a la fecha de entrada
   - **Cuando** el sistema procesa el evento
   - **Entonces** valida el rango e incluye a `Generar liquidación`

3. **Escenario**: El procesamiento no altera la habitación
   - **Dado** que el evento corresponde a una estancia válida y una habitación con estado físico registrado
   - **Cuando** el sistema procesa el evento y genera la liquidación
   - **Entonces** no modifica la ocupación, disponibilidad ni bloqueo físico de la habitación

---

### Historia de usuario 2 - Rechazar eventos inválidos y omitir datos migratorios (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación, quiero rechazar los eventos con datos obligatorios inválidos y omitir los datos migratorios, para procesar únicamente la información necesaria para liquidar la estancia.

**Por qué esta prioridad**: Validar los datos de la estancia evita liquidaciones sin información suficiente y preserva la responsabilidad de Módulo 2 sobre los datos migratorios.

**Prueba independiente**: Se pueden procesar eventos con datos obligatorios faltantes, rangos de fechas inválidos y datos migratorios omitidos, y verificar en cada caso el resultado correspondiente.

**Escenarios de aceptación**:

1. **Escenario**: Falta un dato obligatorio
   - **Dado** que el evento no incluye un dato obligatorio de la estancia
   - **Cuando** el sistema lo procesa
   - **Entonces** rechaza el evento, registra el motivo y lo enruta a revisión manual sin incluir a `Generar liquidación`

2. **Escenario**: Rango de fechas invertido o igual
   - **Dado** que la fecha de entrada es igual o posterior a la fecha de salida
   - **Cuando** el sistema procesa el evento
   - **Entonces** rechaza el evento, registra el motivo y no incluye a `Generar liquidación`

3. **Escenario**: Datos migratorios omitidos
   - **Dado** que el evento contiene los datos requeridos de la estancia y no contiene datos migratorios
   - **Cuando** el sistema procesa el evento
   - **Entonces** valida y procesa la estancia sin requerir ni almacenar datos migratorios

4. **Escenario**: El evento contiene datos migratorios
   - **Dado** que el evento contiene datos migratorios además de los datos requeridos de la estancia
   - **Cuando** el sistema procesa el evento o lo envía a revisión manual
   - **Entonces** Módulo 3 omite esos datos y no los usa ni expone; el evento enviado a revisión manual puede conservar su contenido original

---

### Historia de usuario 3 - Mantener idempotencia y completar datos tributarios (Prioridad: P2)

Como sistema de Facturación, Consumos y Liquidación, quiero reconocer reenvíos y eventos nuevos de una misma estancia, para conservar una sola liquidación y emitir la factura cuando existan datos tributarios completos.

**Por qué esta prioridad**: La idempotencia evita duplicados y permite que un evento nuevo de la misma estancia complete los datos requeridos para facturar sin alterar la liquidación existente.

**Prueba independiente**: Se puede procesar un evento, reenviarlo o recibir otro de la misma estancia, y verificar que la liquidación se reutiliza y que los datos de check-out contradictorios se rechazan.

**Escenarios de aceptación**:

1. **Escenario**: Datos tributarios ausentes o incompletos
   - **Dado** que el evento contiene los datos obligatorios de la estancia, pero los datos tributarios están ausentes o incompletos
   - **Cuando** el sistema procesa el evento
   - **Entonces** no lo rechaza, genera la liquidación y `Generar factura final` no emite la factura

2. **Escenario**: Evento posterior con datos tributarios completos
   - **Dado** que ya existe la liquidación de una estancia y Módulo 1 envía un evento con un identificador de evento nuevo, los mismos datos de check-out y los datos tributarios completos
   - **Cuando** el sistema procesa el evento
   - **Entonces** `Generar liquidación` devuelve la liquidación existente sin recalcularla y `Generar factura final` emite la factura

3. **Escenario**: Reenvío del mismo evento
   - **Dado** que Módulo 1 reenvía el mismo evento de check-out ya procesado
   - **Cuando** el sistema lo recibe de nuevo
   - **Entonces** no lo reprocesa ni genera liquidaciones o facturas duplicadas

4. **Escenario**: Evento nuevo con datos de check-out contradictorios
   - **Dado** que ya existe una liquidación para la estancia y se recibe un evento nuevo con datos de check-out contradictorios
   - **Cuando** el sistema lo procesa
   - **Entonces** rechaza el evento y conserva la liquidación original

### Casos límite

- **Datos obligatorios incompletos** (falta el identificador único del evento, el identificador UUID de la estancia, la reserva, la habitación, el tipo de habitación o alguna fecha): el sistema rechaza el evento, registra el motivo y lo enruta a dead-letter para revisión manual; no incluye a `Generar liquidación`.
- **Rango de fechas inválido o invertido**: si la fecha de entrada es posterior o igual a la fecha de salida, el sistema rechaza el evento.
- **Datos tributarios ausentes o incompletos**, incluso cuando solo se aporta parte de ellos: el sistema no rechaza el evento, genera la liquidación y no emite la factura mientras no estén completos. Módulo 1 puede enviar después un evento de la misma estancia con un identificador de evento nuevo, los mismos datos de check-out y los datos tributarios completos para permitir la emisión.
- **Falla temporal de una dependencia** (incluye que Módulo 2 no responda al consultar la reserva, el IVA vigente no esté disponible o falle la persistencia): el sistema no genera la liquidación con datos no recibidos de Módulo 2. Tras el primer intento, el evento se reintenta hasta cinco veces más, con 30 segundos entre reintentos; agotado ese límite, pasa a revisión manual y conserva cualquier liquidación existente.
- **IVA vigente no configurado o no disponible al emitir la factura**: la liquidación se conserva, no se emite factura ni se asigna numeración, y se aplica la política de reintentos de NFR-005 (FR-003 de `actualizar_porcentaje_iva.md`).
- **Reserva con varias habitaciones**: se recibe un evento por habitación y se genera una liquidación por cada habitación con check-out (FR-020 y BR-011 de `generar_liquidacion.md`).
- **Error de negocio al generar la liquidación** (reserva inexistente, cotización inexistente para el tipo de habitación, comisión OTA ausente o inválida): no se genera la liquidación, se registra el motivo del rechazo y el evento se enruta a dead-letter para revisión manual.
- **Nuevo evento para la misma estancia con datos de check-out contradictorios**: el sistema rechaza el evento y conserva la liquidación existente.
- **Procesamiento asíncrono del check-out**: recibir el evento no implica que la liquidación `Final` esté disponible de inmediato; una consulta puede mostrar la informativa hasta que exista la `Final`, nunca un estado intermedio.
- **Datos migratorios (SIRE) incluidos en el evento**: Módulo 3 los omite y no los almacena; el evento enviado a revisión manual puede conservar su contenido original, pero Módulo 3 no usa ni expone esos datos.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE recibir y procesar el evento externo `Registrar Check-out` emitido por el actor `Módulo 1`.
- **FR-002**: El sistema DEBE validar que el evento contenga como mínimo: identificador UUID único del evento, identificador UUID de la estancia, identificador de la reserva, identificador de la habitación, tipo de habitación, fecha real de entrada y fecha real de salida. Los datos tributarios del cliente responsable de la facturación pueden estar ausentes o incompletos y NO DEBEN impedir la validación del evento; cuando estén presentes, DEBEN entregarse al procesamiento de facturación.
- **FR-003**: El sistema DEBE validar que la fecha de entrada sea anterior a la fecha de salida.
- **FR-004**: El sistema DEBE incluir (`<<include>>`) a `Generar liquidación` tras validar satisfactoriamente el evento, entregándole los datos recibidos.
- **FR-005**: El sistema DEBE rechazar el evento sin incluir a `Generar liquidación` cuando falte algún dato obligatorio o alguno no sea válido, sin contar los datos tributarios, cuya ausencia o incompletitud solo impide emitir la factura.
- **FR-006**: El sistema NO DEBE capturar ni persistir datos de control migratorio o archivos .TXT de SIRE, respetando la frontera de responsabilidad con `Módulo 2`.
- **FR-007**: El sistema NO DEBE modificar estados físicos de ocupación de habitaciones ni controlar disponibilidad de inventario; esa transición es responsabilidad exclusiva de `Módulo 1`.
- **FR-008**: El sistema DEBE registrar en la auditoría el motivo del rechazo (dato faltante o inválido) y enrutar el evento rechazado a dead-letter para revisión manual.
- **FR-009**: Después de generar la liquidación, el procesamiento del check-out DEBE dar lugar a `Generar factura final`, conforme a FR-001 y BR-001 de `generar_factura_final.md`. La emisión requiere datos tributarios completos y su resultado financiero y contenido corresponden a `Generar factura final`; si los datos faltan o están incompletos, la factura no se emite. Para permitir su emisión, Módulo 1 puede enviar un evento posterior de la misma estancia con un identificador de evento nuevo, los mismos datos de check-out y los datos tributarios completos.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Evento `Registrar Check-out`**: Mensaje de `Módulo 1` con un identificador UUID único del evento, el identificador UUID de la estancia, la reserva, la habitación, el tipo de habitación y las fechas reales de entrada y salida. Los datos tributarios del cliente pueden estar ausentes o incompletos; Módulo 1 puede enviar otro evento de la misma estancia con un identificador nuevo, los mismos datos de check-out y los datos tributarios completos.
- **Estancia**: Ocupación física de una habitación, identificada por un UUID único que permite relacionar el check-out con una sola liquidación y una sola factura.

### Reglas de negocio

- **BR-001**: `Registrar Check-out` es el único evento que inicia el procesamiento de Módulo 3 para una estancia y lo emite `Módulo 1`.
- **BR-002**: Todo evento válido incluye (`<<include>>`) a `Generar liquidación`; después de generarla, el procesamiento da lugar a `Generar factura final` conforme a FR-009. `Registrar Check-out` no determina el resultado financiero ni el contenido de la factura.
- **BR-003**: Si falta o es inválido un dato obligatorio de la estancia, el sistema no incluye a `Generar liquidación`. La ausencia o incompletitud de datos tributarios no invalida el evento: la liquidación se genera, pero no se emite la factura hasta que Módulo 1 envíe un evento posterior de la misma estancia con un identificador de evento nuevo, los mismos datos de check-out y los datos tributarios completos.
- **BR-004**: El identificador UUID de la estancia es la clave de negocio para su procesamiento y la idempotencia. El reenvío del mismo evento —con el mismo identificador único de evento— no se reprocesa; un evento nuevo de la misma estancia —con un identificador de evento distinto— y con los mismos datos de check-out incluye a `Generar liquidación`, que devuelve la existente sin recalcular. Si sus datos de check-out son contradictorios, se rechaza y se conserva la liquidación original. Nunca existen dos liquidaciones ni dos facturas para una estancia.
- **BR-005**: El evento no informa canal, valor de hospedaje, OTA ni comisión; esos datos se obtienen de la reserva consultada a Módulo 2 y de la cotización guardada (BR-010 y FR-002 de `generar_liquidacion.md`).

## Requisitos no funcionales

- **NFR-001**: Determinismo: el mismo evento, con los mismos datos, produce siempre el mismo resultado de validación.
- **NFR-002**: Rendimiento: la validación y el registro del evento se completan sin consultar a otros módulos.
- **NFR-003**: Aislamiento de responsabilidades y privacidad: los registros de Módulo 3 no contienen datos migratorios. El evento enviado a revisión manual puede conservar su contenido original; Módulo 3 no usa ni expone esos datos.
- **NFR-004**: Trazabilidad: cada evento recibido queda registrado con su resultado de validación, para fines de auditoría operativa.
- **NFR-005**: Ante fallas temporales de Módulo 2, del IVA vigente o de persistencia, tras el primer intento el evento se reintenta hasta cinco veces más, con 30 segundos entre reintentos; agotado el límite, pasa a revisión manual sin alterar la liquidación existente.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los eventos válidos de `Registrar Check-out` incluyen a `Generar liquidación` con los datos recibidos y, después de generarla, dan lugar a `Generar factura final`.
- **SC-002**: El 100% de los eventos con datos obligatorios inválidos o incompletos (sin contar los datos tributarios) son rechazados sin incluir a `Generar liquidación`.
- **SC-003**: El 100% de los eventos con datos tributarios ausentes o incompletos no se rechaza y genera la liquidación, sin emitir factura mientras falten datos completos; Módulo 1 puede enviar un evento posterior de la misma estancia con un identificador de evento nuevo, los mismos datos de check-out y los datos tributarios completos para permitir emitirla.
- **SC-004**: El 0% de los registros de Módulo 3 contiene datos migratorios. El evento enviado a revisión manual puede conservar su contenido original, pero Módulo 3 no usa ni expone esos datos.
- **SC-005**: El 100% de los reenvíos del mismo evento no se reprocesa ni genera liquidaciones o facturas duplicadas.
- **SC-006**: El 100% de los eventos rechazados registra el motivo del rechazo en la auditoría y se enruta a dead-letter para revisión manual.
- **SC-007**: Cada estancia tiene como máximo una liquidación y una factura; un evento nuevo con los mismos datos de check-out reutiliza la liquidación existente sin recalcularla, y uno con datos contradictorios se rechaza sin alterarla.
