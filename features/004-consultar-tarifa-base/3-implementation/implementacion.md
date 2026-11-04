# Implementación: Consultar tarifa base (004)

**Spec**: [consultar_tarifa_base.md](../1-functional/consultar_tarifa_base.md)  
**Plan**: [plan.md](../2-technical/plan.md)  
**Contrato**: [CLIENT-get-base-rate.md](../2-technical/contracts/CLIENT-get-base-rate.md)

La feature expone un puerto interno para que la 005 consulte una fecha. No guarda ni cachea la tarifa. Cada llamada produce una petición independiente a Módulo 1.

## Archivos por capa

### Dominio

| Archivo | Responsabilidad |
| --- | --- |
| `src/domain/model/shared/money.vo.ts` | Importe decimal genérico, recibido como texto y representado con `decimal.js` a escala 2. |
| `src/domain/model/pricing/base-rate.ts` | Tarifa base COP; valida el formato decimal en texto y un máximo de 2 decimales significativos, además de exigir un importe estrictamente positivo. Exporta el formato decimal y la función de precisión que reutiliza el cliente HTTP. |
| `src/domain/errors/pricing/invalid-base-rate-query.error.ts` | Rechaza UUID o fecha inválidos antes de llamar al adaptador. |
| `src/domain/errors/pricing/room-not-found.error.ts` | Habitación ausente en Módulo 1. |
| `src/domain/errors/pricing/invalid-base-rate.error.ts` | Importe decimal no positivo. |
| `src/domain/errors/pricing/malformed-base-rate-response.error.ts` | Respuesta exitosa de Módulo 1 inválida. |
| `src/domain/errors/pricing/module1-unavailable.error.ts` | Timeout, error HTTP/red o circuito abierto. |
| `src/domain/ports/in/pricing/get-base-rate.use-case.ts` | Puerto interno exportado para consumidores como la feature 005. |
| `src/domain/ports/out/pricing/base-rate.client.port.ts` | Puerto de salida del cliente de Módulo 1. |

### Aplicación

| Archivo | Responsabilidad |
| --- | --- |
| `src/application/services/pricing/get-base-rate.service.ts` | Valida `roomId` y fecha y delega cada consulta sin mantener estado o caché. |

### Infraestructura

| Archivo | Responsabilidad |
| --- | --- |
| `src/infrastructure/adapters/out/http/module1-base-rate.client.ts` | Axios, interpretación de contrato y circuit breaker Opossum. Solo infraestructura HTTP contiene estas dependencias. Configuración obligatoria, timeout de 500 ms, cinco fallos consecutivos y reset de 30 s. |
| `src/infrastructure/config/pricing.module.ts` | Registra el adaptador y construye el servicio por `useFactory`; conserva las exportaciones existentes y añade `GET_BASE_RATE_USE_CASE`. |
| `.env.example` | Documenta `MODULE1_BASE_URL` y `MODULE1_TIMEOUT_MS=500`. |
| `package.json`, `package-lock.json` | Versiones fijadas de `@nestjs/axios`, `axios`, `opossum` y `@types/opossum`. |

## Pruebas automáticas

| Archivo | Cobertura |
| --- | --- |
| `test/unit/domain/pricing/base-rate.spec.ts` | Importe positivo, escala 2, ceros finales, rechazo de tarifa no positiva, mal formada o que no sea texto. |
| `test/unit/domain/shared/money.vo.spec.ts` | Redondeo a escala 2 y rechazo de entrada inválida. |
| `test/unit/application/pricing/get-base-rate.service.spec.ts` | Resultado, consultas independientes por fecha, validación previa al puerto con `errorCode`, UUID en mayúsculas y 29 de febrero. |
| `test/integration/http/module1-base-rate.client.spec.ts` | Servidor HTTP simulado: éxito, errores 4xx/5xx (incluido 403 con `ROOM_NOT_FOUND`), timeout, corte de conexión (`ECONNRESET`), circuito, campos extra, half-open con timers falsos (incluida la sonda con `ROOM_NOT_FOUND`) y validación de configuración al arrancar. |
| `test/contract/pricing/module1-base-rate.contract.spec.ts` | Clasificación del cuerpo de éxito, `ROOM_NOT_FOUND`, `INVALID_BASE_RATE` y `MODULE1_UNAVAILABLE`. |
| `test/e2e/pricing/base-rate.e2e-spec.ts` | Puerto interno `GetBaseRateUseCase` hasta el cliente HTTP real, con un servidor local en lugar de Módulo 1: éxito, entrada inválida sin llamada a Módulo 1, sin reutilización de tarifa, `ROOM_NOT_FOUND` y `MODULE1_UNAVAILABLE`. |
| `test/support/pricing/module1-http-fixture.ts` | Servidor HTTP local configurable para las pruebas; expone `requestLog` con las peticiones recibidas. |

No se consulta la tarifa base durante liquidación; esa operación consume el valor guardado por la cotización (BR-004).

El mapeo de `INVALID_QUERY_PARAMS`, `ROOM_NOT_FOUND`, `INVALID_BASE_RATE` y `MODULE1_UNAVAILABLE` al `ExceptionFilter` queda a cargo de la 005 (T014 y T022).
