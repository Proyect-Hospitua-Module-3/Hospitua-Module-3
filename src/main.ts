import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const openApi = new DocumentBuilder()
    .setTitle('HOSPITUA - Módulo 3')
    .setDescription('Facturación, Consumos y Liquidación')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openApi));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Módulo 3 escuchando en http://localhost:${port} (Swagger en /docs)`);
}

void bootstrap();
