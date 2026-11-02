import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Workflows } from './Workflows';
import { setCsrfToken } from '../api/client';
import {
  bodyOf,
  envelope,
  headersOf,
  methodOf,
  mockFetch,
  pathOf,
  useProject,
} from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 7 };
const roles = [
  { id: 'r-product', projectId: 'p1', key: 'product', title: '产品', isActive: true },
  { id: 'r-frontend', projectId: 'p1', key: 'frontend', title: '前端', isActive: true },
  { id: 'r-qa', projectId: 'p1', key: 'qa', title: '测试', isActive: true },
  { id: 'r-ops', projectId: 'p1', key: 'ops', title: '运维', isActive: true },
];

function packageFor(roleKey: string, version = '1.0.0') {
  return {
    id: `pv-${roleKey}`,
    packageId: `${roleKey}-pack`,
    version,
    roleKey,
    manifestDigest: roleKey.padEnd(2, '0').repeat(32).slice(0, 64),
    scope: 'BUILTIN' as const,
  };
}

const allPackages = roles.map((role) => packageFor(role.key));

const DIGEST = 'd'.repeat(64);

function baseHandler(
  overrides: {
    packages?: unknown[];
    validate?: { status: number; body: unknown };
  } = {},
) {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/projects' && method === 'GET')
      return { status: 200, body: envelope([project]) };
    if (path === '/api/v1/projects/p1/roles' && method === 'GET')
      return { status: 200, body: envelope(roles) };
    if (path === '/api/v1/projects/p1/workflow-definitions' && method === 'GET')
      return { status: 200, body: envelope({ items: [], nextCursor: null }) };
    if (path === '/api/v1/projects/p1/role-packages' && method === 'GET')
      return {
        status: 200,
        body: envelope({ items: overrides.packages ?? allPackages, nextCursor: null }),
      };
    if (path === '/api/v1/projects/p1/workflow-definitions/validate' && method === 'POST')
      return (
        overrides.validate ?? {
          status: 200,
          body: envelope({ valid: true, issues: [], digest: DIGEST }),
        }
      );
    return undefined;
  };
}

async function loadTemplateAndValidate() {
  fireEvent.click(await screen.findByRole('button', { name: '载入标准模板' }));
  fireEvent.click(screen.getByRole('button', { name: '校验并准备发布' }));
}

describe('Workflows（流程定义发布必须经过校验与一次性票据）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('载入标准模板后校验通过，并给出可供票据绑定的编译摘要', async () => {
    mockFetch(baseHandler());
    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );

    await loadTemplateAndValidate();

    expect(await screen.findByText('校验结果')).toBeInTheDocument();
    expect(screen.getByText('通过')).toBeInTheDocument();
    expect(screen.getByText(DIGEST)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布（需要二次验证）' })).toBeEnabled();
    expect(screen.queryByText('缺少角色包')).not.toBeInTheDocument();
  });

  it('缺少角色包时明确列出角色，并且不进入可发布状态', async () => {
    mockFetch(baseHandler({ packages: allPackages.filter((item) => item.roleKey !== 'qa') }));
    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );

    await loadTemplateAndValidate();

    expect(await screen.findByText('缺少角色包')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('qa（测试）');
    expect(screen.getByRole('button', { name: '发布（需要二次验证）' })).toBeDisabled();
  });

  it('发布把编译摘要与服务端排序后的包锁放进票据绑定，并用同一摘要提交发布', async () => {
    const mock = mockFetch((url, init) => {
      const base = baseHandler()(url, init);
      if (base) return base;
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/auth/action-previews' && method === 'POST')
        return {
          status: 200,
          body: envelope({
            binding: bodyOf(init),
            actionDigest: 'a'.repeat(64),
            display: {
              action: 'WORKFLOW_CONFIG_PUBLISH',
              targetType: 'WORKFLOW_DEFINITION',
              targetId: 'standard',
              expectedVersion: 7,
              projectId: 'p1',
              roleSlot: null,
            },
          }),
        };
      if (path === '/api/v1/auth/confirmation-tickets' && method === 'POST')
        return {
          status: 200,
          body: envelope({
            ticketId: 'ticket-1',
            ticketSecret: 'secret-1',
            expiresAt: '2026-11-02T23:00:00.000Z',
            actionDigest: 'a'.repeat(64),
          }),
        };
      if (path === '/api/v1/projects/p1/workflow-definitions/standard/publish' && method === 'POST')
        return {
          status: 201,
          body: envelope({
            definitionRevisionId: 'rev-1',
            revision: 1,
            digest: DIGEST,
            projectVersion: 8,
            replayed: false,
          }),
        };
      return undefined;
    });

    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );

    await loadTemplateAndValidate();
    fireEvent.click(await screen.findByRole('button', { name: '发布（需要二次验证）' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: 'pw-1' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认发布流程' }));

    expect(await screen.findByText(/流程 standard 已发布/)).toBeInTheDocument();

    const previewCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/auth/action-previews' && methodOf(init ?? {}) === 'POST',
    );
    const previewBody = bodyOf(previewCall?.[1] ?? {});
    expect(previewBody.action).toBe('WORKFLOW_CONFIG_PUBLISH');
    expect(previewBody.targetId).toBe('standard');
    expect(previewBody.expectedVersion).toBe(7);
    const payload = previewBody.payload as Record<string, unknown>;
    expect(payload.expectedCurrentRevision).toBe(0);
    expect(payload.compiledDigest).toBe(DIGEST);
    expect(payload.packageLocks).toEqual(
      [...allPackages]
        .sort((left, right) => left.roleKey.localeCompare(right.roleKey))
        .map((item) => ({
          roleKey: item.roleKey,
          packageId: item.packageId,
          version: item.version,
          packageDigest: item.manifestDigest,
        })),
    );

    const publishCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/projects/p1/workflow-definitions/standard/publish' &&
        methodOf(init ?? {}) === 'POST',
    );
    const publishBody = bodyOf(publishCall?.[1] ?? {});
    expect(publishBody.expectedVersion).toBe(7);
    expect(publishBody.expectedCurrentRevision).toBe(0);
    expect(publishBody.confirmation).toEqual({ ticketId: 'ticket-1', ticketSecret: 'secret-1' });
    expect(headersOf(publishCall?.[1] ?? {})['Idempotency-Key']).toBeTruthy();
  });
});
