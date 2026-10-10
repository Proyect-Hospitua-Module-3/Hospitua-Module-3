# Especificación de funcionalidad: Consultar tarifa base

**Creado**: 2026-09-06

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Consultar la tarifa base para una fecha (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero consultar a Módulo 1 la tarifa base de un tipo de habitación para una fecha específica, para usarla como valor inicial del precio de hospedaje.

**Por qué esta prioridad**: La tarifa base es el punto de partida del cálculo del precio de hospedaje; Módulo 1 administra este dato y Módulo 3 lo consulta cuando lo necesita. `Consultar tarifa dinámica` obtiene la tarifa base para calcular el precio por noche y `Cotizar hospedaje` la usa como insumo de su cálculo (FR-002, FR-005 y FR-012 de `consultar_tarifa_dinamica.md`).

**Prueba independiente**: Se puede solicitar la tarifa base para un tipo de habitación y una fecha, y comprobar el importe devuelto o el resultado funcional correspondiente.

**Escenarios de aceptación**:

1. **Escenario**: Consulta exitosa
   - **Dado** que Módulo 1 tiene una tarifa base para el tipo de habitación y fecha solicitados
   - **Cuando** Módulo 3 consulta esa tarifa
   - **Entonces** recibe el importe aplicable sin modificar ni conservar una copia propia de la configuración.

2. **Escenario**: Estancia que cruza un cambio de tarifa
   - **Dado** que el importe de la tarifa base cambia entre noches de una estancia
   - **Cuando** Módulo 3 consulta la tarifa para cada noche de la estancia
   - **Entonces** cada fecha se resuelve de forma independiente con el importe que Módulo 1 devuelve para esa fecha, sin reutilizar el importe de otra fecha ni conservar copias; `Consultar tarifa dinámica` y `Cotizar hospedaje` solicitan la tarifa de cada noche, desde la fecha de entrada inclusiva hasta la fecha de salida exclusiva.

---

### Historia de usuario 2 - El cálculo se detiene cuando no hay tarifa base utilizable (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación, quiero detener el cálculo cuando no pueda obtener una tarifa base utilizable, para no producir un importe de hospedaje estimado o parcial.

**Por qué esta prioridad**: Sin una tarifa base válida, `Consultar tarifa dinámica` y `Cotizar hospedaje` no pueden determinar el valor de hospedaje correspondiente.

**Prueba independiente**: Se puede solicitar un cálculo con tarifa inexistente, con Módulo 1 sin respuesta o con un importe inutilizable y verificar que el cálculo se detiene sin producir un valor.

**Escenarios de aceptación**:

1. **Escenario**: No existe tarifa para la noche
   - **Dado** que Módulo 1 no tiene tarifa base para el tipo de habitación y la noche solicitados
   - **Cuando** Módulo 3 consulta la tarifa
   - **Entonces** el cálculo que requiere esa tarifa se detiene y no usa un valor sustituto

2. **Escenario**: Módulo 1 no responde
   - **Dado** que Módulo 1 no responde a la consulta de tarifa base
   - **Cuando** Módulo 3 intenta obtener la tarifa
   - **Entonces** el cálculo que requiere esa tarifa se detiene y no produce un resultado parcial

3. **Escenario**: La respuesta de Módulo 1 es inutilizable
   - **Dado** que Módulo 1 devuelve un importe no numérico, una respuesta con estructura inválida, datos requeridos ausentes o datos de tipo incorrecto
   - **Cuando** Módulo 3 interpreta la respuesta
   - **Entonces** informa una falla de dependencia y detiene el cálculo que requiere esa tarifa, sin devolver valores parciales ni sustitutos

4. **Escenario**: El importe numérico no es positivo
   - **Dado** que Módulo 1 devuelve un importe numérico igual o menor que cero
   - **Cuando** Módulo 3 interpreta la respuesta
   - **Entonces** informa que la tarifa es inválida y detiene el cálculo que la requiere, sin devolver un valor sustituto

### Casos límite

- Si Módulo 1 no encuentra tarifa para el tipo de habitación y la fecha, el cálculo que la requiere se detiene y se informa la ausencia; no se usa un valor sustituto.
- Si Módulo 1 no responde, o devuelve una respuesta con estructura inválida, datos requeridos ausentes o de tipo incorrecto, el cálculo se detiene por falla de dependencia; si devuelve un importe numérico no positivo, el cálculo se detiene porque la tarifa es inválida. En ambos casos no se devuelven valores parciales ni sustitutos.
- Un cambio posterior de tarifa base no altera la cotización de hospedaje ya guardada.
- Si el tipo de habitación está vacío o la fecha consultada es inválida, Módulo 3 rechaza la consulta sin consultar a Módulo 1.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: Módulo 3 DEBE consultar a Módulo 1 la tarifa base aplicable a un tipo de habitación y una fecha, y recibir su importe en COP.
- **FR-002**: Módulo 3 NO DEBE almacenar una copia propia de la tarifa base como fuente de cálculos futuros; cada consulta refleja el dato vigente que proporciona Módulo 1.
- **FR-003**: Módulo 3 DEBE resolver de forma independiente cada fecha consultada con el importe que Módulo 1 devuelve para esa fecha, sin reutilizar el importe de otra fecha ni conservar copias. `Consultar tarifa dinámica` y `Cotizar hospedaje` DEBEN consultar la tarifa base de cada noche de la estancia, desde la fecha de entrada inclusiva hasta la fecha de salida exclusiva.
- **FR-004**: Cuando Módulo 1 no tenga tarifa para el tipo de habitación y noche solicitados, Módulo 3 DEBE detener el cálculo invocante e informar la ausencia, sin devolver un valor sustituto.
- **FR-005**: Módulo 3 NO DEBE modificar, corregir ni completar la configuración de tarifa base de Módulo 1; la consulta es de solo lectura.
- **FR-006**: Módulo 3 DEBE distinguir la ausencia de tarifa, una tarifa inválida por tener un importe numérico no positivo y una falla de dependencia por falta de respuesta o una respuesta con estructura inválida, datos requeridos ausentes o de tipo incorrecto. En todos esos casos, DEBE detener el cálculo que requiere la tarifa sin devolver valores parciales ni sustitutos.
- **FR-007**: Módulo 3 DEBE rechazar una consulta con tipo de habitación vacío o fecha inválida sin consultar a Módulo 1.

### Entidades clave

- **Tarifa base**: Importe en COP de una noche para un tipo de habitación, administrado por Módulo 1.
- **Tipo de habitación**: Categoría de alojamiento para la que se consulta el importe.
- **Resultado de consulta de tarifa base**: Importe devuelto por Módulo 1 o resultado funcional de ausencia de tarifa, tarifa inválida o falla de dependencia.

### Reglas de negocio

- **BR-001**: Módulo 1 es responsable de administrar la tarifa base; Módulo 3 solo la consulta como insumo de su cálculo.
- **BR-002**: Si no hay tarifa aplicable, Módulo 3 detiene el cálculo y no sustituye el importe por cero ni por un valor predeterminado.
- **BR-003**: Un cambio de tarifa base afecta las consultas posteriores y no modifica cálculos ya guardados.
- **BR-004**: La tarifa base se consulta únicamente para `Consultar tarifa dinámica` y `Cotizar hospedaje` (FR-002, FR-005 y FR-012 de `consultar_tarifa_dinamica.md`); `Generar liquidación` usa el valor de hospedaje de la cotización guardada y nunca consulta la tarifa base (FR-002 y BR-004 de `generar_liquidacion.md`).

## Requisitos no funcionales

- **NFR-001**: Determinismo: para el mismo tipo de habitación, fecha y dato proporcionado por Módulo 1, la consulta produce el mismo resultado.
- **NFR-002**: Rendimiento: cada consulta a Módulo 1 se completa o falla dentro de 500 ms.
- **NFR-003**: Actualidad: la consulta refleja el dato proporcionado por Módulo 1 en el momento de la solicitud y no depende de una copia desactualizada.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las consultas con tarifa disponible devuelve el importe comunicado por Módulo 1.
- **SC-002**: El 100% de las consultas sin tarifa disponible detiene el cálculo y no devuelve un importe sustituto.
- **SC-003**: El 100% de las consultas sin respuesta de Módulo 1, con importes no numéricos o con respuestas de estructura inválida, datos requeridos ausentes o de tipo incorrecto se trata como falla de dependencia; los importes numéricos no positivos se informan como tarifa inválida. En todos los casos, el cálculo se detiene sin propagar el importe ni devolver valores parciales o sustitutos.
- **SC-004**: El 0% de las consultas persiste una copia propia de la configuración de tarifa base.
- **SC-005**: El 100% de las fechas consultadas se resuelve de forma independiente con el importe devuelto por Módulo 1 para esa fecha, sin reutilizar el de otra fecha ni conservar copias; `Consultar tarifa dinámica` y `Cotizar hospedaje` consultan cada noche de la estancia desde la fecha de entrada inclusiva hasta la fecha de salida exclusiva.
- **SC-006**: El 100% de las consultas con tipo de habitación vacío o fecha inválida se rechaza sin consultar a Módulo 1.
