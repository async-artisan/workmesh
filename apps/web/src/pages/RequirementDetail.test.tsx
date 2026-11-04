import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RequirementDetail } from './RequirementDetail';
import { setCsrfToken } from '../api/client';
import { useAuthStore } from '../store/auth';
import { envelope, mockFetch, pathOf, useProject } from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    stepKey: 'backend-impl',
    role: { key: 'backend', title: '后端' },
    responsibleUser: { id: 'u-1', email: 'bob@example.com' },
    version: 2,
    generation: 1,
    executionStatus: 'OPEN',
    workStatus: 'ACTIVE',
    currentClaimId: null,
    currentArtifactSetId: null,
    instanceId: 'inst-1',
    artifactCount: 0,
    review: null,
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    requirement: {
      id: 'req-1',
      projectId: 'p1',
      seq: 1,
      code: 'DEMO-001',
      title: '登录页改版',
      description: '支持记住登录状态。',
      version: 3,
      generation: 1,
      phase: 'DELIVERY',
      workStatus: 'ACTIVE',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
    },
    acceptanceKeys: [],
    tasks: [],
    artifacts: [],
    reviews: [],
    changes: [],
    counts: { tasks: 0, artifacts: 0, reviews: 0, changes: 0 },
    ...overrides,
  };
}

const definition = {
  steps: [
    { key: 'backend-impl', roleKey: 'backend', deps: [] },
    { key: 'verify', roleKey: 'qa', deps: ['backend-impl'] },
  ],
  roleSlots: [],
};

function handler(input: {
  body: ReturnType<typeof detail>;
  withDefinitions?: boolean;
  revisionFails?: boolean;
}) {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = (init.method ?? 'GET').toUpperCase();
    if (path === '/api/v1/projects' && method === 'GET')
      return { status: 200, body: envelope([project]) };
    if (path === '/api/v1/projects/p1/requirements/DEMO-001')
      return { status: 200, body: envelope(input.body) };
    if (path === '/api/v1/projects/p1/documents')
      return { status: 200, body: envelope({ items: [], nextCursor: null }) };
    if (input.withDefinitions) {
      if (path === '/api/v1/workflow-instances/inst-1')
        return {
          status: 200,
          body: envelope({
            id: 'inst-1',
            projectId: 'p1',
            requirementId: 'req-1',
            definitionRevisionId: 'rev-1',
            definitionDigest: 'd'.repeat(64),
            version: 1,
            workStatus: 'ACTIVE',
            retiredAt: null,
            steps: [],
          }),
        };
      if (path === '/api/v1/workflow-definition-revisions/rev-1') {
        if (input.revisionFails) return { status: 404, body: { error: { code: 'NOT_FOUND' } } };
        return {
          status: 200,
          body: envelope({
            id: 'rev-1',
            projectId: 'p1',
            workflowKey: 'standard',
            revision: 1,
            digest: 'd'.repeat(64),
            definition,
          }),
        };
      }
    }
    return undefined;
  };
}

function LocationProbe() {
  const [params] = useSearchParams();
  return <div data-testid="location">{`${params.get('tab') ?? ''}|${params.get('taskId') ?? ''}`}</div>;
}

function renderDetail(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/requirements/:requirementId" element={<RequirementDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequirementDetail（需求详情读模型）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    localStorage.clear();
  });

  it('展示需求、任务、工件与待签字入口', async () => {
    mockFetch(
      handler({
        body: detail({
          tasks: [
            task({
              version: 2,
              generation: 1,
              executionStatus: 'REVIEW_PENDING',
              currentClaimId: 'claim-1',
              currentArtifactSetId: 'set-1',
              artifactCount: 1,
              review: { id: 'review-1', kind: 'TASK_ACCEPTANCE', status: 'OPEN' },
            }),
          ],
          artifacts: [
            {
              id: 'artifact-1',
              taskId: 'task-1',
              kind: 'IMPL',
              storage: 'HOSTED',
              mediaType: 'text/markdown',
              byteLength: 128,
              sha256: 'a'.repeat(64),
              commitSha: null,
              repoPath: 'src/auth/login.ts',
              summary: '登录实现',
              checks: [],
              createdAt: '2026-11-02T00:00:00.000Z',
            },
          ],
          reviews: [
            {
              id: 'review-1',
              kind: 'TASK_ACCEPTANCE',
              status: 'OPEN',
              version: 2,
              subjectDigest: 'c'.repeat(64),
              documentRevisionId: null,
              artifactSetId: 'set-1',
              taskId: 'task-1',
              createdAt: '2026-11-02T00:00:00.000Z',
              subjectLabel: 'backend-impl',
              slots: [],
              decisions: [],
            },
          ],
          counts: { tasks: 1, artifacts: 1, reviews: 1, changes: 0 },
        }),
      }),
    );

    renderDetail('/requirements/DEMO-001');

    expect(await screen.findByText('登录页改版')).toBeInTheDocument();
    expect(screen.getByText('DEMO-001')).toBeInTheDocument();
    expect(screen.getByText('支持记住登录状态。')).toBeInTheDocument();
    expect(screen.getAllByText(/有 1 条评审待签字/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /任务/ }));
    expect(screen.getAllByText('后端实现').length).toBeGreaterThan(0);
    expect(screen.getByText(/bob@example.com/)).toBeInTheDocument();
    expect(screen.getAllByText('等待审批').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /去签字/ }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /交付物/ }));
    expect(screen.getByText(/sha256 aaaaaaaaaaaa/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /评审/ }));
    expect(screen.getByText('任务验收')).toBeInTheDocument();
  });

  it('流程图点击任务后切到任务页签、定位并临时高亮，且 URL 记录 taskId', async () => {
    mockFetch(handler({ body: detail({ tasks: [task(), task({ id: 'task-2', stepKey: 'verify', role: { key: 'qa', title: '测试' } })] }), withDefinitions: true }));

    renderDetail('/requirements/DEMO-001');

    const card = await screen.findByRole('button', { name: /后端实现，状态：可立即领取/ });
    fireEvent.click(card);

    const row = await screen.findByLabelText(/任务 后端实现，状态：可立即领取/);
    expect(row).toHaveAttribute('id', 'requirement-task-task-1');
    await waitFor(() => expect(row).toHaveClass('is-task-focus'));
    await waitFor(() => expect(row).toHaveFocus());
    expect(screen.getByTestId('location')).toHaveTextContent('tasks|task-1');
    expect(screen.getByRole('tab', { name: /任务/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('带 taskId 的链接刷新后仍能恢复页签与定位；无效 taskId 会被清理并提示', async () => {
    mockFetch(handler({ body: detail({ tasks: [task()] }), withDefinitions: true }));
    const first = renderDetail('/requirements/DEMO-001?tab=tasks&taskId=task-1');
    const restored = await screen.findByLabelText(/任务 后端实现/);
    await waitFor(() => expect(restored).toHaveClass('is-task-focus'));
    first.unmount();

    renderDetail('/requirements/DEMO-001?tab=tasks&taskId=missing-task');
    expect(await screen.findByText(/未找到该任务/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('tasks|'),
    );
  });

  it('依赖信息可用时：无前置任务可领取，前置未完成显示等待前置任务', async () => {
    mockFetch(
      handler({
        body: detail({
          tasks: [
            task(),
            task({ id: 'task-2', stepKey: 'verify', role: { key: 'qa', title: '测试' } }),
          ],
          counts: { tasks: 2, artifacts: 0, reviews: 0, changes: 0 },
        }),
        withDefinitions: true,
      }),
    );

    renderDetail('/requirements/DEMO-001?tab=tasks');

    expect(await screen.findAllByText('可立即领取')).not.toHaveLength(0);
    expect(screen.getAllByText('等待前置任务').length).toBeGreaterThan(0);
    expect(screen.getByText(/前置步骤 backend-impl 尚未完成/)).toBeInTheDocument();
  });

  it('依赖信息不可用时显示「状态待确认」，不显示「可立即领取」', async () => {
    mockFetch(handler({ body: detail({ tasks: [task()] }), withDefinitions: false }));

    renderDetail('/requirements/DEMO-001?tab=tasks');

    expect((await screen.findAllByText('状态待确认')).length).toBeGreaterThan(0);
    expect(screen.queryByText('可立即领取', { selector: 'em' })).not.toBeInTheDocument();
    expect(screen.getByText(/服务端没有提供可用的依赖信息/)).toBeInTheDocument();
  });

  it('流程未初始化时，普通成员看到管理员与下一步，而不是空按钮', async () => {
    useAuthStore.getState().setSession({ id: 'u-2', email: 'bob@example.com' });
    const base = handler({ body: detail() });
    mockFetch((url, init) => {
      const path = pathOf(url);
      if (path === '/api/v1/projects/p1/members')
        return {
          status: 200,
          body: envelope([
            {
              id: 'u-1',
              email: 'owner@example.com',
              name: 'Owner',
              role: 'OWNER',
              version: 1,
            },
            { id: 'u-2', email: 'bob@example.com', name: 'Bob', role: 'MEMBER', version: 1 },
          ]),
        };
      if (path === '/api/v1/projects/p1/roles') return { status: 200, body: envelope([]) };
      if (path === '/api/v1/projects/p1/workflow-definitions')
        return {
          status: 200,
          body: envelope({
            items: [
              {
                workflowKey: 'standard',
                title: '标准交付流程',
                version: 2,
                currentRevision: 1,
                currentPublishedRevisionId: 'rev-1',
              },
            ],
            nextCursor: null,
          }),
        };
      return base(url, init);
    });
    renderDetail('/requirements/DEMO-001');
    expect((await screen.findAllByText(/流程实例尚未创建/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/项目管理员/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
  });
});
