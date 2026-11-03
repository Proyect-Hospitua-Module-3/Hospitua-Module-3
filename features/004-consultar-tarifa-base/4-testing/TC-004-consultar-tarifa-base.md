### Test Case Specification: Consultar tarifa base
**Created** : 2026-11-01  **Spec/Plan Link** : [consultar_tarifa_base.md](../1-functional/consultar_tarifa_base.md) · [plan.md](../2-technical/plan.md)  **Status** : Draft

#### Test Overview *(mandatory)*

**Test Case ID** : TC-004-ConsultarTarifaBase  
**Product Name & Version** : HOSPITUA Módulo 3 (Facturación, Consumos y Liquidación) v0.1.0  
**Author** : Juan Andrade
**Current Owner** : Equipo Módulo 3  
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context *(mandatory)*

##### Test Objectives

Verificar los siete escenarios de aceptación de la spec: consulta correcta, resolución independiente por noche, detención ante error de Módulo 1, rechazo de respuesta inutilizable, rechazo de importe no positivo, validación de entrada y habitación inexistente. Adicionalmente, comprobar la validación de configuración al iniciar el cliente HTTP, la clasificación de errores según el estado HTTP y la recuperación del circuit breaker ante errores funcionales. La feature es un puerto interno sin endpoint propio; las verificaciones se realizan con pruebas automatizadas del servicio y del adaptador HTTP.

##### Document References

| Reference Name | Type of Reference | Document Location / Link |
| --- | --- | --- |
| Consultar tarifa base | Specification Document | [1-functional/consultar_tarifa_base.md](../1-functional/consultar_tarifa_base.md) |
| Plan técnico 004 | Plan Document | [2-technical/plan.md](../2-technical/plan.md) |
| Contrato cliente HTTP | API Contract | [2-technical/contracts/CLIENT-get-base-rate.md](../2-technical/contracts/CLIENT-get-base-rate.md) |
| Mapa de implementación | Implementation Map | [3-implementation/implementacion.md](../3-implementation/implementacion.md) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* Solo se ejecutan pruebas automatizadas. La feature es un puerto interno sin endpoint ni interfaz.
* La ventana de 30 s se verifica con temporizadores simulados.

##### Dependencies & Assumptions
* Ningún caso de prueba previo es requisito.
* Módulo 1 no participa; se simula con un servidor HTTP local.

##### Preconditions & Default Setup

- **Initial State** : rama `feature/004-consultar-tarifa-base`.
- **Environment** : Dependencias instaladas con `npm ci`. Los pasos de la Sección 4 que ejecutan `npm test` completo requieren Docker/PostgreSQL con `TEST_DATABASE_URL`, como en TC-001 y TC-009.
- **Test Accounts** : No aplica.

--------------------------------------------------------------------------------

#### Test Execution Flow *(mandatory)*

##### Section 1: Tarifa disponible, determinismo y consultas independientes (HU1, escenarios 1 y 2; NFR-001)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | HU1, escenario 1: Consulta exitosa: Consultar una habitación y fecha con respuesta válida COP. Prueba: `gets a current rate on every request and ignores extra success fields` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "gets a current rate on every request and ignores extra success fields"` | Habitación y fecha; respuesta válida COP. | Devuelve el importe decimal comunicado por Módulo 1; ignora campos adicionales. | [✔] | — |
| 2 | NFR-001: Determinismo para la misma habitación, fecha y dato de Módulo 1: Consultar dos veces la misma habitación y fecha con la misma respuesta de Módulo 1. Prueba: `returns the same amount for identical queries when Module 1 returns the same rate` | `npm test -- --runInBand --runTestsByPath test/unit/application/pricing/get-base-rate.service.spec.ts -t "returns the same amount for identical queries when Module 1 returns the same rate"` | Misma habitación y fecha; misma respuesta de Módulo 1. | Las dos consultas idénticas producen el mismo importe. Esta prueba unitaria es distinta de la prueba HTTP de no caché, que devuelve tarifas diferentes. | [✔] | — |
| 3 | HU1, escenario 1: Consulta exitosa: Enviar cuatro formatos decimales permitidos para `baseRate`. Prueba: `accepts baseRate 250000 at scale 2`; `accepts baseRate 250000.5 at scale 2`; `accepts baseRate 250000.50 at scale 2`; `accepts baseRate 250000.500 at scale 2` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "accepts baseRate"` | `baseRate`: 250000, 250000.5, 250000.50, 250000.500. | Los cuatro formatos se aceptan y se representan a escala 2. | [✔] | — |
| 4 | HU1, escenario 1: Consulta exitosa sin reutilizar una respuesta anterior: Hacer dos consultas HTTP idénticas cuando Módulo 1 devuelve importes distintos. Prueba: `makes two upstream requests for identical queries without caching or persistence` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "makes two upstream requests for identical queries without caching or persistence"` | Consultas HTTP idénticas; importes upstream distintos. | Se hacen dos peticiones a Módulo 1 y se devuelven los dos importes distintos; no hay caché. | [✔] | — |
| 5 | HU1, escenario 2: Estancia que cruza un cambio de tarifa: Consultar fechas de noches consecutivas y verificar que cada consulta obtiene su valor independientemente. Prueba: `queries each date independently and observes successive values` | `npm test -- --runInBand --runTestsByPath test/unit/application/pricing/get-base-rate.service.spec.ts -t "queries each date independently and observes successive values"` | Fechas de noches consecutivas; fecha repetida. | Cada llamada lleva su propia fecha; no se reutiliza ni conserva el valor anterior. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 2: Errores, respuesta inválida y entrada (HU2, escenarios 1–5)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | HU2, escenario 1: Módulo 1 no responde o responde con un error: Simular demora superior a 500 ms y error 5xx. Prueba: `treats a response beyond 500 ms as a dependency failure`; `maps 5xx response to a dependency failure` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "treats a response beyond 500 ms as a dependency failure"` y `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "maps 5xx response to a dependency failure"` | Demora superior a 500 ms; error 5xx. | Lanza `MODULE1_UNAVAILABLE`; el cálculo que invoca el puerto no recibe una tarifa parcial. | [✔] | — |
| 2 | HU2, escenario 1: Módulo 1 responde con otro 4xx: Responder con 403, además del 400 cubierto por el contrato. Prueba: `maps 403 response to a dependency failure`; `maps other 4xx to MODULE1_UNAVAILABLE` (contrato, HTTP 400) | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "maps 403 response to a dependency failure"` y `npm test -- --runInBand --runTestsByPath test/contract/pricing/module1-base-rate.contract.spec.ts -t "maps other 4xx to MODULE1_UNAVAILABLE"` | 403; 400 cubierto por el contrato. | Ambos estados 4xx se clasifican como `MODULE1_UNAVAILABLE`. | [✔] | — |
| 3 | HU2, escenario 2: La respuesta de Módulo 1 es inutilizable: Simular cuerpo malformado, `baseRate: "250000.505"` con más de dos decimales significativos, `baseRate: "+250000.00"` y campos/tipos requeridos incorrectos. Prueba: `maps non-JSON body to a dependency failure`; `maps missing fields to a dependency failure`; `maps wrong field type to a dependency failure`; `maps plus-signed amount to a dependency failure`; `maps baseRate with more than two significant decimal places to MODULE1_UNAVAILABLE` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "maps (non-JSON body\|missing fields\|wrong field type\|plus-signed amount) to a dependency failure"` y `npm test -- --runInBand --runTestsByPath test/contract/pricing/module1-base-rate.contract.spec.ts -t "maps baseRate with more than two significant decimal places to MODULE1_UNAVAILABLE"` | Cuerpo malformado; `baseRate: "250000.505"`; `baseRate: "+250000.00"`; campos/tipos requeridos incorrectos. | Cada respuesta se traduce a `MODULE1_UNAVAILABLE`; no hay importe sustituto. | [✔] | — |
| 4 | HU2, escenario 3: El importe numérico no es positivo: Responder `baseRate: "-0.01"`. Prueba: `maps non-positive decimal text to INVALID_BASE_RATE` | `npm test -- --runInBand --runTestsByPath test/contract/pricing/module1-base-rate.contract.spec.ts -t "maps non-positive decimal text to INVALID_BASE_RATE"` | `baseRate: "-0.01"`. | Lanza `INVALID_BASE_RATE` y no produce tarifa. | [✔] | — |
| 5 | HU2, escenario 4: Consulta con datos de entrada inválidos: Ejecutar el servicio con UUID inválido y fecha no válida. Prueba: `rejects invalid roomId without calling Module 1`; `rejects invalid date without calling Module 1`; `rejects invalid date format without calling Module 1` | `npm test -- --runInBand --runTestsByPath test/unit/application/pricing/get-base-rate.service.spec.ts -t "rejects invalid"` | UUID inválido; fecha no válida. | Lanza `INVALID_QUERY_PARAMS`; el puerto de salida no es invocado. | [✔] | — |
| 6 | HU2, escenario 5: La habitación no existe en Módulo 1: Responder 404 con `ApiError.errorCode: ROOM_NOT_FOUND`. Prueba: `maps structured ROOM_NOT_FOUND, including additional fields, without opening the circuit` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "maps structured ROOM_NOT_FOUND, including additional fields, without opening the circuit"` | 404; `ApiError.errorCode: ROOM_NOT_FOUND`. | Lanza `ROOM_NOT_FOUND`; campos adicionales no cambian la clasificación. | [✔] | — |
| 7 | HU2, escenario 1: Módulo 1 responde `ROOM_NOT_FOUND` con un estado distinto de 404: Responder 403 con `ApiError.errorCode: ROOM_NOT_FOUND`. Prueba: `maps 403 with a ROOM_NOT_FOUND body to a dependency failure` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "maps 403 with a ROOM_NOT_FOUND body to a dependency failure"` | 403; `errorCode: ROOM_NOT_FOUND`. | Solo el 404 se clasifica como `ROOM_NOT_FOUND`; este caso lanza `MODULE1_UNAVAILABLE`. | [✔] | — |
| 8 | Configuración inválida al arrancar: URL ausente o en blanco; timeout ausente, `abc`, `0`, `-5` o `1.5`. Prueba: `fails at startup with` (7 casos) | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "fails at startup with"` | `MODULE1_BASE_URL` y `MODULE1_TIMEOUT_MS` inválidos. | El cliente no se construye y lanza el mensaje de configuración correspondiente. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 3: Resiliencia del circuito

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | Casos límite de dependencia: umbral consecutivo y recuperación: Probar 4 fallos + éxito + fallo, y 5 fallos seguidos con rechazos mientras el circuito está abierto. Prueba: `does not open after 4 failures, a success, then 1 failure`; `does not extend the original open window when requests are rejected by the breaker` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "does not open after 4 failures, a success, then 1 failure"` y `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "does not extend the original open window when requests are rejected by the breaker"` | 4 fallos + éxito + fallo; 5 fallos seguidos; rechazos con circuito abierto. | Los rechazos del circuito abierto no extienden la ventana; al cumplir 30 s la siguiente petición llega a Módulo 1. | [✔] | — |
| 2 | Recuperación del circuit breaker: falla y éxito en half-open: Hacer fallar la prueba half-open, esperar la nueva ventana completa de 30 s y luego devolver éxito. Prueba: `reopens for a fresh 30 s after a failed half-open probe, then closes on success` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "reopens for a fresh 30 s after a failed half-open probe, then closes on success"` | Fallo half-open; ventana completa de 30 s; éxito. | El fallo reabre el circuito por 30 s; después una prueba exitosa lo cierra. | [✔] | — |
| 3 | Errores funcionales excluidos del conteo: Tras cuatro fallos de dependencia, responder `ROOM_NOT_FOUND` o `INVALID_BASE_RATE`, seguido de un fallo y un éxito. Prueba: `does not count ROOM_NOT_FOUND as a consecutive dependency failure`; `does not count INVALID_BASE_RATE as a consecutive dependency failure` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "does not count"` | Cuatro fallos; `ROOM_NOT_FOUND` o `INVALID_BASE_RATE`; un fallo y un éxito. | Los errores funcionales no cuentan como fallo de dependencia ni dejan abierto el circuito. | [✔] | — |
| 4 | Fallos de dependencia contabilizados: Después de cuatro 5xx, responder malformado, timeout, corte de conexión o `baseRate` con más de dos decimales significativos. Prueba: `counts malformed response toward the five-failure threshold`; `counts amount with more than two significant decimal places toward the five-failure threshold`; `counts timeout toward the five-failure threshold`; `counts network failure toward the five-failure threshold` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "counts"` | Cuatro respuestas 5xx; respuesta malformada, timeout, corte de conexión o `baseRate` con más de dos decimales significativos. | Cada fallo de dependencia incrementa la secuencia y el quinto abre el circuito. | [✔] | — |
| 5 | Recuperación en half-open con error funcional: Tras abrirse el circuito y cumplirse 30 s, la prueba recibe `ROOM_NOT_FOUND`. Prueba: `closes the circuit when the half-open probe returns ROOM_NOT_FOUND` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "closes the circuit when the half-open probe returns ROOM_NOT_FOUND"` | 5 fallos; 30 s; 404 `ROOM_NOT_FOUND`; luego éxito. | El error funcional cierra el circuito y la siguiente consulta llega a Módulo 1. | [✔] | — |
| 6 | Corte de conexión: Módulo 1 corta la conexión sin responder. Prueba: `maps a dropped connection to a network error, not to a timeout` | `npm test -- --runInBand --runTestsByPath test/integration/http/module1-base-rate.client.spec.ts -t "maps a dropped connection to a network error, not to a timeout"` | Conexión cortada. | Lanza `MODULE1_UNAVAILABLE` y conserva `ECONNRESET` como causa del error, sin clasificarlo como timeout. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 4: Pruebas automáticas de la feature

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | Ejecutar los cinco specs de 004. | `npm test -- --runInBand --runTestsByPath test/unit/domain/shared/money.vo.spec.ts test/unit/domain/pricing/base-rate.spec.ts test/unit/application/pricing/get-base-rate.service.spec.ts test/integration/http/module1-base-rate.client.spec.ts test/contract/pricing/module1-base-rate.contract.spec.ts` | Cinco specs de la feature 004. | `Test Suites: 5 passed`; `Tests: 91 passed`; sin pruebas omitidas. | [✔] | — |
| 2 | Ejecutar la suite completa. | `npm test` | Suite completa. | `Test Suites: 17 passed`; `Tests: 225 passed`; ninguna omitida. | [✔] | — |
| 3 | Ejecutar las pruebas end-to-end. | `npm run test:e2e` | Suite end-to-end. | `Test Suites: 2 passed`; `Tests: 41 passed`. | [✔] | — |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : Cuatro fallos seguidos, un éxito y otro fallo no abren el circuito. → Sección 3, paso 1.
* **EC-002** : Los rechazos con el circuito abierto no extienden la ventana de 30 s. → Sección 3, paso 1.
* **EC-003** : `baseRate` con ceros finales se acepta y con más de dos decimales significativos se rechaza. → Sección 1, paso 3; Sección 2, paso 3.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| --- | :---: | --- |
| **Critical** | **C** | La consulta devuelve un valor incorrecto, parcial o sustituto, o sigue calculando sin tarifa utilizable. |
| **Major** | **M** | No se puede consultar una tarifa válida o la dependencia no se recupera según el contrato. |
| **Small / Minor** | **S** | Error documental o de formato que no afecta el resultado de la consulta. |
