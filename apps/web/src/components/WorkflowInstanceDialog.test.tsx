import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../api/client';
import type { RoleView, WorkflowDefinitionView, WorkflowStepDefinition } from '../api/resources';
import { bodyOf, envelope, methodOf, mockFetch, pathOf } from '../test-utils';
import { WorkflowInstanceDialog } from './WorkflowInstanceDialog';

const requirement = {
  id: 'req-1',
  projectId: 'p1',
  seq: 1,
  code: 'DEMO-REQ-1',
  title: '结算流程',
  description: null,
  version: 2,
  generation: 1,
  phase: 'DISCOVERY',
  workStatus: 'ACTIVE',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const roles: RoleView[] = [
  { id: 'r-product', projectId: 'p1', key: 'product', title: '产品', isActive: true },
  { id: 'r-frontend', projectId: 'p1', key: 'frontend', title: '前端', isActive: true },
];

const members = [
  { id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'OWNER', version: 1 },
  { id: 'u-2', email: 'bob@example.com', name: 'Bob', role: 'MEMBER', version: 1 },
];

const publishedDefinition: WorkflowDefinitionView = {
  workflowKey: 'standard',
  title: '标准交付流程',
  version: 2,
  currentRevision: 1,
  currentPublishedRevisionId: 'rev-1',
};

const baseDefinition: Record<string, unknown> = {
  steps: [
    { key: 'prd', roleKey: 'product', deps: [] },
    { key: 'impl', roleKey: 'frontend', deps: ['prd'], outputKinds: ['IMPL'] },
  ] satisfies WorkflowStepDefinition[],
  roleSlots: [{ key: 'release-acceptance', roleKey: 'product' }],
};

const onlyImplDefinition: Record<string, unknown> = {
  steps: [{ key: 'impl', roleKey: 'frontend', outputKinds: ['IMPL'] }],
  roleSlots: [{ key: 'release-acceptance', roleKey: 'product' }],
};

const repository = {
  id: 'repo-1',
  adapter: 'github',
  externalId: 'yesgoo/yifanfan',
  owner: 'yesgoo',
  name: 'yifanfan',
  defaultBranch: 'main',
  createdAt: '2026-11-01T00:00:00.000Z',
};

interface HandlerOptions {
  definition?: Record<string, unknown>;
  repositories?: unknown[];
  acceptanceKeys?: string[];
  postStatus?: number;
  postBody?: unknown;
  postCalls?: { count: number };
  /** 让仓库列表与需求详情请求挂起：用于断言打开弹窗时的加载状态。 */
  contextGate?: Promise<void>;
  /** 让提交流程请求挂起：用于断言提交中的按钮状态。 */
  postGate?: Promise<void>;
}

function handler(options: HandlerOptions = {}) {
  return async (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/projects/p1/repositories' && method === 'GET') {
      if (options.contextGate) await options.contextGate;
      return { status: 200, body: envelope(options.repositories ?? []) };
    }
    if (path === '/api/v1/projects/p1/requirements/req-1' && method === 'GET') {
      if (options.contextGate) await options.contextGate;
      return {
        status: 200,
        body: envelope({
          requirement,
          acceptanceKeys: options.acceptanceKeys ?? [],
          tasks: [],
          artifacts: [],
          reviews: [],
          changes: [],
          counts: { tasks: 0, artifacts: 0, reviews: 0, changes: 0 },
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
          definition: options.definition ?? {},
        }),
      };
    if (path === '/api/v1/requirements/req-1/workflow-instances' && method === 'POST') {
      if (options.postCalls) options.postCalls.count += 1;
      if (options.postGate) await options.postGate;
      return {
        status: options.postStatus ?? 201,
        body: options.postBody ?? envelope({ instanceId: 'inst-1', requirementVersion: 3 }),
      };
    }
    return undefined;
  };
}

function renderDialog(options: HandlerOptions = {}) {
  const mock = mockFetch(handler(options));
  const onCreated = vi.fn();
  const onClose = vi.fn();
  const onCreateFailed = vi.fn();
  render(
    <WorkflowInstanceDialog
      open
      requirement={requirement}
      definitions={[publishedDefinition]}
      roles={roles}
      members={members}
      onClose={onClose}
      onCreated={onCreated}
      onCreateFailed={onCreateFailed}
    />,
  );
  return { mock, onCreated, onClose, onCreateFailed };
}

function fillOwnersAndApprover() {
  fireEvent.change(screen.getByLabelText('步骤 prd 责任人'), { target: { value: 'u-2' } });
  fireEvent.change(screen.getByLabelText('步骤 impl 责任人'), { target: { value: 'u-1' } });
  fireEvent.change(screen.getByLabelText('审批槽 release-acceptance 审批人'), {
    target: { value: 'u-1' },
  });
}

function postCallOf(mock: ReturnType<typeof mockFetch>) {
  return mock.mock.calls.find(
    ([url, init]) =>
      pathOf(String(url)) === '/api/v1/requirements/req-1/workflow-instances' &&
      methodOf(init ?? {}) === 'POST',
  );
}

describe('WorkflowInstanceDialog（初始化流程实例的可推进性）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
  });

  afterEach(() => {
    setCsrfToken(null);
  });

  it('顶部显示准备度与缺项摘要，点击缺项会滚动并聚焦对应下拉', async () => {
    renderDialog({ definition: baseDefinition, repositories: [] });

    expect(await screen.findByText('初始化准备度：已完成 0 / 4 项')).toBeInTheDocument();
    expect(screen.getByText('缺项 4 项')).toBeInTheDocument();
    expect(screen.getByText('缺项摘要（4 项）')).toBeInTheDocument();

    // 三条必填责任人/审批人 + 项目还没有登记仓库。
    expect(screen.getByText('步骤 prd（产品）责任人未选择')).toBeInTheDocument();
    expect(screen.getByText('步骤 impl（前端）责任人未选择')).toBeInTheDocument();
    expect(screen.getByText('审批槽 release-acceptance（产品）审批人未选择')).toBeInTheDocument();
    expect(screen.getByText('项目还没有登记代码仓库')).toBeInTheDocument();
    expect(screen.getByText('建议先处理')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /步骤 prd（产品）责任人未选择/ }));
    expect(screen.getByLabelText('步骤 prd 责任人')).toHaveFocus();
  });

  it('缺项字段带 aria-invalid 与可见的错误说明（aria-describedby）', async () => {
    renderDialog({ definition: baseDefinition, repositories: [] });
    await screen.findByText('初始化准备度：已完成 0 / 4 项');

    const ownerSelect = screen.getByLabelText('步骤 prd 责任人');
    expect(ownerSelect).toHaveAttribute('aria-invalid', 'true');
    const describedBy = ownerSelect.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy ?? '');
    expect(description).not.toBeNull();
    expect(description).toHaveTextContent(/未选择责任人/);

    const approverSelect = screen.getByLabelText('审批槽 release-acceptance 审批人');
    expect(approverSelect).toHaveAttribute('aria-invalid', 'true');
  });

  it('五个分组标题都存在', async () => {
    renderDialog({ definition: baseDefinition, repositories: [repository] });

    expect(await screen.findByRole('heading', { name: '基本信息' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '步骤责任人' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '仓库和代码来源' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '评审与验收' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '发布配置' })).toBeInTheDocument();

    // 发布配置是只读摘要：流程 key、修订号与 digest 前 12 位，没有新增输入。
    const publishSection = screen.getByRole('region', { name: '发布配置' });
    expect(publishSection).toHaveTextContent('standard');
    expect(publishSection).toHaveTextContent('第 1 版');
    expect(publishSection).toHaveTextContent('d'.repeat(12));
    expect(within(publishSection).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('未完成时按钮禁用并显示原因，全部补齐后可提交', async () => {
    const { onCreated } = renderDialog({
      definition: baseDefinition,
      repositories: [repository],
      acceptanceKeys: ['A1'],
    });

    expect(await screen.findByText(/还不能提交：还有 3 项未完成/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();

    fillOwnersAndApprover();

    await waitFor(() => expect(screen.getByRole('button', { name: '确认创建' })).toBeEnabled());
    expect(screen.queryByText(/还不能提交/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith('需求 DEMO-REQ-1 的流程实例已创建。'),
    );
  });

  it('服务端 409 失败：保留已填内容、显示错误与 requestId，并可重试提交', async () => {
    const postCalls = { count: 0 };
    const { mock } = renderDialog({
      definition: baseDefinition,
      repositories: [repository],
      acceptanceKeys: ['A1'],
      postStatus: 409,
      postBody: {
        error: {
          code: 'WORKFLOW_SELF_REVIEW',
          message: '不能自审：审批人与责任人相同',
          requestId: 'rid-9',
        },
      },
      postCalls,
    });

    await screen.findByText(/还不能提交：还有 3 项未完成/);
    fillOwnersAndApprover();
    await waitFor(() => expect(screen.getByRole('button', { name: '确认创建' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));

    expect(await screen.findByText(/WORKFLOW_SELF_REVIEW/)).toBeInTheDocument();
    expect(screen.getByText(/requestId rid-9/)).toBeInTheDocument();
    // 已填内容不被清空。
    expect(screen.getByLabelText('步骤 prd 责任人')).toHaveValue('u-2');
    expect(screen.getByLabelText('审批槽 release-acceptance 审批人')).toHaveValue('u-1');
    // 错误关键词指向评审与验收分组。
    expect(screen.getByText(/可能与该分组配置有关/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '跳到「评审与验收」' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试提交' }));
    await waitFor(() => expect(postCalls.count).toBe(2));
    expect(postCallOf(mock)).toBeTruthy();
  });

  it('提交失败会回调 onCreateFailed（含 requestId），供详情页保持 CREATE_FAILED', async () => {
    const { onCreateFailed } = renderDialog({
      definition: baseDefinition,
      repositories: [repository],
      acceptanceKeys: ['A1'],
      postStatus: 409,
      postBody: {
        error: {
          code: 'WORKFLOW_SELF_REVIEW',
          message: '不能自审：审批人与责任人相同',
          requestId: 'rid-failed',
        },
      },
    });

    await screen.findByText(/还不能提交：还有 3 项未完成/);
    fillOwnersAndApprover();
    await waitFor(() => expect(screen.getByRole('button', { name: '确认创建' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));

    await waitFor(() =>
      expect(onCreateFailed).toHaveBeenCalledWith({
        message: expect.stringContaining('WORKFLOW_SELF_REVIEW'),
        requestId: 'rid-failed',
      }),
    );
    expect(onCreateFailed).toHaveBeenCalledTimes(1);
  });

  it('自审冲突出现在缺项摘要并阻断提交', async () => {
    renderDialog({
      definition: baseDefinition,
      repositories: [repository],
      acceptanceKeys: ['A1'],
    });

    await screen.findByText(/还不能提交：还有 3 项未完成/);
    fireEvent.change(screen.getByLabelText('步骤 prd 责任人'), { target: { value: 'u-1' } });
    fireEvent.change(screen.getByLabelText('步骤 impl 责任人'), { target: { value: 'u-2' } });
    fireEvent.change(screen.getByLabelText('审批槽 release-acceptance 审批人'), {
      target: { value: 'u-1' },
    });

    expect(
      await screen.findByRole('button', {
        name: /「release-acceptance」审批人与「prd」责任人是同一人/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/不能自审/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();

    const approverSelect = screen.getByLabelText('审批槽 release-acceptance 审批人');
    expect(approverSelect).toHaveAttribute('aria-invalid', 'true');
    const describedBy = approverSelect.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toMatch(/自审冲突/);
  });

  it('IMPL 步骤没有仓库时给出仓库缺项；项目无仓库时给出「项目还没有登记代码仓库」', async () => {
    renderDialog({ definition: baseDefinition, repositories: [] });

    await screen.findByText('初始化准备度：已完成 0 / 4 项');
    expect(screen.getByText('项目还没有登记代码仓库')).toBeInTheDocument();
    // 项目完全没有仓库时只给一个「先登记仓库」的条目，不逐步骤重复。
    expect(screen.queryByText('步骤 impl 未选择代码仓库')).not.toBeInTheDocument();
    expect(screen.getByText(/还没有可用的代码仓库/)).toBeInTheDocument();

    const ownerInput = screen.getByLabelText('仓库 owner');
    expect(ownerInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = ownerInput.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toMatch(/需要先登记代码仓库/);
    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();
  });

  it('单仓库自动选中、验收默认归属验证步骤，并按原 payload 提交', async () => {
    const { mock, onCreated } = renderDialog({
      definition: onlyImplDefinition,
      repositories: [repository],
      acceptanceKeys: ['A1'],
    });

    await screen.findByText(/还不能提交：还有 2 项未完成/);
    fireEvent.change(screen.getByLabelText('步骤 impl 责任人'), { target: { value: 'u-2' } });
    fireEvent.change(screen.getByLabelText('审批槽 release-acceptance 审批人'), {
      target: { value: 'u-1' },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '确认创建' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith('需求 DEMO-REQ-1 的流程实例已创建。'),
    );

    const body = bodyOf(postCallOf(mock)?.[1] ?? {});
    expect(body.definitionRevisionId).toBe('rev-1');
    expect(body.expectedRequirementVersion).toBe(2);
    expect(body.stepBindings).toEqual([
      {
        stepKey: 'impl',
        roleId: 'r-frontend',
        responsibleUserId: 'u-2',
        repositoryIds: ['repo-1'],
        acceptanceKeys: ['A1'],
      },
    ]);
    expect(body.roleSlotBindings).toEqual([
      { slotKey: 'release-acceptance', roleId: 'r-product', userId: 'u-1' },
    ]);
  });

  it('没有已发布流程时给出明确空态', async () => {
    mockFetch(handler({}));
    render(
      <WorkflowInstanceDialog
        open
        requirement={requirement}
        definitions={[]}
        roles={roles}
        members={members}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/还没有已发布流程|该项目还没有已发布的流程定义/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();
  });

  it('打开时先显示 role="status" 的加载态，仓库与验收读完才渲染表单', async () => {
    let releaseContext: () => void = () => undefined;
    const contextGate = new Promise<void>((resolve) => {
      releaseContext = resolve;
    });
    mockFetch(
      handler({
        definition: baseDefinition,
        repositories: [repository],
        acceptanceKeys: ['A1'],
        contextGate,
      }),
    );
    render(
      <WorkflowInstanceDialog
        open
        requirement={requirement}
        definitions={[publishedDefinition]}
        roles={roles}
        members={members}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '初始化流程实例' });
    const loadingRegion = within(dialog).getByRole('status');
    expect(loadingRegion).toHaveTextContent(/正在读取/);
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: '确认创建' })).toBeDisabled();
    // 加载中不渲染可能被误提交的空表单（例如仓库登记表单）。
    expect(screen.queryByLabelText('仓库 owner')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('步骤 prd 责任人')).not.toBeInTheDocument();

    await act(async () => {
      releaseContext();
    });

    expect(await screen.findByLabelText('步骤 prd 责任人')).toBeInTheDocument();
    expect(screen.queryByLabelText('仓库 owner')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
  });

  it('提交中按钮显示“提交中…”并禁用，不会重复提交', async () => {
    let releasePost: () => void = () => undefined;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    const postCalls = { count: 0 };
    const { onCreated } = renderDialog({
      definition: baseDefinition,
      repositories: [repository],
      acceptanceKeys: ['A1'],
      postGate,
      postCalls,
    });

    await screen.findByText(/还不能提交：还有 3 项未完成/);
    fillOwnersAndApprover();
    await waitFor(() => expect(screen.getByRole('button', { name: '确认创建' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));

    const busyButton = screen.getByRole('button', { name: '提交中…' });
    expect(busyButton).toBeDisabled();
    expect(screen.getByRole('dialog', { name: '初始化流程实例' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    fireEvent.click(busyButton);
    expect(postCalls.count).toBe(1);

    await act(async () => {
      releasePost();
    });
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith('需求 DEMO-REQ-1 的流程实例已创建。'),
    );
  });
});
