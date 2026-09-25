# Especificación de funcionalidad: Gestionar facturación

**Creado**: 2026-09-15

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Buscar facturas por estancia, cliente, canal, fecha o estado (Prioridad: P1)

Como Administrador, quiero buscar y filtrar las facturas definitivas generadas por `Generar factura final` usando criterios como estancia/reserva, cliente, canal de origen o rango de fechas de emisión, para ubicar rápidamente cualquier factura sin tener que revisar estancia por estancia.

**Por qué esta prioridad**: Es la capacidad principal de `Gestionar facturación`; sin ella, la funcionalidad no aporta ningún valor distinto de consultar cada liquidación de forma individual.

**Prueba independiente**: Se pueden generar varias facturas (canal directo y canal OTA) y verificar que una búsqueda por cada criterio individual (estancia, cliente, canal, rango de fechas) devuelve exactamente las facturas que cumplen ese criterio.

**Escenarios de aceptación**:

1. **Escenario**: Buscar por identificador de estancia o reserva
   - **Dado** que existe una factura asociada a una estancia
   - **Cuando** el Administrador busca por el identificador de esa estancia o reserva
   - **Entonces** el sistema devuelve la factura asociada, con su número de la numeración consecutiva oficial

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

Como Administrador, quiero abrir el detalle completo de una factura encontrada (desglose de hospedaje, comisión, IVA, total y liquidación de origen) para revisarla con fines de soporte o conciliación, sin alterarla.

**Por qué esta prioridad**: Complementa la búsqueda (HU1) dándole utilidad real de auditoría; sin embargo, no es indispensable cuando solo se necesita confirmar la existencia de una factura, por lo que su prioridad es menor.

**Prueba independiente**: Se puede localizar una factura mediante la búsqueda de HU1 y verificar que su detalle expone el mismo desglose con el que fue generada originalmente, sin haber recalculado ningún valor ni afectado la liquidación asociada.

**Escenarios de aceptación**:

1. **Escenario**: Detalle de una factura de canal OTA
   - **Dado** que se localiza una factura de una reserva OTA
   - **Cuando** el Administrador abre su detalle
   - **Entonces** el sistema muestra el desglose completo (hospedaje, comisión informativa, IVA, total), el número de numeración consecutiva oficial, y su carácter inmutable

2. **Escenario**: Trazabilidad hacia la liquidación de origen
   - **Dado** que se consulta el detalle de cualquier factura
   - **Cuando** el Administrador la revisa
   - **Entonces** el sistema muestra el identificador de la liquidación de origen y la fecha y hora de emisión, permitiendo rastrear el documento sin salir de la consulta

---

### Historia de usuario 3 - Obtener un resumen consolidado de facturas por canal (Prioridad: P3)

Como Administrador, quiero obtener un resumen consolidado de las facturas de un período agrupadas por canal de origen, para conciliar el ingreso neto facturado a cada OTA y verificar que el canal directo no presente descuentos indebidos.

**Por qué esta prioridad**: Es un valor agregado de nivel de reporte; no es indispensable para localizar o revisar una factura puntual (eso ya lo cubren HU1 y HU2), por lo que es la de menor prioridad de las tres.

**Prueba independiente**: Se pueden generar varias facturas de canal directo y de distintas OTA dentro de un mismo período, solicitar el resumen consolidado para ese rango, y verificar que el total por canal coincide con la suma manual de las facturas correspondientes.

**Escenarios de aceptación**:

1. **Escenario**: Resumen por canal en un período con facturas emitidas
   - **Dado** que existen facturas de canal directo y de canal OTA emitidas dentro de un rango de fechas
   - **Cuando** el Administrador solicita el resumen consolidado para ese rango
   - **Entonces** el sistema agrupa el total de hospedaje, el total de comisión OTA y el total de IVA por cada canal, sin mezclar los importes entre canales

2. **Escenario**: Resumen consolidado sin facturas en el período
   - **Dado** que ninguna factura fue emitida dentro del rango de fechas consultado
   - **Cuando** se genera el resumen consolidado
   - **Entonces** el sistema muestra totales en cero por cada canal, no un error

### Casos límite

- Búsqueda sin ningún criterio ingresado: el sistema no debe devolver la totalidad de las facturas sin control; debe exigir al menos un criterio antes de ejecutar la consulta.
- Estancia cuya reserva fue cancelada en Módulo 2 antes del check-out: nunca existió liquidación ni factura para esa estancia (ver `generar_liquidacion.md`); la búsqueda no debe devolver ningún resultado para ella.
- Volumen alto de coincidencias: el sistema debe paginar o limitar los resultados sin omitir coincidencias de forma silenciosa.
- Intento de modificar, anular o reemitir una factura desde esta consulta: el sistema debe rechazarlo; `Gestionar facturación` es exclusivamente de lectura y no reemplaza a `Generar factura final`.
- Factura cuya liquidación de origen incluye datos de control migratorio en su registro: la búsqueda y el detalle no deben exponer esos datos, respetando la frontera con Módulo 2.
- Acceso al caso de uso por un actor distinto al Administrador: el sistema debe rechazar la operación.
- Rango de fechas inválido en una búsqueda o en el resumen consolidado (fecha de inicio posterior a la fecha de fin): el sistema debe rechazar la consulta y explicar el error, sin devolver un resultado parcial.
- Búsqueda por nombre del cliente con coincidencia parcial (no exacta): el sistema debe indicar si aplica una coincidencia exacta o aproximada, sin mezclar clientes distintos en un mismo resultado.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir al actor `Administrador` buscar facturas generadas por `Generar factura final` usando al menos uno de los siguientes criterios: identificador de estancia/reserva, cliente responsable de facturación, canal de origen, o rango de fechas de emisión.
- **FR-002**: El sistema DEBE exigir al menos un criterio de búsqueda antes de ejecutar la consulta, para evitar exponer la totalidad de las facturas sin control.
- **FR-003**: El sistema DEBE identificar en los resultados de búsqueda el número de la numeración consecutiva oficial de cada factura.
- **FR-004**: El sistema DEBE permitir al Administrador abrir el detalle completo de una factura localizada, incluyendo el desglose de hospedaje, comisión OTA (si aplica), IVA y total, tal como fue generado por `Generar factura final`.
- **FR-005**: El sistema DEBE identificar en el detalle de cada factura la liquidación de origen y la fecha y hora de emisión, para permitir su trazabilidad.
- **FR-006**: El sistema NO DEBE permitir modificar, recalcular, anular ni reemitir una factura desde `Gestionar facturación`; esta funcionalidad es exclusivamente de consulta.
- **FR-007**: El sistema DEBE paginar o limitar los resultados de búsqueda cuando el número de coincidencias sea alto, sin omitir coincidencias de forma silenciosa.
- **FR-008**: El sistema DEBE informar de manera explícita cuando una búsqueda no arroje resultados, sin producir un error genérico.
- **FR-009**: El sistema NO DEBE exponer datos de control migratorio en los resultados de búsqueda ni en el detalle de una factura, respetando la frontera de responsabilidad con Módulo 2.
- **FR-010**: El sistema DEBE restringir el acceso a `Gestionar facturación` exclusivamente al actor `Administrador`.
- **FR-011**: El sistema DEBE permitir al Administrador solicitar un resumen consolidado de facturas emitidas dentro de un rango de fechas, agrupado por canal de origen.
- **FR-012**: El sistema DEBE presentar en el resumen consolidado, para cada canal, el total de hospedaje, el total de comisión OTA (si aplica) y el total de IVA, sin mezclar los importes entre canales.
- **FR-013**: El sistema DEBE rechazar una búsqueda o una solicitud de resumen consolidado cuando el rango de fechas ingresado sea inválido (fecha de inicio posterior a la fecha de fin), sin devolver un resultado parcial.
- **FR-014**: El sistema DEBE mostrar un total en cero para un canal sin facturas dentro del período consultado, en lugar de omitirlo o producir un error.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Criterio de búsqueda**: Combinación de filtros (estancia/reserva, cliente, canal, rango de fechas) usada por el Administrador para localizar facturas.
- **Resultado de búsqueda**: Lista de facturas que cumplen los criterios ingresados, con su número de numeración oficial.
- **Detalle de factura consultada**: Vista de solo lectura del desglose completo y la trazabilidad de una factura específica, idéntica a la generada por `Generar factura final`.
- **Resumen consolidado**: Agregado de totales de hospedaje, comisión OTA e IVA por canal de origen, calculado sobre las facturas de un rango de fechas.

### Reglas de negocio

- **BR-001**: `Gestionar facturación` es una funcionalidad exclusivamente de consulta; no crea, modifica, recalcula ni anula facturas ni liquidaciones.
- **BR-002**: El acceso a `Gestionar facturación` está reservado al actor `Administrador`.
- **BR-003**: Solo existen facturas para estancias que llegaron a check-out; una estancia cancelada antes del check-out nunca tuvo liquidación ni factura, por lo que no aparece en ningún resultado.
- **BR-004**: El desglose de cada factura mostrado debe reflejar fielmente el producido por `Generar factura final`, sin reinterpretarlo ni derivarlo por separado.
- **BR-005**: `Gestionar facturación` consulta el mismo universo de facturas que ya expone `Consultar liquidación` a `Módulo 1` y `OTA`, pero añade búsqueda y filtrado de uso administrativo; no constituye una fuente de datos distinta ni duplicada.

## Requisitos no funcionales

- **NFR-001**: Rendimiento: las búsquedas deben responder en un tiempo adecuado incluso con un volumen alto de facturas históricas.
- **NFR-002**: Determinismo: la misma combinación de criterios, sobre los mismos datos vigentes, debe devolver siempre el mismo conjunto de resultados.
- **NFR-003**: Privacidad: los resultados y el detalle de factura no deben exponer información personal del huésped ni datos migratorios que no sean necesarios para el proceso financiero.
- **NFR-004**: Integridad de solo lectura: ninguna operación de `Gestionar facturación` debe alterar el estado de una factura o liquidación existente, verificable en pruebas de auditoría.
- **NFR-005**: Escalabilidad: el resumen consolidado debe poder calcularse sobre volúmenes crecientes de facturas históricas sin degradar el tiempo de respuesta de forma perceptible.
- **NFR-006**: Consistencia horaria: los filtros por fecha y el resumen consolidado deben aplicar una única zona horaria de referencia, evitando resultados inconsistentes por husos horarios distintos.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las búsquedas con al menos un criterio válido devuelven únicamente las facturas que cumplen ese criterio.
- **SC-002**: El 100% de las búsquedas sin coincidencias informan la ausencia de resultados sin mostrar un error genérico.
- **SC-003**: El 100% de los detalles de factura consultados coinciden exactamente con el desglose generado originalmente por `Generar factura final`.
- **SC-004**: El 0% de las operaciones de `Gestionar facturación` modifica, recalcula o anula una factura o liquidación existente.
- **SC-005**: El 100% de los accesos a `Gestionar facturación` quedan restringidos al actor `Administrador`.
- **SC-006**: El 100% de los resúmenes consolidados por canal coinciden con la suma manual de las facturas correspondientes a ese canal y período.
- **SC-007**: El 100% de las búsquedas y resúmenes con un rango de fechas inválido son rechazados sin devolver un resultado parcial.
