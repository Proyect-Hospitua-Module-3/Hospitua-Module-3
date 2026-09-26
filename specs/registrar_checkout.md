# Especificación de funcionalidad: Registrar Check-out

**Creado**: 2026-09-22

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Disparar la liquidación de una reserva de Canal Directo al Check-out (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero procesar el evento externo `Registrar Check-out` enviado por el actor `Módulo 1` para una reserva de Canal Directo, con el valor de hospedaje ya calculado incluido en el evento, para incluir (`<<include>>`) a `Generar liquidación` con esos datos.

**Por qué esta prioridad**: El check-out es el único evento que Módulo 3 recibe de una estancia; sin su procesamiento correcto, `Generar liquidación` nunca se ejecuta.

**Prueba independiente**: Se puede emitir el evento `Registrar Check-out` con el valor de hospedaje ya calculado, y verificar que el sistema valida el evento e incluye a `Generar liquidación` con esos datos, incluyendo los datos tributarios del cliente cuando el evento los trae.

**Escenarios de aceptación**:

1. **Escenario**: Generación completa para una estancia de Canal Directo
	- **Dado** que `Módulo 1` emite el evento `Registrar Check-out` con fecha de entrada, fecha de salida, tipo de habitación, canal `Directo`, el valor de hospedaje ya calculado, y datos tributarios completos del cliente
	- **Cuando** el sistema procesa el evento
	- **Entonces** incluye (`<<include>>`) a `Generar liquidación` con esos datos.

2. **Escenario**: Estancia de una sola noche
	- **Dado** que la fecha de salida es el día inmediatamente posterior a la fecha de entrada
	- **Cuando** el sistema procesa el evento
	- **Entonces** valida el evento igual que cualquier otro rango de fechas e incluye a `Generar liquidación`.

3. **Escenario**: Reenvío del mismo evento
	- **Dado** que `Módulo 1` reenvía un evento `Registrar Check-out` ya procesado para la misma reserva/estancia
	- **Cuando** el sistema lo recibe
	- **Entonces** vuelve a incluir a `Generar liquidación` con los mismos datos.

---

### Historia de usuario 2 - Disparar la liquidación de una reserva de canal OTA con comisión (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero procesar el evento `Registrar Check-out` de una reserva intermediada por una OTA, tomando el porcentaje de comisión directamente del propio evento, para incluir (`<<include>>`) a `Generar liquidación` con esos datos.

**Por qué esta prioridad**: Las reservas OTA requieren que el código de confirmación y el porcentaje de comisión lleguen incluidos en el evento antes de incluir a `Generar liquidación`.

**Prueba independiente**: Se puede emitir el evento con canal `OTA`, código de confirmación externo y un porcentaje de comisión pactado incluido en el propio evento, y verificar que el sistema valida esos datos e incluye a `Generar liquidación` con ellos.

**Escenarios de aceptación**:

1. **Escenario**: Evento OTA con comisión incluida
	- **Dado** que el evento indica canal `OTA`, con código de confirmación y un porcentaje de comisión pactado del 15% incluidos directamente en su contenido
	- **Cuando** el sistema valida el evento
	- **Entonces** incluye (`<<include>>`) a `Generar liquidación` con esos datos.

### Casos límite

- **Datos mínimos incompletos en el evento** (falta tipo de habitación, alguna de las dos fechas, canal de origen, o el valor de hospedaje calculado): el sistema rechaza el evento y no incluye a `Generar liquidación`.
- **Rango de fechas inválido o invertido**: si la fecha de entrada es posterior o igual a la fecha de salida, el sistema rechaza el evento.
- **Valor de hospedaje ausente o inválido** (negativo o no numérico): el sistema rechaza el evento.
- **Canal OTA sin código de confirmación o sin porcentaje de comisión incluido**: el sistema rechaza el evento e informa el dato faltante a `Módulo 1`.
- **Datos tributarios del cliente ausentes en el evento**: el sistema NO rechaza el evento por esta causa; incluye igual a `Generar liquidación` con lo que sí recibió. La ausencia de estos datos solo afecta, más adelante, la emisión de la factura en `Generar factura final`.
- **Datos migratorios (SIRE) incluidos en el evento**: el sistema los omite y no los almacena, preservando la frontera de responsabilidad con `Módulo 2`.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE recibir y procesar el evento externo `Registrar Check-out` emitido por el actor `Módulo 1`.
- **FR-002**: El sistema DEBE validar que el evento contenga como mínimo: identificador único de la reserva/estancia, tipo de habitación, fecha de entrada, fecha de salida, canal de origen (`Directo` u `OTA`), y el valor de hospedaje ya calculado. Los datos tributarios mínimos del cliente responsable de la facturación, cuando el evento los incluya, DEBEN entregarse a `Generar liquidación` junto con el resto, pero su ausencia NO DEBE impedir la validación del evento.
- **FR-003**: El sistema DEBE validar que la fecha de entrada sea anterior a la fecha de salida.
- **FR-004**: Cuando el canal de origen sea `OTA`, el sistema DEBE exigir que el evento incluya el código de confirmación externo y el porcentaje de comisión pactado.
- **FR-005**: El sistema DEBE incluir (`<<include>>`) a `Generar liquidación` tras validar satisfactoriamente el evento, entregándole los datos recibidos, incluidos los datos tributarios del cliente cuando estén presentes.
- **FR-006**: El sistema DEBE rechazar el evento sin incluir a `Generar liquidación` cuando falten los datos obligatorios listados en FR-002 (sin contar los datos tributarios) o el valor de hospedaje no sea válido.
- **FR-007**: El sistema NO DEBE capturar ni persistir datos de control migratorio o archivos .TXT de SIRE, respetando la frontera de responsabilidad con `Módulo 2`.
- **FR-008**: El sistema NO DEBE modificar estados físicos de ocupación de habitaciones ni controlar disponibilidad de inventario; esa transición es responsabilidad exclusiva de `Módulo 1`.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Evento `Registrar Check-out`**: Mensaje recibido desde `Módulo 1`, con identificador de reserva/estancia, tipo de habitación, fechas, canal de origen, el valor de hospedaje ya calculado, y (si OTA) código de confirmación y porcentaje de comisión pactado. Los datos tributarios del cliente pueden venir incluidos, pero no son obligatorios para que el evento sea válido.

### Reglas de negocio

- **BR-001**: Frontera arquitectónica: `Registrar Check-out` es el único evento que dispara el procesamiento de Módulo 3 para una estancia, emitido por el actor `Módulo 1`.
- **BR-002**: Disparo obligatorio: todo evento válido incluye (`<<include>>`) a `Generar liquidación`, entregándole los datos recibidos; `Registrar Check-out` no determina el resultado financiero ni el estado de la liquidación.
- **BR-003**: El valor de hospedaje que recibe la liquidación es el que llega en el evento, ya calculado externamente.
- **BR-004**: El porcentaje de comisión OTA, cuando aplica, llega incluido en el propio evento.
- **BR-005**: Atomicidad: si el valor de hospedaje, el canal, o (siendo OTA) el porcentaje de comisión no llegan completos o válidos, el sistema no incluye a `Generar liquidación`; la ausencia de datos tributarios del cliente no forma parte de esta condición de bloqueo.
- **BR-006**: Ante la recepción repetida del mismo evento, el sistema vuelve a incluir a `Generar liquidación` con los mismos datos.

## Requisitos no funcionales

- **NFR-001**: Determinismo: el mismo evento, con los mismos datos, produce siempre el mismo resultado de validación.
- **NFR-002**: Rendimiento: la recepción y validación del evento se completan en un tiempo que permite una interacción fluida en el flujo operativo de `Módulo 1`.
- **NFR-003**: Aislamiento de responsabilidades y privacidad: Módulo 3 no procesa ni almacena datos sensibles de identificación migratoria.
- **NFR-004**: Trazabilidad: cada evento recibido queda registrado con su resultado de validación, para fines de auditoría operativa.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los eventos válidos de `Registrar Check-out` incluyen a `Generar liquidación` con los datos recibidos.
- **SC-002**: El 100% de las reservas de canal `OTA` incluyen a `Generar liquidación` con el porcentaje de comisión recibido en el evento.
- **SC-003**: El 100% de los eventos con datos obligatorios inválidos o incompletos (sin contar los datos tributarios) son rechazados sin incluir a `Generar liquidación`.
- **SC-004**: El 100% de los eventos sin datos tributarios del cliente igual incluyen a `Generar liquidación` con el resto de la información.
- **SC-005**: El 0% de los registros de este caso de uso contiene datos de control migratorio.
- **SC-006**: El 100% de los reenvíos del mismo evento vuelven a incluir a `Generar liquidación` con los mismos datos.