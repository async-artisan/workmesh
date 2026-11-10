import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Workflows } from './Workflows';
import { setCsrfToken } from '../api/client';
import { useProjectStore } from '../store/project';
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

const NAMED_STEP_FIELDS = {
  displayName: '产品方案',
  vendorConfig: { retained: 'step extension' },
};
const UNKNOWN_CONFIG = { retained: 'definition extension' };

function addNamedStepFields() {
  const editor = screen.getByLabelText('流程定义 JSON') as HTMLTextAreaElement;
  const definition = JSON.parse(editor.value) as {
    steps: Array<Record<string, unknown>>;
    unknownConfig?: unknown;
  };
  Object.assign(definition.steps[0], NAMED_STEP_FIELDS);
  definition.unknownConfig = UNKNOWN_CONFIG;
  fireEvent.change(editor, { target: { value: JSON.stringify(definition, null, 2) } });
  return definition;
}

function expectNamedStepFields(definition: unknown) {
  expect(definition).toMatchObject({
    steps: expect.arrayContaining([expect.objectContaining(NAMED_STEP_FIELDS)]),
    unknownConfig: UNKNOWN_CONFIG,
  });
}

function readSavedDraftDefinition() {
  const draft = localStorage.getItem('workmesh.workflowDraft.p1');
  expect(draft).not.toBeNull();
  return JSON.parse((JSON.parse(draft ?? '{}') as { text: string }).text) as unknown;
}

async function loadTemplateAndValidate(withDisplayName = false) {
  const button = await screen.findByRole('button', { name: '载入标准模板' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  if (withDisplayName) addNamedStepFields();
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

  it.each([true, false])(
    '软件交付模板提供真实资料选择和管理员绑定路径（canManage=%s）',
    async (canManage) => {
      const softwareRoles = [
        ...roles,
        { id: 'r-backend', projectId: 'p1', key: 'backend', title: '后端', isActive: true },
        { id: 'r-ui', projectId: 'p1', key: 'ui', title: '设计', isActive: true },
      ];
      let bindingVersion = 3;
      let bindings: Array<{
        id: string;
        documentId: string;
        roleId: string | null;
        required: boolean;
      }> = [];
      const docId = '11111111-1111-4111-8111-111111111111';
      const mock = mockFetch((url, init) => {
        const path = pathOf(url);
        const method = methodOf(init);
        if (path === '/api/v1/projects/p1/roles' && method === 'GET')
          return { status: 200, body: envelope(softwareRoles) };
        if (path === '/api/v1/projects/p1/knowledge-bindings' && method === 'GET')
          return {
            status: 200,
            body: envelope({ version: bindingVersion, canManage, items: bindings }),
          };
        if (path === '/api/v1/projects/p1/knowledge-bindings' && method === 'PUT') {
          const body = bodyOf(init) as {
            documentId: string;
            roleId: string;
            expectedVersion: number;
            required: boolean;
          };
          expect(body).toEqual({
            documentId: docId,
            roleId: 'r-frontend',
            expectedVersion: 3,
            required: true,
          });
          bindings = [
            {
              id: 'binding-1',
              documentId: body.documentId,
              roleId: body.roleId,
              required: body.required,
            },
          ];
          bindingVersion += 1;
          return { status: 200, body: envelope({ version: bindingVersion, binding: bindings[0] }) };
        }
        if (path === '/api/v1/projects/p1/documents' && method === 'GET')
          return {
            status: 200,
            body: envelope({
              items: [
                {
                  document: {
                    id: docId,
                    projectId: 'p1',
                    kind: 'KNOWLEDGE',
                    archivedAt: null,
                    currentPublishedRevisionId: 'revision-1',
                  },
                  revisions: [],
                  publishedRevision: { id: 'revision-1', title: '已发布接口契约' },
                },
              ],
              nextCursor: null,
            }),
          };
        return baseHandler({ packages: softwareRoles.map((role) => packageFor(role.key)) })(
          url,
          init,
        );
      });
      render(
        <MemoryRouter>
          <Workflows />
        </MemoryRouter>,
      );
      const templateButton = screen.getByRole('button', { name: '载入软件交付模板' });
      await waitFor(() => expect(templateButton).toBeEnabled());
      fireEvent.click(templateButton);
      expect(screen.getByRole('region', { name: '流程前置资料' })).toBeInTheDocument();
      expect(screen.getByText(/请后端负责人准备接口契约与系统单元说明/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '准备与发布知识资料' })).toHaveAttribute(
        'href',
        '/knowledge?projectId=p1',
      );
      const selector = screen.getByLabelText('选择已发布文档：接口契约（前端）');
      await waitFor(() => expect(selector).toBeEnabled());
      fireEvent.change(selector, { target: { value: docId } });
      expect(
        JSON.parse((screen.getByLabelText('流程定义 JSON') as HTMLTextAreaElement).value).steps,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'frontend',
            inputBindings: expect.arrayContaining([
              expect.objectContaining({ inputKey: 'contract', knowledgeKey: docId }),
            ]),
          }),
        ]),
      );
      if (canManage) {
        fireEvent.click(screen.getByRole('button', { name: '绑定给前端' }));
        expect(await screen.findByText(/资料已绑定给接收角色/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '绑定给前端' })).not.toBeInTheDocument();
      } else {
        expect(
          screen.getAllByText(/请项目 OWNER 或 ADMIN 在本页完成资料绑定/).length,
        ).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: '绑定给前端' })).not.toBeInTheDocument();
        expect(
          mock.mock.calls.some(
            ([url, init]) =>
              pathOf(String(url)) === '/api/v1/projects/p1/knowledge-bindings' &&
              methodOf(init ?? {}) === 'PUT',
          ),
        ).toBe(false);
      }
      await waitFor(() => expect(JSON.stringify(readSavedDraftDefinition())).toContain(docId));
    },
  );

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

    await loadTemplateAndValidate(true);
    await waitFor(() => expectNamedStepFields(readSavedDraftDefinition()));
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
    expectNamedStepFields(publishBody.definition);
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
    const draft = addNamedStepFields() as Record<string, unknown>;
    draft.title = 'CAS 草稿';
    fireEvent.change(editor, { target: { value: JSON.stringify(draft, null, 2) } });
    fireEvent.click(screen.getByRole('button', { name: '校验并准备发布' }));
    expect(await screen.findByText('通过')).toBeInTheDocument();
    await waitFor(() => expectNamedStepFields(readSavedDraftDefinition()));
    fireEvent.click(await screen.findByRole('button', { name: '发布（需要二次验证）' }));
    fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: 'pw-cas' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认发布流程' }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(
      '[PROJECT_VERSION_CONFLICT] 项目版本已变化，请刷新后重试。 · requestId req-cas',
    );
    expect(localStorage.getItem('workmesh.workflowDraft.p1')).toContain('standard');
    expectNamedStepFields(readSavedDraftDefinition());
    expectNamedStepFields(JSON.parse((editor as HTMLTextAreaElement).value));
    const failedPublish = mock.mock.calls.find(
      ([url, request]) =>
        pathOf(String(url)) === '/api/v1/projects/p1/workflow-definitions/standard/publish' &&
        methodOf(request ?? {}) === 'POST',
    );
    expectNamedStepFields(bodyOf(failedPublish?.[1] ?? {}).definition);
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
    mockFetch(baseHandler());
    const initial = render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );
    const templateButton = await screen.findByRole('button', { name: '载入标准模板' });
    await waitFor(() => expect(templateButton).toBeEnabled());
    fireEvent.click(templateButton);
    const definition = addNamedStepFields();
    await waitFor(() => expectNamedStepFields(readSavedDraftDefinition()));
    initial.unmount();
    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/已恢复上次未发布的草稿/)).toBeInTheDocument();
    const editor = screen.getByLabelText('流程定义 JSON');
    expect(JSON.parse((editor as HTMLTextAreaElement).value)).toEqual(definition);
    expectNamedStepFields(JSON.parse((editor as HTMLTextAreaElement).value));
    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));
    expect(screen.getByLabelText('步骤 1 显示名称')).toHaveValue(NAMED_STEP_FIELDS.displayName);
    fireEvent.click(screen.getByRole('button', { name: '高级 JSON' }));
    expectNamedStepFields(
      JSON.parse((screen.getByLabelText('流程定义 JSON') as HTMLTextAreaElement).value),
    );
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

  it('项目切换立即隔离编辑状态、保存旧草稿，并忽略旧请求的成功响应', async () => {
    const oldDefinitions = deferred<StubReply>();
    const second = { ...project, id: 'p2', key: 'NEXT', name: 'Next' };
    let p1Loads = 0;
    mockFetch((url, init) => {
      const path = pathOf(url);
      if (path === '/api/v1/projects') return { status: 200, body: envelope([project, second]) };
      if (path === '/api/v1/projects/p1/workflow-definitions') {
        p1Loads += 1;
        if (p1Loads > 1) return oldDefinitions.promise;
      }
      if (path.startsWith('/api/v1/projects/p2/'))
        return {
          status: 200,
          body: envelope(
            path.endsWith('/roles')
              ? roles.map((role) => ({ ...role, projectId: 'p2' }))
              : { items: [], nextCursor: null },
          ),
        };
      return baseHandler()(url, init);
    });
    render(
      <MemoryRouter>
        <Workflows />
      </MemoryRouter>,
    );
    const templateButton = screen.getByRole('button', { name: '载入标准模板' });
    await waitFor(() => expect(templateButton).toBeEnabled());
    fireEvent.click(templateButton);
    addNamedStepFields();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '载入标准模板' })).toBeEnabled());
    expect((screen.getByLabelText('流程定义 JSON') as HTMLTextAreaElement).value).toBe('');
    expectNamedStepFields(readSavedDraftDefinition());
    expect(localStorage.getItem('workmesh.workflowDraft.p2')).toBeNull();
    await act(async () =>
      oldDefinitions.resolve({
        status: 200,
        body: envelope({
          items: [
            { workflowKey: 'old-only', title: '旧项目流程', currentPublishedRevisionId: null },
          ],
          nextCursor: null,
        }),
      }),
    );
    expect(screen.queryByText('旧项目流程')).not.toBeInTheDocument();
    expect(useProjectStore.getState().projectId).toBe('p2');
  });
});
