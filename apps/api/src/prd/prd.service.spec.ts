import { describe, expect, it, vi } from 'vitest';
import { PrdService } from './prd.service';

describe('PrdService project boundaries', () => {
  it('rejects templates from another project', async () => {
    const service = new PrdService(
      {
        requirement: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'req-1',
            projectId: 'project-1',
            title: 'Requirement',
            description: 'Description',
            userStories: [],
            acceptanceCriteria: [],
            prds: [],
          }),
        },
        prdTemplate: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: 'template-1', projectId: 'project-2', content: '' }),
        },
      } as never,
      {} as never,
      { assertMember: vi.fn() } as never,
      {} as never,
    );
    await expect(
      service.generate('user-1', 'req-1', { templateId: 'template-1' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('streams generated chunks and persists the completed PRD', async () => {
    const requirement = {
      id: 'req-1',
      projectId: 'project-1',
      title: 'Requirement',
      description: 'Description',
      userStories: [],
      acceptanceCriteria: [],
      prds: [],
    };
    const create = vi.fn().mockResolvedValue({ id: 'prd-1', version: 1, content: '# Draft' });
    const ai = {
      async *stream() {
        yield '# ';
        yield 'Draft';
      },
    };
    const service = new PrdService(
      {
        requirement: { findUnique: vi.fn().mockResolvedValue(requirement) },
        prdTemplate: { findFirst: vi.fn().mockResolvedValue(null) },
        prd: { create },
      } as never,
      ai as never,
      { assertMember: vi.fn() } as never,
      {} as never,
    );
    const events = [];
    for await (const event of service.generateStream('user-1', 'req-1')) events.push(event);
    expect(events).toEqual([
      { content: '# ', done: false },
      { content: 'Draft', done: false },
      { content: '', done: true, prd: { id: 'prd-1', version: 1, content: '# Draft' } },
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: '# Draft' }) }),
    );
  });
});
