# Especificación de funcionalidad: Consultar porcentaje de comisión OTA

**Creado**: 2026-09-18

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Módulo 2 revisa el porcentaje histórico antes de reportar un nuevo check-out (Prioridad: P1)

Como Módulo 2 (módulo de reservas), quiero consultar el porcentaje de comisión que quedó registrado en la liquidación `Final` más reciente de una OTA determinada, para tener una referencia histórica antes de reportar el porcentaje de esa misma OTA en un nuevo evento de check-out.

**Por qué esta prioridad**: `Generar liquidación` obtiene el porcentaje de comisión exclusivamente del evento de check-out que emite Módulo 2, sin mantener una tabla propia de convenios ni invocar una consulta independiente para obtenerlo (FR-005 y BR-010 de `generar_liquidacion.md`). El dato pactado sigue siendo propiedad de Módulo 2; esta consulta solo ofrece una referencia histórica de lo ya liquidado, útil para que Módulo 2 detecte inconsistencias antes de emitir un nuevo check-out.

**Prueba independiente**: Se puede generar la liquidación `Final` de una reserva OTA con un porcentaje de comisión conocido y, luego, consultar esa misma OTA para verificar que el resultado muestra ese porcentaje y la fecha de la liquidación de la que proviene.

**Escenarios de aceptación**:

1. **Escenario**: Consulta de una OTA con liquidaciones previas
   - **Dado** que existe al menos una liquidación `Final` generada para reservas de una OTA específica
   - **Cuando** Módulo 2 consulta el porcentaje de comisión de esa OTA
   - **Entonces** el sistema devuelve el porcentaje aplicado en la liquidación `Final` más reciente de esa OTA, junto con la fecha de esa liquidación, indicando explícitamente que es un dato histórico y no una tarifa contractual gestionada por Módulo 3

2. **Escenario**: Consulta de una OTA sin liquidaciones previas
   - **Dado** que una OTA aún no tiene ninguna liquidación `Final` generada
   - **Cuando** Módulo 2 consulta su porcentaje de comisión
   - **Entonces** el sistema informa explícitamente que no existe historial, sin devolver un porcentaje por defecto ni en cero

---

### Historia de usuario 2 - La consulta nunca se convierte en la fuente del dato usado por `Generar liquidación` (Prioridad: P2)

Como sistema de gestión hotelera, quiero garantizar que `Consultar porcentaje de comisión OTA` sea exclusivamente informativa y de lectura, para que `Generar liquidación` continúe basándose únicamente en el porcentaje reportado en el evento de check-out, sin crear una dependencia oculta entre ambos casos de uso.

**Por qué esta prioridad**: Complementa a HU1 protegiendo una regla de diseño ya establecida en `generar_liquidacion.md` (FR-005, BR-010); no es la vía principal de valor de este caso de uso, pero previene que una futura implementación introduzca un acoplamiento que contradiga esa spec.

**Prueba independiente**: Se puede generar una liquidación `Final` para una OTA cuyo porcentaje histórico consultado sea distinto al reportado en un nuevo evento de check-out, y verificar que la nueva liquidación usa el porcentaje del evento de check-out, no el de la consulta histórica.

**Escenarios de aceptación**:

1. **Escenario**: El porcentaje histórico difiere del reportado en un nuevo check-out
   - **Dado** que el porcentaje histórico más reciente de una OTA es distinto al porcentaje que Módulo 2 reporta en un nuevo evento de check-out de esa misma OTA
   - **Cuando** `Generar liquidación` procesa ese evento
   - **Entonces** la liquidación resultante aplica el porcentaje del evento de check-out, sin ser corregida ni sobrescrita por el valor histórico consultado

2. **Escenario**: Intento de usar la consulta como origen del cálculo
   - **Dado** que se intenta invocar `Consultar porcentaje de comisión OTA` como parte del flujo interno de `Generar liquidación`
   - **Cuando** se revisa el diseño del sistema
   - **Entonces** esa invocación no existe; `Generar liquidación` obtiene el porcentaje únicamente del evento de check-out

---

### Historia de usuario 3 - La OTA verifica el porcentaje de comisión que se le ha registrado (Prioridad: P2)

Como OTA (Booking, Airbnb, Expedia), quiero consultar el porcentaje de comisión que Módulo 3 registró en mis propias liquidaciones `Final` más recientes, para verificar por mi cuenta que el porcentaje aplicado coincide con lo pactado, de forma similar a como ya puedo hacerlo en `Consultar liquidación`.

**Por qué esta prioridad**: Complementa a HU1 dando a la propia OTA la misma visibilidad histórica y referencial que ya tiene Módulo 2, consistente con su rol ya reconocido como actor en `Consultar liquidación` (`diccionario.md`).

**Prueba independiente**: Se puede generar la liquidación `Final` de una reserva de una OTA con un porcentaje de comisión conocido, consultar como esa OTA su propio porcentaje de comisión, y verificar que el resultado coincide con lo aplicado, sin exponer datos de otras OTAs.

**Escenarios de aceptación**:

1. **Escenario**: OTA consulta su propio historial de comisión
   - **Dado** que existe al menos una liquidación `Final` de una reserva intermediada por la OTA que consulta
   - **Cuando** esa OTA consulta su porcentaje de comisión
   - **Entonces** el sistema devuelve el porcentaje de su liquidación `Final` más reciente, marcado como referencial

2. **Escenario**: Una OTA intenta consultar el porcentaje de otra OTA
   - **Dado** que existen liquidaciones `Final` de más de una OTA distinta
   - **Cuando** una OTA intenta consultar el porcentaje de comisión de una OTA diferente a ella misma
   - **Entonces** el sistema rechaza la consulta, sin exponer datos de comisión de una OTA ajena

### Casos límite

- La misma OTA presenta distintos porcentajes en liquidaciones históricas diferentes (por ejemplo, un cambio de convenio en el tiempo): el sistema no debe promediar ni elegir uno arbitrario; debe devolver el de la liquidación `Final` más reciente.
- Se consulta el porcentaje de comisión de una reserva o canal directo (sin OTA): el sistema debe rechazar la consulta o indicar explícitamente que no aplica, sin devolver 0% como si fuera un resultado válido de comisión OTA.
- Una OTA intenta consultar el porcentaje de comisión de una OTA distinta a ella misma: el sistema debe rechazar la consulta, respetando el mismo ámbito de acceso por actor que ya aplica en `Consultar liquidación` (BR-002 de `consultar_liquidacion.md`).
- Intento de actualizar, corregir o fijar el porcentaje de comisión de una OTA desde esta consulta: el sistema debe rechazarlo; la propiedad del dato sigue siendo exclusiva de Módulo 2, conforme a BR-010 de `generar_liquidacion.md`.
- Consultas repetidas e inmediatas sobre la misma OTA sin liquidaciones nuevas: deben devolver siempre el mismo resultado.
- OTA cuya única liquidación `Final` fue generada hace mucho tiempo: el sistema igual devuelve ese dato como la referencia histórica más reciente disponible, sin expirarlo ni ocultarlo por antigüedad.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir a los actores autorizados (`Módulo 2`, `OTA`) consultar el porcentaje de comisión registrado en la liquidación `Final` más reciente generada para una OTA o canal específico.
- **FR-002**: El resultado de la consulta DEBE indicar explícitamente que el dato devuelto es histórico y referencial, y que no constituye una tarifa contractual gestionada o garantizada por Módulo 3.
- **FR-003**: El sistema NO DEBE invocar `Consultar porcentaje de comisión OTA` desde `Generar liquidación`; este último continúa obteniendo el porcentaje de comisión exclusivamente del evento de check-out, conforme a FR-005 de `generar_liquidacion.md`.
- **FR-004**: El sistema DEBE informar de manera explícita cuando no exista ninguna liquidación `Final` previa para la OTA consultada, sin devolver un porcentaje por defecto ni en cero.
- **FR-005**: El sistema NO DEBE permitir actualizar, corregir ni fijar el porcentaje de comisión de una OTA a través de esta consulta; es una operación exclusivamente de lectura.
- **FR-006**: El sistema DEBE rechazar o marcar como no aplicable una consulta realizada sobre una reserva de canal directo, sin devolver 0% como si fuera un resultado válido de comisión OTA.
- **FR-007**: El sistema DEBE restringir el acceso a `Consultar porcentaje de comisión OTA` a los actores autorizados (`Módulo 2`, `OTA`).
- **FR-008**: El sistema DEBE devolver siempre el mismo resultado ante consultas repetidas sobre la misma OTA cuando no existan liquidaciones nuevas, garantizando que la consulta no tenga efectos secundarios.
- **FR-009**: El sistema DEBE restringir a una OTA la consulta de este caso de uso exclusivamente al porcentaje registrado en sus propias liquidaciones `Final`, identificadas por su código de confirmación externo y canal, de la misma forma en que `Consultar liquidación` restringe a cada OTA a sus propias reservas (FR-006 de `consultar_liquidacion.md`).

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Consulta de comisión OTA**: Solicitud de un actor autorizado (`Módulo 2`, `OTA`) identificando la OTA o canal cuyo historial de comisión se desea revisar.
- **Resultado histórico de comisión**: Porcentaje registrado en la liquidación `Final` más reciente de una OTA, junto con la fecha de esa liquidación, marcado explícitamente como referencial y no contractual.

### Reglas de negocio

- **BR-001**: Este caso de uso nunca constituye la fuente de verdad del porcentaje de comisión de una reserva; esa fuente es exclusivamente Módulo 2, conforme a BR-010 de `generar_liquidacion.md`.
- **BR-002**: `Consultar porcentaje de comisión OTA` es una operación exclusivamente de lectura sobre liquidaciones `Final` ya generadas; no crea, administra ni corrige convenios de comisión con ninguna OTA.
- **BR-003**: El acceso está restringido a los actores autorizados `Módulo 2` y `OTA`; una OTA solo accede al porcentaje registrado en sus propias liquidaciones, nunca en las de otra OTA.
- **BR-004**: `Generar liquidación` nunca depende de este caso de uso para determinar el porcentaje de comisión a aplicar.

## Requisitos no funcionales

- **NFR-001**: Determinismo: para la misma OTA y el mismo conjunto de liquidaciones `Final` generadas, la consulta debe devolver siempre el mismo resultado.
- **NFR-002**: Rendimiento: la consulta debe responder en un tiempo adecuado para no bloquear a Módulo 2 en la preparación de un evento de check-out.
- **NFR-003**: Privacidad: el resultado no debe exponer datos de huéspedes ni de liquidaciones de otras OTAs distintas a la consultada.
- **NFR-004**: Confidencialidad del dato histórico: la consulta no debe filtrar información de comisión de canal directo, dado que ese canal no tiene comisión aplicable.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las consultas de una OTA con liquidaciones previas devuelven el porcentaje de la liquidación `Final` más reciente, correctamente identificado con su fecha.
- **SC-002**: El 100% de las consultas de una OTA sin liquidaciones previas informan la ausencia de historial, sin valores por defecto.
- **SC-003**: El 0% de las ejecuciones de `Generar liquidación` invoca esta consulta como fuente del porcentaje de comisión.
- **SC-004**: El 0% de las consultas permite modificar el porcentaje de comisión histórico registrado.
- **SC-005**: El 100% de los accesos a `Consultar porcentaje de comisión OTA` quedan restringidos a los actores autorizados (`Módulo 2`, `OTA`).
- **SC-006**: El 0% de las consultas de una OTA expone el porcentaje de comisión registrado para una OTA distinta.
