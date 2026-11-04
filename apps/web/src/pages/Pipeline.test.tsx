import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pipeline } from './Pipeline';
import { setCsrfToken } from '../api/client';
import { useProjectStore } from '../store/project';
import { useProject } from '../test-utils';

const projectA = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };
const projectB = { id: 'p2', key: 'OPS', name: 'Ops', version: 1 };

function requirement(overrides: Record<string, unknown> = {}) {
  const id = overrides.id ?? 'req-1';
  return {
    id,
    projectId: 'p1',
    seq: 1,
    code: overrides.code ?? `DEMO-${id}`,
    title: overrides.title ?? `需求 ${id}`,
    description: null,
    version: 1,
    generation: 1,
    phase: 'DELIVERY',
    workStatus: 'ACTIVE',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...overrides,
  };
}

function envelope(data: unknown) {
  return { data, meta: { requestId: 'req-test' } };
}

function reply(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function errorReply(code: string, message: string) {
  return reply(500, { error: { code, message, requestId: 'req-failure' } });
}

type Handler = (
  path: string,
  init: RequestInit,
  searchParams: URLSearchParams,
) => Response | Promise<Response> | undefined;

function stubFetch(handler: Handler) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const parsed = new URL(url, 'http://localhost');
    const result = handler(parsed.pathname, init ?? {}, parsed.searchParams);
    if (!result) return reply(404, { error: { code: 'STUB_NOT_FOUND', message: parsed.pathname } });
    return result;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function renderPipeline() {
  return render(
    <MemoryRouter initialEntries={['/pipeline']}>
      <Pipeline />
    </MemoryRouter>,
  );
}

describe('Pipeline（需求流水线加载可信度）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('首次加载显示页面级加载态，不提前显示空态', async () => {
    let resolveRequirements!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveRequirements = resolve;
    });
    stubFetch((path) => {
      if (path === '/api/v1/projects') return reply(200, envelope([projectA]));
      if (path === '/api/v1/projects/p1/requirements') return pending;
      return undefined;
    });

    renderPipeline();
    expect(await screen.findByText('正在加载需求流水线…')).toBeInTheDocument();
    expect(screen.queryByText('当前项目还没有需求')).not.toBeInTheDocument();

    resolveRequirements(
      reply(200, envelope({ items: [requirement({ title: '需求一' })], nextCursor: null })),
    );
    expect(await screen.findByText('需求一')).toBeInTheDocument();
  });

  it('首次加载失败显示页面级错误与重试，重试成功后恢复列表', async () => {
    let requirementCalls = 0;
    stubFetch((path) => {
      if (path === '/api/v1/projects') return reply(200, envelope([projectA]));
      if (path === '/api/v1/projects/p1/requirements') {
        requirementCalls += 1;
        if (requirementCalls === 1)
          return errorReply('REQUIREMENTS_UNAVAILABLE', '需求服务暂时不可用');
        return reply(
          200,
          envelope({ items: [requirement({ title: '重试成功需求' })], nextCursor: null }),
        );
      }
      return undefined;
    });

    renderPipeline();

    expect(await screen.findByText('需求列表加载失败')).toBeInTheDocument();
    expect(screen.getByText(/需求服务暂时不可用/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试加载需求列表' })).toBeInTheDocument();
    expect(screen.queryByText('当前项目还没有需求')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试加载需求列表' }));
    expect(await screen.findByText('重试成功需求')).toBeInTheDocument();
    expect(screen.queryByText('需求列表加载失败')).not.toBeInTheDocument();
    expect(requirementCalls).toBe(2);
  });

  it('成功返回空数组时显示真正的空项目状态，并说明下一步', async () => {
    stubFetch((path) => {
      if (path === '/api/v1/projects') return reply(200, envelope([projectA]));
      if (path === '/api/v1/projects/p1/requirements')
        return reply(200, envelope({ items: [], nextCursor: null }));
      return undefined;
    });

    renderPipeline();

    expect(await screen.findByText('当前项目还没有需求')).toBeInTheDocument();
    expect(screen.getByText(/项目已成功加载，但还没有任何需求/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开需求列表' })).toBeInTheDocument();
  });

  it('统计覆盖全部分页需求，而不是只看第一页', async () => {
    stubFetch((path, _init, searchParams) => {
      if (path === '/api/v1/projects') return reply(200, envelope([projectA]));
      if (path === '/api/v1/projects/p1/requirements') {
        const cursor = searchParams.get('cursor');
        if (!cursor)
          return reply(
            200,
            envelope({
              items: [requirement({ id: 'req-1', title: '第一页需求' })],
              nextCursor: '2',
            }),
          );
        if (cursor === '2')
          return reply(
            200,
            envelope({
              items: [requirement({ id: 'req-2', title: '第二页需求', workStatus: 'BLOCKED' })],
              nextCursor: null,
            }),
          );
      }
      return undefined;
    });

    renderPipeline();

    expect(await screen.findByText('第一页需求')).toBeInTheDocument();
    expect(screen.getByText('第二页需求')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /全部需求：2 条/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /阻塞：1 条/ })).toBeInTheDocument();
  });

  it('已有快照刷新失败时保留旧数据并显示 stale，搜索筛选仍可用', async () => {
    let requirementCalls = 0;
    stubFetch((path) => {
      if (path === '/api/v1/projects') return reply(200, envelope([projectA]));
      if (path === '/api/v1/projects/p1/requirements') {
        requirementCalls += 1;
        if (requirementCalls === 1)
          return reply(
            200,
            envelope({
              items: [requirement({ title: '旧快照需求' })],
              nextCursor: null,
            }),
          );
        return errorReply('REQUIREMENTS_UNAVAILABLE', '刷新失败');
      }
      return undefined;
    });

    renderPipeline();
    expect(await screen.findByText('旧快照需求')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    expect(await screen.findByText('本次刷新失败，数据可能已经过期。')).toBeInTheDocument();
    expect(screen.getByText('旧快照需求')).toBeInTheDocument();
    expect(screen.queryByText('当前项目还没有需求')).not.toBeInTheDocument();
    expect(screen.getByText(/上次成功读取于 \d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试刷新需求列表' })).toBeInTheDocument();

    const search = screen.getByLabelText('搜索需求');
    fireEvent.change(search, { target: { value: '不存在的关键词' } });
    expect(screen.getByText('没有符合筛选条件的需求。')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '旧快照' } });
    expect(screen.getByText('旧快照需求')).toBeInTheDocument();
  });

  it('切换项目立即清理旧项目快照；新项目首次失败只显示错误，不显示旧数据', async () => {
    stubFetch((path) => {
      if (path === '/api/v1/projects') return reply(200, envelope([projectA, projectB]));
      if (path === '/api/v1/projects/p1/requirements')
        return reply(
          200,
          envelope({ items: [requirement({ title: 'P1 需求' })], nextCursor: null }),
        );
      if (path === '/api/v1/projects/p2/requirements')
        return errorReply('REQUIREMENTS_UNAVAILABLE', 'P2 加载失败');
      return undefined;
    });

    renderPipeline();
    expect(await screen.findByText('P1 需求')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });

    expect(await screen.findByText('需求列表加载失败')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('P1 需求')).not.toBeInTheDocument());
    expect(screen.queryByText('当前项目还没有需求')).not.toBeInTheDocument();
    expect(useProjectStore.getState().projectId).toBe('p2');
  });
});
