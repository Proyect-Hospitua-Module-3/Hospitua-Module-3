# Especificación de funcionalidad: Actualizar porcentaje de IVA

**Creado**: 2026-09-07  

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de usuario 1 - Configurar el porcentaje de IVA vigente (Prioridad: P1)

Como Administrador, quiero configurar el porcentaje de IVA aplicable según la legislación local, para que el sistema calcule correctamente el impuesto sobre el hospedaje en cada liquidación.

**Por qué esta prioridad**: Es el insumo obligatorio de "Calcular Impuesto (IVA)" (relación `<<include>>` del diagrama de casos de uso); sin un porcentaje vigente configurado no puede completarse ninguna liquidación ni factura final.

> **Supuesto a confirmar**: En el diagrama de casos de uso del Módulo 3, la línea de asociación del actor Administrador no llega dibujada explícitamente hasta "Actualizar porcentaje de IVA" (solo hasta "Revisar temporada del año" y "Gestionar facturación"). Sin embargo, el spec `calcular_impuesto_iva.md` ya confirma textualmente que el porcentaje es "configurado por el Administrador mediante 'Actualizar porcentaje de IVA'", por lo que este documento asume ese mismo actor con mayor respaldo que en otros casos similares del módulo.

**Prueba independiente**: Se puede ingresar como Administrador, configurar un nuevo porcentaje de IVA, guardar el cambio, y verificar que quede disponible como el porcentaje vigente para la siguiente ejecución de "Calcular Impuesto (IVA)".

**Escenarios de aceptación**:

1. **Escenario**: Configuración exitosa de un nuevo porcentaje
   - **Dado** que el Administrador ha iniciado sesión
   - **Cuando** ingresa un nuevo porcentaje de IVA válido y confirma el guardado
   - **Entonces** el sistema actualiza el porcentaje vigente y lo deja disponible para "Calcular Impuesto (IVA)"

2. **Escenario**: Intento de configuración con un porcentaje inválido
   - **Dado** que el Administrador está configurando el porcentaje de IVA
   - **Cuando** ingresa un valor negativo, no numérico, o fuera de un rango lógico razonable
   - **Entonces** el sistema rechaza el cambio, muestra un mensaje de error y no persiste la modificación

---

### Historia de usuario 2 - Exponer el porcentaje vigente en el momento exacto de cada invocación (Prioridad: P1)

Como sistema de Facturación, Consumos y Liquidación (Módulo 3), quiero que "Actualizar porcentaje de IVA" siempre exponga el porcentaje vigente en el momento en que se le invoca, para que "Calcular Impuesto (IVA)" pueda fijar correctamente la tasa del check-in y, si aplica, la de una extensión de estancia en el check-out.

**Por qué esta prioridad**: `calcular_impuesto_iva.md` depende de que cada invocación (check-in y, si hay extensión, check-out) reciba el porcentaje realmente vigente en ese instante; un valor desactualizado alteraría el monto de IVA fijado para las noches correspondientes.

**Prueba independiente**: Se puede configurar un cambio de porcentaje entre dos momentos, invocar la exposición del valor vigente antes y después del cambio, y verificar que cada invocación refleje el valor vigente en su propio momento.

**Escenarios de aceptación**:

1. **Escenario**: El porcentaje cambia entre el check-in y el check-out
   - **Dado** que el porcentaje de IVA vigente cambió después del check-in de una estancia
   - **Cuando** "Calcular Impuesto (IVA)" invoca la exposición del valor para las noches adicionales de una extensión en el check-out
   - **Entonces** el sistema expone el porcentaje vigente en ese momento, no el que estaba vigente en el check-in

2. **Escenario**: Invocaciones repetidas sin cambios devuelven el mismo valor
   - **Dado** que el porcentaje vigente no ha cambiado
   - **Cuando** se invoca la exposición del valor más de una vez
   - **Entonces** el sistema devuelve siempre el mismo porcentaje

---

### Historia de usuario 3 - Impedir el cálculo cuando no exista un porcentaje vigente configurado (Prioridad: P1)

Como responsable de facturación, quiero que el sistema impida calcular el IVA cuando nunca se haya configurado un porcentaje vigente, para evitar que se asuma una tasa de cero o un valor supuesto.

**Por qué esta prioridad**: Sustituir un porcentaje faltante por cero generaría una liquidación con un IVA incorrecto y expondría al hotel a un incumplimiento tributario.

**Prueba independiente**: Se puede invocar "Calcular Impuesto (IVA)" sin que exista nunca un porcentaje configurado y verificar que el sistema informe la ausencia en vez de exponer 0% como si fuera un valor válido.

**Escenarios de aceptación**:

1. **Escenario**: No existe un porcentaje configurado
   - **Dado** que nunca se ha configurado un porcentaje de IVA en el sistema
   - **Cuando** "Calcular Impuesto (IVA)" intenta obtenerlo
   - **Entonces** el sistema informa la ausencia de configuración, sin exponer un valor sustituto

### Casos límite

- El nuevo porcentaje ingresado es idéntico al vigente: el sistema debe aceptar el guardado sin error, tratándolo como una operación sin cambio real.
- El porcentaje se configura en 0% (exención total): debe aceptarse como un valor válido y explícito, distinto de la ausencia de configuración.
- El porcentaje cambia varias veces el mismo día: cada invocación debe reflejar el valor vigente en el instante exacto en que ocurre, no un promedio ni el primero del día.
- Dos Administradores intentan configurar el porcentaje al mismo tiempo: el sistema debe evitar que un cambio sobrescriba al otro sin control.
- Una liquidación ya calculó y persistió su propio porcentaje en el check-in: un cambio posterior en "Actualizar porcentaje de IVA" no debe alterar retroactivamente ese monto ya fijado; solo las noches adicionales de una extensión de estancia usan el porcentaje vigente al momento del check-out, sin importar en qué momento exacto ocurrió el cambio.
- El porcentaje configurado supera el 100% o cualquier rango lógico razonable definido por el negocio: el sistema debe rechazar la configuración en vez de aceptarla como válida.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE permitir al Administrador configurar el porcentaje de IVA vigente aplicable al hospedaje.
- **FR-002**: El sistema DEBE validar que el porcentaje ingresado sea numérico, no negativo, y se encuentre dentro de un rango lógico razonable antes de persistir el cambio.
- **FR-003**: El sistema DEBE exponer el porcentaje vigente a cualquier caso de uso que lo incluya (`<<include>>`), en particular a "Calcular Impuesto (IVA)", reflejando siempre el valor vigente en el momento exacto de la invocación.
- **FR-004**: El sistema DEBE restringir la configuración del porcentaje de IVA exclusivamente al rol Administrador.
- **FR-005**: El sistema DEBE registrar el historial de cambios del porcentaje de IVA (porcentaje anterior, porcentaje nuevo, usuario que modifica, fecha de modificación).
- **FR-006**: El sistema DEBE indicar la ausencia de un porcentaje vigente configurado cuando nunca se haya establecido un valor válido, sin exponer un valor sustituto de cero.
- **FR-007**: El sistema NO DEBE alterar retroactivamente el monto de IVA ya calculado y persistido para noches previamente liquidadas cuando el porcentaje vigente cambie; un cambio solo afecta cálculos nuevos realizados después de él.
- **FR-008**: El sistema DEBE manejar solicitudes concurrentes de configuración del porcentaje sin generar inconsistencias de datos.

### Entidades clave *(incluir si la funcionalidad maneja datos)*

- **Porcentaje de IVA**: Tasa vigente aplicable al hospedaje, definida según la legislación local, configurada y mantenida por el Administrador.
- **Historial de configuración**: Registro de cambios del porcentaje, con su autor, momento, valor anterior y valor nuevo.
- **Administrador**: Usuario con permisos para configurar el porcentaje de IVA (ver nota de supuesto en la Historia 1).

### Reglas de negocio

- **BR-001**: El porcentaje de IVA es una configuración interna del Módulo 3, mantenida por el Administrador; "Calcular Impuesto (IVA)" no depende de ninguna fuente externa para obtenerlo.
- **BR-002**: La configuración del porcentaje está restringida exclusivamente al rol Administrador.
- **BR-003**: El porcentaje expuesto debe ser siempre el vigente en el momento exacto de cada invocación, permitiendo que una misma estancia use tasas distintas para el hospedaje original y para las noches de una extensión, según corresponda.
- **BR-004**: Un cambio de porcentaje no debe alterar retroactivamente los montos de IVA ya calculados y persistidos en liquidaciones previas.
- **BR-005**: La ausencia de un porcentaje vigente configurado detiene el cálculo que lo invoca; el sistema no sustituye el valor faltante por cero ni por un valor por defecto.

### Preguntas abiertas

- **OQ-001**: [REQUIERE ACLARACIÓN: cuál es el rango lógico razonable de un porcentaje de IVA válido, dado que la legislación local puede variar].
- **OQ-002**: [REQUIERE ACLARACIÓN: qué política de concurrencia debe aplicarse cuando dos Administradores configuran el porcentaje al mismo tiempo].
- **OQ-003**: [REQUIERE ACLARACIÓN: si el porcentaje de IVA puede variar por tipo de servicio o tipo de habitación, o si es un único valor aplicable a todo el hospedaje del Módulo 3].

## Requisitos no funcionales

- **NFR-001**: La configuración del porcentaje debe completarse en un tiempo adecuado para no interrumpir la operación de facturación.
- **NFR-002**: El porcentaje vigente debe exponerse de forma inmediata y consistente a "Calcular Impuesto (IVA)", sin retrasos de propagación ni dependencia de una copia cacheada desactualizada.
- **NFR-003**: Los mensajes de error de validación deben ser comprensibles y accionables para el Administrador.
- **NFR-004**: El registro de historial de cambios no debe exponer datos personales de huéspedes; solo debe contener información de configuración tributaria y del usuario administrador que realizó el cambio.
- **NFR-005**: Determinismo: para el mismo estado de configuración vigente, cada exposición del porcentaje debe devolver siempre el mismo valor.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El Administrador puede configurar el porcentaje de IVA en menos de 1 minuto desde que inicia la edición.
- **SC-002**: El sistema rechaza el 100% de los intentos de configuración con valores de porcentaje inválidos (negativos, no numéricos, o fuera del rango lógico razonable).
- **SC-003**: El 100% de las invocaciones realizadas en momentos distintos, con porcentajes vigentes distintos en cada momento, exponen el valor correspondiente a su propio momento, sin reutilizar un valor cacheado.
- **SC-004**: El 100% de los montos de IVA ya calculados y persistidos permanecen sin cambios ante una configuración posterior del porcentaje.
