// Feature 004 · Consultar tarifa base
// AppModule exige MODULE1_* al arrancar: valores por defecto para no depender del .env local.
process.env.MODULE1_BASE_URL ||= 'http://localhost:3001';
process.env.MODULE1_TIMEOUT_MS ||= '500';
