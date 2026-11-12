# Implementación: Generar liquidación (007)

**Spec**: [generar_liquidacion.md](../1-functional/generar_liquidacion.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contratos**: [UC-generate-settlement.md](../2-technical/contracts/UC-generate-settlement.md) (caso de uso interno para 010 y 006) · [CLIENT-get-reservation.md](../2-technical/contracts/CLIENT-get-reservation.md) (cliente saliente hacia Módulo 2)
**Rama**: `implementation/007-generar-liquidacion`

Este documento es el mapa de dónde está el código de la 007. El código no vive en esta carpeta: sigue la arquitectura hexagonal del plan base, así que está repartido por capas en `src/` y `test/`, siempre dentro de una subcarpeta `settlement/`.

> Para encontrar todos los archivos de la 007 en VS Code: `Ctrl+Shift+F` y buscar `Feature 007`.

**Alcance de esta entrega**: Historias de usuario 1, 2 y 3 completas. La 007 **no tiene endpoint**: es un caso de uso interno que invocan 010 (Registrar check-out) y 006 (Generar factura final). Por eso no tiene caso de prueba manual propio en `4-testing/`: se prueba a mano con el check-out real del [TC-010](../../010-registrar-checkout/4-testing/TC-010-registrar-checkout.md), que genera la liquidación, y además con las pruebas automáticas (sección 4).

---

## 1. Qué hace

Cuando se registra el check-out de una habitación, la 007 genera su **liquidación `Final`**: cuánto le queda al hotel por el hospedaje.

```text
hospedaje   = lodgingAmount de la cotización guardada (005), sin recalcular
comisión    = hospedaje × porcentaje OTA / 100        (0 en canal directo)   half-up a 2 decimales
ingreso neto = hospedaje − comisión                    (sin IVA: lo agrega 006)
```

Ejemplo del plan: cotización de 750 000 (700 000 de tarifa base + 50 000 de ajuste dinámico), reserva de Booking con 15 % → comisión **112 500** y neto **637 500**.

| Dato | De dónde sale |
|---|---|
| Reserva, habitación, tipo de habitación, fechas reales | El evento de check-out de Módulo 1 (lo entrega 010 en el comando) |
| Canal, OTA, código de confirmación, % de comisión, cotizaciones | Módulo 2: `GET /api/reservations/{reservationRef}` |
| Valor de hospedaje y tarifa base por noche | La cotización que guardó la 005 al crear la reserva |

La liquidación **nunca cambia** y existe **una sola por estancia** (`stayId`): un reenvío idéntico del check-out devuelve la misma, y un intento con datos distintos se rechaza conservando la original.

---

## 2. Recorrido de una generación

Así viaja `generate({ eventId, stayId, reservationRef, roomId, categoryRoom, checkInDate, checkOutDate })`:

```text
010 / 006 ─► LoggedGenerateSettlementUseCase   log estructurado: estancia, canal, cotización, errorCode, duración
          ─► GenerateSettlementService
               1. CheckoutData.of               UUID, textos, fechas reales (salida ≥ entrada)       → INVALID_CHECKOUT_EVENT
               2. findByStayId                  ¿ya existe?  igual → la devuelve (sin llamar a nadie)
                                                             distinta → SETTLEMENT_ALREADY_EXISTS
               3. Módulo 2 getReservation       timeout 500 ms + circuit breaker                     → RESERVATION_NOT_FOUND / MODULE2_UNAVAILABLE
               4. findByIds(quoteIds) (005)     la de su roomId; si hay varias, la de menor quoteId  → QUOTE_NOT_FOUND
               5. channelTermsOf                OTA → % obligatorio de 0 a 100; otro canal → directo → MISSING_COMMISSION / INVALID_COMMISSION
               6. SettlementCalculator          desglose con Money (DOMINIO, sin IO)
               7. insert                        UNIQUE(stay_id): si otra entrega ganó, vuelve al paso 2
◄─── Settlement { status: FINAL, …desglose, quoteId, sourceEventId, generatedAt }
```

**Idea clave para explicar:** la 007 no calcula tarifas; **toma** el valor que el cliente aceptó al reservar (la cotización de la 005) y le aplica el canal que informa Módulo 2. El cálculo vive en un servicio de dominio puro (`SettlementCalculator`) que la 002 reutilizará para la liquidación informativa.

---

## 3. Archivos por capa

### Dominio — reglas de negocio puras (sin NestJS ni Prisma)

| Archivo | Qué hace | Requisito |
|---|---|---|
| [settlement-calculator.ts](../../../src/domain/model/settlement/settlement-calculator.ts) | Cotización + canal + comisión → hospedaje, parte base, ajuste dinámico, comisión y neto | FR-002, FR-006–FR-008, FR-012, FR-013 |
| [settlement.ts](../../../src/domain/model/settlement/settlement.ts) | La liquidación: siempre `FINAL`, inmutable; `prepare` arma lo que se guarda, `restore` la reconstruye y `differencesWith` detecta un check-out distinto | FR-009, FR-010, FR-011, FR-016 |
| [checkout-data.ts](../../../src/domain/model/settlement/checkout-data.ts) | Valida el comando de check-out; UUID en minúsculas | BR-007, FR-016 |
| [reservation-data.ts](../../../src/domain/model/settlement/reservation-data.ts) | Datos de la reserva de Módulo 2 y `channelTermsOf`: canal y comisión | FR-003–FR-007, FR-014 |
| [commission-percentage.vo.ts](../../../src/domain/model/settlement/commission-percentage.vo.ts) | Porcentaje de comisión de 0 a 100, con a lo sumo 2 decimales | FR-005, casos límite |
| [channel.vo.ts](../../../src/domain/model/shared/channel.vo.ts) | **Compartido (T006 del plan base).** Directo u OTA con su código de confirmación | FR-003 |
| [money.vo.ts](../../../src/domain/model/shared/money.vo.ts) | **Compartido con 004 y 005.** La 007 agrega `subtract` (el ajuste dinámico puede ser negativo) | NFR-004 |
| [errors/settlement/](../../../src/domain/errors/settlement/) | 7 errores: `RESERVATION_NOT_FOUND`, `QUOTE_NOT_FOUND`, `MISSING_COMMISSION`, `INVALID_COMMISSION`, `MODULE2_UNAVAILABLE`, `SETTLEMENT_ALREADY_EXISTS` y `INVALID_CHECKOUT_EVENT` | FR-014, FR-015, FR-021 |
| [generate-settlement.use-case.ts](../../../src/domain/ports/in/settlement/generate-settlement.use-case.ts) | Puerto de entrada y `GenerateSettlementCommand` | FR-001, FR-019 |
| [reservation.client.port.ts](../../../src/domain/ports/out/settlement/reservation.client.port.ts) | Puerto de salida hacia Módulo 2 (también para la HU4 de la 005) | FR-005, FR-021 |
| [settlement.repository.port.ts](../../../src/domain/ports/out/settlement/settlement.repository.port.ts) | Puerto de salida: `findByStayId`, `insert` (con `STAY_ALREADY_SETTLED`) y `findByReservationAndRoom` para la 002 | FR-010, FR-017 |

### Aplicación — caso de uso

| Archivo | Qué hace |
|---|---|
| [generate-settlement.service.ts](../../../src/application/services/settlement/generate-settlement.service.ts) | Orquesta los pasos 1 a 7 del recorrido. Sin decoradores de NestJS |

### Infraestructura — adaptadores

| Archivo | Qué hace |
|---|---|
| [module2-reservation.client.ts](../../../src/infrastructure/adapters/out/http/module2-reservation.client.ts) | `GET {MODULE2_BASE_URL}/api/reservations/{ref}` sin token, con `X-Correlation-Id`. Timeout de 500 ms y circuit breaker (se abre en el 5.º fallo seguido y prueba de nuevo a los 30 s), igual que el cliente de Módulo 1 de la 004. Valida la forma de la respuesta y descarta los demás campos |
| [settlement.mapper.ts](../../../src/infrastructure/adapters/out/persistence/mappers/settlement/settlement.mapper.ts) | Dominio ↔ fila de Prisma; fechas civiles sin zona horaria, importes como texto |
| [prisma-settlement.repository.ts](../../../src/infrastructure/adapters/out/persistence/repositories/settlement/prisma-settlement.repository.ts) | Solo `INSERT` y `SELECT`. Traduce la violación de `UNIQUE(stay_id)` a `STAY_ALREADY_SETTLED` |
| [logged-generate-settlement.use-case.ts](../../../src/infrastructure/logging/settlement/logged-generate-settlement.use-case.ts) | Envuelve el caso de uso con un log JSON por generación (T032), sin datos personales |
| [settlement.module.ts](../../../src/infrastructure/config/settlement.module.ts) | Wiring por token. Sin controllers. Exporta `GENERATE_SETTLEMENT_USE_CASE` (para 010 y 006) y `RESERVATION_CLIENT` |
| [domain-exception.filter.ts](../../../src/infrastructure/adapters/in/http/domain-exception.filter.ts) | Registra el HTTP de los códigos de la 007 para los endpoints que los reutilicen (002 y la HU4 de la 005): 404, 404, 409, 409 y 424, según el plan de la 002 |

### Base de datos

Migración [20261105000000_create_settlement](../../../prisma/migrations/20261105000000_create_settlement/migration.sql) y modelo `Settlement` en [schema.prisma](../../../prisma/schema.prisma). Tabla `settlement`, con las columnas del plan:

- `UNIQUE(stay_id)`: una liquidación por estancia (FR-010).
- Índices de lectura para 002 (`reservation_ref, room_id`) y 003 (`ota_id, generated_at DESC`).
- `generated_at` con la hora de la base de datos (NFR-003).
- `CHECK` escritos a mano: estado `FINAL`, moneda `COP`, fechas, datos de OTA solo con canal OTA (y comisión cero en directo), porcentaje de 0 a 100, y que el desglose cuadre (`net_income = lodging_amount − ota_commission_amount`, `dynamic_adjustment_amount = lodging_amount − base_lodging_amount`) (NFR-007).

---

## 4. Pruebas

| Archivo | Qué comprueba | Pruebas |
|---|---|:-:|
| [settlement-calculator.spec.ts](../../../test/unit/domain/settlement/settlement-calculator.spec.ts) | Directo y OTA (ejemplo del plan), ajuste dinámico negativo, nunca recalcula, half-up, 0 % y 100 %, determinismo | 11 |
| [commission-percentage.vo.spec.ts](../../../test/unit/domain/settlement/commission-percentage.vo.spec.ts) | Acepta 0 y 100, número o texto; rechaza negativos, > 100, más de 2 decimales y no numéricos (T021) | 26 |
| [reservation-data.spec.ts](../../../test/unit/domain/settlement/reservation-data.spec.ts) | Canal directo, sin canal y "ota" en minúsculas; OTA con comisión; comisión ausente o inválida | 16 |
| [checkout-data.spec.ts](../../../test/unit/domain/settlement/checkout-data.spec.ts) | Comando válido, salida el mismo día, ids de Módulo 1 sin RFC, 9 rechazos | 12 |
| [settlement.spec.ts](../../../test/unit/domain/settlement/settlement.spec.ts) | `prepare` con los campos del contrato, inmutable, reenvío idéntico, datos distintos | 4 |
| [channel.vo.spec.ts](../../../test/unit/domain/shared/channel.vo.spec.ts) · [money.vo.spec.ts](../../../test/unit/domain/shared/money.vo.spec.ts) | `Channel` y la función `subtract` que agrega la 007 | 4 + 4 |
| [generate-settlement.service.spec.ts](../../../test/unit/application/settlement/generate-settlement.service.spec.ts) | Las 3 historias con puertos simulados: cotización por `roomId`, menor `quoteId`, reenvío sin llamar a Módulo 2, cada rechazo sin guardar nada, OTA, entrega concurrente que gana la inserción (T014, T023, T026, T029) | 27 |
| [logged-generate-settlement.use-case.spec.ts](../../../test/unit/infrastructure/settlement/logged-generate-settlement.use-case.spec.ts) | Log de éxito y de rechazo con su `errorCode`, sin datos tributarios (T032) | 4 |
| [module2-reservation.client.spec.ts](../../../test/integration/http/module2-reservation.client.spec.ts) | Cliente real contra un servidor HTTP simulado: cabeceras, URL codificada, sin caché, 404, 5xx, otros 4xx, timeout, red, circuit breaker y configuración (T015) | 23 |
| [module2-reservation.contract.spec.ts](../../../test/contract/settlement/module2-reservation.contract.spec.ts) | Contrato con Módulo 2: ejemplos OTA y directo, campos desconocidos descartados, 404 y 10 cuerpos malformados (T016) | 19 |
| [prisma-settlement.repository.spec.ts](../../../test/integration/persistence/settlement/prisma-settlement.repository.spec.ts) | PostgreSQL real: guardar y leer igual, `STAY_ALREADY_SETTLED`, 3 inserciones simultáneas → 1 fila, consulta de la 002, `CHECK` (T017, T027) | 12 |
| [generate-settlement.flow.spec.ts](../../../test/integration/settlement/generate-settlement.flow.spec.ts) | Flujo real con Módulo 2 simulado y PostgreSQL: reenvío no cambia la fila (T031), entregas simultáneas, Módulo 2 caído, menos de 800 ms (T033) | 5 |
| [settlement-dependencies.spec.ts](../../../test/architecture/settlement-dependencies.spec.ts) | Solo 010, 006 y settlement importan el caso de uso; ningún controller; settlement nunca importa el cálculo de pricing ni billing; el repositorio no tiene `UPDATE` ni `DELETE` (T028, T030, T031) | 6 |

Resultado actual: **las 173 pruebas de la 007 pasan**, incluidas las de integración contra PostgreSQL real. El proyecto completo suma 680 pruebas unitarias, de contrato, de integración y de arquitectura, y 123 de punta a punta.

```powershell
$env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"
npm test             # unitarias, de contrato, de integración y de arquitectura
npm run test:e2e     # endpoints de punta a punta
```

Dobles de prueba propios: [fake-settlement-ports.ts](../../../test/support/settlement/fake-settlement-ports.ts) (Módulo 2, cotizaciones y liquidaciones en memoria, y los datos de ejemplo del contrato). Para simular Módulo 2 se reutiliza el servidor HTTP de la 004 ([module1-http-fixture.ts](../../../test/support/pricing/module1-http-fixture.ts)), al que se le agregaron las cabeceras de cada petición.

---

## 5. Trazabilidad: requisito → código → prueba

| Requisito de la spec | Dónde se cumple | Dónde se prueba |
|---|---|---|
| FR-001 / BR-001 / SC-007 Solo desde el check-out | Sin endpoint; solo `settlement.module.ts` construye el caso de uso | arquitectura (importadores y controllers) |
| FR-002 / BR-004 / SC-010 Hospedaje de la cotización, sin recalcular | `SettlementCalculator` toma `quote.lodgingAmount` | calculadora "nunca recalcula"; flujo "Módulo 2 cambia la comisión" |
| FR-003 / FR-004 / FR-007 / SC-003 Canal directo o sin canal → sin comisión | `channelTermsOf` | reservation-data; servicio |
| FR-005 / BR-010 Datos de la reserva de Módulo 2 | `Module2ReservationClient` | cliente y contrato |
| FR-006 / FR-008 / SC-002 Comisión y neto exactos | `SettlementCalculator` con `Money` | calculadora (ejemplo y half-up) |
| FR-009 / FR-017 Final e inmutable | `Settlement` congelada; repositorio solo inserta | settlement.spec; arquitectura; flujo T031 |
| FR-010 / BR-006 / SC-008 Una por estancia | `UNIQUE(stay_id)` + `differencesWith` | servicio HU3; repositorio T027 |
| FR-011 / SC-009 Reenvío idempotente | Paso 2 y relectura tras `STAY_ALREADY_SETTLED` | servicio; repositorio y flujo concurrentes |
| FR-012 Desglose con parte base y ajuste dinámico | `SettlementCalculator` + columnas | calculadora; repositorio |
| FR-013 / BR-005 Sin IVA | El calculador no conoce el IVA | calculadora |
| FR-014 / SC-004 Rechazos sin ingreso neto | Errores tipados antes de `insert` | servicio ("no guarda nada") |
| FR-015 / NFR-005 Motivo accionable | Mensajes con la reserva, la habitación, la OTA o la estancia | servicio (texto de los errores) |
| FR-016 Identifica la estancia | Columnas de `settlement` | settlement.spec; repositorio |
| FR-018 / BR-008 No toca la habitación | El servicio no tiene ningún puerto hacia Módulo 1 | (por diseño) |
| FR-019 / BR-009 No emite la factura | Ningún puerto hacia `billing` | arquitectura |
| FR-020 / BR-011 / SC-011 Una por habitación, por `roomId` | `quoteOf` filtra por `roomId`, no por tipo | servicio "dos habitaciones del mismo tipo" |
| FR-021 Módulo 2 caído → reintentable | `MODULE2_UNAVAILABLE` distinto de `RESERVATION_NOT_FOUND` | cliente; servicio; flujo |
| NFR-001 Determinismo | Menor `quoteId`; cálculo puro | servicio y calculadora |
| NFR-002 Tiempo | Timeout de 500 ms hacia Módulo 2 | flujo (< 800 ms) |
| NFR-003 Trazabilidad | `quote_id`, `source_event_id`, `generated_at`; log por generación | repositorio; log |
| NFR-006 Sin datos personales | El cliente descarta todo lo que no es del contrato; el log no los incluye | contrato; log |
| NFR-007 Integridad | `CHECK` del desglose y del canal | repositorio (CHECK) |

---

## 6. Estado de las tareas del plan

| Tarea | Estado |
|---|---|
| T001 (base del proyecto) | Parcial: `Money` existía; la 007 crea `Channel`. `DateRange` sigue sin existir (ver decisión 9) |
| T002 (cotizaciones de 005) | Hecho: `LodgingQuoteQueryPort.findByIds` con `roomId` y `baseRate` por noche |
| T003 (configuración y dependencias) | Hecho: `MODULE2_*` en `.env.example`; las dependencias ya estaban |
| T004–T012 (fundación) | Hecho |
| T013–T020 (Historia 1) | Hecho. T020: el comando está junto al puerto de entrada, como en la 005 |
| T021–T025 (Historia 2) | Hecho |
| T026–T029 (Historia 3) | Hecho |
| T030 (regla de `dependency-cruiser`) | Hecho con una prueba de arquitectura en Jest (decisión 12) |
| T031 (sin `UPDATE`) | Hecho: prueba de arquitectura + prueba de flujo que compara la fila antes y después |
| T032 (log estructurado) | Hecho |
| T033 (800 ms) | Hecho con Módulo 2 simulado; revisar con un Módulo 2 real |
| T034 (coordinar con 010 y 002) | Hecho: 010 aplica la tabla de errores (reintento o DLQ según el código) y 002 reutiliza `SettlementCalculator` para la liquidación informativa |

---

## 7. Decisiones de implementación

Lo que no fijaban la spec, el plan ni los contratos:

1. **`X-Correlation-Id` hacia Módulo 2 = `eventId`**: `getReservation(reservationRef, correlationId?)` recibe un segundo parámetro opcional; el servicio pasa el `eventId` del check-out, como en el ejemplo del contrato.
2. **Comando inválido → `INVALID_CHECKOUT_EVENT`**: el contrato dice que es un error del llamador pero no le da código; se usa el mismo con el que 010 manda un evento inválido a dead-letter.
3. **Porcentaje de comisión**: se acepta como número JSON o como texto; con más de 2 decimales significativos (`12.345`) es `INVALID_COMMISSION`, para no redondearlo en silencio en la columna `numeric(5,2)`. Un texto vacío cuenta como ausente (`MISSING_COMMISSION`).
4. **Canal**: solo `"OTA"` exacto es intermediario; cualquier otro valor (incluido `"ota"`) es directo, como dice el contrato.
5. **Respuestas de Módulo 2**: cualquier `404` es `RESERVATION_NOT_FOUND`, con o sin cuerpo (el contrato no define uno, a diferencia del de Módulo 1). Una respuesta 200 fuera de contrato (incluida una reserva OTA sin `otaId` o sin `otaConfirmationCode`) es `MODULE2_UNAVAILABLE`, se registra con un `warn` que solo nombra el campo y cuenta para el circuito, igual que otro `4xx`.
6. **Orden de los rechazos**: el del contrato (cotización antes que comisión), así que una reserva OTA sin cotización ni comisión da `QUOTE_NOT_FOUND`.
7. **Sin FK de `settlement.quote_id` a `lodging_quote`**: settlement solo lee las cotizaciones por su puerto (regla 5 del plan base), y una FK ataría las tablas de dos contextos (las pruebas de la 005 borran `lodging_quote`). La integridad del desglose la dan los `CHECK`.
8. **UUID en minúsculas** (`stayId`, `roomId`, `eventId`), como en la 005: la liquidación que se lee después es idéntica a la que se crea.
9. **Sin `DateRange` compartido**: igual que la 005 con su `StayRange`, la 007 valida las fechas con `CalendarDate` de la 011 dentro de `CheckoutData`. `Channel` sí se creó en `shared/`.
10. **Estructura de archivos**: la de 004, 005, 009 y 011 (`errors/settlement/`, `ports/in|out/settlement/`, `test/*/settlement/`), no el árbol del plan. No hay `application/dto/`.
11. **Log en infraestructura**: un decorador del caso de uso, para que el servicio de aplicación no dependa de NestJS.
12. **Prueba de arquitectura en Jest en lugar de `dependency-cruiser`**: la herramienta no está instalada en el proyecto. La prueba lee los imports de `src/` y también cubre parte de la T031 de la 005 (settlement nunca importa el cálculo de pricing).
13. **`findByReservationAndRoom`** (para 002): si hubiera más de una estancia de esa habitación en la reserva, devuelve la más reciente; con un `roomId` que no es UUID devuelve `null`.
14. **Pruebas de integración**: igual que 001, 005, 009 y 011, usan `TEST_DATABASE_URL` (no Testcontainers) y se omiten sin ella. Solo borran las liquidaciones de sus propias estancias, así que no necesitan bloqueo.

---

## 8. Dependencias con otras features

- **005 Consultar tarifa dinámica**: la 007 lee las cotizaciones con `LODGING_QUOTE_QUERY` (`findByIds`), exportado por `PricingModule`. Nunca invoca el cálculo.
- **005, HU4 (OTA)**: puede usar `RESERVATION_CLIENT`, que exporta `SettlementModule`. Ojo: `SettlementModule` ya importa `PricingModule`, así que si `PricingModule` importa `SettlementModule` habrá una dependencia circular; habrá que usar `forwardRef` o mover el cliente a un módulo propio.
- **010 Registrar check-out**: inyecta `GENERATE_SETTLEMENT_USE_CASE` y decide el `ack` con la tabla de errores del contrato (solo `MODULE2_UNAVAILABLE` va a la cola de reintento).
- **006 Generar factura final**: inyecta el mismo caso de uso; por la idempotencia siempre obtiene la misma liquidación.
- **002 Consultar liquidación**: usa `findByReservationAndRoom`, `SettlementCalculator`, `channelTermsOf` y los HTTP ya registrados en el filtro.
- **003 Comisión OTA**: lee `settlement` con su propio puerto; el índice `(ota_id, generated_at DESC)` ya existe.
- **Archivos compartidos que tocó la 007**: `money.vo.ts` (+ su prueba), `domain-exception.filter.ts`, `app.module.ts`, `schema.prisma`, `.env.example`, `test/support/e2e-env.ts`, `test/support/pricing/module1-http-fixture.ts` (cabeceras de cada petición) y los contract tests de la 005 que arrancan `AppModule` (necesitan `MODULE2_*`).
- **Configuración**: `MODULE2_BASE_URL` y `MODULE2_TIMEOUT_MS` son obligatorias; sin ellas la aplicación no arranca.
- **Migraciones**: la próxima se debe generar con `prisma migrate diff` desde el esquema anterior, para no perder los `CHECK` escritos a mano.
