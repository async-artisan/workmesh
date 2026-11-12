import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES } from '@workmesh/shared';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { assertCookieDeployment, resolveCookieMode } from './auth/v1-cookie-policy';
import { createRateLimitBackend } from './common/rate-limit';
import { MAX_JSON_BODY_BYTES } from './common/strict-json.interceptor';

let bootstrapApp: NestExpressApplication | undefined;

async function bootstrap() {
  assertCookieDeployment(
    resolveCookieMode(process.env.WORKMESH_COOKIE_MODE),
    process.env.WORKMESH_PUBLIC_ORIGIN ?? 'http://127.0.0.1:5173',
  );
  const rateLimit = Number(process.env.RATE_LIMIT_MAX ?? 120);
  const { backend: rateLimitBackend, cleanup: rateLimitCleanup } = await createRateLimitBackend(
    process.env,
  );
  if (process.env.REDIS_URL) {
    new Logger('Bootstrap').log(
      `Rate limiting backed by Redis: ${process.env.REDIS_URL.replace(/:[^:@]+@/, ':***@')}`,
    );
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  bootstrapApp = app;
  // Let Nest drain the HTTP server and invoke OnModuleDestroy hooks (Prisma,
  // retention timers, and future background workers) on SIGTERM/SIGINT.  This
  // is required for container rolling updates: readiness can be removed from
  // service, in-flight requests can finish, and database connections close
  // before the process exits.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
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
  app.use(
    async (
      request: { ip?: string },
      response: {
        setHeader: (name: string, value: string) => void;
        status: (code: number) => { json: (body: unknown) => void };
      },
      next: () => void,
    ) => {
      const key = request.ip ?? 'unknown';
      const result = await rateLimitBackend.take(key);
      response.setHeader('X-RateLimit-Limit', String(rateLimit));
      response.setHeader('X-RateLimit-Remaining', String(result.remaining));
      if (!result.allowed) {
        // The limiter runs before Nest request-context middleware and exception
        // filters, so construct the same v1 envelope and request ID here.
        const requestId = randomUUID();
        response.setHeader('Retry-After', String(result.retryAfter));
        response.setHeader('X-Request-Id', requestId);
        response.setHeader('Cache-Control', 'no-store');
        response.status(429).json({
          error: {
            code: V1_ERROR_CODES.RATE_LIMITED,
            message: '请求过于频繁',
            details: { retryAfterSeconds: result.retryAfter },
            requestId,
          },
        });
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
  // 05 §1：显式设置 JSON body 解析上限。Nest 11 的 getBodyParserOptions 只挂 rawBody verify、
  // 不设 limit，body-parser 默认 100kb 会让 CLI deliver 的 HOSTED base64（原始文件超过 ~75KB）
  // 在拦截器之前以 413 拒绝。这里与 StrictJsonInterceptor 共用 MAX_JSON_BODY_BYTES，不另写字面量。
  // 注册顺序在限流与安全响应头之后：先做廉价拒绝，再读大 body。
  app.useBodyParser('json', { limit: MAX_JSON_BODY_BYTES });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  const swagger = new DocumentBuilder().setTitle('WorkMesh API').setVersion('1.0').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));
  await app.listen(process.env.PORT ?? 3000);
  // Drain the Redis rate limit connection when the app shuts down so the
  // process can exit cleanly during rolling updates.
  const cleanup = rateLimitCleanup;
  process.once('SIGTERM', () => void cleanup());
  process.once('SIGINT', () => void cleanup());
}

void bootstrap().catch(async (error: unknown) => {
  const logger = new Logger('Bootstrap');
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  // Keep startup failures machine-readable while avoiding environment values
  // or connection strings in the log payload.
  logger.error(JSON.stringify({ event: 'api_bootstrap_failed', message }), stack);
  try {
    await bootstrapApp?.close();
  } catch (closeError: unknown) {
    const closeMessage = closeError instanceof Error ? closeError.message : String(closeError);
    const closeStack = closeError instanceof Error ? closeError.stack : undefined;
    logger.error(
      JSON.stringify({ event: 'api_bootstrap_close_failed', message: closeMessage }),
      closeStack,
    );
  }
  process.exitCode = 1;
});
