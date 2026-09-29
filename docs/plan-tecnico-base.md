# Plan Técnico Base del Proyecto (Proyecto Base)

**Módulo**: Módulo 3 — Facturación, Consumos y Liquidación
**Fecha**: 2026-09-29
**Referencias**: `docs/diccionario.md`, `docs/plan-template.md`, specs funcionales en `features/001-.../1-functional/` a `features/011-.../1-functional/`

> Este documento define el **proyecto base**: la arquitectura, el stack y las convenciones técnicas comunes sobre las que se construirán los planes técnicos de cada una de las 11 features de Módulo 3 (carpetas `2-technical/` de `features/`). No sustituye esos planes: cada feature seguirá `docs/plan-template.md` y **referenciará este documento** para todo lo que ya queda decidido aquí (stack, capas, convenciones de puertos/adaptadores, contratos entre módulos).
>
> El stack descrito (arquitectura hexagonal + NestJS + PostgreSQL + RabbitMQ) es el mismo que usarán los 3 módulos del proyecto HOSPITUA, para que la integración entre Módulo 1, Módulo 2 y Módulo 3 sea consistente.

---

## Resumen

Módulo 3 se implementa como un servicio NestJS independiente, con **arquitectura hexagonal** (puertos y adaptadores) organizada por *bounded context* interno. Persiste su estado en **PostgreSQL** y se integra con Módulo 1 y Módulo 2 mediante dos canales:

- **Síncrono (REST/HTTP)**: consultas de solo lectura entre módulos (p. ej. Módulo 3 consulta la tarifa base a Módulo 1; Módulo 1, Módulo 2, OTA y Administrador consultan tarifas, liquidaciones y facturas a Módulo 3).
- **Asíncrono (RabbitMQ)**: el único evento que dispara el procesamiento financiero de una estancia — `Registrar Check-out`, emitido por Módulo 1 — se recibe como mensaje de cola, con procesamiento idempotente.

El diseño mapea directamente las 11 features funcionales ya especificadas (`features/001-...` a `features/011-...`) a 5 *bounded contexts* internos, evitando que `Generar liquidación` o `Generar factura final` dependan de nada que no esté explícitamente permitido por sus specs (p. ej. `Generar liquidación` nunca invoca `Consultar tarifa dinámica` ni `Consultar porcentaje de comisión OTA`).

---

## Contexto Técnico

- **Lenguaje/Versión**: TypeScript 5.x sobre Node.js 20 LTS
- **Framework**: NestJS 10.x
- **Arquitectura**: Hexagonal (Puertos y Adaptadores), un hexágono por *bounded context* interno
- **Persistencia**: PostgreSQL 16
- **ORM / acceso a datos**: TypeORM (propuesta — ver [Decisiones abiertas](#decisiones-abiertas)), usado únicamente dentro de adaptadores de infraestructura, nunca en el dominio
- **Mensajería asíncrona**: RabbitMQ, vía `@nestjs/microservices` (`Transport.RMQ`)
- **Comunicación síncrona entre módulos**: REST/HTTP, con contratos versionados (OpenAPI)
- **Autenticación/Autorización**: JWT con claims de actor/rol (`Administrador`, `Modulo1`, `Modulo2`, `OTA`), validado con Guards de NestJS (Passport-JWT); ver [Decisiones abiertas](#decisiones-abiertas)
- **Testing**: Jest (unitarias + integración), Supertest (e2e), Testcontainers (Postgres + RabbitMQ reales en pruebas de integración)
- **Contenedores**: Docker + Docker Compose para entorno local (API + Postgres + RabbitMQ)
- **Project Type**: Servicio backend único (microservicio de dominio), sin frontend en este repositorio
- **Performance Goals**: consultas de lectura (tarifa dinámica, liquidación, factura) sin demoras perceptibles para operación de front-desk (NFR-002 de varias specs); sin objetivo numérico de RPS definido aún
- **Constraints**: determinismo e idempotencia obligatorios en `Generar liquidación` y `Generar factura final`; inmutabilidad de facturas emitidas; numeración consecutiva sin huecos ni duplicados bajo concurrencia
- **Scale/Scope**: 11 features funcionales de Módulo 3 (ver mapeo más abajo)

---

## Arquitectura hexagonal — convención de capas

Cada *bounded context* interno sigue la misma estructura de tres capas, sin excepciones:

```
<contexto>/
├── domain/            # Entidades, Value Objects, servicios de dominio, puertos (interfaces), errores de dominio
├── application/        # Casos de uso (comandos y queries), DTOs internos, orquestación de puertos
└── infrastructure/      # Adaptadores
    ├── inbound/        # REST controllers, consumers de RabbitMQ
    └── outbound/        # Repositorios TypeORM, publishers de RabbitMQ, clientes HTTP hacia otros módulos
```

**Reglas de dependencia** (se validan en code review y, cuando sea posible, con lint de arquitectura tipo `dependency-cruiser`):

1. `domain/` no importa nada de `application/` ni de `infrastructure/`, ni del framework NestJS, ni del ORM.
2. `application/` solo depende de `domain/` (entidades y **puertos**, nunca de adaptadores concretos).
3. `infrastructure/` implementa los puertos definidos en `domain/` y es lo único que conoce NestJS, TypeORM, RabbitMQ o clientes HTTP.
4. La inyección de dependencias de NestJS conecta cada puerto con su adaptador mediante un token (`Symbol` o clase abstracta), definido en el módulo NestJS de cada contexto (`*.module.ts`).

Esto es lo que permite, por ejemplo, que `Generar liquidación` (caso de uso en `application/`) dependa de un puerto `SettlementRepositoryPort` sin saber si detrás hay PostgreSQL, y que las pruebas unitarias del dominio no necesiten levantar Postgres ni RabbitMQ.

---

## Bounded contexts internos (mapeo a las 11 features)

| Bounded context | Features que cubre | Responsabilidad |
|---|---|---|
| `pricing` | 004 Consultar tarifa base, 005 Consultar tarifa dinámica, 009 Modificar precio tarifa según temporada, 011 Revisar temporada del año | Calcula tarifa dinámica combinando tarifa base (consultada a Módulo 1) y regla de temporada vigente (administrada en Módulo 3) |
| `ota-commission` | 003 Consultar porcentaje de comisión OTA | Vista de solo lectura, derivada de `settlement`, del último porcentaje aplicado por OTA. Nunca es fuente de verdad para `Generar liquidación` |
| `checkout-ingestion` | 010 Registrar Check-out | Único punto de entrada asíncrono desde Módulo 1; valida el evento y dispara (`<<include>>`) `settlement` |
| `settlement` | 007 Generar liquidación, 002 Consultar liquidación | Genera la liquidación `Final` idempotente de una estancia a partir de los datos ya calculados que llegan en el evento de check-out |
| `billing` | 006 Generar factura final, 001 Actualizar porcentaje de IVA, 008 Gestionar facturación | Emite la factura fiscal definitiva (incluye `settlement`), administra el IVA vigente y expone búsqueda/consolidado para el Administrador |

Dirección de las dependencias entre contextos (coherente con las relaciones `<<include>>` de las specs — BR-001/BR-009 de `generar_liquidacion.md`, BR-001 de `generar_factura_final.md`):

```
checkout-ingestion ──include──> settlement ──include──> (reutilizado por) billing
pricing            (sin dependencia desde settlement/billing — solo lo usan Módulo 2/OTA para cotizar)
ota-commission      (solo lee datos ya persistidos por settlement, de forma asíncrona/derivada — nunca al revés)
```

`settlement` **nunca** invoca `pricing` ni `ota-commission`: el valor de hospedaje y la comisión llegan ya calculados en el evento de check-out (FR-002 y FR-005 de `generar_liquidacion.md`). Este límite es intencional y debe respetarse en cada plan técnico de feature.

---

## Estructura de código (repositorio)

```text
src/
├── shared-kernel/                 # Value Objects comunes (Money, DateRange, Channel), errores base
│   ├── domain/
│   └── infrastructure/            # filtros de excepción globales, decoradores de auth compartidos
│
├── pricing/
│   ├── domain/
│   ├── application/
│   └── infrastructure/
│
├── ota-commission/
│   ├── domain/
│   ├── application/
│   └── infrastructure/
│
├── checkout-ingestion/
│   ├── domain/
│   ├── application/
│   └── infrastructure/
│
├── settlement/
│   ├── domain/
│   ├── application/
│   └── infrastructure/
│
├── billing/
│   ├── domain/
│   ├── application/
│   └── infrastructure/
│
├── app.module.ts
└── main.ts

test/
├── unit/            # espejo de src/, uno por caso de uso y servicio de dominio
├── integration/       # adaptadores reales contra Postgres/RabbitMQ (Testcontainers)
└── e2e/             # flujo completo: evento de check-out -> liquidación -> factura

docker-compose.yml     # Postgres + RabbitMQ + API para desarrollo local
```

**Structure Decision**: un servicio NestJS único (monolito modular) con 5 *bounded contexts* internos, cada uno hexagonal. No se opta por microservicios separados por contexto en esta fase: el volumen de features (11) y su fuerte acoplamiento transaccional (`checkout-ingestion` → `settlement` → `billing` en una misma unidad de trabajo) no lo justifica todavía. Si en el futuro un contexto necesita escalar o desplegarse de forma independiente, los límites de puertos/adaptadores ya definidos facilitan extraerlo.

---

## Contratos de integración entre módulos

### Entrante asíncrono (RabbitMQ)

- **Cola/routing key**: `modulo1.checkout.registered` (exchange topic `hospitua.events`, a confirmar con Módulo 1)
- **Consumer**: `checkout-ingestion/infrastructure/inbound` — valida el payload mínimo (FR-002 de `registrar_checkout.md`), y si es válido invoca el caso de uso `RegisterCheckoutUseCase`, que a su vez incluye `GenerateSettlementUseCase`.
- **Idempotencia**: se usa el `stayId`/`reservationRef` del evento como clave; `settlement` tiene una restricción de unicidad por estancia, de modo que un reenvío del mismo evento (BR-006 de `registrar_checkout.md`) siempre resuelve al mismo resultado sin duplicar.
- **Ack**: manual (`noAck: false`), confirmado solo después de persistir el resultado (liquidación + factura, si corresponde), para garantizar *at-least-once* sin perder eventos ante una caída a mitad de proceso.
- **Dead-letter**: eventos rechazados por datos obligatorios inválidos (FR-006 de `registrar_checkout.md`) se enrutan a una cola de dead-letter para revisión manual, no se reintentan indefinidamente.

### Saliente síncrono (REST) — Módulo 3 consulta a Módulo 1

- `GET /rooms/{roomType}/base-rate?date=YYYY-MM-DD` (nombre de contrato a confirmar con Módulo 1) — usado por `pricing` para `Consultar tarifa base`.
- Cliente HTTP con **timeout explícito** y manejo diferenciado de dos fallos distintos (FR-008 de `consultar_tarifa_base.md`): *ausencia de tarifa* (respuesta 404/negocio) vs. *falla de comunicación* (timeout/5xx) — ninguno de los dos se sustituye por un valor supuesto.

### Entrante síncrono (REST) — otros actores consultan a Módulo 3

| Endpoint (borrador) | Actor(es) | Feature |
|---|---|---|
| `GET /pricing/dynamic-rate` | Módulo 2, OTA | 005 |
| `GET /settlements/{stayId}` | Módulo 1, OTA | 002 |
| `GET /ota-commission/{otaId}` | Módulo 2, OTA | 003 |
| `GET /invoices`, `GET /invoices/{id}`, `GET /invoices/summary` | Administrador | 008 |
| `PUT /admin/vat-rate` | Administrador | 001 |
| `GET/PUT /admin/season-rules` | Administrador | 009 |
| `GET /admin/season-calendar` | Administrador | 011 |

Todos estos endpoints son adaptadores **inbound** en `infrastructure/inbound` del contexto correspondiente; ninguno contiene lógica de negocio, solo mapean HTTP ↔ caso de uso.

### Autorización por actor

Cada endpoint/consumer aplica un Guard que valida el claim de actor del JWT contra la lista de actores autorizados de su spec (p. ej. BR-002 de `consultar_liquidacion.md` restringe una OTA a sus propias reservas — esto se valida en el caso de uso, no solo en el Guard, ya que depende de datos de negocio).

---

## Modelo de datos (alto nivel)

Basado en las entidades clave de `docs/diccionario.md` y de cada spec:

- `vat_rate` (+ `vat_rate_history`): porcentaje de IVA vigente único y su historial (BR-003 de `actualizar_porcentaje_iva.md`)
- `season_calendar_entry`: rangos de fecha clasificados como alta/baja/regular, sin solapamientos (BR-005 de `revisar_temporada_del_año.md`)
- `season_rule` (+ historial): ajuste vigente por temporada (BR-005 de `modificar_precio_tarifa_segun_temporada.md`)
- `settlement` (liquidación): una fila por estancia, `UNIQUE(stay_id)`, estado siempre `Final` (BR-006/FR-010 de `generar_liquidacion.md`)
- `invoice` (factura): `UNIQUE(settlement_id)`, número de una secuencia PostgreSQL dedicada para la numeración consecutiva oficial (FR-011 de `generar_factura_final.md`)
- `checkout_event_log`: registro de cada evento de check-out recibido, para trazabilidad y para resolver idempotencia de forma explícita (NFR-004 de `registrar_checkout.md`)

La numeración consecutiva oficial usa una **secuencia nativa de PostgreSQL** (no un contador en tabla de aplicación) para que la asignación sea atómica incluso ante reintentos concurrentes del cierre de check-out (FR-011, NFR-003 de `generar_factura_final.md`).

---

## Manejo de errores y resiliencia

- Errores de dominio tipados por contexto (`InvalidVatRateError`, `OverlappingSeasonError`, `MissingCommissionError`, `SettlementAlreadyExistsError`, etc.), definidos en `domain/errors` y mapeados a códigos HTTP en un `ExceptionFilter` compartido de `shared-kernel`.
- Llamadas salientes a Módulo 1 con timeout + circuit breaker (evaluar `@nestjs/terminus` u opossum) para que una caída de Módulo 1 detenga el cálculo en vez de bloquear indefinidamente (NFR-003 de `consultar_tarifa_dinamica.md`).
- Todo motivo de rechazo devuelto al actor debe ser específico y accionable (NFR-005 de `generar_liquidacion.md`), nunca un error genérico.

---

## Estrategia de testing

- **Unitarias** (`test/unit`): dominio y casos de uso, con los puertos mockeados — sin NestJS, sin base de datos, sin cola.
- **Integración** (`test/integration`): adaptadores reales (repositorios TypeORM, consumer de RabbitMQ) contra Postgres y RabbitMQ levantados con Testcontainers.
- **E2E** (`test/e2e`): flujo completo `Registrar Check-out` → `Generar liquidación` → `Generar factura final`, y flujos de consulta cruzados por actor (OTA solo ve lo suyo, etc.).
- **Contract tests**: sobre el payload del evento `Registrar Check-out` y sobre los endpoints REST expuestos a Módulo 1/Módulo 2/OTA, para detectar breaking changes antes de integrar con los otros módulos.

Cada plan técnico de feature (`features/NNN-.../2-technical/plan.md`) debe indicar qué pruebas de estas categorías aplica, siguiendo `docs/plan-template.md`.

---

## Fases de construcción del proyecto base

### Fase 1: Setup
- Scaffolding NestJS (`nest new`), estructura de carpetas descrita arriba
- Docker Compose con PostgreSQL + RabbitMQ + API
- Linting/formatting (ESLint + Prettier), husky/lint-staged
- CI base (build + lint + test unitario) — pipeline compartido con Módulo 1/Módulo 2 si aplica

### Fase 2: Fundacional (bloqueante para todas las features)
- `shared-kernel`: Value Objects (`Money`, `DateRange`, `Channel`), filtro de excepciones global, decoradores de autorización por actor
- Conexión a PostgreSQL + framework de migraciones (TypeORM migrations)
- Conexión a RabbitMQ (módulo de mensajería NestJS, configuración de exchange/colas)
- Autenticación JWT + Guards por actor
- Health checks (`@nestjs/terminus`)

**Checkpoint**: con esto listo, cada *bounded context* puede implementarse en paralelo.

### Fase 3: `pricing` (features 011, 009, 005, 004)
Orden interno recomendado: 011 (Revisar temporada) → 009 (Modificar regla de temporada) → 004 (Consultar tarifa base, adaptador HTTP hacia Módulo 1) → 005 (Consultar tarifa dinámica, compone las tres anteriores).

### Fase 4: `checkout-ingestion` + `settlement` (features 010, 007, 002)
Orden interno: 007 (Generar liquidación, caso de uso núcleo) → 010 (Registrar Check-out, adaptador RabbitMQ que lo invoca) → 002 (Consultar liquidación, lectura).

### Fase 5: `billing` (features 006, 001, 008)
Orden interno: 001 (Actualizar porcentaje de IVA) → 006 (Generar factura final, incluye `settlement`) → 008 (Gestionar facturación, lectura/búsqueda).

### Fase 6: `ota-commission` (feature 003)
Depende de que `settlement` ya tenga liquidaciones `Final` persistidas para tener datos que leer.

### Fase 7: Cierre y transversales
- Observabilidad (logging estructurado, métricas, trazas de eventos RabbitMQ)
- Endurecimiento de seguridad (rate limiting en endpoints públicos hacia OTA)
- Documentación OpenAPI publicada para Módulo 1/Módulo 2/OTA

---

## Dependencias y orden de ejecución

- Fase 1 y 2 son bloqueantes para cualquier feature.
- `pricing` no depende de `settlement`/`billing` y puede avanzar en paralelo con ellos una vez completada la Fase 2.
- `checkout-ingestion` y `settlement` deben completarse antes de `billing`, porque `Generar factura final` incluye (`<<include>>`) a `Generar liquidación` (BR-001 de `generar_factura_final.md`).
- `ota-commission` depende de que existan liquidaciones `Final` reales, así que se implementa al final aunque su lógica sea sencilla.

---

## Decisiones abiertas

Estas decisiones se proponen con una opción recomendada, pero quedan explícitamente abiertas a validación antes de la Fase 1:

- **ORM**: se propone **TypeORM** por su integración oficial con NestJS y su encaje natural con el patrón repositorio/puerto. Alternativa: Prisma.
- **Exchange/routing de RabbitMQ**: se propone un exchange `topic` único (`hospitua.events`) compartido entre los 3 módulos, con routing keys por evento. Debe confirmarse con los equipos de Módulo 1 y Módulo 2.
- **Emisor/validador de JWT**: este plan asume un servicio de identidad compartido entre los 3 módulos (fuera del alcance de este repositorio); falta definir quién lo implementa y el formato exacto de los claims de actor.
- **Contratos REST exactos hacia Módulo 1** (rutas, nombres de campo): los endpoints listados en este documento son un borrador para desbloquear el diseño; deben validarse con el equipo de Módulo 1.

---

## Notas

- Este documento cubre el **proyecto base**; cada feature (`features/NNN-.../2-technical/plan.md`) debe escribir su propio plan siguiendo `docs/plan-template.md`, referenciando aquí para stack, capas y contratos ya decididos, y detallando solo lo específico de esa feature (entidades concretas, casos de uso, tareas granulares).
- Las reglas de negocio y límites de responsabilidad citados aquí (BR-xxx, FR-xxx) provienen de las specs funcionales ya existentes en `features/`; ante cualquier conflicto, la spec funcional de la feature es la fuente de verdad.
