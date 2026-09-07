# Especificación de funcionalidad: Gestionar facturación

**Creado**: 2026-09-07

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Buscar facturas por estancia, cliente, canal, fecha o estado (Prioridad: P1)

Como Administrador, quiero buscar y filtrar las facturas (prefacturas y definitivas) generadas por "Generar factura final" usando criterios como estancia/reserva, cliente, canal de origen, rango de fechas de emisión o estado, para ubicar rápidamente cualquier factura sin tener que revisar estancia por estancia.

**Por qué esta prioridad**: Es la capacidad principal de "Gestionar facturación"; sin ella, la funcionalidad no aporta ningún valor distinto de consultar cada liquidación de forma individual.

**Prueba independiente**: Se pueden generar varias facturas (prefactura y definitiva, canal directo y canal OTA) y verificar que una búsqueda por cada criterio individual (estancia, cliente, canal, rango de fechas, estado) devuelve exactamente las facturas que cumplen ese criterio.

**Escenarios de aceptación**:

1. **Escenario**: Buscar por identificador de estancia o reserva
   - **Dado** que existe una factura (prefactura o definitiva) asociada a una estancia
   - **Cuando** el Administrador busca por el identificador de esa estancia o reserva
   - **Entonces** el sistema devuelve la factura asociada, identificando su estado (borrador o definitiva)

2. **Escenario**: Buscar por rango de fechas de emisión y canal de origen
   - **Dado** que existen facturas emitidas en distintas fechas y canales
   - **Cuando** el Administrador busca combinando un rango de fechas de emisión y un canal específico
   - **Entonces** el sistema devuelve únicamente las facturas emitidas en ese rango para ese canal

3. **Escenario**: Búsqueda sin resultados
   - **Dado** que ningún registro cumple los criterios de búsqueda ingresados
   - **Cuando** el Administrador ejecuta la búsqueda
   - **Entonces** el sistema informa explícitamente que no hay coincidencias, sin mostrar un error genérico ni un resultado ambiguo

---

### Historia de usuario 2 - Consultar el detalle completo y trazable de una factura localizada (Prioridad: P2)

Como Administrador, quiero abrir el detalle completo de una factura encontrada (desglose de hospedaje, comisión, IVA, total, estado y liquidación de origen) para revisarla con fines de soporte o conciliación, sin alterarla.

**Por qué esta prioridad**: Complementa la búsqueda (HU1) dándole utilidad real de auditoría; sin embargo, no es indispensable cuando solo se necesita confirmar la existencia de una factura, por lo que su prioridad es menor.

**Prueba independiente**: Se puede localizar una factura mediante la búsqueda de HU1 y verificar que su detalle expone el mismo desglose y estado con el que fue generada originalmente, sin haber recalculado ningún valor ni afectado la liquidación asociada.

**Escenarios de aceptación**:

1. **Escenario**: Detalle de una factura definitiva de canal OTA
   - **Dado** que se localiza una factura definitiva de una reserva OTA
   - **Cuando** el Administrador abre su detalle
   - **Entonces** el sistema muestra el desglose completo (hospedaje, comisión informativa, IVA, total), el número de numeración consecutiva oficial, y su carácter inmutable

2. **Escenario**: Detalle de una prefactura
   - **Dado** que se localiza una prefactura generada en un check-in aún abierto
   - **Cuando** el Administrador abre su detalle
   - **Entonces** el sistema deja explícito que es un borrador sin numeración oficial y que puede cambiar antes del check-out

3. **Escenario**: Trazabilidad hacia la liquidación de origen
   - **Dado** que se consulta el detalle de cualquier factura
   - **Cuando** el Administrador la revisa
   - **Entonces** el sistema muestra el identificador de la liquidación de origen y la fecha y hora de emisión, permitiendo rastrear el documento sin salir de la consulta

---

### Historia de usuario 3 - Obtener un resumen consolidado de facturas por canal y estado (Prioridad: P3)

Como Administrador, quiero obtener un resumen consolidado de las facturas de un período agrupadas por canal de origen y estado, para conciliar el ingreso neto facturado a cada OTA y verificar que el canal directo no presente descuentos indebidos.

**Por qué esta prioridad**: Es un valor agregado de nivel de reporte; no es indispensable para localizar o revisar una factura puntual (eso ya lo cubren HU1 y HU2), por lo que es la de menor prioridad de las tres.

**Prueba independiente**: Se pueden generar varias facturas definitivas de canal directo y de distintas OTA dentro de un mismo período, solicitar el resumen consolidado para ese rango, y verificar que el total por canal coincide con la suma manual de las facturas correspondientes.

**Escenarios de aceptación**:

1. **Escenario**: Resumen por canal en un período con facturas definitivas
   - **Dado** que existen facturas definitivas de canal directo y de canal OTA emitidas dentro de un rango de fechas
   - **Cuando** el Administrador solicita el resumen consolidado para ese rango
   - **Entonces** el sistema agrupa el total de hospedaje, el total de comisión OTA y el total de IVA por cada canal, sin mezclar los importes entre canales

2. **Escenario**: Separación entre lo definitivo y lo estimado
   - **Dado** que el período consultado incluye estancias con solo prefactura (check-in sin check-out)
   - **Cuando** se genera el resumen consolidado
   - **Entonces** el sistema presenta el total definitivo (facturas emitidas) separado del estimado preliminar (prefacturas), sin sumarlos como si fueran el mismo concepto

### Casos límite

- Búsqueda sin ningún criterio ingresado: el sistema no debe devolver la totalidad de las facturas sin control; debe exigir al menos un criterio antes de ejecutar la consulta.
- Estancia cuya liquidación transicionó a estado anulado (per `generar_factura_final.md` FR-013): la búsqueda no debe devolver una factura para esa estancia, ya que la prefactura fue descartada.
- Volumen alto de coincidencias: el sistema debe paginar o limitar los resultados sin omitir coincidencias de forma silenciosa.
- Intento de modificar, anular o reemitir una factura desde esta consulta: el sistema debe rechazarlo; "Gestionar facturación" es exclusivamente de lectura y no reemplaza a "Generar factura final".
- Factura cuya liquidación de origen incluye datos de control migratorio en su registro: la búsqueda y el detalle no deben exponer esos datos, respetando la frontera con Módulo 2.
- Acceso al caso de uso por un actor distinto al Administrador: el sistema debe rechazar la operación.
- Rango de fechas inválido en una búsqueda o en el resumen consolidado (fecha de inicio posterior a la fecha de fin): el sistema debe rechazar la consulta y explicar el error, sin devolver un resultado parcial.
- Resumen consolidado solicitado para un período sin ninguna factura emitida: el sistema debe mostrar totales en cero por canal, no un error.
- Búsqueda por nombre del cliente con coincidencia parcial (no exacta): el sistema debe indicar si aplica una coincidencia exacta o aproximada, sin mezclar clientes distintos en un mismo resultado.
- Transición momentánea de prefactura a factura definitiva para la misma estancia (justo en el instante del check-out): el sistema debe mostrar únicamente la factura definitiva una vez emitida, nunca ambos registros como resultados independientes de la misma estancia.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir al actor `Administrador` buscar facturas (prefacturas y facturas definitivas) generadas por "Generar factura final" usando al menos uno de los siguientes criterios: identificador de estancia/reserva, cliente responsable de facturación, canal de origen, rango de fechas de emisión, o estado (borrador o definitiva).
- **FR-002**: El sistema DEBE exigir al menos un criterio de búsqueda antes de ejecutar la consulta, para evitar exponer la totalidad de las facturas sin control.
- **FR-003**: El sistema DEBE distinguir en los resultados de búsqueda el estado de cada factura (borrador/prefactura o definitiva) y, cuando aplique, su número de la numeración consecutiva oficial.
- **FR-004**: El sistema DEBE permitir al Administrador abrir el detalle completo de una factura localizada, incluyendo el desglose de hospedaje, comisión OTA (si aplica), IVA y total, tal como fue generado por "Generar factura final".
- **FR-005**: El sistema DEBE identificar en el detalle de cada factura la liquidación de origen y la fecha y hora de emisión, para permitir su trazabilidad.
- **FR-006**: El sistema NO DEBE permitir modificar, recalcular, anular ni reemitir una factura desde "Gestionar facturación"; esta funcionalidad es exclusivamente de consulta.
- **FR-007**: El sistema NO DEBE devolver en los resultados de búsqueda facturas o prefacturas asociadas a liquidaciones en estado anulado.
- **FR-008**: El sistema DEBE paginar o limitar los resultados de búsqueda cuando el número de coincidencias sea alto, sin omitir coincidencias de forma silenciosa.
- **FR-009**: El sistema DEBE informar de manera explícita cuando una búsqueda no arroje resultados, sin producir un error genérico.
- **FR-010**: El sistema NO DEBE exponer datos de control migratorio en los resultados de búsqueda ni en el detalle de una factura, respetando la frontera de responsabilidad con Módulo 2.
- **FR-011**: El sistema DEBE restringir el acceso a "Gestionar facturación" exclusivamente al actor `Administrador`.
- **FR-012**: El sistema DEBE permitir al Administrador solicitar un resumen consolidado de facturas emitidas dentro de un rango de fechas, agrupado por canal de origen.
- **FR-013**: El sistema DEBE presentar en el resumen consolidado, para cada canal, el total de hospedaje, el total de comisión OTA (si aplica) y el total de IVA, sin mezclar los importes entre canales.
- **FR-014**: El sistema DEBE separar en el resumen consolidado el total definitivo (facturas emitidas) del estimado preliminar (prefacturas de estancias aún abiertas), presentándolos como cifras independientes.
- **FR-015**: El sistema DEBE rechazar una búsqueda o una solicitud de resumen consolidado cuando el rango de fechas ingresado sea inválido (fecha de inicio posterior a la fecha de fin), sin devolver un resultado parcial.
- **FR-016**: El sistema DEBE mostrar un total en cero para un canal sin facturas dentro del período consultado, en lugar de omitirlo o producir un error.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Criterio de búsqueda**: Combinación de filtros (estancia/reserva, cliente, canal, rango de fechas, estado) usada por el Administrador para localizar facturas.
- **Resultado de búsqueda**: Lista de facturas (prefacturas y definitivas) que cumplen los criterios ingresados, con su estado y numeración oficial cuando aplica.
- **Detalle de factura consultada**: Vista de solo lectura del desglose completo y la trazabilidad de una factura específica, idéntica a la generada por "Generar factura final".
- **Resumen consolidado**: Agregado de totales de hospedaje, comisión OTA e IVA por canal de origen y por estado (definitivo o preliminar), calculado sobre las facturas de un rango de fechas.

### Reglas de negocio

- **BR-001**: "Gestionar facturación" es una funcionalidad exclusivamente de consulta; no crea, modifica, recalcula ni anula facturas ni liquidaciones.
- **BR-002**: El acceso a "Gestionar facturación" está reservado al actor `Administrador`.
- **BR-003**: Las facturas o prefacturas asociadas a liquidaciones anuladas no se exponen como resultados válidos de búsqueda.
- **BR-004**: El estado de cada factura mostrado (borrador o definitiva) debe reflejar fielmente el estado producido por "Generar factura final", sin reinterpretarlo ni derivarlo por separado.
- **BR-005**: "Gestionar facturación" consulta el mismo universo de facturas que ya expone "Consultar liquidación" a `Módulo 2` y `OTA`, pero añade búsqueda y filtrado de uso administrativo; no constituye una fuente de datos distinta ni duplicada.
- **BR-006**: El resumen consolidado nunca mezcla el total definitivo (facturas emitidas) con el estimado de prefacturas activas; ambos se presentan como cifras separadas, coherente con la distinción entre prefactura y factura definitiva de `generar_factura_final.md`.
- **BR-007**: Un identificador de estancia solo tiene un resultado de factura vigente a la vez: la prefactura deja de aparecer en los resultados en el momento en que existe una factura definitiva para esa estancia, coherente con BR-005 de `generar_factura_final.md`.

## Requisitos no funcionales

- **NFR-001**: Rendimiento: las búsquedas deben responder en un tiempo adecuado incluso con un volumen alto de facturas históricas.
- **NFR-002**: Determinismo: la misma combinación de criterios, sobre los mismos datos vigentes, debe devolver siempre el mismo conjunto de resultados.
- **NFR-003**: Privacidad: los resultados y el detalle de factura no deben exponer información personal del huésped ni datos migratorios que no sean necesarios para el proceso financiero.
- **NFR-004**: Integridad de solo lectura: ninguna operación de "Gestionar facturación" debe alterar el estado de una factura o liquidación existente, verificable en pruebas de auditoría.
- **NFR-005**: Escalabilidad: el resumen consolidado debe poder calcularse sobre volúmenes crecientes de facturas históricas sin degradar el tiempo de respuesta de forma perceptible.
- **NFR-006**: Consistencia horaria: los filtros por fecha y el resumen consolidado deben aplicar una única zona horaria de referencia, evitando resultados inconsistentes por husos horarios distintos.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las búsquedas con al menos un criterio válido devuelven únicamente las facturas que cumplen ese criterio.
- **SC-002**: El 100% de las búsquedas sin coincidencias informan la ausencia de resultados sin mostrar un error genérico.
- **SC-003**: El 0% de las búsquedas expone facturas o prefacturas de liquidaciones anuladas.
- **SC-004**: El 100% de los detalles de factura consultados coinciden exactamente con el desglose generado originalmente por "Generar factura final".
- **SC-005**: El 0% de las operaciones de "Gestionar facturación" modifica, recalcula o anula una factura o liquidación existente.
- **SC-006**: El 100% de los accesos a "Gestionar facturación" quedan restringidos al actor `Administrador`.
- **SC-007**: El 100% de los resúmenes consolidados por canal coinciden con la suma manual de las facturas definitivas correspondientes a ese canal y período.
- **SC-008**: El 100% de las búsquedas y resúmenes con un rango de fechas inválido son rechazados sin devolver un resultado parcial.
