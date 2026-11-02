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

const definition = {
  definition: {
    steps: [{ key: 'impl', roleKey: 'frontend', deps: [] }],
    roleSlots: [{ key: 'release-acceptance', roleKey: 'product' }],
  },
};

function handler(definitions: unknown[]) {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/projects' && method === 'GET')
      return { status: 200, body: envelope([project]) };
    if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
      return { status: 200, body: envelope({ items: [requirement], nextCursor: null }) };
    if (path === '/api/v1/projects/p1/roles' && method === 'GET')
      return { status: 200, body: envelope(roles) };
    if (path === '/api/v1/projects/p1/workflow-definitions' && method === 'GET')
      return { status: 200, body: envelope({ items: definitions, nextCursor: null }) };
    if (path === '/api/v1/workflow-definition-revisions/rev-1' && method === 'GET')
      return {
        status: 200,
        body: envelope({
          id: 'rev-1',
          projectId: 'p1',
          workflowKey: 'standard',
          revision: 1,
          digest: 'd'.repeat(64),
          ...definition,
        }),
      };
    if (path === '/api/v1/requirements/req-1/workflow-instances' && method === 'POST')
      return { status: 201, body: envelope({ instanceId: 'inst-1', requirementVersion: 3 }) };
    return undefined;
  };
}

describe('Requirements（流程修订只能从已发布定义里选）', () => {
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

  it('没有已发布定义时不给手填入口，而是指向流程页', async () => {
    mockFetch(handler([]));
    render(
      <MemoryRouter>
        <Requirements />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/还没有已发布的流程定义/)).toBeInTheDocument();
    expect(screen.queryByLabelText('已发布 workflow 修订')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建流程实例' })).toBeDisabled();
  });

  it('有已发布定义时默认选中，并用它创建实例', async () => {
    const mock = mockFetch(
      handler([
        {
          workflowKey: 'standard',
          title: '标准交付流程',
          version: 2,
          currentRevision: 1,
          currentPublishedRevisionId: 'rev-1',
        },
      ]),
    );
    render(
      <MemoryRouter>
        <Requirements />
      </MemoryRouter>,
    );

    const select = await screen.findByLabelText('已发布 workflow 修订');
    expect(select).toHaveValue('rev-1');
    expect(screen.getByRole('option', { name: /标准交付流程/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '创建流程实例' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认创建流程' }));

    expect(await screen.findByText(/流程实例已创建/)).toBeInTheDocument();

    const call = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/requirements/req-1/workflow-instances' &&
        methodOf(init ?? {}) === 'POST',
    );
    const body = bodyOf(call?.[1] ?? {});
    expect(body.definitionRevisionId).toBe('rev-1');
    expect(body.expectedRequirementVersion).toBe(2);
    // 角色与责任人由服务端可见的角色列表派生，不需要用户手填 UUID。
    expect(body.stepBindings).toEqual([
      { stepKey: 'impl', roleId: 'r-frontend', responsibleUserId: 'u-1', repositoryIds: [] },
    ]);
    expect(body.roleSlotBindings).toEqual([
      { slotKey: 'release-acceptance', roleId: 'r-product', userId: 'u-1' },
    ]);
  });
});
