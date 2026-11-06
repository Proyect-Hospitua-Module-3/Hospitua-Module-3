# Hospitua-Module-3
Modulo 3 proyecto Hospitua Ingeniería de Software

Facturación, Consumos y Liquidación. Servicio NestJS con arquitectura hexagonal, PostgreSQL y Prisma
(ver [docs/plan-tecnico-base.md](docs/plan-tecnico-base.md)). Las specs y planes de cada feature están en
[features/](features/).

## Features implementadas

| Feature | Endpoint | Dónde está el código |
|---|---|---|
| Base: login propio con JWT | `POST /auth/login` | [src/infrastructure/adapters/in/http/auth/](src/infrastructure/adapters/in/http/auth/) |
| [001 Actualizar porcentaje de IVA](features/001-actualizar-porcentaje-iva/) | `PUT /admin/vat-rate` | [Mapa de implementación](features/001-actualizar-porcentaje-iva/3-implementation/implementacion.md) |
| [009 Modificar precio tarifa según temporada](features/009-modificar-precio-tarifa-segun-temporada/) | `GET`, `POST`, `PUT`, `DELETE` en `/admin/season-rules` | [Mapa de implementación](features/009-modificar-precio-tarifa-segun-temporada/3-implementation/implementacion.md) |
| [011 Revisar temporada del año](features/011-revisar-temporada-del-año/) | `GET /admin/season-calendar`, `PUT /admin/season-calendar/{year}` | [Mapa de implementación](features/011-revisar-temporada-del-año/3-implementation/implementacion.md) |
| [004 Consultar tarifa base](features/004-consultar-tarifa-base/) | Sin endpoint: puerto interno `GetBaseRateUseCase` para la 005 | [Mapa de implementación](features/004-consultar-tarifa-base/3-implementation/implementacion.md) |
| [005 Consultar tarifa dinámica](features/005-consultar-tarifa-dinamica/) | `GET /pricing/dynamic-rate` (Módulo 2 sin token, u OTA con token para sus reservas), `POST /pricing/quotes` (Módulo 2, sin token) | [Mapa de implementación](features/005-consultar-tarifa-dinamica/3-implementation/implementacion.md) |
| [007 Generar liquidación](features/007-generar-liquidacion/) | Sin endpoint: caso de uso interno `GenerateSettlementUseCase` para 010 y 006 | [Mapa de implementación](features/007-generar-liquidacion/3-implementation/implementacion.md) |

El código de cada feature está repartido por capas (arquitectura hexagonal). Cada feature tiene en su carpeta
`3-implementation/` un mapa con todos sus archivos, y cada archivo empieza con la marca `Feature NNN`
para encontrarlos con una búsqueda.

## Requisitos

- Node.js 20 o superior
- PostgreSQL 16: con Docker (`docker compose up -d`) o instalado localmente

## Cómo ejecutarlo

```bash
npm install
cp .env.example .env            # en Windows: copy .env.example .env  (y ajusta los valores)
docker compose up -d            # levanta PostgreSQL; omítelo si lo tienes instalado
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

La documentación interactiva queda en <http://localhost:3000/docs> (Swagger). Para probar:

1. `POST /auth/login` con el usuario y la clave de `SEED_ADMIN_*` del `.env` y copia el `accessToken`.
2. Botón **Authorize** de Swagger, pega el token.
3. `PUT /admin/vat-rate` con `{ "value": "19.00" }`.

## Pruebas

```bash
npm test             # unitarias, de contrato y de integración
npm run test:e2e     # endpoint de punta a punta (no necesita PostgreSQL)
```

Las pruebas de integración del repositorio necesitan una base PostgreSQL ya migrada en `TEST_DATABASE_URL`;
sin esa variable se omiten.
