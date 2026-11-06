import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  type StubReply,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

  it('JSON 语法错误包含行列位置和原始解析原因', async () => {
    mockFetch(baseHandler());
    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );

    const editor = await screen.findByLabelText('流程定义 JSON');
    fireEvent.change(editor, { target: { value: '{\n  invalid' } });
    fireEvent.click(screen.getByRole('button', { name: '校验并准备发布' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/第 2 行第/);
    expect(screen.getByRole('alert')).toHaveTextContent(/JSON/);
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
    expect(localStorage.getItem('workmesh.workflowDraft.p1')).toBeNull();

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

  it('校验失败时把错误放在编辑器旁，并用 aria 关联到 JSON 输入框', async () => {
    mockFetch(
      baseHandler({
        validate: {
          status: 200,
          body: envelope({
            valid: false,
            issues: [{ path: 'steps[0].key', code: 'E_STEP_KEY', message: '步骤 key 不能为空' }],
            digest: null,
          }),
        },
      }),
    );
    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );

    await loadTemplateAndValidate();

    const editor = await screen.findByLabelText('流程定义 JSON');
    expect(editor).toHaveAttribute('aria-invalid', 'true');
    expect(editor).toHaveAttribute('aria-describedby', 'workflow-editor-error');
    const inlineError = await screen.findByText(/校验未通过：1 项问题/);
    expect(inlineError).toHaveAttribute('id', 'workflow-editor-error');
    expect(inlineError).toHaveAttribute('role', 'alert');
  });

  it('服务端拒绝后仍可修复 JSON 并重新校验通过', async () => {
    const core = baseHandler();
    let validationAttempts = 0;
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/workflow-definitions/validate' && method === 'POST') {
        validationAttempts += 1;
        return validationAttempts === 1
          ? {
              status: 200,
              body: envelope({
                valid: false,
                issues: [
                  { path: 'steps[0].key', code: 'E_STEP_KEY', message: '步骤 key 不能为空' },
                ],
                digest: null,
              }),
            }
          : {
              status: 200,
              body: envelope({ valid: true, issues: [], digest: DIGEST }),
            };
      }
      return core(url, init);
    });
    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );

    await loadTemplateAndValidate();
    expect(await screen.findByText(/校验未通过：1 项问题/)).toBeInTheDocument();
    const editor = screen.getByLabelText('流程定义 JSON');
    const repaired = JSON.parse((editor as HTMLTextAreaElement).value) as {
      steps: Array<Record<string, unknown>>;
    };
    repaired.steps[0].key = 'repaired-step';
    fireEvent.change(editor, { target: { value: JSON.stringify(repaired, null, 2) } });
    expect(editor).not.toHaveAttribute('aria-invalid', 'true');

    fireEvent.click(screen.getByRole('button', { name: '校验并准备发布' }));
    expect(await screen.findByText('通过')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布（需要二次验证）' })).toBeEnabled();
    expect(validationAttempts).toBe(2);
  });

  it('发布遇到 CAS 冲突时保留本地草稿并展示服务端错误', async () => {
    const core = baseHandler();
    const mock = mockFetch((url, init) => {
      const base = core(url, init);
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
            ticketId: 'ticket-cas',
            ticketSecret: 'secret-cas',
            expiresAt: '2026-11-02T23:00:00.000Z',
            actionDigest: 'a'.repeat(64),
          }),
        };
      if (path === '/api/v1/projects/p1/workflow-definitions/standard/publish' && method === 'POST')
        return {
          status: 409,
          body: {
            error: {
              code: 'PROJECT_VERSION_CONFLICT',
              message: '项目版本已变化，请刷新后重试。',
              requestId: 'req-cas',
            },
          },
        };
      return undefined;
    });
    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );

    await loadTemplateAndValidate();
    expect(await screen.findByText('通过')).toBeInTheDocument();
    const editor = screen.getByLabelText('流程定义 JSON');
    const draft = JSON.parse((editor as HTMLTextAreaElement).value) as Record<string, unknown>;
    draft.title = 'CAS 草稿';
    fireEvent.change(editor, { target: { value: JSON.stringify(draft, null, 2) } });
    fireEvent.click(screen.getByRole('button', { name: '校验并准备发布' }));
    expect(await screen.findByText('通过')).toBeInTheDocument();
    await waitFor(() =>
      expect(localStorage.getItem('workmesh.workflowDraft.p1')).toContain('standard'),
    );
    fireEvent.click(await screen.findByRole('button', { name: '发布（需要二次验证）' }));
    fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: 'pw-cas' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认发布流程' }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(
      '[PROJECT_VERSION_CONFLICT] 项目版本已变化，请刷新后重试。 · requestId req-cas',
    );
    expect(localStorage.getItem('workmesh.workflowDraft.p1')).toContain('standard');
    expect(screen.queryByText(/流程 standard 已发布/)).not.toBeInTheDocument();
    expect(
      mock.mock.calls.some(
        ([url, request]) =>
          pathOf(String(url)) === '/api/v1/projects/p1/workflow-definitions/standard/publish' &&
          methodOf(request ?? {}) === 'POST',
      ),
    ).toBe(true);
  });

  it('刷新后恢复本地未发布草稿，并可以主动放弃', async () => {
    localStorage.setItem(
      'workmesh.workflowDraft.p1',
      JSON.stringify({
        text: '{"workflowKey":"draft-only","steps":[]}',
        expectedCurrentRevision: 2,
        savedAt: Date.now(),
      }),
    );
    mockFetch(baseHandler());
    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/已恢复上次未发布的草稿/)).toBeInTheDocument();
    const editor = screen.getByLabelText('流程定义 JSON');
    expect(editor).toHaveValue('{"workflowKey":"draft-only","steps":[]}');
    expect(screen.getByText('未发布草稿')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }));
    expect(localStorage.getItem('workmesh.workflowDraft.p1')).toBeNull();
    expect(screen.queryByText(/已恢复上次未发布的草稿/)).not.toBeInTheDocument();
  });

  it('流程定义仍在读取时显示骨架与 role=status，不先渲染空态', async () => {
    const definitions = deferred<StubReply>();
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/roles' && method === 'GET')
        return { status: 200, body: envelope(roles) };
      if (path === '/api/v1/projects/p1/role-packages' && method === 'GET')
        return { status: 200, body: envelope({ items: [], nextCursor: null }) };
      if (path === '/api/v1/projects/p1/workflow-definitions' && method === 'GET')
        return definitions.promise;
      return undefined;
    });

    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );

    const indicator = await screen.findByText('正在加载流程定义…');
    expect(indicator.closest('[role="status"]')).not.toBeNull();
    expect(indicator.closest('[aria-busy="true"]')).not.toBeNull();
    expect(document.querySelectorAll('.wm-skeleton-row').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('还没有已发布的流程定义，先载入标准模板并发布。'),
    ).not.toBeInTheDocument();

    definitions.resolve({ status: 200, body: envelope({ items: [], nextCursor: null }) });
    expect(
      await screen.findByText('还没有已发布的流程定义，先载入标准模板并发布。'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('正在加载流程定义…')).not.toBeInTheDocument());
  });
});
