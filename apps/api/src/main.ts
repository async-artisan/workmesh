import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173' });
  // 仅信任显式配置的反代代理链；未配置时 request.ip 就是直连地址，不会误信 X-Forwarded-For。
  const trustedProxies = (process.env.TRUSTED_PROXY_IPS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (trustedProxies.length > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustedProxies);
  }
  const buckets = new Map<string, { started: number; count: number }>();
  app.use(
    (
      request: { ip?: string },
      response: {
        setHeader: (name: string, value: string) => void;
        status: (code: number) => { json: (body: unknown) => void };
      },
      next: () => void,
    ) => {
      const now = Date.now();
      const key = request.ip ?? 'unknown';
      const current = buckets.get(key);
      const bucket =
        !current || now - current.started >= 60_000 ? { started: now, count: 0 } : current;
      bucket.count += 1;
      buckets.set(key, bucket);
      response.setHeader('X-RateLimit-Limit', process.env.RATE_LIMIT_MAX ?? '120');
      response.setHeader(
        'X-RateLimit-Remaining',
        String(Math.max(0, Number(process.env.RATE_LIMIT_MAX ?? 120) - bucket.count)),
      );
      if (bucket.count > Number(process.env.RATE_LIMIT_MAX ?? 120)) {
        response.status(429).json({ message: '请求过于频繁' });
        return;
      }
      next();
    },
  );
  app.use(
    (
      request: { method: string; path: string },
      response: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      next();
    },
  );
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const swagger = new DocumentBuilder().setTitle('WorkMesh API').setVersion('1.0').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
