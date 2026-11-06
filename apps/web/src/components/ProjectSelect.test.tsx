import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSelect } from './ProjectSelect';
import { invalidateProjects, useProjectStore } from '../store/project';
import { envelope, methodOf, mockFetch, pathOf, useProject } from '../test-utils';

const demo = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };
const ops = { id: 'p2', key: 'OPS', name: 'Ops', version: 2 };

/** 只处理 GET /api/v1/projects，其余请求交给 mockFetch 的默认 404。 */
function projectsReply(
  handler: () =>
    { status: number; body: unknown } | Promise<{ status: number; body: unknown }> | undefined,
) {
  return (url: string, init: RequestInit) => {
    if (pathOf(url) === '/api/v1/projects' && methodOf(init) === 'GET') return handler();
    return undefined;
  };
}

function currentSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: '选择项目' }) as HTMLSelectElement;
}

/** 等真正的项目选择器（而不是首次加载态）就绪，并断言当前选中值。 */
async function findReadySelect(expectedValue: string): Promise<HTMLSelectElement> {
  await waitFor(() => {
    expect(currentSelect()).not.toBeDisabled();
    expect(currentSelect()).toHaveValue(expectedValue);
  });
  return currentSelect();
}

describe('ProjectSelect（统一项目上下文的状态展示）', () => {
  beforeEach(() => {
    // 每次用例前重置 store / 模块级缓存 / localStorage，避免用例之间状态泄漏。
    useProject('');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    invalidateProjects();
  });

  it('403 项目列表失败时给出权限引导且不显示空列表入口', async () => {
    mockFetch(
      projectsReply(() => ({
        status: 403,
        body: { error: { code: 'PROJECT_UNAVAILABLE', message: '当前项目列表不可用' } },
      })),
    );
    render(<ProjectSelect onCreateProject={() => undefined} />);
    expect(await screen.findByText('项目列表加载失败')).toBeInTheDocument();
    expect(
      screen.getByText('当前账号没有查看项目列表的权限，请联系项目管理员。'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建项目' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '接受邀请' })).not.toBeInTheDocument();
  });

  it('服务失败时给出稍后重试引导且不显示空列表入口', async () => {
    mockFetch(
      projectsReply(() => ({
        status: 500,
        body: { error: { code: 'PROJECT_UNAVAILABLE', message: '当前项目列表不可用' } },
      })),
    );
    render(<ProjectSelect onCreateProject={() => undefined} />);
    expect(await screen.findByText('项目列表加载失败')).toBeInTheDocument();
    expect(screen.getByText('项目服务暂时不可用，请稍后重试。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建项目' })).not.toBeInTheDocument();
  });

  it('网络失败时明确提示检查网络并提供重试', async () => {
    mockFetch(
      projectsReply(() => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(<ProjectSelect />);
    expect(await screen.findByText('项目列表加载失败')).toBeInTheDocument();
    expect(screen.getByText('暂时无法读取项目列表，请检查网络后重试。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试加载项目列表' })).toBeInTheDocument();
  });

  it('尚未读取项目时不显示创建项目，成功空列表才显示真实创建入口', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockFetch(projectsReply(() => pending.then(() => ({ status: 200, body: envelope([]) }))));
    render(<ProjectSelect onCreateProject={() => undefined} />);
    expect(screen.queryByRole('button', { name: '创建项目' })).not.toBeInTheDocument();
    await act(async () => {
      release();
    });
    expect(await screen.findByRole('button', { name: '创建项目' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '接受邀请' })).not.toBeInTheDocument();
  });

  it('首次加载时禁用选择器并显示加载文案', () => {
    // 永不 resolve 的请求：稳定停留在首次加载态。
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );

    render(<ProjectSelect />);

    const select = screen.getByRole('combobox', { name: '选择项目' });
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('option', { name: '正在加载项目…' })).toBeInTheDocument();
    // 不只靠下拉占位文案：另有一处 role="status" + aria-busy 的加载提示。
    const loadingRegion = screen.getByRole('status');
    expect(loadingRegion).toHaveTextContent('正在读取项目…');
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true');
  });

  it('已有数据刷新时显示行内加载提示，旧数据保持可选中', async () => {
    let calls = 0;
    let releaseRefresh: () => void = () => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    mockFetch(
      projectsReply(() => {
        calls += 1;
        if (calls === 1) return { status: 200, body: envelope([demo]) };
        return refreshGate.then(() => ({ status: 200, body: envelope([demo, ops]) }));
      }),
    );

    render(<ProjectSelect />);
    await findReadySelect('p1');

    act(() => {
      void useProjectStore.getState().refreshProjects();
    });

    expect(screen.getByRole('status')).toHaveTextContent('正在刷新项目列表…');
    expect(currentSelect()).not.toBeDisabled();
    expect(currentSelect()).toHaveValue('p1');
    expect(screen.getByRole('option', { name: /Demo/ })).toBeInTheDocument();

    await act(async () => {
      releaseRefresh();
    });

    await waitFor(() => expect(screen.getByRole('option', { name: /Ops/ })).toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('加载成功但没有项目时显示创建 / 邀请入口，点击触发回调', async () => {
    const onCreateProject = vi.fn();
    const onAcceptInvite = vi.fn();
    mockFetch(projectsReply(() => ({ status: 200, body: envelope([]) })));

    render(<ProjectSelect onCreateProject={onCreateProject} onAcceptInvite={onAcceptInvite} />);

    expect(await screen.findByText('还没有可访问的项目')).toBeInTheDocument();
    expect(
      screen.getByText(
        '你可以创建项目；如已有项目管理员邀请你，请打开管理员发送的邀请链接加入已有项目。',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    fireEvent.click(screen.getByRole('button', { name: '接受邀请' }));

    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(onAcceptInvite).toHaveBeenCalledTimes(1);
  });

  it('没有创建 / 邀请回调时说明等待原因，而不是留一个死胡同', async () => {
    mockFetch(projectsReply(() => ({ status: 200, body: envelope([]) })));

    render(<ProjectSelect />);

    expect(await screen.findByText('还没有可访问的项目')).toBeInTheDocument();
    expect(
      screen.getByText(
        '当前页面没有提供创建或邀请入口，请联系项目管理员，或前往项目列表创建项目。',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('项目列表加载失败时显示重试，重试成功后恢复选择器', async () => {
    let calls = 0;
    mockFetch(
      projectsReply(() => {
        calls += 1;
        if (calls === 1) {
          return {
            status: 500,
            body: {
              error: { code: 'INTERNAL', message: '项目服务异常', requestId: 'req-500' },
            },
          };
        }
        return { status: 200, body: envelope([demo]) };
      }),
    );

    render(<ProjectSelect />);

    expect(await screen.findByText('项目列表加载失败')).toBeInTheDocument();
    expect(screen.getByText('项目服务暂时不可用，请稍后重试。')).toBeInTheDocument();
    // 失败不能伪装成空列表。
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('还没有可访问的项目')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试加载项目列表' }));

    const select = await findReadySelect('p1');
    expect(select).not.toBeDisabled();
    expect(screen.getByRole('option', { name: /Demo/ })).toBeInTheDocument();
    expect(useProjectStore.getState().projectId).toBe('p1');
    expect(localStorage.getItem('workmesh.projectId')).toBe('p1');
  });

  it('已有旧数据但刷新失败时显示过期提示，选择器仍然可用', async () => {
    let calls = 0;
    mockFetch(
      projectsReply(() => {
        calls += 1;
        if (calls === 1) return { status: 200, body: envelope([demo, ops]) };
        return { status: 503, body: { error: { code: 'UNAVAILABLE', message: '维护中' } } };
      }),
    );

    render(<ProjectSelect />);

    await findReadySelect('p1');

    await act(async () => {
      await useProjectStore.getState().refreshProjects();
    });

    expect(screen.getByText(/当前显示的是上次成功数据/)).toBeInTheDocument();
    expect(screen.getByText('本次项目列表更新失败，数据可能已经过期。')).toBeInTheDocument();
    const stillUsable = currentSelect();
    expect(stillUsable).not.toBeDisabled();
    expect(stillUsable).toHaveValue('p1');
    expect(screen.getByRole('option', { name: /Ops/ })).toBeInTheDocument();
  });

  it('localStorage 中的项目已失效时自动切到第一个可访问项目并同步存储', async () => {
    useProject('missing-project');
    mockFetch(projectsReply(() => ({ status: 200, body: envelope([demo, ops]) })));

    render(<ProjectSelect />);

    await findReadySelect('p1');
    expect(useProjectStore.getState().projectId).toBe('p1');
    expect(localStorage.getItem('workmesh.projectId')).toBe('p1');
    expect(screen.getByRole('option', { name: /Ops/ })).toBeInTheDocument();
  });

  it('切换项目时写回 store 与 localStorage，并触发 onChange', async () => {
    useProject('p1');
    const onChange = vi.fn();
    mockFetch(projectsReply(() => ({ status: 200, body: envelope([demo, ops]) })));

    render(<ProjectSelect onChange={onChange} />);

    const select = await findReadySelect('p1');

    fireEvent.change(select, { target: { value: 'p2' } });

    expect(useProjectStore.getState().projectId).toBe('p2');
    expect(localStorage.getItem('workmesh.projectId')).toBe('p2');
    expect(onChange).toHaveBeenCalledWith('p2');
  });
});
