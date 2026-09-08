# Especificación de funcionalidad: Descontar comisión OTA

**Creado**: 2026-09-07  

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Calcular el monto de comisión OTA sobre el valor de hospedaje bruto (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero calcular el monto de comisión que corresponde descontar del valor de hospedaje bruto cuando la reserva proviene de un intermediario OTA, para que "Generar liquidación" y "Generar factura final" obtengan el ingreso neto correcto.

**Por qué esta prioridad**: Es el paso que traduce el porcentaje pactado con la OTA en un valor monetario concreto; un monto de comisión incorrecto distorsiona directamente el ingreso neto reportado en la Matriz de Liquidación Final (Comisión OTA = - (Valor Hospedaje x % Comisión)).

**Prueba independiente**: Se puede invocar el cálculo con un valor de hospedaje bruto y un canal OTA con porcentaje pactado vigente, y verificar de forma independiente que el monto resultante sea el producto correcto, sin necesidad de generar una liquidación completa.

**Escenarios de aceptación**:

1. **Escenario**: Reserva con intermediario y comisión configurada
   - **Dado** que la reserva identifica un canal OTA con un porcentaje de comisión vigente obtenido mediante "Consultar porcentaje de comisión OTA"
   - **Cuando** se invoca "Descontar comisión OTA" con el valor de hospedaje bruto correspondiente
   - **Entonces** el sistema calcula el monto de comisión como un valor negativo, igual en magnitud al producto entre el valor de hospedaje bruto y el porcentaje vigente, y lo devuelve junto con el valor bruto sin mezclarlos

2. **Escenario**: Reserva de canal directo
   - **Dado** que la reserva se originó por canal directo o no tiene canal de origen registrado
   - **Cuando** se invoca "Descontar comisión OTA"
   - **Entonces** el sistema determina que el monto de comisión es cero sin necesidad de consultar ningún porcentaje, y no descuenta nada del valor de hospedaje

3. **Escenario**: Reutilización del monto ya calculado al generar la factura final
   - **Dado** que ya existe una liquidación definitiva de la estancia con su monto de comisión OTA calculado y persistido
   - **Cuando** "Generar factura final" requiere el monto de comisión de esa estancia
   - **Entonces** el sistema reutiliza el monto ya calculado y persistido en la liquidación, sin ejecutar un nuevo cálculo de "Descontar comisión OTA"

---

### Historia de usuario 2 - Obtener el porcentaje vigente antes de calcular el descuento (Prioridad: P1)

Como responsable de facturación, quiero que el cálculo de comisión siempre parta del porcentaje vigente consultado en el momento, para que el monto descontado sea consistente con lo realmente pactado con la OTA.

**Por qué esta prioridad**: Calcular con un porcentaje supuesto o desactualizado generaría una comisión incorrecta y, por lo tanto, un ingreso neto erróneo.

**Prueba independiente**: Se puede invocar el cálculo para un canal OTA y verificar que, antes de producir un monto, el sistema haya obtenido el porcentaje mediante la consulta correspondiente y no un valor propio almacenado.

**Escenarios de aceptación**:

1. **Escenario**: El cálculo incluye la consulta del porcentaje vigente
   - **Dado** que se invoca "Descontar comisión OTA" para una reserva con canal OTA
   - **Cuando** el sistema procesa el cálculo
   - **Entonces** ejecuta primero "Consultar porcentaje de comisión OTA" (relación `<<include>>` del diagrama de casos de uso) y usa ese resultado como base del monto calculado

2. **Escenario**: La consulta de porcentaje es rechazada
   - **Dado** que "Consultar porcentaje de comisión OTA" rechaza la consulta para el canal indicado
   - **Cuando** el sistema intenta calcular el descuento
   - **Entonces** el cálculo se rechaza también, sin producir un monto de comisión sustituto

---

### Historia de usuario 3 - Rechazar cálculos con datos inválidos o incompletos (Prioridad: P1)

Como responsable de la operación hotelera, quiero que el sistema rechace el cálculo de comisión cuando el valor de hospedaje bruto sea inválido, para evitar que un descuento incorrecto llegue a la liquidación o a la factura final.

**Por qué esta prioridad**: Un descuento mal calculado afecta directamente el ingreso neto y la conciliación financiera con cada intermediario.

**Prueba independiente**: Se puede intentar el cálculo con un valor de hospedaje bruto negativo, no numérico o ausente, y verificar que el sistema rechace la operación sin producir un monto.

**Escenarios de aceptación**:

1. **Escenario**: Valor de hospedaje bruto inválido
   - **Dado** que el valor de hospedaje bruto recibido es negativo, no numérico o no fue provisto
   - **Cuando** se intenta calcular el descuento
   - **Entonces** el sistema rechaza el cálculo, identifica la causa y no produce un monto de comisión

2. **Escenario**: Porcentaje inválido propagado desde la consulta
   - **Dado** que "Consultar porcentaje de comisión OTA" devuelve un porcentaje fuera de rango o inválido
   - **Cuando** el sistema intenta calcular el descuento
   - **Entonces** rechaza el cálculo en vez de aplicar un porcentaje inválido al valor de hospedaje

### Casos límite

- El valor de hospedaje bruto es exactamente cero: el monto de comisión también debe ser cero, sin tratarse como un error.
- El porcentaje pactado es exactamente 0% (configurado explícitamente para esa OTA): el monto de comisión debe ser cero, pero este caso se distingue de una reserva de canal directo porque sí hubo una consulta exitosa con resultado 0%.
- El canal de origen cambia entre el check-in y el check-out de una misma estancia: el cálculo debe usar el canal y el porcentaje vigentes en el momento en que "Generar liquidación" lo invoca, no un canal registrado previamente.
- El resultado del producto tiene más decimales que los permitidos por la moneda: debe aplicarse la misma política de redondeo usada en el resto de los cálculos financieros del Módulo 3.
- Se invoca el cálculo más de una vez con exactamente los mismos datos de entrada: debe producir siempre el mismo monto.
- El valor de hospedaje bruto aún no ha sido calculado o fue rechazado por el proceso que lo antecede: el cálculo de comisión no debe ejecutarse sobre un valor inexistente ni asumir un valor de cero como si fuera el hospedaje real.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE calcular el monto de comisión OTA como un valor negativo, igual en magnitud al producto entre el valor de hospedaje bruto recibido y el porcentaje de comisión vigente, únicamente cuando el canal de origen de la reserva sea un intermediario OTA.
- **FR-002**: El sistema DEBE obtener el porcentaje de comisión mediante "Consultar porcentaje de comisión OTA" antes de calcular el monto, conforme a la relación `<<include>>` del diagrama de casos de uso; no debe asumir ni almacenar un porcentaje propio.
- **FR-003**: El sistema DEBE determinar que el monto de comisión es cero, sin invocar la consulta de porcentaje, cuando la reserva sea de canal directo o no tenga canal de origen registrado.
- **FR-004**: El sistema DEBE rechazar el cálculo, sin producir un monto de comisión, cuando la consulta del porcentaje sea rechazada por ausencia de configuración, valor inválido o ambigüedad.
- **FR-005**: El sistema DEBE validar que el valor de hospedaje bruto recibido sea numérico y no negativo antes de calcular el descuento.
- **FR-006**: El sistema DEBE devolver por separado el valor de hospedaje bruto, el porcentaje utilizado y el monto de comisión resultante (expresado como valor negativo), sin mezclarlos en un único total.
- **FR-007**: El sistema DEBE aplicar la política de redondeo y precisión monetaria de la moneda configurada, de forma consistente con el resto de los cálculos financieros del Módulo 3.
- **FR-008**: El sistema NO DEBE modificar el valor de hospedaje bruto original ni el estado de la reserva; el monto calculado queda disponible para que "Generar liquidación" o "Generar factura final" lo utilicen.
- **FR-009**: El sistema DEBE producir el mismo monto de comisión ante los mismos datos de entrada (valor de hospedaje bruto, canal de origen y porcentaje vigente).
- **FR-010**: El sistema NO DEBE ejecutar un nuevo cálculo cuando "Generar factura final" requiera el monto de comisión de una estancia que ya tiene una liquidación definitiva; DEBE reutilizar el monto ya calculado y persistido en esa liquidación.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Valor de hospedaje bruto**: Importe calculado por la tarifa dinámica antes de aplicar cualquier descuento de comisión.
- **Canal de origen**: Clasificación de la reserva como directo o como un canal OTA específico, de la cual depende si el descuento aplica.
- **Porcentaje de comisión**: Tasa vigente obtenida mediante "Consultar porcentaje de comisión OTA", usada como base del cálculo.
- **Monto de comisión OTA**: Resultado del cálculo; valor negativo a descontar del hospedaje bruto para obtener el ingreso neto, consistente con la fórmula de la Matriz de Liquidación Final (Comisión OTA = - (Valor Hospedaje x % Comisión)).
- **Resultado del descuento**: Agrupa el valor de hospedaje bruto, el porcentaje utilizado (cuando aplica), el monto de comisión y el motivo de rechazo cuando corresponda.

### Reglas de negocio

- **BR-001**: El monto de comisión se calcula únicamente como un valor negativo, igual en magnitud al producto entre el valor de hospedaje bruto y el porcentaje de comisión vigente, y solo cuando el canal de la reserva es un intermediario OTA.
- **BR-002**: Un canal directo, o una reserva sin canal de origen registrado, produce un monto de comisión igual a cero sin necesidad de consultar ningún porcentaje.
- **BR-003**: Este caso de uso no determina ni valida el canal de origen de la reserva; recibe esa clasificación ya establecida por el proceso que lo invoca.
- **BR-004**: Una consulta de porcentaje rechazada detiene por completo el cálculo del descuento; no se sustituye por 0% ni por un valor supuesto, a diferencia del canal directo, que legítimamente no requiere consulta.
- **BR-005**: El monto de comisión se mantiene como concepto separado del valor de hospedaje bruto y de los impuestos, conforme a la Matriz de Liquidación Final.
- **BR-006**: El cálculo de comisión se ejecuta cada vez que "Generar liquidación" calcula una liquidación (preliminar en el check-in, sus recálculos antes del check-out, o la definitiva en el check-out); su reutilización posterior por "Generar factura final" a partir de la liquidación definitiva ya generada no constituye un nuevo cálculo (ver FR-010).

## Requisitos no funcionales

- **NFR-001**: Determinismo: el mismo valor de hospedaje bruto, canal y porcentaje vigente deben producir siempre el mismo monto de comisión.
- **NFR-002**: Rendimiento: el cálculo debe completarse en un tiempo que no genere demoras perceptibles dentro de los procesos de liquidación y facturación que lo invocan.
- **NFR-003**: Exactitud monetaria: el resultado debe ser consistente con la precisión y la política de redondeo aplicada al resto de los cálculos financieros del Módulo 3.
- **NFR-004**: El resultado no debe exponer datos personales del huésped; solo debe contener valores financieros y el canal de origen.
- **NFR-005**: El resultado debe ser suficientemente trazable para identificar el valor de hospedaje bruto, el canal, el porcentaje utilizado y el monto calculado.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los cálculos con canal OTA y porcentaje vigente configurado producen un monto negativo, igual en magnitud al producto exacto entre el valor de hospedaje bruto y ese porcentaje.
- **SC-002**: El 100% de las reservas de canal directo o sin canal registrado obtienen un monto de comisión igual a cero, sin haber invocado la consulta de porcentaje.
- **SC-003**: El 100% de los cálculos donde la consulta de porcentaje es rechazada se rechazan también, sin producir un monto de comisión sustituto.
- **SC-004**: El 100% de los resultados distinguen explícitamente el valor de hospedaje bruto, el porcentaje utilizado y el monto de comisión, sin mezclarlos en un solo total.
- **SC-005**: El 0% de los cálculos modifica el valor de hospedaje bruto original o el estado de la reserva.
- **SC-006**: El 100% de las veces que "Generar factura final" requiere el monto de comisión de una estancia con liquidación definitiva ya generada, reutiliza el monto persistido sin ejecutar un nuevo cálculo.
