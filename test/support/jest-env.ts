// Feature 010 · Registrar Check-out
// Setup de `npm test` (registrado en `jest.setupFiles` de package.json), como e2e-env.ts en las
// E2E: las pruebas que levantan AppModule (contratos de 005) nunca arrancan el consumer de
// modulo3.checkout, aunque el .env tenga RABBITMQ_URL. Si lo arrancaran, consumirían los
// mensajes que publica en paralelo la suite de mensajería de 010 y fallarían al cerrar el canal.
// Un valor vacío desactiva el consumer; ConfigModule no lo reemplaza con el del .env.
// Las suites que necesitan RabbitMQ usan TEST_RABBITMQ_URL, que no se toca.
process.env.RABBITMQ_URL = '';
