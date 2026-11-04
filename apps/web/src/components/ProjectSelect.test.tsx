import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSelect } from './ProjectSelect';
import { invalidateProjects, useProjectStore } from '../store/project';
import { envelope, methodOf, mockFetch, pathOf, useProject } from '../test-utils';

const demo = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };
const ops = { id: 'p2', key: 'OPS', name: 'Ops', version: 2 };

/** 只处理 GET /api/v1/projects，其余请求交给 mockFetch 的默认 404。 */
function projectsReply(handler: () => { status: number; body: unknown } | undefined) {
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
  });

  it('加载成功但没有项目时显示创建 / 邀请入口，点击触发回调', async () => {
    const onCreateProject = vi.fn();
    const onAcceptInvite = vi.fn();
    mockFetch(projectsReply(() => ({ status: 200, body: envelope([]) })));

    render(<ProjectSelect onCreateProject={onCreateProject} onAcceptInvite={onAcceptInvite} />);

    expect(await screen.findByText('还没有可访问的项目')).toBeInTheDocument();
    expect(screen.getByText('你可以创建项目，或通过邀请加入已有项目。')).toBeInTheDocument();

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
    expect(screen.getByText('暂时无法读取项目列表。')).toBeInTheDocument();
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
