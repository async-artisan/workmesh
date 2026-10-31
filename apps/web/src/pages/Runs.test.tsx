import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Runs } from './Runs';
import { useAuthStore } from '../store/auth';

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  createRun: vi.fn(),
  sendMessage: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
  stream: vi.fn(),
}));

vi.mock('../api/resources', () => ({
  projectApi: { list: api.listProjects },
  aiRunApi: {
    list: api.listRuns,
    get: api.getRun,
    create: api.createRun,
    sendMessage: api.sendMessage,
    pause: api.pause,
    resume: api.resume,
    cancel: api.cancel,
    confirm: api.confirm,
    stream: api.stream,
  },
}));

describe('Runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    api.listProjects.mockResolvedValue([{ id: 'project-1', name: 'Demo', key: 'DEMO' }]);
    api.listRuns.mockResolvedValue({ items: [], total: 0 });
    api.createRun.mockResolvedValue({
      run: { id: 'run-1', projectId: 'project-1', status: 'ACTIVE', step: 'BACKGROUND_GOAL' },
      messages: [{ id: 'message-1', sequence: 1, role: 'SYSTEM', content: '请描述目标。' }],
    });
    api.sendMessage.mockResolvedValue({
      run: { id: 'run-1', projectId: 'project-1', status: 'ACTIVE', step: 'USERS_SCENARIOS' },
      messages: [{ id: 'message-2', sequence: 2, role: 'USER', content: '改善订单流程。' }],
    });
  });

  it('creates a run, keeps the timeline, and advances the four-step view', async () => {
    render(
      <MemoryRouter initialEntries={['/runs']}>
        <Runs />
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.listRuns).toHaveBeenCalledWith('project-1', 1, 20, undefined));
    fireEvent.click(screen.getByRole('button', { name: '开始需求访谈' }));
    expect(await screen.findByText('请描述目标。')).toBeInTheDocument();

    const reply = screen.getByRole('textbox', { name: '回复当前步骤' });
    fireEvent.change(reply, {
      target: { value: '改善订单流程。' },
    });
    fireEvent.keyDown(reply, { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(reply).toHaveValue('改善订单流程。');
    expect(api.sendMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(reply, { key: 'Enter', code: 'Enter', isComposing: true });
    expect(api.sendMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(reply, { key: 'Enter', code: 'Enter' });

    expect(await screen.findByText('改善订单流程。')).toBeInTheDocument();
    expect(api.sendMessage).toHaveBeenCalledWith('run-1', '改善订单流程。');
    expect(screen.getByText('请描述目标。')).toBeInTheDocument();
    expect(screen.getByText('用户与场景')).toBeInTheDocument();
  });

  it('shows the backend reason when run creation fails', async () => {
    api.createRun.mockRejectedValue({
      response: { status: 404, data: { message: '项目不存在' } },
    });
    render(
      <MemoryRouter initialEntries={['/runs']}>
        <Runs />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '开始需求访谈' }));

    expect(await screen.findByText('创建运行失败：项目不存在')).toBeInTheDocument();
  });
});
