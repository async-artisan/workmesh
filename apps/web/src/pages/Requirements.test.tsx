import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Requirements } from './Requirements';
import { setCsrfToken } from '../api/client';
import { useAuthStore } from '../store/auth';
import { bodyOf, envelope, methodOf, mockFetch, pathOf, useProject } from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 3 };
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
const roles = [
  { id: 'r-product', projectId: 'p1', key: 'product', title: '产品', isActive: true },
  { id: 'r-frontend', projectId: 'p1', key: 'frontend', title: '前端', isActive: true },
];
const members = [
  { id: 'u-1', email: 'alice@example.com', name: 'Alice', role: 'OWNER', version: 1 },
  { id: 'u-2', email: 'bob@example.com', name: 'Bob', role: 'MEMBER', version: 1 },
];
const publishedDefinition = {
  workflowKey: 'standard',
  title: '标准交付流程',
  version: 2,
  currentRevision: 1,
  currentPublishedRevisionId: 'rev-1',
};

function handler(input: {
  definitions?: unknown[];
  definition?: Record<string, unknown>;
  repositories?: unknown[];
  acceptanceKeys?: string[];
}) {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/projects' && method === 'GET')
      return { status: 200, body: envelope([project]) };
    if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
      return { status: 200, body: envelope({ items: [requirement], nextCursor: null }) };
    if (path === '/api/v1/projects/p1/members' && method === 'GET')
      return { status: 200, body: envelope(members) };
    if (path === '/api/v1/projects/p1/roles' && method === 'GET')
      return { status: 200, body: envelope(roles) };
    if (path === '/api/v1/projects/p1/repositories' && method === 'GET')
      return { status: 200, body: envelope(input.repositories ?? []) };
    if (path === '/api/v1/projects/p1/requirements/req-1' && method === 'GET')
      return {
        status: 200,
        body: envelope({
          requirement,
          acceptanceKeys: input.acceptanceKeys ?? [],
          tasks: [],
          artifacts: [],
          reviews: [],
          changes: [],
          counts: { tasks: 0, artifacts: 0, reviews: 0, changes: 0 },
        }),
      };
    if (path === '/api/v1/projects/p1/workflow-definitions' && method === 'GET')
      return { status: 200, body: envelope({ items: input.definitions ?? [], nextCursor: null }) };
    if (path === '/api/v1/workflow-definition-revisions/rev-1' && method === 'GET')
      return {
        status: 200,
        body: envelope({
          id: 'rev-1',
          projectId: 'p1',
          workflowKey: 'standard',
          revision: 1,
          digest: 'd'.repeat(64),
          definition: input.definition ?? {},
        }),
      };
    if (path === '/api/v1/requirements/req-1/workflow-instances' && method === 'POST')
      return { status: 201, body: envelope({ instanceId: 'inst-1', requirementVersion: 3 }) };
    return undefined;
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Requirements />
    </MemoryRouter>,
  );
}

describe('Requirements（流程实例只由管理员显式绑定）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
  });

  afterEach(() => {
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    localStorage.clear();
  });

  it('普通成员看不到初始化入口，只提交需求意图', async () => {
    useAuthStore.getState().setSession({ id: 'u-2', email: 'bob@example.com' });
    mockFetch(handler({ definitions: [publishedDefinition] }));

    renderPage();

    expect(await screen.findByText('DEMO-REQ-1')).toBeInTheDocument();
    expect(screen.getByText(/流程实例由项目管理员初始化/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '初始化流程' })).not.toBeInTheDocument();
  });

  it('管理员逐项选择责任人与审批人后创建实例', async () => {
    const mock = mockFetch(
      handler({
        definitions: [publishedDefinition],
        definition: {
          steps: [{ key: 'impl', roleKey: 'frontend', deps: [] }],
          roleSlots: [{ key: 'release-acceptance', roleKey: 'product' }],
        },
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '初始化流程' }));
    fireEvent.change(await screen.findByLabelText('步骤 impl 责任人'), {
      target: { value: 'u-2' },
    });
    fireEvent.change(await screen.findByLabelText('审批槽 release-acceptance 审批人'), {
      target: { value: 'u-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));

    expect(await screen.findByText(/流程实例已创建/)).toBeInTheDocument();

    const call = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/requirements/req-1/workflow-instances' &&
        methodOf(init ?? {}) === 'POST',
    );
    const body = bodyOf(call?.[1] ?? {});
    expect(body.definitionRevisionId).toBe('rev-1');
    expect(body.expectedRequirementVersion).toBe(2);
    expect(body.stepBindings).toEqual([
      {
        stepKey: 'impl',
        roleId: 'r-frontend',
        responsibleUserId: 'u-2',
        repositoryIds: [],
        acceptanceKeys: [],
      },
    ]);
    expect(body.roleSlotBindings).toEqual([
      { slotKey: 'release-acceptance', roleId: 'r-product', userId: 'u-1' },
    ]);
  });

  it('同角色审批人与责任人相同时阻断提交', async () => {
    mockFetch(
      handler({
        definitions: [publishedDefinition],
        definition: {
          steps: [{ key: 'prd', roleKey: 'product', deps: [] }],
          roleSlots: [{ key: 'product-approval', roleKey: 'product' }],
        },
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '初始化流程' }));
    fireEvent.change(await screen.findByLabelText('步骤 prd 责任人'), {
      target: { value: 'u-1' },
    });
    fireEvent.change(await screen.findByLabelText('审批槽 product-approval 审批人'), {
      target: { value: 'u-1' },
    });

    expect(await screen.findByText(/不能自审/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();
  });

  it('IMPL 步骤没有代码仓库时阻断提交，并提示先登记仓库', async () => {
    mockFetch(
      handler({
        definitions: [publishedDefinition],
        definition: {
          steps: [{ key: 'impl', roleKey: 'frontend', outputKinds: ['IMPL'] }],
          roleSlots: [{ key: 'release-acceptance', roleKey: 'product' }],
        },
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '初始化流程' }));
    fireEvent.change(await screen.findByLabelText('步骤 impl 责任人'), {
      target: { value: 'u-2' },
    });
    fireEvent.change(await screen.findByLabelText('审批槽 release-acceptance 审批人'), {
      target: { value: 'u-1' },
    });

    expect(await screen.findByText(/还没有登记代码仓库/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();
  });

  it('单仓库项目自动带上仓库，验收条目默认归到验证步骤', async () => {
    const mock = mockFetch(
      handler({
        definitions: [publishedDefinition],
        definition: {
          steps: [{ key: 'impl', roleKey: 'frontend', outputKinds: ['IMPL'] }],
          roleSlots: [{ key: 'release-acceptance', roleKey: 'product' }],
        },
        repositories: [
          {
            id: 'repo-1',
            adapter: 'github',
            externalId: 'yesgoo/yifanfan',
            owner: 'yesgoo',
            name: 'yifanfan',
            defaultBranch: 'main',
            createdAt: '2026-11-01T00:00:00.000Z',
          },
        ],
        acceptanceKeys: ['A1'],
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '初始化流程' }));
    fireEvent.change(await screen.findByLabelText('步骤 impl 责任人'), {
      target: { value: 'u-2' },
    });
    fireEvent.change(await screen.findByLabelText('审批槽 release-acceptance 审批人'), {
      target: { value: 'u-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));

    expect(await screen.findByText(/流程实例已创建/)).toBeInTheDocument();

    const call = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/requirements/req-1/workflow-instances' &&
        methodOf(init ?? {}) === 'POST',
    );
    const body = bodyOf(call?.[1] ?? {});
    expect(body.stepBindings).toEqual([
      {
        stepKey: 'impl',
        roleId: 'r-frontend',
        responsibleUserId: 'u-2',
        repositoryIds: ['repo-1'],
        acceptanceKeys: ['A1'],
      },
    ]);
  });
});
