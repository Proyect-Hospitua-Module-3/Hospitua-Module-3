# Especificación de funcionalidad: Generar factura final

**Creado**: 2026-09-15

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Emitir la factura fiscal definitiva al registrar el check-out (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero emitir la factura fiscal definitiva con numeración consecutiva oficial cada vez que existe la liquidación `Final` de una estancia (producida por `Generar liquidación`), para formalizar el cobro ante el huésped o la OTA y habilitar la conciliación contable.

**Por qué esta prioridad**: Sin este documento fiscal definitivo la estancia no queda formalmente facturada; es el cierre legal y contable del proceso, y la razón de ser de este caso de uso.

**Prueba independiente**: Se puede cerrar una liquidación mediante `Registrar Check-out` y verificar que `Generar factura final` emite un documento con numeración consecutiva única, el desglose definitivo (hospedaje, comisión si aplica, IVA) y un total inmutable.

**Escenarios de aceptación**:

1. **Escenario**: Emisión de factura definitiva para una liquidación de canal directo
   - **Dado** que `Generar liquidación` acaba de producir la liquidación `Final` de una estancia de canal directo con hospedaje definido
   - **Cuando** el sistema ejecuta `Generar factura final`
   - **Entonces** asigna el siguiente número de la numeración consecutiva oficial, calcula el IVA sobre el hospedaje, y marca la factura como inmutable

2. **Escenario**: Emisión de factura definitiva para una liquidación de canal OTA
   - **Dado** que la liquidación `Final` corresponde a una reserva OTA con comisión ya descontada por `Generar liquidación`
   - **Cuando** el sistema emite la factura definitiva
   - **Entonces** el total facturado al huésped corresponde al valor de hospedaje bruto más el IVA calculado sobre el hospedaje, y la comisión se muestra solo como referencia informativa, sin restarse del total ni exponerse como un cargo al huésped

3. **Escenario**: Reenvío del evento de check-out ya facturado
   - **Dado** que ya existe una factura definitiva emitida para la estancia
   - **Cuando** se vuelve a procesar `Generar liquidación` y `Generar factura final` para esa misma estancia (por ejemplo, un reintento del evento de check-out)
   - **Entonces** el sistema devuelve la factura definitiva ya emitida con el mismo número, sin generar un nuevo número ni un nuevo documento

---

### Historia de usuario 2 - Reflejar el desglose auditable y el total exacto a cobrar (Prioridad: P2)

Como responsable de facturación, quiero que cada factura muestre el desglose completo del hospedaje, la comisión OTA ya descontada, el IVA aplicado y el total a cobrar, para conciliar el cobro con el huésped o con la OTA sin ambigüedad.

**Por qué esta prioridad**: La exactitud del desglose no es indispensable para que el documento exista (eso lo cubre HU1), pero sí para que facturación pueda auditar y conciliar cada factura sin recalcular manualmente; por eso su prioridad es menor.

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

- No existe una liquidación `Final` asociada al evento que dispara `Generar factura final`: el sistema no debe emitir ningún documento.
- Faltan los datos tributarios mínimos del cliente responsable (nombre o razón social, o documento fiscal), recibidos del Módulo 1 en el evento de check-out: el sistema rechaza la emisión y no asigna numeración oficial; la liquidación `Final` subyacente permanece generada, pero la estancia queda sin factura hasta que los datos se completen.
- Salto o duplicado en la numeración consecutiva oficial: el sistema debe garantizar que cada número se asigne una única vez y en orden, sin reutilizar números de facturas ya emitidas.
- El porcentaje de IVA vigente cambia después de emitida una factura: la factura ya emitida no se recalcula ni se corrige retroactivamente; el nuevo porcentaje solo aplica a facturas futuras.
- Reintentos concurrentes del cierre de check-out para la misma estancia: el sistema debe garantizar que solo se asigne un número de la numeración consecutiva, incluso si el evento de check-out se procesa más de una vez casi simultáneamente.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE ejecutar `Generar factura final` como un caso de uso interno que incluye (`<<include>>`) a `Generar liquidación` para obtener la liquidación `Final` de la estancia, nunca como una operación invocable de forma independiente por un actor externo. Al registrarse el check-out desde Módulo 1, el sistema genera la liquidación `Final` y a continuación emite la factura final, reutilizando esa liquidación.
- **FR-002**: El sistema DEBE calcular el monto de IVA correspondiente al hospedaje aplicando el porcentaje de IVA vigente configurado por el Administrador, sin invocar un caso de uso de cálculo independiente.
- **FR-003**: El sistema DEBE calcular el total facturable al huésped como el valor de hospedaje bruto de la liquidación más el IVA calculado sobre ese hospedaje; la comisión OTA y el ingreso neto se muestran solo como referencia y no alteran el total. El sistema no recalcula por su cuenta los componentes recibidos de `Generar liquidación`.
- **FR-004**: El sistema NO DEBE presentar la comisión OTA como un cargo cobrado al huésped; la comisión solo debe exponerse como referencia informativa del pasivo comercial con la OTA.
- **FR-005**: El sistema DEBE asignar a cada factura un número de la numeración consecutiva oficial en el momento de su emisión.
- **FR-006**: El sistema DEBE tratar la factura como inmutable una vez emitida: no debe modificar sus valores ni su número tras la emisión.
- **FR-007**: El sistema DEBE responder de forma idempotente ante un reenvío del evento que originó el cierre de la liquidación, devolviendo la factura ya emitida con el mismo número, sin generar un nuevo documento.
- **FR-008**: El sistema DEBE validar la presencia de los datos tributarios mínimos del cliente responsable (nombre o razón social, y número de identificación tributaria o documento fiscal) antes de emitir la factura; estos datos son los recibidos del Módulo 1 en el evento de check-out, y no se capturan ni se solicitan de forma independiente en este caso de uso.
- **FR-009**: El sistema DEBE rechazar la emisión de la factura y no asignar numeración oficial si faltan los datos tributarios mínimos del cliente responsable o si la liquidación `Final` asociada no existe.
- **FR-010**: El sistema DEBE presentar en cada factura el desglose de hospedaje, comisión OTA (si aplica), IVA y total, de forma que el total sea igual a la suma de sus componentes.
- **FR-011**: El sistema DEBE garantizar que cada número de la numeración consecutiva oficial se asigne una única vez, en orden, sin reutilizar números de facturas ya emitidas, incluso ante reintentos concurrentes del cierre de check-out.
- **FR-012**: El sistema DEBE identificar en cada factura la liquidación de origen y la fecha y hora de emisión, para fines de trazabilidad.
- **FR-013**: El sistema NO DEBE capturar, procesar ni persistir datos de control migratorio en la factura, respetando la frontera de responsabilidad con Módulo 2.
- **FR-014**: El sistema DEBE permitir que la factura generada sea consultada por los actores autorizados a través de `Consultar liquidación`, sin necesidad de recalcularla.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Factura fiscal definitiva**: Documento formal generado al ejecutar `Generar factura final` en el check-out; con numeración consecutiva oficial, inmutable tras su emisión. Es la única clase de factura que produce este caso de uso.
- **Numeración consecutiva oficial**: Secuencia única y ordenada de números asignados a cada factura emitida.
- **Cliente responsable de facturación**: Datos tributarios mínimos (nombre o razón social, documento fiscal) requeridos para emitir una factura válida; suministrados por Módulo 1 en el evento de check-out.
- **Desglose facturable**: Hospedaje, comisión OTA (informativa), IVA y total, expuestos en cada factura.

### Reglas de negocio

- **BR-001**: `Generar factura final` es un caso de uso interno que incluye (`<<include>>`) a `Generar liquidación`; no existe una vía de invocación directa por un actor externo. Se ejecuta como consecuencia del check-out registrado desde Módulo 1, tras generarse la liquidación `Final` que reutiliza.
- **BR-002**: El total facturado nunca incluye la comisión OTA como cargo al huésped; la comisión solo reduce el ingreso neto que recibe el hotel y se muestra como referencia.
- **BR-003**: Una factura, una vez emitida, es inmutable; cualquier corrección o ajuste posterior requiere un mecanismo distinto, fuera del alcance de este caso de uso.
- **BR-004**: Los datos tributarios mínimos del cliente responsable son una condición obligatoria para emitir la factura; su ausencia bloquea únicamente la emisión del documento, no la generación de la liquidación `Final` subyacente.
- **BR-005**: El porcentaje de IVA aplicado en cada factura es el vigente en el momento de su emisión; un cambio posterior de ese porcentaje no afecta facturas ya emitidas.

## Requisitos no funcionales

- **NFR-001**: Determinismo: para la misma liquidación `Final` y los mismos datos tributarios, la factura generada debe ser siempre idéntica en desglose y total.
- **NFR-002**: Rendimiento: la emisión de la factura debe completarse sin demoras perceptibles dentro del flujo de check-out que la incluye.
- **NFR-003**: Integridad de la numeración: la secuencia de numeración consecutiva oficial debe garantizarse incluso ante fallos parciales o reintentos concurrentes del cierre de check-out.
- **NFR-004**: Trazabilidad y auditoría: cada factura debe quedar vinculada de forma verificable a su liquidación de origen y al evento de check-out que la generó.
- **NFR-005**: Privacidad: la factura no debe exponer datos de identificación migratoria ni información personal del huésped que no sea necesaria para el proceso financiero.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las liquidaciones `Final` generan una factura definitiva con numeración consecutiva oficial única, salvo que falten datos tributarios mínimos.
- **SC-002**: El 0% de las facturas muestra la comisión OTA como un cargo cobrado al huésped.
- **SC-003**: El 100% de los reenvíos del evento de cierre de una estancia ya facturada devuelven la factura existente sin duplicar numeración.
- **SC-004**: El 100% de los intentos de emitir una factura sin datos tributarios mínimos o sin liquidación `Final` asociada son rechazados sin asignar numeración oficial.
- **SC-005**: El 100% de las facturas emitidas permanecen inmutables durante pruebas de auditoría posterior.
