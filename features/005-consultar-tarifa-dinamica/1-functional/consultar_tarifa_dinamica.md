# Especificación de funcionalidad: Consultar tarifa dinámica

**Creado**: 2026-09-18

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Módulo 2 obtiene la tarifa dinámica de una noche cotizada por habitación (Prioridad: P1)

Como Módulo 2 (módulo de reservas), quiero consultar la tarifa dinámica de un tipo de habitación para una fecha específica, para obtener el valor de hospedaje cotizado por habitación, calculado por Módulo 3, que se incluye en el evento de check-out que Módulo 1 emite y que dispara `Generar liquidación`.

**Por qué esta prioridad**: `Generar liquidación` no calcula ni recalcula la tarifa dinámica por su cuenta (FR-002 de `generar_liquidacion.md`); el valor de hospedaje debe llegar ya calculado en el evento de check-out. Sin esta consulta, Módulo 2 no tendría forma de obtener ese valor de forma consistente con las reglas de temporada que administra Módulo 3.

**Prueba independiente**: Se puede configurar una tarifa base en Módulo 1 y una regla de temporada en Módulo 3 para una fecha determinada, consultar la tarifa dinámica de esa fecha, y verificar que el resultado refleja el ajuste numérico configurado para esa temporada (por ejemplo, incremento con un ajuste positivo como el de `Alta`, decremento con uno negativo como el de `Baja`, sin cambio con uno en cero como el de `Regular` — el mismo cálculo aplica igual a cualquier temporada adicional que el Administrador configure).

**Escenarios de aceptación**:

1. **Escenario**: Consulta de una noche en temporada alta
   - **Dado** que la fecha consultada está clasificada como temporada alta y el tipo de habitación tiene una tarifa base registrada en Módulo 1
   - **Cuando** Módulo 2 consulta la tarifa dinámica de ese tipo de habitación para esa fecha
   - **Entonces** el sistema devuelve la tarifa base incrementada según la regla de temporada alta vigente

2. **Escenario**: Consulta de una noche sin temporada explícita
   - **Dado** que la fecha consultada no tiene una clasificación de temporada configurada
   - **Cuando** Módulo 2 consulta la tarifa dinámica de esa fecha
   - **Entonces** el sistema asume temporada regular y devuelve la tarifa base sin ajuste

---

### Historia de usuario 2 - Módulo 2 obtiene el valor de hospedaje de una estancia completa (Prioridad: P1)

Como Módulo 2, quiero consultar la tarifa dinámica de cada noche dentro de un rango de fechas de una estancia, para sumar los valores y obtener el valor de hospedaje bruto total, incluso cuando la estancia cruce más de una temporada.

**Por qué esta prioridad**: El valor de hospedaje (bruto) se define como la suma de las tarifas dinámicas de todas las noches de la estancia (`diccionario.md`); sin poder consultar el detalle noche por noche, Módulo 2 no podría construir ese total de forma correcta cuando la estancia atraviesa distintas temporadas.

**Prueba independiente**: Se puede configurar una estancia cuyo rango de fechas cruce de temporada baja a temporada alta, consultar la tarifa dinámica de ese rango, y verificar que cada noche refleja su propia temporada, sin homogeneizar todo el rango a una sola.

**Escenarios de aceptación**:

1. **Escenario**: Rango que cruza dos temporadas
   - **Dado** que un rango de fechas incluye noches en temporada baja y noches en temporada alta
   - **Cuando** Módulo 2 consulta la tarifa dinámica de ese rango
   - **Entonces** el sistema devuelve un resultado por cada noche, con la temporada y el ajuste que corresponde individualmente a esa fecha

2. **Escenario**: Rango de fechas inválido
   - **Dado** que la fecha de fin del rango consultado es anterior o igual a la fecha de inicio
   - **Cuando** Módulo 2 ejecuta la consulta
   - **Entonces** el sistema rechaza la consulta y no devuelve ningún resultado parcial

3. **Escenario**: Cotización al extender una estancia en curso
   - **Dado** que una estancia en curso ya tiene una cotización previa identificada por un identificador generado por Módulo 2
   - **Cuando** Módulo 2 consulta la tarifa dinámica de las noches adicionales de una extensión, incluyendo el identificador de la cotización que extiende (`extendsQuoteId`)
   - **Entonces** el sistema calcula la tarifa dinámica de esas noches adicionales de la misma forma que cualquier otra consulta, devuelve `extendsQuoteId` tal cual en el resultado, para trazabilidad, sin heredar ni recalcular los valores de esa cotización previa

---

### Historia de usuario 3 - La OTA verifica la tarifa dinámica vigente para mantener paridad de precios (Prioridad: P2)

Como OTA (Booking, Airbnb, Expedia), quiero consultar la tarifa dinámica vigente de un tipo de habitación para una fecha o rango de fechas, para mantener actualizado el precio que publico en mi propio canal y evitar discrepancias con la tarifa real del hotel.

**Por qué esta prioridad**: No es indispensable para que Módulo 2 obtenga el valor de hospedaje cotizado por habitación (eso ya lo cubren HU1 y HU2), pero es necesaria para que la OTA mantenga paridad de precios con el hotel sin depender de actualizaciones manuales por parte del Administrador.

**Prueba independiente**: Se puede configurar una tarifa base y una regla de temporada para una fecha, consultar la tarifa dinámica de esa fecha como OTA, y verificar que el resultado es idéntico al que obtendría Módulo 2 para la misma fecha y tipo de habitación.

**Escenarios de aceptación**:

1. **Escenario**: OTA consulta la tarifa vigente de una fecha futura
   - **Dado** que existe una tarifa base y una regla de temporada configuradas para una fecha futura
   - **Cuando** la OTA consulta la tarifa dinámica de esa fecha para un tipo de habitación
   - **Entonces** el sistema devuelve el mismo resultado que obtendría Módulo 2 para esa misma consulta, sin distinción de trato entre actores autorizados

2. **Escenario**: Consulta idéntica repetida por distintos actores
   - **Dado** que Módulo 2 y una OTA consultan la misma fecha y tipo de habitación bajo la misma configuración vigente
   - **Cuando** ambos ejecutan la consulta
   - **Entonces** ambos reciben exactamente el mismo resultado, dado que la tarifa dinámica no es información restringida por actor

### Casos límite

- El tipo de habitación consultado no tiene tarifa base registrada en Módulo 1: el sistema rechaza la consulta; no debe devolver una tarifa dinámica calculada sobre una tarifa base en cero o supuesta.
- Módulo 1 no responde o no está disponible al consultar la tarifa base: la consulta de tarifa dinámica falla de forma explícita, sin devolver un resultado parcial ni estimado.
- La regla de temporada o la tarifa base cambian después de que Módulo 2 ya utilizó una consulta anterior para construir parte del valor de hospedaje de una estancia en curso: `Consultar tarifa dinámica` siempre refleja la configuración vigente en el momento exacto de cada consulta; no re-evalúa ni corrige consultas anteriores ya realizadas. Esto incluye la extensión de una estancia: la cotización de las noches adicionales (identificada mediante `extendsQuoteId`) se calcula con la configuración vigente al momento de esa nueva consulta, sin heredar ni recalcular la cotización original que extiende.
- Consulta repetida para la misma habitación y fecha sin cambios de configuración: debe devolver siempre el mismo resultado.
- Rango de fechas de una sola noche: la fecha de fin es la fecha de salida (exclusiva, igual que en el valor de hospedaje); una noche se consulta con fecha de fin = fecha de inicio + 1 día, y el sistema devuelve el resultado de esa única noche. Una fecha de fin igual a la de inicio equivale a cero noches y se rechaza.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir a los actores autorizados (`Módulo 2`, `OTA`) consultar la tarifa dinámica de un tipo de habitación para una fecha específica o para un rango de fechas.
- **FR-002**: El sistema DEBE calcular la tarifa dinámica ajustando la tarifa base obtenida de Módulo 1 (mediante `Consultar tarifa base`) según el ajuste numérico configurado para la temporada vigente aplicable a cada noche consultada, conforme a la clasificación que administra el Administrador en `Revisar temporada del año` y a los ajustes definidos en `Modificar precio tarifa según temporada`. El sistema NO DEBE asumir un signo o una magnitud fijos a partir del nombre de la temporada: el valor positivo, negativo o cero ya configurado para esa temporada es lo que determina si el resultado incrementa, decrementa o mantiene la tarifa base, y este cálculo DEBE funcionar de la misma forma tanto para las temporadas predeterminadas (`Alta`, `Baja`, `Regular`) como para cualquier temporada adicional que el Administrador configure.
- **FR-003**: Cuando la consulta cubra un rango de varias noches, el sistema DEBE devolver el resultado de cada noche de forma individual, sin promediar ni aplicar una única temporada a todo el rango.
- **FR-004**: El sistema DEBE asumir temporada regular cuando una fecha consultada no tenga una clasificación de temporada explícita configurada.
- **FR-005**: El sistema NO DEBE calcular, almacenar ni asumir una tarifa base propia; DEBE obtenerla de Módulo 1 en cada consulta mediante `Consultar tarifa base`.
- **FR-006**: El sistema DEBE rechazar la consulta cuando Módulo 1 no reporte una tarifa base para el tipo de habitación solicitado, sin devolver una tarifa dinámica basada en un valor supuesto o en cero.
- **FR-007**: El sistema NO DEBE persistir un valor fijo de "tarifa dinámica" para una fecha; cada consulta refleja la configuración de temporada y la tarifa base vigentes en el momento en que se ejecuta.
- **FR-008**: El sistema DEBE rechazar una consulta cuyo rango de fechas sea inválido (fecha de fin anterior o igual a la fecha de inicio; la fecha de fin es la fecha de salida, exclusiva), sin devolver un resultado parcial.
- **FR-009**: El resultado de la consulta DEBE identificar, para cada noche, la tarifa base de origen, la temporada aplicada y la tarifa dinámica resultante, para que el actor consultante pueda trazar cómo se compuso ese valor (en el caso de Módulo 2, para el valor de hospedaje cotizado por habitación, calculado por Módulo 3, que Módulo 1 incluye en el evento de check-out).
- **FR-010**: El sistema DEBE restringir el acceso a `Consultar tarifa dinámica` exclusivamente a los actores autorizados (`Módulo 2`, `OTA`).
- **FR-011**: El sistema NO DEBE aplicar restricciones de visibilidad por actor sobre el resultado de esta consulta; la tarifa dinámica de una fecha y tipo de habitación es la misma para cualquier actor autorizado que la consulte, dado que no es información específica de una reserva ni de un canal en particular.
- **FR-012**: El sistema DEBE aceptar, de forma opcional, un identificador de cotización previa (`extendsQuoteId`) cuando la consulta corresponda a la extensión de una estancia en curso, para relacionar la nueva consulta con la original; el identificador de cotización lo genera Módulo 2 y Módulo 3 no lo crea, no lo persiste ni lo valida (conforme a FR-007): solo lo devuelve tal cual en la respuesta. Esta relación es exclusivamente de trazabilidad y no altera el cálculo de la tarifa dinámica de las noches adicionales.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Tarifa dinámica**: Valor resultante de ajustar la tarifa base según la temporada aplicable a una noche específica; se calcula en el momento de la consulta, no se almacena como valor independiente.
- **Consulta de tarifa**: Solicitud de un actor autorizado (`Módulo 2`, `OTA`) identificando el tipo de habitación y una fecha o rango de fechas; cuando la solicitud corresponde a la extensión de una estancia en curso, incluye opcionalmente el identificador de la cotización original (`extendsQuoteId`) para relacionar ambas consultas; su valor lo genera Módulo 2.
- **Resultado por noche**: Tarifa base de origen, temporada aplicada y tarifa dinámica resultante para una noche específica dentro del rango consultado.

### Reglas de negocio

- **BR-001**: La tarifa dinámica es siempre una función de la tarifa base vigente en Módulo 1 y la regla de temporada vigente administrada por el Administrador en el momento de la consulta; no es un valor almacenado de forma independiente.
- **BR-002**: El acceso a `Consultar tarifa dinámica` está reservado a los actores autorizados `Módulo 2` (que la necesita para obtener el valor de hospedaje cotizado por habitación antes de que Módulo 1 lo incluya en el evento de check-out) y `OTA` (que la necesita para mantener paridad de precios con su propio canal).
- **BR-003**: Cada noche de una estancia se valora con la temporada que corresponde a esa fecha específica; una estancia que abarca más de una temporada nunca se homogeniza a una sola.
- **BR-004**: `Consultar tarifa dinámica` es una operación exclusivamente de lectura: no crea ni modifica la tarifa base, la clasificación de temporada, ni ningún registro de liquidación o factura.
- **BR-005**: A diferencia de `Consultar liquidación`, este caso de uso no segmenta el resultado por actor: la tarifa dinámica de una fecha y tipo de habitación es pública entre los actores autorizados, no un dato privado de una reserva o canal.
- **BR-006**: Una consulta que extiende una estancia en curso (identificada mediante `extendsQuoteId`) se calcula de forma independiente, con la configuración vigente al momento de esa consulta; `extendsQuoteId` solo relaciona ambas consultas para fines de trazabilidad y nunca hace que una dependa del valor de la otra.
- **BR-007**: El ajuste aplicado a cada noche depende únicamente del valor numérico (positivo, negativo o cero) configurado para la temporada vigente de esa fecha, nunca del nombre o la etiqueta de la temporada; esto rige por igual para las temporadas predeterminadas (`Alta`, `Baja`, `Regular`) y para cualquier temporada adicional que el Administrador configure en `Modificar precio tarifa según temporada`.

## Requisitos no funcionales

- **NFR-001**: Determinismo: el mismo tipo de habitación, la misma fecha y la misma configuración vigente deben producir siempre el mismo resultado.
- **NFR-002**: Rendimiento: la consulta debe responder en un tiempo adecuado para no bloquear operaciones de front-desk en Módulo 2 (cotización, check-in, cálculo de extensiones).
- **NFR-003**: Consistencia entre módulos: si Módulo 1 no está disponible o no devuelve una tarifa base válida, la consulta debe fallar de forma explícita, nunca con un resultado parcial o estimado.
- **NFR-004**: Trazabilidad: el resultado debe permitir reconstruir, para cada noche, cómo se llegó a la tarifa dinámica final a partir de la tarifa base y la temporada aplicada.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las consultas sobre una fecha con temporada configurada aplican el ajuste correspondiente sin excepción.
- **SC-002**: El 100% de las estancias que cruzan más de una temporada reciben el valor correcto por cada noche, verificable sumando manualmente.
- **SC-003**: El 0% de las consultas devuelve una tarifa dinámica cuando Módulo 1 no reporta una tarifa base válida.
- **SC-004**: El 100% de las consultas con un rango de fechas inválido son rechazadas sin devolver un resultado parcial.
- **SC-005**: El 100% de los accesos a `Consultar tarifa dinámica` quedan restringidos a los actores autorizados (`Módulo 2`, `OTA`).
- **SC-006**: El 100% de las consultas idénticas (misma fecha, mismo tipo de habitación, misma configuración vigente) devuelven el mismo resultado sin importar cuál actor autorizado las ejecute.
- **SC-007**: El 100% de las consultas de extensión que incluyen `extendsQuoteId` calculan la tarifa dinámica de las noches adicionales con la configuración vigente, sin heredar ni recalcular los valores de la cotización original.
