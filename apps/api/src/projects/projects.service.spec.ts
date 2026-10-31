import { describe, expect, it, vi } from 'vitest';
import { ProjectsService } from './projects.service';

describe('ProjectsService repository URL', () => {
  it('stores repository URLs in a canonical form on create', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'project-1' });
    const service = new ProjectsService({
      user: { findUnique: vi.fn().mockResolvedValue({ organizationId: 'org-1' }) },
      project: { create },
    } as never);

    await service.create('user-1', {
      name: 'Project',
      key: 'PROJECT',
      repositoryUrl: ' https://GitHub.com/acme/req-flow.git/ ',
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ repositoryUrl: 'https://github.com/acme/req-flow' }),
    });
  });

  it('normalizes repository URL changes and permits clearing the mapping', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'project-1' });
    const service = new ProjectsService({
      projectMember: {
        findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }),
      },
      project: { update },
    } as never);

    await service.update('user-1', 'project-1', {
      repositoryUrl: 'https://gitlab.example/group/project.git',
    });
    await service.update('user-1', 'project-1', { repositoryUrl: '' });

    expect(update.mock.calls.map((call) => call[0].data.repositoryUrl)).toEqual([
      'https://gitlab.example/group/project',
      null,
    ]);
  });

  it('rejects non-web repository URLs before persistence', async () => {
    const create = vi.fn();
    const service = new ProjectsService({
      user: { findUnique: vi.fn().mockResolvedValue({ organizationId: 'org-1' }) },
      project: { create },
    } as never);

    await expect(
      service.create('user-1', {
        name: 'Project',
        key: 'PROJECT',
        repositoryUrl: 'file:///tmp/repo',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });
});
