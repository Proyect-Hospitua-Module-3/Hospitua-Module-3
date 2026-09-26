# Diccionario General del Proyecto HOSPITUA

**Creado**: 2026-09-07

Glosario compartido por los tres módulos del proyecto, para que todos usemos los mismos términos con el mismo significado.

## Actores

- **Administrador**: Usuario interno con permisos transversales. En Módulo 1: registrar, editar, dar de baja y reactivar habitaciones del inventario. En Módulo 3: gestionar facturación, revisar/modificar tarifas por temporada, y actualizar el porcentaje de IVA.
- **Personal de limpieza**: Actor de Módulo 1 responsable de ejecutar el aseo de las habitaciones: marca el inicio de la limpieza y confirma su finalización, dejando la habitación lista para uso.
- **Personal de mantenimiento**: Actor de Módulo 1 que inhabilita habitaciones por reparaciones o las pone en bloqueo técnico preventivo, y confirma cuando la intervención finaliza.
- **Gerente**: Actor de Módulo 1 con acceso de solo lectura a reportes de estado y al inventario completo de habitaciones.
- **Recepcionista**: Usuario interno encargado de la operación en el front-desk del hotel. Es actor de **Módulo 1** para admitir huéspedes (Check-In) y formalizar salidas (Check-Out), y actor de **Módulo 2** para gestionar reservas directas y procesar cancelaciones.
- **Migración**: Ente externo gubernamental (Migración Colombia). En el sistema, actúa como actor que ingresa de forma autenticada a una ventana de autogestión o portal exclusivo para filtrar por fechas y descargar de manera directa el archivo estructurado .TXT (SIRE) generado por el Módulo 2. El hotel no realiza envíos automáticos; la descarga asíncrona la realiza este actor.
- **Módulo 1 (Gestión de Habitaciones e Inventario de Aforo)**: Digitaliza la infraestructura física del hotel y controla la disponibilidad en tiempo real.
- **Módulo 1 (Gestión de Habitaciones e Inventario de Aforo, Check-In y Check-Out)**: Digitaliza la infraestructura física del hotel, controla la disponibilidad en tiempo real, y gestiona directamente la admisión y salida física de los huéspedes.
- **Módulo 2 (Operación de Reservas y Cumplimiento Legal)**: Gestiona el ciclo de vida de la reserva, el origen de la reserva y el cumplimiento migratorio (SIRE). Es la fuente de los datos de reserva que consumen Módulo 1 y Módulo 3, y recibe de Módulo 1 las notificaciones de Check-In/Check-Out para actualizar el estado de sus reservas.
- **OTA (Booking, Airbnb, Expedia)**: Intermediario externo que origina reservas con comisión pactada. Aparece como dato del canal de la reserva en casi todos los casos de uso de Módulo 3, y como actor que consulta directamente en "Consultar liquidación".
- **Huésped**: Persona que se aloja en una habitación durante una estancia.
- **Responsable de facturación (rol)**: Forma en que varias historias de Módulo 3 nombran a quien necesita el ingreso neto, la comisión y el IVA correctamente reflejados para conciliar; no es un actor propio del diagrama, sino el Administrador actuando en su función de facturación.

## Módulo 1: Gestión de Habitaciones e Inventario de Aforo, Check-In y Check-Out

- **Habitación**: Unidad de alojamiento con identificación (UUID, número, piso/ala), categorización (tipo, capacidad máxima) y tarifa base.
- **Estado de habitación**: Situación operativa actual de una habitación (`Room.status`), con **8 valores vigentes**: `Available` (Disponible), `Reserved` (existe una reserva asociada en Módulo 2, aún no ocupada; se marca por evento de Módulo 2, no por consulta activa de Módulo 1), `Occupied` (Ocupada), `PendingCleaning` (Pendiente de limpieza), `InCleaning` (En limpieza), `DisabledForRepairs` (Inhabilitada por reparaciones), `TechnicalBlock` (Bloqueo técnico) e `Inactive` (Inactiva).
- **Tarifa base**: Valor regular de una habitación, usado como punto de partida del cálculo de tarifa dinámica (Módulo 3).
- **Check-in / Check-out**: Eventos gestionados directamente por **Módulo 1**, ejecutados por el Recepcionista.
  - El **Check-In** transiciona la habitación de `Available` o `Reserved` a `Occupied`, de forma interna y síncrona. No genera ninguna liquidación ni interviene Módulo 3. Notifica de forma asíncrona a Módulo 2 para actualizar la reserva a `CHECKED_IN`.
  - El **Check-Out** transiciona la habitación de `Occupied` a `PendingCleaning`, de forma interna y síncrona. Incluye el paso **"Consultar liquidación"**: envía a Módulo 3 las fechas reservadas y reales de la estancia para obtener la liquidación final, y notifica de forma asíncrona a Módulo 2 para actualizar la reserva a `CHECKED_OUT`.
  - Ningún fallo de integración con Módulo 2 o Módulo 3 bloquea la transición física de la habitación en ninguno de los dos eventos.
- **Estancia (Stay)**: Entidad que representa la ocupación física real de una habitación durante un período determinado. Se crea de forma síncrona al confirmar el Check-In y se cierra al registrar el Check-Out. Atributos clave: ID único, referencia de reserva (`reservationRef`), identificador de habitación (`roomId`), fecha/hora de llegada real (`checkInTime`), fecha/hora de salida real (`checkOutTime`), recepcionista de check-in (`receptionistIdCheckIn`) y recepcionista de check-out (`receptionistIdCheckOut`).
- **Ocupante (RoomGuest)**: Entidad inmutable de Módulo 1 que representa a cada persona físicamente alojada en la habitación durante la estancia. Se crea al confirmar el Check-In y no puede modificarse posteriormente. Atributos: nombre completo, tipo de documento de identidad, número de documento y nacionalidad. Vinculada a la Estancia.
- **Reserva (Reservation) — referencia desde Módulo 1**: Registro contractual que origina una estancia, administrado por Módulo 2 y consultado de forma de solo lectura por Módulo 1. Atributos relevantes para Módulo 1: referencia de reserva (`reservationRef`), fecha de inicio (`startDate`), fecha de fin (`endDate`), estado (`status`), habitación asignada (`assignedRoomId`), datos del huésped titular (`guestRef`, nombre, documento, nacionalidad).
- **ReservationQuery**: Objeto conceptual de búsqueda que encapsula los criterios con los que Módulo 1 consulta reservas a Módulo 2: código de reserva (`reservationRef`), número de documento del huésped (`documentNumber`) o nombre completo del titular (`fullName`).
- **ReservationSummary**: Estructura contractual devuelta por Módulo 2 como respuesta a una consulta de reserva. Contiene: `reservationRef`, datos del huésped titular (`guestRef`, `fullName`, `documentNumber`, `documentType`, `nationality`), habitación asignada (`roomId`), fechas de estadía (`startDate`, `endDate`), canal de origen (`source`) y estado de la reserva (`status`).
- **SettlementRequest**: Objeto conceptual que Módulo 1 envía a Módulo 3 al ejecutar "Consultar liquidación" durante el Check-Out. Incluye los parámetros de la estancia: `reservationRef`, `eventType`, `startDate`, `endDate`, `checkInTime`, `checkOutTime`, `source` y `roomId`.
- **SettlementSummary**: Estructura informativa de solo lectura devuelta por Módulo 3 como respuesta a la solicitud de liquidación. Contiene dos grupos: (1) **Resumen para el huésped**: valor del hospedaje (total ya calculado), IVA y total a pagar; y (2) **Información de la operación**: canal de origen, porcentaje de comisión OTA (si aplica), valor de comisión OTA (si aplica), ingreso neto y factura definitiva asociada. Módulo 1 la presenta en recepción pero no recalcula ni modifica sus valores.

## Módulo 2: Operación de Reservas y Cumplimiento Legal

- **Reserva**: Registro de la relación entre un huésped y una habitación, con fechas de check-in y check-out, tipo de habitación y canal de origen.
- Ciclo de Vida de la Reserva (Reservation.state): Estados de control lógico gobernados de manera estricta por el Módulo 2:
  - ACTIVE: Estado inicial por defecto de toda reserva (directa u OTA). Dado que el 100% de la estadía se liquida en el Check-Out, no se cobra garantía para canales directos, lo que permite inhabilitar el estado PENDING para este flujo.
  - CHECKED_IN: El huésped ha realizado el Check-In físico exitosamente en Módulo 1; el estado se actualiza en Módulo 2 mediante la notificación asíncrona que envía Módulo 1 al confirmarse.
  - CHECKED_OUT: El huésped ha realizado el Check-Out físico en Módulo 1 y ha liquidado el saldo financiero neto consolidado en Módulo 3; el estado se actualiza en Módulo 2 mediante la notificación asíncrona correspondiente.
  - CANCELLED: Reserva anulada de forma logística. Libera el inventario local de la categoría de habitación en Módulo 2.

- **Canal de origen**: Clasificación de la reserva como **Canal Directo** (recepción, teléfono, portal propio; 0% comisión) o **OTA** (intermediario con comisión pactada y código de confirmación externo). Sin canal registrado, se asume Canal Directo.
- Desacoplamiento de Inventario ("Aforo Lógico"): Mecanismo mediante el cual el Módulo 2 calcula la disponibilidad de cupos de alojamiento para reservas y modificaciones. Se procesa de forma 100% local en la base de datos de reservas del Módulo 2, restando las reservas activas del aforo de la categoría, sin realizar consultas síncronas al Módulo 1.
- **Código de confirmación externo**: Identificador que la OTA asigna a la reserva; obligatorio en canal OTA, usado para trazabilidad y para restringir que cada OTA solo consulte sus propias reservas.
- **SIRE (Validación Migratoria)**: Conjunto de datos obligatorios (documento de identidad, nacionalidad, tipo de visa, fechas de estancia), capturados por Módulo 1 durante el Check-In y enviados a Módulo 2, quien los valida y exporta como archivo plano `.TXT` para las autoridades de migración.
- Estado de Exportación SIRE (sireExportStatus): Atributo de control dentro de la validación migratoria (MigratoryValidation) del Módulo 2. Maneja únicamente dos estados:
  - PENDING: Registro de extranjero validado en el Check-In y pendiente de ser exportado en el reporte .TXT.
  - EXPORTED: Registro ya descargado por el actor Migración en un archivo plano de reporte.

## Módulo 3: Facturación, Consumos y Liquidación

### Tarifas

- **Temporada (baja / regular / alta)**: Clasificación de una fecha según reglas de estacionalidad, en una de tres categorías — temporada baja, regular o alta — que determina el sentido del ajuste dinámico aplicado sobre la tarifa base (alta = incremento, baja = decremento, regular = ajuste neutro).
- **Tarifa dinámica**: Resultado de ajustar la tarifa base según la regla de temporada aplicable a cada noche.
- **Valor de hospedaje (bruto)**: Suma de las tarifas dinámicas de todas las noches de la estancia, antes de descontar comisión OTA. Es la base que la liquidación reutiliza sin recalcular.

### Comisión OTA

- **Comisión OTA**: Porcentaje pactado con un intermediario, aplicado sobre el valor de hospedaje cuando la reserva proviene de un canal OTA.
- **Fórmula de comisión**: `- (Valor Hospedaje × % Comisión)`. Solo se aplica si el canal es OTA; en Canal Directo o sin canal registrado, la comisión es siempre cero.

### Impuestos

- **IVA**: Impuesto al Valor Agregado, calculado sobre el valor de hospedaje (nunca sobre la comisión OTA descontada). No forma parte del ingreso neto de la liquidación; se incorpora en la generación de la factura final.
- **Base gravable**: Valor de hospedaje (original o de noches adicionales por extensión) sobre el que se calcula el IVA.
- **Porcentaje de IVA vigente**: Tasa configurada por el Administrador; se fija en el check-in para el hospedaje original y solo cambia para noches adicionales de una extensión.

### Liquidación

- **Liquidación**: Resultado del proceso de liquidar una estancia. Incluye estado, valor de hospedaje, comisión OTA aplicada (si corresponde) e ingreso neto. Solo existe a partir de un evento de un check-out.
- **Ingreso neto**: Valor de hospedaje menos la comisión OTA aplicable, sin incluir impuestos. Es el valor que reutiliza la generación de la factura final.
- **Detalle / Desglose de liquidación**: Desglose que identifica el valor de hospedaje, el canal, la comisión aplicada y el ingreso neto de una liquidación específica.

### Factura

- **Prefactura**: Documento en borrador generado al check-in; sin numeración oficial, mutable mientras la liquidación se mantenga en estado `Preliminary`; no es un documento fiscal válido ante terceros.
- **Factura fiscal definitiva**: Documento formal generado al check-out; con numeración consecutiva oficial, inmutable una vez emitida.
- **Numeración consecutiva oficial**: Secuencia única y ordenada de números asignados exclusivamente a facturas definitivas; nunca a prefacturas.
- **Cliente responsable de facturación**: Datos tributarios mínimos (nombre o razón social, documento fiscal) requeridos para emitir una factura definitiva.
- **Desglose facturable**: Hospedaje, comisión OTA (solo como referencia informativa, nunca como cargo al huésped), IVA y total, expuestos en cada factura.

### Gestión y consulta

- **Consulta de liquidación**: Solicitud de un actor autorizado para obtener el desglose y estado de la liquidación de una estancia, sin recalcularla.
- **Resultado de consulta**: Desglose de hospedaje, comisión OTA, IVA e ingreso neto, junto con el estado (`Preliminary`, `Final` o `Cancelled`) y la factura asociada, devuelto por una consulta de liquidación.
- **Ámbito de acceso por actor**: Regla de visibilidad que limita a cada actor externo a ver únicamente las liquidaciones que le corresponden.
- **Criterio de búsqueda / Resultado de búsqueda**: Filtros (estancia, cliente, canal, rango de fechas, estado) y resultados que el Administrador usa para localizar facturas ya emitidas, sin crear ni modificar nada.
- **Detalle de factura consultada**: Vista de solo lectura del desglose completo y la trazabilidad de una factura específica, idéntica a la generada originalmente.
- **Resumen consolidado**: Agregado de totales de hospedaje, comisión OTA e IVA por canal de origen y por estado (`Final` o `Preliminary`), calculado sobre un rango de fechas, usado por el Administrador para conciliar con cada OTA.
