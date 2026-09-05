# Especificación de Funcionalidad: Generar liquidación

**Creado**: 2026-09-04

## Escenarios de Usuario y Pruebas *(obligatorio)*

### Historia de Usuario 1 - Generar la liquidación definitiva al registrar el check-out (Prioridad: P1)

Como sistema de gestión hotelera, quiero generar la liquidación definitiva de una estancia cuando se registra el check-out, para obtener el ingreso neto de hospedaje que servirá de base para la facturación.

**Por qué esta prioridad**: El check-out es el momento en que la estancia queda cerrada operativamente; sin una liquidación definitiva en ese instante no existe un valor confiable para facturar ni para conciliar con la OTA.

**Prueba independiente**: Se puede registrar un check-out de una reserva con tarifa dinámica ya calculada y canal de origen conocido, y verificar que el sistema entregue una liquidación con estado definitivo y el ingreso neto correspondiente.

**Escenarios de Aceptación**:

1. **Escenario**: Check-out de una reserva de canal directo
   - **Dado** que la reserva no proviene de un intermediario y ya tiene calculado el valor de hospedaje mediante la tarifa dinámica
   - **Cuando** se registra el check-out de la estancia
   - **Entonces** el sistema genera una liquidación definitiva cuyo ingreso neto es igual al valor de hospedaje, sin ningún descuento de comisión

2. **Escenario**: Liquidación definitiva no se recalcula por sí sola
   - **Dado** que ya existe una liquidación definitiva generada para una reserva
   - **Cuando** se vuelve a solicitar la liquidación de esa misma estancia
   - **Entonces** el sistema devuelve la liquidación definitiva ya existente, sin generar una nueva ni modificarla

---

### Historia de Usuario 2 - Aplicar el descuento de comisión cuando la reserva proviene de una OTA (Prioridad: P1)

Como responsable de facturación, quiero que el sistema aplique automáticamente el descuento de comisión de la OTA correspondiente al generar la liquidación, para que el ingreso neto refleje correctamente lo que el hotel realmente recibe.

**Por qué esta prioridad**: Un descuento de comisión mal aplicado (o no aplicado) distorsiona directamente el ingreso neto y la conciliación financiera con cada intermediario.

**Prueba independiente**: Se puede generar la liquidación de una reserva marcada con un canal OTA y un porcentaje de comisión configurado, y verificar que el ingreso neto excluya exactamente ese porcentaje del valor de hospedaje.

**Escenarios de Aceptación**:

1. **Escenario**: Reserva con intermediario y comisión configurada
   - **Dado** que la reserva identifica un canal OTA con un porcentaje de comisión configurado y vigente
   - **Cuando** el sistema genera la liquidación
   - **Entonces** descuenta del valor de hospedaje exactamente ese porcentaje y reporta el valor de la comisión por separado

2. **Escenario**: Reserva de canal directo
   - **Dado** que la reserva se originó por recepción, teléfono, portal propio, o no tiene un canal de origen registrado
   - **Cuando** el sistema genera la liquidación
   - **Entonces** trata la reserva como canal directo, no aplica ningún descuento de comisión, y el ingreso neto es igual al valor de hospedaje

3. **Escenario**: Reserva con intermediario sin comisión configurada
   - **Dado** que la reserva identifica un canal OTA pero no existe un porcentaje de comisión configurado para ese canal
   - **Cuando** el sistema intenta generar la liquidación
   - **Entonces** rechaza la generación y no asume un porcentaje de comisión por defecto

---

### Historia de Usuario 3 - Generar una liquidación preliminar visible como estimado al registrar el check-in (Prioridad: P2)

Como agente de recepción, quiero contar con una liquidación preliminar visible como estimado desde el check-in, para que el huésped y el personal conozcan el ingreso neto esperado de la estancia antes de que finalice.

**Por qué esta prioridad**: Adelantar una estimación ayuda a la gestión operativa y a la transparencia frente al huésped, pero no es indispensable para el cierre de la estancia, por lo que su prioridad es menor que la liquidación definitiva.

**Prueba independiente**: Se puede registrar un check-in con tarifa dinámica y canal de origen conocidos, y verificar que el sistema entregue una liquidación en estado preliminar, marcada como estimado, con el mismo criterio de cálculo que la definitiva.

**Escenarios de Aceptación**:

1. **Escenario**: Generar liquidación preliminar en el check-in
   - **Dado** que se registra el check-in de una reserva con tarifa dinámica y canal de origen conocidos
   - **Cuando** el sistema procesa el check-in
   - **Entonces** genera una liquidación en estado preliminar, visible como estimado, dejando explícito que no es un valor definitivo

2. **Escenario**: La liquidación preliminar se actualiza ante cambios antes del check-out
   - **Dado** que existe una liquidación preliminar y cambian las fechas de estancia o el canal de origen antes del check-out
   - **Cuando** el sistema detecta el cambio
   - **Entonces** recalcula la liquidación preliminar reflejando los nuevos datos, sin afectar liquidaciones definitivas ya emitidas

3. **Escenario**: La liquidación preliminar no reemplaza a la definitiva
   - **Dado** que existe una liquidación preliminar generada en el check-in
   - **Cuando** se registra el check-out de la misma estancia
   - **Entonces** el sistema genera una liquidación definitiva independiente

---

### Historia de Usuario 4 - Rechazar liquidaciones con datos incompletos o inconsistentes (Prioridad: P1)

Como responsable de la operación hotelera, quiero que el sistema rechace la generación de una liquidación cuando falten datos obligatorios o existan inconsistencias, para evitar que un ingreso neto incorrecto llegue a la facturación.

**Por qué esta prioridad**: Una liquidación generada con datos incompletos puede traducirse directamente en una factura incorrecta y en una conciliación errónea con la OTA.

**Prueba independiente**: Se puede intentar generar una liquidación sin valor de hospedaje calculado, con un porcentaje de comisión inválido, o duplicando una liquidación definitiva ya existente, y verificar que el sistema no entregue un resultado inválido.

**Escenarios de Aceptación**:

1. **Escenario**: Falta el valor de hospedaje
   - **Dado** que la tarifa dinámica de la estancia aún no ha sido calculada o fue rechazada
   - **Cuando** el sistema intenta generar la liquidación
   - **Entonces** rechaza la operación, identifica la causa y no genera un ingreso neto

2. **Escenario**: Datos de comisión inconsistentes
   - **Dado** que la reserva indica un canal OTA con un código de confirmación externo, pero el porcentaje de comisión configurado es inválido (negativo o mayor al 100%)
   - **Cuando** el sistema intenta generar la liquidación
   - **Entonces** rechaza la operación y no sustituye el valor inválido por una comisión estimada

3. **Escenario**: Intento de generar una segunda liquidación definitiva
   - **Dado** que ya existe una liquidación definitiva vigente para la estancia
   - **Cuando** se intenta generar una nueva liquidación definitiva para la misma estancia
   - **Entonces** el sistema rechaza la operación y mantiene la liquidación definitiva original vigente

### Casos Límite

- La estancia aún no tiene check-in ni check-out registrado (por ejemplo, una reserva cancelada o un no-show): no debe existir ninguna liquidación, ni preliminar ni definitiva.
- La estancia tiene check-in pero no check-out registrado (huésped aún en sitio): solo debe existir liquidación preliminar, visible como estimado, nunca definitiva.
- El porcentaje de comisión OTA cambia entre el check-in y el check-out: la liquidación definitiva debe usar el porcentaje vigente al momento del check-out, no el usado en la preliminar.
- La reserva no tiene un canal de origen registrado: el sistema asume canal directo y no aplica comisión.
- El valor de hospedaje calculado por la tarifa dinámica es cero o el cálculo fue rechazado: la liquidación no debe generarse con un ingreso neto parcial.
- Se intenta generar más de una liquidación definitiva para la misma estancia: el sistema debe impedirlo y conservar la liquidación definitiva original.

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **RF-001**: El sistema DEBE generar la liquidación de una estancia únicamente a partir de los eventos de check-in (liquidación preliminar) o check-out (liquidación definitiva) registrados por el módulo de reservas; sin que haya ocurrido alguno de estos dos eventos no debe existir liquidación.
- **RF-002**: El sistema DEBE obtener el valor de hospedaje de la estancia a partir del resultado del cálculo de tarifa dinámica para el tipo de habitación y el período correspondiente.
- **RF-003**: El sistema DEBE identificar el canal de origen de la reserva (directo o intermediario OTA) antes de determinar si corresponde un descuento de comisión.
- **RF-004**: El sistema DEBE asumir canal directo cuando la reserva no tenga un canal de origen registrado.
- **RF-005**: El sistema DEBE consultar el porcentaje de comisión vigente y pactado cuando el canal de origen sea un intermediario OTA.
- **RF-006**: El sistema DEBE descontar del valor de hospedaje la comisión correspondiente únicamente cuando la reserva provenga de un intermediario OTA.
- **RF-007**: El sistema NO DEBE aplicar ningún descuento de comisión cuando la reserva sea de canal directo o no tenga canal de origen registrado.
- **RF-008**: El sistema DEBE calcular el ingreso neto de la liquidación como el valor de hospedaje menos la comisión OTA aplicable, cuando corresponda.
- **RF-009**: El sistema DEBE generar una liquidación en estado preliminar, visible como estimado, al registrar el check-in de la estancia.
- **RF-010**: El sistema DEBE generar una liquidación en estado definitivo al registrar el check-out de la estancia, independiente de cualquier liquidación preliminar previa.
- **RF-011**: El sistema DEBE recalcular la liquidación preliminar cuando cambien las fechas de estancia o el canal de origen antes del check-out.
- **RF-012**: El sistema DEBE mantener una única liquidación definitiva por estancia; no debe generar una segunda liquidación definitiva para la misma estancia.
- **RF-013**: El sistema DEBE entregar un desglose de la liquidación que incluya el valor de hospedaje, el canal de origen, el porcentaje y valor de la comisión OTA (si aplica), y el ingreso neto resultante.
- **RF-014**: El sistema NO DEBE incluir el Impuesto al Valor Agregado (IVA) dentro del ingreso neto de la liquidación.
- **RF-015**: El sistema DEBE rechazar la generación de la liquidación cuando falte el valor de hospedaje o el porcentaje de comisión requerido para un canal OTA.
- **RF-016**: El sistema DEBE devolver un motivo identificable y accionable cuando rechace la generación de una liquidación.
- **RF-017**: El sistema DEBE identificar la reserva, el tipo de habitación, las fechas de la estancia y el canal de origen asociados a cada liquidación generada.
- **RF-018**: El sistema DEBE permitir consultar posteriormente una liquidación ya generada sin recalcularla, para que su valor pueda reutilizarse en la generación de la factura final.
- **RF-019**: El sistema NO DEBE modificar el estado de disponibilidad, ocupación o bloqueo de la habitación como efecto de generar una liquidación.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **Liquidación**: Resultado del proceso de liquidación de una estancia; incluye estado (preliminar o definitivo), valor de hospedaje, comisión OTA aplicada (si corresponde) e ingreso neto.
- **Estancia/Reserva**: Registro proveniente del módulo de reservas con eventos de check-in y check-out, tipo de habitación y canal de origen.
- **Canal de origen**: Clasificación de la reserva como directo o como intermediario OTA, con su código de confirmación externo cuando aplica.
- **Comisión OTA**: Porcentaje pactado con un intermediario, vigente para el canal de origen de la reserva.
- **Valor de hospedaje**: Resultado del cálculo de tarifa dinámica para el tipo de habitación y el período de la estancia, usado como base de la liquidación.
- **Ingreso neto**: Valor de hospedaje menos la comisión OTA aplicable, sin incluir impuestos.
- **Detalle de liquidación**: Desglose que identifica el valor de hospedaje, el canal, la comisión aplicada y el ingreso neto de una liquidación específica.

### Reglas de Negocio

- **RN-001**: La liquidación solo puede generarse a partir del registro de check-in (preliminar) o de check-out (definitiva); no existe liquidación sin que se haya registrado alguno de estos dos eventos.
- **RN-002**: El ingreso neto de la liquidación es igual al valor de hospedaje calculado mediante la tarifa dinámica, menos la comisión OTA cuando la reserva proviene de un intermediario.
- **RN-003**: La comisión OTA solo se descuenta cuando el canal de la reserva es un intermediario; en canal directo, o cuando no hay canal de origen registrado, la comisión es cero.
- **RN-004**: El valor de hospedaje usado en la liquidación debe coincidir con el resultado del cálculo de tarifa dinámica para la misma habitación y el mismo período; la liquidación no recalcula la tarifa por su cuenta.
- **RN-005**: El Impuesto al Valor Agregado y otros impuestos no forman parte del ingreso neto de la liquidación; se gestionan en la generación de la factura final.
- **RN-006**: La liquidación generada en el check-in tiene carácter preliminar, es visible como estimado y puede recalcularse mientras la estancia siga activa; la liquidación generada en el check-out tiene carácter definitivo.
- **RN-007**: Debe existir una única liquidación definitiva por estancia; el sistema no genera una segunda liquidación definitiva para la misma estancia.
- **RN-008**: El porcentaje de comisión OTA aplicado en la liquidación definitiva debe ser el vigente al momento del check-out.
- **RN-009**: Un dato obligatorio faltante o inconsistente debe detener la generación de la liquidación, sin producir un ingreso neto estimado o parcial.
- **RN-010**: La disponibilidad, ocupación o bloqueo de la habitación no forma parte de la liquidación y no se modifica al generarla.

## Requisitos No Funcionales

- **RNF-001**: La generación de la liquidación debe ser determinista: la misma reserva, con las mismas reglas y datos vigentes, debe producir siempre el mismo resultado.
- **RNF-002**: La liquidación definitiva debe generarse en un tiempo adecuado durante el proceso de check-out, sin introducir esperas perceptibles para recepción.
- **RNF-003**: Cada liquidación generada debe quedar trazable, identificando la reserva, la fecha de generación y los datos utilizados para el cálculo.
- **RNF-004**: La exactitud monetaria de la liquidación debe ser consistente con la precisión y el redondeo definidos para el cálculo de tarifa dinámica.
- **RNF-005**: Los mensajes de error o rechazo deben ser comprensibles para el personal de recepción y facturación, y suficientemente específicos para corregir la causa.
- **RNF-006**: El resultado de la liquidación no debe exponer información personal del huésped que no sea necesaria para el proceso financiero.
- **RNF-007**: La solución debe mantener la integridad referencial entre la reserva, la tarifa aplicada y la comisión aplicada en cada liquidación.

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **CE-001**: El 100% de los check-out registrados generan una liquidación definitiva antes de habilitar la generación de la factura final.
- **CE-002**: El 100% de las liquidaciones de reservas con canal OTA reflejan el descuento de comisión con el porcentaje vigente al check-out.
- **CE-003**: El 100% de las liquidaciones de reservas de canal directo, o sin canal registrado, no presentan ningún descuento de comisión.
- **CE-004**: El 100% de los intentos de generar una liquidación con el valor de hospedaje o el porcentaje de comisión faltantes o inválidos se rechazan sin producir un ingreso neto.
- **CE-005**: El ingreso neto de la liquidación definitiva coincide con el valor reutilizado posteriormente en la factura final en el 100% de los casos.
- **CE-006**: Ninguna generación de liquidación modifica el estado de disponibilidad, ocupación o bloqueo de una habitación.
- **CE-007**: El 100% de las estancias activas (con check-in y sin check-out) exponen únicamente liquidaciones en estado preliminar, visibles como estimado.
- **CE-008**: El 100% de los intentos de generar una segunda liquidación definitiva para la misma estancia son rechazados, conservando la original.
