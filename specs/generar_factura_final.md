# Especificación de funcionalidad: Generar factura final

**Creado**: 2026-09-07

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Emitir la prefactura al registrar el check-in (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero generar una prefactura en borrador al ejecutarse "Generar liquidación" durante el check-in, para que el huésped y recepción cuenten con una vista preliminar del monto a facturar antes del cierre de la estancia.

**Por qué esta prioridad**: "Generar liquidación" incluye obligatoriamente a "Generar factura final" desde el check-in; sin esta prefactura no existe visibilidad temprana del monto estimado, aunque no sea el documento que cierra fiscalmente la estancia.

**Prueba independiente**: Se puede invocar "Generar factura final" en el contexto de una liquidación recién generada en estado `Preliminary` en el check-in (canal directo u OTA) y verificar que el sistema entregue un borrador con el desglose de hospedaje, comisión (si aplica) e IVA preliminar, sin número de factura oficial.

**Escenarios de aceptación**:

1. **Escenario**: Prefactura para liquidación de canal directo en el check-in
   - **Dado** que "Generar liquidación" acaba de abrir una liquidación de canal directo con hospedaje e IVA calculados
   - **Cuando** el sistema ejecuta "Generar factura final" dentro de ese flujo
   - **Entonces** produce una prefactura con el hospedaje, el IVA calculado mediante "Calcular Impuesto (IVA)" y el total estimado, marcada explícitamente como borrador sin numeración fiscal oficial

2. **Escenario**: Prefactura para liquidación de canal OTA en el check-in
   - **Dado** que la liquidación `Preliminary` en el check-in pertenece a un canal OTA con comisión ya descontada
   - **Cuando** el sistema genera la prefactura
   - **Entonces** el total estimado parte del ingreso neto ya liquidado (hospedaje menos comisión) más el IVA, sin volver a calcular ni cobrar la comisión como parte del documento

3. **Escenario**: La prefactura se actualiza mientras la estancia sigue abierta
   - **Dado** que existe una prefactura generada en el check-in y la liquidación `Preliminary` se recalcula por un cambio de fechas o de canal antes del check-out
   - **Cuando** el sistema detecta el nuevo cálculo de la liquidación
   - **Entonces** reemplaza el contenido de la prefactura con los nuevos valores, conservando su carácter de borrador sin numeración oficial

---

### Historia de usuario 2 - Emitir la factura fiscal definitiva al registrar el check-out (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero emitir la factura fiscal definitiva con numeración consecutiva oficial al cerrarse la liquidación en el check-out, para formalizar el cobro ante el huésped o la OTA y habilitar la conciliación contable.

**Por qué esta prioridad**: Sin este documento fiscal definitivo la estancia no queda formalmente facturada; es el cierre legal y contable del proceso, y la razón de ser del caso de uso.

**Prueba independiente**: Se puede cerrar una liquidación mediante "Registrar Check-out" y verificar que "Generar factura final" emite un documento con numeración consecutiva única, el desglose definitivo (hospedaje, comisión si aplica, IVA) y un total inmutable.

**Escenarios de aceptación**:

1. **Escenario**: Emisión de factura definitiva tras cierre de liquidación de canal directo
   - **Dado** que "Registrar Check-out" cerró la liquidación de una estancia de canal directo con hospedaje e IVA definitivos
   - **Cuando** el sistema ejecuta "Generar factura final"
   - **Entonces** asigna el siguiente número de la numeración consecutiva oficial, reemplaza cualquier prefactura previa por el documento fiscal definitivo, y marca la factura como inmutable

2. **Escenario**: Emisión de factura definitiva tras cierre de liquidación de canal OTA
   - **Dado** que la liquidación `Final` corresponde a una reserva OTA con comisión definitiva ya descontada
   - **Cuando** el sistema emite la factura definitiva
   - **Entonces** el total facturado corresponde al ingreso neto definitivo más el IVA definitivo, sin exponer la comisión como un cargo adicional al huésped

3. **Escenario**: Reenvío del evento de check-out ya facturado
   - **Dado** que ya existe una factura definitiva emitida para la estancia
   - **Cuando** se vuelve a procesar "Generar liquidación" y "Generar factura final" para esa misma estancia
   - **Entonces** el sistema devuelve la factura definitiva ya emitida con el mismo número, sin generar un nuevo número ni un nuevo documento

---

### Historia de usuario 3 - Reflejar el desglose auditable y el total exacto a cobrar (Prioridad: P2)

Como responsable de facturación, quiero que cada factura (prefactura o definitiva) muestre el desglose completo del hospedaje, la comisión OTA ya descontada, el IVA aplicado y el total a cobrar, para conciliar el cobro con el huésped o con la OTA sin ambigüedad.

**Por qué esta prioridad**: La exactitud del desglose no es indispensable para que el documento exista (eso lo cubren HU1 y HU2), pero sí para que facturación pueda auditar y conciliar cada factura sin recalcular manualmente; por eso su prioridad es menor.

**Prueba independiente**: Se puede generar una factura para una reserva OTA con comisión e IVA conocidos y verificar que el desglose expuesto permite reconstruir el total únicamente sumando o restando sus componentes, sin cifras ocultas o inconsistentes.

**Escenarios de aceptación**:

1. **Escenario**: Desglose completo en canal directo
   - **Dado** que la factura corresponde a una liquidación de canal directo
   - **Cuando** se genera el documento
   - **Entonces** expone el valor de hospedaje, un renglón de comisión en cero, el IVA calculado y el total, de forma que hospedaje más IVA sea igual al total

2. **Escenario**: Desglose completo en canal OTA
   - **Dado** que la factura corresponde a una liquidación de canal OTA con comisión ya descontada
   - **Cuando** se genera el documento
   - **Entonces** expone el valor de hospedaje bruto, la comisión OTA descontada como referencia informativa, el ingreso neto resultante, el IVA calculado sobre el hospedaje, y el total a cobrar al huésped, dejando explícito que la comisión no forma parte del cobro al huésped sino del pasivo con la OTA

### Casos límite

- No existe liquidación asociada al evento que dispara "Generar factura final": el sistema no debe emitir ningún documento, ni borrador ni definitivo.
- Faltan los datos tributarios mínimos del cliente responsable (nombre o razón social, o documento fiscal), recibidos originalmente del Módulo 2 en el check-in, al momento de emitir la factura definitiva: el sistema rechaza la emisión definitiva y conserva la prefactura como estimado, sin asignar numeración oficial.
- Se solicita la factura definitiva sobre una liquidación que aún no ha cerrado (sigue en estado `Preliminary`): el sistema no debe asignar numeración oficial sin un cierre previo confirmado.
- La liquidación transiciona a estado `Cancelled` antes del check-out: la prefactura asociada se descarta y nunca deriva en una factura definitiva.
- Salto o duplicado en la numeración consecutiva oficial: el sistema debe garantizar que cada número se asigne una única vez y en orden, sin reutilizar números de facturas ya emitidas.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE ejecutar "Generar factura final" únicamente como parte incluida (`<<include>>`) de "Generar liquidación", nunca como una operación invocable de forma independiente por un actor externo.
- **FR-002**: El sistema DEBE distinguir dos modalidades de emisión según el evento que originó la ejecución de "Generar liquidación": prefactura (contexto de check-in) y factura fiscal definitiva (contexto de check-out).
- **FR-003**: El sistema DEBE invocar obligatoriamente "Calcular Impuesto (IVA)" (`<<include>>`) para obtener el monto de impuesto correspondiente al hospedaje, tanto en la prefactura como en la factura definitiva.
- **FR-004**: El sistema DEBE calcular el total facturable como el ingreso neto de la liquidación (hospedaje menos comisión OTA, cuando aplique) más el IVA calculado, sin recalcular por su cuenta ninguno de esos componentes.
- **FR-005**: El sistema NO DEBE presentar la comisión OTA como un cargo cobrado al huésped; la comisión solo debe exponerse como referencia informativa del pasivo comercial con la OTA.
- **FR-006**: El sistema DEBE asignar un número de la numeración consecutiva oficial únicamente al emitir la factura definitiva en el check-out; la prefactura del check-in NO DEBE llevar numeración oficial.
- **FR-007**: El sistema DEBE marcar explícitamente la prefactura como borrador o estimado, dejando claro que no constituye un documento fiscal válido ante terceros.
- **FR-008**: El sistema DEBE reemplazar el contenido de la prefactura cada vez que la liquidación `Preliminary` se recalcule antes del check-out, sin asignarle numeración oficial en ninguna de esas actualizaciones.
- **FR-009**: El sistema DEBE tratar la factura definitiva como inmutable una vez emitida: no debe modificar sus valores ni su número tras la emisión.
- **FR-010**: El sistema DEBE responder de forma idempotente ante un reenvío del evento que originó el cierre de la liquidación, devolviendo la factura definitiva ya emitida con el mismo número, sin generar un nuevo documento.
- **FR-011**: El sistema DEBE validar la presencia de los datos tributarios mínimos del cliente responsable (nombre o razón social, y número de identificación tributaria o documento fiscal) antes de emitir la factura definitiva; estos datos son los recibidos originalmente del Módulo 2 en el evento de check-in, y no se capturan ni se solicitan de forma independiente en este caso de uso.
- **FR-012**: El sistema DEBE rechazar la emisión de la factura definitiva y no asignar numeración oficial si faltan los datos tributarios mínimos del cliente responsable, si la liquidación asociada no existe, o si la liquidación no se encuentra en estado `Final`.
- **FR-013**: El sistema DEBE descartar la prefactura sin generar nunca una factura definitiva cuando la liquidación asociada transicione a estado `Cancelled`.
- **FR-014**: El sistema DEBE presentar en cada factura (prefactura o definitiva) el desglose de hospedaje, comisión OTA (si aplica), IVA y total, de forma que el total sea igual a la suma de sus componentes.
- **FR-015**: El sistema DEBE garantizar que cada número de la numeración consecutiva oficial se asigne una única vez, en orden, sin reutilizar números de facturas ya emitidas.
- **FR-016**: El sistema DEBE identificar en cada factura la liquidación de origen, la fecha y hora de emisión, y el evento que la disparó, para fines de trazabilidad.
- **FR-017**: El sistema NO DEBE capturar, procesar ni persistir datos de control migratorio en la factura, respetando la frontera de responsabilidad con Módulo 2.
- **FR-018**: El sistema DEBE permitir que la factura generada (prefactura o definitiva) sea consultada por los actores autorizados a través de "Consultar liquidación", sin necesidad de recalcularla.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Prefactura**: Documento en borrador generado al ejecutar "Generar factura final" en el check-in; sin numeración oficial, mutable mientras la liquidación se mantenga en estado `Preliminary`.
- **Factura fiscal definitiva**: Documento formal generado al ejecutar "Generar factura final" en el check-out; con numeración consecutiva oficial, inmutable tras su emisión.
- **Numeración consecutiva oficial**: Secuencia única y ordenada de números asignados exclusivamente a facturas definitivas.
- **Cliente responsable de facturación**: Datos tributarios mínimos (nombre o razón social, documento fiscal) requeridos para emitir una factura definitiva válida; suministrados por el Módulo 2 en el evento de check-in y propagados a través de la liquidación.
- **Desglose facturable**: Hospedaje, comisión OTA (informativa), IVA y total, expuestos en cada factura, tanto en su forma de borrador como definitiva.

### Reglas de negocio

- **BR-001**: "Generar factura final" es un caso de uso interno, incluido exclusivamente por "Generar liquidación"; no existe una vía de invocación directa por un actor externo.
- **BR-002**: El total facturado nunca incluye la comisión OTA como cargo al huésped; la comisión solo reduce el ingreso neto que recibe el hotel y se muestra como referencia.
- **BR-003**: La numeración consecutiva oficial es un recurso exclusivo de la factura definitiva; la prefactura nunca consume ni reserva un número de esa secuencia.
- **BR-004**: Una factura definitiva, una vez emitida, es inmutable; cualquier corrección o ajuste posterior requiere un mecanismo distinto, fuera del alcance de este caso de uso.
- **BR-005**: La prefactura refleja siempre el estado más reciente de la liquidación `Preliminary`, y deja de existir en su forma de borrador en el momento en que se emite la factura definitiva.
- **BR-006**: Los datos tributarios mínimos del cliente responsable son una condición obligatoria para emitir la factura definitiva, aunque no bloqueen la generación de la prefactura como estimado.
- **BR-007**: Una liquidación `Cancelled` nunca deriva en una factura definitiva; cualquier prefactura asociada queda descartada.

## Requisitos no funcionales

- **NFR-001**: Determinismo: para la misma liquidación `Final` y los mismos datos tributarios, la factura definitiva generada debe ser siempre idéntica en desglose y total.
- **NFR-002**: Rendimiento: la emisión de la prefactura y de la factura definitiva debe completarse sin demoras perceptibles dentro de los flujos de check-in y check-out que las incluyen.
- **NFR-003**: Integridad de la numeración: la secuencia de numeración consecutiva oficial debe garantizarse incluso ante fallos parciales o reintentos concurrentes del cierre de check-out.
- **NFR-004**: Trazabilidad y auditoría: cada factura debe quedar vinculada de forma verificable a su liquidación de origen y al evento que la generó.
- **NFR-005**: Privacidad: la factura no debe exponer datos de identificación migratoria ni información personal del huésped que no sea necesaria para el proceso financiero.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las liquidaciones `Preliminary` en el check-in generan una prefactura visible como borrador, sin numeración oficial.
- **SC-002**: El 100% de las liquidaciones `Final` en el check-out generan una factura definitiva con numeración consecutiva oficial única.
- **SC-003**: El 0% de las facturas (prefactura o definitiva) muestra la comisión OTA como un cargo cobrado al huésped.
- **SC-004**: El 100% de los reenvíos del evento de cierre de una estancia ya facturada devuelven la factura definitiva existente sin duplicar numeración.
- **SC-005**: El 100% de los intentos de emitir una factura definitiva sin datos tributarios mínimos o sin liquidación `Final` son rechazados sin asignar numeración oficial.
- **SC-006**: El 100% de las facturas definitivas permanecen inmutables tras su emisión durante pruebas de auditoría posterior.
- **SC-007**: El 100% de las prefacturas asociadas a liquidaciones `Cancelled` quedan descartadas sin derivar en una factura definitiva.
