# Implementación: Consultar porcentaje de comisión OTA (003)

**Spec**: [consultar_porcentaje_comision_ota.md](../1-functional/consultar_porcentaje_comision_ota.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contrato**: [GET-ota-commission-otaid.md](../2-technical/contracts/GET-ota-commission-otaid.md) (REST)
**Rama**: `feature/003-consultar-porcentaje-comision-ota`
**Fecha**: 2026-11-12

Este documento ubica la 003 en las capas hexagonales de `src/` y `test/`, dentro del contexto `ota-commission`. No tiene frontend: la consumen Módulo 2 y las OTA.

> Para encontrar todos los archivos de la 003 en VS Code: `Ctrl+Shift+F` y buscar `Feature 003`.

**Alcance**: las 3 historias de usuario y un endpoint de lectura. 28 de las 29 tareas del plan están completas; T029 (revisar el índice con volumen real) espera datos reales.

---

## 1. Qué hace

`GET /ota-commission/{otaId}` devuelve el porcentaje de comisión de la liquidación `Final` **más reciente** de una OTA, con la liquidación de origen y su fecha. Es un dato **histórico y referencial**: la fuente del porcentaje de una reserva sigue siendo Módulo 2.

| Quién llama | Cómo | Alcance |
|---|---|---|
| Módulo 2 | Red interna, sin token | Cualquier `otaId` |
| OTA | JWT con `role = OTA` y claim `otaId` | Solo su propio `otaId` |
| Otro rol (Administrador) | JWT | 403 |

| Caso | Respuesta |
|---|---|
| Con historial | 200 `{ otaId, historical: true, percentage: "15.00", settlementId, settlementDate }` |
| Sin historial | 200 `{ otaId, historical: false }` (sin porcentaje, ni siquiera 0) |
| `otaId` = `DIRECT` (sin distinguir mayúsculas) o vacío | 400 `INVALID_QUERY_PARAMS` |
| Token inválido o expirado, o token OTA sin `otaId` | 401 `UNAUTHENTICATED` |
| OTA consulta otra OTA, o rol distinto de OTA | 403 `FORBIDDEN`, mismo cuerpo exista o no historial |

La consulta **solo lee**: nunca crea, corrige ni fija porcentajes, y `Generar liquidación` (007) nunca la invoca.

---

## 2. Recorrido de una petición

```text
HTTP ─► CorrelationIdMiddleware        X-Correlation-Id (de la base)
     ─► OptionalJwtAuthGuard           sin token: pasa; token inválido o vencido              → 401
     ─► OtaCommissionAccessGuard       rol distinto de OTA                                      → 403
                                       token OTA sin otaId                                      → 401
     ─► OtaCommissionController        pasa el otaId tal cual + el actor (INTERNAL u OTA)
     ─► GetLatestOtaCommissionService
          ├─ parseOtaId                 vacío                                                   → 400 INVALID_QUERY_PARAMS
          │                             DIRECT (canal directo)                                  → 400 INVALID_QUERY_PARAMS
          ├─ alcance de la OTA          claim.otaId ≠ otaId (antes de leer)                     → 403 FORBIDDEN
          └─ PrismaOtaCommissionQueryAdapter.findLatestByOtaId   (READ ONLY)
               SELECT … FROM settlement WHERE ota_id = ? AND channel = 'OTA'
               ORDER BY generated_at DESC, id DESC LIMIT 1
     ◄── 200 { otaId, historical: true, … }  o  { otaId, historical: false }
```

---

## 3. Archivos por capa

### Dominio — reglas de negocio puras (sin NestJS ni Prisma)

| Archivo | Qué hace | Requisito |
|---|---|---|
| [ota-commission-reference.ts](../../../src/domain/model/ota-commission/ota-commission-reference.ts) | `OtaCommissionReference` inmutable (porcentaje como `CommissionPercentage` de 007) y `OtaCommissionResult` (`HISTORICAL` / `NO_HISTORY`) | FR-001, FR-002, FR-004 |
| [ota-commission-query.ts](../../../src/domain/model/ota-commission/ota-commission-query.ts) | `parseOtaId` (vacío y `DIRECT`) y `OtaCommissionCaller` (`INTERNAL` u `OTA`) | FR-006, FR-009 |
| [commission-not-applicable.error.ts](../../../src/domain/errors/ota-commission/commission-not-applicable.error.ts) | Canal directo → `INVALID_QUERY_PARAMS` (400) | FR-006, NFR-004 |
| [invalid-ota-commission-query.error.ts](../../../src/domain/errors/ota-commission/invalid-ota-commission-query.error.ts) | `otaId` vacío → `INVALID_QUERY_PARAMS` (400) | Contrato, «Errores» |
| [ota-access-denied.error.ts](../../../src/domain/errors/ota-commission/ota-access-denied.error.ts) | OTA ajena → `FORBIDDEN` (403), mensaje genérico | BR-003, SC-006 |
| [get-latest-ota-commission.use-case.ts](../../../src/domain/ports/in/ota-commission/get-latest-ota-commission.use-case.ts) | Puerto de entrada, con el comentario de arquitectura de T005 | BR-001, BR-004 |
| [ota-commission-query.port.ts](../../../src/domain/ports/out/ota-commission/ota-commission-query.port.ts) | Puerto de salida con un único método de lectura | FR-005, SC-004 |

### Aplicación — caso de uso

| Archivo | Qué hace |
|---|---|
| [get-latest-ota-commission.service.ts](../../../src/application/services/ota-commission/get-latest-ota-commission.service.ts) | Valida `otaId`, aplica el alcance de la OTA **antes** de leer y traduce "sin historial". Sin decoradores de NestJS ni caché |

### Infraestructura — adaptadores

| Archivo | Qué hace |
|---|---|
| [ota-commission.controller.ts](../../../src/infrastructure/adapters/in/http/ota-commission/ota-commission.controller.ts) | `GET /ota-commission/:otaId`, solo `GET`, con documentación Swagger; arma la respuesta con `historical` |
| [ota-commission-access.guard.ts](../../../src/infrastructure/adapters/in/http/ota-commission/ota-commission-access.guard.ts) | Sin token pasa (Módulo 2); con token exige rol OTA y claim `otaId` |
| [dto/ota-commission.dto.ts](../../../src/infrastructure/adapters/in/http/ota-commission/dto/ota-commission.dto.ts) | Respuesta 200 para Swagger |
| [prisma-ota-commission-query.adapter.ts](../../../src/infrastructure/adapters/out/persistence/repositories/ota-commission/prisma-ota-commission-query.adapter.ts) | `findFirst` sobre `settlement` en `readOnlyTransaction` (de 002), solo con las columnas de la respuesta |
| [ota-commission.module.ts](../../../src/infrastructure/config/ota-commission.module.ts) | Binding puerto → adaptador y caso de uso; no exporta nada |

### Archivos compartidos que tocó la 003

| Archivo | Cambio |
|---|---|
| [app.module.ts](../../../src/app.module.ts) | Importa `OtaCommissionModule` |
| [README.md](../../../README.md) | Fila de la 003 |

Se reutilizan sin cambios `OptionalJwtAuthGuard` (005), `readOnlyTransaction` (002), `CommissionPercentage` (007) y el `DomainExceptionFilter`: `INVALID_QUERY_PARAMS` → 400 y `FORBIDDEN` → 403 ya estaban registrados.

### Base de datos

La 003 no crea tablas ni migraciones. Lee `settlement` (de 007) con el índice `(ota_id, generated_at DESC)` que 007 ya creó para esta feature (`20261105000000_create_settlement`).

---

## 4. Pruebas

| Archivo | Tipo | Pruebas | Qué verifica |
|---|---|---:|---|
| [ota-commission-query.spec.ts](../../../test/unit/domain/ota-commission/ota-commission-query.spec.ts) | Unitaria | 13 | `DIRECT` en cualquier capitalización, vacío o no texto; porcentaje exacto, inmutabilidad y porcentajes imposibles |
| [get-latest-ota-commission.service.spec.ts](../../../test/unit/application/ota-commission/get-latest-ota-commission.service.spec.ts) | Unitaria | 9 | HU1 (con y sin historial, canal directo sin leer, el más reciente, determinismo) y HU3 (propia, ajena sin leer, mismo rechazo, Módulo 2 ve todo) |
| [ota-commission-access.guard.spec.ts](../../../test/unit/infrastructure/ota-commission/ota-commission-access.guard.spec.ts) | Unitaria | 6 | Sin token, OTA, Administrador → 403, OTA sin `otaId` → 401 |
| [ota-commission-dependencies.spec.ts](../../../test/architecture/ota-commission-dependencies.spec.ts) | Arquitectura | 9 | `settlement` nunca importa `ota-commission` (HU2); solo `AppModule` importa el módulo; sin lado de escritura; puerto con un solo método; adaptador solo lee; controller solo `GET` |
| [ota-commission.contract.spec.ts](../../../test/contract/ota-commission/ota-commission.contract.spec.ts) | Contrato | 17 | Ejemplos 1 y 2 del contrato, sin 404, solo los campos del contrato; 400, 401 (inválido, expirado, sin `otaId`), 403 (Administrador y OTA ajena con el mismo cuerpo); `POST`/`PUT`/`PATCH`/`DELETE` → 404 |
| [prisma-ota-commission-query.adapter.spec.ts](../../../test/integration/persistence/ota-commission/prisma-ota-commission-query.adapter.spec.ts) | Integración (PostgreSQL) | 9 | La más reciente, sin promediar, nunca el canal directo, sin mezclar OTA, `null` sin historial, liquidación antigua, desempate, no modifica `settlement`, índice de 007 |
| [consultar-comision-ota.e2e-spec.ts](../../../test/e2e/ota-commission/consultar-comision-ota.e2e-spec.ts) | E2E (PostgreSQL) | 7 | Check-out → liquidación (007) → consulta por HTTP; HU1, HU3, autorización, determinismo y **HU2**: la nueva liquidación usa el 18 % de la reserva y no el 15 % histórico, sin que 007 lea el puerto de 003 |

**Estado de la ejecución (2026-11-12).** Pasan las **54 pruebas sin base de datos** (unitarias, arquitectura y contrato) y `tsc --noEmit` compila todo `src/` y `test/`. Las **16 pruebas con PostgreSQL** (integración y E2E) están escritas y compilan, pero **no se ejecutaron** en este equipo porque no tiene Docker ni PostgreSQL disponibles: quedan para ejecutarlas el equipo con una base migrada.

Para ejecutarlas, con `TEST_DATABASE_URL` hacia una base de pruebas separada y ya migrada, desde la raíz del repositorio:

```powershell
npm.cmd test -- ota-commission
npm.cmd run test:e2e -- ota-commission
```

---

## 5. Trazabilidad: requisito → código → prueba

| Requisito | Código | Prueba |
|---|---|---|
| FR-001, SC-001 (porcentaje de la Final más reciente con su fecha) | `findLatestByOtaId` (`ORDER BY generated_at DESC, id DESC`) | servicio, integración «más reciente», contrato ejemplo 1, e2e HU1 |
| FR-002 (histórico y referencial) | `historical: true` en el controller; descripción en Swagger | contrato, e2e |
| FR-003, BR-004, SC-003 (007 nunca la invoca) | módulo sin exports; dependencia asimétrica | arquitectura, e2e HU2 (contador de lecturas) |
| FR-004, SC-002 (sin historial explícito) | `NO_HISTORY` → `{ otaId, historical: false }` | servicio, contrato ejemplo 2, integración `null`, e2e |
| FR-005, BR-002, SC-004 (solo lectura) | puerto de un método, `readOnlyTransaction`, solo `GET` | arquitectura, contrato métodos no permitidos, integración «no modifica» |
| FR-006, NFR-004 (canal directo no es OTA) | `parseOtaId` y `channel = 'OTA'` en la consulta | dominio, servicio, contrato 400, integración «nunca el canal directo» |
| FR-007, SC-005 (solo Módulo 2 y OTA) | `OptionalJwtAuthGuard` + `OtaCommissionAccessGuard` | guard, contrato 401/403, e2e |
| FR-008, NFR-001 (determinista) | sin caché; desempate por `id` | servicio, integración «mismo instante», e2e |
| FR-009, BR-003, SC-006 (solo su propio historial) | comparación de `otaId` en el servicio antes de leer | servicio, contrato 403 con mismo cuerpo, e2e |
| NFR-003 (privacidad) | `select` con solo 4 columnas; DTO con 5 campos | contrato «solo los campos», integración «sin mezclar OTA» |
| Casos límite (porcentajes distintos, liquidación antigua) | sin promedio ni TTL | servicio, integración |

---

## 6. Decisiones de implementación

- **`DIRECT` sin distinguir mayúsculas ni espacios**: `direct` o ` Direct ` también se rechazan con 400; así ninguna variante del canal directo recibe una respuesta de comisión. Un `otaId` vacío también es `INVALID_QUERY_PARAMS`, con su propio mensaje.
- **El canal directo se valida antes que el alcance de la OTA**, siguiendo el orden de las reglas del contrato (regla 2 antes que la 3). No revela nada: `DIRECT` no es una OTA.
- **Guard propio** (`OtaCommissionAccessGuard`) en vez de `SettlementAccessGuard` (002) o `InternalOrOtaGuard` (005): el de 002 tiene un mensaje de liquidaciones y el de 005 no exige el claim `otaId`. Sigue la misma regla que el de 002 (token OTA sin `otaId` → 401).
- **Porcentaje con `CommissionPercentage` de 007**: `ota-commission` puede depender del modelo de `settlement` (la dependencia va en ese sentido); al revés lo impide la prueba de arquitectura.
- **Filtro `ota_commission_percentage IS NOT NULL`** además de `channel = 'OTA'`: 007 nunca guarda una OTA sin porcentaje, pero si ocurriera, la consulta nunca respondería con un porcentaje vacío o en cero.
- **Desempate por `id`** cuando dos liquidaciones tienen el mismo `generated_at`, para que la respuesta sea siempre la misma (NFR-001).
- **Regla de arquitectura con Jest y no con `dependency-cruiser`**, como hizo 007: el proyecto no tiene esa herramienta ni CI configurado; la prueba corre en `npm test`.
- **Sin log estructurado propio**: el plan de la 003 no lo pide; los errores inesperados ya se registran en el `DomainExceptionFilter` con el id de correlación.

---

## 7. Dependencias con otras features

| Feature | Qué usa la 003 |
|---|---|
| 007 Generar liquidación | Tabla `settlement` (solo lectura), su índice `(ota_id, generated_at DESC)` y `CommissionPercentage` |
| 002 Consultar liquidación | `readOnlyTransaction` |
| 005 Consultar tarifa dinámica | `OptionalJwtAuthGuard` |
| 010 Registrar check-out | Es quien genera las liquidaciones en la operación real (vía 007) |

Ninguna feature depende de la 003.

---

## 8. Cómo mostrarlo funcionando

El recorrido completo y replicable, con datos fijos y el check-out real de la HU2, está en el [TC-003](../4-testing/TC-003-consultar-porcentaje-comision-ota.md). Versión corta:

1. Generar liquidaciones reales: seguir el [TC-010](../../010-registrar-checkout/4-testing/TC-010-registrar-checkout.md) con una reserva OTA de Módulo 2 simulado (por ejemplo `otaId: "booking"`, `otaCommissionPercentage: 15`).
2. Como Módulo 2 (sin token): `GET http://localhost:3000/ota-commission/booking` → `historical: true` y `percentage: "15.00"`.
3. Una OTA sin liquidaciones: `GET /ota-commission/expedia` → `{ "otaId": "expedia", "historical": false }`.
4. Canal directo: `GET /ota-commission/DIRECT` → 400 `INVALID_QUERY_PARAMS`.
5. Como OTA: `POST /auth/login` con el usuario `SEED_OTA_*` del `.env` (su `otaId` es `SEED_OTA_ID`, por defecto `booking`), autorizar en Swagger (<http://localhost:3000/docs>) o en Postman con `Authorization: Bearer <token>`; `GET /ota-commission/booking` → 200 y `GET /ota-commission/expedia` → 403.
6. Con el token del Administrador: `GET /ota-commission/booking` → 403.
