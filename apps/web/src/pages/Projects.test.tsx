import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Projects } from './Projects';

const projectApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../api/resources', () => ({ projectApi }));

describe('Projects repository URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectApi.list.mockResolvedValue([
      { id: 'project-1', name: 'Existing', key: 'EXISTING', repositoryUrl: '' },
    ]);
  });

  it('sends the repository URL when creating and editing a project', async () => {
    render(<Projects />);

    fireEvent.click(await screen.findByRole('button', { name: '新建项目' }));
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: 'New project' } });
    fireEvent.change(screen.getByLabelText('项目 Key'), { target: { value: 'NEW_PROJECT' } });
    fireEvent.change(screen.getByLabelText('仓库 URL'), {
      target: { value: 'https://github.com/acme/new-repo' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));

    await waitFor(() =>
      expect(projectApi.create).toHaveBeenCalledWith({
        name: 'New project',
        key: 'NEW_PROJECT',
        description: '',
        repositoryUrl: 'https://github.com/acme/new-repo',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('编辑仓库 URL'), {
      target: { value: 'https://gitlab.example/acme/existing' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(projectApi.update).toHaveBeenCalledWith('project-1', {
        name: 'Existing',
        description: '',
        repositoryUrl: 'https://gitlab.example/acme/existing',
      }),
    );
  });
});
