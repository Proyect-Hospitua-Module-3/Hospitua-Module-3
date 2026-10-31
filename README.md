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
