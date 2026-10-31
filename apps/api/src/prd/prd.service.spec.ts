import { describe, expect, it, vi } from 'vitest';
import { PrdService } from './prd.service';

function serviceWith(overrides: Record<string, unknown>) {
  return new PrdService(
    {
      requirement: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'req-1',
          projectId: 'project-1',
          title: 'Requirement',
          description: 'Description',
          prds: [{ version: 2 }],
        }),
      },
      prdTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
      prd: { create: vi.fn().mockResolvedValue({ id: 'prd-1', version: 3 }) },
      ...overrides,
    } as never,
    { assertMember: vi.fn(), assertRequirementMember: vi.fn() } as never,
  );
}

describe('PrdService authoring', () => {
  it('rejects empty PRD content', async () => {
    const service = serviceWith({});
    await expect(service.create('user-1', 'req-1', { content: '   ' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects templates from another project', async () => {
    const service = serviceWith({
      prdTemplate: {
        findUnique: vi.fn().mockResolvedValue({ id: 'template-1', projectId: 'project-2' }),
      },
    });
    await expect(
      service.create('user-1', 'req-1', { content: '# PRD', templateId: 'template-1' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects missing templates', async () => {
    const service = serviceWith({});
    await expect(
      service.create('user-1', 'req-1', { content: '# PRD', templateId: 'missing' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('persists the submitted PRD as the next version', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'prd-1', version: 3 });
    const service = serviceWith({ prd: { create } });
    await expect(
      service.create('user-1', 'req-1', { content: '# PRD', title: '登录需求' }),
    ).resolves.toEqual({ id: 'prd-1', version: 3 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requirementId: 'req-1',
          version: 3,
          title: '登录需求',
          content: '# PRD',
          createdById: 'user-1',
        }),
      }),
    );
  });

  it('falls back to the requirement title when no title is submitted', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'prd-1', version: 3 });
    const service = serviceWith({ prd: { create } });
    await service.create('user-1', 'req-1', { content: '# PRD' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Requirement' }) }),
    );
  });
});
