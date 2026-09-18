# Especificación de funcionalidad: Generar liquidación

**Creado**: 2026-09-15

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Generar la liquidación `Final` al registrar el check-out (Prioridad: P1)

Como sistema de gestión hotelera, quiero generar la liquidación `Final` de una estancia en el momento en que se registra el check-out, para obtener el ingreso neto de hospedaje que servirá de base para la facturación.

**Por qué esta prioridad**: El check-out es el único evento que dispara este caso de uso según el diagrama vigente; sin una liquidación `Final` en ese instante no existe ningún valor confiable para facturar ni para conciliar con la OTA.

**Prueba independiente**: Se puede registrar un check-out de una reserva cuyo evento incluya el valor de hospedaje ya calculado y el canal de origen, y verificar que el sistema entregue una liquidación con estado `Final` y el ingreso neto correspondiente.

**Escenarios de aceptación**:

1. **Escenario**: Check-out de una reserva de canal directo
   - **Dado** que el evento de check-out reporta que la reserva no proviene de un intermediario y trae el valor de hospedaje ya calculado
   - **Cuando** se registra el check-out de la estancia
   - **Entonces** el sistema genera una liquidación `Final` cuyo ingreso neto es igual al valor de hospedaje, sin ningún descuento de comisión

2. **Escenario**: Liquidación `Final` no se recalcula por sí sola
   - **Dado** que ya existe una liquidación `Final` generada para una reserva
   - **Cuando** se vuelve a solicitar la liquidación de esa misma estancia
   - **Entonces** el sistema devuelve la liquidación `Final` ya existente, sin generar una nueva ni modificarla

3. **Escenario**: Reenvío del evento de check-out
   - **Dado** que el check-out de una estancia ya generó una liquidación `Final`
   - **Cuando** Módulo 1 reenvía el mismo evento de check-out (por ejemplo, por un reintento de red)
   - **Entonces** el sistema responde de forma idempotente devolviendo la liquidación `Final` existente, sin crear un duplicado

---

### Historia de usuario 2 - Aplicar el descuento de comisión cuando la reserva proviene de una OTA (Prioridad: P1)

Como responsable de facturación, quiero que el sistema aplique automáticamente el descuento de comisión de la OTA correspondiente al generar la liquidación, para que el ingreso neto refleje correctamente lo que el hotel realmente recibe.

**Por qué esta prioridad**: Un descuento de comisión mal aplicado (o no aplicado) distorsiona directamente el ingreso neto y la conciliación financiera con cada intermediario.

**Prueba independiente**: Se puede registrar el check-out de una reserva marcada con un canal OTA y un porcentaje de comisión reportado en el propio evento de check-out, y verificar que el ingreso neto excluya exactamente ese porcentaje del valor de hospedaje.

**Escenarios de aceptación**:

1. **Escenario**: Reserva con intermediario y comisión reportada en el check-out
   - **Dado** que el evento de check-out identifica un canal OTA con un porcentaje de comisión pactado
   - **Cuando** el sistema genera la liquidación
   - **Entonces** descuenta del valor de hospedaje exactamente ese porcentaje y reporta el valor de la comisión por separado

2. **Escenario**: Reserva de canal directo
   - **Dado** que la reserva se originó por recepción, teléfono, portal propio, o no tiene un canal de origen registrado
   - **Cuando** el sistema genera la liquidación
   - **Entonces** trata la reserva como canal directo, no aplica ningún descuento de comisión, y el ingreso neto es igual al valor de hospedaje

3. **Escenario**: Reserva con intermediario sin porcentaje de comisión reportado
   - **Dado** que el evento de check-out identifica un canal OTA pero no trae un porcentaje de comisión válido
   - **Cuando** el sistema intenta generar la liquidación
   - **Entonces** rechaza la generación y no asume un porcentaje de comisión por defecto

---

### Historia de usuario 3 - Impedir que exista liquidación antes del check-out o más de una por estancia (Prioridad: P2)

Como sistema de gestión hotelera, quiero garantizar que ninguna estancia tenga una liquidación antes de que se registre su check-out, y que nunca exista más de una liquidación `Final` para la misma estancia, para que el estado financiero de cada estancia sea siempre inequívoco.

**Por qué esta prioridad**: Complementa a HU1 dando integridad al modelo (sin liquidaciones prematuras ni duplicadas); no es la vía principal de valor, pero previene errores de conciliación graves si se omitiera.

**Prueba independiente**: Se puede consultar el estado de liquidación de una estancia antes de su check-out y verificar que no existe ninguna, y luego intentar generar una segunda liquidación tras un check-out ya procesado y verificar que el sistema la rechaza conservando la original.

**Escenarios de aceptación**:

1. **Escenario**: Estancia sin check-out registrado
   - **Dado** que una estancia aún no ha tenido evento de check-out
   - **Cuando** se intenta consultar o generar su liquidación por cualquier vía distinta al check-out
   - **Entonces** el sistema no produce ninguna liquidación para esa estancia

2. **Escenario**: Intento de segunda liquidación para la misma estancia
   - **Dado** que ya existe una liquidación `Final` para una estancia
   - **Cuando** se procesa un nuevo intento de generación para esa misma estancia que no corresponde a un reenvío idéntico del mismo check-out
   - **Entonces** el sistema rechaza la operación y conserva la liquidación `Final` original sin alterarla

### Casos límite

- La estancia fue cancelada en Módulo 2 antes de llegar al check-out: `Registrar Check-out` nunca se ejecuta para esa estancia, por lo que `Generar liquidación` tampoco se ejecuta y no debe existir ningún registro de liquidación.
- El evento de check-out no trae el valor de hospedaje calculado, o llega en cero: la liquidación no debe generarse con un ingreso neto parcial o inventado.
- El porcentaje de comisión OTA reportado en el evento de check-out es inválido (negativo o mayor al 100%): el sistema rechaza la generación de la liquidación y no sustituye el valor inválido por una comisión estimada.
- La reserva no tiene un canal de origen registrado: el sistema asume canal directo y no aplica comisión.
- Se intenta generar más de una liquidación `Final` para la misma estancia con datos distintos al check-out original: el sistema debe impedirlo y conservar la liquidación `Final` original.
- La fecha real de salida difiere de la fecha de salida programada (salida anticipada o extensión de estancia): el valor de hospedaje recibido en el evento de check-out ya corresponde a las noches efectivamente transcurridas; el sistema no debe recalcularlo por su cuenta ni cuestionar esa diferencia.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE generar la liquidación de una estancia únicamente cuando sea invocado (`<<include>>`) por `Registrar Check-out`; ningún otro caso de uso ni actor externo puede invocarlo directamente, y sin que ese evento haya ocurrido no debe existir liquidación para la estancia.
- **FR-002**: El sistema DEBE recibir, como parte del evento de check-out emitido por Módulo 1, el valor de hospedaje ya calculado (sobre las noches efectivamente transcurridas) y el canal de origen de la reserva; `Generar liquidación` no calcula ni recalcula la tarifa dinámica por su cuenta, dado que esa responsabilidad no está incluida (`<<include>>`) por este caso de uso en el diagrama vigente.
- **FR-003**: El sistema DEBE identificar el canal de origen de la reserva (directo o intermediario OTA) a partir del evento de check-out, antes de determinar si corresponde un descuento de comisión.
- **FR-004**: El sistema DEBE asumir canal directo cuando el evento de check-out no reporte un canal de origen.
- **FR-005**: El sistema DEBE obtener el porcentaje de comisión pactado directamente del evento de check-out emitido por Módulo 1 cuando el canal de origen sea un intermediario OTA; el sistema no mantiene una tabla propia de convenios de comisión por OTA ni invoca un caso de uso de consulta independiente para obtenerlo.
- **FR-006**: El sistema DEBE descontar del valor de hospedaje la comisión correspondiente cuando la reserva provenga de un intermediario OTA con un porcentaje válido reportado.
- **FR-007**: El sistema NO DEBE aplicar ningún descuento de comisión cuando la reserva sea de canal directo o no tenga canal de origen registrado.
- **FR-008**: El sistema DEBE calcular el ingreso neto de la liquidación como el valor de hospedaje menos la comisión OTA aplicable, cuando corresponda.
- **FR-009**: El sistema DEBE generar la liquidación con estado `Final` desde su creación; el sistema no produce ningún estado intermedio o preliminar, dado que solo se genera en el check-out.
- **FR-010**: El sistema DEBE mantener una única liquidación `Final` por estancia; no debe generar una segunda liquidación `Final` para la misma estancia.
- **FR-011**: El sistema DEBE responder de forma idempotente ante un reenvío del mismo evento de check-out, devolviendo la liquidación `Final` ya generada sin crear un duplicado ni recalcularla.
- **FR-012**: El sistema DEBE entregar un desglose de la liquidación que incluya el valor de hospedaje, el canal de origen, el porcentaje y valor de la comisión OTA (si aplica), y el ingreso neto resultante.
- **FR-013**: El sistema NO DEBE incluir el Impuesto al Valor Agregado (IVA) dentro del ingreso neto de la liquidación.
- **FR-014**: El sistema DEBE rechazar la generación de la liquidación cuando falte el valor de hospedaje o el porcentaje de comisión requerido para un canal OTA en el evento de check-out.
- **FR-015**: El sistema DEBE devolver un motivo identificable y accionable cuando rechace la generación de una liquidación.
- **FR-016**: El sistema DEBE identificar la reserva, el tipo de habitación, las fechas de la estancia y el canal de origen asociados a cada liquidación generada.
- **FR-017**: El sistema DEBE permitir consultar posteriormente una liquidación ya generada sin recalcularla, para que su valor pueda reutilizarse en la generación de la factura final.
- **FR-018**: El sistema NO DEBE modificar el estado de disponibilidad, ocupación o bloqueo de la habitación como efecto de generar una liquidación.
- **FR-019**: El sistema DEBE invocar obligatoriamente (`<<include>>`) el caso de uso `Generar factura final` como parte de la generación de cada liquidación, produciendo la factura fiscal definitiva asociada.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Liquidación**: Resultado del proceso de liquidación de una estancia; existe únicamente con estado `Final`, e incluye valor de hospedaje, comisión OTA aplicada (si corresponde), ingreso neto, y la factura definitiva asociada generada mediante el include obligatorio a `Generar factura final`.
- **Estancia/Reserva**: Registro identificado por el evento de check-out, con tipo de habitación y canal de origen.
- **Canal de origen**: Clasificación de la reserva como directo o como intermediario OTA, con su código de confirmación externo cuando aplica; reportado en el evento de check-out.
- **Comisión OTA**: Porcentaje pactado con un intermediario, suministrado por Módulo 1 como parte del evento de check-out.
- **Valor de hospedaje**: Monto ya calculado (sobre las noches efectivamente transcurridas) que llega como dato de entrada en el evento de check-out; `Generar liquidación` lo usa como base sin recalcularlo.
- **Ingreso neto**: Valor de hospedaje menos la comisión OTA aplicable, sin incluir impuestos.
- **Detalle de liquidación**: Desglose que identifica el valor de hospedaje, el canal, la comisión aplicada y el ingreso neto de una liquidación específica.

### Reglas de negocio

- **BR-001**: La liquidación solo puede generarse a partir del registro del check-out; no existe liquidación (ni siquiera parcial o estimada) para una estancia que aún no ha tenido check-out.
- **BR-002**: El ingreso neto de la liquidación es igual al valor de hospedaje recibido en el evento de check-out, menos la comisión OTA cuando la reserva proviene de un intermediario.
- **BR-003**: La comisión OTA solo se descuenta cuando el canal de la reserva es un intermediario y el evento de check-out reporta un porcentaje válido; en canal directo, o sin canal registrado, la comisión es siempre cero.
- **BR-004**: El valor de hospedaje usado en la liquidación es el reportado en el evento de check-out; la liquidación no recalcula la tarifa dinámica por su cuenta, dado que ese cálculo no está incluido en este caso de uso conforme al diagrama vigente.
- **BR-005**: El Impuesto al Valor Agregado y otros impuestos no forman parte del ingreso neto de la liquidación; se gestionan en la generación de la factura final.
- **BR-006**: Debe existir una única liquidación `Final` por estancia; el sistema no genera una segunda liquidación para la misma estancia.
- **BR-007**: Un dato obligatorio faltante o inconsistente en el evento de check-out debe detener la generación de la liquidación, sin producir un ingreso neto estimado o parcial.
- **BR-008**: La disponibilidad, ocupación o bloqueo de la habitación no forma parte de la liquidación y no se modifica al generarla.
- **BR-009**: Toda liquidación generada incluye (`<<include>>`) obligatoriamente a `Generar factura final`; no existe una liquidación `Final` sin su factura fiscal definitiva asociada.
- **BR-010**: El canal de origen y el porcentaje de comisión de la reserva son los reportados por Módulo 1 en el evento de check-out; Módulo 3 no los gestiona, corrige ni vuelve a consultar de forma independiente, ya que esa información es propiedad de los módulos de origen.

## Requisitos no funcionales

- **NFR-001**: La generación de la liquidación debe ser determinista: el mismo evento de check-out, con los mismos datos, debe producir siempre el mismo resultado.
- **NFR-002**: La liquidación `Final` debe generarse en un tiempo adecuado durante el proceso de check-out, sin introducir esperas perceptibles para recepción.
- **NFR-003**: Cada liquidación generada debe quedar trazable, identificando la reserva, la fecha de generación y los datos utilizados para el cálculo.
- **NFR-004**: La exactitud monetaria de la liquidación debe ser consistente con la precisión y el redondeo del valor de hospedaje recibido en el evento de check-out.
- **NFR-005**: Los mensajes de error o rechazo deben ser comprensibles para el personal de recepción y facturación, y suficientemente específicos para corregir la causa.
- **NFR-006**: El resultado de la liquidación no debe exponer información personal del huésped que no sea necesaria para el proceso financiero.
- **NFR-007**: La solución debe mantener la integridad referencial entre la reserva, el valor de hospedaje recibido y la comisión aplicada en cada liquidación.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los check-out registrados generan una liquidación `Final` antes de habilitar la generación de la factura final.
- **SC-002**: El 100% de las liquidaciones de reservas con canal OTA reflejan el descuento de comisión con el mismo porcentaje reportado en el evento de check-out.
- **SC-003**: El 100% de las liquidaciones de reservas de canal directo, o sin canal registrado, no presentan ningún descuento de comisión.
- **SC-004**: El 100% de los intentos de generar una liquidación con el valor de hospedaje o el porcentaje de comisión faltantes o inválidos se rechazan sin producir un ingreso neto.
- **SC-005**: El ingreso neto de la liquidación `Final` coincide con el valor reutilizado posteriormente en la factura final en el 100% de los casos.
- **SC-006**: Ninguna generación de liquidación modifica el estado de disponibilidad, ocupación o bloqueo de una habitación.
- **SC-007**: El 100% de las estancias sin check-out registrado no presentan ninguna liquidación.
- **SC-008**: El 100% de los intentos de generar una segunda liquidación `Final` para la misma estancia son rechazados, conservando la original.
- **SC-009**: El 100% de los reenvíos del mismo evento de check-out devuelven la liquidación `Final` existente sin duplicarla.
