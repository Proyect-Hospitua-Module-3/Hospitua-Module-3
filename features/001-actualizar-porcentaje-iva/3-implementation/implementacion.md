# Implementación: Actualizar porcentaje de IVA (001)

**Spec**: [actualizar_porcentaje_iva.md](../1-functional/actualizar_porcentaje_iva.md)
**Plan**: [plan.md](../2-technical/plan.md)
**Contratos**: [PUT-admin-vat-rate.md](../2-technical/contracts/PUT-admin-vat-rate.md) · [GET-admin-vat-rate.md](../2-technical/contracts/GET-admin-vat-rate.md) (agregado con el frontend, sección 8)
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
| FR-004 No toca facturas          | El repositorio solo escribe `vat_rate` y `vat_rate_history` | integración de la 006 «reenvío con el IVA cambiado» (la factura conserva su IVA) |
| FR-005 Quién y cuándo            | Historial en la misma transacción; hora de la base de datos | unitaria e integración                      |
| FR-006 Solo Administrador        | `@Roles('Administrador')` + `RolesGuard`                    | e2e 401 y 403                               |
| FR-007 Concurrencia              | `pg_advisory_xact_lock` en el repositorio                   | integración: 10 actualizaciones simultáneas |

---

## 5. Estado de las tareas del plan

| Tarea                                       | Estado                         |
| ------------------------------------------- | ------------------------------ |
| T001–T012 (Setup e Historia 1)              | Hecho                          |
| T013 (regla de dependencias de `UpdateVatRateService`) | Pendiente |
| T020 (006 solo lee el IVA) | Hecho en la prueba de arquitectura de la 006 (`test/architecture/billing-dependencies.spec.ts`, con Jest en vez de `dependency-cruiser`) |
| T014 (factura emitida no cambia al actualizar el IVA) | Cubierta por la integración de la 006 «reenvío con el IVA cambiado: misma factura y número» |
| T016a (actualización en el instante de una emisión) | Pendiente: ya no está bloqueada (la 006 existe), falta la prueba |
| T015 (concurrencia real)                    | Hecho: pasa contra PostgreSQL  |
| T016–T019, T021                             | Hecho                          |
| T022–T024                                   | Hecho: pasan contra PostgreSQL |
| T025 (OpenAPI)                              | Hecho: Swagger en `/docs`      |
| T026 (log estructurado del cambio)          | Pendiente                      |

---

## 6. Piezas compartidas que usa la 001

No son de la 001: son de la base del proyecto y las reutilizan las demás features.

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

O desde el frontend (sección 8): `npm run start:dev` en la raíz y `npm run dev` en `frontend/`, luego <http://localhost:5173>.

---

## 8. Frontend: pantalla "Porcentaje de IVA"

Implementa la sección **03 · Porcentaje de IVA** del diseño de Figma (archivo *Hospitua M3*, página *Módulo 3 · Pantallas*). Vive en [frontend/](../../../frontend/) (React + Vite + TypeScript); cómo ejecutarlo está en [frontend/README.md](../../../frontend/README.md).

### Lo que se agregó al backend

El diseño muestra el IVA vigente y el historial, pero la 001 solo tenía el `PUT`. Se agregó una consulta de solo lectura, sin tocar el puerto que usa 006:

| Archivo | Qué hace |
|---|---|
| [vat-rate-overview.ts](../../../src/domain/model/billing/vat-rate-overview.ts) | Modelo de lectura: vigente (o `null`) + historial |
| [get-vat-rate-overview.use-case.ts](../../../src/domain/ports/in/billing/get-vat-rate-overview.use-case.ts) · [vat-rate-overview.query.port.ts](../../../src/domain/ports/out/billing/vat-rate-overview.query.port.ts) | Puertos de entrada y de salida |
| [get-vat-rate-overview.service.ts](../../../src/application/services/billing/get-vat-rate-overview.service.ts) | Caso de uso; historial de hasta 100 entradas |
| [prisma-vat-rate-overview.query.ts](../../../src/infrastructure/adapters/out/persistence/repositories/billing/prisma-vat-rate-overview.query.ts) | Las dos consultas en una transacción `REPEATABLE READ`, con el `username` de `app_user` |
| [vat-rate-admin.controller.ts](../../../src/infrastructure/adapters/in/http/billing/vat-rate-admin.controller.ts) · [vat-rate-overview.dto.ts](../../../src/infrastructure/adapters/in/http/billing/dto/vat-rate-overview.dto.ts) | `GET /admin/vat-rate`, solo Administrador |

Pruebas: [get-vat-rate-overview.service.spec.ts](../../../test/unit/application/billing/get-vat-rate-overview.service.spec.ts) (3), el bloque `GET` de [vat-rate.e2e-spec.ts](../../../test/e2e/billing/vat-rate.e2e-spec.ts) (3) y el bloque `PrismaVatRateOverviewQuery` de [prisma-vat-rate.repository.spec.ts](../../../test/integration/persistence/billing/prisma-vat-rate.repository.spec.ts) (4, PostgreSQL real).

### Estados del diseño

| Estado de Figma | Dónde se cumple |
|---|---|
| 1. Porcentaje guardado | Aviso verde con el nuevo valor, quién, cuándo y el anterior; la tarjeta y el historial se recargan |
| 2. Porcentaje inválido | Validación en el navegador con las mismas reglas del backend ([vatInput.ts](../../../frontend/src/lib/vatInput.ts)); si el backend igual responde `INVALID_VAT_RATE`, el mismo mensaje |
| 3, 4 y 10. Facturas antes, después y durante el cambio | Los garantiza el backend (006 guarda el IVA en cada factura); se verán en la pantalla de facturas (008), no en esta |
| 5. Dos administradores a la vez | Antes de guardar se vuelve a leer el vigente; si cambió desde que se cargó la pantalla, modal "El IVA cambió mientras editabas" con **Recargar** |
| 6. Mismo valor | Aviso gris "19 % ya es el vigente"; no se envía |
| 7. No se pudo registrar quién | Si el `PUT` falla (422), aviso rojo "No se guardó el cambio" y el vigente no cambia |
| 8. Sin IVA configurado | `current: null` → aviso rojo "Configura un porcentaje de IVA" y la tarjeta en "—" |
| 9. Usuario sin permiso | `403` → aviso rojo con el rol del usuario |

### Diferencias con el diseño

- **"Ana Ríos" → nombre de usuario**: `app_user` no guarda nombres completos, solo `username`.
- **"mayor a 30 %" → "mayor a 100 %"**: el estado 2 del diseño dice 30 %, pero la spec y el backend permiten de 0 a 100. Se siguió la spec; conviene corregir el texto en Figma.
- **Estado 5 sin bloqueo optimista en el backend**: la comprobación la hace el frontend justo antes del `PUT`. Si dos Administradores guardan en el mismo instante, el backend sigue garantizando un único vigente consistente (FR-007), pero el segundo no verá el modal.
- **Pantalla de login y "Cerrar sesión"**: no están en Figma; se hicieron con los mismos tokens visuales.
