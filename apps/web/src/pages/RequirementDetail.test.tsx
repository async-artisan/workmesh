import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  definition?: unknown;
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
            definition: input.definition ?? definition,
          }),
        };
      }
    }
    return undefined;
  };
}

function LocationProbe() {
  const [params] = useSearchParams();
  return (
    <div data-testid="location">{`${params.get('tab') ?? ''}|${params.get('taskId') ?? ''}`}</div>
  );
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
              stepDisplayName: '后端交付',
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
    expect(screen.getByText('责任人')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开团队视图' }));
    const taskOwnerLabels = screen.getAllByText(/bob@example.com/);
    expect(taskOwnerLabels.some((node) => node.closest('.pipeline-task-card'))).toBe(true);
    expect(screen.getAllByText('等待审批').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /去签字/ }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /交付物/ }));
    expect(screen.getByText(/sha256 aaaaaaaaaaaa/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /sha256 aaaaaaaaaaaa/ }));
    expect(screen.getByLabelText('sha256完整值')).toHaveTextContent('a'.repeat(64));

    fireEvent.click(screen.getByRole('tab', { name: /评审/ }));
    expect(screen.getByText('任务验收')).toBeInTheDocument();
    expect(screen.getByText('后端交付')).toBeInTheDocument();
  });

  it('流程图点击任务后切到任务页签、定位并临时高亮，且 URL 记录 taskId', async () => {
    mockFetch(
      handler({
        body: detail({
          tasks: [
            task(),
            task({ id: 'task-2', stepKey: 'verify', role: { key: 'qa', title: '测试' } }),
          ],
        }),
        withDefinitions: true,
      }),
    );

    renderDetail('/requirements/DEMO-001');

    // 协作流程图默认折叠，先展开团队视图才能点击任务卡。
    fireEvent.click(await screen.findByRole('button', { name: '展开团队视图' }));
    const card = await screen.findByRole('button', { name: /后端实现，状态：可立即领取/ });
    expect(card.tagName).toBe('BUTTON');
    fireEvent.click(card);

    const row = await screen.findByRole('group', { name: /后端实现.*可立即领取/ });
    expect(row).toHaveAttribute('id', 'requirement-task-task-1');
    expect(row).toHaveAttribute('data-task-id', 'task-1');
    expect(row).toHaveAttribute('tabindex', '-1');
    expect(row).toHaveAccessibleName(/后端实现.*可立即领取/);
    const labelledBy = row.getAttribute('aria-labelledby') ?? '';
    const titleId = labelledBy.split(' ')[0];
    expect(document.getElementById(titleId)?.textContent).toContain('后端实现');
    const taskDetails = row.querySelector('details');
    expect(taskDetails).toBeTruthy();
    expect(taskDetails?.open).toBe(true);
    expect(within(row).getByText(/任务 ID：/)).toBeInTheDocument();
    // 任务行本身可被程序化聚焦（流程图/链接定位依赖这一点）。
    (row as HTMLElement).focus();
    expect(row).toHaveFocus();
    await waitFor(() => expect(row).toHaveClass('is-task-focus'));
    await waitFor(() => expect(row).toHaveFocus());
    expect(screen.getByTestId('location')).toHaveTextContent('tasks|task-1');
    expect(screen.getByRole('tab', { name: /任务/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('连续定位只展开并聚焦最后一个目标任务', async () => {
    mockFetch(
      handler({
        body: detail({
          tasks: [
            task(),
            task({ id: 'task-2', stepKey: 'verify', role: { key: 'qa', title: '测试' } }),
          ],
        }),
        withDefinitions: true,
      }),
    );
    renderDetail('/requirements/DEMO-001');
    fireEvent.click(await screen.findByRole('button', { name: '展开团队视图' }));
    await screen.findByRole('button', { name: /后端实现，状态：可立即领取/ });

    const cards = document.querySelectorAll<HTMLButtonElement>('.pipeline-task-card');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(cards[0]);
    const firstRow = await screen.findByRole('group', { name: /后端实现/ });
    await waitFor(() => expect(firstRow).toHaveFocus());

    fireEvent.click(cards[1]);
    const secondRow = await screen.findByRole('group', { name: /测试/ });
    await waitFor(() => expect(secondRow).toHaveFocus());
    expect(secondRow).toHaveClass('is-task-focus');
    expect(secondRow.querySelector('details')?.open).toBe(true);
    await waitFor(() => expect(firstRow).not.toHaveClass('is-task-focus'));
    expect(firstRow.querySelector('details')?.open).toBe(false);
    expect(screen.getByTestId('location')).toHaveTextContent('tasks|task-2');
  });

  it('带 taskId 的链接刷新后仍能恢复页签与定位；无效 taskId 会被清理并提示', async () => {
    mockFetch(handler({ body: detail({ tasks: [task()] }), withDefinitions: true }));
    const first = renderDetail('/requirements/DEMO-001?tab=tasks&taskId=task-1');
    const restored = await screen.findByRole('group', { name: /后端实现/ });
    await waitFor(() => expect(restored).toHaveClass('is-task-focus'));
    first.unmount();

    renderDetail('/requirements/DEMO-001?tab=tasks&taskId=missing-task');
    expect(await screen.findByText(/未找到该任务/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('tasks|'));
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

  it('使用实例绑定修订返回的独立步骤名称，未提供时继续回退到既有映射', async () => {
    mockFetch(
      handler({
        body: detail({ tasks: [task({ stepDisplayName: '服务端交付' })] }),
        withDefinitions: true,
      }),
    );
    renderDetail('/requirements/DEMO-001?tab=tasks');
    expect(await screen.findByText('服务端交付')).toBeInTheDocument();
    expect(screen.queryByText('后端实现')).not.toBeInTheDocument();
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

const adminMember = {
  id: 'u-1',
  email: 'alice@example.com',
  name: 'Alice',
  role: 'OWNER',
  version: 1,
};
const ordinaryMember = {
  id: 'u-2',
  email: 'bob@example.com',
  name: 'Bob',
  role: 'MEMBER',
  version: 1,
};
const teamMembers = [adminMember, ordinaryMember];
const roleFixtures = [
  { id: 'r-product', projectId: 'p1', key: 'product', title: '产品', isActive: true },
];
const oneStepDefinition = {
  steps: [{ key: 'prd', roleKey: 'product', deps: [] }],
  roleSlots: [],
};
const publishedDefinitions = [
  {
    workflowKey: 'standard',
    title: '标准交付流程',
    version: 2,
    currentRevision: 1,
    currentPublishedRevisionId: 'rev-1',
  },
];
const unpublishedDefinitions = [
  {
    workflowKey: 'standard',
    title: '标准交付流程',
    version: 1,
    currentRevision: 0,
    currentPublishedRevisionId: null,
  },
];

interface InitHandlerOptions {
  membersStatus?: number;
  membersFailFirst?: boolean;
  membersCalls?: { count: number };
  members?: unknown[];
  rolesStatus?: number;
  rolesFailAfterFirst?: boolean;
  rolesCalls?: { count: number };
  definitionsStatus?: number;
  definitionsFailAfterFirst?: boolean;
  definitionsCalls?: { count: number };
  definitions?: unknown[];
  createStatus?: number;
  createBody?: unknown;
}

/** 初始化上下文测试：成员/角色/定义/创建实例全覆盖，便于构造失败与重试。 */
function initHandler(options: InitHandlerOptions = {}) {
  const base = handler({ body: detail() });
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = (init.method ?? 'GET').toUpperCase();
    if (path === '/api/v1/projects/p1/members' && method === 'GET') {
      if (options.membersCalls) options.membersCalls.count += 1;
      const firstCallFailed = Boolean(
        options.membersFailFirst && options.membersCalls?.count === 1,
      );
      const failStatus = options.membersStatus ?? (firstCallFailed ? 500 : undefined);
      if (failStatus && failStatus >= 400)
        return {
          status: failStatus,
          body: {
            error: {
              code: failStatus === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR',
              message: '无法读取项目成员',
              requestId: 'rid-members',
            },
          },
        };
      return { status: 200, body: envelope(options.members ?? teamMembers) };
    }
    if (path === '/api/v1/projects/p1/roles' && method === 'GET') {
      if (options.rolesCalls) options.rolesCalls.count += 1;
      const failAfterFirst = Boolean(
        options.rolesFailAfterFirst && (options.rolesCalls?.count ?? 0) > 1,
      );
      const failStatus = options.rolesStatus ?? (failAfterFirst ? 500 : undefined);
      if (failStatus && failStatus >= 400)
        return {
          status: failStatus,
          body: {
            error: {
              code: failStatus === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR',
              message: '无法读取项目角色',
              requestId: 'rid-roles',
            },
          },
        };
      return { status: 200, body: envelope(roleFixtures) };
    }
    if (path === '/api/v1/projects/p1/workflow-definitions' && method === 'GET') {
      if (options.definitionsCalls) options.definitionsCalls.count += 1;
      const failAfterFirst = Boolean(
        options.definitionsFailAfterFirst && (options.definitionsCalls?.count ?? 0) > 1,
      );
      const failStatus = options.definitionsStatus ?? (failAfterFirst ? 500 : undefined);
      if (failStatus && failStatus >= 400)
        return {
          status: failStatus,
          body: {
            error: {
              code: failStatus === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR',
              message: '无法读取流程定义',
              requestId: 'rid-definitions',
            },
          },
        };
      return {
        status: 200,
        body: envelope({
          items: options.definitions ?? publishedDefinitions,
          nextCursor: null,
        }),
      };
    }
    if (path === '/api/v1/workflow-definition-revisions/rev-1' && method === 'GET')
      return {
        status: 200,
        body: envelope({
          id: 'rev-1',
          projectId: 'p1',
          workflowKey: 'standard',
          revision: 1,
          digest: 'd'.repeat(64),
          definition: oneStepDefinition,
        }),
      };
    if (path === '/api/v1/projects/p1/repositories' && method === 'GET')
      return { status: 200, body: envelope([]) };
    if (path === '/api/v1/projects/p1/requirements/req-1' && method === 'GET')
      return { status: 200, body: envelope(detail()) };
    if (path === '/api/v1/requirements/req-1/workflow-instances' && method === 'POST') {
      if (options.createStatus && options.createStatus >= 400)
        return {
          status: options.createStatus,
          body: options.createBody ?? {
            error: {
              code: 'VERSION_CONFLICT',
              message: '需求版本已变化',
              requestId: 'rid-create',
            },
          },
        };
      return {
        status: 201,
        body: envelope({ instanceId: 'inst-new', requirementVersion: 4 }),
      };
    }
    return base(url, init);
  };
}

describe('RequirementDetail（返修：依赖完整性 / workStatus / 初始化权限 / CREATE_FAILED）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    localStorage.clear();
  });

  it('未知依赖不会被当成「无依赖」：显示状态待确认，不显示可立即领取', async () => {
    mockFetch(
      handler({
        body: detail({
          tasks: [task()],
          counts: { tasks: 1, artifacts: 0, reviews: 0, changes: 0 },
        }),
        withDefinitions: true,
        definition: {
          steps: [
            { key: 'backend-impl', roleKey: 'backend', deps: ['missing-step'] },
            { key: 'verify', roleKey: 'qa', deps: ['backend-impl'] },
          ],
        },
      }),
    );

    renderDetail('/requirements/DEMO-001?tab=tasks');

    expect((await screen.findAllByText('状态待确认')).length).toBeGreaterThan(0);
    expect(screen.getByText(/无法识别的依赖步骤/)).toBeInTheDocument();
    expect(screen.queryByText('可立即领取', { selector: '.status-tag' })).not.toBeInTheDocument();
  });

  it('定义缺少目标步骤：显示状态待确认，不显示可立即领取', async () => {
    mockFetch(
      handler({
        body: detail({
          tasks: [task()],
          counts: { tasks: 1, artifacts: 0, reviews: 0, changes: 0 },
        }),
        withDefinitions: true,
        definition: { steps: [{ key: 'verify', roleKey: 'qa', deps: [] }] },
      }),
    );

    renderDetail('/requirements/DEMO-001?tab=tasks');

    expect((await screen.findAllByText('状态待确认')).length).toBeGreaterThan(0);
    expect(screen.getByText(/找不到该任务的步骤/)).toBeInTheDocument();
    expect(screen.queryByText('可立即领取', { selector: '.status-tag' })).not.toBeInTheDocument();
  });

  it('OPEN 任务缺少 workStatus：显示状态待确认，不显示可立即领取', async () => {
    mockFetch(
      handler({
        body: detail({
          tasks: [task({ workStatus: undefined })],
          counts: { tasks: 1, artifacts: 0, reviews: 0, changes: 0 },
        }),
        withDefinitions: true,
      }),
    );

    renderDetail('/requirements/DEMO-001?tab=tasks');

    expect((await screen.findAllByText('状态待确认')).length).toBeGreaterThan(0);
    expect(screen.getByText(/缺少工作状态/)).toBeInTheDocument();
    expect(screen.queryByText('可立即领取', { selector: '.status-tag' })).not.toBeInTheDocument();
  });

  it('成员读取失败：明确显示权限上下文失败 + 重试，不冒充普通成员无权限', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
    mockFetch(initHandler({ membersStatus: 500 }));

    renderDetail('/requirements/DEMO-001');

    expect(
      (await screen.findAllByText('项目成员信息读取失败，暂时无法确认初始化权限')).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '重试读取权限信息' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
    expect(screen.queryByText(/当前账号没有初始化流程实例的权限/)).not.toBeInTheDocument();
    expect(screen.queryByText(/项目管理员：/)).not.toBeInTheDocument();
  });

  it('成员接口 403：明确显示没有初始化权限，且不提供重试', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
    mockFetch(initHandler({ membersStatus: 403 }));

    renderDetail('/requirements/DEMO-001');

    expect((await screen.findAllByText('当前账号没有初始化流程实例的权限')).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/无法读取项目成员与管理员名单/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试读取权限信息' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
    expect(screen.queryByText(/项目管理员：/)).not.toBeInTheDocument();
    expect(screen.getByText(/rid-members/)).toBeInTheDocument();
  });

  it('成员成功且当前用户是管理员：三个上下文都 ready 时才显示初始化入口', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
    mockFetch(initHandler());

    renderDetail('/requirements/DEMO-001');

    expect((await screen.findAllByRole('button', { name: '初始化流程' })).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByText(/权限上下文：成员 已读取 · 角色 已读取 · 流程定义 已读取/),
    ).toBeInTheDocument();
  });

  it('成员成功且当前用户是普通成员：显示等待管理员，而不是权限失败', async () => {
    useAuthStore.getState().setSession({ id: 'u-2', email: 'bob@example.com' });
    mockFetch(initHandler());

    renderDetail('/requirements/DEMO-001');

    expect((await screen.findAllByText(/流程实例尚未创建/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/当前账号没有初始化流程实例的权限/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
  });

  it('成员读取失败后重试成功：恢复管理员视图', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
    const membersCalls = { count: 0 };
    mockFetch(initHandler({ membersFailFirst: true, membersCalls }));

    renderDetail('/requirements/DEMO-001');

    expect(
      (await screen.findAllByText('项目成员信息读取失败，暂时无法确认初始化权限')).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '重试读取权限信息' }));

    expect((await screen.findAllByRole('button', { name: '初始化流程' })).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByText('项目成员信息读取失败，暂时无法确认初始化权限'),
    ).not.toBeInTheDocument();
    expect(membersCalls.count).toBeGreaterThan(1);
  });

  it('未发布定义与成员读取失败同时发生：不能显示「流程定义尚未发布」', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
    mockFetch(initHandler({ membersStatus: 500, definitions: unpublishedDefinitions }));

    renderDetail('/requirements/DEMO-001');

    expect(
      (await screen.findAllByText('项目成员信息读取失败，暂时无法确认初始化权限')).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/流程定义尚未发布/)).not.toBeInTheDocument();
  });

  it('角色首次读取失败：不显示未发布/无权限，提供重试并阻止初始化', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
    mockFetch(initHandler({ rolesStatus: 500 }));

    renderDetail('/requirements/DEMO-001');

    expect((await screen.findAllByText('项目角色暂时无法读取')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/rid-roles/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '重试读取角色信息' })).toBeInTheDocument();
    expect(screen.queryByText(/流程定义尚未发布/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前账号没有初始化流程实例的权限/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
    expect(screen.getByText(/角色 读取失败/)).toBeInTheDocument();
  });

  it('角色接口 403：显示暂时无法读取并可重试，不映射为没有初始化权限', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
    mockFetch(initHandler({ rolesStatus: 403 }));

    renderDetail('/requirements/DEMO-001');

    expect((await screen.findAllByText('项目角色暂时无法读取')).length).toBeGreaterThan(0);
    expect(screen.getByText(/角色接口返回 403/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试读取角色信息' })).toBeInTheDocument();
    expect(screen.queryByText(/当前账号没有初始化流程实例的权限/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
  });

  it('角色读取失败后仍保留上次成功的角色数据，但不能据此初始化', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
    const options: InitHandlerOptions = { rolesCalls: { count: 0 } };
    mockFetch(initHandler(options));

    renderDetail('/requirements/DEMO-001');
    expect((await screen.findAllByRole('button', { name: '初始化流程' })).length).toBeGreaterThan(
      0,
    );

    // 首次成功读取角色后，再刷新时让角色接口失败。
    options.rolesFailAfterFirst = true;
    fireEvent.click(screen.getByRole('button', { name: '刷新权限信息' }));

    expect((await screen.findAllByText('项目角色暂时无法读取')).length).toBeGreaterThan(0);
    expect(screen.getByText(/上次成功读取的角色：产品/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
    expect(screen.queryByText(/当前账号没有初始化流程实例的权限/)).not.toBeInTheDocument();
  });

  it('流程定义首次读取失败：不显示未发布/无权限，提供重试并阻止初始化', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
    mockFetch(initHandler({ definitionsStatus: 500 }));

    renderDetail('/requirements/DEMO-001');

    expect((await screen.findAllByText('流程定义暂时无法读取')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/rid-definitions/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '重试读取流程定义' })).toBeInTheDocument();
    expect(screen.queryByText(/流程定义尚未发布/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前账号没有初始化流程实例的权限/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
    expect(screen.getByText(/流程定义 读取失败/)).toBeInTheDocument();
  });

  it('流程定义接口 403：显示暂时无法读取并可重试，不显示未发布或没有初始化权限', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
    mockFetch(initHandler({ definitionsStatus: 403 }));

    renderDetail('/requirements/DEMO-001');

    expect((await screen.findAllByText('流程定义暂时无法读取')).length).toBeGreaterThan(0);
    expect(screen.getByText(/流程定义接口返回 403/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试读取流程定义' })).toBeInTheDocument();
    expect(screen.queryByText(/流程定义尚未发布/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前账号没有初始化流程实例的权限/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
  });

  it('普通成员看到真实管理员姓名/邮箱、mailto 和复制入口，且没有初始化按钮', async () => {
    useAuthStore.getState().setSession({ id: 'u-2', email: 'bob@example.com' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    mockFetch(initHandler());

    renderDetail('/requirements/DEMO-001');

    expect((await screen.findAllByText(/项目管理员/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/alice@example\.com/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '邮件联系管理员' })).toHaveAttribute(
      'href',
      'mailto:alice@example.com',
    );
    fireEvent.click(screen.getByRole('button', { name: '复制管理员联系方式' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('alice@example.com'));
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
  });

  it('没有管理员联系信息时不编造姓名或邮箱', async () => {
    useAuthStore.getState().setSession({ id: 'u-2', email: 'bob@example.com' });
    mockFetch(initHandler({ members: [ordinaryMember] }));

    renderDetail('/requirements/DEMO-001');

    expect(await screen.findByText('当前无法读取管理员联系方式。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '复制管理员联系方式' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '邮件联系管理员' })).not.toBeInTheDocument();
  });

  it('流程定义读取失败后仍保留上次成功的定义数据，但不能判断未发布或初始化', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
    const options: InitHandlerOptions = { definitionsCalls: { count: 0 } };
    mockFetch(initHandler(options));

    renderDetail('/requirements/DEMO-001');
    expect((await screen.findAllByRole('button', { name: '初始化流程' })).length).toBeGreaterThan(
      0,
    );

    options.definitionsFailAfterFirst = true;
    fireEvent.click(screen.getByRole('button', { name: '刷新权限信息' }));

    expect((await screen.findAllByText('流程定义暂时无法读取')).length).toBeGreaterThan(0);
    expect(screen.getByText(/上次成功读取的流程定义：标准交付流程（已发布）/)).toBeInTheDocument();
    expect(screen.queryByText(/流程定义尚未发布/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
  });

  it('初始化提交失败：关闭弹窗后仍显示 CREATE_FAILED，可重新打开并重试成功', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
    const options: InitHandlerOptions = { createStatus: 409 };
    mockFetch(initHandler(options));

    renderDetail('/requirements/DEMO-001');

    const initButtons = await screen.findAllByRole('button', { name: '初始化流程' });
    fireEvent.click(initButtons[0]);
    const ownerSelect = await screen.findByLabelText('步骤 prd 责任人');
    fireEvent.change(ownerSelect, { target: { value: 'u-1' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '确认创建' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));

    expect((await screen.findAllByText(/requestId rid-create/)).length).toBeGreaterThan(0);
    // 关闭弹窗：详情页保持失败状态，而不是回到「尚未创建」。
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect((await screen.findAllByText('流程初始化失败')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/rid-create/).length).toBeGreaterThan(0);
    expect(screen.queryByText('流程实例尚未创建')).not.toBeInTheDocument();
    expect(
      (await screen.findAllByRole('button', { name: '重新初始化流程' })).length,
    ).toBeGreaterThan(0);

    // 重新打开后，之前填写的责任人仍保留。
    fireEvent.click(screen.getAllByRole('button', { name: '重新初始化流程' })[0]);
    expect(await screen.findByLabelText('步骤 prd 责任人')).toHaveValue('u-1');

    options.createStatus = 0;
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));
    expect(await screen.findByText('需求 DEMO-001 的流程实例已创建。')).toBeInTheDocument();
    expect(screen.queryByText('流程初始化失败')).not.toBeInTheDocument();
  });
});

const sixStepDefinition = {
  steps: [
    { key: 'prd', roleKey: 'product', deps: [] },
    { key: 'design', roleKey: 'ui', deps: ['prd'] },
    { key: 'impl-fe', roleKey: 'frontend', deps: ['design'] },
    { key: 'impl-be', roleKey: 'backend', deps: ['design'] },
    { key: 'verify', roleKey: 'qa', deps: ['impl-fe', 'impl-be'] },
    { key: 'release', roleKey: 'ops', deps: ['verify'] },
  ],
  roleSlots: [],
};

/** 与演示数据同构的 6 任务需求：prd/design/impl-fe/impl-be/verify/release 各一个。 */
const sixTasks = [
  task({
    id: 'task-prd',
    stepKey: 'prd',
    role: { key: 'product', title: '产品' },
    workStatus: 'PAUSED',
  }),
  task({ id: 'task-design', stepKey: 'design', role: { key: 'ui', title: '设计' } }),
  task({
    id: 'task-impl-fe',
    stepKey: 'impl-fe',
    role: { key: 'frontend', title: '前端' },
    executionStatus: 'DONE',
  }),
  task({ id: 'task-impl-be', stepKey: 'impl-be', role: { key: 'backend', title: '后端' } }),
  task({ id: 'task-verify', stepKey: 'verify', role: { key: 'qa', title: '测试' } }),
  task({ id: 'task-release', stepKey: 'release', role: { key: 'ops', title: '运维' } }),
];

describe('RequirementDetail（首屏折叠 / 本地头像 / 任务去重）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    localStorage.clear();
  });

  it('协作流程图默认折叠为一行动摘要，扩展后 6 张任务卡与统计/页签同源，且无 duplicate key', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch(
      handler({
        body: detail({
          tasks: sixTasks,
          counts: { tasks: sixTasks.length, artifacts: 0, reviews: 0, changes: 0 },
        }),
        withDefinitions: true,
        definition: sixStepDefinition,
      }),
    );

    renderDetail('/requirements/DEMO-001');

    expect(await screen.findByText('登录页改版')).toBeInTheDocument();
    const pipeline = document.querySelector('.requirement-pipeline');
    expect(pipeline).toHaveClass('is-collapsed');

    const toggle = screen.getByRole('button', { name: '展开团队视图' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const detailId = toggle.getAttribute('aria-controls');
    expect(detailId).toBeTruthy();
    expect(document.getElementById(detailId!)).toHaveAttribute('hidden');
    // 折叠时任务卡不渲染，页面高度不被流程图撑开。
    expect(document.querySelectorAll('.pipeline-task-card')).toHaveLength(0);
    // 页签「任务 6」与折叠摘要的分母一致。
    expect(screen.getByRole('tab', { name: /任务\s*6/ })).toBeInTheDocument();
    expect(screen.getByText('阶段进度')).toBeInTheDocument();
    expect(screen.getByText('0/6')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(detailId!)).not.toHaveAttribute('hidden');
    expect(document.querySelectorAll('.pipeline-task-card')).toHaveLength(6);
    // 流程统计的完成数/分母与页签「任务 6」同源，不会出现重复任务导致的 1/7。
    expect(screen.getByText('1/6')).toBeInTheDocument();
    expect(screen.queryByText('1/7')).not.toBeInTheDocument();

    const duplicateKeyWarnings = consoleError.mock.calls
      .map((call) => String(call[0]))
      .filter((text) => text.includes('same key'));
    expect(duplicateKeyWarnings).toHaveLength(0);
    // 头像已本地化：页面没有第三方图片外链。
    expect(document.querySelectorAll('img[src^="http"]')).toHaveLength(0);
    expect(document.querySelectorAll('img[src*="trae-api"]')).toHaveLength(0);
    expect(document.querySelectorAll('.wm-role-avatar').length).toBeGreaterThan(0);
  });

  it('「更多」菜单支持 Escape 与点击外部关闭', async () => {
    mockFetch(handler({ body: detail() }));
    renderDetail('/requirements/DEMO-001');

    const moreButton = await screen.findByRole('button', { name: '更多' });
    fireEvent.click(moreButton);
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    fireEvent.click(moreButton);
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('需求页签支持方向键切换，并与 tabpanel 建立关联', async () => {
    mockFetch(handler({ body: detail() }));
    renderDetail('/requirements/DEMO-001');

    const overview = await screen.findByRole('tab', { name: /概览/ });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    expect(overview).toHaveAttribute('aria-controls', 'req-tabpanel');
    expect(overview).toHaveAttribute('tabindex', '0');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'req-tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'req-tab-overview');
    expect(screen.getByRole('tab', { name: /交付物/ })).toHaveAttribute('tabindex', '-1');

    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    const artifacts = screen.getByRole('tab', { name: /交付物/ });
    await waitFor(() => expect(artifacts).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(document.activeElement).toBe(artifacts));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'req-tab-artifacts');

    // End 跳到最后一项（追溯），Home 回到概览。
    fireEvent.keyDown(artifacts, { key: 'End' });
    expect(screen.getByRole('tab', { name: /追溯/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: /追溯/ }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: /概览/ })).toHaveAttribute('aria-selected', 'true');
  });
});
