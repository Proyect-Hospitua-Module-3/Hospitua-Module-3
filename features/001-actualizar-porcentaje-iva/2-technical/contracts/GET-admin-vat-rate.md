# Contrato REST administrativo: Consultar el porcentaje de IVA y su historial

**Feature**: 001 Actualizar porcentaje de IVA — pantalla "Porcentaje de IVA" del frontend
**Spec**: [actualizar_porcentaje_iva.md](../../1-functional/actualizar_porcentaje_iva.md)
**Plan**: [plan.md](../plan.md)
**Proyecto base**: [plan-tecnico-base.md](../../../../docs/plan-tecnico-base.md)
**Estado**: Operación de **solo lectura**; agregada con el frontend de la 001

**Etiquetas de origen**:
- `[SPEC]`: Definido en la especificación funcional de la feature (`actualizar_porcentaje_iva.md`).
- `[PLAN]`: Decisión técnica del plan de esta feature.
- `[BASE]`: Definido en la plataforma compartida (`docs/plan-tecnico-base.md`).
- `[UI]`: Lo pide el diseño de la pantalla en Figma (sección "03 · Porcentaje de IVA").
- `[CONV]`: Convención técnica adoptada para este contrato.

---

## 1. Propósito

La pantalla del **Administrador** muestra el porcentaje de IVA vigente (quién lo registró y desde cuándo) y el historial de cambios [UI]. Son las dos entidades de la spec: "Porcentaje de IVA vigente" (FR-003) e "Historial de actualización de IVA" (FR-005) [SPEC].

- **No reemplaza** el puerto interno que usa 006 ([`PORT-get-current-vat-rate.md`](../../../006-generar-factura-final/2-technical/contracts/PORT-get-current-vat-rate.md)): ese falla si no hay porcentaje; esta consulta no [PLAN].
- **Sin porcentaje registrado** responde `200` con `current: null`, para que la pantalla pida configurarlo (FR-003, estado 8 del diseño) [SPEC] [UI].
- No modifica nada.

---

## 2. Petición

`GET /admin/vat-rate` [CONV]

Requiere un JWT válido con `role = Administrador` (el mismo Guard que el `PUT`) [SPEC FR-006, BR-001] [BASE]. No tiene parámetros ni cuerpo.

```http
GET /admin/vat-rate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Accept: application/json
```

---

## 3. Reglas de procesamiento

1. El vigente y el historial se leen en **una misma instantánea** (transacción `REPEATABLE READ`): aunque otro Administrador guarde a la vez, nunca se ve un vigente que no coincida con la última entrada del historial [SPEC FR-007, NFR-002] [PLAN].
2. El historial va del cambio **más reciente al más antiguo**, con **a lo sumo 100** entradas. Los cambios de IVA son pocos, así que cubre años de historia [CONV].
3. De cada cambio se devuelve el `username` del Administrador que lo hizo (de `app_user`). Si ese usuario ya no existe, el cambio aparece igual, con `null` [SPEC FR-005] [CONV].
4. Porcentajes como **texto decimal con 2 decimales**, igual que en el `PUT`; fechas en ISO 8601 (UTC), con la hora de la base de datos [SPEC NFR-001] [PLAN].

---

## 4. Respuesta exitosa: `200 OK`

| Campo | Tipo | Descripción |
|---|---|---|
| `current` | objeto \| `null` | El porcentaje vigente; `null` si nunca se registró uno |
| `current.value` | string decimal | Porcentaje vigente, p. ej. `"19.00"` |
| `current.updatedBy` | UUID | Administrador que lo registró (`sub` del token) |
| `current.updatedByUsername` | string \| `null` | Su nombre de usuario |
| `current.updatedAt` | datetime | Desde cuándo rige |
| `history[]` | lista | Cambios, del más reciente al más antiguo (hasta 100) |
| `history[].valueBefore` | string decimal \| `null` | Valor anterior; `null` en el primer registro |
| `history[].valueAfter` | string decimal | Valor nuevo |
| `history[].changedBy` | UUID | Administrador responsable |
| `history[].changedByUsername` | string \| `null` | Su nombre de usuario |
| `history[].changedAt` | datetime | Fecha y hora del cambio (la misma que `updatedAt` del vigente que dejó) |

```json
{
  "current": {
    "value": "19.00",
    "updatedBy": "f2d3b4a5-6c7d-4e8f-9012-3456789abcde",
    "updatedByUsername": "admin",
    "updatedAt": "2026-01-01T05:00:00.000Z"
  },
  "history": [
    {
      "valueBefore": "16.00",
      "valueAfter": "19.00",
      "changedBy": "f2d3b4a5-6c7d-4e8f-9012-3456789abcde",
      "changedByUsername": "admin",
      "changedAt": "2026-01-01T05:00:00.000Z"
    },
    {
      "valueBefore": null,
      "valueAfter": "16.00",
      "changedBy": "f2d3b4a5-6c7d-4e8f-9012-3456789abcde",
      "changedByUsername": "admin",
      "changedAt": "2024-07-15T14:30:00.000Z"
    }
  ]
}
```

Sin porcentaje registrado:

```json
{ "current": null, "history": [] }
```

---

## 5. Errores

| HTTP | `errorCode` | Cuándo |
|---|---|---|
| 401 | `UNAUTHENTICATED` | Sin token, o token inválido o vencido |
| 403 | `FORBIDDEN` | El rol no es Administrador (estado 9 del diseño) |
| 422 | `UNEXPECTED_ERROR` | Falla inesperada (por ejemplo, la base de datos no responde); nunca 5xx [BASE] |

Todos con el formato `ApiError` del plan base [BASE].
