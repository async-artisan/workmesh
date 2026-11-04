import { randomUUID } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { V1AuthGuard, type V1Request } from '../src/auth/v1-auth.guard';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { StrictJsonInterceptor } from '../src/common/strict-json.interceptor';
import { V1ReadyController } from '../src/tasks/v1-ready.controller';
import { V1ReadyService } from '../src/tasks/v1-ready.service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

/** 认证本身由单元覆盖；这里只验证条件请求的路由行为。 */
@Injectable()
class PrincipalGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<V1Request>();
    req.v1Principal = {
      kind: 'AGENT',
      agentCredentialId: 'cred-1',
      scopes: [],
    } as unknown as V1Request['v1Principal'];
    return true;
  }
}

type Page = { items: Array<{ id: string; version: number }>; nextCursor: string | null };

const firstPage: Page = { items: [{ id: 'task-a', version: 3 }], nextCursor: null };
const secondPage: Page = {
  items: [
    { id: 'task-a', version: 3 },
    { id: 'task-b', version: 1 },
  ],
  nextCursor: 'cursor-1',
};

async function createServer(pages: Page[]) {
  let calls = 0;
  const ready = {
    ready: async () => {
      const page = pages[Math.min(calls, pages.length - 1)];
      calls += 1;
      return page;
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [V1ReadyController],
    providers: [
      { provide: V1ReadyService, useValue: ready },
      { provide: V1AuthGuard, useValue: new PrincipalGuard() },
    ],
  })
    .overrideGuard(V1AuthGuard)
    .useValue(new PrincipalGuard())
    .compile();

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
  return { app, callCount: () => calls };
}

const closers: Array<{ close: () => Promise<void> }> = [];
afterAll(async () => {
  for (const app of closers) await app.close();
});

async function server(pages: Page[] = [firstPage]) {
  const created = await createServer(pages);
  closers.push(created.app as unknown as { close: () => Promise<void> });
  return created;
}

describe('ready endpoint conditional requests', () => {
  it('returns a weak ETag and a revalidate-only cache directive', async () => {
    const { app } = await server();
    const response = await request(app.getHttpServer())
      .get(`/api/v1/projects/${PROJECT_ID}/tasks/ready`)
      .expect(200);

    expect(response.headers.etag).toMatch(/^W\/"[A-Za-z0-9_-]{27}"$/);
    expect(response.headers['cache-control']).toBe('private, no-cache');
    expect(response.body.data).toEqual(firstPage);
  });

  it('answers 304 with no body when If-None-Match matches', async () => {
    const { app } = await server();
    const first = await request(app.getHttpServer())
      .get(`/api/v1/projects/${PROJECT_ID}/tasks/ready`)
      .expect(200);
    const etag = first.headers.etag as string;

    const revalidated = await request(app.getHttpServer())
      .get(`/api/v1/projects/${PROJECT_ID}/tasks/ready`)
      .set('If-None-Match', etag)
      .expect(304);

    expect(revalidated.text).toBeFalsy();
    expect(revalidated.headers.etag).toBe(etag);
    // requestId 仍要下发，便于把 304 与日志对上。
    expect(typeof revalidated.headers['x-request-id']).toBe('string');
  });

  it('answers 304 for the wildcard form', async () => {
    const { app } = await server();
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${PROJECT_ID}/tasks/ready`)
      .set('If-None-Match', '*')
      .expect(304);
  });

  it('returns a fresh body when the validator does not match', async () => {
    const { app } = await server();
    const response = await request(app.getHttpServer())
      .get(`/api/v1/projects/${PROJECT_ID}/tasks/ready`)
      .set('If-None-Match', 'W/"obviously-stale-validator"')
      .expect(200);
    expect(response.body.data).toEqual(firstPage);
  });

  it('changes the validator when the ready set changes', async () => {
    const { app } = await server([firstPage, secondPage]);
    const base = `/api/v1/projects/${PROJECT_ID}/tasks/ready`;

    const one = await request(app.getHttpServer()).get(base).expect(200);
    const two = await request(app.getHttpServer()).get(base).expect(200);

    expect(two.headers.etag).not.toBe(one.headers.etag);
    // 用旧验证器回源必须拿到新内容，而不是错误的 304。
    const revalidated = await request(app.getHttpServer())
      .get(base)
      .set('If-None-Match', one.headers.etag as string)
      .expect(200);
    expect(revalidated.body.data).toEqual(secondPage);
  });

  it('keeps validation independent of the per-request envelope', async () => {
    const { app } = await server();
    const base = `/api/v1/projects/${PROJECT_ID}/tasks/ready`;
    // 两次响应体相同但 requestId 不同：ETag 必须相同，否则 304 永远命中不了。
    const one = await request(app.getHttpServer()).get(base).expect(200);
    const two = await request(app.getHttpServer()).get(base).expect(200);
    expect(one.body.meta.requestId).not.toBe(two.body.meta.requestId);
    expect(two.headers.etag).toBe(one.headers.etag);
  });
});
