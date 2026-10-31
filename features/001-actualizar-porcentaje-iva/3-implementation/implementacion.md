# Implementación: Actualizar porcentaje de IVA (001)

**Spec**: [actualizar_porcentaje_iva.md](../1-functional/actualizar_porcentaje_iva.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contrato**: [PUT-admin-vat-rate.md](../2-technical/contracts/PUT-admin-vat-rate.md)
**Rama**: `feature/001-actualizar-porcentaje-iva`

Este documento es el mapa de dónde está el código de la 001. El código no vive en esta carpeta: sigue la arquitectura hexagonal del plan base, así que está repartido por capas en `src/` y `test/`, siempre dentro de una subcarpeta `billing/`.

> Para encontrar todos los archivos de la 001 en VS Code: `Ctrl+Shift+F` y buscar `Feature 001`.

---

## 1. Recorrido de una petición

Así viaja `PUT /admin/vat-rate` con `{ "value": "19.00" }` por las capas:

```text
HTTP ─► JwtAuthGuard + RolesGuard        ¿hay token? ¿es Administrador?        → 401 / 403
     ─► VatRateAdminController            ¿value llega como texto?              → 400
     ─► UpdateVatRateService              VatRateValue: ¿0..100, ≤ 2 decimales? → 400
     ─► VatRateRepositoryPort  (puerto)
     ─► PrismaVatRateRepository           una transacción: bloqueo + vigente + historial
     ─► PostgreSQL (vat_rate, vat_rate_history)
◄─── 200 { value, updatedBy, updatedAt }
```

Cualquier error pasa por el `DomainExceptionFilter`, que lo convierte al formato `ApiError` y nunca responde 5xx.

---

## 2. Archivos por capa

### Dominio — reglas de negocio puras (sin NestJS ni Prisma)

| Archivo                                                                                                   | Qué hace                                                                                          | Requisito       |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------- |
| [vat-rate-value.vo.ts](../../../src/domain/model/billing/vat-rate-value.vo.ts)                            | Value object del porcentaje: decimal exacto entre 0 y 100, a lo sumo 2 decimales, solo como texto | FR-002, NFR-004 |
| [vat-rate.ts](../../../src/domain/model/billing/vat-rate.ts)                                              | Entidad: valor vigente, quién lo cambió y cuándo                                                  | FR-005          |
| [invalid-vat-rate.error.ts](../../../src/domain/errors/billing/invalid-vat-rate.error.ts)                 | `INVALID_VAT_RATE`                                                                                | FR-002          |
| [vat-rate-not-configured.error.ts](../../../src/domain/errors/billing/vat-rate-not-configured.error.ts)   | `VAT_RATE_NOT_CONFIGURED`: nunca se registró un porcentaje                                        | FR-003, BR-003  |
| [vat-rate-unavailable.error.ts](../../../src/domain/errors/billing/vat-rate-unavailable.error.ts)         | `VAT_RATE_UNAVAILABLE`: la lectura falló                                                          | FR-003          |
| [update-vat-rate.use-case.ts](../../../src/domain/ports/in/billing/update-vat-rate.use-case.ts)           | Puerto de entrada: actualizar el IVA                                                              | FR-001          |
| [get-current-vat-rate.use-case.ts](../../../src/domain/ports/in/billing/get-current-vat-rate.use-case.ts) | Puerto de entrada: leer el vigente (lo usará la 006)                                              | FR-003          |
| [vat-rate.repository.port.ts](../../../src/domain/ports/out/billing/vat-rate.repository.port.ts)          | Puerto de salida: persistencia del vigente y su historial                                         | FR-004, FR-005  |

### Aplicación — casos de uso

| Archivo                                                                                                      | Qué hace                                             | Requisito              |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------- |
| [update-vat-rate.service.ts](../../../src/application/services/billing/update-vat-rate.service.ts)           | Valida con el value object y solo entonces escribe   | FR-001, FR-002, FR-005 |
| [get-current-vat-rate.service.ts](../../../src/application/services/billing/get-current-vat-rate.service.ts) | Devuelve el vigente; nunca 0 ni un valor por defecto | FR-003, NFR-003        |

### Infraestructura — adaptadores

| Archivo                                                                                                                                  | Qué hace                                                                      | Requisito                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------- |
| [vat-rate-admin.controller.ts](../../../src/infrastructure/adapters/in/http/billing/vat-rate-admin.controller.ts)                        | `PUT /admin/vat-rate`, solo rol Administrador                                 | FR-006, BR-001                   |
| [update-vat-rate.dto.ts](../../../src/infrastructure/adapters/in/http/billing/dto/update-vat-rate.dto.ts)                                | Cuerpo y respuesta HTTP (también documenta Swagger)                           | —                                |
| [prisma-vat-rate.repository.ts](../../../src/infrastructure/adapters/out/persistence/repositories/billing/prisma-vat-rate.repository.ts) | Transacción: `pg_advisory_xact_lock` + guardar vigente + historial            | FR-005, FR-007, NFR-001, NFR-002 |
| [vat-rate.mapper.ts](../../../src/infrastructure/adapters/out/persistence/mappers/billing/vat-rate.mapper.ts)                            | Fila de PostgreSQL → entidad del dominio                                      | —                                |
| [billing.module.ts](../../../src/infrastructure/config/billing.module.ts)                                                                | Conecta cada puerto con su adaptador y exporta la lectura del IVA para la 006 | —                                |

### Base de datos

| Archivo                                                                                           | Qué hace                                                                                     | Requisito      |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------- |
| [schema.prisma](../../../prisma/schema.prisma)                                                    | Modelos `VatRate` y `VatRateHistory`                                                         | —              |
| [migration.sql](../../../prisma/migrations/20261030000000_create_auth_and_vat_rate/migration.sql) | Tablas `vat_rate` (fila única, nace vacía) y `vat_rate_history`, con `CHECK` de rango 0..100 | FR-002, FR-003 |

---

## 3. Pruebas

El caso de prueba manual, con la plantilla del curso, está en [4-testing/TC-001-actualizar-porcentaje-iva.md](../4-testing/TC-001-actualizar-porcentaje-iva.md). Las pruebas automáticas son estas:

| Archivo                                                                                                                | Qué comprueba                                                                      | Cómo correrla                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| [vat-rate-value.vo.spec.ts](../../../test/unit/domain/billing/vat-rate-value.vo.spec.ts)                               | Límites 0 y 100, decimales, formatos rechazados                                    | `npm test`                                     |
| [update-vat-rate.service.spec.ts](../../../test/unit/application/billing/update-vat-rate.service.spec.ts)              | Valida antes de escribir; historial; valor idéntico; sin responsable no hay cambio | `npm test`                                     |
| [get-current-vat-rate.service.spec.ts](../../../test/unit/application/billing/get-current-vat-rate.service.spec.ts)    | Vigente, no configurado, lectura fallida                                           | `npm test`                                     |
| [get-current-vat-rate.port.spec.ts](../../../test/contract/billing/get-current-vat-rate.port.spec.ts)                  | Contrato con la 006 (`"19.00"`, códigos de error)                                  | `npm test`                                     |
| [vat-rate.e2e-spec.ts](../../../test/e2e/billing/vat-rate.e2e-spec.ts)                                                 | El endpoint completo: 200, 400, 401, 403, 422                                      | `npm run test:e2e`                             |
| [prisma-vat-rate.repository.spec.ts](../../../test/integration/persistence/billing/prisma-vat-rate.repository.spec.ts) | PostgreSQL real: concurrencia, rollback, valor idéntico                            | `npm test` con `TEST_DATABASE_URL` (ver abajo) |

Resultado actual: **las 56 pruebas pasan**, incluidas las 5 de integración contra PostgreSQL real.

Las pruebas de integración usan una base aparte (`modulo3_test`), porque borran los datos de IVA. Con Docker levantado:

```powershell
$env:TEST_DATABASE_URL = "postgresql://hospitua:hospitua@localhost:5432/modulo3_test?schema=public"
npm test
```

---

## 4. Trazabilidad: requisito → código → prueba

| Requisito de la spec             | Dónde se cumple                                             | Dónde se prueba                             |
| -------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| FR-001 Actualizar el IVA vigente | `UpdateVatRateService`, controller                          | e2e "registra el primer porcentaje"         |
| FR-002 Rango 0–100               | `VatRateValue`; `CHECK` en la migración                     | unitaria del VO; e2e "validación"           |
| FR-003 Sin valor por defecto     | `GetCurrentVatRateService`; tabla nace vacía                | unitaria "sin porcentaje configurado"       |
| FR-004 No toca facturas          | El repositorio solo escribe `vat_rate` y `vat_rate_history` | Pendiente: requiere la 006 (T014)           |
| FR-005 Quién y cuándo            | Historial en la misma transacción; hora de la base de datos | unitaria e integración                      |
| FR-006 Solo Administrador        | `@Roles('Administrador')` + `RolesGuard`                    | e2e 401 y 403                               |
| FR-007 Concurrencia              | `pg_advisory_xact_lock` en el repositorio                   | integración: 10 actualizaciones simultáneas |

---

## 5. Estado de las tareas del plan

| Tarea                                       | Estado                         |
| ------------------------------------------- | ------------------------------ |
| T001–T012 (Setup e Historia 1)              | Hecho                          |
| T013, T020 (reglas de `dependency-cruiser`) | Pendiente                      |
| T014, T016a (pruebas con facturas)          | Pendiente: requieren la 006    |
| T015 (concurrencia real)                    | Hecho: pasa contra PostgreSQL  |
| T016–T019, T021                             | Hecho                          |
| T022–T024                                   | Hecho: pasan contra PostgreSQL |
| T025 (OpenAPI)                              | Hecho: Swagger en `/docs`      |
| T026 (log estructurado del cambio)          | Pendiente                      |

---

## 6. Piezas compartidas que usa la 001

No son de la 001: son de la base del proyecto y las reutilizarán las demás features.

- Login y roles: [src/infrastructure/adapters/in/http/auth/](../../../src/infrastructure/adapters/in/http/auth/)
- Formato de errores `ApiError`: [domain-exception.filter.ts](../../../src/infrastructure/adapters/in/http/domain-exception.filter.ts)
- Conexión a PostgreSQL: [prisma.service.ts](../../../src/infrastructure/adapters/out/persistence/prisma.service.ts)

---

## 7. Cómo mostrarlo funcionando

Pasos completos en el [README](../../../README.md). En resumen: levantar PostgreSQL, `npx prisma migrate deploy`, `npx prisma db seed`, `npm run start:dev`, y en <http://localhost:3000/docs>:

1. `POST /auth/login` con el administrador → copiar el token → **Authorize**.
2. `PUT /admin/vat-rate` con `"19.00"` → 200.
3. Con `"120"` → 400 `INVALID_VAT_RATE`.
4. Con el usuario `ota-demo` → 403 `FORBIDDEN`.
