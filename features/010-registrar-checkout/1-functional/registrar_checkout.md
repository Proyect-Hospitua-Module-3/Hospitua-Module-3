# Especificación de funcionalidad: Registrar Check-out

**Creado**: 2026-09-22

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Disparar la liquidación de una reserva de Canal Directo al Check-out (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero procesar el evento externo `Registrar Check-out` enviado por el actor `Módulo 1` para una reserva de Canal Directo, con las fechas reservadas y las fechas reales de la estancia incluidas en el evento, para incluir (`<<include>>`) a `Generar liquidación` con esos datos.

**Por qué esta prioridad**: El check-out es el único evento que Módulo 3 recibe de una estancia; sin su procesamiento correcto, `Generar liquidación` nunca se ejecuta.

**Prueba independiente**: Se puede emitir el evento `Registrar Check-out` con las fechas reservadas y las fechas reales, y verificar que el sistema valida el evento e incluye a `Generar liquidación` con esos datos, incluyendo los datos tributarios del cliente cuando el evento los trae.

**Escenarios de aceptación**:

1. **Escenario**: Generación completa para una estancia de Canal Directo
	- **Dado** que `Módulo 1` emite el evento `Registrar Check-out` con el identificador de la reserva y de la habitación, tipo de habitación, fechas reservadas, fechas reales, canal `DIRECTA`, y datos tributarios completos del cliente
	- **Cuando** el sistema procesa el evento
	- **Entonces** incluye (`<<include>>`) a `Generar liquidación` con esos datos.

2. **Escenario**: Estancia de una sola noche
	- **Dado** que la fecha de salida real es el día inmediatamente posterior a la fecha de entrada real
	- **Cuando** el sistema procesa el evento
	- **Entonces** valida el evento igual que cualquier otro rango de fechas e incluye a `Generar liquidación`.

3. **Escenario**: Reenvío del mismo evento
	- **Dado** que `Módulo 1` reenvía un evento `Registrar Check-out` ya procesado para la misma reserva y habitación
	- **Cuando** el sistema lo recibe
	- **Entonces** vuelve a incluir a `Generar liquidación` con los mismos datos.

---

### Historia de usuario 2 - Disparar la liquidación de una reserva intermediada por una OTA (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero procesar el evento `Registrar Check-out` de una reserva intermediada por una OTA, tomando el nombre de la OTA directamente del canal de origen del propio evento, para incluir (`<<include>>`) a `Generar liquidación` con esos datos.

**Por qué esta prioridad**: Las reservas OTA requieren que el canal de origen identifique a la OTA que las originó antes de incluir a `Generar liquidación`.

**Prueba independiente**: Se puede emitir el evento con un canal igual al nombre de una OTA (por ejemplo `BOOKING`), y verificar que el sistema valida el evento e incluye a `Generar liquidación` con ese canal.

**Escenarios de aceptación**:

1. **Escenario**: Evento de una reserva OTA
	- **Dado** que el evento indica como canal de origen el nombre de una OTA (por ejemplo `BOOKING`)
	- **Cuando** el sistema valida el evento
	- **Entonces** incluye (`<<include>>`) a `Generar liquidación` con esos datos.

### Casos límite

- **Datos mínimos incompletos en el evento** (falta tipo de habitación, alguna de las fechas o el canal de origen): el sistema rechaza el evento y no incluye a `Generar liquidación`.
- **Rango de fechas inválido o invertido**: si la fecha de entrada es posterior o igual a la fecha de salida, ya sea en las fechas reservadas o en las reales, el sistema rechaza el evento.
- **Datos tributarios del cliente ausentes en el evento**: el sistema NO rechaza el evento por esta causa; incluye igual a `Generar liquidación` con lo que sí recibió. La ausencia de estos datos solo afecta, más adelante, la emisión de la factura en `Generar factura final`.
- **Datos migratorios (SIRE) incluidos en el evento**: el sistema los omite y no los almacena, preservando la frontera de responsabilidad con `Módulo 2`.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE recibir y procesar el evento externo `Registrar Check-out` emitido por el actor `Módulo 1`.
- **FR-002**: El sistema DEBE validar que el evento contenga como mínimo: identificador de la reserva y de la habitación, tipo de habitación, fechas reservadas de entrada y salida, fechas reales de entrada y salida, y canal de origen (`DIRECTA` o el nombre de la OTA). Los datos tributarios mínimos del cliente responsable de la facturación, cuando el evento los incluya, DEBEN entregarse a `Generar liquidación` junto con el resto, pero su ausencia NO DEBE impedir la validación del evento.
- **FR-003**: El sistema DEBE validar que, tanto en las fechas reservadas como en las reales, la fecha de entrada sea anterior a la fecha de salida.
- **FR-004**: El canal de origen DEBE llegar como un único dato: `DIRECTA` para el canal directo, o el nombre de la OTA que originó la reserva (por ejemplo, `BOOKING`).
- **FR-005**: El sistema DEBE incluir (`<<include>>`) a `Generar liquidación` tras validar satisfactoriamente el evento, entregándole los datos recibidos, incluidos los datos tributarios del cliente cuando estén presentes.
- **FR-006**: El sistema DEBE rechazar el evento sin incluir a `Generar liquidación` cuando falte algún dato obligatorio o alguno no sea válido, sin contar los datos tributarios.
- **FR-007**: El sistema NO DEBE capturar ni persistir datos de control migratorio o archivos .TXT de SIRE, respetando la frontera de responsabilidad con `Módulo 2`.
- **FR-008**: El sistema NO DEBE modificar estados físicos de ocupación de habitaciones ni controlar disponibilidad de inventario; esa transición es responsabilidad exclusiva de `Módulo 1`.
- **FR-009**: El sistema DEBE informar a `Módulo 1` el dato faltante o inválido cada vez que rechace un evento.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Evento `Registrar Check-out`**: Mensaje recibido desde `Módulo 1`, con identificador de reserva y de habitación, tipo de habitación, fechas reservadas, fechas reales y canal de origen (`DIRECTA` o el nombre de la OTA). Los datos tributarios del cliente pueden venir incluidos, pero no son obligatorios para que el evento sea válido.

### Reglas de negocio

- **BR-001**: Frontera arquitectónica: `Registrar Check-out` es el único evento que dispara el procesamiento de Módulo 3 para una estancia, emitido por el actor `Módulo 1`.
- **BR-002**: Disparo obligatorio: todo evento válido incluye (`<<include>>`) a `Generar liquidación`, entregándole los datos recibidos; `Registrar Check-out` no determina el resultado financiero ni el estado de la liquidación.
- **BR-003**: Atomicidad: si el identificador, el tipo de habitación, las fechas o el canal de origen no llegan completos o válidos, el sistema no incluye a `Generar liquidación`; la ausencia de datos tributarios del cliente no forma parte de esta condición de bloqueo.
- **BR-004**: Ante la recepción repetida del mismo evento, el sistema vuelve a incluir a `Generar liquidación` con los mismos datos.

## Requisitos no funcionales

- **NFR-001**: Determinismo: el mismo evento, con los mismos datos, produce siempre el mismo resultado de validación.
- **NFR-002**: Rendimiento: la recepción y validación del evento se completan en un tiempo que permite una interacción fluida en el flujo operativo de `Módulo 1`.
- **NFR-003**: Aislamiento de responsabilidades y privacidad: Módulo 3 no procesa ni almacena datos sensibles de identificación migratoria.
- **NFR-004**: Trazabilidad: cada evento recibido queda registrado con su resultado de validación, para fines de auditoría operativa.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los eventos válidos de `Registrar Check-out` incluyen a `Generar liquidación` con los datos recibidos.
- **SC-002**: El 100% de los eventos válidos de una reserva OTA incluyen a `Generar liquidación` con el canal de origen recibido en el evento.
- **SC-003**: El 100% de los eventos con datos obligatorios inválidos o incompletos (sin contar los datos tributarios) son rechazados sin incluir a `Generar liquidación`.
- **SC-004**: El 100% de los eventos sin datos tributarios del cliente igual incluyen a `Generar liquidación` con el resto de la información.
- **SC-005**: El 0% de los registros de este caso de uso contiene datos de control migratorio.
- **SC-006**: El 100% de los reenvíos del mismo evento vuelven a incluir a `Generar liquidación` con los mismos datos.
- **SC-007**: El 100% de los eventos rechazados informan a `Módulo 1` el dato faltante o inválido.