# Caso de prueba: Gestionar facturación (008)

**ID:** TC-008-GestionarFacturacion  
**Creado:** 2026-11-09  
**Producto:** HOSPITUA Módulo 3 v0.1.0  
**Responsable:** Equipo Módulo 3  
**Referencia:** [especificación funcional](../1-functional/gestionar_facturacion.md),
[contratos](../2-technical/contracts/GET-invoices.md) y
[mapa de implementación](../3-implementation/implementacion.md).

## Objetivo

Verificar las tres historias: buscar facturas con criterios, abrir su detalle inmutable y
consultar los totales por canal. Las operaciones deben conservar exactamente los importes
emitidos por 006, restringir el acceso al Administrador y no modificar facturas ni liquidaciones.

## Preparación

Desde `Hospitua-Module-3`, con Docker Desktop iniciado y `.env` configurado:

```powershell
docker compose up -d --wait
npm.cmd run prisma:migrate
```

Al preparar una base nueva, ejecutar también `npm.cmd run prisma:seed` para crear los usuarios.
Iniciar `npm.cmd run start:dev`; en otra terminal, entrar a `frontend` y ejecutar `npm.cmd run dev`.
Abrir <http://localhost:5173/facturas> e iniciar sesión con `SEED_ADMIN_USERNAME` y
`SEED_ADMIN_PASSWORD`. La documentación de la API está en <http://localhost:3000/docs>.

Se necesitan facturas generadas por el flujo normal de 010 → 007 → 006, al menos una directa
y dos de distintas OTA; para prepararlas, seguir el [TC-010](../../010-registrar-checkout/4-testing/TC-010-registrar-checkout.md).
Anotar reserva, estancia, documento fiscal, fecha local de emisión y número oficial de cada una.
Para paginación, preparar más facturas que el tamaño de página seleccionado. Usar un entorno de
pruebas: este caso no requiere borrar datos ni reiniciar el consecutivo oficial.

## Ejecución manual

| Paso | Acción | Resultado esperado |
|---|---|---|
| 1 | Abrir Facturas emitidas sin buscar | Se explican los criterios; no se descarga la totalidad de las facturas. |
| 2 | Pulsar Buscar facturas con todos los criterios vacíos | Aviso específico que exige al menos un criterio; no hay consulta masiva. |
| 3 | Buscar por reserva y luego por estancia | Aparece únicamente la factura correspondiente, con su número oficial, cliente fiscal, canal, emisión y total. |
| 4 | Buscar por documento fiscal | Solo aparecen las facturas de ese documento; el dato se compara de forma exacta. |
| 5 | Buscar un nombre completo con coincidencia EXACT | Aparecen coincidencias del nombre completo sin distinguir mayúsculas. La interfaz informa el modo aplicado. |
| 6 | Buscar un fragmento de al menos tres caracteres con PARTIAL | Cada factura conserva su propio cliente; se informa que la coincidencia es parcial. Un fragmento menor se rechaza. |
| 7 | Combinar canal OTA, identificador de OTA y rango de emisión | Solo aparecen facturas que cumplen todos los filtros; en canal directo no se ofrece un filtro de OTA activo. |
| 8 | Introducir una sola fecha o un rango invertido | Error asociado al campo correspondiente, sin reemplazar resultados válidos por resultados parciales. |
| 9 | Buscar una reserva inexistente o cancelada antes del check-out | Mensaje explícito sin coincidencias, sin error genérico. |
| 10 | Paginar una búsqueda con varias páginas | Número de página y total correctos; la petición siguiente conserva filtros, tamaño y `asOf`. No hay duplicados u omisiones. |
| 11 | Escribir otros filtros sin pulsar Buscar | Los resultados siguen identificados como pertenecientes a la búsqueda aplicada; la paginación conserva esa búsqueda. |
| 12 | Ejecutar otra búsqueda o cambiar el tamaño de página | Comienza en página 1 con un corte temporal nuevo. |
| 13 | Abrir Ver factura de una factura OTA | El detalle muestra número oficial, cliente fiscal, estancia/reserva, liquidación de origen, emisión, moneda, hospedaje, comisión informativa, neto, porcentaje y valor de IVA y total. |
| 14 | Comparar detalle con lo emitido por 006 | Los valores coinciden exactamente, incluidos centavos; se indica que la factura está emitida y es inmutable. No existen acciones de modificar, recalcular, anular o reemitir. |
| 15 | Abrir una factura directa | Comisión OTA en cero, sin OTA asignada. Los demás importes coinciden con la emisión original. |
| 16 | Consultar resumen por un rango con facturas | DIRECT y cada OTA histórica aparecen por separado; cantidad, hospedaje, comisión, IVA y total coinciden con la suma de las facturas del período. Se muestra la zona de referencia. |
| 17 | Consultar resumen por un rango sin facturas | DIRECT y las OTA históricas aparecen con cantidades y totales en cero. Una OTA que nunca facturó no forma parte de este universo. |
| 18 | Consultar resumen sin ambas fechas o con rango invertido | Error específico de rango; no se genera un resumen parcial. |
| 19 | Comprobar facturas próximas a medianoche en Bogotá | Pertenecen al día local correcto, aunque UTC tenga una fecha distinta. |
| 20 | Detener solo el backend en un entorno de prueba y volver a buscar | Se informa el error de conexión y se ofrece reintentar. Al volver a iniciar el backend, la consulta se recupera. |
| 21 | Iniciar sesión como OTA y abrir Facturas emitidas | Acceso rechazado; no se muestran facturas ni controles administrativos. |
| 22 | Dejar vencer la sesión y consultar | Se cierra la sesión y se vuelve al inicio de sesión. |
| 23 | Usar Tab, Shift+Tab y Escape en formularios y detalle | Campos etiquetados, errores anunciados, foco visible; el diálogo contiene el foco y lo devuelve al cerrar. |
| 24 | Abrir la pantalla en escritorio y en una ventana de 390 px | Formularios legibles y controles utilizables; las tablas se desplazan dentro de su región sin desbordar la página. |

## Casos HTTP complementarios

Con JWT de Administrador, en Swagger o un cliente HTTP:

| Petición | Resultado esperado |
|---|---|
| `GET /invoices` sin criterios | `400 MISSING_SEARCH_CRITERIA`. |
| `GET /invoices?channel=DIRECT&asOf=2026-02-30T12:00:00Z` | `400 INVALID_QUERY_PARAMS`: febrero 30 no se normaliza a marzo. |
| `GET /invoices?channel=DIRECT&asOf=2999-01-01T00:00:00Z` | `400 INVALID_QUERY_PARAMS`: el corte no puede ser futuro. |
| `GET /invoices/no-es-uuid` | `400 INVALID_QUERY_PARAMS`. |
| `GET /invoices/00000000-0000-4000-8000-000000000000` | `404 INVOICE_NOT_FOUND`. |
| Las tres rutas sin JWT | `401`. |
| Las tres rutas con JWT OTA | `403`. |
| `POST`, `PUT`, `PATCH` o `DELETE` sobre `/invoices` | Sin ruta de escritura disponible. |

## Pruebas automáticas y rendimiento

Las pruebas con base requieren `TEST_DATABASE_URL` apuntando a una **base de pruebas separada**,
ya migrada. Nunca usar `DATABASE_URL` de operación como base de pruebas. Los comandos completos
y los resultados están en el [mapa de implementación](../3-implementation/implementacion.md).

La regresión de concurrencia coordina transacciones reales: mantiene una emisión pendiente,
consulta el corte y verifica las páginas después del commit; otra prueba comprueba que página
y conteo usan una misma vista de los datos. Estas garantías no se verifican con clics de forma fiable.

T035 se reproduce con [benchmark-facturas.sql](benchmark-facturas.sql). Usa una tabla temporal
con un millón de filas y los índices de invoice; no agrega facturas a las tablas reales.
La evidencia y los límites de la medición se documentan en [rendimiento.md](rendimiento.md).

Registrar para cada paso manual: fecha, entorno, datos utilizados, resultado observado y evidencia.
La existencia de este procedimiento no sustituye una ejecución manual registrada.
