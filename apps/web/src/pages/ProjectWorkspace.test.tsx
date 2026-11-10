import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectWorkspace } from './ProjectWorkspace';
import { setCsrfToken } from '../api/client';
import { useAuthStore } from '../store/auth';
import { useProjectStore } from '../store/project';
import {
  bodyOf,
  envelope,
  headersOf,
  methodOf,
  mockFetch,
  pathOf,
  useProject,
} from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo 项目', version: 5 };

const OWNER = {
  id: 'u-owner',
  email: 'owner@example.com',
  name: 'Owner',
  role: 'OWNER',
  version: 1,
};
const MEMBER = {
  id: 'u-member',
  email: 'member@example.com',
  name: 'Member',
  role: 'MEMBER',
  version: 1,
};

const DECLARED_REPO = {
  id: 'r1',
  identityMode: 'DECLARED',
  adapter: null,
  externalId: null,
  owner: 'acme',
  name: 'app',
  defaultBranch: 'main',
  createdAt: '2026-10-01T00:00:00.000Z',
  archivedAt: null,
  lastVerifiedStatus: null,
  lastVerifiedAt: null,
  provider: null,
  locators: [
    {
      id: 'loc-1',
      canonicalLocator: 'https://github.com/acme/app',
      source: 'HTTPS',
      declaredAt: '2026-10-01T00:00:00.000Z',
    },
  ],
};

const DEFINITION_PAYLOAD = {
  schemaVersion: '1.0',
  projectId: 'p1',
  layout: { kind: 'SINGLE_ROOT' },
  repositories: [
    {
      key: 'app',
      projectRepositoryId: 'r1',
      suggestedPath: '.',
      defaultRef: 'main',
      description: null,
    },
  ],
  relations: [],
  roleHints: {},
  contextPolicy: { requiredDocumentIds: [], roleDocumentIds: {}, repositoryDocuments: [] },
};

const WORKSPACE_REPOSITORY = {
  ...DEFINITION_PAYLOAD.repositories[0],
  identityMode: 'DECLARED',
  adapter: null,
  externalId: null,
  owner: 'acme',
  name: 'app',
  archivedAt: null,
  provider: null,
  locators: DECLARED_REPO.locators,
};

const DIGEST = 'd'.repeat(64);
const PUBLISHED_DIGEST = 'e'.repeat(64);

function configuredDefinition(overrides: Record<string, unknown> = {}) {
  return {
    definitionStatus: 'CONFIGURED',
    projectId: 'p1',
    projectVersion: 5,
    definitionVersion: 2,
    revisionId: 'rev-1',
    revisionNo: 1,
    digest: DIGEST,
    publishedAt: '2026-10-02T08:00:00.000Z',
    payload: DEFINITION_PAYLOAD,
    repositories: [WORKSPACE_REPOSITORY],
    draft: null,
    validation: { valid: true, issues: [] },
    ...overrides,
  };
}

function unconfiguredDefinition() {
  return {
    definitionStatus: 'NOT_CONFIGURED',
    projectId: 'p1',
    projectVersion: 5,
    definitionVersion: 0,
    revisionId: null,
    revisionNo: null,
    digest: null,
    publishedAt: null,
    payload: null,
    repositories: [],
    draft: null,
    validation: { valid: true, issues: [] },
  };
}

interface BaseOptions {
  members?: unknown[];
  definition?: unknown;
  repositories?: unknown[];
}

function baseHandler(options: BaseOptions = {}) {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/projects' && method === 'GET')
      return { status: 200, body: envelope([project]) };
    if (path === '/api/v1/projects/p1/members' && method === 'GET')
      return { status: 200, body: envelope(options.members ?? [OWNER]) };
    if (path === '/api/v1/projects/p1/repositories' && method === 'GET')
      return { status: 200, body: envelope(options.repositories ?? [DECLARED_REPO]) };
    if (path === '/api/v1/projects/p1/workspace-definition' && method === 'GET')
      return { status: 200, body: envelope(options.definition ?? configuredDefinition()) };
    return undefined;
  };
}

type Reply = { status: number; body: unknown };

/** 组合基础路由与用例内覆盖；用例内覆盖优先，未命中的请求由 mockFetch 变成 404。 */
function stubPage(
  custom: (url: string, init: RequestInit) => Reply | undefined,
  options: BaseOptions = {},
) {
  const base = baseHandler(options);
  return mockFetch((url, init) => custom(url, init) ?? base(url, init));
}

/** 带响应头的 stub：用于验证 429 的 Retry-After 真实秒数。 */
function stubPageWithHeaders(
  custom: (
    url: string,
    init: RequestInit,
  ) =>
    | {
        status: number;
        body: unknown;
        headers?: Record<string, string>;
      }
    | undefined,
  options: BaseOptions = {},
) {
  const base = baseHandler(options);
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const request = init ?? {};
    const reply = (custom(url, request) ?? base(url, request)) as
      { status: number; body: unknown; headers?: Record<string, string> } | undefined;
    const entries = Object.entries(reply?.headers ?? {});
    return {
      ok: Boolean(reply && reply.status >= 200 && reply.status < 300),
      status: reply?.status ?? 404,
      headers: {
        get: (name: string) =>
          entries.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null,
      },
      text: async () =>
        JSON.stringify(
          reply?.body ?? {
            error: { code: 'STUB_NOT_FOUND', message: `未配置的请求：${url}` },
          },
        ),
    };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const REPOSITORY_DECLARE_DISPLAY = {
  action: 'REPOSITORY_DECLARE',
  targetType: 'PROJECT',
  targetId: 'p1',
  expectedVersion: 5,
  projectId: 'p1',
  roleSlot: null,
};

const REPOSITORY_ARCHIVE_DISPLAY = {
  action: 'REPOSITORY_ARCHIVE',
  targetType: 'PROJECT_REPOSITORY',
  targetId: 'r1',
  expectedVersion: 5,
  projectId: 'p1',
  roleSlot: null,
};

const PUBLISH_DISPLAY = {
  action: 'WORKSPACE_DEFINITION_PUBLISH',
  targetType: 'PROJECT_WORKSPACE_DEFINITION',
  targetId: 'p1',
  expectedVersion: 5,
  projectId: 'p1',
  roleSlot: null,
};

function authRoutes(display: Record<string, unknown>) {
  return (url: string, init: RequestInit): Reply | undefined => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/auth/action-previews' && method === 'POST')
      return {
        status: 201,
        body: envelope({
          binding: bodyOf(init),
          actionDigest: 'a'.repeat(64),
          display,
        }),
      };
    if (path === '/api/v1/auth/confirmation-tickets' && method === 'POST')
      return {
        status: 201,
        body: envelope({
          ticketId: 't-1',
          ticketSecret: 'secret-1',
          expiresAt: '2026-10-01T00:05:00.000Z',
          actionDigest: 'a'.repeat(64),
        }),
      };
    return undefined;
  };
}

/** 预览 → 密码二验 → 票据 → 最终提交。 */
async function confirmWithTicket(submitLabel: string, password = 'pw-1') {
  fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
  fireEvent.click(await screen.findByRole('button', { name: submitLabel }));
}

async function validateDefinition() {
  fireEvent.click(await screen.findByRole('button', { name: '校验定义' }));
  await screen.findByText(/校验通过：下一步保存草稿/);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectWorkspace />
    </MemoryRouter>,
  );
}

function setUserAs(user: { id: string; email: string }) {
  useAuthStore.setState({ user, status: 'authenticated' });
}

describe('ProjectWorkspace（仓库 / 工作区定义 / 一次性接入码）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
    useAuthStore.setState({ user: null, status: 'loading' });
    vi.unstubAllGlobals();
  });

  it('成员只读：无声明/归档/定义编辑入口，DECLARED 不显示成已核验，但仍可生成接入码', async () => {
    setUserAs(MEMBER);
    stubPage(() => undefined, { members: [OWNER, MEMBER] });
    renderPage();

    expect(await screen.findByRole('heading', { name: '接入与工作区' })).toBeInTheDocument();
    expect(await screen.findByText(/人工声明 · 未由托管方核验/)).toBeInTheDocument();
    expect(screen.queryByText(/托管方已核验/)).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: '声明仓库' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '归档' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '校验定义' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布（需要二次验证）' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/只读：仓库声明、定义编辑、校验与发布仅项目 OWNER\/ADMIN/),
    ).toBeInTheDocument();

    // 接入码签发对任意活动 HUMAN 成员开放（§21.1 冻结），不属于管理员写操作。
    expect(screen.getByRole('button', { name: '生成接入码' })).toBeEnabled();
    expect(screen.getByText(/任意活跃 HUMAN 项目成员都可以生成一次性接入码/)).toBeInTheDocument();
  });

  it('管理员可写：声明仓库、校验/保存草稿/发布与归档入口均可用', async () => {
    setUserAs(OWNER);
    stubPage(() => undefined);
    renderPage();

    expect(await screen.findByRole('button', { name: '声明仓库' })).toBeEnabled();
    expect(await screen.findByRole('button', { name: '归档' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '校验定义' })).toBeEnabled();
    // 草稿必须先校验取得服务端摘要，发布必须已保存草稿。
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发布（需要二次验证）' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '生成接入码' })).toBeEnabled();
    expect(screen.getByLabelText('布局类型')).toHaveValue('SINGLE_ROOT');
  });

  it('未配置状态：明确 PROJECT_UNCONFIGURED，禁止签发接入码，也不把空数组当有效定义', async () => {
    setUserAs(OWNER);
    stubPage(() => undefined, { definition: unconfiguredDefinition(), repositories: [] });
    renderPage();

    expect(await screen.findByText('未配置（PROJECT_UNCONFIGURED）')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '工作区定义尚未发布' })).toBeInTheDocument();
    expect(screen.getByText(/不能执行 workspace init --join/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成接入码' })).toBeDisabled();
    expect(screen.getByText(/发布工作区定义后才能生成接入码/)).toBeInTheDocument();
    // 未配置时编辑器给出显式 NONE 草稿，而不是伪造已发布 revision。
    expect(screen.getByLabelText('布局类型')).toHaveValue('NONE');
    expect(screen.queryByText(/已发布 revision v/)).not.toBeInTheDocument();
  });

  it('已配置但无仓库（NONE）：显示无代码工作区空态，不伪造仓库', async () => {
    setUserAs(OWNER);
    const noneDefinition = configuredDefinition({
      payload: {
        ...DEFINITION_PAYLOAD,
        layout: { kind: 'NONE' },
        repositories: [],
      },
      repositories: [],
    });
    stubPage(() => undefined, { definition: noneDefinition, repositories: [] });
    renderPage();

    expect(await screen.findByText('无代码工作区')).toBeInTheDocument();
    expect(screen.getByText(/layout.kind: NONE/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: '仓库列表' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('布局类型')).toHaveValue('NONE');
  });

  it('声明仓库：只提交 locator + 项目版本 CAS + 票据，不用 owner/name 充当 externalId', async () => {
    setUserAs(OWNER);
    let repositories = [DECLARED_REPO];
    const mock = stubPage((url, init) => {
      const authorized = authRoutes(REPOSITORY_DECLARE_DISPLAY)(url, init);
      if (authorized) return authorized;
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/repositories/declarations' && method === 'POST') {
        repositories = [
          ...repositories,
          {
            ...DECLARED_REPO,
            id: 'r2',
            owner: 'acme',
            name: 'new-app',
            locators: [
              {
                id: 'loc-2',
                canonicalLocator: 'https://github.com/acme/new-app',
                source: 'HTTPS',
                declaredAt: '2026-10-03T00:00:00.000Z',
              },
            ],
          },
        ];
        return {
          status: 201,
          body: envelope({
            repositoryId: 'r2',
            locatorId: 'loc-2',
            identityMode: 'DECLARED',
            canonicalLocator: 'https://github.com/acme/new-app',
            source: 'HTTPS',
            owner: 'acme',
            name: 'new-app',
            reused: false,
            replayed: false,
            alias: false,
            projectVersion: 6,
          }),
        };
      }
      if (path === '/api/v1/projects/p1/repositories' && method === 'GET')
        return { status: 200, body: envelope(repositories) };
      return undefined;
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '声明仓库' }));
    const dialog = await screen.findByRole('dialog', { name: '声明代码仓库' });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('仓库地址'), {
      target: { value: 'https://github.com/acme/new-app' },
    });
    fireEvent.click(screen.getByRole('button', { name: '继续（需要二次验证）' }));
    await confirmWithTicket('确认声明仓库');

    expect(await screen.findByText(/仓库已声明（DECLARED）：acme\/new-app/)).toBeInTheDocument();
    expect(screen.getAllByText(/未由托管方核验/).length).toBeGreaterThan(0);
    expect(screen.getByText(/不会显示为“已验证”/)).toBeInTheDocument();

    const preview = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/auth/action-previews' && methodOf(init ?? {}) === 'POST',
    );
    const previewBody = bodyOf(preview?.[1] ?? {});
    expect(previewBody).toMatchObject({
      action: 'REPOSITORY_DECLARE',
      projectId: 'p1',
      targetType: 'PROJECT',
      targetId: 'p1',
      expectedVersion: 5,
      payload: {
        locator: 'https://github.com/acme/new-app',
        targetRepositoryId: null,
        displayName: null,
      },
    });

    const declaration = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/projects/p1/repositories/declarations' &&
        methodOf(init ?? {}) === 'POST',
    );
    const declarationBody = bodyOf(declaration?.[1] ?? {});
    expect(declarationBody).toMatchObject({
      expectedProjectVersion: 5,
      locator: 'https://github.com/acme/new-app',
      targetRepositoryId: null,
      displayName: null,
      confirmation: { ticketId: 't-1', ticketSecret: 'secret-1' },
    });
    // 不允许把 owner/name 或 URL 填进 externalId 冒充稳定厂商身份。
    expect(declarationBody).not.toHaveProperty('externalId');
    expect(declarationBody).not.toHaveProperty('owner');
    expect(declarationBody).not.toHaveProperty('name');
    expect(headersOf(declaration?.[1] ?? {})['Idempotency-Key']).toBeTruthy();
  });

  it('声明 409 LOCATOR_ALREADY_BOUND：解释已绑定到另一仓库，不自动改写', async () => {
    setUserAs(OWNER);
    stubPage((url, init) => {
      const authorized = authRoutes(REPOSITORY_DECLARE_DISPLAY)(url, init);
      if (authorized) return authorized;
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/repositories/declarations' && method === 'POST')
        return {
          status: 409,
          body: {
            error: {
              code: 'LOCATOR_ALREADY_BOUND',
              message: 'locator 已绑定到另一仓库',
              details: {
                canonicalLocator: 'https://github.com/acme/app',
                boundRepositoryId: 'r1',
              },
            },
          },
        };
      return undefined;
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '声明仓库' }));
    fireEvent.change(await screen.findByLabelText('仓库地址'), {
      target: { value: 'https://github.com/acme/app' },
    });
    fireEvent.click(screen.getByRole('button', { name: '继续（需要二次验证）' }));
    await confirmWithTicket('确认声明仓库');

    expect(await screen.findByText(/该来源已绑定到另一条仓库记录（仓库 r1）/)).toBeInTheDocument();
    expect(screen.getByText(/服务端不会自动改写/)).toBeInTheDocument();
    expect(screen.queryByText(/仓库已声明（DECLARED）/)).not.toBeInTheDocument();
    // 失败的票据流程已关闭，错误留在声明对话框里，可直接改地址重试。
    expect(screen.queryByLabelText('确认密码')).not.toBeInTheDocument();
  });

  it('校验 → 保存草稿：提交服务端规范化摘要与 expectedDefinitionVersion，响应递增版本', async () => {
    setUserAs(OWNER);
    const mock = stubPage((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/workspace-definition/validate' && method === 'POST')
        return {
          status: 200,
          body: envelope({
            valid: true,
            digest: PUBLISHED_DIGEST,
            // 服务端返回规范化后的 payload：这里回显请求内容，避免覆盖用户编辑。
            definition: bodyOf(init).definition,
            issues: [],
          }),
        };
      if (path === '/api/v1/projects/p1/workspace-definition/draft' && method === 'PUT')
        return {
          status: 200,
          body: envelope({
            definitionVersion: 3,
            payloadDigest: PUBLISHED_DIGEST,
            projectVersion: 5,
            updatedAt: '2026-10-03T00:00:00.000Z',
            replayed: false,
          }),
        };
      return undefined;
    });

    renderPage();
    expect(await screen.findByRole('button', { name: '保存草稿' })).toBeDisabled();

    fireEvent.change(await screen.findByLabelText('默认引用 1'), {
      target: { value: 'release' },
    });
    await validateDefinition();

    const saveButton = screen.getByRole('button', { name: '保存草稿' });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    expect(await screen.findByText(/草稿已保存（定义版本 v3）/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布（需要二次验证）' })).toBeEnabled();

    const draftCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/projects/p1/workspace-definition/draft' &&
        methodOf(init ?? {}) === 'PUT',
    );
    const draftBody = bodyOf(draftCall?.[1] ?? {});
    expect(draftBody).toMatchObject({
      expectedDefinitionVersion: 2,
      payloadDigest: PUBLISHED_DIGEST,
    });
    const definition = draftBody.definition as Record<string, unknown>;
    expect((definition.layout as Record<string, unknown>).kind).toBe('SINGLE_ROOT');
    const rows = definition.repositories as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      key: 'app',
      projectRepositoryId: 'r1',
      suggestedPath: '.',
      defaultRef: 'release',
    });
    expect(headersOf(draftCall?.[1] ?? {})['Idempotency-Key']).toBeTruthy();
  });

  it('校验返回 valid=false：展示逐条 issues，不允许保存草稿或发布', async () => {
    setUserAs(OWNER);
    stubPage((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/workspace-definition/validate' && method === 'POST')
        return {
          status: 200,
          body: envelope({
            valid: false,
            digest: null,
            definition: null,
            issues: [
              {
                path: 'repositories[0].suggestedPath',
                code: 'E_PATH_RULE',
                message: 'SINGLE_ROOT 的建议路径必须是 “.”',
              },
            ],
          }),
        };
      return undefined;
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '校验定义' }));

    expect(await screen.findByText(/校验未通过：1 项问题/)).toBeInTheDocument();
    expect(screen.getByText('E_PATH_RULE')).toBeInTheDocument();
    expect(screen.getByText(/SINGLE_ROOT 的建议路径必须是/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发布（需要二次验证）' })).toBeDisabled();
  });

  it('发布 422 issues：展示文档/仓库引用问题，并说明发布被拒绝', async () => {
    setUserAs(OWNER);
    stubPage((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/workspace-definition/validate' && method === 'POST')
        return {
          status: 200,
          body: envelope({
            valid: true,
            digest: PUBLISHED_DIGEST,
            // 服务端返回规范化后的 payload：这里回显请求内容，避免覆盖用户编辑。
            definition: bodyOf(init).definition,
            issues: [],
          }),
        };
      if (path === '/api/v1/projects/p1/workspace-definition/draft' && method === 'PUT')
        return {
          status: 200,
          body: envelope({
            definitionVersion: 3,
            payloadDigest: PUBLISHED_DIGEST,
            projectVersion: 5,
            updatedAt: '2026-10-03T00:00:00.000Z',
            replayed: false,
          }),
        };
      if (path === '/api/v1/projects/p1/workspace-definition/publish' && method === 'POST')
        return {
          status: 422,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message: '发布校验失败',
              details: {
                issues: [
                  {
                    path: 'contextPolicy.requiredDocumentIds[0]',
                    code: 'DOCUMENT_FORBIDDEN',
                    message: '文档不存在、越权或已归档',
                  },
                ],
              },
            },
          },
        };
      const authorized = authRoutes(PUBLISH_DISPLAY)(url, init);
      if (authorized) return authorized;
      return undefined;
    });

    renderPage();
    await validateDefinition();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText(/草稿已保存（定义版本 v3）/);
    fireEvent.click(screen.getByRole('button', { name: '发布（需要二次验证）' }));
    await confirmWithTicket('确认发布工作区定义');

    expect(await screen.findByText(/定义内容被服务端拒绝（422）/)).toBeInTheDocument();
    expect(screen.getByText('DOCUMENT_FORBIDDEN')).toBeInTheDocument();
    expect(screen.getByText(/文档不存在、越权或已归档/)).toBeInTheDocument();
  });

  it('草稿 409 DEFINITION_VERSION_CONFLICT：提示版本已变化并提供重新加载', async () => {
    setUserAs(OWNER);
    let definitionCalls = 0;
    const mock = stubPage((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/workspace-definition' && method === 'GET') {
        definitionCalls += 1;
        return { status: 200, body: envelope(configuredDefinition()) };
      }
      if (path === '/api/v1/projects/p1/workspace-definition/validate' && method === 'POST')
        return {
          status: 200,
          body: envelope({
            valid: true,
            digest: PUBLISHED_DIGEST,
            definition: DEFINITION_PAYLOAD,
            issues: [],
          }),
        };
      if (path === '/api/v1/projects/p1/workspace-definition/draft' && method === 'PUT')
        return {
          status: 409,
          body: {
            error: {
              code: 'DEFINITION_VERSION_CONFLICT',
              message: '定义版本冲突',
              details: { expectedDefinitionVersion: 2, currentDefinitionVersion: 3 },
            },
          },
        };
      return undefined;
    }, {});

    renderPage();
    await validateDefinition();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(await screen.findByText(/定义版本已变化/)).toBeInTheDocument();
    expect(screen.getByText(/不会接受旧版本覆盖新基线/)).toBeInTheDocument();
    expect(definitionCalls).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: '重新加载定义' }));
    await waitFor(() => expect(definitionCalls).toBeGreaterThanOrEqual(2));
    expect(mock.mock.calls.length).toBeGreaterThan(0);
  });

  it('发布总是通过一次性票据 + 双 CAS：请求体不带定义内容，票据绑定版本与摘要', async () => {
    setUserAs(OWNER);
    const mock = stubPage((url, init) => {
      const authorized = authRoutes(PUBLISH_DISPLAY)(url, init);
      if (authorized) return authorized;
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/workspace-definition/validate' && method === 'POST')
        return {
          status: 200,
          body: envelope({
            valid: true,
            digest: PUBLISHED_DIGEST,
            // 服务端返回规范化后的 payload：这里回显请求内容，避免覆盖用户编辑。
            definition: bodyOf(init).definition,
            issues: [],
          }),
        };
      if (path === '/api/v1/projects/p1/workspace-definition/draft' && method === 'PUT')
        return {
          status: 200,
          body: envelope({
            definitionVersion: 3,
            payloadDigest: PUBLISHED_DIGEST,
            projectVersion: 5,
            updatedAt: '2026-10-03T00:00:00.000Z',
            replayed: false,
          }),
        };
      if (path === '/api/v1/projects/p1/workspace-definition/publish' && method === 'POST')
        return {
          status: 200,
          body: envelope({
            revisionId: 'rev-2',
            revisionNo: 2,
            digest: PUBLISHED_DIGEST,
            definitionVersion: 4,
            projectVersion: 6,
            publishedAt: '2026-10-04T00:00:00.000Z',
            replayed: false,
          }),
        };
      return undefined;
    });

    renderPage();
    await validateDefinition();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText(/草稿已保存（定义版本 v3）/);
    fireEvent.click(screen.getByRole('button', { name: '发布（需要二次验证）' }));
    await confirmWithTicket('确认发布工作区定义');

    expect(await screen.findByText(/工作区定义已发布：revision v2/)).toBeInTheDocument();

    const previewCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/auth/action-previews' && methodOf(init ?? {}) === 'POST',
    );
    const previewBody = bodyOf(previewCall?.[1] ?? {});
    expect(previewBody).toMatchObject({
      action: 'WORKSPACE_DEFINITION_PUBLISH',
      targetType: 'PROJECT_WORKSPACE_DEFINITION',
      targetId: 'p1',
      expectedVersion: 5,
      payload: {
        expectedDefinitionVersion: 3,
        payloadDigest: PUBLISHED_DIGEST,
      },
    });

    const publishCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/projects/p1/workspace-definition/publish' &&
        methodOf(init ?? {}) === 'POST',
    );
    const publishBody = bodyOf(publishCall?.[1] ?? {});
    expect(publishBody).toMatchObject({
      expectedProjectVersion: 5,
      expectedDefinitionVersion: 3,
      payloadDigest: PUBLISHED_DIGEST,
      confirmation: { ticketId: 't-1', ticketSecret: 'secret-1' },
    });
    // 发布服务端已保存的草稿：请求体不携带定义内容。
    expect(publishBody).not.toHaveProperty('definition');
    expect(headersOf(publishCall?.[1] ?? {})['Idempotency-Key']).toBeTruthy();
  });

  it('发布 409 CONFIRMATION_USED：说明票据一次性，保留已保存草稿以便重试', async () => {
    setUserAs(OWNER);
    stubPage((url, init) => {
      const authorized = authRoutes(PUBLISH_DISPLAY)(url, init);
      if (authorized) return authorized;
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/workspace-definition/validate' && method === 'POST')
        return {
          status: 200,
          body: envelope({
            valid: true,
            digest: PUBLISHED_DIGEST,
            // 服务端返回规范化后的 payload：这里回显请求内容，避免覆盖用户编辑。
            definition: bodyOf(init).definition,
            issues: [],
          }),
        };
      if (path === '/api/v1/projects/p1/workspace-definition/draft' && method === 'PUT')
        return {
          status: 200,
          body: envelope({
            definitionVersion: 3,
            payloadDigest: PUBLISHED_DIGEST,
            projectVersion: 5,
            updatedAt: '2026-10-03T00:00:00.000Z',
            replayed: false,
          }),
        };
      if (path === '/api/v1/projects/p1/workspace-definition/publish' && method === 'POST')
        return {
          status: 409,
          body: {
            error: { code: 'CONFIRMATION_USED', message: '确认票据已被使用' },
          },
        };
      return undefined;
    });

    renderPage();
    await validateDefinition();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText(/草稿已保存（定义版本 v3）/);
    fireEvent.click(screen.getByRole('button', { name: '发布（需要二次验证）' }));
    await confirmWithTicket('确认发布工作区定义');

    expect(await screen.findByText(/确认票据已被使用/)).toBeInTheDocument();
    const publishButton = screen.getByRole('button', { name: '发布（需要二次验证）' });
    expect(publishButton).toBeEnabled();
  });

  it('归档仓库：DELETE 携带项目版本 CAS + 票据，成功后列表真实清空', async () => {
    setUserAs(OWNER);
    let archived = false;
    const mock = stubPage((url, init) => {
      const authorized = authRoutes(REPOSITORY_ARCHIVE_DISPLAY)(url, init);
      if (authorized) return authorized;
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/repositories' && method === 'GET')
        return { status: 200, body: envelope(archived ? [] : [DECLARED_REPO]) };
      if (path === '/api/v1/projects/p1/repositories/r1' && method === 'DELETE') {
        archived = true;
        return {
          status: 200,
          body: envelope({
            repositoryId: 'r1',
            archivedAt: '2026-10-05T00:00:00.000Z',
            projectVersion: 6,
            replayed: false,
          }),
        };
      }
      return undefined;
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '归档' }));
    await screen.findByRole('dialog', { name: '归档代码仓库' });
    await confirmWithTicket('确认归档仓库');

    expect(await screen.findByText(/仓库 acme\/app 已归档（项目版本 v6）/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('还没有声明代码仓库')).toBeInTheDocument());

    const deleteCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/projects/p1/repositories/r1' &&
        methodOf(init ?? {}) === 'DELETE',
    );
    const deleteBody = bodyOf(deleteCall?.[1] ?? {});
    expect(deleteBody).toMatchObject({
      expectedProjectVersion: 5,
      confirmation: { ticketId: 't-1', ticketSecret: 'secret-1' },
    });
    expect(headersOf(deleteCall?.[1] ?? {})['Idempotency-Key']).toBeTruthy();
  });

  it.each([
    ['签票', '成功'],
    ['签票', '失败'],
    ['执行', '成功'],
    ['执行', '失败'],
  ])('项目切换后旧归档%s迟到%s不影响新确认会话', async (stage, outcome) => {
    setUserAs(OWNER);
    useProjectStore.setState({
      projects: [project, { id: 'p2', key: 'NEXT', name: 'Next 项目', version: 11 }],
      loaded: true,
      loading: false,
      error: '',
      requestedProjectId: null,
    });
    const repositoryB = { ...DECLARED_REPO, id: 'r2', owner: 'beta', name: 'workspace' };
    const definitionB = configuredDefinition({ projectId: 'p2', projectVersion: 11 });
    let finishA: (reply: Reply) => void = () => undefined;
    let finishB: (reply: Reply) => void = () => undefined;
    let ticketCount = 0;
    let bLoads = 0;
    const ticket = (id: string) => ({
      status: 201,
      body: envelope({
        ticketId: id,
        ticketSecret: `secret-${id}`,
        expiresAt: '2026-10-01T00:05:00.000Z',
        actionDigest: 'a'.repeat(64),
      }),
    });

    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (method === 'GET' && path.startsWith('/api/v1/projects/p2/')) {
        bLoads += 1;
        if (path.endsWith('/members')) return { status: 200, body: envelope([OWNER]) };
        if (path.endsWith('/repositories')) return { status: 200, body: envelope([repositoryB]) };
        if (path.endsWith('/workspace-definition'))
          return { status: 200, body: envelope(definitionB) };
      }
      if (path === '/api/v1/auth/action-previews' && method === 'POST')
        return authRoutes(REPOSITORY_ARCHIVE_DISPLAY)(url, init);
      if (path === '/api/v1/auth/confirmation-tickets' && method === 'POST') {
        ticketCount += 1;
        if (ticketCount === 1 && stage === '执行') return ticket('a');
        if (ticketCount === 1) return new Promise<Reply>((resolve) => (finishA = resolve));
        return new Promise<Reply>((resolve) => (finishB = resolve));
      }
      if (path === '/api/v1/projects/p1/repositories/r1' && method === 'DELETE')
        return new Promise<Reply>((resolve) => (finishA = resolve));
      return baseHandler()(url, init);
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '归档' }));
    fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: 'pw-a' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    if (stage === '执行')
      fireEvent.click(await screen.findByRole('button', { name: '确认归档仓库' }));

    act(() => useProjectStore.getState().setProjectId('p2'));
    expect((await screen.findAllByText('beta/workspace')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '归档' }));
    fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: 'pw-b' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    const dialog = screen.getByRole('dialog', { name: '归档代码仓库' });
    expect(within(dialog).getByRole('button', { name: '校验中…' })).toBeDisabled();

    await act(async () => {
      finishA(
        outcome === '失败'
          ? { status: 409, body: { error: { code: 'OLD_FAILURE', message: '旧请求失败' } } }
          : stage === '签票'
            ? ticket('a')
            : { status: 200, body: envelope({ repositoryId: 'r1', projectVersion: 6 }) },
      );
    });
    expect(screen.getByRole('dialog', { name: '归档代码仓库' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '校验中…' })).toBeDisabled();
    expect(within(dialog).queryByText(/票据已签发|旧请求失败/)).not.toBeInTheDocument();
    expect(screen.queryByText(/旧请求失败|仓库 acme\/app 已归档/)).not.toBeInTheDocument();
    expect(bLoads).toBe(3);

    await act(async () => finishB(ticket('b')));
    expect(await within(dialog).findByText(/票据已签发/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '确认归档仓库' })).toBeEnabled();
  });

  it('接入码只显示一次：关闭后不恢复，重新生成才得到新码', async () => {
    setUserAs(OWNER);
    let issues = 0;
    const mock = stubPage((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/workspace-enrollments' && method === 'POST') {
        issues += 1;
        return {
          status: 201,
          body: envelope({
            enrollmentId: `enr-${issues}`,
            code: issues === 1 ? 'WM-ONE-TIME-1' : 'WM-ONE-TIME-2',
            projectId: 'p1',
            definitionRevisionId: 'rev-1',
            definitionDigest: DIGEST,
            expiresAt: '2026-10-01T00:15:00.000Z',
          }),
        };
      }
      return undefined;
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '生成接入码' }));
    const firstDialog = await screen.findByRole('dialog', { name: '生成一次性接入码' });
    fireEvent.click(within(firstDialog).getByLabelText('我已有本机命令参数，仅生成接入码'));
    fireEvent.click(within(firstDialog).getByRole('button', { name: '生成接入码' }));
    const codeInput = await screen.findByLabelText('一次性接入码');
    expect(codeInput).toHaveValue('WM-ONE-TIME-1');
    expect(screen.getByText(/只显示这一次/)).toBeInTheDocument();
    expect(within(firstDialog).getByText('rev-1')).toBeInTheDocument();

    const issueCall = mock.mock.calls.filter(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/projects/p1/workspace-enrollments' &&
        methodOf(init ?? {}) === 'POST',
    );
    expect(issueCall).toHaveLength(1);
    expect(headersOf(issueCall[0]?.[1] ?? {})['Idempotency-Key']).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByLabelText('一次性接入码')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '生成接入码' }));
    const secondDialog = await screen.findByRole('dialog', { name: '生成一次性接入码' });
    expect(screen.queryByLabelText('一次性接入码')).not.toBeInTheDocument();
    fireEvent.click(within(secondDialog).getByLabelText('我已有本机命令参数，仅生成接入码'));
    fireEvent.click(within(secondDialog).getByRole('button', { name: '生成接入码' }));
    expect(await screen.findByLabelText('一次性接入码')).toHaveValue('WM-ONE-TIME-2');
    expect(issues).toBe(2);
  });

  it('接入码 409 PROJECT_UNCONFIGURED：说明必须先发布定义，不显示任何码', async () => {
    setUserAs(MEMBER);
    stubPage(
      (url, init) => {
        const path = pathOf(url);
        const method = methodOf(init);
        if (path === '/api/v1/projects/p1/workspace-enrollments' && method === 'POST')
          return {
            status: 409,
            body: {
              error: { code: 'PROJECT_UNCONFIGURED', message: '项目尚未发布工作区定义' },
            },
          };
        return undefined;
      },
      { members: [OWNER, MEMBER] },
    );

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '生成接入码' }));
    const dialog = await screen.findByRole('dialog', { name: '生成一次性接入码' });
    fireEvent.click(within(dialog).getByLabelText('我已有本机命令参数，仅生成接入码'));
    fireEvent.click(within(dialog).getByRole('button', { name: '生成接入码' }));

    expect(await screen.findByText(/项目尚未发布工作区定义，不能签发接入码/)).toBeInTheDocument();
    expect(screen.queryByLabelText('一次性接入码')).not.toBeInTheDocument();
  });

  it('接入码 409 重放：明文不重复返回，提示重新生成', async () => {
    setUserAs(MEMBER);
    stubPage(
      (url, init) => {
        const path = pathOf(url);
        const method = methodOf(init);
        if (path === '/api/v1/projects/p1/workspace-enrollments' && method === 'POST')
          return {
            status: 409,
            body: {
              error: {
                code: 'ENROLLMENT_CODE_NOT_REPLAYABLE',
                message: '同键幂等重放不返回明文',
                details: { enrollmentId: 'enr-old-1' },
              },
            },
          };
        return undefined;
      },
      { members: [OWNER, MEMBER] },
    );

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '生成接入码' }));
    const dialog = await screen.findByRole('dialog', { name: '生成一次性接入码' });
    fireEvent.click(within(dialog).getByLabelText('我已有本机命令参数，仅生成接入码'));
    fireEvent.click(within(dialog).getByRole('button', { name: '生成接入码' }));

    expect(await screen.findByText(/明文不会重复返回/)).toBeInTheDocument();
    expect(screen.getByText(/enrollmentId enr-old-1/)).toBeInTheDocument();
    expect(screen.getByText(/重新生成新码/)).toBeInTheDocument();
  });

  it('接入码 429 限流：展示真实 Retry-After 秒数', async () => {
    setUserAs(MEMBER);
    stubPageWithHeaders(
      (url, init) => {
        const path = pathOf(url);
        const method = methodOf(init);
        if (path === '/api/v1/projects/p1/workspace-enrollments' && method === 'POST')
          return {
            status: 429,
            headers: { 'Retry-After': '30' },
            body: { error: { code: 'RATE_LIMITED', message: '请求过于频繁' } },
          };
        return undefined;
      },
      { members: [OWNER, MEMBER] },
    );

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '生成接入码' }));
    const dialog = await screen.findByRole('dialog', { name: '生成一次性接入码' });
    fireEvent.click(within(dialog).getByLabelText('我已有本机命令参数，仅生成接入码'));
    fireEvent.click(within(dialog).getByRole('button', { name: '生成接入码' }));

    expect(await screen.findByText(/请在 30 秒后重试/)).toBeInTheDocument();
    expect(screen.queryByLabelText('一次性接入码')).not.toBeInTheDocument();
  });

  it('切换项目后，B 的权限和数据覆盖 A，迟到的 A 响应不能回写', async () => {
    setUserAs(OWNER);
    useProjectStore.setState({
      projects: [project, { id: 'p2', key: 'NEXT', name: 'Next 项目', version: 11 }],
      loaded: true,
      loading: false,
      error: '',
      requestedProjectId: null,
    });

    const pendingA: Array<(reply: Reply) => void> = [];
    let aRequests = 0;
    const memberB = { ...OWNER, role: 'MEMBER' };
    const repositoryB = { ...DECLARED_REPO, id: 'r2', owner: 'beta', name: 'workspace' };
    const definitionB = configuredDefinition({
      projectId: 'p2',
      projectVersion: 11,
      payload: { ...DEFINITION_PAYLOAD, projectId: 'p2', repositories: [] },
      repositories: [],
    });

    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (method === 'GET' && path.startsWith('/api/v1/projects/p1/')) {
        aRequests += 1;
        return new Promise<Reply>((resolve) => pendingA.push(resolve));
      }
      if (path === '/api/v1/projects/p2/members' && method === 'GET')
        return { status: 200, body: envelope([memberB]) };
      if (path === '/api/v1/projects/p2/repositories' && method === 'GET')
        return { status: 200, body: envelope([repositoryB]) };
      if (path === '/api/v1/projects/p2/workspace-definition' && method === 'GET')
        return { status: 200, body: envelope(definitionB) };
      return undefined;
    });

    renderPage();
    await waitFor(() => expect(aRequests).toBe(3));
    act(() => useProjectStore.getState().setProjectId('p2'));

    expect(await screen.findByText('beta/workspace')).toBeInTheDocument();
    expect(screen.getByText('MEMBER')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '声明仓库' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '归档' })).not.toBeInTheDocument();

    await act(async () => {
      pendingA[0]?.({ status: 200, body: envelope([DECLARED_REPO]) });
      pendingA[1]?.({
        status: 200,
        body: envelope(configuredDefinition({ projectId: 'p1', projectVersion: 5 })),
      });
      pendingA[2]?.({ status: 200, body: envelope([OWNER, MEMBER]) });
    });

    await waitFor(() => {
      expect(screen.getByText('beta/workspace')).toBeInTheDocument();
      expect(screen.getByText('MEMBER')).toBeInTheDocument();
      expect(screen.queryByText('acme/app')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '声明仓库' })).not.toBeInTheDocument();
      expect(screen.queryByText('正在读取工作区…')).not.toBeInTheDocument();
    });
  });

  it('旧项目的失败和 finally 不会清掉新项目仍在进行的加载状态', async () => {
    setUserAs(OWNER);
    useProjectStore.setState({
      projects: [project, { id: 'p2', key: 'NEXT', name: 'Next 项目', version: 11 }],
      loaded: true,
      loading: false,
      error: '',
      requestedProjectId: null,
    });

    const pendingA: Array<{ resolve: (reply: Reply) => void; reject: (error: Error) => void }> = [];
    const pendingB: Array<(reply: Reply) => void> = [];
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (method === 'GET' && path.startsWith('/api/v1/projects/p1/'))
        return new Promise<Reply>((resolve, reject) => pendingA.push({ resolve, reject }));
      if (method === 'GET' && path.startsWith('/api/v1/projects/p2/'))
        return new Promise<Reply>((resolve) => pendingB.push(resolve));
      return undefined;
    });

    renderPage();
    await waitFor(() => expect(pendingA).toHaveLength(3));
    act(() => useProjectStore.getState().setProjectId('p2'));
    await waitFor(() => expect(pendingB).toHaveLength(3));

    await act(async () => {
      pendingA[1]?.reject(new Error('late A failure'));
    });
    expect(screen.getByText('正在读取工作区…')).toBeInTheDocument();
    expect(screen.queryByText('late A failure')).not.toBeInTheDocument();

    const memberB = { ...OWNER, role: 'MEMBER' };
    const repositoryB = { ...DECLARED_REPO, id: 'r2', owner: 'beta', name: 'workspace' };
    const definitionB = configuredDefinition({
      projectId: 'p2',
      projectVersion: 11,
      payload: { ...DEFINITION_PAYLOAD, projectId: 'p2', repositories: [] },
      repositories: [],
    });
    await act(async () => {
      pendingB[0]?.({ status: 200, body: envelope([repositoryB]) });
      pendingB[1]?.({ status: 200, body: envelope(definitionB) });
      pendingB[2]?.({ status: 200, body: envelope([memberB]) });
    });

    expect(await screen.findByText('beta/workspace')).toBeInTheDocument();
    expect(screen.getByText('MEMBER')).toBeInTheDocument();
    expect(screen.queryByText('正在读取工作区…')).not.toBeInTheDocument();
  });

  it('切换项目时关闭已打开的接入码弹窗并清除一次性明文', async () => {
    setUserAs(MEMBER);
    useProjectStore.setState({
      projects: [project, { id: 'p2', key: 'NEXT', name: 'Next 项目', version: 11 }],
      loaded: true,
      loading: false,
      error: '',
      requestedProjectId: null,
    });
    stubPage((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/v1/projects/p1/workspace-enrollments' && method === 'POST')
        return {
          status: 201,
          body: envelope({
            enrollmentId: 'enr-p1',
            code: 'P1-SECRET-CODE',
            projectId: 'p1',
            definitionRevisionId: 'rev-1',
            definitionDigest: DIGEST,
            expiresAt: '2026-10-01T00:15:00.000Z',
          }),
        };
      if (path === '/api/v1/projects/p2/members' && method === 'GET')
        return { status: 200, body: envelope([{ ...MEMBER, id: 'u-member' }]) };
      if (path === '/api/v1/projects/p2/repositories' && method === 'GET')
        return { status: 200, body: envelope([]) };
      if (path === '/api/v1/projects/p2/workspace-definition' && method === 'GET')
        return { status: 200, body: envelope(unconfiguredDefinition()) };
      return undefined;
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '生成接入码' }));
    const dialog = await screen.findByRole('dialog', { name: '生成一次性接入码' });
    fireEvent.click(within(dialog).getByLabelText('我已有本机命令参数，仅生成接入码'));
    fireEvent.click(within(dialog).getByRole('button', { name: '生成接入码' }));
    expect(await screen.findByLabelText('一次性接入码')).toHaveValue('P1-SECRET-CODE');

    act(() => useProjectStore.getState().setProjectId('p2'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '生成一次性接入码' })).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue('P1-SECRET-CODE')).not.toBeInTheDocument();
    });
  });
});
