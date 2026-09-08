# Diccionario General del Proyecto HOSPITUA

**Creado**: 2026-09-07



Glosario compartido por los tres módulos del proyecto, para que todos usemos los mismos términos con el mismo significado.

## Actores

* **Administrador**: Usuario interno con permisos transversales. En Módulo 1: registrar, editar, dar de baja y reactivar habitaciones del inventario. En Módulo 3: gestionar facturación, revisar/modificar tarifas por temporada, y actualizar el porcentaje de IVA.
* **Personal de limpieza**: Actor de Módulo 1 responsable de ejecutar el aseo de las habitaciones: marca el inicio de la limpieza y confirma su finalización, dejando la habitación lista para uso.
* **Personal de mantenimiento**: Actor de Módulo 1 que inhabilita habitaciones por reparaciones o las pone en bloqueo técnico preventivo, y confirma cuando la intervención finaliza.
* **Gerente**: Actor de Módulo 1 con acceso de solo lectura a reportes de estado y al inventario completo de habitaciones.
* \*\*\*Recepcionista\*\*\*: Usuario interno encargado de la operación en el front-desk del hotel. Es el actor principal del Módulo 2, responsable de gestionar reservas directas, admitir huéspedes (Check-In), registrar consumos locales, formalizar salidas (Check-Out) y procesar cancelaciones.
* Migración: Ente externo gubernamental (Migración Colombia). En el sistema, actúa como actor que ingresa de forma autenticada a una ventana de autogestión o portal exclusivo para filtrar por fechas y descargar de manera directa el archivo estructurado .TXT (SIRE) generado por el Módulo 2. El hotel no realiza envíos automáticos; la descarga asíncrona la realiza este actor.
* **Módulo 1 (Gestión de Habitaciones e Inventario de Aforo)**: Digitaliza la infraestructura física del hotel y controla la disponibilidad en tiempo real.
* **Módulo 2 (Operación de Reservas y Cumplimiento Legal)**: Procesa la entrada y salida de huéspedes, gestiona el origen de la reserva y el cumplimiento migratorio (SIRE). Es la fuente de todos los eventos y datos de reserva que consume Módulo 3.
* **Módulo 3 (Facturación, Consumos y Liquidación)**: Traduce la estancia en datos financieros: hospedaje, comisión OTA e IVA, consolidados en la liquidación y la factura.
* **OTA (Booking, Airbnb, Expedia)**: Intermediario externo que origina reservas con comisión pactada. Aparece como dato del canal de la reserva en casi todos los casos de uso de Módulo 3, y como actor que consulta directamente en "Consultar liquidación".
* **Huésped**: Persona que se aloja en una habitación durante una estancia.
* **Responsable de facturación (rol)**: Forma en que varias historias de Módulo 3 nombran a quien necesita el ingreso neto, la comisión y el IVA correctamente reflejados para conciliar; no es un actor propio del diagrama, sino el Administrador actuando en su función de facturación.

## Módulo 1: Gestión de Habitaciones e Inventario de Aforo

* **Habitación**: Unidad de alojamiento con identificación (UUID, número, piso/ala), categorización (tipo, capacidad máxima) y tarifa base.
* **Estado de habitación**: Situación operativa actual de una habitación (`Room.status`), con 7 valores vigentes: `Available` (Disponible), `Occupied` (Ocupada), `PendingCleaning` (Pendiente de limpieza), `InCleaning` (En limpieza), `DisabledForRepairs` (Inhabilitada por reparaciones), `TechnicalBlock` (Bloqueo técnico) e `Inactive` (Inactiva).
* **Tarifa base**: Valor regular de una habitación, usado como punto de partida del cálculo de tarifa dinámica (Módulo 3).



## Módulo 2: Operación de Reservas y Cumplimiento Legal

* **Reserva**: Registro de la relación entre un huésped y una habitación, con fechas de check-in y check-out, tipo de habitación y canal de origen.
* Ciclo de Vida de la Reserva (Reservation.state): Estados de control lógico gobernados de manera estricta por el Módulo 2:

  * ACTIVE: Estado inicial por defecto de toda reserva (directa u OTA). Dado que el 100% de la estadía se liquida en el Check-Out, no se cobra garantía para canales directos, lo que permite inhabilitar el estado PENDING para este flujo.
  * CHECKED\_IN: El huésped ha realizado el Check-In físico exitosamente en el front-desk.
  * CHECKED\_OUT: El huésped ha realizado el Check-Out físico y ha liquidado el saldo financiero neto consolidado en Módulo 3.
  * CANCELLED: Reserva anulada de forma logística. Libera el inventario local de la categoría de habitación en Módulo 2
* **Canal de origen**: Clasificación de la reserva como **Canal Directo** (recepción, teléfono, portal propio; 0% comisión) o **OTA** (intermediario con comisión pactada y código de confirmación externo). Sin canal registrado, se asume Canal Directo.
* Desacoplamiento de Inventario ("Aforo Lógico"): Mecanismo mediante el cual el Módulo 2 calcula la disponibilidad de cupos de alojamiento para reservas y modificaciones. Se procesa de forma 100% local en la base de datos de reservas del Módulo 2, restando las reservas activas del aforo de la categoría, sin realizar consultas síncronas al Módulo 
* **Código de confirmación externo**: Identificador que la OTA asigna a la reserva; obligatorio en canal OTA, usado para trazabilidad y para restringir que cada OTA solo consulte sus propias reservas.
* **Check-in / Check-out**: Eventos que activan la generación de la liquidación (el check-in genera la liquidación `Preliminary`, el check-out genera la `Final`) y que también disparan transiciones automáticas sobre el estado de la habitación en Módulo 1: el check-in marca la habitación de `Available` a `Occupied`, y el check-out la marca de `Occupied` a `PendingCleaning`.
* **SIRE (Validación Migratoria)**: Conjunto de datos obligatorios (documento de identidad, nacionalidad, tipo de visa, fechas de estancia) validado antes del check-in y exportado como archivo plano `.TXT` para las autoridades de migración.
* Estado de Exportación SIRE (sireExportStatus): Atributo de control dentro de la validación migratoria (MigratoryValidation) del Módulo 2. Maneja únicamente dos estados:

  * PENDING: Registro de extranjero validado en el Check-In y pendiente de 	ser exportado en el reporte .TXT.
  * EXPORTED: Registro ya descargado por el actor Migración en un archivo plano de reporte.

## Módulo 3: Facturación, Consumos y Liquidación

### Tarifas

* **Temporada (baja / regular / alta)**: Clasificación de una fecha según reglas de estacionalidad, en una de tres categorías — temporada baja, regular o alta — que determina el sentido del ajuste dinámico aplicado sobre la tarifa base (alta = incremento, baja = decremento, regular = ajuste neutro).
* **Tarifa dinámica**: Resultado de ajustar la tarifa base según la regla de temporada aplicable a cada noche.
* **Valor de hospedaje (bruto)**: Suma de las tarifas dinámicas de todas las noches de la estancia, antes de descontar comisión OTA. Es la base que la liquidación reutiliza sin recalcular.

### Comisión OTA

* **Comisión OTA**: Porcentaje pactado con un intermediario, aplicado sobre el valor de hospedaje cuando la reserva proviene de un canal OTA.
* **Fórmula de comisión**: `- (Valor Hospedaje × % Comisión)`. Solo se aplica si el canal es OTA; en Canal Directo o sin canal registrado, la comisión es siempre cero.

### Impuestos

* **IVA**: Impuesto al Valor Agregado, calculado sobre el valor de hospedaje (nunca sobre la comisión OTA descontada). No forma parte del ingreso neto de la liquidación; se incorpora en la generación de la factura final.
* **Base gravable**: Valor de hospedaje (original o de noches adicionales por extensión) sobre el que se calcula el IVA.
* **Porcentaje de IVA vigente**: Tasa configurada por el Administrador; se fija en el check-in para el hospedaje original y solo cambia para noches adicionales de una extensión.

### Liquidación

* **Liquidación**: Resultado del proceso de liquidar una estancia. Incluye estado, valor de hospedaje, comisión OTA aplicada (si corresponde) e ingreso neto. Solo existe a partir de un evento de check-in o check-out.
* **Estados de la liquidación**: 3 estados vigentes — `Preliminary` (Preliminar: check-in, visible como estimado, recalculable), `Final` (Definitivo: check-out, único por estancia, no se recalcula), `Cancelled` (Anulado: si se notifica la anulación del check-in antes del check-out; conserva el registro pero nunca deriva en un `Final`).

* **Ingreso neto**: Valor de hospedaje menos la comisión OTA aplicable, sin incluir impuestos. Es el valor que reutiliza la generación de la factura final.
* **Detalle / Desglose de liquidación**: Desglose que identifica el valor de hospedaje, el canal, la comisión aplicada y el ingreso neto de una liquidación específica.

### Factura

* **Prefactura**: Documento en borrador generado al check-in; sin numeración oficial, mutable mientras la liquidación se mantenga en estado `Preliminary`; no es un documento fiscal válido ante terceros.
* **Factura fiscal definitiva**: Documento formal generado al check-out; con numeración consecutiva oficial, inmutable una vez emitida.
* **Numeración consecutiva oficial**: Secuencia única y ordenada de números asignados exclusivamente a facturas definitivas; nunca a prefacturas.
* **Cliente responsable de facturación**: Datos tributarios mínimos (nombre o razón social, documento fiscal) requeridos para emitir una factura definitiva.
* **Desglose facturable**: Hospedaje, comisión OTA (solo como referencia informativa, nunca como cargo al huésped), IVA y total, expuestos en cada factura.

### Gestión y consulta

* **Consulta de liquidación**: Solicitud de un actor autorizado para obtener el desglose y estado de la liquidación de una estancia, sin recalcularla.
* **Resultado de consulta**: Desglose de hospedaje, comisión OTA, IVA e ingreso neto, junto con el estado (`Preliminary`, `Final` o `Cancelled`) y la factura asociada, devuelto por una consulta de liquidación.
* **Ámbito de acceso por actor**: Regla de visibilidad que limita a cada actor externo a ver únicamente las liquidaciones que le corresponden.
* **Criterio de búsqueda / Resultado de búsqueda**: Filtros (estancia, cliente, canal, rango de fechas, estado) y resultados que el Administrador usa para localizar facturas ya emitidas, sin crear ni modificar nada.
* **Detalle de factura consultada**: Vista de solo lectura del desglose completo y la trazabilidad de una factura específica, idéntica a la generada originalmente.
* **Resumen consolidado**: Agregado de totales de hospedaje, comisión OTA e IVA por canal de origen y por estado (`Final` o `Preliminary`), calculado sobre un rango de fechas, usado por el Administrador para conciliar con cada OTA.

