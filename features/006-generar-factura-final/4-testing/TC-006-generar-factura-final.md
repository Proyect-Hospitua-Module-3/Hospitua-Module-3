### Test Case Specification: Generar factura final
**Created** : 2026-11-06  **Spec/Plan Link** : [generar_factura_final.md](../1-functional/generar_factura_final.md) · [plan.md](../2-technical/plan.md)  **Status** : Draft

#### Test Overview *(mandatory)*

**Test Case ID** : TC-006-GenerarFacturaFinal  
**Product Name & Version** : HOSPITUA Módulo 3 (Facturación, Consumos y Liquidación) v0.1.0  
**Author** : Juan Andrade
**Current Owner** : Equipo Módulo 3  
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context *(mandatory)*

##### Test Objectives

Verificar los cinco escenarios de aceptación de la spec (emisión en canal directo y OTA, reenvío del check-out ya facturado y desglose completo en ambos canales) y sus seis casos límite: liquidación `Final` inexistente, datos tributarios incompletos, IVA nunca configurado, salto o duplicado en la numeración, cambio del IVA después de emitir y reintentos concurrentes. Adicionalmente, comprobar la integridad del consecutivo ante fallos de la transacción, la inmutabilidad, la privacidad del log y las reglas de dependencia. La feature es un caso de uso interno sin endpoint propio (lo invocará 010); las verificaciones se hacen con pruebas automatizadas del dominio, del servicio, del contrato, de arquitectura y con dos suites contra PostgreSQL real: el repositorio de emisión y el flujo completo 007 + 006 con Módulo 2 simulado.

##### Document References

| Reference Name | Type of Reference | Document Location / Link |
| --- | --- | --- |
| Generar factura final | Specification Document | [1-functional/generar_factura_final.md](../1-functional/generar_factura_final.md) |
| Plan técnico 006 | Plan Document | [2-technical/plan.md](../2-technical/plan.md) |
| Contrato del caso de uso | Use Case Contract | [2-technical/contracts/UC-generate-final-invoice.md](../2-technical/contracts/UC-generate-final-invoice.md) |
| Contrato de lectura del IVA (001) | Port Contract | [2-technical/contracts/PORT-get-current-vat-rate.md](../2-technical/contracts/PORT-get-current-vat-rate.md) |
| Mapa de implementación | Implementation Map | [3-implementation/implementacion.md](../3-implementation/implementacion.md) |
| Consultas de revisión | SQL Script | [revisar-facturas.sql](revisar-facturas.sql) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* Solo se ejecutan pruebas automatizadas. La feature es un caso de uso interno sin endpoint ni interfaz; la prueba manual de punta a punta (evento de check-out real) llegará con 010.
* Módulo 2 se simula con un servidor HTTP local (el de la 004, que también usa la 007). Las cotizaciones y el IVA del flujo completo vienen de dobles en memoria, para no depender de tablas que otras suites modifican.
* Las secciones 4 y parte de la 1 necesitan PostgreSQL con las migraciones aplicadas; sin `TEST_DATABASE_URL` esas suites se omiten.

##### Dependencies & Assumptions
* Ningún caso de prueba previo es requisito.
* 007 (`GenerateSettlementUseCase`) y 001 (`GetCurrentVatRateUseCase`) ya están en `develop`.

##### Preconditions & Default Setup

* **Initial State** : base de pruebas migrada (incluye `20261106120000_create_invoice`, que crea el consecutivo con `last_number = 0`).
* **Environment** : Dependencias instaladas con `npm ci`; PostgreSQL levantado con `docker compose up -d` y, para las suites de base de datos:
  ```powershell
  $env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"
  $env:DATABASE_URL = $env:TEST_DATABASE_URL; npx prisma migrate deploy
  ```
* **Test Accounts** : No aplica.

--------------------------------------------------------------------------------

#### Test Execution Flow *(mandatory)*

##### Section 1: Emitir la factura al registrar el check-out (HU1, escenarios 1–3)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | HU1, escenario 1: Emisión en canal directo. Prueba: `canal directo: número 1, IVA sobre el hospedaje…` | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "canal directo: número 1"` | Liquidación directa de 750 000; IVA 19 %; cliente completo. | Factura `ISSUED`, `immutable: true`, número 1, IVA 142 500, total 892 500, comisión 0.00. | [✔] | — |
| 2 | HU1, escenario 1 con base real: Liquidar y emitir en canal directo. Prueba: `canal directo: comisión 0.00 y neto = hospedaje` | `npm test -- --runInBand --runTestsByPath test/integration/billing/generate-final-invoice.flow.spec.ts -t "canal directo: comisión 0.00"` | Módulo 2 simulado con reserva sin canal; PostgreSQL. | Factura con canal `DIRECT`, `otaId` nulo, comisión 0.00, neto 750 000, total 892 500. | [✔] | — |
| 3 | HU1, escenario 2: Emisión en canal OTA. Prueba: `canal OTA: el total es hospedaje bruto + IVA…` | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "canal OTA: el total es hospedaje bruto"` | Liquidación OTA (Booking): hospedaje 750 000, comisión 112 500, neto 637 500; IVA 19 %. | Total 892 500 = hospedaje + IVA; comisión y neto solo como referencia. | [✔] | — |
| 4 | HU1, escenario 2 con base real: Liquidar (007 + Módulo 2) y emitir en canal OTA. Prueba: `OTA: liquida, emite con el siguiente número…` | `npm test -- --runInBand --runTestsByPath test/integration/billing/generate-final-invoice.flow.spec.ts -t "OTA: liquida, emite"` | Módulo 2 simulado con reserva OTA al 15 %; PostgreSQL. | Número = contador + 1; `settlementId` = id de la liquidación guardada; una sola fila en `invoice`. | [✔] | — |
| 5 | FR-001: Incluye a 007 sin datos tributarios. Prueba: `incluye a 007 con los datos del check-out, sin billingCustomer` | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "incluye a 007"` | Comando con `billingCustomer`. | 007 recibe solo los 7 campos del check-out, nunca `billingCustomer`. | [✔] | — |
| 6 | HU1, escenario 3: Reenvío del check-out ya facturado. Prueba: `una estancia ya facturada devuelve la misma factura sin llamar a 007 ni al IVA` | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "una estancia ya facturada"` | Mismo comando dos veces. | Misma factura y número; 007 y el IVA no se consultan; el consecutivo no avanza. | [✔] | — |
| 7 | HU1, escenario 3 con base real y con el IVA cambiado. Prueba: `reenvío con el IVA cambiado: misma factura y número…` | `npm test -- --runInBand --runTestsByPath test/integration/billing/generate-final-invoice.flow.spec.ts -t "reenvío con el IVA cambiado"` | Emitir con 19 %, cambiar a 5 %, reenviar. | Factura idéntica con IVA 19.00; contador igual; Módulo 2 no recibe otra petición. | [✔] | — |
| 8 | Normalización de identificadores. Prueba: `normaliza los UUID a minúsculas…` | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "normaliza los UUID"` | `stayId` y `roomId` en mayúsculas. | 007 y la búsqueda reciben los UUID en minúsculas; la factura queda con el `stayId` en minúsculas. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 2: Desglose auditable y total exacto (HU2, escenarios 1–2; NFR-001)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | HU2, escenario 1: Desglose en canal directo. Prueba: `canal directo: comisión 0.00, IVA sobre el hospedaje…` | `npm test -- --runInBand --runTestsByPath test/unit/domain/billing/invoice-breakdown.spec.ts -t "canal directo"` | Hospedaje 750 000; IVA 19.00. | Desglose exacto: comisión 0.00, neto 750 000, IVA 142 500, total 892 500. | [✔] | — |
| 2 | HU2, escenario 2: Desglose en canal OTA. Prueba: `canal OTA: la comisión y el neto son referencia…` | `npm test -- --runInBand --runTestsByPath test/unit/domain/billing/invoice-breakdown.spec.ts -t "canal OTA"` | Hospedaje 750 000; comisión 112 500; neto 637 500; IVA 19.00. | El total no suma ni resta la comisión: 892 500. | [✔] | — |
| 3 | FR-002: IVA con redondeo half-up a 2 decimales. Prueba: `hospedaje … con IVA … (half-up a 2 decimales)` (5 casos) | `npm test -- --runInBand --runTestsByPath test/unit/domain/billing/invoice-breakdown.spec.ts -t "half-up a 2 decimales"` | 100.05 × 19 %; 0.50 × 5 %; 1234.56 × 19.75 %; IVA 0 %; hospedaje 0. | IVA 19.01, 0.03, 243.83, 0.00 y 0.00; total siempre = hospedaje + IVA. | [✔] | — |
| 4 | NFR-001: Determinismo. Prueba: `es determinista` | `npm test -- --runInBand --runTestsByPath test/unit/domain/billing/invoice-breakdown.spec.ts -t "es determinista"` | Mismo insumo dos veces. | Mismo desglose; objeto congelado. | [✔] | — |
| 5 | FR-010: Las dos relaciones del desglose se exigen. Prueba: `rechaza …` (6 casos) | `npm test -- --runInBand --runTestsByPath test/unit/domain/billing/invoice-breakdown.spec.ts -t "rechaza"` | Total ≠ hospedaje + IVA; total que suma la comisión; neto mal; importe negativo; tasa > 100; moneda USD. | Cada desglose inconsistente se rechaza. | [✔] | — |
| 6 | Contrato: JSON exacto del ejemplo OTA y decimales como texto. Prueba: `ISSUED: el JSON de la factura tiene exactamente los campos del contrato`; `los importes y la tasa son texto decimal` | `npm test -- --runInBand --runTestsByPath test/contract/billing/generate-final-invoice.contract.spec.ts` | Ejemplo OTA del contrato. | El JSON coincide campo a campo con el contrato; importes como texto `0.00`. | [✔] | — |
| 7 | FR-003: El comando no fija importes, IVA, canal ni número. Prueba: `el comando no acepta importes, IVA, canal ni número` | `npm test -- --runInBand --runTestsByPath test/contract/billing/generate-final-invoice.contract.spec.ts -t "el comando no acepta"` | Comando con `lodgingAmount`, `vatRateApplied`, `channel` e `invoiceNumber` falsos. | Se ignoran: los valores salen de 007, 001 y el consecutivo. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 3: Precondiciones: liquidación, datos tributarios e IVA (casos límite 1–3)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | Caso límite: faltan datos tributarios. Prueba: `… → NOT_ISSUED con BILLING_CUSTOMER_DATA_MISSING…` (5 casos) | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "NOT_ISSUED con BILLING_CUSTOMER_DATA_MISSING"` | `billingCustomer` ausente, `null`, sin documento, sin nombre, en blanco. | `NOT_ISSUED`; la liquidación sí se genera; no se lee el IVA; el consecutivo no avanza. | [✔] | — |
| 2 | Validación de los datos tributarios. Prueba: `… → null (no se emite, sin lanzar)` (8 casos) | `npm test -- --runInBand --runTestsByPath test/unit/domain/billing/billing-customer.spec.ts` | Ausente, vacío, parcial, en blanco, documento numérico. | `null` sin lanzar error; con datos completos, se recortan los espacios. | [✔] | — |
| 3 | Caso límite con base real: sin datos tributarios queda la liquidación. Prueba: `sin datos tributarios: queda la liquidación, sin factura ni número` | `npm test -- --runInBand --runTestsByPath test/integration/billing/generate-final-invoice.flow.spec.ts -t "sin datos tributarios"` | Solo `name`. | Una fila en `settlement`, ninguna en `invoice`, contador igual. | [✔] | — |
| 4 | Caso límite: no existe la liquidación `Final`. Prueba: `si 007 devuelve una liquidación que no es Final…`; `…que es de otra estancia…` | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "FINAL_SETTLEMENT_NOT_FOUND"` | Liquidación con estado distinto de `FINAL`; liquidación de otra estancia. | `FINAL_SETTLEMENT_NOT_FOUND`; no se lee el IVA ni se emite. | [✔] | — |
| 5 | Errores de 007 se propagan sin factura. Prueba: `propaga SETTLEMENT_ALREADY_EXISTS de 007…`; `propaga MODULE2_UNAVAILABLE de 007…` | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "de 007 sin crear factura"` | Errores tipados de 007. | El mismo error llega a 010; no se crea factura. | [✔] | — |
| 6 | Módulo 2 caído con base real. Prueba: `Módulo 2 caído: MODULE2_UNAVAILABLE sin liquidación, factura ni número` | `npm test -- --runInBand --runTestsByPath test/integration/billing/generate-final-invoice.flow.spec.ts -t "Módulo 2 caído"` | Módulo 2 simulado responde 503. | `MODULE2_UNAVAILABLE` (reintentable); nada guardado; contador igual. | [✔] | — |
| 7 | Caso límite: IVA nunca configurado. Prueba: `propaga VAT_RATE_NOT_CONFIGURED…`; `propaga VAT_RATE_UNAVAILABLE…` | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "propaga VAT_RATE"` | 001 lanza cada error. | Se propagan por separado (no reintentable / reintentable); sin número. | [✔] | — |
| 8 | Caso límite con base real: IVA nunca configurado y reintento tras configurarlo. Prueba: `IVA nunca configurado: VAT_RATE_NOT_CONFIGURED…`; `el reintento después de configurar el IVA…` | `npm test -- --runInBand --runTestsByPath test/integration/billing/generate-final-invoice.flow.spec.ts -t "configur"` | Sin IVA; luego 19 %. | Primero: liquidación guardada, sin factura ni número. Después: factura sobre la misma liquidación, sin duplicarla. | [✔] | — |
| 9 | Comando inválido. Prueba: `comando inválido → INVALID_CHECKOUT_EVENT antes de cualquier IO` | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "comando inválido"` | `stayId` que no es UUID. | `INVALID_CHECKOUT_EVENT`; no se llama a 007 ni a la base. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 4: Numeración consecutiva, concurrencia y atomicidad (casos límite 4 y 6; FR-005, FR-011, NFR-003)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | FR-005: Emitir asigna el siguiente número. Prueba: `emite con el siguiente número y la relee igual…` | `npm test -- --runInBand --runTestsByPath test/integration/persistence/billing/prisma-invoice-issuance.repository.spec.ts -t "emite con el siguiente número"` | Borrador de factura directa. | Número = contador + 1; la relectura es idéntica; `issuedAt` de la base. | [✔] | — |
| 2 | T025: Lectura exacta de una factura OTA. Prueba: `canal OTA: importes, canal y cliente se leen exactamente…` | `npm test -- --runInBand --runTestsByPath test/integration/persistence/billing/prisma-invoice-issuance.repository.spec.ts -t "canal OTA"` | Borrador OTA. | Importes, canal, OTA y cliente iguales a lo emitido. | [✔] | — |
| 3 | FR-007: Reenvío en la base. Prueba: `reenvío: devuelve la factura existente sin consumir número` | `npm test -- --runInBand --runTestsByPath test/integration/persistence/billing/prisma-invoice-issuance.repository.spec.ts -t "reenvío"` | Mismo borrador dos veces. | Misma factura; contador igual. | [✔] | — |
| 4 | Caso límite 6: Reintentos concurrentes de la misma estancia. Prueba: `dos emisiones simultáneas de la misma estancia…` | `npm test -- --runInBand --runTestsByPath test/integration/persistence/billing/prisma-invoice-issuance.repository.spec.ts -t "emisiones simultáneas"` | 5 emisiones en paralelo. | Una factura, un número; el contador avanza 1. | [✔] | — |
| 5 | Caso límite 6 de punta a punta. Prueba: `tres entregas simultáneas del mismo check-out…` | `npm test -- --runInBand --runTestsByPath test/integration/billing/generate-final-invoice.flow.spec.ts -t "tres entregas simultáneas"` | 3 llamadas en paralelo con el mismo comando. | Una liquidación, una factura, un número. | [✔] | — |
| 6 | Caso límite 4: Estancias distintas en paralelo, sin saltos ni duplicados. Prueba: `estancias distintas en paralelo → números únicos y consecutivos…` | `npm test -- --runInBand --runTestsByPath test/integration/persistence/billing/prisma-invoice-issuance.repository.spec.ts -t "estancias distintas en paralelo"` | 4 estancias en paralelo. | Números contador+1 … contador+4, sin huecos; `issued_at` sigue el orden del número. | [✔] | — |
| 7 | NFR-003: Fallo de la transacción no consume número. Prueba: `si la inserción falla, el contador no avanza…` | `npm test -- --runInBand --runTestsByPath test/integration/persistence/billing/prisma-invoice-issuance.repository.spec.ts -t "si la inserción falla"` | Borrador con una liquidación inexistente (la FK falla después de incrementar). | Rollback: contador igual, sin factura; la siguiente emisión usa contador + 1. | [✔] | — |
| 8 | Defensa en la base: `CHECK` del desglose. Prueba: `la base rechaza una factura cuyo total no es hospedaje + IVA` | `npm test -- --runInBand --runTestsByPath test/integration/persistence/billing/prisma-invoice-issuance.repository.spec.ts -t "la base rechaza"` | Total alterado. | La base rechaza la fila; contador igual. | [✔] | — |
| 9 | Reintento tras `DATABASE_UNAVAILABLE`. Prueba: `propaga DATABASE_UNAVAILABLE de la emisión; el reintento emite con el mismo número` | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "DATABASE_UNAVAILABLE"` | Primera emisión falla de forma transitoria. | Se propaga el error; el reintento emite el número 1 (no se consumió). | [✔] | — |
| 10 | Carrera resuelta en el servicio. Prueba: `si otra entrega emitió mientras tanto, devuelve la ganadora…` | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "si otra entrega emitió"` | Otra entrega emite justo antes. | Se devuelve la factura ganadora; no se consume otro número. | [✔] | — |
| 11 | NFR-002: Sin demoras perceptibles. Prueba: `liquidación + factura caben en 800 ms…` | `npm test -- --runInBand --runTestsByPath test/integration/billing/generate-final-invoice.flow.spec.ts -t "caben en"` | Módulo 2 tarda 200 ms. | Liquidación y factura en menos de 800 ms. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 5: Inmutabilidad, privacidad y reglas de dependencia (FR-006, FR-013, NFR-005, BR-001)

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | FR-006: La factura es inmutable. Prueba: `restore: factura ISSUED, inmutable y congelada, sin métodos de modificación` | `npm test -- --runInBand --runTestsByPath test/unit/domain/billing/invoice.spec.ts` | Factura reconstruida. | `ISSUED`, `immutable: true`, congelada y sin métodos; número, total y canal inválidos se rechazan. | [✔] | — |
| 2 | Caso límite 5: El IVA cambia después de emitir. Prueba: `si el IVA cambió después de emitir, el reenvío conserva el número y los valores originales` | `npm test -- --runInBand --runTestsByPath test/unit/application/billing/generate-final-invoice.service.spec.ts -t "si el IVA cambió"` | Emitir con 19 %, cambiar a 5 %. | La factura conserva 19.00 y 892 500. | [✔] | — |
| 3 | NFR-005 / T034–T035: Log sin datos del cliente. Prueba: `nunca registra el nombre ni el documento fiscal del cliente` y 4 más | `npm test -- --runInBand --runTestsByPath test/unit/infrastructure/billing/logged-generate-final-invoice.use-case.spec.ts` | `ISSUED`, `NOT_ISSUED`, error con y sin `errorCode`. | Log JSON con evento, estancia, factura, número, resultado y duración; nunca nombre ni documento. | [✔] | — |
| 4 | FR-013: Sin datos migratorios. Prueba: `el resultado no contiene datos migratorios` | `npm test -- --runInBand --runTestsByPath test/contract/billing/generate-final-invoice.contract.spec.ts -t "datos migratorios"` | Resultado emitido. | Ningún campo migratorio. | [✔] | — |
| 5 | BR-001, FR-001, FR-006, T033: Reglas de dependencia. Prueba: 7 reglas de `billing-dependencies.spec.ts` | `npm test -- --runInBand --runTestsByPath test/architecture/billing-dependencies.spec.ts` | Imports de `src/`. | Solo 010 y 006 importan el caso de uso; ningún controller; dominio/aplicación sin Prisma ni NestJS; sin `UpdateVatRateUseCase`; sin `UPDATE`/`DELETE` de `invoice` ni `nextval`. | [✔] | — |

--------------------------------------------------------------------------------

##### Section 6: Pruebas automáticas de la feature y regresión

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | --- | --- | --- | --- | :---: | --- |
| 1 | Ejecutar los specs de 006 que no necesitan base de datos. | `npm test -- --runInBand --runTestsByPath test/unit/domain/billing/billing-customer.spec.ts test/unit/domain/billing/invoice-breakdown.spec.ts test/unit/domain/billing/invoice.spec.ts test/unit/domain/shared/money.vo.spec.ts test/unit/application/billing/generate-final-invoice.service.spec.ts test/unit/infrastructure/billing/logged-generate-final-invoice.use-case.spec.ts test/contract/billing/generate-final-invoice.contract.spec.ts test/architecture/billing-dependencies.spec.ts` | Ocho specs. | `Test Suites: 8 passed`; `Tests: 95 passed` (71 de 006 + 24 de `Money`, 4 de ellas nuevas). | [✔] | — |
| 2 | Ejecutar las dos suites de 006 contra PostgreSQL. | `npm test -- --runInBand --runTestsByPath test/integration/persistence/billing/prisma-invoice-issuance.repository.spec.ts test/integration/billing/generate-final-invoice.flow.spec.ts` | `TEST_DATABASE_URL` con la base migrada. | `Test Suites: 2 passed`; `Tests: 17 passed`; sin pruebas omitidas. | [✔] | — |
| 3 | Regresión: el `AppModule` arranca con el wiring nuevo de `BillingModule`. | `npm run test:e2e -- --runInBand` | Todas las suites E2E. | `Test Suites: 5 passed`; `Tests: 129 passed`. | [✔] | — |
| 4 | Regresión de 007 y 001 (reglas de dependencia y contrato del IVA). | `npm test -- --runInBand --runTestsByPath test/architecture/settlement-dependencies.spec.ts test/contract/billing/get-current-vat-rate.port.spec.ts` | Dos specs existentes. | Pasan sin cambios. | [✔] | — |
| 5 | Revisión manual de la base después de la sección 4. | Ejecutar [revisar-facturas.sql](revisar-facturas.sql) contra `modulo3_test` | Facturas que dejaron las pruebas (normalmente ninguna: cada suite borra las suyas). | Consultas 4, 5 y 6 sin filas; `contador` ≥ `mayor_numero`. | [✔] | — |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
Casos límite de la spec:

* **EC-001** : No existe una liquidación `Final` asociada: no se emite ningún documento. → Sección 3, pasos 4–6.
* **EC-002** : Faltan datos tributarios: no se emite ni se asigna número; la liquidación permanece. → Sección 3, pasos 1–3.
* **EC-003** : El IVA nunca se ha configurado: no se emite, no se asigna número ni se asume un porcentaje; el evento queda para revisión. → Sección 3, pasos 7–8.
* **EC-004** : Salto o duplicado en la numeración: cada número una sola vez y en orden. → Sección 4, pasos 6–8.
* **EC-005** : El IVA cambia después de emitir: la factura no se recalcula. → Sección 1, paso 7; Sección 5, paso 2.
* **EC-006** : Reintentos concurrentes de la misma estancia: un solo número. → Sección 4, pasos 4, 5 y 10.

Casos límite adicionales del plan y del contrato:

* **EC-007** : Fallo de la transacción después de reservar el número: el rollback revierte número y factura. → Sección 4, paso 7.
* **EC-008** : Fallo transitorio de la base: `DATABASE_UNAVAILABLE` reintentable sin consumir número. → Sección 4, paso 9.
* **EC-009** : Redondeo half-up con fracciones de peso, IVA 0 % y hospedaje 0. → Sección 2, paso 3.
* **EC-010** : Campos ajenos en el comando (importes, IVA, canal, número) se ignoran. → Sección 2, paso 7.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| --- | :---: | --- |
| **Critical** | **C** | Se duplica, salta o reutiliza un número oficial; el total incluye la comisión o no es hospedaje + IVA; se emite sin liquidación `Final` o sin datos tributarios; una factura emitida cambia. |
| **Major** | **M** | No se puede emitir una factura válida, un reenvío no devuelve la factura original o un error transitorio no es reintentable. |
| **Small / Minor** | **S** | Error documental, de log o de formato que no afecta el documento fiscal ni la numeración. |
