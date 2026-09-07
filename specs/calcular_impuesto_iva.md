# Especificación de funcionalidad: Calcular Impuesto (IVA)

**Creado**: 2026-09-06  

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Calcular el IVA sobre el hospedaje original en el check-in (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero calcular el IVA sobre la base gravable del hospedaje en el check-in, usando el porcentaje vigente en ese momento, para incluirlo en la liquidación inicial y conservarlo como referencia fija para esas noches.

**Por qué esta prioridad**: El IVA es un componente obligatorio de toda liquidación. Fijar el porcentaje al momento del check-in evita que cambios posteriores en la tasa afecten retroactivamente el hospedaje ya calculado.

**Prueba independiente**: Se puede invocar el cálculo en el contexto del check-in con una base gravable y un porcentaje de IVA vigente, y verificar que el resultado sea la multiplicación correcta, redondeada según la política de la moneda, y que el porcentaje utilizado quede persistido junto con la liquidación.

**Escenarios de aceptación**:

1. **Escenario**: Cálculo del IVA con porcentaje vigente en el check-in
	- **Dado** que existe un porcentaje de IVA configurado por el `Administrador` mediante "Actualizar porcentaje de IVA" y una base gravable de hospedaje calculada en el check-in
	- **Cuando** el sistema ejecuta "Calcular Impuesto (IVA)"
	- **Entonces** obtiene el porcentaje vigente en ese momento, calcula el impuesto como el producto entre la base gravable y ese porcentaje, y persiste el porcentaje utilizado junto con el monto resultante como parte del hospedaje original de la estancia.

2. **Escenario**: Cierre sin cambios de fecha
	- **Dado** que el check-out ocurre en la fecha programada, sin extensión ni salida anticipada
	- **Cuando** el sistema ejecuta "Calcular Impuesto (IVA)" en el check-out
	- **Entonces** confirma el mismo monto de IVA calculado en el check-in, sin recalcularlo con un porcentaje distinto.

---

### Historia de usuario 2 - Calcular el IVA sobre las noches adicionales de una extensión de estancia (Prioridad: P2)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero calcular el IVA de las noches adicionales generadas por una extensión de estancia usando el porcentaje vigente al momento del check-out, de forma independiente al porcentaje ya fijado para las noches originales del check-in.

**Por qué esta prioridad**: Si el porcentaje de IVA cambia entre el check-in y el check-out, las noches originales ya liquidadas no deben verse afectadas, pero las noches nuevas sí deben reflejar la tasa vigente al momento en que efectivamente se agregan.

**Prueba independiente**: Se puede simular una extensión de estancia con un porcentaje de IVA distinto al usado en el check-in, y verificar que el sistema calcula dos montos de IVA independientes: uno para las noches originales (con el porcentaje del check-in) y otro para las noches adicionales (con el porcentaje del check-out).

**Escenarios de aceptación**:

1. **Escenario**: Extensión de estancia sin cambio de porcentaje de IVA
	- **Dado** que el porcentaje de IVA vigente al check-out es igual al que estaba vigente en el check-in
	- **Cuando** el sistema calcula el IVA de las noches adicionales
	- **Entonces** aplica el mismo porcentaje, sin que exista diferencia práctica entre ambos bloques.

2. **Escenario**: Extensión de estancia con cambio de porcentaje de IVA
	- **Dado** que el porcentaje de IVA vigente al check-out difiere del que estaba vigente en el check-in
	- **Cuando** el sistema calcula el IVA de las noches adicionales
	- **Entonces** utiliza el porcentaje vigente al momento del check-out únicamente para esas noches adicionales, manteniendo sin cambios el monto de IVA ya calculado para las noches originales.

### Casos límite

- **Salida anticipada (menos noches que las originales)**: El IVA se recalcula sobre el hospedaje reducido, pero usando el mismo porcentaje fijado en el check-in, no uno nuevo, ya que no se trata de una extensión.
- **Porcentaje de IVA igual a cero (exención configurada)**: El sistema debe calcular un impuesto de 0.00 de forma explícita, distinguiendo este caso de un porcentaje no configurado.
- **Cambio del porcentaje de IVA entre el check-in y el check-out sin extensión de estancia**: El cambio de porcentaje no afecta el monto ya calculado en el check-in; solo aplicaría a una extensión, si la hubiera.
- **Base gravable con más decimales que los permitidos por la moneda**: El sistema debe aplicar la misma política de redondeo utilizada en el cálculo de tarifa dinámica, de forma consistente.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE calcular el IVA del hospedaje original como el producto entre la base gravable del check-in y el porcentaje de IVA vigente en ese momento.
- **FR-002**: El sistema DEBE obtener el porcentaje de IVA vigente mediante el caso de uso `Actualizar porcentaje de IVA` (`<<include>>`) en el momento del check-in, y persistir ese porcentaje junto con el monto calculado como valor fijo de la liquidación.
- **FR-003**: Si el check-out no incluye una extensión de estancia (la fecha real de salida es igual o anterior a la programada), el sistema DEBE confirmar el monto de IVA ya calculado en el check-in, sin volver a consultar el porcentaje vigente ni recalcularlo con una tasa distinta.
- **FR-004**: Si el check-out incluye una extensión de estancia (la fecha real de salida es posterior a la programada), el sistema DEBE calcular un segundo monto de IVA correspondiente únicamente a las noches adicionales, usando el porcentaje de IVA vigente al momento del check-out.
- **FR-005**: El sistema DEBE mantener ambos montos de IVA (el del hospedaje original y el de las noches adicionales, si aplica) como valores independientes y sumarlos para obtener el IVA total de la liquidación.
- **FR-006**: El sistema DEBE rechazar el cálculo y no producir un monto de impuesto si el porcentaje de IVA no está configurado o es inválido (negativo, no numérico, o fuera de un rango lógico razonable).
- **FR-007**: El sistema DEBE aplicar la política de redondeo y precisión decimal de la moneda configurada de forma consistente con el cálculo de hospedaje.
- **FR-008**: El sistema DEBE persistir, como parte del desglose auditable de la liquidación o factura, el o los porcentajes de IVA utilizados y los montos resultantes de cada bloque.
- **FR-009**: El sistema NO DEBE aplicar el cálculo de IVA sobre la comisión OTA descontada; el impuesto se calcula únicamente sobre el valor de los servicios de hospedaje.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Base gravable del hospedaje original**: Valor de hospedaje correspondiente a las noches programadas al momento del check-in.
- **Base gravable de noches adicionales**: Valor de hospedaje correspondiente a las noches sumadas por una extensión de estancia, cuando aplica.
- **Porcentaje de IVA del check-in**: Tasa impositiva fijada al momento del check-in, aplicada al hospedaje original y conservada sin cambios hasta el cierre.
- **Porcentaje de IVA de la extensión**: Tasa impositiva vigente al momento del check-out, aplicada únicamente a las noches adicionales de una extensión, cuando aplica.
- **Monto de IVA total**: Suma del IVA del hospedaje original más el IVA de las noches adicionales (si las hay), persistido como parte del desglose auditable.

### Reglas de negocio

- **BR-001**: Fórmula de cálculo: el monto de IVA de cada bloque es igual a su base gravable multiplicada por el porcentaje de IVA correspondiente a ese bloque.
- **BR-002**: La tasa de IVA se obtiene siempre de forma interna mediante `Actualizar porcentaje de IVA`; el cálculo no depende de ninguna fuente o actor externo.
- **BR-003**: El porcentaje de IVA fijado en el check-in para el hospedaje original NO se recalcula en el check-out, salvo que exista una extensión de estancia, en cuyo caso solo las noches adicionales usan el porcentaje vigente al cierre.
- **BR-004**: Una salida anticipada no constituye una extensión de estancia; el hospedaje reducido conserva el porcentaje de IVA fijado en el check-in.
- **BR-005**: Un porcentaje de IVA faltante o inválido detiene el cálculo por completo; el sistema no sustituye el valor faltante por cero ni por un valor por defecto.

## Requisitos no funcionales

- **NFR-001**: Determinismo y exactitud monetaria: para la misma base gravable y el mismo porcentaje vigente en cada bloque, el monto de IVA calculado debe ser siempre idéntico.
- **NFR-002**: Rendimiento: el cálculo debe completarse en un tiempo que no genere demoras perceptibles dentro de los procesos de check-in y check-out que lo invocan.
- **NFR-003**: Consistencia de redondeo: el resultado debe usar la misma precisión y política de redondeo aplicada al resto de los cálculos financieros del Módulo 3.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100% de los cálculos con un porcentaje de IVA vigente y una base gravable válida producen el monto correcto según la fórmula definida.
- **SC-002**: El 100% de los cálculos con porcentaje de IVA no configurado o inválido son rechazados sin generar un monto sustituto.
- **SC-003**: El 100% de las estancias sin extensión conservan en el check-out el mismo monto de IVA calculado en el check-in.
- **SC-004**: El 100% de las estancias con extensión de estancia calculan el IVA de las noches adicionales con el porcentaje vigente al check-out, sin alterar el monto ya fijado para las noches originales.
- **SC-005**: El 0% de los cálculos de IVA incluye la comisión OTA como parte de la base gravable.