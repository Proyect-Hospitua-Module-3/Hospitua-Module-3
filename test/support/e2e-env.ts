// Feature 004 · Consultar tarifa base
// AppModule exige MODULE1_* al arrancar: valores por defecto para no depender del .env local.
process.env.MODULE1_BASE_URL ||= 'http://localhost:3001';
process.env.MODULE1_TIMEOUT_MS ||= '500';
// Feature 007 · Generar liquidación: lo mismo para MODULE2_*.
process.env.MODULE2_BASE_URL ||= 'http://localhost:3002';
process.env.MODULE2_TIMEOUT_MS ||= '500';
// Feature 010 · Registrar Check-out: las E2E nunca consumen la cola real de un broker local
// aunque el .env tenga RABBITMQ_URL (un valor vacío desactiva el consumer).
process.env.RABBITMQ_URL = '';
