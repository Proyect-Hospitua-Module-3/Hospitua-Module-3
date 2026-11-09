# Frontend de Módulo 3

Pantallas del **Administrador** de Módulo 3 (Facturación, Consumos y Liquidación), según el diseño de Figma
*Hospitua M3* (página *Módulo 3 · Pantallas*). React 18 + Vite 5 + TypeScript.

| Pantalla | Spec | Estado |
|---|---|---|
| Porcentaje de IVA (`/iva`) | [001](../features/001-actualizar-porcentaje-iva/3-implementation/implementacion.md#8-frontend-pantalla-porcentaje-de-iva) | Hecha |
| Temporadas y tarifas (`/temporadas`) | [009](../features/009-modificar-precio-tarifa-segun-temporada/3-implementation/implementacion.md#9-frontend-temporadas-y-tarifas) | Hecha |
| Calendario de temporadas (`/calendario`) | 011 | Pendiente |
| Facturas emitidas (`/facturas`) | 008 | Pendiente |

## Cómo ejecutarlo

Primero el backend, desde la raíz del repositorio (ver el [README principal](../README.md)):

```bash
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
