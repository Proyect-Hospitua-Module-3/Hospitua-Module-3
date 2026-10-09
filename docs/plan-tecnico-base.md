# Implementation Plan: Base del Módulo 3 (Plataforma Compartida - Facturación, Consumos y Liquidación)

**Date**: 2026-09-29  
**Spec**: [diccionario.md](diccionario.md), [plan-template.md](plan-template.md) y las specs funcionales de Módulo 3 en `features/001-.../1-functional/` a `features/011-.../1-functional/`. Este plan no implementa una feature específica: deja lista la plataforma técnica base que todos los planes de feature de Módulo 3 (carpetas `2-technical/` de `features/`) reutilizan. Cada feature seguirá `docs/plan-template.md` y **referenciará este documento** para todo lo que ya queda decidido aquí (stack, capas, convenciones de puertos/adaptadores, contratos entre módulos).

---

## Summary

El **Módulo 3 (Facturación, Consumos y Liquidación)** se implementa como un servicio NestJS independiente, con **arquitectura hexagonal** (puertos y adaptadores) organizada por *bounded context* interno. Persiste su estado en **PostgreSQL** y se integra con Módulo 1 y Módulo 2 mediante dos canales:

- **Síncrono (REST/HTTP)**: consultas entre módulos (p. ej. Módulo 3 consulta la tarifa base a Módulo 1 y los datos de la reserva a Módulo 2; Módulo 2 solicita a Módulo 3 la cotización del hospedaje al crear una reserva; Módulo 1, Módulo 2, OTA y Administrador consultan tarifas, liquidaciones y facturas a Módulo 3).
- **Asíncrono (RabbitMQ)**: el único evento que dispara el procesamiento financiero de una estancia — `Registrar Check-out`, emitido por Módulo 1 — se recibe como mensaje de cola, con procesamiento idempotente.

El diseño mapea directamente las 11 features funcionales ya especificadas (`features/001-...` a `features/011-...`) a 5 *bounded contexts* internos, evitando que `Generar liquidación` o `Generar factura final` dependan de nada que no esté explícitamente permitido por sus specs (p. ej. `Generar liquidación` nunca invoca `Consultar tarifa dinámica` ni `Consultar porcentaje de comisión OTA`: toma el valor de hospedaje de la cotización ya guardada al reservar).

El stack descrito (arquitectura hexagonal + NestJS + PostgreSQL + RabbitMQ) es el mismo que usarán los 3 módulos del proyecto HOSPITUA, para que la integración entre Módulo 1, Módulo 2 y Módulo 3 sea consistente. Este plan unifica el stack tecnológico, la arquitectura, el modelo de persistencia, los contratos de integración (REST y colas RabbitMQ), el manejo de errores y la infraestructura transversal de pruebas.

---

## Technical Context

- **Language/Version**: TypeScript 5.x sobre Node.js 20 LTS
- **Primary Dependencies**: NestJS 10.x, Prisma ORM, `@nestjs/microservices` (`Transport.RMQ`), Passport-JWT, `@nestjs/jwt`, bcrypt, `@nestjs/terminus`
- **Architecture**: Hexagonal (Puertos y Adaptadores), una sola capa `domain/`, `application/` e `infrastructure/`, con los *bounded contexts* internos como subcarpetas
- **Storage**: PostgreSQL 16
- **Build Tool**: Nest CLI (`nest new` para el scaffolding)
- **Messaging**: RabbitMQ, vía `@nestjs/microservices` (`Transport.RMQ`)
- **Testing**: Jest (unitarias + integración), Supertest (e2e), Testcontainers (Postgres + RabbitMQ reales en pruebas de integración)
- **Target Platform**: Contenedores Docker; Docker Compose para entorno local (API + Postgres + RabbitMQ)
- **Project Type**: Servicio backend único (microservicio de dominio)
- **API**: REST/HTTP JSON, con contratos versionados (OpenAPI)
- **Frontend**: Sin frontend en este repositorio
- **Authentication/Authorization**: JWT de usuario con rol (`Administrador`, `OTA`), validado con Guards de NestJS (Passport-JWT). Las llamadas entre módulos (M1, M2) no usan token: viajan por la red interna (ver [Autenticación](#autenticación))
- **Version Control**: Git + GitHub (ramas `feature/*` hacia `develop`)
- **Performance Goals**:
  - Consultas de lectura (tarifa dinámica, liquidación, factura) sin demoras perceptibles para operación de front-desk (NFR-002 de varias specs).
  - Sin objetivo numérico de RPS definido aún.
- **Constraints**:
  - Determinismo e idempotencia obligatorios en `Generar liquidación` y `Generar factura final`.
  - Inmutabilidad de facturas emitidas.
  - Numeración consecutiva sin huecos ni duplicados bajo concurrencia.
- **Scale/Scope**: 11 features funcionales de Módulo 3 (ver [Bounded contexts internos](#bounded-contexts-internos-mapeo-a-las-11-features)).

### Dependencias y herramientas transversales aprobadas

| Necesidad | Propuesta | Justificación |
|---|---|---|
| Framework | NestJS 10.x | Inyección de dependencias por token, que permite conectar cada puerto con su adaptador en el `*.module.ts` de cada contexto (`infrastructure/config/`) |
| ORM / acceso a datos | Prisma ORM | Cliente generado y tipado para TypeScript a partir de `schema.prisma`. Se envuelve en un `PrismaService` de NestJS y se usa únicamente dentro de adaptadores de infraestructura, nunca en el dominio |
| Migraciones de Base de Datos | Prisma Migrate | Versionamiento del esquema (`prisma/migrations/`) dentro del mismo stack del ORM |
| Mensajería | `@nestjs/microservices` (`Transport.RMQ`) | Consumer del evento `Registrar Check-out` con ack manual |
| Autenticación y Autorización | Login propio (`@nestjs/jwt` + bcrypt), Passport-JWT + Guards de NestJS | Emisión y validación del JWT de usuario y control de acceso por rol (`Administrador`, `OTA`) |
| Resiliencia de llamadas salientes | Timeout + circuit breaker (evaluar `@nestjs/terminus` u opossum) | Una caída de Módulo 1 o Módulo 2 detiene el proceso en vez de bloquear indefinidamente (NFR-003 de `consultar_tarifa_dinamica.md`) |
| Health checks | `@nestjs/terminus` | Estado de la API, Postgres y RabbitMQ |
| Lint de arquitectura | `dependency-cruiser` (cuando sea posible) | Validar automáticamente las reglas de dependencia entre capas |
| Calidad de código | ESLint + Prettier, husky/lint-staged | Formato y lint uniformes antes de cada commit |
| Pruebas con infraestructura real | Testcontainers | Postgres y RabbitMQ reales en pruebas de integración |

---

## Comunicación entre módulos

Regla arquitectónica de Módulo 3:
- **Proactiva** (otro módulo avisa la ocurrencia de un evento de negocio y no espera respuesta síncrona) → **Cola RabbitMQ**. Es el caso único de `Registrar Check-out`.
- **Reactiva** (consulta de solo lectura bajo demanda que requiere un dato inmediato) → **REST/HTTP**.

### Matriz de Integración de Módulo 3

| Interacción | Dirección | Mecanismo | Tipo | Feature / Caso de Uso |
|---|---|---|---|---|
| **Registrar Check-out** | M1 → M3 | Cola RabbitMQ | Proactiva | 010 `registrar_checkout.md` (incluye 007 y 006) |
| **Consultar tarifa base** | M3 → M1 | REST GET | Reactiva | 004 `consultar_tarifa_base.md` |
| **Consultar tarifa dinámica** | M2, OTA → M3 | REST GET | Reactiva | 005 `consultar_tarifa_dinamica.md` |
| **Cotizar hospedaje** | M2 → M3 | REST POST | Reactiva | 005 `consultar_tarifa_dinamica.md` |
| **Consultar reserva** | M3 → M2 | REST GET | Reactiva | 007 `generar_liquidacion.md` (FR-005) |
| **Consultar liquidación** | M1, OTA → M3 | REST GET | Reactiva | 002 `consultar_liquidacion.md` (M1 la consulta en el paso 2 del Check-Out, antes de publicar el evento) |
| **Consultar porcentaje de comisión OTA** | M2, OTA → M3 | REST GET | Reactiva | 003 `consultar_porcentaje_comision_ota.md` |
| **Gestionar facturación** | Administrador → M3 | REST GET | Reactiva | 008 `gestionar_facturacion.md` |
| **Actualizar porcentaje de IVA** | Administrador → M3 | REST PUT | Reactiva | 001 `actualizar_porcentaje_iva.md` |
| **Modificar precio tarifa según temporada** | Administrador → M3 | REST GET/PUT | Reactiva | 009 `modificar_precio_tarifa_segun_temporada.md` |
| **Revisar temporada del año** | Administrador → M3 | REST GET | Reactiva | 011 `revisar_temporada_del_año.md` |

### Convenciones de Mensajería (RabbitMQ)

- **Exchange**: `hospitua.events` (Tipo: `topic`), compartido entre los 3 módulos, con routing keys por evento (acordado con Módulo 1 y Módulo 2).
- **Routing Key consumida por Módulo 3**:
  - `habitacion.checkout`: evento `Registrar Check-out` publicado por Módulo 1 al confirmar el Check-Out. Es el mismo evento que consume Módulo 2; Módulo 3 lo recibe en su propia cola durable (`modulo3.checkout`) enlazada a esa routing key, de modo que cada módulo procesa su copia de forma independiente.
- **Consumer**: `infrastructure/adapters/in/messaging/checkout-registered.consumer.ts` — valida el payload mínimo (FR-002 de `registrar_checkout.md`), y si es válido invoca el caso de uso `RegisterCheckoutUseCase`, que a su vez incluye `GenerateSettlementUseCase`.
- **Idempotencia**: se usa el `stayId` del evento como clave (una estancia = una habitación de la reserva); `settlement` tiene una restricción de unicidad por estancia, de modo que un reenvío del mismo evento (BR-006 de `registrar_checkout.md`) siempre resuelve al mismo resultado sin duplicar.
- **Ack**: manual (`noAck: false`), confirmado solo después de persistir el resultado (liquidación + factura, si corresponde), para garantizar *at-least-once* sin perder eventos ante una caída a mitad de proceso.
- **Dead-letter**: eventos rechazados por datos obligatorios inválidos (FR-006 de `registrar_checkout.md`) se enrutan a una cola de dead-letter para revisión manual, no se reintentan indefinidamente.
- **Estructura estándar del mensaje (`EventEnvelope<T>`)**, la misma envoltura que usa Módulo 1 para sus eventos (acordada con Módulo 1). El `payload` solo trae hechos físicos de la estancia; los datos de canal, OTA y hospedaje se obtienen de Módulo 2 y de la cotización guardada en `pricing`:
  ```json
  {
    "eventId": "UUIDv4",
    "eventType": "CHECK_OUT",
    "occurredAt": "2026-09-28T10:30:00Z",
    "sourceModule": "MODULE_1",
    "payload": {
      "stayId": "UUID",
      "reservationRef": "RES-000123",
      "roomId": "UUID",
      "categoryRoom": "DOBLE",
      "checkInDate": "2026-09-25",
      "checkOutDate": "2026-09-28",
      "billingCustomer": {
        "name": "opcional: nombre o razón social",
        "taxId": "opcional: documento fiscal"
      }
    }
  }
  ```
  - El evento es **por habitación**: una reserva con varias habitaciones genera un check-out (y una liquidación) por cada una.
  - Campos obligatorios del `payload`: `stayId`, `reservationRef`, `roomId`, `categoryRoom`, `checkInDate` y `checkOutDate` reales (`checkOutDate` posterior a `checkInDate`, FR-003 de `registrar_checkout.md`).
  - `categoryRoom` (tipo de habitación, nombre que usa Módulo 1; equivale al `roomType` de `pricing`) permite elegir la cotización de esa habitación entre los `quoteIds` de la reserva.
  - El evento no trae `channel`, `lodgingAmount` ni datos de la OTA: el canal y los datos OTA se consultan a Módulo 2 y el hospedaje se toma de la cotización guardada (ver [regla 5](#reglas-transversales-de-arquitectura)).
  - `billingCustomer` es opcional: si llega, se entrega a `Generar liquidación`, pero su ausencia no invalida el evento (FR-002).
  - El `payload` nunca incluye datos migratorios ni SIRE (FR-007, NFR-003).
  - `eventId` queda registrado en `checkout_event_log` para trazabilidad (NFR-004).

### Resiliencia ante fallos externos

- Llamadas salientes a Módulo 1 y Módulo 2 con **timeout explícito + circuit breaker**, para que una caída de otro módulo detenga el proceso en vez de bloquear indefinidamente (NFR-003 de `consultar_tarifa_dinamica.md`).
- Manejo diferenciado de dos fallos distintos al consultar la tarifa base (FR-008 de `consultar_tarifa_base.md`): *ausencia de tarifa* (respuesta 404/negocio) vs. *falla de comunicación* (timeout/5xx). Ninguno de los dos se sustituye por un valor supuesto.
- Al procesar el check-out, se distinguen los mismos dos fallos al consultar la reserva a Módulo 2: *reserva o cotización inexistente* (404) → el evento va a dead-letter para revisión manual; *falla de comunicación* (timeout/5xx o circuito abierto) → el evento no se confirma y se reintenta. En ningún caso se genera la liquidación con datos supuestos.
- El evento de check-out solo se confirma (ack) tras persistir; si el proceso cae a mitad, RabbitMQ lo reentrega y la idempotencia evita duplicados.

---

## Contratos REST

### 1. Endpoints que Módulo 3 EXPONE (servicios propios)

| Método y Ruta | Consumidor | Feature | Propósito |
|---|---|---|---|
| `POST /auth/login` | Administrador, OTA | — | Login propio de Módulo 3: emite el JWT de usuario |
| `GET /pricing/dynamic-rate` | Módulo 2, OTA | 005 | Tarifa dinámica por noche (tarifa base + regla de temporada) |
| `POST /pricing/quotes` | Módulo 2 | 005 | Cotización del hospedaje de una habitación al crear una reserva o al extenderla: calcula y guarda la tarifa dinámica de cada noche y el total |
| `GET /api/settlements?reservationRef={ref}&checkInDate={in}&checkOutDate={out}&source={src}&roomId={room}&categoryRoom={type}` | Módulo 1, OTA | 002 | Desglose de la liquidación de una habitación (ruta y parámetros definidos por Módulo 1) |
| `GET /ota-commission/{otaId}` | Módulo 2, OTA | 003 | Último porcentaje de comisión aplicado a una OTA (referencial) |
| `GET /invoices` | Administrador | 008 | Búsqueda de facturas por criterios |
| `GET /invoices/{id}` | Administrador | 008 | Detalle de solo lectura de una factura |
| `GET /invoices/summary` | Administrador | 008 | Consolidado por canal en un rango de fechas |
| `PUT /admin/vat-rate` | Administrador | 001 | Actualización del porcentaje de IVA vigente |
| `GET/PUT /admin/season-rules` | Administrador | 009 | Consulta y modificación de reglas de precio por temporada |
| `GET /admin/season-calendar` | Administrador | 011 | Revisión del calendario anual de temporadas |

Todos estos endpoints son adaptadores de entrada en `infrastructure/adapters/in/http/`; ninguno contiene lógica de negocio, solo mapean HTTP ↔ caso de uso. Los que consumen Módulo 1 y Módulo 2 (`POST /pricing/quotes`, `GET /pricing/dynamic-rate`, `GET /api/settlements`, `GET /ota-commission/{otaId}`) están acordados con esos módulos; el contrato detallado (esquemas de request/response) de todos los endpoints se publica en OpenAPI (T026).

### 2. Endpoints que Módulo 3 CONSUME (clientes de otros módulos)

| Servicio Externo | Método y Ruta | Propósito |
|---|---|---|
| **Módulo 1** | `GET /rooms/{roomType}/base-rate?date=YYYY-MM-DD` | Consulta de la tarifa base usada por `pricing` para `Consultar tarifa base` |
| **Módulo 2** | `GET /api/reservations/{reservationRef}` | Datos de la reserva usados por `settlement`: `quoteIds`, `channel` y, si es OTA, `otaId`, `otaConfirmationCode` y `otaCommissionPercentage` |

Ambos contratos están acordados con Módulo 1 y Módulo 2.

#### Cotización del hospedaje (acordado con Módulo 2)

Módulo 3 calcula el valor del hospedaje en el momento de la reserva, para que el cliente lo vea antes de confirmar y en el check-out se cobre exactamente ese valor.

- Módulo 2 solicita la cotización solo como parte de la creación o la extensión de una reserva (no existen cotizaciones sueltas, por lo que no se maneja vigencia).
- Una cotización corresponde a **una habitación**: si la reserva incluye varias, Módulo 2 pide una cotización por cada una y guarda la lista de `quoteId` en la reserva.
- `POST /pricing/quotes` recibe `{ roomType, checkInDate, checkOutDate, extendsQuoteId? }` y responde `{ quoteId, currency: "COP", nightlyRates: [{ date, rate }], lodgingAmount }`. Módulo 2 muestra `lodgingAmount` al cliente (la suma de todas, si hay varias habitaciones).
- **Extensión de estancia**: Módulo 2 la gestiona como un cambio de la reserva y pide una nueva cotización enviando `extendsQuoteId` (la cotización vigente de esa habitación) y la nueva `checkOutDate`. Módulo 3 crea una cotización nueva que **copia** las noches ya cotizadas con su valor original y calcula solo las noches nuevas con la tarifa dinámica vigente. Módulo 2 reemplaza en la reserva el `quoteId` anterior por el nuevo. La cotización original no se modifica.
- **Salida anticipada**: no genera una nueva cotización; se liquida lo cotizado, porque es lo que el cliente aceptó al confirmar (no es una penalización).
- `GET /api/reservations/{reservationRef}` devuelve `reservationRef`, `quoteIds: ["UUID", ...]`, `channel` y, si `channel = OTA`, `otaId`, `otaConfirmationCode` y `otaCommissionPercentage`. Si la reserva no existe, Módulo 2 responde 404.
- Módulo 3 llama a Módulo 2 sin token, por la red interna (ver [Autenticación](#autenticación)).
- Para liquidar una habitación, `settlement` elige entre los `quoteIds` de la reserva la cotización cuyo `roomType` coincide con el `categoryRoom` que envía Módulo 1 (en el evento y en la consulta de liquidación). Si hay varias del mismo tipo, son equivalentes (mismo tipo y mismas fechas reservadas) y se usa cualquiera. Si ninguna coincide, se rechaza con `QUOTE_NOT_FOUND` (el evento va a dead-letter).

#### Consulta de liquidación desde Módulo 1

Módulo 1 consulta la liquidación en el paso 2 del Check-Out, **antes** de confirmar la salida y publicar `habitacion.checkout` (paso 4). Por eso `GET /api/settlements`:

- Si ya existe la liquidación `Final` de esa habitación, la devuelve.
- Si todavía no existe, la calcula con la misma lógica de `Generar liquidación` (reserva de Módulo 2 + cotización guardada), **sin persistirla**, y la devuelve como informativa. Como el cálculo es determinista, coincide con la liquidación `Final` que se genera al recibir el evento.
- Debe responder en menos de 800 ms (objetivo de rendimiento de Módulo 1).
- `categoryRoom` es obligatorio: con él se elige la cotización de la habitación.
- El parámetro `source` (Directo / OTA) es informativo; la fuente de verdad del canal sigue siendo la reserva de Módulo 2.
- `GET /pricing/dynamic-rate` se mantiene para consultas de tarifa por noche (Módulo 2, OTA).

### Autenticación

- **Entre módulos (M1 ↔ M3, M2 ↔ M3): sin token.** Los 3 servicios corren en la misma red interna (red de Docker Compose) y confían en ella. Los endpoints que consumen Módulo 1 y Módulo 2 no se publican fuera de esa red. Ninguna regla de negocio depende de saber qué módulo llama.
- **Personas y OTA: JWT de usuario emitido por Módulo 3.** Módulo 3 tiene su propio login: `POST /auth/login` recibe `{ username, password }` y responde `{ accessToken, expiresIn }`. Las credenciales están en la tabla `app_user` (contraseña con hash bcrypt) y se crean por seed: no hay feature de gestión de usuarios. El token se firma con `@nestjs/jwt` usando un secreto que se carga desde variable de entorno y nunca se versiona, y se valida con Passport-JWT. Claims:
  - `sub`: identificador del usuario.
  - `role`: `Administrador` u `OTA`.
  - `otaId`: obligatorio si `role = OTA`; con él se aplica BR-002 de `consultar_liquidacion.md` (una OTA solo ve sus propias reservas).

### Autorización por rol

| Endpoints | Quién puede llamar |
|---|---|
| `POST /auth/login` | Público (Administrador u OTA con sus credenciales) |
| `/admin/*`, `/invoices*` | Solo JWT con `role = Administrador` |
| `POST /pricing/quotes` | Solo Módulo 2 (red interna, sin token) |
| `GET /pricing/dynamic-rate`, `GET /ota-commission/{otaId}`, `GET /api/settlements` | Módulo 1 / Módulo 2 por la red interna sin token, u OTA con JWT `role = OTA` |

- Cada controller declara los roles permitidos con `@Roles(...)` y un Guard valida el claim `role`. En los endpoints compartidos con la OTA, si llega un token se valida y se aplican las reglas de OTA; si no llega, se trata como llamada interna de un módulo.
- Las reglas que dependen de datos de negocio (p. ej. que la reserva consultada sea de la OTA del token) se validan en el caso de uso, no solo en el Guard.

### Formato Estándar de Error (`ApiError`)

Toda excepción o rechazo funcional se traduce a un cuerpo JSON estandarizado:
```json
{
  "errorCode": "INVALID_VAT_RATE | OVERLAPPING_SEASON | MISSING_COMMISSION | SETTLEMENT_NOT_FOUND | INVOICE_NOT_FOUND | BASE_RATE_NOT_FOUND | MODULE1_UNAVAILABLE | RESERVATION_NOT_FOUND | QUOTE_NOT_FOUND | MODULE2_UNAVAILABLE | INVALID_COMMISSION | SETTLEMENT_ALREADY_EXISTS | MISSING_SEARCH_CRITERIA | INVALID_DATE_RANGE | INVALID_QUERY_PARAMS | UNAUTHENTICATED | FORBIDDEN | DATABASE_UNAVAILABLE",
  "message": "Descripción legible y accionable de la regla violada o contingencia.",
  "timestamp": "2026-09-28T10:30:00Z",
  "path": "/admin/vat-rate"
}
```
- Errores de dominio tipados por contexto (`InvalidVatRateError`, `OverlappingSeasonError`, `MissingCommissionError`, `SettlementAlreadyExistsError`, etc.), definidos en `domain/errors/` y mapeados a códigos HTTP en el `ExceptionFilter` global (`infrastructure/adapters/in/http/domain-exception.filter.ts`).
- **HTTP 400**: Errores de validación o datos faltantes (p. ej. porcentaje de IVA inválido, rango de fechas inválido).
- **HTTP 401 / 403**: JWT ausente o inválido en un endpoint que lo exige / rol no autorizado para el endpoint o para el recurso (p. ej. una OTA consultando una reserva que no intermedió).
- **HTTP 404**: Recurso inexistente (liquidación aún no generada, factura no encontrada, tarifa base no encontrada en Módulo 1).
- **HTTP 409**: Conflicto con el estado actual (p. ej. temporadas solapadas).
- **HTTP 503**: Falla de comunicación con Módulo 1 o Módulo 2 (timeout/5xx o circuito abierto), distinta de la ausencia del dato (FR-008 de `consultar_tarifa_base.md`).
- **HTTP 500 no controlado PROHIBIDO**: todo error inesperado es capturado por el `ExceptionFilter` global, registrado con identificador de correlación en logs y devuelto con un código de error controlado.
- Todo motivo de rechazo devuelto al actor debe ser específico y accionable (NFR-005 de `generar_liquidacion.md`), nunca un error genérico.

---

## Project Structure

### Documentation

```text
docs/
├── diccionario.md
├── hospitua-modificado-minibar.md
├── HOSPITUA-Modulo-3-nuevo.jpg
├── sdd-guide.MD
├── spec-template.md
├── plan-template.md
└── plan-tecnico-base.md                  # Este archivo (plataforma compartida)

features/
├── 001-actualizar-porcentaje-iva/
│   ├── 1-functional/actualizar_porcentaje_iva.md
│   └── 2-technical/plan.md
├── 002-consultar-liquidacion/
├── 003-consultar-porcentaje-comision-ota/
├── 004-consultar-tarifa-base/
├── 005-consultar-tarifa-dinamica/
├── 006-generar-factura-final/
├── 007-generar-liquidacion/
├── 008-gestionar-facturacion/
├── 009-modificar-precio-tarifa-segun-temporada/
├── 010-registrar-checkout/
└── 011-revisar-temporada-del-año/        # Todas con la misma forma: 1-functional/ + 2-technical/
```

### Source Code (Arquitectura Hexagonal — Puertos y Adaptadores)

El proyecto tiene **una sola capa de dominio, una sola capa de aplicación y una sola capa de infraestructura**. Dentro de cada capa, el código se agrupa por *bounded context* interno (`shared`, `pricing`, `ota-commission`, `checkout-ingestion`, `settlement`, `billing`).

```text
src/
├── main.ts
├── app.module.ts
│
├── domain/                                       # CAPA DE DOMINIO (lógica de negocio pura, sin NestJS ni ORM)
│   ├── model/                                    # Entidades, Enums y Value Objects del núcleo
│   │   ├── shared/
│   │   │   ├── money.vo.ts
│   │   │   ├── date-range.vo.ts
│   │   │   └── channel.vo.ts                     # Directo | OTA
│   │   ├── pricing/
│   │   │   ├── season.ts                         # Enum: alta | regular | baja
│   │   │   ├── season-calendar-entry.ts          # Rango de fechas clasificado (sin solapamientos)
│   │   │   ├── season-rule.ts                    # Ajuste vigente por temporada
│   │   │   ├── base-rate.ts                      # Tarifa base consultada a Módulo 1
│   │   │   ├── dynamic-rate.ts                   # Resultado por noche (no se persiste)
│   │   │   └── lodging-quote.ts                  # Cotización del hospedaje (tarifa por noche + total), se persiste
│   │   ├── ota-commission/
│   │   │   └── ota-commission-reference.ts       # Último porcentaje aplicado (referencial, no contractual)
│   │   ├── checkout-ingestion/
│   │   │   └── checkout-event.ts                 # Payload validado del evento Registrar Check-out
│   │   ├── settlement/
│   │   │   └── settlement.ts                     # Liquidación, siempre en estado Final
│   │   └── billing/
│   │       ├── invoice.ts                        # Factura fiscal definitiva, inmutable
│   │       └── vat-rate.ts                       # IVA vigente único
│   ├── errors/                                   # Errores de reglas de negocio
│   │   ├── domain.error.ts                       # Error base de dominio
│   │   ├── overlapping-season.error.ts
│   │   ├── invalid-checkout-event.error.ts
│   │   ├── settlement-already-exists.error.ts
│   │   ├── missing-commission.error.ts
│   │   └── invalid-vat-rate.error.ts
│   └── ports/                                    # CONTRATOS / INTERFACES DE PUERTOS
│       ├── in/                                   # Puertos de Entrada (Casos de Uso primarios)
│       │   ├── review-season-calendar.use-case.ts        # 011
│       │   ├── modify-season-rule.use-case.ts            # 009
│       │   ├── get-base-rate.use-case.ts                 # 004
│       │   ├── get-dynamic-rate.use-case.ts              # 005
│       │   ├── create-lodging-quote.use-case.ts          # 005 Cotización del hospedaje para Módulo 2
│       │   ├── get-latest-ota-commission.use-case.ts     # 003
│       │   ├── register-checkout.use-case.ts             # 010 RegisterCheckoutUseCase
│       │   ├── generate-settlement.use-case.ts           # 007 GenerateSettlementUseCase
│       │   ├── get-settlement.use-case.ts                # 002
│       │   ├── generate-final-invoice.use-case.ts        # 006
│       │   ├── update-vat-rate.use-case.ts               # 001
│       │   └── manage-invoices.use-case.ts               # 008
│       └── out/                                  # Puertos de Salida (Persistencia, Clientes HTTP)
│           ├── season-calendar.repository.port.ts
│           ├── season-rule.repository.port.ts
│           ├── base-rate.client.port.ts          # Consulta de tarifa base a Módulo 1
│           ├── lodging-quote.repository.port.ts  # Persistencia de cotizaciones (pricing)
│           ├── lodging-quote-query.port.ts       # Solo lectura de cotizaciones guardadas, usado por settlement
│           ├── reservation.client.port.ts        # Consulta de reserva a Módulo 2
│           ├── ota-commission-query.port.ts      # Solo lectura sobre settlement
│           ├── checkout-event-log.repository.port.ts
│           ├── settlement.repository.port.ts     # SettlementRepositoryPort
│           ├── invoice.repository.port.ts
│           ├── invoice-number-sequence.port.ts   # Numeración consecutiva oficial
│           └── vat-rate.repository.port.ts
│
├── application/                                  # CAPA DE APLICACIÓN (orquestación de Casos de Uso)
│   ├── services/                                 # Implementaciones de Puertos de Entrada
│   │   ├── pricing/
│   │   │   ├── review-season-calendar.service.ts
│   │   │   ├── modify-season-rule.service.ts
│   │   │   ├── get-base-rate.service.ts
│   │   │   ├── get-dynamic-rate.service.ts       # Compone tarifa base + regla de temporada
│   │   │   └── create-lodging-quote.service.ts   # Tarifa dinámica × noches, guarda la cotización (en extensión copia las noches ya cotizadas)
│   │   ├── ota-commission/
│   │   │   └── get-latest-ota-commission.service.ts
│   │   ├── checkout-ingestion/
│   │   │   └── register-checkout.service.ts      # Valida el evento e incluye GenerateSettlement
│   │   ├── settlement/
│   │   │   ├── generate-settlement.service.ts    # Idempotente por estancia; consulta la reserva y lee la cotización
│   │   │   └── get-settlement.service.ts
│   │   └── billing/
│   │       ├── generate-final-invoice.service.ts # Incluye settlement
│   │       ├── update-vat-rate.service.ts
│   │       └── manage-invoices.service.ts        # Búsqueda, detalle y consolidado (ver plan 008)
│   └── dto/                                      # DTOs de comando y consulta de la capa de aplicación
│
└── infrastructure/                               # CAPA DE INFRAESTRUCTURA (Adaptadores y Configuración)
    ├── adapters/
    │   ├── in/                                   # Adaptadores Primarios / Driving (Entrada)
    │   │   ├── http/                             # Controllers REST (sin lógica de negocio)
    │   │   │   ├── dynamic-rate.controller.ts            # GET /pricing/dynamic-rate
│   │   │   ├── lodging-quote.controller.ts           # POST /pricing/quotes
    │   │   │   ├── season-admin.controller.ts            # GET/PUT /admin/season-rules, GET /admin/season-calendar
    │   │   │   ├── ota-commission.controller.ts          # GET /ota-commission/{otaId}
    │   │   │   ├── settlements.controller.ts             # GET /api/settlements (definitiva o informativa)
    │   │   │   ├── invoices-admin.controller.ts          # GET /invoices, /invoices/{id}, /invoices/summary
    │   │   │   ├── vat-rate-admin.controller.ts          # PUT /admin/vat-rate
    │   │   │   ├── health.controller.ts                  # @nestjs/terminus
    │   │   │   ├── domain-exception.filter.ts            # ExceptionFilter global: error de dominio → código HTTP
    │   │   │   └── auth/                                 # Aspecto técnico transversal, no es un bounded context
    │   │   │       ├── auth.controller.ts                # POST /auth/login
    │   │   │       ├── auth.service.ts                   # Verifica bcrypt contra app_user (vía PrismaService) y firma el JWT
    │   │   │       ├── jwt.strategy.ts                   # Passport-JWT
    │   │   │       ├── roles.guard.ts                    # Valida el claim role (Administrador, OTA)
    │   │   │       └── roles.decorator.ts                # @Roles("Administrador") / @Roles("OTA")
    │   │   └── messaging/                        # Consumers RabbitMQ
    │   │       └── checkout-registered.consumer.ts       # habitacion.checkout (ack manual, DLQ)
    │   └── out/                                  # Adaptadores Secundarios / Driven (Salida)
    │       ├── persistence/                      # Prisma + PostgreSQL
    │       │   ├── prisma.service.ts             # PrismaClient como provider de NestJS
    │       │   ├── mappers/                      # Mappers Dominio <-> modelo Prisma
    │       │   ├── repositories/                 # Implementaciones de puertos de persistencia
    │       │   │   ├── prisma-season-calendar.repository.ts
    │       │   │   ├── prisma-season-rule.repository.ts
│       │   │   ├── prisma-lodging-quote.repository.ts       # Implementa el repositorio y la consulta de solo lectura
    │       │   │   ├── prisma-ota-commission-query.adapter.ts
    │       │   │   ├── prisma-checkout-event-log.repository.ts
    │       │   │   ├── prisma-settlement.repository.ts
    │       │   │   ├── prisma-invoice.repository.ts
    │       │   │   ├── postgres-invoice-number-sequence.adapter.ts   # Secuencia nativa PostgreSQL
    │       │   │   └── prisma-vat-rate.repository.ts
    │       └── http/                             # Clientes HTTP hacia otros módulos
    │           ├── module1-base-rate.client.ts   # Implementa BaseRateClientPort (timeout + circuit breaker)
│           └── module2-reservation.client.ts # Implementa ReservationClientPort (timeout + circuit breaker)
    └── config/                                   # Configuración NestJS y binding puerto → adaptador
        ├── rabbitmq.config.ts                    # Exchange hospitua.events, colas y dead-letter
        ├── auth.config.ts
        ├── pricing.module.ts
        ├── ota-commission.module.ts
        ├── checkout-ingestion.module.ts
        ├── settlement.module.ts
        └── billing.module.ts

prisma/
├── schema.prisma                                 # Modelos y mapeo de tablas (fuente del cliente Prisma generado)
└── migrations/                                   # Prisma Migrate

test/
├── unit/                                         # Jest, puertos mockeados
│   ├── domain/                                   # Modelo y reglas de negocio
│   └── application/                              # Servicios de aplicación
├── integration/                                  # Adaptadores reales con Testcontainers
│   ├── persistence/                              # Repositorios Prisma contra PostgreSQL real
│   ├── messaging/                                # Consumer contra RabbitMQ real
│   └── http/                                     # Clientes de Módulo 1 y Módulo 2 (éxito, 404, timeout/5xx)
├── contract/                                     # Payload de Registrar Check-out y endpoints REST expuestos
└── e2e/                                          # Flujo completo: evento de check-out → liquidación → factura

docker-compose.yml                                # Postgres + RabbitMQ + API para desarrollo local
```

**Structure Decision**: un servicio NestJS único (monolito modular) con una sola capa `domain/`, una sola `application/` y una sola `infrastructure/`, y los 5 *bounded contexts* internos como subcarpetas dentro de cada capa. No se opta por microservicios separados por contexto en esta fase: el volumen de features (11) y su fuerte acoplamiento transaccional (`checkout-ingestion` → `settlement` → `billing` en una misma unidad de trabajo) no lo justifica todavía. Si en el futuro un contexto necesita escalar o desplegarse de forma independiente, los límites de puertos/adaptadores ya definidos facilitan extraerlo. Los archivos listados son la forma esperada; el detalle definitivo lo fija el plan técnico de cada feature.

---

## Diseño Técnico Base

### Bounded contexts internos (mapeo a las 11 features)

| Bounded context | Features que cubre | Responsabilidad |
|---|---|---|
| `pricing` | 004 Consultar tarifa base, 005 Consultar tarifa dinámica, 009 Modificar precio tarifa según temporada, 011 Revisar temporada del año | Calcula tarifa dinámica combinando tarifa base (consultada a Módulo 1) y regla de temporada vigente (administrada en Módulo 3), y guarda la cotización del hospedaje que Módulo 2 solicita al crear una reserva |
| `ota-commission` | 003 Consultar porcentaje de comisión OTA | Vista de solo lectura, derivada de `settlement`, del último porcentaje aplicado por OTA. Nunca es fuente de verdad para `Generar liquidación` |
| `checkout-ingestion` | 010 Registrar Check-out | Único punto de entrada asíncrono desde Módulo 1; valida el evento y dispara (`<<include>>`) `settlement` |
| `settlement` | 007 Generar liquidación, 002 Consultar liquidación | Genera la liquidación `Final` idempotente de cada habitación con los datos de la reserva (Módulo 2) y el valor de hospedaje de su cotización guardada, sin recalcularlo; también la calcula de forma informativa, sin persistir, cuando Módulo 1 la consulta antes del check-out |
| `billing` | 006 Generar factura final, 001 Actualizar porcentaje de IVA, 008 Gestionar facturación | Emite la factura fiscal definitiva (incluye `settlement`), administra el IVA vigente y expone búsqueda/consolidado para el Administrador |

Dirección de las dependencias entre contextos (coherente con las relaciones `<<include>>` de las specs — BR-001/BR-009 de `generar_liquidacion.md`, BR-001 de `generar_factura_final.md`):

```
checkout-ingestion ──include──> settlement ──include──> (reutilizado por) billing
pricing            (settlement solo lee cotizaciones ya guardadas mediante LodgingQuoteQueryPort; nunca invoca el cálculo)
ota-commission      (solo lee datos ya persistidos por settlement, de forma asíncrona/derivada — nunca al revés)
```

### Modelo de Datos Relacional (PostgreSQL)

Basado en las entidades clave de `docs/diccionario.md` y de cada spec:

| Tabla | Bounded context | Descripción y Atributos Clave |
|---|---|---|
| `vat_rate` (+ `vat_rate_history`) | `billing` | Porcentaje de IVA vigente único y su historial (BR-003 de `actualizar_porcentaje_iva.md`). |
| `season_calendar_entry` | `pricing` | Rangos de fecha clasificados como alta/baja/regular, sin solapamientos (BR-005 de `revisar_temporada_del_año.md`). |
| `season_rule` (+ historial) | `pricing` | Ajuste vigente por temporada (BR-005 de `modificar_precio_tarifa_segun_temporada.md`). |
| `lodging_quote` (+ `lodging_quote_night`) | `pricing` | Cotización del hospedaje de una habitación, solicitada por Módulo 2 al crear o extender la reserva: tipo de habitación, fechas reservadas, moneda, tarifa por noche, total y `extends_quote_id` (opcional, la cotización que extiende). Inmutable una vez creada. |
| `settlement` | `settlement` | Liquidación: una fila por estancia, `UNIQUE(stay_id)`, estado siempre `Final` (BR-006/FR-010 de `generar_liquidacion.md`). |
| `invoice` | `billing` | Factura: `UNIQUE(settlement_id)`, número de una secuencia PostgreSQL dedicada para la numeración consecutiva oficial (FR-011 de `generar_factura_final.md`). |
| `app_user` | auth (transversal) | Usuarios del login propio: `username` único, `password_hash` (bcrypt), `role` (`Administrador` / `OTA`), `ota_id` (obligatorio si es OTA), `active`. Se crean por seed. |
| `checkout_event_log` | `checkout-ingestion` | Registro de cada evento de check-out recibido, para trazabilidad y para resolver idempotencia de forma explícita (NFR-004 de `registrar_checkout.md`). |

La numeración consecutiva oficial usa una **secuencia nativa de PostgreSQL** (no un contador en tabla de aplicación) para que la asignación sea atómica incluso ante reintentos concurrentes del cierre de check-out (FR-011, NFR-003 de `generar_factura_final.md`).

### Reglas Transversales de Arquitectura

Las reglas de dependencia (1 a 4) se validan en code review y, cuando sea posible, con lint de arquitectura tipo `dependency-cruiser`.

1. **Aislamiento de Dominio**: `domain/` no importa nada de `application/` ni de `infrastructure/`, ni del framework NestJS, ni del ORM.
2. **Aplicación solo contra puertos**: `application/` solo depende de `domain/` (entidades y **puertos**, nunca de adaptadores concretos).
3. **Infraestructura implementa puertos**: `infrastructure/` implementa los puertos definidos en `domain/` y es lo único que conoce NestJS, Prisma, RabbitMQ o clientes HTTP.
4. **Binding por token**: la inyección de dependencias de NestJS conecta cada puerto con su adaptador mediante un token (`Symbol` o clase abstracta), definido en el módulo NestJS de cada contexto (`infrastructure/config/*.module.ts`). Esto permite, por ejemplo, que `Generar liquidación` dependa de `SettlementRepositoryPort` sin saber si detrás hay PostgreSQL, y que las pruebas unitarias del dominio no necesiten levantar Postgres ni RabbitMQ.
5. **Límite de `settlement`**: `settlement` **nunca** invoca el cálculo de `pricing` ni `ota-commission`. El valor de hospedaje se calcula una sola vez, al reservar, y `settlement` lo lee de la cotización guardada de esa habitación (entre los `quoteIds` de la reserva) mediante `LodgingQuoteQueryPort`, sin recalcularlo; así el cliente paga lo que vio aunque después cambien las reglas de temporada o la tarifa base. El canal y los datos de la OTA (incluida la comisión) se obtienen de Módulo 2 (FR-005 de `generar_liquidacion.md`). Este límite es intencional y debe respetarse en cada plan técnico de feature.
6. **Idempotencia y determinismo**: `Generar liquidación` y `Generar factura final` resuelven siempre al mismo resultado ante reenvíos del mismo evento (`UNIQUE(stay_id)` en `settlement`, `UNIQUE(settlement_id)` en `invoice`).
7. **Inmutabilidad de facturas**: una factura emitida no se modifica; las features de consulta (002, 008) son exclusivamente de lectura.
8. **Adaptadores de entrada sin lógica**: controllers y consumers solo mapean HTTP/mensaje ↔ caso de uso.
9. **Autorización en dos niveles**: Guard por rol en el adaptador de entrada y, cuando la regla depende de datos de negocio (p. ej. OTA solo ve lo suyo), validación adicional en el caso de uso.
10. **Errores específicos**: todo error de dominio se traduce a un código HTTP en el `ExceptionFilter` compartido, con un motivo accionable, nunca genérico.

---

## Estrategia de Testing Base

- **Tests Unitarios** (`test/unit`, Jest):
  - Dominio y casos de uso, con los puertos mockeados — sin NestJS, sin base de datos, sin cola.
- **Tests de Integración** (`test/integration`, Jest + Testcontainers):
  - Adaptadores reales (repositorios Prisma, consumer de RabbitMQ) contra Postgres y RabbitMQ levantados con Testcontainers.
- **Tests E2E** (`test/e2e`, Supertest):
  - Flujo completo `Registrar Check-out` → `Generar liquidación` → `Generar factura final`.
  - Flujos de consulta cruzados por rol (OTA solo ve lo suyo, Administrador en `/admin/*`, etc.).
- **Contract tests** (`test/contract`):
  - Sobre el payload del evento `Registrar Check-out` y sobre los endpoints REST expuestos a Módulo 1/Módulo 2/OTA, para detectar breaking changes antes de integrar con los otros módulos.

Cada plan técnico de feature (`features/NNN-.../2-technical/plan.md`) debe indicar qué pruebas de estas categorías aplica, siguiendo `docs/plan-template.md`.

---

## Phase 1: Setup (Infraestructura Compartida)

- [ ] T001 Scaffolding NestJS (`nest new`) con la estructura de carpetas descrita en [Project Structure](#project-structure)
- [ ] T002 [P] Crear `docker-compose.yml` con PostgreSQL + RabbitMQ + API para desarrollo local
- [ ] T003 [P] Configurar linting/formatting (ESLint + Prettier) y husky/lint-staged
- [ ] T004 [P] Configurar reglas de `dependency-cruiser` para validar las reglas de dependencia entre capas (cuando sea posible)
- [ ] T005 Configurar CI base (build + lint + test unitario) — pipeline compartido con Módulo 1/Módulo 2 si aplica

---

## Phase 2: Foundational (Prerrequisitos Bloqueantes)

**CRÍTICO**: Ningún plan de feature puede comenzar su implementación hasta completar satisfactoriamente esta fase base.

- [ ] T006 [P] Implementar Value Objects compartidos (`Money`, `DateRange`, `Channel`) en `src/domain/model/shared/`
- [ ] T007 [P] Implementar el error base de dominio y el filtro de excepciones global en `src/domain/errors/` y `src/infrastructure/adapters/in/http/`
- [ ] T008 Configurar la conexión a PostgreSQL con Prisma (`prisma/schema.prisma`, `PrismaService`) y Prisma Migrate
- [ ] T009 Configurar la conexión a RabbitMQ (módulo de mensajería NestJS, exchange `hospitua.events`, colas y dead-letter)
- [ ] T010 [P] Implementar el login propio (`POST /auth/login`, tabla `app_user` con seed, bcrypt, `@nestjs/jwt`), la validación del JWT de usuario (`Administrador`, `OTA`) y los Guards/decoradores de autorización por rol en `src/infrastructure/adapters/in/http/auth/`
- [ ] T011 [P] Implementar health checks (`@nestjs/terminus`)
- [ ] T012 Configurar la infraestructura de pruebas con Testcontainers (PostgreSQL y RabbitMQ)

**Checkpoint Base**: con esto listo, cada *bounded context* puede implementarse en paralelo.

---

## Phase 3: `pricing` (features 011, 009, 005, 004)

Orden interno recomendado:

- [ ] T013 011 Revisar temporada del año — ver `features/011-revisar-temporada-del-año/2-technical/plan.md`
- [ ] T014 009 Modificar regla de temporada — ver `features/009-modificar-precio-tarifa-segun-temporada/2-technical/plan.md`
- [ ] T015 004 Consultar tarifa base (adaptador HTTP hacia Módulo 1) — ver `features/004-consultar-tarifa-base/2-technical/plan.md`
- [ ] T016 005 Consultar tarifa dinámica (compone las tres anteriores) y cotización del hospedaje (`POST /pricing/quotes`) — ver `features/005-consultar-tarifa-dinamica/2-technical/plan.md`

---

## Phase 4: `checkout-ingestion` + `settlement` (features 010, 007, 002)

Orden interno (depende de la cotización de T016):

- [ ] T017 007 Generar liquidación (caso de uso núcleo) — ver `features/007-generar-liquidacion/2-technical/plan.md`
- [ ] T018 010 Registrar Check-out (adaptador RabbitMQ que lo invoca) — ver `features/010-registrar-checkout/2-technical/plan.md`. Invoca también a 006 (Phase 5), por lo que su prueba de punta a punta requiere 006
- [ ] T019 002 Consultar liquidación (lectura) — ver `features/002-consultar-liquidacion/2-technical/plan.md`

---

## Phase 5: `billing` (features 006, 001, 008)

Orden interno:

- [ ] T020 001 Actualizar porcentaje de IVA — ver `features/001-actualizar-porcentaje-iva/2-technical/plan.md`
- [ ] T021 006 Generar factura final (incluye `settlement`) — ver `features/006-generar-factura-final/2-technical/plan.md`
- [ ] T022 008 Gestionar facturación (lectura/búsqueda) — ver `features/008-gestionar-facturacion/2-technical/plan.md`

---

## Phase 6: `ota-commission` (feature 003)

Depende de que `settlement` ya tenga liquidaciones `Final` persistidas para tener datos que leer.

- [ ] T023 003 Consultar porcentaje de comisión OTA — ver `features/003-consultar-porcentaje-comision-ota/2-technical/plan.md`

---

## Phase 7: Cierre y transversales

- [ ] T024 [P] Observabilidad (logging estructurado, métricas, trazas de eventos RabbitMQ)
- [ ] T025 [P] Endurecimiento de seguridad (rate limiting en endpoints públicos hacia OTA)
- [ ] T026 [P] Documentación OpenAPI publicada para Módulo 1/Módulo 2/OTA

**Checkpoint Final**: las 11 features de Módulo 3 integradas sobre la plataforma base, con contratos publicados para los otros módulos.

---

## Dependencies & Execution Order

- Phase 1 y Phase 2 son bloqueantes para cualquier feature.
- `pricing` (Phase 3) no depende de `settlement`/`billing`. `settlement` (Phase 4) sí necesita la cotización de `pricing` (T016) para leer el valor de hospedaje.
- `checkout-ingestion` y `settlement` (Phase 4) deben completarse antes de `billing` (Phase 5), porque `Generar factura final` incluye (`<<include>>`) a `Generar liquidación` (BR-001 de `generar_factura_final.md`).
- `ota-commission` (Phase 6) depende de que existan liquidaciones `Final` reales, así que se implementa al final aunque su lógica sea sencilla.

---

## Notes

- Este documento cubre el **proyecto base**; cada feature (`features/NNN-.../2-technical/plan.md`) debe escribir su propio plan siguiendo `docs/plan-template.md`, referenciando aquí para stack, capas y contratos ya decididos, y detallando solo lo específico de esa feature (entidades concretas, casos de uso, tareas granulares).
- Las reglas de negocio y límites de responsabilidad citados aquí (BR-xxx, FR-xxx) provienen de las specs funcionales ya existentes en `features/`; ante cualquier conflicto, la spec funcional de la feature es la fuente de verdad.
