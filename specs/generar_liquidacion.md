# Especificación de Funcionalidad: Generar liquidación

**Creado**: 2026-09-04

## Escenarios de Usuario y Pruebas *(obligatorio)*

### Historia de Usuario 1 - Generar la liquidación `Final` al registrar el check-out (Prioridad: P1)

Como sistema de gestión hotelera, quiero generar la liquidación `Final` de una estancia cuando se registra el check-out, para obtener el ingreso neto de hospedaje que servirá de base para la facturación.

**Por qué esta prioridad**: El check-out es el momento en que la estancia queda cerrada operativamente; sin una liquidación `Final` en ese instante no existe un valor confiable para facturar ni para conciliar con la OTA.

**Prueba independiente**: Se puede registrar un check-out de una reserva con tarifa dinámica ya calculada y canal de origen conocido, y verificar que el sistema entregue una liquidación con estado `Final` y el ingreso neto correspondiente.

**Escenarios de Aceptación**:

1. **Escenario**: Check-out de una reserva de canal directo
   - **Dado** que la reserva no proviene de un intermediario y ya tiene calculado el valor de hospedaje mediante la tarifa dinámica
   - **Cuando** se registra el check-out de la estancia
   - **Entonces** el sistema genera una liquidación `Final` cuyo ingreso neto es igual al valor de hospedaje, sin ningún descuento de comisión

2. **Escenario**: Liquidación `Final` no se recalcula por sí sola
   - **Dado** que ya existe una liquidación `Final` generada para una reserva
   - **Cuando** se vuelve a solicitar la liquidación de esa misma estancia
   - **Entonces** el sistema devuelve la liquidación `Final` ya existente, sin generar una nueva ni modificarla

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

### Historia de Usuario 3 - Generar una liquidación `Preliminary` visible como estimado al registrar el check-in (Prioridad: P2)

Como agente de recepción, quiero contar con una liquidación `Preliminary` visible como estimado desde el check-in, para que el huésped y el personal conozcan el ingreso neto esperado de la estancia antes de que finalice.

**Por qué esta prioridad**: Adelantar una estimación ayuda a la gestión operativa y a la transparencia frente al huésped, pero no es indispensable para el cierre de la estancia, por lo que su prioridad es menor que la liquidación `Final`.

**Prueba independiente**: Se puede registrar un check-in con tarifa dinámica y canal de origen conocidos, y verificar que el sistema entregue una liquidación en estado `Preliminary`, marcada como estimado, con el mismo criterio de cálculo que la `Final`.

**Escenarios de Aceptación**:

1. **Escenario**: Generar liquidación `Preliminary` en el check-in
   - **Dado** que se registra el check-in de una reserva con tarifa dinámica y canal de origen conocidos
   - **Cuando** el sistema procesa el check-in
   - **Entonces** genera una liquidación en estado `Preliminary`, visible como estimado, dejando explícito que su estado no es `Final`

2. **Escenario**: La liquidación `Preliminary` se actualiza ante cambios de fechas antes del check-out
   - **Dado** que existe una liquidación `Preliminary` y cambian las fechas de estancia antes del check-out
   - **Cuando** el sistema detecta el cambio
   - **Entonces** recalcula la liquidación `Preliminary` reflejando las nuevas fechas, sin afectar liquidaciones `Final` ya emitidas y sin modificar el canal de origen ni el porcentaje de comisión OTA ya capturados en el check-in

3. **Escenario**: La liquidación `Preliminary` no reemplaza a la `Final`
   - **Dado** que existe una liquidación `Preliminary` generada en el check-in
   - **Cuando** se registra el check-out de la misma estancia
   - **Entonces** el sistema genera una liquidación `Final` independiente

4. **Escenario**: La liquidación `Preliminary` se anula si se anula el check-in
   - **Dado** que existe una liquidación `Preliminary` generada en el check-in y el Módulo 2 notifica la anulación de ese check-in antes del check-out
   - **Cuando** el sistema procesa la notificación de anulación
   - **Entonces** transiciona la liquidación al estado `Cancelled`, conserva el registro completo sin eliminarlo, y no permite que posteriormente se genere una liquidación `Final` para esa estancia

### Casos Límite

- La estancia aún no tiene check-in ni check-out registrado (por ejemplo, una reserva cancelada o un no-show): no debe existir ninguna liquidación, ni `Preliminary` ni `Final`.
- La estancia tiene check-in pero no check-out registrado (huésped aún en sitio): solo debe existir liquidación `Preliminary`, visible como estimado, nunca `Final`.
- El porcentaje de comisión OTA pactado con la OTA, o el canal de origen de la reserva, cambian en Módulo 2 después del check-in de una estancia: el cambio no afecta la liquidación ya iniciada; tanto el canal de origen como el porcentaje de comisión son los capturados en el check-in y quedan fijos para toda la estancia, sin volver a consultarse ni recalcularse.
- El porcentaje de comisión OTA configurado es inválido (negativo o mayor al 100%): el sistema rechaza la generación de la liquidación y no sustituye el valor inválido por una comisión estimada.
- La reserva no tiene un canal de origen registrado: el sistema asume canal directo y no aplica comisión.
- El valor de hospedaje calculado por la tarifa dinámica aún no ha sido calculado, es cero, o el cálculo fue rechazado: la liquidación no debe generarse con un ingreso neto parcial.
- Se intenta generar más de una liquidación `Final` para la misma estancia: el sistema debe impedirlo y conservar la liquidación `Final` original.
- El check-in se anula después de generarse la liquidación `Preliminary`: la liquidación transiciona a estado `Cancelled`, se conserva para trazabilidad, y nunca deriva en una liquidación `Final`.
- Se intenta anular una liquidación que ya es `Final` (posterior al check-out): el sistema debe rechazarlo, ya que la anulación solo aplica a una liquidación `Preliminary` cuya estancia aún no ha cerrado.
- La fecha real de salida registrada en el check-out difiere de la fecha de salida programada usada para calcular la liquidación `Preliminary` (salida anticipada o extensión de estancia): el valor de hospedaje de la liquidación `Final` debe recalcularse sobre las noches efectivamente transcurridas, y puede diferir del valor estimado en la `Preliminary`, sin que esto se considere un error.

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **RF-001**: El sistema DEBE generar la liquidación de una estancia únicamente cuando sea invocado (`<<include>>`) por `Registrar Check-in` (liquidación `Preliminary`) o por `Registrar Check-out` (liquidación `Final`), casos de uso que son los que reciben directamente los eventos del Módulo 2; sin que haya ocurrido alguno de estos dos eventos no debe existir liquidación.
- **RF-002**: El sistema DEBE obtener el valor de hospedaje de la estancia a partir del resultado del cálculo de tarifa dinámica para el tipo de habitación y el período correspondiente.
- **RF-003**: El sistema DEBE identificar el canal de origen de la reserva (directo o intermediario OTA) antes de determinar si corresponde un descuento de comisión.
- **RF-004**: El sistema DEBE asumir canal directo cuando la reserva no tenga un canal de origen registrado.
- **RF-005**: El sistema DEBE obtener el porcentaje de comisión pactado desde los datos de la reserva suministrados por el Módulo 2 en el payload del check-in cuando el canal de origen sea un intermediario OTA, y conservarlo sin cambios para usarlo tanto en la liquidación `Preliminary` como en la `Final`; el sistema no mantiene una tabla propia de convenios de comisión por OTA ni vuelve a consultar el porcentaje en el check-out.
- **RF-006**: El sistema DEBE descontar del valor de hospedaje la comisión correspondiente únicamente cuando la reserva provenga de un intermediario OTA.
- **RF-007**: El sistema NO DEBE aplicar ningún descuento de comisión cuando la reserva sea de canal directo o no tenga canal de origen registrado.
- **RF-008**: El sistema DEBE calcular el ingreso neto de la liquidación como el valor de hospedaje menos la comisión OTA aplicable, cuando corresponda.
- **RF-009**: El sistema DEBE generar una liquidación en estado `Preliminary`, visible como estimado, al registrar el check-in de la estancia.
- **RF-010**: El sistema DEBE generar una liquidación en estado `Final` al registrar el check-out de la estancia, independiente de cualquier liquidación `Preliminary` previa.
- **RF-011**: El sistema DEBE recalcular la liquidación `Preliminary` únicamente cuando cambien las fechas de estancia antes del check-out; el canal de origen y el porcentaje de comisión OTA capturados en el check-in son inmutables y no forman parte de este recálculo.
- **RF-012**: El sistema DEBE mantener una única liquidación `Final` por estancia; no debe generar una segunda liquidación `Final` para la misma estancia.
- **RF-013**: El sistema DEBE entregar un desglose de la liquidación que incluya el valor de hospedaje, el canal de origen, el porcentaje y valor de la comisión OTA (si aplica), y el ingreso neto resultante.
- **RF-014**: El sistema NO DEBE incluir el Impuesto al Valor Agregado (IVA) dentro del ingreso neto de la liquidación.
- **RF-015**: El sistema DEBE rechazar la generación de la liquidación cuando falte el valor de hospedaje o el porcentaje de comisión requerido para un canal OTA.
- **RF-016**: El sistema DEBE devolver un motivo identificable y accionable cuando rechace la generación de una liquidación.
- **RF-017**: El sistema DEBE identificar la reserva, el tipo de habitación, las fechas de la estancia y el canal de origen asociados a cada liquidación generada.
- **RF-018**: El sistema DEBE permitir consultar posteriormente una liquidación ya generada sin recalcularla, para que su valor pueda reutilizarse en la generación de la factura final.
- **RF-019**: El sistema NO DEBE modificar el estado de disponibilidad, ocupación o bloqueo de la habitación como efecto de generar una liquidación.
- **RF-020**: El sistema DEBE transicionar una liquidación `Preliminary` a estado `Cancelled` cuando el Módulo 2 notifique la anulación del check-in correspondiente antes del check-out, conservando el registro completo sin eliminarlo.
- **RF-021**: El sistema NO DEBE generar una liquidación `Final` para una estancia cuya liquidación fue transicionada a estado `Cancelled`.
- **RF-022**: El sistema DEBE invocar obligatoriamente (`<<include>>`) el caso de uso `Generar factura final` como parte de la generación de cada liquidación, produciendo una prefactura cuando la liquidación resultante sea `Preliminary` y una factura fiscal definitiva cuando sea `Final`.
- **RF-023**: El sistema DEBE calcular el valor de hospedaje de la liquidación `Final` sobre el número de noches efectivamente transcurridas entre el check-in y la fecha real de salida, el cual puede diferir del número de noches programadas utilizado para la liquidación `Preliminary`.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **Liquidación**: Resultado del proceso de liquidación de una estancia; incluye estado (`Preliminary`, `Final` o `Cancelled`), valor de hospedaje, comisión OTA aplicada (si corresponde), ingreso neto, y el documento de facturación asociado (prefactura o factura definitiva) generado mediante el include obligatorio a `Generar factura final`.
- **Estancia/Reserva**: Registro proveniente del Módulo 2 con eventos de check-in y check-out, tipo de habitación y canal de origen.
- **Canal de origen**: Clasificación de la reserva como directo o como intermediario OTA, con su código de confirmación externo cuando aplica; capturado en el check-in e inmutable durante toda la estancia.
- **Comisión OTA**: Porcentaje pactado con un intermediario, suministrado por el Módulo 2 como parte de los datos de la reserva, vigente para el canal de origen de la reserva.
- **Valor de hospedaje**: Resultado del cálculo de tarifa dinámica para el tipo de habitación y el período de la estancia, usado como base de la liquidación.
- **Ingreso neto**: Valor de hospedaje menos la comisión OTA aplicable, sin incluir impuestos.
- **Detalle de liquidación**: Desglose que identifica el valor de hospedaje, el canal, la comisión aplicada y el ingreso neto de una liquidación específica.

### Reglas de Negocio

- **RN-001**: La liquidación solo puede generarse a partir del registro de check-in (`Preliminary`) o de check-out (`Final`); no existe liquidación sin que se haya registrado alguno de estos dos eventos.
- **RN-002**: El ingreso neto de la liquidación es igual al valor de hospedaje calculado mediante la tarifa dinámica, menos la comisión OTA cuando la reserva proviene de un intermediario.
- **RN-003**: La comisión OTA solo se descuenta cuando el canal de la reserva es un intermediario; en canal directo, o cuando no hay canal de origen registrado, la comisión es cero.
- **RN-004**: El valor de hospedaje usado en la liquidación debe coincidir con el resultado del cálculo de tarifa dinámica para la misma habitación y el mismo período; la liquidación no recalcula la tarifa por su cuenta.
- **RN-005**: El Impuesto al Valor Agregado y otros impuestos no forman parte del ingreso neto de la liquidación; se gestionan en la generación de la factura final.
- **RN-006**: La liquidación generada en el check-in tiene carácter `Preliminary`, es visible como estimado y puede recalcularse mientras la estancia siga activa; la liquidación generada en el check-out tiene carácter `Final`.
- **RN-007**: Debe existir una única liquidación `Final` por estancia; el sistema no genera una segunda liquidación `Final` para la misma estancia.
- **RN-008**: El porcentaje de comisión OTA aplicado en la liquidación `Final` es el mismo capturado a partir del payload del check-in y persistido en la liquidación `Preliminary`; el sistema no vuelve a consultarlo ni a recalcularlo en el check-out, incluso si el porcentaje pactado con la OTA cambia posteriormente en Módulo 2.
- **RN-009**: Un dato obligatorio faltante o inconsistente debe detener la generación de la liquidación, sin producir un ingreso neto estimado o parcial.
- **RN-010**: La disponibilidad, ocupación o bloqueo de la habitación no forma parte de la liquidación y no se modifica al generarla.
- **RN-011**: Una liquidación `Preliminary` transiciona a estado `Cancelled` cuando se anula el check-in correspondiente antes del check-out; una liquidación `Final` nunca transiciona a `Cancelled`, dado que el check-out ya cerró la estancia.
- **RN-012**: Una liquidación `Cancelled` conserva su registro completo para trazabilidad, pero no puede recalcularse ni derivar en una liquidación `Final`.
- **RN-013**: Toda liquidación generada incluye (`<<include>>`) obligatoriamente a `Generar factura final`; no existe una liquidación `Preliminary` sin su prefactura asociada ni una liquidación `Final` sin su factura fiscal definitiva asociada.
- **RN-014**: El valor de hospedaje de la liquidación `Final` puede diferir del estimado en la liquidación `Preliminary` cuando la fecha real de salida difiera de la programada (salida anticipada o extensión de estancia); en ambos casos, el hospedaje `Final` refleja las noches efectivamente transcurridas.
- **RN-015**: El canal de origen de la reserva es el recibido de Módulo 2 en el check-in (`Canal Directo` u `OTA`) y es inmutable durante toda la estancia; el sistema no lo modifica ni lo vuelve a consultar en el check-out, y no gestiona correcciones de canal, ya que esa información es propiedad exclusiva de Módulo 2.

## Requisitos No Funcionales

- **RNF-001**: La generación de la liquidación debe ser determinista: la misma reserva, con las mismas reglas y datos vigentes, debe producir siempre el mismo resultado.
- **RNF-002**: La liquidación `Final` debe generarse en un tiempo adecuado durante el proceso de check-out, sin introducir esperas perceptibles para recepción.
- **RNF-003**: Cada liquidación generada debe quedar trazable, identificando la reserva, la fecha de generación y los datos utilizados para el cálculo.
- **RNF-004**: La exactitud monetaria de la liquidación debe ser consistente con la precisión y el redondeo definidos para el cálculo de tarifa dinámica.
- **RNF-005**: Los mensajes de error o rechazo deben ser comprensibles para el personal de recepción y facturación, y suficientemente específicos para corregir la causa.
- **RNF-006**: El resultado de la liquidación no debe exponer información personal del huésped que no sea necesaria para el proceso financiero.
- **RNF-007**: La solución debe mantener la integridad referencial entre la reserva, la tarifa aplicada y la comisión aplicada en cada liquidación.

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **CE-001**: El 100% de los check-out registrados generan una liquidación `Final` antes de habilitar la generación de la factura final.
- **CE-002**: El 100% de las liquidaciones de reservas con canal OTA reflejan el descuento de comisión con el mismo porcentaje capturado en el check-in, sin variación entre la liquidación `Preliminary` y la `Final`.
- **CE-003**: El 100% de las liquidaciones de reservas de canal directo, o sin canal registrado, no presentan ningún descuento de comisión.
- **CE-004**: El 100% de los intentos de generar una liquidación con el valor de hospedaje o el porcentaje de comisión faltantes o inválidos se rechazan sin producir un ingreso neto.
- **CE-005**: El ingreso neto de la liquidación `Final` coincide con el valor reutilizado posteriormente en la factura final en el 100% de los casos.
- **CE-006**: Ninguna generación de liquidación modifica el estado de disponibilidad, ocupación o bloqueo de una habitación.
- **CE-007**: El 100% de las estancias activas (con check-in y sin check-out) exponen únicamente liquidaciones en estado `Preliminary`, visibles como estimado.
- **CE-008**: El 100% de los intentos de generar una segunda liquidación `Final` para la misma estancia son rechazados, conservando la original.
- **CE-009**: El 100% de las liquidaciones `Preliminary` cuyo check-in fue anulado transicionan a estado `Cancelled`, conservan su registro, y nunca derivan en una liquidación `Final`.
