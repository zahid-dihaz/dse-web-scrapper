// Set before any other import runs, so every Date created anywhere in the
// app (Mongoose's automatic createdAt/updatedAt included) is anchored to
// Bangladesh time regardless of the host server's local timezone.
process.env.TZ = 'Asia/Dhaka';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(Number(process.env.PORT) || 4000);
}
bootstrap();
