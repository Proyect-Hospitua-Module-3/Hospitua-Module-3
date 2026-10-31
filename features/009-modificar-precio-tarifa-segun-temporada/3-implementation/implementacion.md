# Implementación: Modificar precio tarifa según temporada (009)

**Spec**: [modificar_precio_tarifa_segun_temporada.md](../1-functional/modificar_precio_tarifa_segun_temporada.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contratos**: [ADMIN-season-rules.md](../2-technical/contracts/ADMIN-season-rules.md) (REST) · [PORT-get-season-rules.md](../2-technical/contracts/PORT-get-season-rules.md) (puerto interno para 005 y 011)
**Rama**: `feature/009-modificar-precio-tarifa-segun-temporada`

Este documento es el mapa de dónde está el código de la 009. El código no vive en esta carpeta: sigue la arquitectura hexagonal del plan base, así que está repartido por capas en `src/` y `test/`, siempre dentro de una subcarpeta `pricing/`.

> Para encontrar todos los archivos de la 009 en VS Code: `Ctrl+Shift+F` y buscar `Feature 009`.

---

## 1. Qué hace

El Administrador mantiene el **catálogo de temporadas** del hotel (Regular, Alta, Baja, Festival…) y el **porcentaje de ajuste** de cada una sobre la tarifa base: `+20.00` sube la tarifa 20 %, `-10.00` la baja 10 %. La feature 005 (tarifa dinámica) usará ese porcentaje para calcular el precio de cada noche.

| Endpoint | Qué hace |
|---|---|
| `GET /admin/season-rules` | Lista las temporadas activas con su ajuste vigente |
| `POST /admin/season-rules` | Crea una temporada con nombre, color y ajuste |
| `PUT /admin/season-rules/{seasonId}` | Cambia nombre, color y/o ajuste (parcial) |
| `DELETE /admin/season-rules/{seasonId}` | Retira la temporada (borrado lógico) |

Todos exigen el rol Administrador. Además, el puerto interno `GetEffectiveSeasonRulesUseCase` entrega a 005 y 011 las reglas vigentes en un instante dado.

---

## 2. Recorrido de una petición

Así viaja `PUT /admin/season-rules/{id}` con `{ "adjustmentPercent": "-10", "expectedVersion": 1 }`:

```text
HTTP ─► JwtAuthGuard + RolesGuard             ¿hay token? ¿es Administrador?            → 401 / 403
     ─► SeasonAdminController + ValidationPipe ¿campos permitidos y del tipo correcto?   → 400
     ─► ModifySeasonRuleService               SeasonAdjustmentPercent: ¿-100..100?      → 400
     ─► PrismaSeasonRuleRepository.modify     ┌ bloquea la temporada (SELECT … FOR UPDATE)   → 404 si no existe
                                              │ lee su estado actual
                                              │ Season.planChange (DOMINIO decide):
                                              │   ¿versión esperada? ¿renombra Regular? ¿cambia algo?  → 409 / no-op
                                              │ cierra la regla vigente y crea la nueva en el mismo instante
                                              └ escribe el historial — todo en una transacción
◄─── 200 { seasonId, name, color, adjustmentPercent, version, validFrom, updatedBy, updatedAt }
```

**Idea clave para explicar:** el repositorio pone el candado y guarda, pero **quien decide es el dominio** (`Season.planChange`). Así las reglas de negocio no quedan escondidas en SQL y no hay carreras entre leer y escribir.

---

## 3. Archivos por capa

### Dominio — reglas de negocio puras (sin NestJS ni Prisma)

| Archivo | Qué hace | Requisito |
|---|---|---|
| [season.ts](../../../src/domain/model/pricing/season.ts) | Temporada con su regla vigente. `planChange` decide qué cambia (versión esperada, Regular no se renombra, no-op); `assertCanBeRetired` protege a Regular | FR-001, FR-003, casos límite |
| [season-adjustment-percent.vo.ts](../../../src/domain/model/pricing/season-adjustment-percent.vo.ts) | Porcentaje firmado entre -100 y 100, a lo sumo 2 decimales, solo como texto | FR-002, FR-008 |
| [season-name.vo.ts](../../../src/domain/model/pricing/season-name.vo.ts) | Nombre sin espacios exteriores; comparación sin mayúsculas | FR-001 |
| [season-color.vo.ts](../../../src/domain/model/pricing/season-color.vo.ts) | Color `#RRGGBB` en mayúsculas | FR-001 |
| [season-rule.ts](../../../src/domain/model/pricing/season-rule.ts) | Versión inmutable del ajuste | FR-003, BR-004 |
| [errors/pricing/](../../../src/domain/errors/pricing/) | 9 errores de dominio (7 con código HTTP y 2 internos del puerto) | — |
| [modify-season-rule.use-case.ts](../../../src/domain/ports/in/pricing/modify-season-rule.use-case.ts) | Puerto de entrada: listar, crear, modificar, retirar | FR-001, FR-005 |
| [get-effective-season-rules.use-case.ts](../../../src/domain/ports/in/pricing/get-effective-season-rules.use-case.ts) | Puerto de entrada interno: snapshot por instante para 005 y 011 | FR-006, FR-007 |
| [season-rule.repository.port.ts](../../../src/domain/ports/out/pricing/season-rule.repository.port.ts) | Puerto de salida: persistencia con bloqueo y decisión del dominio | FR-003, FR-004 |
| [season-calendar-reference.port.ts](../../../src/domain/ports/out/pricing/season-calendar-reference.port.ts) | Puerto de salida: ¿el calendario vigente usa esta temporada? | FR-001 |

### Aplicación — casos de uso

| Archivo | Qué hace | Requisito |
|---|---|---|
| [modify-season-rule.service.ts](../../../src/application/services/pricing/modify-season-rule.service.ts) | Valida con los value objects, exige responsable y delega en el repositorio | FR-001, FR-002, FR-004 |
| [get-effective-season-rules.service.ts](../../../src/application/services/pricing/get-effective-season-rules.service.ts) | Arma el snapshot del contrato y exige exactamente una temporada por defecto | FR-006, NFR-003 |

### Infraestructura — adaptadores

| Archivo | Qué hace | Requisito |
|---|---|---|
| [season-admin.controller.ts](../../../src/infrastructure/adapters/in/http/pricing/season-admin.controller.ts) | Los 4 endpoints, solo rol Administrador; traduce errores de validación a `INVALID_SEASON` / `INVALID_SEASON_ADJUSTMENT` | FR-005, BR-001 |
| [season.dto.ts](../../../src/infrastructure/adapters/in/http/pricing/dto/season.dto.ts) | Cuerpos y respuestas HTTP (también documentan Swagger) | — |
| [prisma-season-rule.repository.ts](../../../src/infrastructure/adapters/out/persistence/repositories/pricing/prisma-season-rule.repository.ts) | Transacciones con `SELECT … FOR UPDATE`, versiones de regla, historial, retiro lógico y snapshot por instante | FR-003, FR-004, NFR-001, NFR-002 |
| [season.mapper.ts](../../../src/infrastructure/adapters/out/persistence/mappers/pricing/season.mapper.ts) | Filas de PostgreSQL → dominio | — |
| [pending-season-calendar-reference.adapter.ts](../../../src/infrastructure/adapters/out/calendar/pending-season-calendar-reference.adapter.ts) | **Provisional hasta la 011**: responde "no está en uso" porque aún no hay calendario | FR-001 |
| [pricing.module.ts](../../../src/infrastructure/config/pricing.module.ts) | Conecta cada puerto con su adaptador y exporta el snapshot para 005 y 011 | — |

### Base de datos

| Archivo | Qué hace | Requisito |
|---|---|---|
| [schema.prisma](../../../prisma/schema.prisma) | Modelos `Season`, `SeasonRule`, `SeasonRuleHistory` | — |
| [migration.sql](../../../prisma/migrations/20261031000000_manage_season_rules/migration.sql) | Tablas, restricciones de la base y la temporada `Regular` inicial (ver abajo) | FR-001, FR-002, FR-003 |

La base de datos es la **última defensa** de las reglas, aunque alguien se salte la aplicación:

| Restricción | Garantiza |
|---|---|
| `season_single_default` (índice único parcial) | Una sola temporada por defecto |
| `season_active_name_key` (índice único parcial) | Nombre único entre temporadas activas, sin distinguir mayúsculas ni espacios |
| `season_default_is_regular`, `season_default_never_archived` (CHECK) | La temporada por defecto se llama Regular y nunca se retira |
| `season_rule_adjustment_range` (CHECK) | Ajuste entre -100 y 100 |
| `season_rule_no_overlap` (EXCLUDE con `btree_gist`) | Dos versiones de una temporada nunca se solapan en el tiempo |
| `season_rule_single_current` (índice único parcial) | Una sola versión vigente por temporada |

---

## 4. Pruebas

El caso de prueba manual, con la plantilla del curso, está en [4-testing/TC-009-modificar-precio-tarifa-segun-temporada.md](../4-testing/TC-009-modificar-precio-tarifa-segun-temporada.md). Las pruebas automáticas son estas:

| Archivo | Qué comprueba | Pruebas |
|---|---|:-:|
| [season-adjustment-percent.vo.spec.ts](../../../test/unit/domain/pricing/season-adjustment-percent.vo.spec.ts) | Límites -100 y 100, signo, decimales, formatos rechazados | 26 |
| [season-name-color.vo.spec.ts](../../../test/unit/domain/pricing/season-name-color.vo.spec.ts) | Nombre y color válidos e inválidos | 13 |
| [season.spec.ts](../../../test/unit/domain/pricing/season.spec.ts) | `planChange` (no-op, versión, Regular) y retiro | 8 |
| [modify-season-rule.service.spec.ts](../../../test/unit/application/pricing/modify-season-rule.service.spec.ts) | Alta, cambios, no-op, versión, Regular, nombre repetido, retiro, temporada en uso | 19 |
| [get-effective-season-rules.service.spec.ts](../../../test/unit/application/pricing/get-effective-season-rules.service.spec.ts) | Snapshot antes/después de un cambio, retiradas, errores | 7 |
| [effective-season-rules.contract.spec.ts](../../../test/contract/pricing/effective-season-rules.contract.spec.ts) | Contrato con 005 y 011: campos, formatos, orden, un solo default | 6 |
| [prisma-season-rule.repository.spec.ts](../../../test/integration/persistence/pricing/prisma-season-rule.repository.spec.ts) | PostgreSQL real: versiones sin solape, concurrencia, rollback, retiro lógico, restricciones | 15 |
| [season-admin.e2e-spec.ts](../../../test/e2e/pricing/season-admin.e2e-spec.ts) | Los 4 endpoints: 200, 201, 204, 400, 401, 403, 404, 409 | 25 |

Resultado actual: **las 119 pruebas de la 009 pasan**, incluidas las de integración contra PostgreSQL real (5 de 5 corridas estables). Con las de la 001, el proyecto suma 175.

```powershell
$env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"
npm test             # unitarias, de contrato y de integración
npm run test:e2e     # endpoints de punta a punta
```

---

## 5. Trazabilidad: requisito → código → prueba

| Requisito de la spec | Dónde se cumple | Dónde se prueba |
|---|---|---|
| FR-001 Crear, retirar (no Regular) y ajustar temporadas | Servicio, `Season`, retiro lógico en el repositorio, CHECK de la migración | unitarias del servicio; e2e POST/DELETE; integración "retiro lógico" |
| FR-002 Ajuste numérico en rango, positivo o negativo | `SeasonAdjustmentPercent`; CHECK `season_rule_adjustment_range` | unitarias del VO; e2e 400 |
| FR-003 Una sola regla vigente por período | Cierre y apertura en el mismo instante; EXCLUDE y índice parcial | integración "mismo instante", "concurrencia", "solapamiento" |
| FR-004 Quién, cuándo y valor anterior | `season_rule_history` en la misma transacción | integración "historial", "rollback" |
| FR-005 Solo Administrador | `@Roles('Administrador')` + `RolesGuard` | e2e 401 y 403 |
| FR-006 Nuevas consultas usan la regla nueva, sin retroactividad | `findEffectiveAt(asOf)` | unitaria y de integración "antes/después" |
| FR-007 Regular por defecto | Migración, `defaultSeasonId` del snapshot | contrato "un solo default" |
| NFR-002 Concurrencia | `SELECT … FOR UPDATE` + `expectedVersion` | integración: 8 cambios simultáneos; 3 con la misma versión |
| Casos límite: valor idéntico | `planChange` devuelve no-op | unitaria; e2e; integración "sin versión ni historial" |

---

## 6. Estado de las tareas del plan

| Tarea | Estado |
|---|---|
| T001–T011 (Setup y fundación) | Hecho. `Money` no se creó: el porcentaje usa `decimal.js` directamente, igual que el IVA de 001 |
| T012–T015, T017–T020 (Historia 1) | Hecho |
| T016 (integración) | Hecho, salvo la carrera con la publicación de 011: requiere la 011 |
| T021–T023, T025–T027 (Historia 2) | Hecho |
| T024 (no retroactividad con cotizaciones) | Pendiente: requiere la 005 |
| T028 | Hecho: 009 no escribe cotizaciones ni toca `settlement`/`invoice` |
| T029–T033 (Historia 3) | Hecho |
| T034 (OpenAPI) | Hecho: Swagger en `/docs` |
| T035 (test de arquitectura) | Pendiente |
| T036 (logs estructurados) | Pendiente |
| T037 (migración desde base vacía) | Hecho: integración "catálogo inicial" |

---

## 7. Dependencias con otras features

- **011 Revisar temporada del año**: cuando exista, debe reemplazar [`PendingSeasonCalendarReferenceAdapter`](../../../src/infrastructure/adapters/out/calendar/pending-season-calendar-reference.adapter.ts) por uno que consulte el calendario real, y bloquear en modo `FOR SHARE` las temporadas que asigne al publicar (plan 009, "Carrera con 011").
- **005 Consultar tarifa dinámica**: consumirá `GET_EFFECTIVE_SEASON_RULES_USE_CASE`, exportado por `PricingModule`.
- **Migraciones**: las próximas se deben generar con `prisma migrate diff` desde el esquema anterior (ver el comentario al inicio de la migración de 009), para no perder los índices y restricciones escritos a mano.

---

## 8. Cómo mostrarlo funcionando

Pasos completos en el [README](../../../README.md). Con el servidor corriendo, en <http://localhost:3000/docs>:

1. `POST /auth/login` con el administrador → copiar el token → **Authorize**.
2. `GET /admin/season-rules` → aparece solo `Regular` con `0.00`.
3. `POST /admin/season-rules` con `{ "name": "Alta", "color": "#E67E22", "adjustmentPercent": "20" }` → **201**.
4. `PUT /admin/season-rules/{id de Alta}` con `{ "adjustmentPercent": "25", "expectedVersion": 1 }` → **200**, versión 2. Repetirlo igual → **409** `SEASON_RULE_CONFLICT`.
5. `PUT` a Regular con `{ "name": "Normal" }` → **409** `DEFAULT_SEASON_IMMUTABLE`.
6. `DELETE` de Alta → **204**; ya no aparece en el `GET`.
