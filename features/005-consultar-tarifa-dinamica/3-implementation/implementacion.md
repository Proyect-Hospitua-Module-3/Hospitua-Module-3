# Implementación: Consultar tarifa dinámica (005)

**Spec**: [consultar_tarifa_dinamica.md](../1-functional/consultar_tarifa_dinamica.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contratos**: [GET-pricing-dynamic-rate.md](../2-technical/contracts/GET-pricing-dynamic-rate.md) (REST) · [POST-pricing-quotes.md](../2-technical/contracts/POST-pricing-quotes.md) (REST) · [PORT-find-lodging-quotes-by-ids.md](../2-technical/contracts/PORT-find-lodging-quotes-by-ids.md) (puerto interno para 007)
**Rama**: `implementation/005-consultar-tarifa-dinamica`

Este documento es el mapa de dónde está el código de la 005. El código no vive en esta carpeta: sigue la arquitectura hexagonal del plan base, así que está repartido por capas en `src/` y `test/`, siempre dentro de una subcarpeta `pricing/`.

> Para encontrar todos los archivos de la 005 en VS Code: `Ctrl+Shift+F` y buscar `Feature 005`.

**Alcance**: las 4 Historias de usuario. La Historia 4 (la OTA consulta la tarifa de sus reservas) usa el cliente de Módulo 2 (`ReservationClientPort`) que creó la 007.

---

## 1. Qué hace

La **tarifa dinámica** de una noche es la tarifa base de la habitación (la da Módulo 1, a través de la 004) ajustada con el porcentaje de la temporada que rige esa fecha (la temporada sale del calendario de la 011 y su porcentaje del catálogo de la 009):

```text
tarifa dinámica = tarifa base × (1 + ajuste / 100)      redondeo half-up a 2 decimales
```

Ejemplo: 300 000 en temporada Alta (+20 %) → **360 000**. El nombre de la temporada no importa, solo el número: −10 % baja la tarifa, 0 % la deja igual, −100 % la deja en cero y +100 % la duplica.

| Endpoint | Quién | Qué hace |
|---|---|---|
| `GET /pricing/dynamic-rate` | Módulo 2, sin token; o la OTA con su token, solo para habitaciones de sus reservas (envía `reservationRef`) | Tarifa de una noche (`date`) o de una estadía (`checkInDate` + `checkOutDate`, la salida no se cobra), noche por noche y con el total. **No guarda nada**. El resultado es el mismo para Módulo 2 y para la OTA |
| `POST /pricing/quotes` | Solo Módulo 2, sin token | Calcula lo mismo y **guarda la cotización** de la habitación. Devuelve el `quoteId` que Módulo 2 guarda en la reserva |

La cotización guardada **nunca cambia**: si después el Administrador cambia una temporada o Módulo 1 cambia la tarifa base, la cotización conserva su valor. La 007 (liquidación) la lee con el puerto `LodgingQuoteQueryPort.findByIds` y cobra exactamente ese valor.

---

## 2. Recorrido de una petición

Así viaja `GET /pricing/dynamic-rate?roomId=…&checkInDate=2026-12-23&checkOutDate=2026-12-26`:

```text
HTTP ─► OptionalJwtAuthGuard        ¿llegó Authorization? sin token = Módulo 2; token inválido     → 401
     ─► InternalOrOtaGuard          con token, ¿es de rol OTA? (Administrador)                      → 403
     ─► DynamicRateController + pipe ¿cada parámetro una vez y como texto?                          → 400
     ─► GetDynamicRateService       roomId UUID, date O el rango, fechas reales, salida > entrada  → 400
                                    (todo antes de llamar a nadie)
                                    solo la OTA (HU4): ¿envió reservationRef?                       → 400
                                      007 getReservation(ref) a Módulo 2: no responde               → 424
                                      ¿canal OTA, su otaId y una cotización de esta habitación?
                                      (si no, o si la reserva no existe: mismo mensaje)            → 403
     ─► DynamicRateCalculator       ┌ asOf = ahora (una sola vez)
                                    │ 009 getAll(asOf): UN snapshot de temporadas y porcentajes
                                    │ por cada noche [23, 24, 25] — hasta 4 noches a la vez:
                                    │   004 execute(roomId, noche) → tarifa base de Módulo 1        → 404 / 424
                                    │   011 resolve({ noche, asOf }) → seasonId de esa fecha
                                    │   buscar el seasonId en el snapshot (si no está)              → 422
                                    │   DynamicRate.compute → calculateDynamicRate (DOMINIO)
                                    └ si una noche falla, falla todo: sin resultado parcial
◄─── 200 { roomId, currency: "COP", nights: [ { date, baseRate, seasonName, seasonAdjustmentPercent, dynamicRate } ], total }
```

`POST /pricing/quotes` usa **el mismo calculador** (así la cotización coincide con lo que Módulo 2 consultó), arma la `LodgingQuote` (que suma las noches) y la guarda con `PrismaLodgingQuoteRepository.insert`: la cotización y sus noches en una sola transacción.

**Idea clave para explicar:** la 005 no tiene tarifas ni temporadas propias; **compone** tres features (004, 009 y 011) a través de sus puertos, y el cálculo vive en una función pura del dominio que no sabe de NestJS, de HTTP ni de la base de datos. Lo único que guarda es la cotización.

---

## 3. Archivos por capa

### Dominio — reglas de negocio puras (sin NestJS ni Prisma)

| Archivo | Qué hace | Requisito |
|---|---|---|
| [calculate-dynamic-rate.ts](../../../src/domain/model/pricing/calculate-dynamic-rate.ts) | La fórmula: `base × (1 + ajuste / 100)`, half-up a 2 decimales. No recibe el nombre de la temporada | FR-002, BR-007 |
| [dynamic-rate.ts](../../../src/domain/model/pricing/dynamic-rate.ts) | Resultado de una noche: fecha, tarifa base, temporada, ajuste y tarifa dinámica (para trazar el valor) | FR-009, NFR-004 |
| [stay-range.ts](../../../src/domain/model/pricing/stay-range.ts) | Estadía `[entrada, salida)`: rechaza salida ≤ entrada y la parte en noches; `singleNight` para `date` | FR-008 |
| [lodging-quote.ts](../../../src/domain/model/pricing/lodging-quote.ts) | Cotización inmutable: una noche por fecha de la estadía, total = suma exacta; `restore` la reconstruye sin recalcular | FR-012, FR-013, BR-006 |
| [money.vo.ts](../../../src/domain/model/shared/money.vo.ts) | **Compartido con 004.** La 005 agrega `zero`, `add` y `multiply` (decimal exacto, nunca `number`) | FR-002 |
| [errors/pricing/](../../../src/domain/errors/pricing/) | 4 errores de la 005: `INVALID_DATE_RANGE`, `INVALID_QUERY_PARAMS` (`InvalidPricingRequestError`), `FORBIDDEN` (`DynamicRateAccessDeniedError`, HU4: mismo mensaje en todos los casos) y el interno `SEASON_CONFIGURATION_INCONSISTENT` | FR-008, FR-010 |
| [get-dynamic-rate.use-case.ts](../../../src/domain/ports/in/pricing/get-dynamic-rate.use-case.ts) | Puerto de entrada: consultar la tarifa. Recibe quién consulta (`INTERNAL` o `OTA` con su `otaId`) y, para la OTA, `reservationRef` | FR-001, FR-010 |
| [create-lodging-quote.use-case.ts](../../../src/domain/ports/in/pricing/create-lodging-quote.use-case.ts) | Puerto de entrada: cotizar | FR-012 |
| [lodging-quote.repository.port.ts](../../../src/domain/ports/out/pricing/lodging-quote.repository.port.ts) | Puerto de salida: solo `insert` (no hay update ni delete) | FR-013 |
| [lodging-quote-query.port.ts](../../../src/domain/ports/out/pricing/lodging-quote-query.port.ts) | Puerto de salida de solo lectura que consume la 007: `findByIds` | FR-012 |

### Aplicación — casos de uso

| Archivo | Qué hace | Requisito |
|---|---|---|
| [pricing-request.ts](../../../src/application/services/pricing/pricing-request.ts) | Valida `roomId` y fechas antes de llamar a cualquier puerto | FR-008 |
| [dynamic-rate-calculator.ts](../../../src/application/services/pricing/dynamic-rate-calculator.ts) | Cálculo por noche que comparten el GET y el POST: un `asOf` y un snapshot de 009, temporada de 011 y tarifa de 004 por noche, hasta 4 noches en paralelo, todo o nada | FR-002–FR-006, BR-003, NFR-001, NFR-003 |
| [get-dynamic-rate.service.ts](../../../src/application/services/pricing/get-dynamic-rate.service.ts) | `date` o el rango (nunca los dos), calcula y suma el total. Para la OTA, antes de calcular: exige `reservationRef`, consulta la reserva a Módulo 2 con el puerto de la 007 y comprueba canal `OTA`, su `otaId` y una cotización de la habitación (`findByIds`); si no, o si la reserva no existe, `DynamicRateAccessDeniedError` | FR-001, FR-003, FR-007, FR-010, FR-011 |
| [create-lodging-quote.service.ts](../../../src/application/services/pricing/create-lodging-quote.service.ts) | Calcula, crea la cotización con un `quoteId` nuevo y la guarda | FR-012, FR-015 |

### Infraestructura — adaptadores

| Archivo | Qué hace | Requisito |
|---|---|---|
| [dynamic-rate.controller.ts](../../../src/infrastructure/adapters/in/http/pricing/dynamic-rate.controller.ts) | `GET /pricing/dynamic-rate`. Sin usuario es una llamada interna; con usuario, pasa la OTA y su `otaId` al caso de uso | FR-001, FR-010 |
| [lodging-quote.controller.ts](../../../src/infrastructure/adapters/in/http/pricing/lodging-quote.controller.ts) | `POST /pricing/quotes`, responde `200` | FR-012, FR-016 |
| [internal-call-only.guard.ts](../../../src/infrastructure/adapters/in/http/pricing/internal-call-only.guard.ts) | Solo el `POST`: rechaza con `403` cualquier solicitud con `Authorization` | FR-016, BR-008 |
| [internal-or-ota.guard.ts](../../../src/infrastructure/adapters/in/http/pricing/internal-or-ota.guard.ts) | Solo el `GET` (HU4): sin token deja pasar (Módulo 2); con token, solo el rol `OTA` (otro rol → `403`) | FR-010, BR-002 |
| [optional-jwt-auth.guard.ts](../../../src/infrastructure/adapters/in/http/auth/optional-jwt-auth.guard.ts) | **Nuevo en la carpeta compartida de auth.** Sin token deja pasar; con token exige que sea válido (`401`) | FR-010 |
| [pricing-validation.ts](../../../src/infrastructure/adapters/in/http/pricing/pricing-validation.ts) | Cualquier error de forma en la query o el cuerpo → `INVALID_QUERY_PARAMS` | — |
| [dto/dynamic-rate.dto.ts](../../../src/infrastructure/adapters/in/http/pricing/dto/dynamic-rate.dto.ts), [dto/lodging-quote.dto.ts](../../../src/infrastructure/adapters/in/http/pricing/dto/lodging-quote.dto.ts) | Query, cuerpo y respuestas HTTP (también documentan Swagger) | — |
| [prisma-lodging-quote.repository.ts](../../../src/infrastructure/adapters/out/persistence/repositories/pricing/prisma-lodging-quote.repository.ts) | Archivo de acceso a datos: `insert` (cotización y noches en un solo `create` anidado, atómico) y `findByIds` (ids inexistentes o que no son UUID se ignoran) | FR-012, FR-013, FR-015 |
| [lodging-quote.mapper.ts](../../../src/infrastructure/adapters/out/persistence/mappers/pricing/lodging-quote.mapper.ts) | Dominio ↔ filas (fechas `DATE` como texto `YYYY-MM-DD`, importes como texto) | — |
| [domain-exception.filter.ts](../../../src/infrastructure/adapters/in/http/domain-exception.filter.ts) | **Compartido.** La 005 agrega `INVALID_DATE_RANGE` 400, `INVALID_QUERY_PARAMS` 400, y los de Módulo 1 (004) que salen por sus endpoints: `ROOM_NOT_FOUND` 404, `INVALID_BASE_RATE` 424, `MODULE1_UNAVAILABLE` 424; con la HU4, `FORBIDDEN` 403 (`MODULE2_UNAVAILABLE` 424 ya lo registró la 007) | FR-006, FR-010 |
| [logged-create-lodging-quote.use-case.ts](../../../src/infrastructure/logging/pricing/logged-create-lodging-quote.use-case.ts) | Envuelve la cotización y deja un log estructurado de cada una (T046): `quoteId`, `roomId`, rango, total y duración; si se rechaza, lo pedido y el `errorCode`. Sin datos del huésped | — |
| [pricing.module.ts](../../../src/infrastructure/config/pricing.module.ts) | **Compartido con 004, 009 y 011.** Conecta la 005 con los puertos de 004, 009 y 011 por token, envuelve la cotización con su log, registra el cliente de Módulo 2 de la 007 (`RESERVATION_CLIENT`, HU4) y exporta `LODGING_QUOTE_QUERY` para la 007 | — |

### Base de datos

| Archivo | Qué hace | Requisito |
|---|---|---|
| [schema.prisma](../../../prisma/schema.prisma) | **Compartido.** Modelos `LodgingQuote` y `LodgingQuoteNight` | — |
| [migration.sql](../../../prisma/migrations/20261104000000_create_lodging_quote_tables/migration.sql) | Tablas `lodging_quote` y `lodging_quote_night` y sus restricciones. Generada con `prisma migrate diff` más SQL manual | FR-012, FR-013 |

La base de datos es la **última defensa** de las reglas, aunque alguien se salte la aplicación:

| Restricción | Garantiza |
|---|---|
| `lodging_quote_night_pkey` (`quote_id`, `night_date`) | Una sola fila por noche de cada cotización (el `UNIQUE` del plan) |
| `lodging_quote_valid_stay` (CHECK) | Entrada anterior a la salida: al menos una noche |
| `lodging_quote_currency_cop` (CHECK) | Moneda `COP` |
| `lodging_quote_amount_not_negative`, `lodging_quote_night_rate_not_negative` (CHECK) | Ningún importe negativo (puede ser cero con un ajuste de −100 %) |
| `lodging_quote_night_base_rate_positive` (CHECK) | Ninguna noche guardada con tarifa base en cero |
| `lodging_quote_night_adjustment_range` (CHECK) | Ajuste entre −100 y 100, igual que en la 009 |
| `lodging_quote_night_quote_id_fkey` (FK) | Ninguna noche sin su cotización |

---

## 4. Pruebas

El caso de prueba manual, con la plantilla del curso, está en [4-testing/TC-005-consultar-tarifa-dinamica.md](../4-testing/TC-005-consultar-tarifa-dinamica.md). Las pruebas automáticas son estas:

| Archivo | Qué comprueba | Pruebas |
|---|---|:-:|
| [calculate-dynamic-rate.spec.ts](../../../test/unit/domain/pricing/calculate-dynamic-rate.spec.ts) | La fórmula con ajustes positivos, negativos, cero, −100 y +100; half-up; el nombre de la temporada no cambia nada | 14 |
| [stay-range.spec.ts](../../../test/unit/domain/pricing/stay-range.spec.ts) | Noches de una estadía (cruce de mes, año y bisiesto), rangos inválidos, `date` = una noche | 7 |
| [lodging-quote.spec.ts](../../../test/unit/domain/pricing/lodging-quote.spec.ts) | Ejemplo del contrato, suma exacta, inmutable, noches que no cuadran, `restore` sin recalcular | 7 |
| [money.vo.spec.ts](../../../test/unit/domain/shared/money.vo.spec.ts) | Las funciones `add` y `multiply` que agrega la 005 (el archivo es de la 004) | 4 de 20 |
| [get-dynamic-rate.service.spec.ts](../../../test/unit/application/pricing/get-dynamic-rate.service.spec.ts) | Composición 004 + 009 + 011, default sin suponer cero, temporada fuera del catálogo, rango que cruza temporadas, un solo snapshot, límite de paralelismo, todo o nada, validación antes de llamar a nadie, determinismo, sin caché. HU4 (T032–T034): la OTA recibe lo mismo que Módulo 2; otra OTA, canal directo (también con el `otaId` de la OTA), reserva sin la habitación, sin cotizaciones o inexistente → el mismo `403` sin llamar a 004, 009 ni 011; Módulo 2 caído; `reservationRef` obligatorio; el rango se valida antes de consultar a Módulo 2; sin token no se consulta la reserva | 41 |
| [create-lodging-quote.service.spec.ts](../../../test/unit/application/pricing/create-lodging-quote.service.spec.ts) | Cotiza lo mismo que la consulta, guarda una vez, no es idempotente, rechazos sin guardar | 12 |
| [dynamic-rate.contract.spec.ts](../../../test/contract/pricing/dynamic-rate.contract.spec.ts) | Contrato del `GET` (T011): campos exactos de la respuesta, importes como texto con 2 decimales, ejemplos 1 y 2 del contrato, el de la OTA (igual que para Módulo 2) y la forma `ApiError` de cada error de la tabla, también los de la OTA (`400` sin `reservationRef`, `403` reserva ajena, `424 MODULE2_UNAVAILABLE`) | 17 |
| [lodging-quote.contract.spec.ts](../../../test/contract/pricing/lodging-quote.contract.spec.ts) | Contrato del `POST` (T026): campos exactos, `quoteId` UUID, ejemplo del contrato, cada error de la tabla con la forma `ApiError` y sin guardar nada | 12 |
| [lodging-quote-query.port.spec.ts](../../../test/contract/pricing/lodging-quote-query.port.spec.ts) | Contrato del puerto con 007 (T027), con el archivo de acceso a datos real: ejemplo del contrato, todo como texto, valores tal como se guardaron, ids inexistentes, lista vacía, el error de la base se propaga | 7 |
| [prisma-lodging-quote.repository.spec.ts](../../../test/integration/persistence/pricing/prisma-lodging-quote.repository.spec.ts) | PostgreSQL real: guardar y leer igual (contrato con 007), columnas, ids inexistentes, atomicidad, restricciones `CHECK` | 5 |
| [logged-create-lodging-quote.use-case.spec.ts](../../../test/unit/infrastructure/pricing/logged-create-lodging-quote.use-case.spec.ts) | El log de cada cotización (T046): campos exactos, sin el detalle por noche, rechazo con su `errorCode` y el mismo error relanzado, error sin código como `UNEXPECTED_ERROR` | 4 |
| [dynamic-rate.e2e-spec.ts](../../../test/e2e/pricing/dynamic-rate.e2e-spec.ts) | Los 2 endpoints de punta a punta con el cliente HTTP real de 004 contra un Módulo 1 simulado: 200, 400, 401, 403, 404, 422, 424, nada guardado tras cada rechazo, la cotización no cambia al cambiar la regla. HU4 (T035), con el cliente HTTP real de 007 contra un Módulo 2 simulado: la OTA con una reserva propia recibe lo mismo que Módulo 2; otra OTA, canal directo, reserva sin la habitación o inexistente → el mismo `403` sin llamar a Módulo 1; `400` sin `reservationRef`; `424 MODULE2_UNAVAILABLE` | 41 |

Resultado actual: **las 171 pruebas de la 005 pasan**, incluidas las de integración contra PostgreSQL real. El proyecto completo (ya con la 007) suma 703 pruebas unitarias, de contrato, de integración y de arquitectura, y 129 de punta a punta.

```powershell
$env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"
npm test             # unitarias, de contrato y de integración
npm run test:e2e     # endpoints de punta a punta
```

Dobles de prueba propios: [fake-dynamic-rate-ports.ts](../../../test/support/pricing/fake-dynamic-rate-ports.ts) (004, 009, 011, cotizaciones y reservas de Módulo 2 en memoria) y [module1-rates-server.ts](../../../test/support/pricing/module1-rates-server.ts) (Módulo 1 simulado que responde según la fecha). Las e2e de la HU4 simulan Módulo 2 con el servidor genérico [module1-http-fixture.ts](../../../test/support/pricing/module1-http-fixture.ts) de la 004, como la 007.

---

## 5. Trazabilidad: requisito → código → prueba

| Requisito de la spec | Dónde se cumple | Dónde se prueba |
|---|---|---|
| FR-001 / FR-010 / BR-002 / SC-005 Solo Módulo 2 y la OTA, y la OTA solo con sus reservas | `OptionalJwtAuthGuard` + `InternalOrOtaGuard`; acceso de la OTA en `GetDynamicRateService` | unitarias T032–T034; contrato; e2e 401, 403 de Administrador y los 4 `403` de la OTA con el mismo mensaje |
| FR-002 / BR-007 / SC-001 Ajuste por el número, no por el nombre | `calculateDynamicRate` | unitarias de la fórmula y de `DynamicRate` |
| FR-003 / BR-003 / SC-002 Cada noche con su temporada | `DynamicRateCalculator` resuelve cada noche por separado | unitaria "cruza temporadas"; e2e ejemplo 2 del contrato |
| FR-004 Default con su porcentaje vigente | 011 devuelve el default y se busca su ajuste en 009 | unitaria con `0.00` y `10.00` |
| FR-005 / BR-001 Tarifa base siempre de Módulo 1 | `GetBaseRateUseCase` de 004 en cada noche | e2e (peticiones al Módulo 1 simulado) |
| FR-006 / NFR-003 / SC-003 Sin tarifa base válida, falla todo | Todo o nada en `mapWithLimit` | unitarias T017; e2e 404 y 424 sin `nights` |
| FR-007 / BR-004 La consulta no guarda nada | `GetDynamicRateService` no tiene puerto de escritura | e2e "no guarda nada"; unitaria "sin caché" |
| FR-008 / SC-004 Rango inválido | `StayRange.of`, antes de llamar a nadie | unitarias; e2e 400 |
| FR-009 / NFR-004 Trazabilidad por noche | `DynamicRate` y las columnas de `lodging_quote_night` | e2e; integración "columnas del plan" |
| FR-011 / BR-005 Mismo resultado para cualquier actor | El acceso de la OTA solo decide si se calcula; el cálculo no tiene ninguna rama por actor | unitaria T032, contrato y e2e: la OTA recibe exactamente lo mismo que Módulo 2 |
| FR-012 Cotizar y guardar con la tarifa base por noche | `CreateLodgingQuoteService` + `insert` | unitarias; e2e 200; integración |
| FR-013 / BR-006 / SC-007 La cotización no cambia | Solo `INSERT`; `restore` sin recalcular | e2e "no cambia si cambia la regla"; integración |
| FR-014 Salida anticipada no cotiza | Nada en la 005 llama a la cotización desde un check-out | prueba de arquitectura de la 007 (T031) |
| FR-015 / SC-008 Rechazo sin guardar nada | Validación antes de calcular; transacción única | unitarias T024; e2e; integración "atomicidad" |
| FR-016 / BR-008 Solo Módulo 2 cotiza | `InternalCallOnlyGuard` en el POST | e2e 403 con OTA, Administrador y token inválido |
| NFR-001 / SC-006 Determinismo | Un `asOf` y un snapshot por consulta | unitaria de determinismo |

---

## 6. Estado de las tareas del plan

| Tarea | Estado |
|---|---|
| T001 (tablas y migración) | Hecho |
| T002 (registro en `pricing.module.ts`) | Hecho |
| T003 (firma de `findByIds` con 007) | Hecho: la 007 ya la usa, con `roomId` y `baseRate` por noche |
| T004–T007 (cálculo, modelos, errores, rango) | Hecho |
| T008–T014 (Historia 1) | Hecho. La prueba de contrato T011 está en `test/contract/pricing/dynamic-rate.contract.spec.ts` |
| T015–T022 (Historia 2) | Hecho. T018 se cubre con la unitaria de 6 noches y el e2e, no con una prueba de integración |
| T023–T030 (Historia 3) | Hecho. Las pruebas de contrato T026 y T027 están en `test/contract/pricing/lodging-quote.contract.spec.ts` y `lodging-quote-query.port.spec.ts` |
| T031 (regla de `dependency-cruiser`) | Hecho con la prueba de arquitectura de la 007 ([settlement-dependencies.spec.ts](../../../test/architecture/settlement-dependencies.spec.ts)): falla si un archivo de `settlement` importa los servicios de cálculo de `pricing` o sus puertos de entrada. `dependency-cruiser` sigue sin estar instalado |
| T032–T038 (Historia 4, OTA) | Hecho. T036 con `InternalOrOtaGuard` en lugar de `RolesGuard`, y `reservationRef` se exige en el caso de uso (ver sección 7) |
| T039–T042 (casos límite) | Hecho |
| T043 (OpenAPI) | Hecho: Swagger en `/docs` |
| T044 (contrato con Módulo 1) | Hecho: lo cubre la 004 con su prueba de contrato (`test/contract/pricing/module1-base-rate.contract.spec.ts`) |
| T045 (ajustar timeout y paralelismo con datos reales) | Pendiente: no hay un Módulo 1 real todavía |
| T046 (logs estructurados) | Hecho: `LoggedCreateLodgingQuoteUseCase`, con el mismo patrón que la 007 |

Con la 005 también quedan cubiertas tareas de otras features que esperaban un consumidor real: 011 T022/T026 (la 005 usa la clasificación del calendario) y 009 T022/T027 (la 005 usa el ajuste de las reglas).

---

## 7. Decisiones de implementación

Están en las Notes del [plan](../2-technical/plan.md#decisiones-de-implementación). Las de la HU4, para explicarlas:

- **Guard propio en el `GET` (`InternalOrOtaGuard`)**: el plan decía `RolesGuard`, pero ese guard responde `401` cuando no llega token, y sin token llama Módulo 2. El nuevo deja pasar sin token y, con token, solo a la OTA. `RolesGuard` es compartido y no se tocó.
- **`reservationRef` se exige en el caso de uso**, no en el controller: el controller queda sin lógica y la regla se prueba con unitarias.
- **El cliente de Módulo 2 de la 007 se registra también en `PricingModule`**: importar `SettlementModule` crearía una dependencia circular, porque `SettlementModule` ya importa `PricingModule`. Así no se tocó ningún archivo de la 007, y las consultas de las OTA tienen su propio circuit breaker: no pueden abrir el que usa la liquidación.
- **Mismo `403` y mismo mensaje en los 4 rechazos de la OTA** (otra OTA, canal directo, reserva sin la habitación, reserva inexistente): la OTA nunca sabe si una reserva ajena existe. El `404` de Módulo 2 nunca le llega como `RESERVATION_NOT_FOUND`.

**Riesgo conocido: dos relojes.** El `asOf` de cada consulta sale del reloj del servidor de la app (`DynamicRateCalculator`), mientras que la 009 y la 011 marcan desde cuándo rige cada regla o revisión del calendario con la hora de la base de datos. Si los dos relojes están desfasados, una regla recién cambiada puede tardar en verse lo que dure ese desfase; en la práctica, milisegundos. Corregirlo del todo exigiría cambiar los puertos de la 009 y la 011, así que solo se documenta.

**Riesgo aceptado: sin tope de noches.** La spec no fija un máximo y Módulo 2, dueño de las reservas, confirmó que no limita la duración de una estancia (2026-11-06). Si llega un rango muy largo, por ejemplo por una fecha mal escrita, la 005 hace una llamada a Módulo 1 y una al calendario por cada noche (hasta 4 noches a la vez).

---

## 8. Dependencias con otras features

- **004 Consultar tarifa base**: la 005 usa `GET_BASE_RATE_USE_CASE` (una noche por llamada). Su cliente HTTP ya tiene timeout y circuit breaker, así que la 005 no agrega otro.
- **009 Modificar precio tarifa según temporada**: un solo `getAll(asOf)` por consulta; el porcentaje sale de ahí.
- **011 Revisar temporada del año**: `resolve({ date, asOf })` por noche, con el mismo `asOf`. Si el calendario apunta a una temporada que no está en el snapshot, la 005 falla con `422` en vez de elegir otra.
- **007 Generar liquidación**: lee las cotizaciones con `LODGING_QUOTE_QUERY` (`findByIds`), y su prueba de arquitectura cubre la T031. La HU4 usa su `ReservationClientPort` (`getReservation`), su adaptador `Module2ReservationClient` y sus errores `ReservationNotFoundError` y `Module2UnavailableError`, sin modificarlos. `PricingModule` registra su propia instancia del adaptador para no importar `SettlementModule` (sección 7).
- **Archivos compartidos que tocó la 005**: `money.vo.ts` (+ su prueba), `domain-exception.filter.ts`, `pricing.module.ts`, `schema.prisma`, y el archivo nuevo `auth/optional-jwt-auth.guard.ts`. Ninguno de la 007.
- **Migraciones**: igual que en 009 y 011, la próxima se debe generar con `prisma migrate diff` desde el esquema anterior.

---

## 9. Cómo mostrarlo funcionando

Pasos completos en el [TC-005](../4-testing/TC-005-consultar-tarifa-dinamica.md). Resumen, con el servidor corriendo, el Módulo 1 simulado ([modulo1-simulado.js](../4-testing/modulo1-simulado.js)) y Swagger en <http://localhost:3000/docs>:

1. Como Administrador: crear la temporada Alta +20 % (`POST /admin/season-rules`) y ponerla en el calendario del 24 y 25 de diciembre (`PUT /admin/season-calendar/2026`).
2. **Logout** en Swagger (Módulo 2 llama sin token).
3. `GET /pricing/dynamic-rate` con `date=2026-12-24` → **360 000**.
4. `GET /pricing/dynamic-rate` con `checkInDate=2026-12-23` y `checkOutDate=2026-12-26` → 300 000 + 360 000 + 360 000 = **1 020 000**.
5. `POST /pricing/quotes` con la misma estadía → **200** con `quoteId` y `lodgingAmount: "1020000.00"`.
6. Como Administrador, subir Alta a +50 % → la consulta da 1 200 000, pero la cotización guardada sigue en 1 020 000.
7. La OTA (HU4): iniciar el Módulo 2 simulado ([modulo2-simulado.js](../4-testing/modulo2-simulado.js)) con el `quoteId` del paso 5, entrar como `ota-demo` y consultar con `reservationRef=RES-OTA-PROPIA` → **200**, igual que Módulo 2. Con `RES-OTRA-OTA` o `RES-NO-EXISTE` → **403** con el mismo mensaje.
