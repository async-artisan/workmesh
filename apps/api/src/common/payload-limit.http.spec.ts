import { Body, Controller, Post, ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { V1_ERROR_CODES } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { HttpExceptionFilter } from './http-exception.filter';
import {
  MAX_DOCUMENT_BODY_BYTES,
  MAX_JSON_BODY_BYTES,
  PAYLOAD_TOO_LARGE_MESSAGE,
} from './strict-json.interceptor';
import { V1PublicationController } from '../knowledge/v1-publication.controller';
import { V1PublicationService } from '../knowledge/v1-publication.service';
import { V1RolePackageController } from '../workflows/v1-role-package.controller';
import { V1RolePackageService } from '../workflows/v1-role-package.service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const KB_ID = '22222222-2222-4222-8222-222222222222';
const TICKET_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';

@Controller()
class EchoController {
  @Post('echo')
  echo(@Body() body: Record<string, unknown>) {
    return { keys: Object.keys(body).length };
  }
}

/** 与 main.ts 相同顺序：先 useBodyParser 再 init，默认 body-parser 才会让位给这个更大的 limit。 */
async function createApp(controllers: unknown[], providers: unknown[]) {
  const moduleRef = await Test.createTestingModule({
    controllers: controllers as never[],
    providers: providers as never[],
  })
    .overrideGuard(V1AuthGuard)
    .useValue({
      canActivate: (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest<V1Request>();
        req.v1Principal = {
          kind: 'HUMAN',
          userId: 'user-1',
          sessionId: 'session-1',
          authVersion: 1,
          scopes: ['task:deliver'],
        } as never;
        return true;
      },
    })
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useBodyParser('json', { limit: MAX_JSON_BODY_BYTES });
  await app.init();
  return app;
}

describe('JSON body 上限（与 main.ts 同源 MAX_JSON_BODY_BYTES）', () => {
  let app: NestExpressApplication;
  let server: unknown;

  beforeAll(async () => {
    app = await createApp([EchoController], []);
    server = app.getHttpServer();
  });
  afterAll(async () => {
    await app.close();
  });

  it('200KB JSON 不再被 body-parser 以 413 拒绝（body 已被解析）', async () => {
    const payload = JSON.stringify({ pad: 'a'.repeat(200 * 1024) });
    expect(Buffer.byteLength(payload, 'utf8')).toBeGreaterThan(100 * 1024);
    expect(Buffer.byteLength(payload, 'utf8')).toBeLessThan(MAX_JSON_BODY_BYTES);
    const res = await request(server as never)
      .post('/api/echo')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ keys: 1 });
  });

  it('超过 16MiB 的 JSON → 413 + {error:{code:PAYLOAD_TOO_LARGE,message,requestId}} 信封', async () => {
    // 只多一点也走 content-length 判定；body-parser 在路由/拦截器之前就拒绝。
    const payload = JSON.stringify({ pad: 'a'.repeat(MAX_JSON_BODY_BYTES + 1) });
    const res = await request(server as never)
      .post('/api/echo')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(res.status, JSON.stringify(res.body)).toBe(413);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.error.code).toBe(V1_ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(res.body.error.message).toBe(PAYLOAD_TOO_LARGE_MESSAGE);
    expect(res.body.error.details).toEqual({ limitBytes: MAX_JSON_BODY_BYTES });
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });
});

describe('文档正文上限（三处解码点共用 MAX_DOCUMENT_BODY_BYTES）', () => {
  let app: NestExpressApplication;
  let server: unknown;
  const publicationService = {
    createDocument: vi.fn(async () => ({ id: 'document-1', version: 1 })),
    proposeRevision: vi.fn(async () => ({ id: 'revision-1', version: 1 })),
  };
  const rolePackageService = {
    register: vi.fn(async () => ({ id: 'package-1', version: 1 })),
  };

  beforeAll(async () => {
    app = await createApp(
      [V1PublicationController, V1RolePackageController],
      [
        { provide: V1PublicationService, useValue: publicationService },
        { provide: V1RolePackageService, useValue: rolePackageService },
      ],
    );
    server = app.getHttpServer();
  });
  afterAll(async () => {
    await app.close();
  });

  function oversizeBase64() {
    return Buffer.alloc(MAX_DOCUMENT_BODY_BYTES + 1, 0x61).toString('base64');
  }

  it('PRD 候选 bodyBase64 解码后超过 10MiB → 413 PAYLOAD_TOO_LARGE（HTTP 层 16MiB 允许该 JSON 通过）', async () => {
    const res = await request(server as never)
      .post(`/api/v1/projects/${PROJECT_ID}/documents`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({
        knowledgeBaseId: KB_ID,
        kind: 'PRD',
        title: 'oversize',
        mimeType: 'text/plain',
        bodyBase64: oversizeBase64(),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(413);
    expect(res.body.error.code).toBe(V1_ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(res.body.error.details.limitBytes).toBe(MAX_DOCUMENT_BODY_BYTES);
    expect(res.body.error.details.field).toBe('bodyBase64');
    expect(publicationService.createDocument).not.toHaveBeenCalled();
  });

  it('未超限的 PRD 候选正文照常进入服务层', async () => {
    publicationService.createDocument.mockClear();
    const res = await request(server as never)
      .post(`/api/v1/projects/${PROJECT_ID}/documents`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({
        knowledgeBaseId: KB_ID,
        kind: 'PRD',
        title: 'small',
        mimeType: 'text/plain',
        bodyBase64: Buffer.from('hello', 'utf8').toString('base64'),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(publicationService.createDocument).toHaveBeenCalledTimes(1);
  });

  it('角色包资源 bodyBase64 解码后超过 10MiB → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(server as never)
      .post(`/api/v1/projects/${PROJECT_ID}/role-packages`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({
        expectedVersion: 1,
        manifest: {},
        resources: [{ resourceId: 'resource-1', bodyBase64: oversizeBase64() }],
        confirmation: { ticketId: TICKET_ID, ticketSecret: 'secret' },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(413);
    expect(res.body.error.code).toBe(V1_ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(res.body.error.details.field).toBe('bodyBase64');
    expect(rolePackageService.register).not.toHaveBeenCalled();
  });
});
