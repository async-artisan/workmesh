import { describe, expect, it, vi } from 'vitest';
import { RoleType, TaskStatus } from '@prisma/client';
import { TasksService } from './tasks.service';

const requirement = {
  id: 'r-1',
  code: 'YFF-REQ-7',
  title: '支持本地模型接入',
  description: '开发者可指向本地模型',
  status: 'DESIGN_READY',
  projectId: 'p-1',
  acceptanceCriteria: ['可通过配置切换到本地模型'],
  prds: [{ version: 3 }],
  tasks: [
    {
      id: 't-1',
      code: 'YFF-REQ-7-T01',
      title: '增加 provider 适配层',
      role: RoleType.BACKEND,
      status: TaskStatus.OPEN,
    },
  ],
};

function buildService(overrides: Record<string, unknown> = {}) {
  return new TasksService(
    {
      requirement: { findUnique: vi.fn().mockResolvedValue(requirement), findFirst: vi.fn() },
      task: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), create: vi.fn() },
      ...overrides,
    } as never,
    { assertMember: vi.fn() } as never,
  );
}

describe('TasksService', () => {
  it('numbers new tasks from the requirement code', async () => {
    const create = vi.fn().mockResolvedValue({ id: 't-2' });
    const service = buildService({
      task: { findFirst: vi.fn().mockResolvedValue({ seq: 2 }), create },
    });
    await service.create('user-1', 'r-1', { title: '前端设置页', role: RoleType.FRONTEND });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ seq: 3, code: 'YFF-REQ-7-T03', role: 'FRONTEND' }),
    });
  });

  it('excludes tasks whose dependencies are unfinished from the ready queue', async () => {
    const service = buildService({
      task: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 't-1',
            code: 'YFF-REQ-7-T01',
            status: TaskStatus.OPEN,
            requirement: { id: 'r-1', code: 'YFF-REQ-7', title: 't', projectId: 'p-1' },
            blockedBy: [{ fromId: 't-0', from: { status: TaskStatus.DONE } }],
          },
          {
            id: 't-2',
            code: 'YFF-REQ-7-T02',
            status: TaskStatus.OPEN,
            requirement: { id: 'r-1', code: 'YFF-REQ-7', title: 't', projectId: 'p-1' },
            blockedBy: [{ fromId: 't-1', from: { status: TaskStatus.IN_PROGRESS } }],
          },
        ]),
      },
    });
    const ready = await service.ready('user-1', RoleType.BACKEND);
    expect(ready.map((task) => task.code)).toEqual(['YFF-REQ-7-T01']);
  });

  it('refuses to let an agent close a task', async () => {
    const service = buildService({
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 't-1',
          requirement: { projectId: 'p-1' },
        }),
        update: vi.fn().mockResolvedValue({ id: 't-1', status: TaskStatus.REVIEW_PENDING }),
      },
    });
    await expect(
      service.updateStatus('user-1', 't-1', TaskStatus.DONE, { type: 'AGENT' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.updateStatus('user-1', 't-1', TaskStatus.REVIEW_PENDING, { type: 'AGENT' }),
    ).resolves.toBeDefined();
  });

  it('assembles a context package anchored on the requirement code', async () => {
    const service = buildService({
      requirement: { findFirst: vi.fn().mockResolvedValue(requirement) },
      prd: { findMany: vi.fn().mockResolvedValue([{ id: 'prd-1' }]) },
      technicalSpec: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { title: '技术规格', status: 'DRAFT', updatedAt: new Date('2026-11-01') },
          ]),
      },
      taskDependency: {
        findMany: vi.fn().mockResolvedValue([{ toId: 't-1', from: { code: 'YFF-REQ-7-T00' } }]),
      },
    });
    const context = await service.context('user-1', 'YFF-REQ-7');
    expect(context).toMatchObject({
      code: 'YFF-REQ-7',
      status: 'DESIGN_READY',
      source: { prdVersion: 3, authority: 'product' },
      rules: { mustIncludeAnchor: 'YFF-REQ-7', cannotSetDone: true },
    });
    expect(context.tasks[0].blockedBy).toEqual(['YFF-REQ-7-T00']);
    expect(context.artifacts.map((artifact) => artifact.kind)).toEqual(['PRD', 'SPEC']);
  });
});
