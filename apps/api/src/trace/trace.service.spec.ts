import { describe, expect, it, vi } from 'vitest';
import { TraceService } from './trace.service';

describe('TraceService', () => {
  it('returns project-owned Git links and keeps ordinary traces', async () => {
    const requirement = { id: 'req-1', title: 'Requirement', prds: [], traces: [] };
    const service = new TraceService(
      {
        requirement: { findMany: vi.fn().mockResolvedValue([requirement]) },
        project: {
          findUnique: vi.fn().mockResolvedValue({ repositoryUrl: 'https://github.com/acme/repo' }),
        },
        traceLink: {
          findMany: vi
            .fn()
            .mockResolvedValueOnce([
              {
                sourceId: 'req-1',
                targetId: 'commit-1',
                targetType: 'commit',
                sourceType: 'requirement',
              },
              {
                sourceId: 'req-1',
                targetId: 'pr-1',
                targetType: 'pull_request',
                sourceType: 'requirement',
              },
            ])
            .mockResolvedValueOnce([
              {
                sourceId: 'commit-1',
                targetId: 'src/a.ts',
                targetType: 'file',
                linkType: 'changes',
              },
              {
                sourceId: 'pr-1',
                targetId: 'src/a.test.ts',
                targetType: 'file',
                linkType: 'tests',
              },
            ]),
        },
        gitCommit: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'commit-1',
              repositoryUrl: 'https://github.com/acme/repo',
              sha: 'abc',
              message: 'feat',
              url: '',
              committedAt: new Date(),
            },
          ]),
        },
        pullRequest: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'pr-1',
              repositoryUrl: 'https://github.com/acme/repo',
              number: 1,
              title: 'PR',
              url: '',
              state: 'open',
              provider: 'github',
            },
          ]),
        },
      } as never,
      { assertMember: vi.fn() } as never,
    );

    await expect(service.graph('user-1', 'project-1')).resolves.toMatchObject([
      {
        id: 'req-1',
        commits: [{ id: 'commit-1', files: [{ path: 'src/a.ts', linkType: 'changes' }] }],
        pullRequests: [{ id: 'pr-1', files: [{ path: 'src/a.test.ts', linkType: 'tests' }] }],
      },
    ]);
  });

  it('hides Git links when the project has no repository mapping', async () => {
    const requirement = { id: 'req-1', title: 'Requirement', prds: [], traces: [] };
    const findManyLinks = vi.fn();
    const service = new TraceService(
      {
        requirement: { findMany: vi.fn().mockResolvedValue([requirement]) },
        project: { findUnique: vi.fn().mockResolvedValue({ repositoryUrl: null }) },
        traceLink: { findMany: findManyLinks },
      } as never,
      { assertMember: vi.fn() } as never,
    );

    await expect(service.graph('user-1', 'project-1')).resolves.toEqual([
      { ...requirement, commits: [], pullRequests: [] },
    ]);
    expect(findManyLinks).not.toHaveBeenCalled();
  });
});
