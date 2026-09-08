# Especificación de funcionalidad: Consultar porcentaje de comisión OTA

**Creado**: 2026-09-07  

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Obtener el porcentaje de comisión vigente para el canal OTA de una reserva (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero consultar el porcentaje de comisión pactado y vigente para el canal OTA de origen de una reserva, para usarlo como base de "Descontar comisión OTA" y de "Generar factura final".

**Por qué esta prioridad**: Sin este porcentaje no puede calcularse cuánto debe descontarse del hospedaje bruto cuando la reserva proviene de un intermediario; es un insumo obligatorio de la Matriz de Liquidación Final (Comisión OTA = - (Valor Hospedaje x % Comisión)).

**Prueba independiente**: Se puede invocar la consulta con un canal de origen OTA identificado (p. ej. Booking, Airbnb, Expedia) y verificar de forma independiente que el resultado incluya el porcentaje pactado vigente para ese canal, sin necesidad de generar una liquidación completa.

**Escenarios de aceptación**:

1. **Escenario**: Consulta exitosa para un canal OTA con comisión pactada
   - **Dado** que la reserva identifica un canal OTA (p. ej. Booking) con un porcentaje de comisión pactado y vigente
   - **Cuando** "Descontar comisión OTA" o "Generar factura final" invoca la consulta
   - **Entonces** el sistema devuelve el porcentaje vigente para ese canal, identificando el canal consultado

2. **Escenario**: Reserva de canal directo
   - **Dado** que la reserva no proviene de un intermediario (canal directo) o no tiene canal de origen registrado
   - **Cuando** se invoca la consulta
   - **Entonces** el sistema indica que no aplica comisión OTA, sin devolver un porcentaje de cero como si fuera un valor configurado

---

### Historia de usuario 2 - Reflejar el porcentaje vigente al momento de cada consulta (Prioridad: P1)

Como responsable de facturación, quiero que la consulta siempre devuelva el porcentaje vigente en el momento en que se invoca, para que la liquidación definitiva use la tasa correcta aunque el pacto con la OTA haya cambiado desde el check-in.

**Por qué esta prioridad**: La liquidación definitiva debe usar el porcentaje vigente al check-out, no uno cacheado del check-in; una consulta desactualizada distorsiona el ingreso neto reportado al hotel.

**Prueba independiente**: Se puede configurar un cambio en el porcentaje pactado con una OTA entre dos momentos, invocar la consulta antes y después del cambio, y verificar que cada consulta refleje el valor vigente en su propio momento.

**Escenarios de aceptación**:

1. **Escenario**: El porcentaje pactado cambia entre el check-in y el check-out
   - **Dado** que el porcentaje pactado con una OTA cambió después del check-in de una reserva
   - **Cuando** "Generar liquidación" invoca la consulta al momento del check-out
   - **Entonces** el sistema devuelve el porcentaje vigente en ese momento, no el que estaba vigente en el check-in

2. **Escenario**: Consultas repetidas sin cambios devuelven el mismo valor
   - **Dado** que el porcentaje pactado de un canal OTA no ha cambiado
   - **Cuando** se invoca la consulta más de una vez para ese canal
   - **Entonces** el sistema devuelve siempre el mismo porcentaje

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
- El porcentaje pactado cambia entre el check-in y el check-out de una misma estancia: la liquidación preliminar y la definitiva pueden diferir en el valor de comisión utilizado, y esto es un comportamiento esperado, no un error.
- Se agrega una nueva OTA al sistema sin definir aún su porcentaje pactado: toda consulta para ese canal debe rechazarse hasta que se configure.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE consultar el porcentaje de comisión vigente y pactado para el canal OTA identificado como origen de una reserva, obteniéndolo de `Modulo2`, que es quien gestiona el registro del canal de origen y el porcentaje pactado con cada intermediario.
- **FR-002**: El sistema DEBE indicar que no aplica comisión OTA cuando la reserva sea de canal directo o no tenga canal de origen registrado, sin devolver un porcentaje de cero como si fuera una configuración explícita.
- **FR-003**: El sistema DEBE reflejar siempre el porcentaje vigente en el momento de la consulta, sin depender de una copia cacheada o desactualizada.
- **FR-004**: El sistema DEBE rechazar la consulta y no devolver un valor sustituto cuando el canal OTA no tenga ningún porcentaje de comisión pactado configurado.
- **FR-005**: El sistema DEBE rechazar la consulta cuando se detecte más de un porcentaje vigente simultáneamente para el mismo canal OTA, sin resolver la ambigüedad de forma arbitraria.
- **FR-006**: El sistema DEBE rechazar la consulta cuando el porcentaje configurado sea inválido (negativo, mayor a 100%, o no numérico).
- **FR-007**: El sistema DEBE identificar el canal OTA específico consultado (p. ej. Booking, Airbnb, Expedia) en el resultado de la consulta.
- **FR-008**: El sistema NO DEBE modificar, negociar ni completar la configuración del porcentaje de comisión OTA en `Modulo2`; esta consulta es de solo lectura.
- **FR-009**: El sistema DEBE distinguir entre un porcentaje de comisión configurado en 0% y la ausencia total de configuración para un canal OTA.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Canal OTA**: Intermediario de reserva (p. ej. Booking, Airbnb, Expedia) gestionado y registrado por `Modulo2`, con un porcentaje de comisión pactado.
- **Porcentaje de comisión pactado**: Tasa vigente acordada con un canal OTA, gestionada por `Modulo2` y usada por Módulo 3 para descontar del valor de hospedaje bruto (ver `descontar_comision_ota.md`).
- **Canal de origen de la reserva**: Clasificación de la reserva como directo o como un canal OTA específico, de la cual depende si esta consulta aplica.
- **Resultado de consulta**: Porcentaje vigente devuelto, indicación de que no aplica comisión (canal directo), o motivo de rechazo cuando no exista configuración válida.

### Reglas de negocio

- **BR-001**: Frontera arquitectónica: el canal OTA de una reserva y su porcentaje de comisión pactado son propiedad y responsabilidad de `Modulo2`. El Módulo 3 únicamente lo consulta como insumo para "Descontar comisión OTA" y "Generar factura final"; no lo configura, identifica, negocia ni almacena de forma independiente.
- **BR-002**: La ausencia de un porcentaje configurado para un canal OTA detiene la consulta; el sistema no sustituye el valor faltante por cero ni por un valor supuesto.
- **BR-003**: Un canal directo, o una reserva sin canal de origen registrado, no tiene comisión OTA aplicable; esto es distinto de un canal OTA con 0% configurado explícitamente.
- **BR-004**: El porcentaje devuelto debe ser siempre el vigente en el momento exacto de la consulta, permitiendo que "Generar liquidación" use el porcentaje vigente al check-out aunque difiera del usado en una liquidación preliminar previa.
- **BR-005**: Unicidad por canal: cada canal OTA debe tener, como máximo, un porcentaje vigente en un momento dado; una consulta que detecte más de uno debe rechazarse en vez de elegir uno arbitrariamente.

## Requisitos no funcionales

- **NFR-001**: Determinismo: para el mismo canal OTA y el mismo estado de configuración vigente, la consulta debe devolver siempre el mismo resultado.
- **NFR-002**: Rendimiento: la consulta debe completarse en un tiempo que no genere demoras perceptibles dentro de los procesos de liquidación y facturación que la invocan.
- **NFR-003**: Actualidad: la consulta debe reflejar siempre el estado más reciente del porcentaje pactado en `Modulo2`, sin depender de una copia cacheada desactualizada.
- **NFR-004**: Los mensajes de rechazo deben ser comprensibles para el personal de facturación y suficientemente específicos para identificar el canal OTA afectado.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las consultas con un porcentaje de comisión pactado vigente y sin ambigüedad devuelven el porcentaje correcto identificando el canal OTA.
- **SC-002**: El 100% de las consultas sobre reservas de canal directo o sin canal registrado indican que no aplica comisión, sin devolver un porcentaje sustituto.
- **SC-003**: El 100% de las consultas sobre canales OTA sin porcentaje configurado o con valores inválidos se rechazan sin devolver un valor sustituto.
- **SC-004**: El 100% de las consultas realizadas en momentos distintos para el mismo canal OTA, con porcentajes pactados distintos vigentes en cada momento, devuelven el valor correspondiente a su propio momento de consulta, sin reutilizar un valor cacheado de una consulta anterior.
- **SC-005**: El 0% de las consultas modifica o completa la configuración del porcentaje de comisión OTA.
