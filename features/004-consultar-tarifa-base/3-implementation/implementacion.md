# Implementación: Consultar tarifa base (004)

**Spec**: [consultar_tarifa_base.md](../1-functional/consultar_tarifa_base.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contrato**: [CLIENT-get-base-rate.md](../2-technical/contracts/CLIENT-get-base-rate.md) (cliente de `GET /api/rooms/{roomId}/base-rate` de Módulo 1)
**Rama**: `feature/004-consultar-tarifa-base`

Este documento es el mapa de dónde está el código de la 004. El código no vive en esta carpeta: sigue la arquitectura hexagonal del plan base, así que está repartido por capas en `src/` y `test/`, siempre dentro de una subcarpeta `pricing/` (salvo `Money`, que es compartido, y el cliente HTTP, que está en `adapters/out/http/`).

> Para encontrar todos los archivos de la 004 en VS Code: `Ctrl+Shift+F` y buscar `Feature 004`.

**Alcance de esta entrega**: Historias de usuario 1 y 2 completas. La 004 **no tiene endpoint**: es un puerto interno (`GetBaseRateUseCase`) que usa la 005 para calcular la tarifa dinámica y las cotizaciones. Se verifica con pruebas automáticas (sección 4), organizadas por escenario en el caso de prueba [TC-004](../4-testing/TC-004-consultar-tarifa-base.md), y a mano a través de los endpoints de la 005 (sección 9).

---

## 1. Qué hace

Le pregunta a Módulo 1 la **tarifa base** de una habitación para **una fecha** y la devuelve como `BaseRate` (importe `Money` en COP):

```text
GetBaseRateUseCase.execute(roomId, date)  →  GET {MODULE1_BASE_URL}/api/rooms/{roomId}/base-rate?date=YYYY-MM-DD
                                          ←  { roomId, date, baseRate: "300000.00", currency: "COP" }
```

| Dato | De dónde sale |
|---|---|
| `roomId` y fecha | Quien llama (la 005, una noche por llamada) |
| Importe y moneda | Módulo 1, en cada consulta: no se guarda ni se cachea |

Si no hay una tarifa utilizable, **detiene el cálculo** con un error tipado; nunca devuelve cero ni un valor por defecto:

| Situación | Error | Código |
|---|---|---|
| `roomId` sin formato UUID o fecha inválida (no llama a Módulo 1) | `InvalidBaseRateQueryError` | `INVALID_QUERY_PARAMS` |
| Módulo 1 responde 404 con `errorCode: ROOM_NOT_FOUND` | `RoomNotFoundError` | `ROOM_NOT_FOUND` |
| Importe decimal no positivo (`"0.00"`, `"-10.00"`) | `InvalidBaseRateError` | `INVALID_BASE_RATE` |
| Respuesta malformada: no JSON, campos ausentes o de otro tipo, número en vez de texto, más de 2 decimales, moneda distinta de COP, `roomId` o fecha distintos | `MalformedBaseRateResponseError` | `MODULE1_UNAVAILABLE` |
| Timeout de 500 ms, 5xx, otro 4xx, 404 sin ese cuerpo, error de red o circuito abierto | `Module1UnavailableError` | `MODULE1_UNAVAILABLE` |

---

## 2. Recorrido de una consulta

```text
005 ─► GetBaseRateService.execute(roomId, date)
         1. UUID 8-4-4-4-12 y fecha YYYY-MM-DD real                        → INVALID_QUERY_PARAMS (sin llamar a Módulo 1)
       ─► Module1BaseRateClient.getBaseRate
         2. circuit breaker (opossum)  ¿abierto?                            → MODULE1_UNAVAILABLE (sin llamar)
         3. GET /api/rooms/{roomId}/base-rate?date=…   timeout 500 ms
              404 + ROOM_NOT_FOUND                                          → ROOM_NOT_FOUND     (no cuenta como fallo)
              otro 4xx, 5xx, timeout, red                                   → MODULE1_UNAVAILABLE (cuenta como fallo)
         4. valida el cuerpo: tipos, eco de roomId (sin mayúsculas) y fecha, COP, texto decimal ≤ 2 decimales
                                                                            → MODULE1_UNAVAILABLE (cuenta como fallo)
         5. BaseRate.create(baseRate)   importe > 0                         → INVALID_BASE_RATE  (no cuenta como fallo)
◄─── BaseRate { amount: Money, currency: 'COP' }
```

**Idea clave para explicar:** solo cuentan como fallo del circuito los problemas **de la dependencia** (Módulo 1 caído, lento o respondiendo basura). Una habitación inexistente o una tarifa no positiva son respuestas **correctas** de Módulo 1 sobre un dato malo: no abren el circuito, y en semiabierto lo cierran. Al quinto fallo seguido el circuito se abre y, a los 30 s, deja pasar una petición de prueba.

---

## 3. Archivos por capa

### Dominio — reglas de negocio puras (sin NestJS ni HTTP)

| Archivo | Qué hace | Requisito |
|---|---|---|
| [base-rate.ts](../../../src/domain/model/pricing/base-rate.ts) | Tarifa base en COP. `create` exige texto decimal con máximo 2 decimales significativos y un importe estrictamente positivo. Exporta el formato decimal y la función de precisión que reutiliza el cliente HTTP | FR-001, FR-006, BR-002 |
| [money.vo.ts](../../../src/domain/model/shared/money.vo.ts) | **Compartido, creado por la 004.** Importe decimal con `decimal.js` a escala 2, recibido como texto. Las features siguientes le agregaron operaciones | FR-001 |
| [invalid-base-rate-query.error.ts](../../../src/domain/errors/pricing/invalid-base-rate-query.error.ts) | `INVALID_QUERY_PARAMS`: `roomId` o fecha inválidos | FR-007 |
| [room-not-found.error.ts](../../../src/domain/errors/pricing/room-not-found.error.ts) | `ROOM_NOT_FOUND`: la habitación no existe en Módulo 1 | FR-004 |
| [invalid-base-rate.error.ts](../../../src/domain/errors/pricing/invalid-base-rate.error.ts) | `INVALID_BASE_RATE`: importe decimal no positivo | FR-006, BR-002 |
| [malformed-base-rate-response.error.ts](../../../src/domain/errors/pricing/malformed-base-rate-response.error.ts) | `MODULE1_UNAVAILABLE`: respuesta exitosa de Módulo 1 inutilizable | FR-006 |
| [module1-unavailable.error.ts](../../../src/domain/errors/pricing/module1-unavailable.error.ts) | `MODULE1_UNAVAILABLE`: timeout, error HTTP o de red, circuito abierto | FR-006, NFR-002 |
| [get-base-rate.use-case.ts](../../../src/domain/ports/in/pricing/get-base-rate.use-case.ts) | Puerto de entrada `GetBaseRateUseCase` (token `GET_BASE_RATE_USE_CASE`), exportado para la 005 | FR-001 |
| [base-rate.client.port.ts](../../../src/domain/ports/out/pricing/base-rate.client.port.ts) | Puerto de salida `BaseRateClientPort` hacia Módulo 1 | FR-001, FR-005 |

### Aplicación — caso de uso

| Archivo | Qué hace |
|---|---|
| [get-base-rate.service.ts](../../../src/application/services/pricing/get-base-rate.service.ts) | Valida `roomId` y fecha y delega una consulta por llamada, sin estado ni caché. Sin decoradores de NestJS |

### Infraestructura — adaptadores

| Archivo | Qué hace |
|---|---|
| [module1-base-rate.client.ts](../../../src/infrastructure/adapters/out/http/module1-base-rate.client.ts) | Axios + circuit breaker `opossum`: timeout de 500 ms, se abre con 5 fallos seguidos y prueba de nuevo a los 30 s. Valida la respuesta y traduce cada caso a su error. Exige `MODULE1_BASE_URL` y `MODULE1_TIMEOUT_MS` al arrancar. Es el único archivo con dependencias HTTP |
| [pricing.module.ts](../../../src/infrastructure/config/pricing.module.ts) | Registra el adaptador con el token `BASE_RATE_CLIENT`, construye el servicio con `useFactory` y exporta `GET_BASE_RATE_USE_CASE` |
| `.env.example` | `MODULE1_BASE_URL` y `MODULE1_TIMEOUT_MS=500` |
| `package.json`, `package-lock.json` | Versiones fijadas de `@nestjs/axios`, `axios`, `opossum` y `@types/opossum` |

### Base de datos

Ninguna tabla ni migración: la 004 no guarda la tarifa base (FR-002, SC-004).

---

## 4. Pruebas

| Archivo | Qué comprueba |
|---|---|
| [base-rate.spec.ts](../../../test/unit/domain/pricing/base-rate.spec.ts) | Importe positivo, escala 2, ceros finales; rechazo de tarifa no positiva, mal formada, con más de 2 decimales o que no sea texto (T004) |
| [money.vo.spec.ts](../../../test/unit/domain/shared/money.vo.spec.ts) | Redondeo a escala 2 y rechazo de entrada inválida. El archivo incluye también las operaciones que agregaron las features siguientes |
| [get-base-rate.service.spec.ts](../../../test/unit/application/pricing/get-base-rate.service.spec.ts) | Resultado, consultas independientes por fecha, determinismo, dato vigente en llamadas sucesivas, validación previa al puerto con `errorCode`, UUID en mayúsculas o fuera del RFC (`a0000000-0000-0000-0000-000000000101`) y 29 de febrero (T005, T012) |
| [module1-base-rate.client.spec.ts](../../../test/integration/http/module1-base-rate.client.spec.ts) | Servidor HTTP simulado: éxito y campos extra, sin caché, 404 estructurado y sin cuerpo, 403, 5xx, timeout de 500 ms, corte de conexión, cada respuesta malformada, eco de `roomId` sin distinguir mayúsculas, apertura del circuito en el quinto fallo, semiabierto (con timers falsos) y validación de la configuración (T006, T013) |
| [module1-base-rate.contract.spec.ts](../../../test/contract/pricing/module1-base-rate.contract.spec.ts) | Clasificación del cuerpo de éxito y de `ROOM_NOT_FOUND`, `INVALID_BASE_RATE` y `MODULE1_UNAVAILABLE` según el contrato (T007) |
| [base-rate.e2e-spec.ts](../../../test/e2e/pricing/base-rate.e2e-spec.ts) | `GetBaseRateUseCase` resuelto desde `AppModule` hasta el cliente HTTP real, con un servidor local en lugar de Módulo 1: éxito, entrada inválida sin llamar a Módulo 1, sin reutilizar la tarifa, `ROOM_NOT_FOUND` y `MODULE1_UNAVAILABLE` |

Dobles de prueba: [module1-http-fixture.ts](../../../test/support/pricing/module1-http-fixture.ts) (servidor HTTP local configurable que guarda las peticiones en `requestLog`) y [e2e-env.ts](../../../test/support/e2e-env.ts) (valores por defecto de `MODULE1_*` para que las E2E no dependan del `.env`; después 007 agregó lo mismo para `MODULE2_*`).

Las pruebas de la 004 se ejecutan con los comandos siguientes. Ninguna necesita PostgreSQL ni RabbitMQ.

```bash
npm test -- --runTestsByPath test/unit/domain/pricing/base-rate.spec.ts test/unit/application/pricing/get-base-rate.service.spec.ts test/integration/http/module1-base-rate.client.spec.ts test/contract/pricing/module1-base-rate.contract.spec.ts
npm run test:e2e -- --runTestsByPath test/e2e/pricing/base-rate.e2e-spec.ts
```

---

## 5. Trazabilidad: requisito → código → prueba

| Requisito de la spec | Dónde se cumple | Dónde se prueba |
|---|---|---|
| FR-001 Consultar a Módulo 1 por `roomId` y fecha, en COP | `GetBaseRateService` → `Module1BaseRateClient` → `BaseRate` | servicio; cliente HTTP; contrato; e2e |
| FR-002 / NFR-003 / SC-004 Sin copia propia; dato vigente | Sin tabla ni caché; una petición por llamada | servicio ("observes successive values"); cliente ("two upstream requests… without caching"); e2e |
| FR-003 / SC-005 Cada fecha por separado | Una fecha por llamada; la 005 recorre las noches | servicio ("queries each date independently") |
| FR-004 / SC-002 Habitación inexistente detiene el cálculo | 404 + `ROOM_NOT_FOUND` → `RoomNotFoundError` | cliente; contrato; e2e |
| FR-005 / BR-001 Solo lectura | El puerto solo tiene `getBaseRate` (GET) | contrato |
| FR-006 / SC-003 Distinguir no encontrada, tarifa inválida y falla de dependencia | Tres errores con códigos distintos; solo la falla de dependencia cuenta para el circuito | cliente; contrato |
| FR-007 / SC-006 Entrada inválida sin llamar a Módulo 1 | Validación en `GetBaseRateService` antes del puerto | servicio; e2e |
| BR-002 Sin valor sustituto | `BaseRate.create` exige importe > 0; ningún camino devuelve 0 | base-rate; cliente |
| BR-003 / BR-004 Cambios no retroactivos; la liquidación no consulta la tarifa base | La 004 no guarda nada; 007 usa la cotización guardada de 005 | (lo cubren 005 y la prueba de arquitectura de 007) |
| NFR-001 Determinismo | Sin estado: mismo dato de Módulo 1 → mismo resultado | servicio ("same amount for identical queries") |
| NFR-002 500 ms | Timeout de Axios y del circuit breaker | cliente ("beyond 500 ms") |
| SC-001 Devuelve el importe de Módulo 1 | `BaseRate.create(baseRate)` sin transformarlo | cliente; contrato |

---

## 6. Estado de las tareas del plan

| Tarea | Estado |
|---|---|
| T001–T003 (estructura `pricing`, puertos, modelo, errores, configuración) | Hecho |
| T004–T007 (pruebas de la Historia 1) | Hecho |
| T008–T011 (implementación de la Historia 1 y exportación del puerto) | Hecho |
| T012–T013 (pruebas de la Historia 2) | Hecho |
| T014 (validación de entrada y traducción de errores) | Hecho |
| T015 (suites completas, sin caché, timeout y circuito) | Hecho |

---

## 7. Decisiones de implementación

Lo que no fijaban la spec, el plan ni el contrato:

1. **UUID sin exigir el RFC 4122**: se acepta cualquier hexadecimal 8-4-4-4-12, sin distinguir mayúsculas, porque Módulo 1 siembra ids como `a0000000-0000-0000-0000-000000000101`.
2. **El eco de `roomId` se compara sin distinguir mayúsculas**: Módulo 1 lo devuelve en minúsculas aunque se consulte en mayúsculas.
3. **Contador propio de fallos consecutivos** para abrir el circuito exactamente en el quinto fallo. La apertura por porcentaje de `opossum` está desactivada, porque cuenta por ventana de tiempo y no por fallos seguidos.
4. **Los errores funcionales no cuentan para el circuito** (`errorFilter`): `ROOM_NOT_FOUND` e `INVALID_BASE_RATE` reinician el contador y, en semiabierto, cierran el circuito.
5. **Más de 2 decimales es respuesta malformada** (`MODULE1_UNAVAILABLE`), no tarifa inválida: el contrato pide un decimal en texto con 2 decimales; un importe así indica que Módulo 1 respondió mal, no que el dato sea negativo o cero.
6. **Timeout en dos lugares**: en Axios (cancela la petición) y en el circuit breaker (acota la acción), los dos con `MODULE1_TIMEOUT_MS`.
7. **La configuración se valida al arrancar**: sin `MODULE1_BASE_URL` o con un `MODULE1_TIMEOUT_MS` que no sea entero positivo, la aplicación no inicia.
8. **El mapeo a HTTP lo hace la 005**: la 004 no tiene controller; `INVALID_QUERY_PARAMS` (400), `ROOM_NOT_FOUND` (404), `INVALID_BASE_RATE` (424) y `MODULE1_UNAVAILABLE` (424) están en `domain-exception.filter.ts` (T014 y T022 de la 005).

---

## 8. Dependencias con otras features

- **005 Consultar tarifa dinámica**: único consumidor. `DynamicRateCalculator` recibe `GET_BASE_RATE_USE_CASE` y consulta una noche por llamada, tanto en `GET /pricing/dynamic-rate` como en `POST /pricing/quotes`. El timeout y el circuit breaker ya vienen en el cliente, así que la 005 no agrega otros.
- **007 Generar liquidación**: no usa la 004 (BR-004). El hospedaje sale de la cotización guardada por la 005; la prueba de arquitectura de 007 impide que `settlement` importe los servicios de cálculo de `pricing`.
- **Archivos compartidos que creó la 004**: `money.vo.ts` (y su prueba), que después ampliaron las features siguientes, y `test/support/e2e-env.ts`.

---

## 9. Cómo mostrarlo funcionando

La 004 no tiene endpoint propio: se ve a través de la 005. Con el servidor corriendo (`npm run start:dev`), el Módulo 1 simulado ([modulo1-simulado.js](../../005-consultar-tarifa-dinamica/4-testing/modulo1-simulado.js), puerto 8080, con `MODULE1_BASE_URL=http://localhost:8080` en el `.env`) y Swagger en <http://localhost:3000/docs>:

1. `GET /pricing/dynamic-rate` con un `roomId` cualquiera y `date=2026-12-24` → **200**: la tarifa base 300 000 de Módulo 1 más el ajuste de la temporada.
2. Con `roomId=abc` → **400** `INVALID_QUERY_PARAMS`, y el Módulo 1 simulado no registra ninguna petición.
3. Detener el Módulo 1 simulado y repetir el paso 1 cinco veces → **424** `MODULE1_UNAVAILABLE` cada vez. Con el quinto fallo el circuito se abre.
4. Volver a levantar el Módulo 1 simulado y repetir el paso 1 enseguida → sigue respondiendo **424**, y la consola del simulador no muestra ninguna petición nueva: con el circuito abierto, Módulo 3 ni siquiera intenta conectar.
5. Repetir el paso 1 hasta que pasen 30 s desde el quinto fallo → **200** otra vez: el circuito deja pasar una petición de prueba, Módulo 1 responde y se cierra.
