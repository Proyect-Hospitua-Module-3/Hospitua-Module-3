# Hospitua-Module-3
Modulo 3 proyecto Hospitua Ingeniería de Software

Facturación, Consumos y Liquidación. Servicio NestJS con arquitectura hexagonal, PostgreSQL y Prisma
(ver [docs/plan-tecnico-base.md](docs/plan-tecnico-base.md)). Las specs y planes de cada feature están en
[features/](features/).

## Features implementadas

| Feature | Endpoint | Dónde está el código |
|---|---|---|
| Base: login propio con JWT | `POST /auth/login` | [src/infrastructure/adapters/in/http/auth/](src/infrastructure/adapters/in/http/auth/) |
| [001 Actualizar porcentaje de IVA](features/001-actualizar-porcentaje-iva/) | `PUT /admin/vat-rate`, `GET /admin/vat-rate` (vigente + historial, para el frontend) · pantalla `/iva` del [frontend](frontend/) | [Mapa de implementación](features/001-actualizar-porcentaje-iva/3-implementation/implementacion.md) |
| [009 Modificar precio tarifa según temporada](features/009-modificar-precio-tarifa-segun-temporada/) | `GET`, `POST`, `PUT`, `DELETE` en `/admin/season-rules` · pantalla `/temporadas` del [frontend](frontend/) | [Mapa de implementación](features/009-modificar-precio-tarifa-segun-temporada/3-implementation/implementacion.md) |
| [011 Revisar temporada del año](features/011-revisar-temporada-del-año/) | `GET /admin/season-calendar`, `PUT /admin/season-calendar/{year}` · pantalla `/calendario` del [frontend](frontend/) | [Mapa de implementación](features/011-revisar-temporada-del-año/3-implementation/implementacion.md) |
| [004 Consultar tarifa base](features/004-consultar-tarifa-base/) | Sin endpoint: puerto interno `GetBaseRateUseCase` para la 005 | [Mapa de implementación](features/004-consultar-tarifa-base/3-implementation/implementacion.md) |
| [005 Consultar tarifa dinámica](features/005-consultar-tarifa-dinamica/) | `GET /pricing/dynamic-rate` (Módulo 2 sin token, u OTA con token para sus reservas), `POST /pricing/quotes` (Módulo 2, sin token) | [Mapa de implementación](features/005-consultar-tarifa-dinamica/3-implementation/implementacion.md) |
| [007 Generar liquidación](features/007-generar-liquidacion/) | Sin endpoint: caso de uso interno `GenerateSettlementUseCase` para 010 y 006 | [Mapa de implementación](features/007-generar-liquidacion/3-implementation/implementacion.md) |
| [006 Generar factura final](features/006-generar-factura-final/) | Sin endpoint: caso de uso interno `GenerateFinalInvoiceUseCase` para 010 | [Mapa de implementación](features/006-generar-factura-final/3-implementation/implementacion.md) |
| [010 Registrar Check-out](features/010-registrar-checkout/) | Sin endpoint: consume la cola RabbitMQ `modulo3.checkout` y orquesta 007 y 006 | [Mapa de implementación](features/010-registrar-checkout/3-implementation/implementacion.md) |
| [002 Consultar liquidación](features/002-consultar-liquidacion/) | `GET /api/settlements` (Módulo 1 sin token: liquidación final o informativa de una habitación; OTA con token: liquidaciones finales de su reserva) | [Mapa de implementación](features/002-consultar-liquidacion/3-implementation/implementacion.md) |
| [008 Gestionar facturación](features/008-gestionar-facturacion/) | `GET /invoices` (búsqueda), `GET /invoices/{invoiceId}` (detalle) y `GET /invoices/summary` (resumen por canal), solo Administrador · pantalla `/facturas` del [frontend](frontend/) | [Mapa de implementación](features/008-gestionar-facturacion/3-implementation/implementacion.md) |
| [003 Consultar porcentaje de comisión OTA](features/003-consultar-porcentaje-comision-ota/) | `GET /ota-commission/{otaId}` (Módulo 2 sin token: cualquier OTA; OTA con token: solo la suya). Porcentaje de la liquidación Final más reciente, referencial | [Mapa de implementación](features/003-consultar-porcentaje-comision-ota/3-implementation/implementacion.md) |

El frontend del Administrador (React + Vite) está en [frontend/](frontend/), con sus propias instrucciones.

El código de cada feature está repartido por capas (arquitectura hexagonal). Cada feature tiene en su carpeta
`3-implementation/` un mapa con todos sus archivos, y cada archivo empieza con la marca `Feature NNN`
para encontrarlos con una búsqueda.

## Requisitos

- Node.js 20 o superior
- PostgreSQL 16: con Docker (`docker compose up -d`) o instalado localmente
- RabbitMQ 3.13 (feature 010): el del `docker-compose.yml` o el de Módulo 1

## Cómo ejecutarlo

```bash
npm install
cp .env.example .env            # en Windows: copy .env.example .env  (y ajusta los valores)
docker compose up -d --wait     # con Docker Desktop iniciado: espera PostgreSQL y RabbitMQ saludables
npx prisma migrate deploy       # crea las tablas
npx prisma db seed              # crea los usuarios admin y ota-demo del .env
npm run start:dev
```

Además de la base de datos, el JWT y los usuarios del seed, el `.env` necesita las variables de Módulo 1 (feature 004)
y de Módulo 2 (feature 007). Todas son obligatorias: si falta alguna o un timeout no es un entero positivo, la aplicación no arranca.

- `MODULE1_BASE_URL`: URL base de Módulo 1 para consultar la tarifa base (p. ej. `http://localhost:8080`, el puerto por defecto de Módulo 1).
- `MODULE1_TIMEOUT_MS`: tiempo máximo de espera por consulta, en milisegundos (`500`).
- `MODULE2_BASE_URL`: URL base de Módulo 2 para consultar reservas al generar la liquidación (p. ej. `http://localhost:8081`).
- `MODULE2_TIMEOUT_MS`: tiempo máximo de espera por consulta, en milisegundos (`500`).

`BILLING_REPORTING_TZ` (feature 008) es opcional: zona horaria de los filtros por fecha y del resumen de facturas;
si falta se usa `America/Bogota`, y si no es una zona IANA válida la aplicación no arranca.

`RABBITMQ_URL` (feature 010): con ella, al arrancar se declara la cola `modulo3.checkout` donde Módulo 1 publica
el evento de check-out y se empieza a consumir (cada evento genera la liquidación y la factura). Sin ella la
aplicación arranca igual, lo advierte en el log y los eventos esperan en la cola; si el broker no responde o se
cae, se reintenta la conexión cada 5 s. Las pruebas E2E nunca consumen la cola aunque el `.env` la tenga.

La documentación interactiva queda en <http://localhost:3000/docs> (Swagger). Para probar:

1. `POST /auth/login` con el usuario y la clave de `SEED_ADMIN_*` del `.env` y copia el `accessToken`.
2. Botón **Authorize** de Swagger, pega el token.
3. `PUT /admin/vat-rate` con `{ "value": "19.00" }`.

## Pruebas

```bash
npm test             # unitarias, de contrato y de integración
npm run test:e2e     # endpoints de punta a punta
```

Las pruebas de integración del repositorio necesitan una base PostgreSQL ya migrada en `TEST_DATABASE_URL`;
sin esa variable se omiten. Prisma lee el `.env` automáticamente, así que basta con que la variable esté ahí
para que esas pruebas se ejecuten. Las de mensajería (feature 010) necesitan un RabbitMQ en `TEST_RABBITMQ_URL`,
con la misma regla. La mayoría de las E2E no necesita PostgreSQL; las de 008 (`test/e2e/billing/gestionar-facturacion`)
y 003 (`test/e2e/ota-commission/`) necesitan `TEST_DATABASE_URL`, y la del check-out (`test/e2e/checkout/`) las dos variables.
