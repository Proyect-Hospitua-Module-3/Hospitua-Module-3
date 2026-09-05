# Especificación de funcionalidad: Aplicar tarifa dinámica

**Creado**: 2026-09-05

## Objetivos de negocio

- Aplicar a una reserva el valor de hospedaje calculado según la temporada correspondiente.
- Mantener coherencia entre la tarifa mostrada, la tarifa confirmada y la liquidación final.
- Evitar cambios de precio no autorizados y conservar trazabilidad de la tarifa utilizada.

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Aplicar la tarifa calculada a una reserva (Prioridad: P1)

Como agente de recepción, quiero aplicar a una reserva la tarifa dinámica válida para sus fechas y tipo de habitación, para que el importe de hospedaje refleje la temporada correspondiente.

**Por qué esta prioridad**: Aplicar correctamente la tarifa es el vínculo entre el cálculo dinámico y la operación real de reservas y facturación.

**Prueba independiente**: Se puede crear una reserva con una tarifa base y fechas válidas, aplicar la tarifa dinámica y comprobar que el importe de hospedaje de la reserva coincide con el cálculo aprobado.

**Escenarios de aceptación**:

1. **Escenario**: Aplicar tarifa en temporada regular
   - **Dado** que existe una reserva válida y sus noches pertenecen a temporada regular
   - **Cuando** el usuario aplica la tarifa dinámica
   - **Entonces** la reserva recibe la tarifa base vigente para cada noche y el total de hospedaje correspondiente

2. **Escenario**: Aplicar tarifa en temporada alta
   - **Dado** que existe una reserva válida y sus noches pertenecen a un período de temporada alta con una regla vigente
   - **Cuando** el usuario aplica la tarifa dinámica
   - **Entonces** la reserva recibe el valor ajustado por temporada alta, con el detalle de cada noche y el total aplicado

3. **Escenario**: Aplicar una estancia que cruza temporadas
   - **Dado** que la reserva contiene noches de temporada regular y temporada alta
   - **Cuando** el usuario aplica la tarifa dinámica
   - **Entonces** cada noche recibe la regla que corresponde a su fecha y el total aplicado es la suma de los valores nocturnos

---

### Historia de usuario 2 - Confirmar y conservar el precio aplicado (Prioridad: P1)

Como responsable de reservas o facturación, quiero que el precio aplicado quede asociado a la reserva con su contexto, para evitar que cambios posteriores del calendario alteren silenciosamente un valor ya confirmado.

**Por qué esta prioridad**: La reserva debe poder liquidarse con el valor que fue aceptado, incluso si después cambia una regla de temporada.

**Prueba independiente**: Se puede aplicar una tarifa a una reserva, modificar posteriormente el calendario y verificar que el precio confirmado permanezca intacto, salvo que exista un proceso autorizado de recálculo.

**Escenarios de aceptación**:

1. **Escenario**: Congelar una tarifa confirmada
   - **Dado** que la tarifa dinámica fue aplicada y la reserva fue confirmada
   - **Cuando** cambia la configuración de temporada o la tarifa base futura
   - **Entonces** el importe confirmado de la reserva no cambia automáticamente

2. **Escenario**: Consultar el contexto de una tarifa aplicada
   - **Dado** que una reserva tiene una tarifa dinámica aplicada
   - **Cuando** un usuario autorizado revisa la reserva
   - **Entonces** puede identificar las fechas, el tipo de habitación, la tarifa base, la regla, la moneda, el desglose nocturno y la fecha de aplicación

3. **Escenario**: Recalcular antes de confirmar
   - **Dado** que una reserva aún no está confirmada y la configuración vigente cambió
   - **Cuando** el usuario solicita recalcular y aplicar la tarifa
   - **Entonces** el sistema presenta el nuevo resultado y requiere una nueva confirmación antes de reemplazar el importe anterior

---

### Historia de usuario 3 - Aplicar la tarifa a la liquidación sin mezclar conceptos (Prioridad: P2)

Como responsable de facturación, quiero utilizar el valor de hospedaje aplicado como base de liquidación, para calcular por separado impuestos y comisiones del canal de reserva.

**Por qué esta prioridad**: La matriz financiera del proyecto diferencia hospedaje, IVA y comisión OTA; mezclarlos produciría una liquidación incorrecta.

**Prueba independiente**: Se puede aplicar una tarifa a una reserva directa y a una reserva OTA, y comprobar que ambas conserven el mismo concepto de hospedaje mientras la comisión OTA se calcule aparte cuando corresponda.

**Escenarios de aceptación**:

1. **Escenario**: Reserva por canal directo
   - **Dado** que una reserva proviene del canal directo y tiene una tarifa dinámica aplicada
   - **Cuando** se prepara la liquidación
   - **Entonces** se utiliza el valor de hospedaje aplicado y no se descuenta comisión OTA

2. **Escenario**: Reserva proveniente de una OTA
   - **Dado** que una reserva tiene una tarifa dinámica aplicada y un porcentaje de comisión OTA configurado
   - **Cuando** se prepara la liquidación
   - **Entonces** la comisión se calcula separadamente sobre el valor de hospedaje y se conserva visible el importe bruto aplicado

3. **Escenario**: Impuestos separados
   - **Dado** que la legislación y la configuración tributaria determinan un IVA aplicable
   - **Cuando** se prepara la liquidación
   - **Entonces** el impuesto se muestra como concepto separado y no se confunde con el valor base de hospedaje

---

### Historia de usuario 4 - Rechazar la aplicación cuando no es válida (Prioridad: P1)

Como agente de recepción, quiero recibir un motivo claro cuando no sea posible aplicar la tarifa, para corregir la reserva o solicitar una revisión antes de confirmar el cobro.

**Por qué esta prioridad**: Aplicar una tarifa incompleta o desactualizada puede generar cobros incorrectos y comprometer la trazabilidad financiera.

**Prueba independiente**: Se puede intentar aplicar una tarifa con fechas inválidas, una configuración de temporada inconsistente o una reserva ya confirmada con un precio incompatible, y verificar que el sistema no modifique el importe.

**Escenarios de aceptación**:

1. **Escenario**: Cálculo no válido
   - **Dado** que la tarifa no puede calcularse por datos faltantes, regla incompleta o períodos solapados
   - **Cuando** el usuario intenta aplicarla
   - **Entonces** el sistema rechaza la operación, explica el motivo y conserva el importe anterior

2. **Escenario**: Reserva sin datos suficientes
   - **Dado** que la reserva no tiene tipo de habitación, fechas o moneda requeridos
   - **Cuando** el usuario intenta aplicar la tarifa
   - **Entonces** el sistema solicita corregir los datos y no registra una tarifa parcial

3. **Escenario**: Intento de modificación no autorizado
   - **Dado** que la tarifa de la reserva ya está confirmada o el usuario no tiene permisos suficientes
   - **Cuando** intenta reemplazar el precio aplicado
   - **Entonces** el sistema rechaza el cambio, conserva el valor confirmado y registra el intento según la política de auditoría

### Casos límite

- La reserva tiene una sola noche: debe aplicarse la tarifa cuando las fechas formen un rango válido.
- La fecha de salida coincide con el inicio de una nueva temporada: la noche de salida no debe recibir tarifa.
- El calendario cambia entre la consulta y la aplicación: el sistema debe indicar si aplica el cálculo vigente o exige recalcular.
- La tarifa calculada está vencida o no corresponde a la configuración actual: no debe aplicarse como definitiva sin confirmación de la política vigente.
- La reserva cruza períodos con diferentes monedas: debe rechazarse o resolverse mediante una regla de conversión explícita.
- La tarifa base o el ajuste dinámico produce un valor negativo o inválido: la aplicación debe rechazarse.
- La reserva fue confirmada con una tarifa y posteriormente cambia la temporada: el precio confirmado no debe variar automáticamente.
- La reserva es cancelada, cerrada o ya liquidada: debe definirse si se permite reaplicar o corregir la tarifa.
- El canal de reserva no está identificado: el sistema debe aplicar el hospedaje sin calcular una comisión OTA hasta resolver el canal.
- Faltan impuestos o reglas de comisión: deben permanecer como conceptos pendientes, sin alterar silenciosamente el hospedaje aplicado.
- La habitación está ocupada o en mantenimiento: aplicar la tarifa no debe modificar el estado físico ni la disponibilidad.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir que un usuario autorizado o un proceso autorizado aplique una tarifa dinámica válida a una reserva.
- **FR-002**: El sistema DEBE validar que la reserva tenga tipo de habitación, fechas de entrada y salida válidas, moneda y contexto tarifario requerido antes de aplicar una tarifa.
- **FR-003**: El sistema DEBE utilizar un cálculo válido basado en las fechas de la reserva, el tipo de habitación, el calendario activo, la tarifa base y la regla dinámica.
- **FR-004**: El sistema DEBE aplicar la tarifa de forma independiente a cada noche facturable desde la entrada, inclusive, hasta la salida, sin incluirla.
- **FR-005**: El sistema DEBE almacenar el importe de hospedaje aplicado y el desglose nocturno asociado a la reserva.
- **FR-006**: El sistema DEBE identificar la tarifa base, la temporada, la regla dinámica, la moneda, el contexto de vigencia y el momento del cálculo utilizado.
- **FR-007**: El sistema DEBE exigir confirmación explícita antes de reemplazar un importe de hospedaje no confirmado por un importe recalculado.
- **FR-008**: El sistema DEBE conservar el importe de hospedaje confirmado cuando cambie la configuración tarifaria después de confirmar la reserva.
- **FR-009**: El sistema DEBE rechazar la aplicación cuando el cálculo sea inválido, incompleto, esté vencido, sea contradictorio o no pueda rastrearse hasta una configuración válida.
- **FR-010**: El sistema DEBE dejar sin cambios el importe anterior cuando se rechace un intento de aplicación.
- **FR-011**: El sistema DEBE proporcionar un error accionable que identifique el dato de reserva, dato tarifario o permiso que impide la aplicación.
- **FR-012**: El sistema DEBE distinguir el importe de hospedaje de los impuestos y las comisiones OTA.
- **FR-013**: El sistema DEBE utilizar el importe de hospedaje aplicado como base de la comisión OTA cuando el canal de reserva lo requiera.
- **FR-014**: El sistema DEBE calcular y mostrar los impuestos aplicables como conceptos separados según las reglas legales y de negocio configuradas.
- **FR-015**: El sistema DEBE conservar el importe bruto de hospedaje antes de descontar la comisión OTA para la liquidación y la auditoría.
- **FR-016**: El sistema DEBE registrar quién o qué proceso aplicó, reemplazó, confirmó o rechazó una tarifa y cuándo ocurrió el evento.
- **FR-017**: El sistema DEBE conservar el historial de las tarifas aplicadas anteriormente y los motivos de reemplazo cuando este sea autorizado.
- **FR-018**: El sistema NO DEBE cambiar la disponibilidad, el estado de la reserva, el registro de entrada ni el estado físico de la habitación por el solo hecho de aplicar una tarifa.
- **FR-019**: El sistema DEBE impedir que usuarios no autorizados apliquen o reemplacen una tarifa confirmada.
- **FR-020**: El sistema DEBE mantener estable una tarifa confirmada para la liquidación final, salvo que un proceso de corrección autorizado la modifique explícitamente.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Reserva**: Estancia asociada a un tipo de habitación, fechas, canal, estado y valores económicos.
- **Tarifa aplicada**: Valor de hospedaje aceptado para una reserva, con su desglose y contexto de cálculo.
- **Detalle nocturno aplicado**: Registro del valor correspondiente a cada noche de la reserva.
- **Cálculo de tarifa**: Resultado válido utilizado como fuente para aplicar el importe a la reserva.
- **Canal de reserva**: Origen directo u OTA utilizado para determinar la comisión aplicable.
- **Impuesto**: Concepto separado calculado sobre la base que determine la normativa y configuración vigente.
- **Comisión OTA**: Descuento asociado a una reserva proveniente de un intermediario y calculado separadamente del hospedaje bruto.
- **Historial de tarifa**: Registro de aplicaciones, reemplazos, confirmaciones, usuarios, fechas y motivos.

### Reglas de negocio

- **BR-001**: Solo puede aplicarse una tarifa dinámica calculada con fechas y configuración compatibles con la reserva.
- **BR-002**: El importe de hospedaje aplicado es la suma de los valores de las noches incluidas en la reserva.
- **BR-003**: La fecha de salida no se incluye en el cálculo de noches y no genera un cobro adicional.
- **BR-004**: Una tarifa confirmada no cambia automáticamente por modificaciones posteriores del calendario o de la tarifa base.
- **BR-005**: Todo reemplazo de una tarifa no confirmada debe requerir confirmación explícita y conservar el valor anterior en el historial.
- **BR-006**: Las comisiones OTA se descuentan del hospedaje bruto aplicado y no forman parte de la tarifa dinámica de hospedaje.
- **BR-007**: Los impuestos se calculan y muestran como conceptos separados según la regla tributaria aplicable.
- **BR-008**: Un error durante la aplicación debe ser atómico: no debe guardar un desglose parcial ni modificar el importe anterior.
- **BR-009**: La aplicación de la tarifa no confirma por sí sola disponibilidad, pago, registro de entrada ni estado físico de la habitación.
- **BR-010**: Las correcciones posteriores a la confirmación deben estar restringidas a usuarios o procesos autorizados y deben quedar auditadas.

### Preguntas abiertas

- **OQ-001**: [REQUIERE ACLARACIÓN: definir en qué momento del flujo se aplica y se confirma la tarifa, por ejemplo, al crear la reserva, al confirmar el pago o al realizar el registro de entrada].
- **OQ-002**: [REQUIERE ACLARACIÓN: definir si el precio confirmado puede cambiar por solicitud del huésped, cambio de fechas o modificación de habitación].
- **OQ-003**: [REQUIERE ACLARACIÓN: definir la política de recálculo cuando cambia el calendario entre la consulta y la confirmación].
- **OQ-004**: [REQUIERE ACLARACIÓN: definir la fórmula y base exacta para calcular la comisión de cada OTA].
- **OQ-005**: [REQUIERE ACLARACIÓN: definir si los impuestos se aplican al hospedaje, a todos los servicios o a una base diferenciada].
- **OQ-006**: [REQUIERE ACLARACIÓN: definir los roles autorizados para aplicar, confirmar y corregir tarifas].
- **OQ-007**: [REQUIERE ACLARACIÓN: definir la política para reaplicar tarifas en reservas canceladas, cerradas o ya liquidadas].
- **OQ-008**: [REQUIERE ACLARACIÓN: definir la vigencia máxima de un cálculo entre su generación y su aplicación].

## Requisitos no funcionales

- **NFR-001**: La aplicación de una tarifa válida debe completarse en un tiempo adecuado para el flujo operativo de reservas.
- **NFR-002**: El resultado aplicado debe ser determinista para la misma reserva, configuración vigente y cálculo de origen.
- **NFR-003**: La operación debe ser atómica y no debe dejar importes o detalles nocturnos incompletos.
- **NFR-004**: La información aplicada y su historial deben estar protegidos mediante control de acceso por rol.
- **NFR-005**: Toda aplicación, reemplazo, confirmación o rechazo debe ser auditable y conservar la fecha y el actor responsable.
- **NFR-006**: El sistema debe mantener precisión monetaria conforme a la moneda y política de redondeo configuradas.
- **NFR-007**: La operación no debe exponer datos personales innecesarios ni alterar estados operativos no relacionados con el precio.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las reservas con configuración válida recibe un importe de hospedaje igual al cálculo aprobado para sus noches.
- **SC-002**: El 100% de los importes aplicados conserva el desglose nocturno, la regla dinámica, la moneda y el contexto de vigencia utilizados.
- **SC-003**: El 100% de los intentos con datos incompletos, cálculo inválido o permisos insuficientes se rechaza sin modificar el importe anterior.
- **SC-004**: El 100% de las tarifas confirmadas permanece estable ante cambios posteriores del calendario, salvo corrección autorizada y auditada.
- **SC-005**: El 100% de las liquidaciones distingue el hospedaje bruto aplicado, la comisión OTA y los impuestos correspondientes.
- **SC-006**: El 100% de los reemplazos autorizados conserva la tarifa anterior, el nuevo valor, el actor, la fecha y el motivo registrado.
- **SC-007**: Ninguna aplicación de tarifa altera por sí sola la disponibilidad, reserva, registro de entrada o estado físico de la habitación.
- **SC-008**: Al menos el 95% de los usuarios autorizados puede aplicar una tarifa válida en su primer intento durante una prueba de aceptación.
