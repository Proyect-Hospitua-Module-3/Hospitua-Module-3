# Frontend de Módulo 3

Pantallas del **Administrador** de Módulo 3 (Facturación, Consumos y Liquidación), según el diseño de Figma
*Hospitua M3* (página *Módulo 3 · Pantallas*). React 18 + Vite 5 + TypeScript.

| Pantalla | Spec | Estado |
|---|---|---|
| Porcentaje de IVA (`/iva`) | [001](../features/001-actualizar-porcentaje-iva/3-implementation/implementacion.md#8-frontend-pantalla-porcentaje-de-iva) | Hecha |
| Temporadas y tarifas (`/temporadas`) | [009](../features/009-modificar-precio-tarifa-segun-temporada/3-implementation/implementacion.md#9-frontend-temporadas-y-tarifas) | Hecha |
| Calendario de temporadas (`/calendario`) | [011](../features/011-revisar-temporada-del-año/3-implementation/implementacion.md#10-frontend-calendario-de-temporadas) | Hecha |
| Facturas emitidas (`/facturas`) | [008](../features/008-gestionar-facturacion/3-implementation/implementacion.md#10-frontend-facturas-emitidas) | Hecha |

## Cómo ejecutarlo

Primero abre Docker Desktop y, desde la raíz del repositorio, levanta PostgreSQL y RabbitMQ.
`--wait` espera a que estén saludables. Si ya usas servicios instalados por otra vía, basta con
que el `.env` apunte a ellos (ver el [README principal](../README.md)).

```bash
docker compose up -d --wait
npm run start:dev          # backend en http://localhost:3000
```

Luego el frontend, en otra terminal:

```bash
cd frontend
npm install
npm run dev                # http://localhost:5173
```

Entra con el usuario y la clave de `SEED_ADMIN_*` del `.env` del backend.

En desarrollo, Vite redirige `/api/*` al backend (sin el prefijo `/api`), así que el backend no necesita CORS.
Si el backend corre en otro puerto: `BACKEND_URL=http://localhost:3100 npm run dev`.

## Pruebas

```bash
npm test                   # Vitest + Testing Library
npm run build              # compila TypeScript y genera dist/
```

## Estructura

```text
src/
├── api/            # Cliente HTTP (formato ApiError del backend) y llamadas por feature
├── auth/           # Sesión (JWT de POST /auth/login) y contexto de React
├── components/
│   ├── layout/     # Barra lateral del diseño
│   └── ui/         # Aviso, botón, modal, tarjeta, etiqueta
├── lib/            # Formatos ("19 %", "01 ene 2026") y validaciones
├── pages/          # Una carpeta por pantalla
├── styles/         # Tokens del diseño (colores, radios, tipografía Inter)
└── assets/         # Íconos descargados de Figma
```

Las fechas se muestran en la hora del hotel (`America/Bogota`), sin depender de la zona horaria del navegador.

## Temporadas y tarifas (009)

En `/temporadas` puedes consultar el catálogo, crear temporadas y editar su nombre, color y ajuste
porcentual. Un ajuste positivo incrementa la tarifa base y uno negativo aplica un descuento; se aceptan
valores entre −100 y +100 con hasta dos decimales, escritos con coma o punto.

`Regular` aparece identificada como predeterminada. Su color y ajuste se pueden modificar; su nombre
se conserva y no puede retirarse. Las demás temporadas requieren confirmación para retirarlas y el
backend impide hacerlo mientras estén asignadas en un calendario vigente.

Las ediciones envían la versión cargada. Si otro Administrador la cambió, se conserva el borrador y se
ofrece recargar los valores vigentes antes de volver a editar. Los cambios afectan nuevas cotizaciones;
las cotizaciones, liquidaciones y facturas anteriores conservan sus valores.

## Calendario de temporadas (011)

En `/calendario` puedes consultar el año completo o un rango de fechas, revisar la temporada y el
ajuste de cada día, y consultar publicaciones anteriores por número de revisión o por fecha y hora
de Colombia. La leyenda distingue períodos base, excepciones puntuales, fechas con temporada
predeterminada y conflictos. Las consultas históricas son de solo lectura.

Agrega períodos base y excepciones al borrador, o edita y quita las asignaciones existentes. Una
excepción cubre un día y prevalece sobre su período base. Los períodos pueden continuar hasta el
año siguiente; los heredados del año anterior se muestran aparte y se modifican desde su año de origen.
Las fechas sin asignación explícita aplican la temporada predeterminada del catálogo de la 009.

**Publicar calendario** pide confirmación y guarda todas las asignaciones propias del año como una
nueva revisión, aunque hayas consultado un rango más pequeño. Las entradas quitadas se eliminan
de la nueva revisión. Se validan fechas, temporadas, solapamientos y excepciones duplicadas antes
de publicar; el backend también verifica los años vecinos y la revisión esperada.

Si otro Administrador publicó mientras editabas, se conserva el borrador y se ofrece recargar el
calendario vigente. Cambiar de consulta o descartar cambios pide confirmación cuando hay trabajo
sin publicar. Usa **Limpiar asignación** para vaciar un formulario nuevo o **Cancelar edición** para
dejar una asignación como estaba. Las publicaciones conservan el historial y las cotizaciones anteriores.

## Facturas emitidas (008)

En `/facturas` puedes buscar por estancia, reserva, nombre del cliente de facturación, documento
fiscal, canal/OTA o rango de emisión. Se exige al menos un criterio. La coincidencia por nombre
puede ser exacta o parcial; la parcial exige tres caracteres y se identifica en los resultados.

Las fechas de búsqueda se interpretan en la zona de reporte del backend, `America/Bogota` por
defecto. La paginación conserva los filtros aplicados y el corte `asOf` devuelto por el servidor.
Escribir otros filtros no cambia los resultados hasta pulsar **Buscar facturas**. Una búsqueda
nueva o un cambio del tamaño de página comienza en la primera página con un corte nuevo.

**Ver detalle** abre el documento de solo lectura, con número oficial, cliente fiscal,
estancia/reserva, liquidación de origen, emisión y desglose completo. Los importes se muestran
tal como fueron emitidos, incluidos sus centavos. La pantalla no modifica, recalcula, anula ni
reemite facturas.

El **Resumen por canal** tiene su propio rango de fechas. Muestra cantidades y totales de
hospedaje, comisión OTA, IVA y facturación por canal, junto a la zona horaria aplicada. El canal
directo y las OTA que ya han facturado aparecen en cero cuando no tienen facturas en ese período.

Se ofrecen mensajes de validación, ausencia de coincidencias, errores y reintentos. Un `401`
cierra la sesión; un rol sin permiso no recibe controles administrativos. El procedimiento
manual y las verificaciones HTTP están en el [TC-008](../features/008-gestionar-facturacion/4-testing/TC-008-gestionar-facturacion.md).
