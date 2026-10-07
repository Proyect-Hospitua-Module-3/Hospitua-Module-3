# Especificación de funcionalidad: Registrar Check-out

**Creado**: 2026-09-22

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Disparar la liquidación de una estancia al Check-out (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero procesar el evento externo `Registrar Check-out` enviado por el actor `Módulo 1` con los datos de la estancia física, para incluir (`<<include>>`) a `Generar liquidación` con esos datos.

**Por qué esta prioridad**: El check-out es el único evento que Módulo 3 recibe de una estancia; sin su procesamiento correcto, `Generar liquidación` nunca se ejecuta.

**Prueba independiente**: Se puede emitir el evento `Registrar Check-out` con los datos de la estancia, y verificar que el sistema valida el evento e incluye a `Generar liquidación` con esos datos, incluyendo los datos tributarios del cliente cuando el evento los trae.

**Escenarios de aceptación**:

1. **Escenario**: Generación completa para una estancia
	- **Dado** que `Módulo 1` emite el evento `Registrar Check-out` con el identificador de la reserva, el identificador de la habitación, el tipo de habitación, la fecha de entrada real, la fecha de salida real y datos tributarios completos del cliente
	- **Cuando** el sistema procesa el evento
	- **Entonces** incluye (`<<include>>`) a `Generar liquidación` con esos datos.

2. **Escenario**: Estancia de una sola noche
	- **Dado** que la fecha de salida es el día inmediatamente posterior a la fecha de entrada
	- **Cuando** el sistema procesa el evento
	- **Entonces** valida el evento igual que cualquier otro rango de fechas e incluye a `Generar liquidación`.

3. **Escenario**: Reenvío del mismo evento
	- **Dado** que `Módulo 1` reenvía un evento `Registrar Check-out` ya procesado para la misma reserva y habitación
	- **Cuando** el sistema lo recibe
	- **Entonces** vuelve a incluir a `Generar liquidación` con los mismos datos.

### Casos límite

- **Datos mínimos incompletos en el evento** (falta el identificador de la reserva, el de la habitación, el tipo de habitación o alguna de las dos fechas): el sistema rechaza el evento y no incluye a `Generar liquidación`.
- **Rango de fechas inválido o invertido**: si la fecha de entrada es posterior o igual a la fecha de salida, el sistema rechaza el evento.
- **Datos tributarios del cliente ausentes en el evento**: el sistema NO rechaza el evento por esta causa; incluye igual a `Generar liquidación` con lo que sí recibió. La ausencia de estos datos solo afecta, más adelante, la emisión de la factura en `Generar factura final`.
- **Datos migratorios (SIRE) incluidos en el evento**: el sistema los omite y no los almacena, preservando la frontera de responsabilidad con `Módulo 2`.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE recibir y procesar el evento externo `Registrar Check-out` emitido por el actor `Módulo 1`.
- **FR-002**: El sistema DEBE validar que el evento contenga como mínimo: identificador de la reserva, identificador de la habitación, tipo de habitación, fecha de entrada real y fecha de salida real. Los datos tributarios mínimos del cliente responsable de la facturación, cuando el evento los incluya, DEBEN entregarse a `Generar liquidación` junto con el resto, pero su ausencia NO DEBE impedir la validación del evento.
- **FR-003**: El sistema DEBE validar que la fecha de entrada sea anterior a la fecha de salida.
- **FR-004**: El sistema DEBE incluir (`<<include>>`) a `Generar liquidación` tras validar satisfactoriamente el evento, entregándole los datos recibidos, incluidos los datos tributarios del cliente cuando estén presentes.
- **FR-005**: El sistema DEBE rechazar el evento sin incluir a `Generar liquidación` cuando falte algún dato obligatorio o alguno no sea válido, sin contar los datos tributarios.
- **FR-006**: El sistema NO DEBE capturar ni persistir datos de control migratorio o archivos .TXT de SIRE, respetando la frontera de responsabilidad con `Módulo 2`.
- **FR-007**: El sistema NO DEBE modificar estados físicos de ocupación de habitaciones ni controlar disponibilidad de inventario; esa transición es responsabilidad exclusiva de `Módulo 1`.
- **FR-008**: El sistema DEBE informar a `Módulo 1` el dato faltante o inválido cada vez que rechace un evento.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Evento `Registrar Check-out`**: Mensaje recibido desde `Módulo 1`, con identificador de la reserva, identificador de la habitación, tipo de habitación, fecha de entrada real y fecha de salida real. Los datos tributarios del cliente pueden venir incluidos, pero no son obligatorios para que el evento sea válido.

### Reglas de negocio

- **BR-001**: Frontera arquitectónica: `Registrar Check-out` es el único evento que dispara el procesamiento de Módulo 3 para una estancia, emitido por el actor `Módulo 1`.
- **BR-002**: Disparo obligatorio: todo evento válido incluye (`<<include>>`) a `Generar liquidación`, entregándole los datos recibidos; `Registrar Check-out` no determina el resultado financiero ni el estado de la liquidación.
- **BR-003**: Atomicidad: si el identificador de la reserva, el de la habitación, el tipo de habitación o las fechas no llegan completos o válidos, el sistema no incluye a `Generar liquidación`; la ausencia de datos tributarios del cliente no forma parte de esta condición de bloqueo.
- **BR-004**: Ante la recepción repetida del mismo evento, el sistema vuelve a incluir a `Generar liquidación` con los mismos datos.

## Requisitos no funcionales

- **NFR-001**: Determinismo: el mismo evento, con los mismos datos, produce siempre el mismo resultado de validación.
- **NFR-002**: Rendimiento: la recepción y validación del evento se completan en un tiempo que permite una interacción fluida en el flujo operativo de `Módulo 1`.
- **NFR-003**: Aislamiento de responsabilidades y privacidad: Módulo 3 no procesa ni almacena datos sensibles de identificación migratoria.
- **NFR-004**: Trazabilidad: cada evento recibido queda registrado con su resultado de validación, para fines de auditoría operativa.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los eventos válidos de `Registrar Check-out` incluyen a `Generar liquidación` con los datos recibidos.
- **SC-002**: El 100% de los eventos con datos obligatorios inválidos o incompletos (sin contar los datos tributarios) son rechazados sin incluir a `Generar liquidación`.
- **SC-003**: El 100% de los eventos sin datos tributarios del cliente igual incluyen a `Generar liquidación` con el resto de la información.
- **SC-004**: El 0% de los registros de este caso de uso contiene datos de control migratorio.
- **SC-005**: El 100% de los reenvíos del mismo evento vuelven a incluir a `Generar liquidación` con los mismos datos.
- **SC-006**: El 100% de los eventos rechazados informan a `Módulo 1` el dato faltante o inválido.