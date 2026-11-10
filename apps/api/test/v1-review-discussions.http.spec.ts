import { randomUUID } from 'node:crypto';
import { ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { V1AuthGuard, type V1Request } from '../src/auth/v1-auth.guard';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { StrictJsonInterceptor } from '../src/common/strict-json.interceptor';
import { V1ReviewDiscussionController } from '../src/reviews/v1-review-discussion.controller';
import { V1ReviewDiscussionService } from '../src/reviews/v1-review-discussion.service';

const reviewId = randomUUID();
const discussionId = randomUUID();
const principal: V1Request['v1Principal'] = {
  kind: 'HUMAN',
  userId: randomUUID(),
  sessionId: randomUUID(),
  scopes: [],
};
const base = `/api/v1/review-requests/${reviewId}/discussions`;

describe('review discussion HTTP contract', () => {
  let app: INestApplication;
  const discussions = {
    list: vi.fn(async () => ({ items: [], nextCursor: null, unresolvedCount: 0, canCreate: true })),
    entries: vi.fn(async () => ({ items: [], nextCursor: null })),
    mutate: vi.fn(async () => ({ discussionId, entryId: null, version: 1, replayed: false })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V1ReviewDiscussionController],
      providers: [{ provide: V1ReviewDiscussionService, useValue: discussions }],
    })
      .overrideGuard(V1AuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<V1Request>().v1Principal = principal;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(), new StrictJsonInterceptor());
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes paginated reads and rejects invalid IDs, unknown query fields and oversized cursors', async () => {
    const response = await request(app.getHttpServer())
      .get(`${base}?cursor=opaque-cursor`)
      .expect(200);
    expect(response.body.data.unresolvedCount).toBe(0);
    expect(discussions.list).toHaveBeenCalledWith(principal, reviewId, 'opaque-cursor');
    await request(app.getHttpServer())
      .get(`${base}/${discussionId}/entries?cursor=entry-cursor`)
      .expect(200);
    expect(discussions.entries).toHaveBeenCalledWith(
      principal,
      reviewId,
      discussionId,
      'entry-cursor',
    );
    await request(app.getHttpServer())
      .get('/api/v1/review-requests/invalid/discussions')
      .expect(400);
    await request(app.getHttpServer()).get(`${base}/invalid/entries`).expect(400);
    await request(app.getHttpServer()).get(`${base}?unexpected=true`).expect(400);
    await request(app.getHttpServer())
      .get(`${base}?cursor=${'x'.repeat(1001)}`)
      .expect(400);
    expect(discussions.list).toHaveBeenCalledTimes(1);
    expect(discussions.entries).toHaveBeenCalledTimes(1);
  });

  it('requires a UUID idempotency key and bounded issue text before calling the mutation service', async () => {
    const input = { title: '失败场景', body: '请补充证据' };
    await request(app.getHttpServer()).post(base).send(input).expect(400);
    await request(app.getHttpServer())
      .post(base)
      .set('Idempotency-Key', 'invalid')
      .send(input)
      .expect(400);
    for (const invalid of [
      { ...input, title: '' },
      { ...input, title: 'x'.repeat(201) },
      { ...input, body: 'x'.repeat(10001) },
      { ...input, resolved: true },
    ]) {
      await request(app.getHttpServer())
        .post(base)
        .set('Idempotency-Key', randomUUID())
        .send(invalid)
        .expect(400);
    }
    expect(discussions.mutate).not.toHaveBeenCalled();
    const key = randomUUID();
    await request(app.getHttpServer())
      .post(base)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    expect(discussions.mutate).toHaveBeenCalledWith(
      principal,
      reviewId,
      { kind: 'CREATE', ...input },
      expect.objectContaining({
        idempotencyKey: key,
        method: 'POST',
        route: base,
        now: expect.any(Date),
      }),
    );
  });

  it('validates append-only action kinds, expected versions and actual-delivery UUIDs', async () => {
    const route = `${base}/${discussionId}/entries`;
    const input = {
      kind: 'REPLY',
      expectedVersion: 2,
      body: '新交付已补充',
      addressedInReviewId: randomUUID(),
    };
    for (const invalid of [
      { ...input, kind: 'APPROVE' },
      { ...input, expectedVersion: 0 },
      { ...input, expectedVersion: 1.5 },
      { ...input, expectedVersion: '2' },
      { ...input, addressedInReviewId: 'not-a-review' },
      { ...input, body: '' },
    ]) {
      await request(app.getHttpServer())
        .post(route)
        .set('Idempotency-Key', randomUUID())
        .send(invalid)
        .expect(400);
    }
    expect(discussions.mutate).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post(route)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(201);
    expect(discussions.mutate).toHaveBeenCalledWith(
      principal,
      reviewId,
      { ...input, discussionId },
      expect.objectContaining({ route }),
    );
  });
});
