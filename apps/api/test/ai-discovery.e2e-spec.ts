import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe('ReqFlow API integration', () => {
  let app: INestApplication;
  let accessToken = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
    process.env.GIT_WEBHOOK_SECRET = randomBytes(32).toString('hex');
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const [{ AppModule }, { AiService }] = await Promise.all([
      import('../dist/app.module.js'),
      import('../dist/ai/ai.service.js'),
    ]);
    const testProvider = {
      complete: vi.fn(async (messages: Array<{ role: string; content: string }>) =>
        messages.some((message) => message.content.includes('PRODUCT_DISCOVERY'))
          ? JSON.stringify({ reply: '已整理当前步骤。', draftPatch: {} })
          : '# 测试 PRD\n\n固定测试 provider 输出。',
      ),
      embedding: vi.fn(async () => [1, ...Array(63).fill(0)]),
      embeddings: vi.fn(async (texts: string[]) => texts.map(() => [1, ...Array(63).fill(0)])),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiService)
      .useValue(testProvider)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers, logs in, creates a project, and discovers a requirement', async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `integration-${suffix}@example.test`;
    const password = 'Password1!';
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, name: 'Integration User' })
      .expect(201);
    accessToken = registered.body.data.accessToken;
    expect(accessToken).toEqual(expect.any(String));

    const loggedIn = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(201);
    expect(loggedIn.body.data.refreshToken).toEqual(expect.any(String));

    const project = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Integration project', key: `IT${suffix.toUpperCase()}` })
      .expect(201);
    const projectId = project.body.data.id as string;

    const createdRun = await request(app.getHttpServer())
      .post('/api/ai/runs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ projectId })
      .expect(201);
    const runId = createdRun.body.data.run.id as string;
    expect(createdRun.body.data.messages.length).toBeGreaterThan(0);

    const answers = [
      '减少订单处理中的人工重复录入。',
      '运营人员在创建和审核订单时使用。',
      '用户填写订单、提交审核并查看处理结果。',
      '订单字段完整、审核状态可追踪且错误有明确提示。',
    ];
    for (const content of answers) {
      await request(app.getHttpServer())
        .post(`/api/ai/runs/${runId}/messages`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ content })
        .expect(201);
    }

    const run = await request(app.getHttpServer())
      .get(`/api/ai/runs/${runId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(run.body.data.run.status).toBe('WAITING_CONFIRMATION');
    expect(run.body.data.messages.length).toBeGreaterThan(4);

    const draft = {
      backgroundGoal: '减少订单处理中的人工重复录入。',
      usersScenarios: ['运营人员在创建和审核订单时使用。'],
      userStoriesFlows: ['用户填写订单、提交审核并查看处理结果。'],
      acceptanceCriteria: ['订单字段完整、审核状态可追踪且错误有明确提示。'],
    };
    const confirmed = await request(app.getHttpServer())
      .post(`/api/ai/runs/${runId}/confirm`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '订单处理自动化', priority: 'HIGH', draft })
      .expect(201);
    expect(confirmed.body.data.title).toBe('订单处理自动化');

    const repeated = await request(app.getHttpServer())
      .post(`/api/ai/runs/${runId}/confirm`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '订单处理自动化', priority: 'HIGH', draft })
      .expect(201);
    expect(repeated.body.data.id).toBe(confirmed.body.data.id);

    const completed = await request(app.getHttpServer())
      .get(`/api/ai/runs/${runId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(completed.body.data.run.status).toBe('COMPLETED');
    expect(completed.body.data.requirement.id).toBe(confirmed.body.data.id);

    const requirements = await request(app.getHttpServer())
      .get(`/api/requirements?projectId=${projectId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(requirements.body.data).toMatchObject({ total: 1 });
    expect(requirements.body.data.items[0].id).toBe(confirmed.body.data.id);
  });

  it('rejects protected requests without a token', async () => {
    await request(app.getHttpServer()).get('/api/projects').expect(401);
  });
});
