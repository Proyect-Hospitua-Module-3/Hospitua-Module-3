# Especificación de funcionalidad: Generar liquidación

**Creado**: 2026-09-15  
**Actualizado**: 2026-10-07 (valor de hospedaje desde la cotización guardada; canal, OTA y comisión desde Módulo 2; una liquidación por habitación)

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Generar la liquidación `Final` al registrar el check-out (Prioridad: P1)

Como sistema de gestión hotelera, quiero generar la liquidación `Final` de la estancia de cada habitación en el momento en que se registra su check-out, para obtener el ingreso neto de hospedaje que servirá de base para la facturación.

**Por qué esta prioridad**: El check-out es el único evento que dispara este caso de uso según el diagrama vigente; sin una liquidación `Final` en ese instante no existe ningún valor confiable para facturar ni para conciliar con la OTA.

**Prueba independiente**: Se puede crear una reserva con su cotización de hospedaje, registrar el check-out de una de sus habitaciones y verificar que el sistema entregue una liquidación con estado `Final` cuyo valor de hospedaje es el de la cotización guardada y cuyo ingreso neto corresponde al canal informado por Módulo 2.

**Escenarios de aceptación**:

1. **Escenario**: Check-out de una reserva de canal directo
   - **Dado** que Módulo 2 informa que la reserva es de canal directo y la reserva tiene guardada la cotización del hospedaje para el tipo de habitación del check-out
   - **Cuando** se registra el check-out de esa habitación
   - **Entonces** el sistema genera una liquidación `Final` cuyo ingreso neto es igual al valor de hospedaje de la cotización, sin ningún descuento de comisión

2. **Escenario**: Reserva con varias habitaciones
   - **Dado** que una reserva incluye varias habitaciones, cada una con su propia cotización
   - **Cuando** se registra el check-out de cada habitación
   - **Entonces** el sistema genera una liquidación `Final` independiente por cada habitación, usando la cotización que corresponde a su tipo de habitación

3. **Escenario**: Liquidación `Final` no se recalcula por sí sola
   - **Dado** que ya existe una liquidación `Final` generada para la estancia de una habitación
   - **Cuando** se vuelve a solicitar la liquidación de esa misma estancia
   - **Entonces** el sistema devuelve la liquidación `Final` ya existente, sin generar una nueva ni modificarla

4. **Escenario**: Reenvío del evento de check-out
   - **Dado** que el check-out de una estancia ya generó una liquidación `Final`
   - **Cuando** Módulo 1 reenvía el mismo evento de check-out (por ejemplo, por un reintento de red)
   - **Entonces** el sistema responde de forma idempotente devolviendo la liquidación `Final` existente, sin crear un duplicado

5. **Escenario**: Reserva o cotización inexistente
   - **Dado** que Módulo 2 responde que la reserva no existe, o que la reserva no tiene una cotización para el tipo de habitación del check-out
   - **Cuando** el sistema intenta generar la liquidación
   - **Entonces** rechaza la generación con un motivo específico y no produce ningún ingreso neto

6. **Escenario**: Módulo 2 no responde
   - **Dado** que Módulo 2 no está disponible al momento de consultar la reserva
   - **Cuando** el sistema intenta generar la liquidación
   - **Entonces** no genera la liquidación con datos supuestos y la reintenta cuando Módulo 2 vuelva a responder

---

### Historia de usuario 2 - Aplicar el descuento de comisión cuando la reserva proviene de una OTA (Prioridad: P1)

Como responsable de facturación, quiero que el sistema aplique automáticamente el descuento de comisión de la OTA correspondiente al generar la liquidación, para que el ingreso neto refleje correctamente lo que el hotel realmente recibe.

**Por qué esta prioridad**: Un descuento de comisión mal aplicado (o no aplicado) distorsiona directamente el ingreso neto y la conciliación financiera con cada intermediario.

**Prueba independiente**: Se puede registrar el check-out de una habitación cuya reserva, según Módulo 2, es de canal OTA con un porcentaje de comisión conocido, y verificar que el ingreso neto excluya exactamente ese porcentaje del valor de hospedaje de la cotización.

**Escenarios de aceptación**:

1. **Escenario**: Reserva con intermediario y comisión suministrada por Módulo 2
   - **Dado** que Módulo 2 informa que la reserva es de canal OTA e incluye la OTA, su código de confirmación y el porcentaje de comisión pactado
   - **Cuando** el sistema genera la liquidación
   - **Entonces** descuenta del valor de hospedaje exactamente ese porcentaje y reporta el valor de la comisión por separado

2. **Escenario**: Reserva de canal directo
   - **Dado** que Módulo 2 informa que la reserva se originó por recepción, teléfono, portal propio, o no informa un canal de origen
   - **Cuando** el sistema genera la liquidación
   - **Entonces** trata la reserva como canal directo, no aplica ningún descuento de comisión, y el ingreso neto es igual al valor de hospedaje

3. **Escenario**: Reserva con intermediario sin porcentaje de comisión suministrado
   - **Dado** que Módulo 2 informa que la reserva es de canal OTA pero no suministra un porcentaje de comisión válido
   - **Cuando** el sistema intenta generar la liquidación
   - **Entonces** rechaza la generación y no asume un porcentaje de comisión por defecto

---

### Historia de usuario 3 - Impedir que exista liquidación antes del check-out o más de una por estancia (Prioridad: P2)

Como sistema de gestión hotelera, quiero garantizar que ninguna estancia tenga una liquidación `Final` antes de que se registre su check-out, y que nunca exista más de una liquidación `Final` para la misma estancia, para que el estado financiero de cada estancia sea siempre inequívoco.

**Por qué esta prioridad**: Complementa a HU1 dando integridad al modelo (sin liquidaciones prematuras ni duplicadas); no es la vía principal de valor, pero previene errores de conciliación graves si se omitiera.

**Prueba independiente**: Se puede verificar que antes del check-out de una estancia no existe ninguna liquidación `Final` guardada para ella, y luego intentar generar una segunda liquidación tras un check-out ya procesado y verificar que el sistema la rechaza conservando la original.

**Escenarios de aceptación**:

1. **Escenario**: Estancia sin check-out registrado
   - **Dado** que una estancia aún no ha tenido evento de check-out
   - **Cuando** se intenta generar su liquidación por cualquier vía distinta al check-out
   - **Entonces** el sistema no genera ni guarda ninguna liquidación `Final` para esa estancia

2. **Escenario**: Intento de segunda liquidación para la misma estancia
   - **Dado** que ya existe una liquidación `Final` para una estancia
   - **Cuando** se procesa un nuevo intento de generación para esa misma estancia que no corresponde a un reenvío idéntico del mismo check-out
   - **Entonces** el sistema rechaza la operación y conserva la liquidación `Final` original sin alterarla

### Casos límite

- La estancia fue cancelada en Módulo 2 antes de llegar al check-out: `Registrar Check-out` nunca se ejecuta para esa estancia, por lo que `Generar liquidación` tampoco se ejecuta y no debe existir ningún registro de liquidación.
- La reserva no existe en Módulo 2, o ninguna de sus cotizaciones corresponde al tipo de habitación del check-out: la liquidación no debe generarse con un ingreso neto parcial o inventado.
- La reserva tiene varias cotizaciones del mismo tipo de habitación con el mismo valor (mismo tipo y mismas fechas reservadas): son equivalentes, por lo que se usa cualquiera de ellas.
- Módulo 2 no responde (caída o tiempo de espera agotado): la liquidación no se genera con datos supuestos; el check-out se reintenta hasta que Módulo 2 responda.
- El porcentaje de comisión OTA suministrado por Módulo 2 es inválido (negativo o mayor al 100%): el sistema rechaza la generación de la liquidación y no sustituye el valor inválido por una comisión estimada.
- Módulo 2 no informa un canal de origen para la reserva: el sistema asume canal directo y no aplica comisión.
- Se intenta generar más de una liquidación `Final` para la misma estancia con datos distintos al check-out original: el sistema debe impedirlo y conservar la liquidación `Final` original.
- Cambiaron las reglas de temporada o la tarifa base después de la reserva: la liquidación usa el valor de hospedaje guardado en la cotización (el que el cliente vio al reservar) y no lo recalcula.
- Salida anticipada (la fecha real de salida es anterior a la reservada): la liquidación registra las fechas reales informadas por Módulo 1, pero el valor de hospedaje es el de la cotización guardada, porque es lo que el cliente aceptó al confirmar la reserva. No es una penalización: simplemente no se recalcula.
- Extensión de estancia: se gestiona como un cambio de la reserva en Módulo 2, que solicita a Módulo 3 la cotización de la estancia extendida. Esa cotización conserva el valor de las noches ya cotizadas y agrega las noches nuevas con la tarifa dinámica vigente, y reemplaza a la anterior en la reserva. La liquidación usa la cotización vigente de la reserva y nunca recalcula por su cuenta.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE generar la liquidación `Final` de una estancia únicamente cuando sea invocado (`<<include>>`) por `Registrar Check-out`; ningún otro caso de uso ni actor externo puede generarla directamente, y sin que ese evento haya ocurrido no debe existir liquidación `Final` para la estancia.
- **FR-002**: El sistema DEBE tomar el valor de hospedaje de la cotización guardada al crear la reserva (calculada por Módulo 3 cuando Módulo 2 la solicitó); `Generar liquidación` no calcula ni recalcula la tarifa dinámica por su cuenta, dado que esa responsabilidad no está incluida (`<<include>>`) por este caso de uso en el diagrama vigente.
- **FR-003**: El sistema DEBE identificar el canal de origen de la reserva (directo o intermediario OTA) a partir de la reserva consultada a Módulo 2, antes de determinar si corresponde un descuento de comisión.
- **FR-004**: El sistema DEBE asumir canal directo cuando Módulo 2 no informe un canal de origen para la reserva.
- **FR-005**: El sistema DEBE consultar a Módulo 2 la reserva indicada en el evento de check-out para obtener sus cotizaciones de hospedaje, el canal de origen y, si el canal es OTA, la OTA, su código de confirmación y el porcentaje de comisión pactado; el sistema no mantiene una tabla propia de convenios de comisión por OTA.
- **FR-006**: El sistema DEBE descontar del valor de hospedaje la comisión correspondiente cuando la reserva provenga de un intermediario OTA con un porcentaje válido suministrado por Módulo 2.
- **FR-007**: El sistema NO DEBE aplicar ningún descuento de comisión cuando la reserva sea de canal directo o no tenga canal de origen registrado.
- **FR-008**: El sistema DEBE calcular el ingreso neto de la liquidación como el valor de hospedaje menos la comisión OTA aplicable, cuando corresponda.
- **FR-009**: El sistema DEBE generar la liquidación con estado `Final` desde su creación; el sistema no guarda ningún estado intermedio o preliminar, dado que solo se genera en el check-out.
- **FR-010**: El sistema DEBE mantener una única liquidación `Final` por estancia; no debe generar una segunda liquidación `Final` para la misma estancia.
- **FR-011**: El sistema DEBE responder de forma idempotente ante un reenvío del mismo evento de check-out, devolviendo la liquidación `Final` ya generada sin crear un duplicado ni recalcularla.
- **FR-012**: El sistema DEBE entregar un desglose de la liquidación que incluya el valor de hospedaje, el canal de origen, el porcentaje y valor de la comisión OTA (si aplica), y el ingreso neto resultante.
- **FR-013**: El sistema NO DEBE incluir el Impuesto al Valor Agregado (IVA) dentro del ingreso neto de la liquidación.
- **FR-014**: El sistema DEBE rechazar la generación de la liquidación cuando la reserva no exista en Módulo 2, cuando la reserva no tenga una cotización para el tipo de habitación del check-out, o cuando falte el porcentaje de comisión requerido para un canal OTA.
- **FR-015**: El sistema DEBE devolver un motivo identificable y accionable cuando rechace la generación de una liquidación.
- **FR-016**: El sistema DEBE identificar la reserva, la habitación, el tipo de habitación, las fechas de la estancia y el canal de origen asociados a cada liquidación generada.
- **FR-017**: El sistema DEBE permitir consultar posteriormente una liquidación ya generada sin recalcularla, para que su valor pueda reutilizarse en la generación de la factura final.
- **FR-018**: El sistema NO DEBE modificar el estado de disponibilidad, ocupación o bloqueo de la habitación como efecto de generar una liquidación.
- **FR-019**: El sistema DEBE permitir que `Generar liquidación` sea incluido (`<<include>>`) también por `Generar factura final`, que es el caso de uso que produce la factura fiscal definitiva a partir de la liquidación `Final`; `Generar liquidación` no invoca ni emite la factura por sí mismo.
- **FR-020**: El sistema DEBE generar una liquidación por cada habitación: cuando una reserva incluye varias habitaciones, cada check-out de habitación produce su propia liquidación, usando la cotización cuyo tipo de habitación coincide con el informado por Módulo 1 en el evento.
- **FR-021**: El sistema NO DEBE generar la liquidación cuando Módulo 2 no esté disponible; debe distinguir esa falla de comunicación de una reserva inexistente y permitir que el check-out se procese de nuevo cuando Módulo 2 responda.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Liquidación**: Resultado del proceso de liquidación de la estancia de una habitación; existe únicamente con estado `Final`, e incluye valor de hospedaje, comisión OTA aplicada (si corresponde), ingreso neto; la factura definitiva asociada la produce `Generar factura final`, que incluye (`<<include>>`) esta liquidación.
- **Estancia**: Ocupación de una habitación identificada por el evento de check-out, con su reserva, habitación, tipo de habitación y fechas reales de entrada y salida.
- **Reserva**: Registro administrado por Módulo 2 y consultado por Módulo 3 al generar la liquidación; aporta las cotizaciones de hospedaje, el canal de origen y, si aplica, la OTA, su código de confirmación y la comisión.
- **Cotización de hospedaje**: Valor de hospedaje de una habitación (tarifa por noche y total) calculado y guardado por Módulo 3 cuando Módulo 2 crea la reserva; es la fuente del valor de hospedaje de la liquidación.
- **Canal de origen**: Clasificación de la reserva como directo o como intermediario OTA, con su código de confirmación externo cuando aplica; informado por Módulo 2.
- **Comisión OTA**: Porcentaje pactado con un intermediario, suministrado por Módulo 2.
- **Valor de hospedaje**: Monto de la cotización guardada de la habitación; `Generar liquidación` lo usa como base sin recalcularlo.
- **Ingreso neto**: Valor de hospedaje menos la comisión OTA aplicable, sin incluir impuestos.
- **Detalle de liquidación**: Desglose que identifica el valor de hospedaje, el canal, la comisión aplicada y el ingreso neto de una liquidación específica.

### Reglas de negocio

- **BR-001**: La liquidación `Final` solo puede generarse a partir del registro del check-out; no se guarda ninguna liquidación (ni siquiera parcial o estimada) para una estancia que aún no ha tenido check-out.
- **BR-002**: El ingreso neto de la liquidación es igual al valor de hospedaje de la cotización guardada, menos la comisión OTA cuando la reserva proviene de un intermediario.
- **BR-003**: La comisión OTA solo se descuenta cuando el canal de la reserva es un intermediario y Módulo 2 suministra un porcentaje válido; en canal directo, o sin canal registrado, la comisión es siempre cero.
- **BR-004**: El valor de hospedaje usado en la liquidación es el de la cotización guardada al reservar, que es el valor que el cliente vio antes de confirmar; la liquidación no recalcula la tarifa dinámica por su cuenta, aunque hayan cambiado las reglas de temporada o la tarifa base. Una salida anticipada no cambia ese valor; una extensión de estancia solo lo cambia mediante una nueva cotización solicitada por Módulo 2 al modificar la reserva.
- **BR-005**: El Impuesto al Valor Agregado y otros impuestos no forman parte del ingreso neto de la liquidación; se gestionan en la generación de la factura final.
- **BR-006**: Debe existir una única liquidación `Final` por estancia; el sistema no genera una segunda liquidación para la misma estancia.
- **BR-007**: Un dato obligatorio faltante o inconsistente en el evento de check-out, o una reserva o cotización inexistente, debe detener la generación de la liquidación, sin producir un ingreso neto estimado o parcial.
- **BR-008**: La disponibilidad, ocupación o bloqueo de la habitación no forma parte de la liquidación y no se modifica al generarla.
- **BR-009**: `Generar liquidación` es un caso de uso incluido (`<<include>>`) tanto por `Registrar Check-out` como por `Generar factura final`; la liquidación no incluye ni invoca a `Generar factura final`, sino que este último la reutiliza para emitir la factura definitiva.
- **BR-010**: El canal de origen, los datos de la OTA y el porcentaje de comisión los suministra Módulo 2 en la reserva; Módulo 1 informa en el evento de check-out la reserva, la habitación, su tipo y las fechas reales. Módulo 3 no gestiona ni corrige estos datos.
- **BR-011**: La liquidación es por habitación: cada habitación de una reserva tiene su propia liquidación `Final`, calculada con la cotización de su tipo de habitación.

## Requisitos no funcionales

- **NFR-001**: La generación de la liquidación debe ser determinista: el mismo evento de check-out, con la misma reserva y la misma cotización guardada, debe producir siempre el mismo resultado.
- **NFR-002**: La liquidación `Final` debe generarse en un tiempo adecuado durante el proceso de check-out, sin introducir esperas perceptibles para recepción.
- **NFR-003**: Cada liquidación generada debe quedar trazable, identificando la reserva, la habitación, la cotización usada, la fecha de generación y los datos utilizados para el cálculo.
- **NFR-004**: La exactitud monetaria de la liquidación debe ser consistente con la precisión, el redondeo y la moneda del valor de hospedaje de la cotización guardada.
- **NFR-005**: Los mensajes de error o rechazo deben ser comprensibles para el personal de recepción y facturación, y suficientemente específicos para corregir la causa.
- **NFR-006**: El resultado de la liquidación no debe exponer información personal del huésped que no sea necesaria para el proceso financiero.
- **NFR-007**: La solución debe mantener la integridad referencial entre la reserva, la cotización de hospedaje usada y la comisión aplicada en cada liquidación.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los check-out registrados generan una liquidación `Final` antes de habilitar la generación de la factura final.
- **SC-002**: El 100% de las liquidaciones de reservas con canal OTA reflejan el descuento de comisión con el mismo porcentaje suministrado por Módulo 2.
- **SC-003**: El 100% de las liquidaciones de reservas de canal directo, o sin canal registrado, no presentan ningún descuento de comisión.
- **SC-004**: El 100% de los intentos de generar una liquidación sin reserva, sin cotización para el tipo de habitación, o con el porcentaje de comisión faltante o inválido se rechazan sin producir un ingreso neto.
- **SC-005**: El ingreso neto de la liquidación `Final` coincide con el valor reutilizado posteriormente en la factura final en el 100% de los casos.
- **SC-006**: Ninguna generación de liquidación modifica el estado de disponibilidad, ocupación o bloqueo de una habitación.
- **SC-007**: El 100% de las estancias sin check-out registrado no presentan ninguna liquidación `Final` guardada.
- **SC-008**: El 100% de los intentos de generar una segunda liquidación `Final` para la misma estancia son rechazados, conservando la original.
- **SC-009**: El 100% de los reenvíos del mismo evento de check-out devuelven la liquidación `Final` existente sin duplicarla.
- **SC-010**: El 100% de las liquidaciones usan como valor de hospedaje el de la cotización guardada al reservar, aunque las reglas de temporada o la tarifa base hayan cambiado después.
- **SC-011**: El 100% de las reservas con varias habitaciones generan una liquidación `Final` por cada habitación con check-out registrado.
