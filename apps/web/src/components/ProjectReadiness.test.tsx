import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ProjectReadiness } from './ProjectReadiness';
import { ProjectWorkspace } from '../pages/ProjectWorkspace';
import { envelope, methodOf, mockFetch, pathOf, useProject, type StubReply } from '../test-utils';

const roles = [
  { id: 'r-front', projectId: 'p1', key: 'frontend', title: '前端', isActive: true },
  { id: 'r-product', projectId: 'p1', key: 'product', title: '产品', isActive: true },
];
const worker = { id: 'worker', email: 'worker@example.com', role: 'OWNER', version: 1, roles };
const signer = {
  id: 'signer',
  email: 'signer@example.com',
  role: 'MEMBER',
  version: 1,
  roles: [roles[1]],
};
const definition = {
  workflowKey: 'delivery',
  title: '交付流程',
  currentRevision: 2,
  currentPublishedRevisionId: 'rev1',
  version: 2,
};
const revision = {
  id: 'rev1',
  projectId: 'p1',
  workflowKey: 'delivery',
  revision: 2,
  digest: 'd'.repeat(64),
  definition: {
    roleSlots: [{ key: 'accept', roleKey: 'product' }],
    steps: [
      {
        key: 'impl',
        roleKey: 'frontend',
        outputKinds: ['IMPL'],
        gates: [{ reviewerSlots: ['accept'] }],
      },
    ],
  },
  compiledRules: {
    resolvedRoles: [{ stepKey: 'impl', roleKey: 'frontend', roleId: 'r-front' }],
    inputSources: [
      {
        stepKey: 'impl',
        inputKey: 'contract',
        source: 'PUBLISHED_KNOWLEDGE',
        required: true,
        reference: 'd1',
      },
    ],
  },
};
const workspace = {
  definitionStatus: 'CONFIGURED',
  revisionId: 'workspace-rev1',
  revisionNo: 1,
  payload: { layout: { kind: 'SINGLE_ROOT' }, repositories: [{ projectRepositoryId: 'repo1' }] },
  repositories: [{ id: 'repo1' }],
};
const document = {
  document: {
    id: 'd1',
    projectId: 'p1',
    kind: 'KNOWLEDGE',
    currentPublishedRevisionId: 'drev1',
    archivedAt: null,
  },
  revisions: [],
  publishedRevision: { id: 'drev1', title: '接口规范' },
};

function base(url: string, _init: RequestInit) {
  const path = pathOf(url);
  const data: Record<string, unknown> = {
    '/api/v1/projects/p1/members': [worker, signer],
    '/api/v1/projects/p1/roles': roles,
    '/api/v1/projects/p1/workflow-definitions': { items: [definition], nextCursor: null },
    '/api/v1/workflow-definition-revisions/rev1': revision,
    '/api/v1/projects/p1/knowledge-bindings': {
      version: 1,
      canManage: true,
      items: [{ id: 'binding1', documentId: 'd1', roleId: 'r-front', required: true }],
    },
    '/api/v1/projects/p1/workspace-definition': workspace,
    '/api/v1/projects/p1/repositories': [{ id: 'repo1', archivedAt: null }],
    '/api/v1/projects/p1/board': { summary: { total: 1 }, columns: [] },
    '/api/v1/documents/d1': document,
  };
  return path in data ? { status: 200, body: envelope(data[path]) } : undefined;
}

function renderChecklist(projectId = 'p1') {
  return render(
    <MemoryRouter>
      <ProjectReadiness key={projectId} projectId={projectId} />
    </MemoryRouter>,
  );
}
function row(name: string) {
  return within(screen.getByRole('listitem', { name }));
}

describe('项目准备清单', () => {
  it('可从工作区展开准备清单，未展开时不增加清单请求', async () => {
    useProject('p1');
    const mock = mockFetch((url, init) =>
      pathOf(url) === '/api/v1/projects'
        ? { status: 200, body: envelope([{ id: 'p1', key: 'DEMO', name: 'Demo', version: 1 }]) }
        : base(url, init),
    );
    render(
      <MemoryRouter>
        <ProjectWorkspace />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: '定义状态' });
    expect(screen.queryByRole('region', { name: '项目准备清单' })).not.toBeInTheDocument();
    expect(
      mock.mock.calls.some(([url]) => pathOf(String(url)).endsWith('/knowledge-bindings')),
    ).toBe(false);
    const disclosure = screen.getByText('查看项目准备清单').closest('details')!;
    disclosure.open = true;
    fireEvent(disclosure, new Event('toggle'));
    await waitFor(() =>
      expect(row('准备已发布并绑定的知识').getByText('已具备')).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: '选择资料与绑定' })).toHaveAttribute(
      'href',
      '/workflows?projectId=p1',
    );
  });

  it('按选定流程核对人员、独立签字、知识绑定、共享工作区与任务，并保留项目链接', async () => {
    mockFetch(base);
    renderChecklist();
    await waitFor(() =>
      expect(row('准备已发布并绑定的知识').getByText('已具备')).toBeInTheDocument(),
    );
    for (const name of ['安排人员与独立签字', '配置仓库与工作区', '发布可用流程', '创建首次任务'])
      expect(row(name).getByText('已具备')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '安排角色人员' })).toHaveAttribute(
      'href',
      '/roles?projectId=p1',
    );
    expect(screen.getByRole('link', { name: '选择资料与绑定' })).toHaveAttribute(
      'href',
      '/workflows?projectId=p1',
    );
    expect(screen.getByRole('link', { name: '查看项目任务' })).toHaveAttribute(
      'href',
      '/board?projectId=p1',
    );
    expect(row('配置仓库与工作区').getByText(/本机接入仍需自行完成/)).toBeInTheDocument();
  });

  it('单个多角色成员仍需要独立签字人，普通成员看不到绑定不能当作未配置', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      if (path.endsWith('/members')) return { status: 200, body: envelope([worker]) };
      if (path.endsWith('/knowledge-bindings'))
        return { status: 200, body: envelope({ version: 1, canManage: false, items: [] }) };
      return base(url, init);
    });
    renderChecklist();
    await waitFor(() =>
      expect(
        row('准备已发布并绑定的知识').getByText(/部分必需资料或绑定当前不可确认/),
      ).toBeInTheDocument(),
    );
    expect(row('安排人员与独立签字').getByText('待准备')).toBeInTheDocument();
    expect(row('安排人员与独立签字').getByText(/尚无可与提交人分开的人员/)).toBeInTheDocument();
    expect(row('准备已发布并绑定的知识').queryByText('待准备')).not.toBeInTheDocument();
  });

  it('分别显示读取失败和访问受限，其余成功证据仍可用；空任务总数才标待准备', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      if (path.endsWith('/workspace-definition'))
        return { status: 503, body: { error: { code: 'UNAVAILABLE', message: '服务暂不可用' } } };
      if (path.endsWith('/workflow-definitions'))
        return { status: 403, body: { error: { code: 'FORBIDDEN', message: '无权限' } } };
      if (path.endsWith('/board'))
        return { status: 200, body: envelope({ summary: { total: 0 } }) };
      return base(url, init);
    });
    renderChecklist();
    await waitFor(() => expect(row('配置仓库与工作区').getByText(/读取失败/)).toBeInTheDocument());
    expect(row('配置仓库与工作区').getByText('待确认')).toBeInTheDocument();
    expect(row('发布可用流程').getByText(/当前账号不可读取/)).toBeInTheDocument();
    expect(row('发布可用流程').getByText('待确认')).toBeInTheDocument();
    expect(row('创建首次任务').getByText('待准备')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '创建需求与任务' })).toHaveAttribute(
      'href',
      '/requirements?projectId=p1',
    );
  });

  it('文档不可访问保留待确认；刷新后检测撤销发布与缺失角色绑定', async () => {
    let documentState = 'restricted';
    mockFetch((url, init) => {
      if (pathOf(url) === '/api/v1/documents/d1')
        return documentState === 'restricted'
          ? { status: 404, body: { error: { code: 'RESOURCE_NOT_FOUND', message: '不可见' } } }
          : {
              status: 200,
              body: envelope({
                ...document,
                document: { ...document.document, currentPublishedRevisionId: null },
              }),
            };
      return base(url, init);
    });
    renderChecklist();
    await waitFor(() =>
      expect(
        row('准备已发布并绑定的知识').getByText(/部分必需资料或绑定当前不可确认/),
      ).toBeInTheDocument(),
    );
    expect(row('准备已发布并绑定的知识').getByText('待确认')).toBeInTheDocument();
    documentState = 'withdrawn';
    fireEvent.click(screen.getByRole('button', { name: '刷新准备状态' }));
    await waitFor(() =>
      expect(
        row('准备已发布并绑定的知识').getByText(/仍需准备或更新：contract/),
      ).toBeInTheDocument(),
    );
    expect(row('准备已发布并绑定的知识').getByText('待准备')).toBeInTheDocument();
  });

  it('可选知识不产生硬性准备项；无代码工作区与实现流程冲突会提示修正', async () => {
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      if (path === '/api/v1/workflow-definition-revisions/rev1')
        return {
          status: 200,
          body: envelope({
            ...revision,
            compiledRules: {
              ...revision.compiledRules,
              inputSources: revision.compiledRules.inputSources.map((source) => ({
                ...source,
                required: false,
              })),
            },
          }),
        };
      if (path.endsWith('/workspace-definition'))
        return {
          status: 200,
          body: envelope({ ...workspace, payload: { layout: { kind: 'NONE' }, repositories: [] } }),
        };
      return base(url, init);
    });
    renderChecklist();
    await waitFor(() =>
      expect(row('准备已发布并绑定的知识').getByText('无需此项')).toBeInTheDocument(),
    );
    expect(row('配置仓库与工作区').getByText('待准备')).toBeInTheDocument();
    expect(row('配置仓库与工作区').getByText(/选定流程包含实现步骤/)).toBeInTheDocument();
    expect(
      mock.mock.calls.some(([url]) => pathOf(String(url)).startsWith('/api/v1/documents/')),
    ).toBe(false);
  });

  it('流程列表仍有后续页时不把当前页无发布误判为整个项目无发布', async () => {
    mockFetch((url, init) =>
      pathOf(url).endsWith('/workflow-definitions')
        ? { status: 200, body: envelope({ items: [], nextCursor: 'page2' }) }
        : base(url, init),
    );
    renderChecklist();
    await waitFor(() =>
      expect(row('发布可用流程').getByText(/还有未读取的列表页/)).toBeInTheDocument(),
    );
    expect(row('发布可用流程').getByText('待确认')).toBeInTheDocument();
    expect(row('安排人员与独立签字').getByText('待确认')).toBeInTheDocument();
    expect(row('准备已发布并绑定的知识').getByText('待确认')).toBeInTheDocument();
  });

  it('发布修订读取失败时不按标准模板或无代码布局误判已准备', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      if (path === '/api/v1/workflow-definition-revisions/rev1')
        return { status: 403, body: { error: { code: 'FORBIDDEN', message: '访问受限' } } };
      if (path.endsWith('/workspace-definition'))
        return {
          status: 200,
          body: envelope({ ...workspace, payload: { layout: { kind: 'NONE' }, repositories: [] } }),
        };
      return base(url, init);
    });
    renderChecklist();
    await waitFor(() =>
      expect(row('安排人员与独立签字').getByText(/当前账号不可读取/)).toBeInTheDocument(),
    );
    expect(row('安排人员与独立签字').getByText('待确认')).toBeInTheDocument();
    expect(row('准备已发布并绑定的知识').getByText('待确认')).toBeInTheDocument();
    expect(row('配置仓库与工作区').getByText('待确认')).toBeInTheDocument();
  });

  it('切换项目后忽略旧项目延迟返回的准备状态', async () => {
    let resolveOld!: (reply: StubReply) => void;
    const old = new Promise<StubReply>((resolve) => {
      resolveOld = resolve;
    });
    mockFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects/p1/board') return old;
      if (pathOf(url).startsWith('/api/v1/projects/p2/'))
        return { status: 403, body: { error: { code: 'FORBIDDEN', message: '新项目受限' } } };
      expect(methodOf(init)).toBe('GET');
      return base(url, init);
    });
    const rendered = renderChecklist();
    rendered.rerender(
      <MemoryRouter>
        <ProjectReadiness key="p2" projectId="p2" />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(row('创建首次任务').getByText(/当前账号不可读取/)).toBeInTheDocument(),
    );
    await act(async () => resolveOld({ status: 200, body: envelope({ summary: { total: 999 } }) }));
    expect(screen.queryByText(/999 个任务/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '创建需求与任务' })).toHaveAttribute(
      'href',
      '/requirements?projectId=p2',
    );
  });
});
