# Especificación de funcionalidad: Actualizar porcentaje de IVA

**Creado**: 2026-09-18

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - El Administrador actualiza el porcentaje de IVA vigente (Prioridad: P1)

Como Administrador, quiero actualizar el porcentaje de IVA que el sistema aplica al hospedaje, para mantenerlo alineado con la legislación tributaria vigente.

**Por qué esta prioridad**: `Generar factura final` calcula el IVA aplicando el porcentaje vigente configurado por el Administrador, sin invocar un caso de uso de cálculo independiente (FR-002 de `generar_factura_final.md`). Sin esta funcionalidad, ese porcentaje quedaría fijo o desactualizado, y el sistema no podría reflejar cambios en la normativa tributaria.

**Prueba independiente**: Se puede actualizar el porcentaje de IVA a un nuevo valor válido y verificar que una factura generada después del cambio aplica ese nuevo porcentaje.

**Escenarios de aceptación**:

1. **Escenario**: Actualización exitosa del porcentaje
   - **Dado** que existe un porcentaje de IVA vigente configurado
   - **Cuando** el Administrador ingresa un nuevo porcentaje válido
   - **Entonces** el sistema lo registra como el porcentaje vigente y queda disponible para su uso inmediato en operaciones posteriores

2. **Escenario**: Rechazo de un porcentaje inválido
   - **Dado** que el Administrador intenta actualizar el porcentaje con un valor negativo o fuera de un rango tributario razonable
   - **Cuando** se envía la solicitud de actualización
   - **Entonces** el sistema rechaza el cambio, informa el motivo, y conserva el porcentaje vigente anterior sin modificarlo

---

### Historia de usuario 2 - Un cambio de porcentaje nunca afecta facturas ya emitidas (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación, quiero que actualizar el porcentaje de IVA no modifique ninguna factura ya emitida, para preservar el carácter inmutable de la factura fiscal definitiva.

**Por qué esta prioridad**: Es una garantía ya comprometida en `generar_factura_final.md` (BR-005, FR-006): la factura es inmutable una vez emitida, y un cambio posterior del porcentaje de IVA no la afecta. `Actualizar porcentaje de IVA` debe respetar esa garantía en lugar de contradecirla.

**Prueba independiente**: Se puede emitir una factura con un porcentaje de IVA conocido, actualizar luego el porcentaje vigente a un valor distinto, y verificar que la factura ya emitida conserva su IVA y su total originales sin cambios.

**Escenarios de aceptación**:

1. **Escenario**: Factura emitida antes del cambio
   - **Dado** que existe una factura fiscal definitiva ya emitida con un porcentaje de IVA determinado
   - **Cuando** el Administrador actualiza el porcentaje de IVA vigente a un valor distinto
   - **Entonces** la factura ya emitida conserva su desglose y total originales, sin recalcularse

2. **Escenario**: Nuevas facturas tras el cambio
   - **Dado** que el porcentaje de IVA vigente fue actualizado
   - **Cuando** se emite una factura para una liquidación `Final` posterior al cambio
   - **Entonces** esa factura aplica el nuevo porcentaje vigente

### Casos límite

- Actualización con un porcentaje negativo o mayor a un límite tributario razonable: el sistema debe rechazarla y conservar el porcentaje vigente anterior.
- Actualizaciones concurrentes por más de un Administrador casi al mismo tiempo: el sistema debe garantizar que solo una quede registrada como vigente de forma consistente, sin dejar el porcentaje en un estado ambiguo o corrupto.
- Actualización a un valor idéntico al porcentaje ya vigente: el sistema la acepta como una operación válida sin efectos inesperados, aunque no cambie el valor efectivo.
- Intento de actualizar el porcentaje sin dejar registrado quién hizo el cambio o cuándo: el sistema debe rechazar la operación o completarla solo si puede registrar esa trazabilidad.
- Estado inicial del sistema sin ningún porcentaje de IVA configurado: no es un estado operativo válido; el sistema debe exigir un porcentaje vigente antes de permitir la generación de facturas.
- Actor distinto al Administrador intenta actualizar el porcentaje: el sistema debe rechazar la operación.
- Una liquidación `Final` está en proceso de generar su factura en el instante exacto de una actualización: el sistema debe aplicar de forma consistente uno solo de los dos porcentajes (el anterior o el nuevo), nunca una mezcla ni un valor indeterminado, conforme al principio de un único porcentaje vigente en todo momento (BR-003).

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir al actor Administrador actualizar el porcentaje de IVA vigente aplicado al hospedaje.
- **FR-002**: El sistema DEBE validar que el nuevo porcentaje sea un valor numérico no negativo y dentro de un rango tributario razonable, rechazando la actualización en caso contrario.
- **FR-003**: El sistema DEBE mantener en todo momento un único porcentaje de IVA vigente; no debe existir un estado operativo sin ningún porcentaje configurado.
- **FR-004**: El sistema NO DEBE recalcular ni modificar ninguna factura ya emitida como efecto de una actualización del porcentaje de IVA, conforme a BR-005 de `generar_factura_final.md`.
- **FR-005**: El sistema DEBE registrar quién realizó cada actualización del porcentaje de IVA y en qué momento, para fines de trazabilidad y auditoría.
- **FR-006**: El sistema DEBE restringir la actualización del porcentaje de IVA exclusivamente al actor Administrador.
- **FR-007**: El sistema DEBE garantizar que, ante actualizaciones concurrentes, únicamente una quede registrada como vigente de forma consistente, sin dejar el porcentaje vigente en un estado ambiguo.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Porcentaje de IVA vigente**: Tasa activa única que el sistema aplica al calcular el IVA de cada factura en el momento de su emisión, conforme a FR-002 de `generar_factura_final.md`.
- **Historial de actualización de IVA**: Registro de cada cambio de porcentaje, con el valor anterior, el nuevo valor, el Administrador responsable y la fecha y hora del cambio.

### Reglas de negocio

- **BR-001**: Solo el Administrador puede actualizar el porcentaje de IVA vigente.
- **BR-002**: Un cambio de porcentaje jamás afecta facturas ya emitidas (conforme a BR-005 de `generar_factura_final.md`).
- **BR-003**: Debe existir en todo momento exactamente un porcentaje de IVA vigente; el sistema nunca opera con un valor indefinido.

## Requisitos no funcionales

- **NFR-001**: Auditabilidad: cada actualización debe quedar trazada con el Administrador responsable y una marca de tiempo verificable.
- **NFR-002**: Consistencia: ante actualizaciones concurrentes, el resultado final debe ser determinista y único, sin condiciones de carrera que dejen dos porcentajes vigentes simultáneos.
- **NFR-003**: Disponibilidad inmediata: el nuevo porcentaje debe regir para las operaciones posteriores a su actualización sin demoras perceptibles.
- **NFR-004**: Validación: el porcentaje debe verificarse contra límites tributarios razonables antes de aceptarse, evitando valores absurdos o negativos.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de las facturas emitidas después de una actualización aplican el nuevo porcentaje vigente.
- **SC-002**: El 0% de las facturas ya emitidas antes de una actualización se ve alterado por ella.
- **SC-003**: El 100% de los intentos de actualización con un porcentaje inválido (negativo o fuera de rango) son rechazados sin alterar el porcentaje vigente.
- **SC-004**: El 100% de las actualizaciones exitosas quedan registradas con el Administrador responsable y la fecha y hora del cambio.
- **SC-005**: El 100% de los intentos de actualización por un actor distinto al Administrador son rechazados.
