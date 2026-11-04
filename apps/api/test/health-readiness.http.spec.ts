import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppController } from '../src/app.controller';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { MetricsService } from '../src/common/metrics.service';
import { ReadinessService } from '../src/common/readiness.service';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { StrictJsonInterceptor } from '../src/common/strict-json.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

type PrismaBehaviour = {
  connectivity?: () => Promise<unknown>;
  migrations?: () => Promise<unknown>;
};

/** 进程内 HTTP 契约：锁死 liveness/readiness 的分工与 503 的错误 envelope。 */
async function createServer(behaviour: PrismaBehaviour) {
  let call = 0;
  const $queryRaw = async () => {
    call += 1;
    if (call === 1) return behaviour.connectivity ? await behaviour.connectivity() : [{ ok: 1 }];
    return behaviour.migrations ? await behaviour.migrations() : [{ applied: 12 }];
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [AppController],
    providers: [
      ReadinessService,
      { provide: PrismaService, useValue: { $queryRaw } },
      { provide: MetricsService, useValue: { snapshot: () => ({ requests: 0 }) } },
    ],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor(), new StrictJsonInterceptor());
  app.use(
    (
      req: { requestId?: string },
      res: { setHeader: (n: string, v: string) => void },
      next: () => void,
    ) => {
      const id = randomUUID();
      req.requestId = id;
      res.setHeader('X-Request-Id', id);
      next();
    },
  );
  await app.init();
  return { app, queryCount: () => call };
}

describe('health endpoints over HTTP', () => {
  let closers: Array<{ close: () => Promise<void> }> = [];

  beforeAll(() => {
    closers = [];
  });

  afterAll(async () => {
    for (const app of closers) await app.close();
  });

  it('keeps liveness independent of the database', async () => {
    const { app, queryCount } = await createServer({
      connectivity: () => Promise.reject(new Error('database is down')),
    });
    closers.push(app as unknown as { close: () => Promise<void> });

    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(response.body.data).toEqual({ status: 'ok' });
    expect(typeof response.body.meta.requestId).toBe('string');
    // liveness 绝不能碰数据库：否则数据库抖动会连带把进程判死。
    expect(queryCount()).toBe(0);
  });

  it('reports readiness with the applied migration count', async () => {
    const { app } = await createServer({ migrations: () => Promise.resolve([{ applied: 12 }]) });
    closers.push(app as unknown as { close: () => Promise<void> });

    const response = await request(app.getHttpServer()).get('/api/health/ready').expect(200);

    expect(response.body.data).toMatchObject({
      ok: true,
      database: { reachable: true, appliedMigrations: 12 },
    });
  });

  it('returns 503 DEPENDENCY_UNAVAILABLE in the standard error envelope', async () => {
    const { app } = await createServer({
      connectivity: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
    });
    closers.push(app as unknown as { close: () => Promise<void> });

    const response = await request(app.getHttpServer()).get('/api/health/ready').expect(503);

    expect(response.body.error).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      message: '数据库尚未就绪',
      details: { dependency: 'postgresql', reason: 'CONNECT_FAILED' },
    });
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    // 未认证端点不得回显连接串/主机名。
    expect(JSON.stringify(response.body)).not.toContain('ECONNREFUSED');
  });

  it('returns 503 when the database is reachable but not migrated', async () => {
    const { app } = await createServer({
      migrations: () => Promise.reject(new Error('relation "_prisma_migrations" does not exist')),
    });
    closers.push(app as unknown as { close: () => Promise<void> });

    const response = await request(app.getHttpServer()).get('/api/health/ready').expect(503);

    expect(response.body.error.details.reason).toBe('SCHEMA_NOT_MIGRATED');
  });
});
