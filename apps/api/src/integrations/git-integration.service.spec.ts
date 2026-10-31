import { describe, expect, it, vi } from 'vitest';
import { CommitParserService } from './commit-parser.service';
import { GitIntegrationService } from './git-integration.service';

const repositoryUrl = 'https://github.com/acme/req-flow';
const requirementId = '123e4567-e89b-42d3-a456-426614174000';
const prdId = '223e4567-e89b-42d3-a456-426614174000';

function createPrisma(project: { id: string; repositoryUrl: string } | null) {
  return {
    project: { findUnique: vi.fn().mockResolvedValue(project) },
    gitCommit: { upsert: vi.fn().mockResolvedValue({ id: 'commit-1' }) },
    pullRequest: { upsert: vi.fn().mockResolvedValue({ id: 'pull-request-1' }) },
    requirement: { findMany: vi.fn().mockResolvedValue([{ id: requirementId }]) },
    prd: { findMany: vi.fn().mockResolvedValue([{ id: prdId }]) },
    traceLink: { upsert: vi.fn().mockResolvedValue({}) },
  };
}

describe('GitIntegrationService repository ownership', () => {
  it('scopes commits and requirement/PRD links to the mapped GitHub repository', async () => {
    const prisma = createPrisma({ id: 'project-1', repositoryUrl });
    const service = new GitIntegrationService(prisma as never, new CommitParserService());

    await expect(
      service.handlePush(
        {
          repository: { html_url: 'https://GitHub.com/acme/req-flow.git/' },
          ref: 'refs/heads/main',
          commits: [
            {
              id: 'sha-1',
              message: `feat: YFF-REQ-1 PRD-${prdId}`,
              url: `${repositoryUrl}/commit/sha-1`,
              author: { name: 'Developer' },
              timestamp: '2026-10-30T12:00:00Z',
              added: ['src/feature.ts'],
            },
          ],
        },
        'github',
      ),
    ).resolves.toMatchObject({ accepted: true, provider: 'github', commits: 1, linked: true });

    expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: { repositoryUrl } });
    expect(prisma.gitCommit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repositoryUrl_sha: { repositoryUrl, sha: 'sha-1' } },
        create: expect.objectContaining({ repositoryUrl }),
      }),
    );
    expect(prisma.requirement.findMany).toHaveBeenCalledWith({
      where: { code: { in: ['YFF-REQ-1'] }, projectId: 'project-1' },
      select: { id: true },
    });
    expect(prisma.prd.findMany).toHaveBeenCalledWith({
      where: { id: { in: [prdId] }, requirement: { projectId: 'project-1' } },
      select: { id: true },
    });
    expect(prisma.traceLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ sourceId: requirementId, targetId: 'commit-1' }),
      }),
    );
    expect(prisma.traceLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ sourceId: prdId, targetId: 'commit-1' }),
      }),
    );
  });

  it('scopes GitLab merge requests to the mapped target project', async () => {
    const prisma = createPrisma({
      id: 'project-1',
      repositoryUrl: 'https://gitlab.example/acme/app',
    });
    const service = new GitIntegrationService(prisma as never, new CommitParserService());

    await expect(
      service.handlePullRequest(
        {
          project: { id: 42, web_url: 'https://gitlab.example/acme/app.git/' },
          object_attributes: {
            iid: 12,
            title: `YFF-REQ-1`,
            description: `PRD-${prdId}`,
            url: 'https://gitlab.example/acme/app/-/merge_requests/12',
            state: 'opened',
            target_project_id: 42,
            changes: {
              changes: [{ new_path: 'src/feature.ts' }, { new_path: 'tests/feature.test.ts' }],
            },
          },
          user: { username: 'developer' },
        },
        'gitlab',
      ),
    ).resolves.toMatchObject({ accepted: true, provider: 'gitlab', linked: true });

    expect(prisma.pullRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ repositoryUrl: 'https://gitlab.example/acme/app' }),
        update: expect.objectContaining({ repositoryUrl: 'https://gitlab.example/acme/app' }),
      }),
    );
    expect(prisma.requirement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: { in: ['YFF-REQ-1'] }, projectId: 'project-1' } }),
    );
    expect(prisma.traceLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          sourceType: 'pull_request',
          targetType: 'file',
          targetId: 'src/feature.ts',
          linkType: 'changes',
        }),
      }),
    );
    expect(prisma.traceLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          sourceType: 'pull_request',
          targetType: 'file',
          targetId: 'tests/feature.test.ts',
          linkType: 'tests',
        }),
      }),
    );
  });

  it('skips unmapped repositories without persisting or linking Git data', async () => {
    const prisma = createPrisma(null);
    const service = new GitIntegrationService(prisma as never, new CommitParserService());

    await expect(
      service.handlePush(
        {
          repository: { html_url: repositoryUrl },
          commits: [{ id: 'sha-1', message: 'feat: work' }],
        },
        'github',
      ),
    ).resolves.toMatchObject({ accepted: false, skipped: 'repository_not_mapped' });
    expect(prisma.gitCommit.upsert).not.toHaveBeenCalled();
    expect(prisma.traceLink.upsert).not.toHaveBeenCalled();
  });

  it('rejects GitLab merge request identities whose target project differs', async () => {
    const prisma = createPrisma({
      id: 'project-1',
      repositoryUrl: 'https://gitlab.example/acme/app',
    });
    const service = new GitIntegrationService(prisma as never, new CommitParserService());

    await expect(
      service.handlePullRequest(
        {
          project: { id: 42, web_url: 'https://gitlab.example/acme/app' },
          object_attributes: {
            iid: 12,
            target_project_id: 43,
            url: 'https://gitlab.example/mr/12',
          },
        },
        'gitlab',
      ),
    ).resolves.toMatchObject({ accepted: false, skipped: 'repository_identity_invalid' });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
    expect(prisma.pullRequest.upsert).not.toHaveBeenCalled();
  });
});
