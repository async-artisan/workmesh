import { describe, expect, it } from 'vitest';
import type { DocumentSummary } from '../api/documentSummaries';
import type { KnowledgeBindingsView, WorkflowRevisionView } from '../api/resources';
import { envelope, methodOf, mockFetch } from '../test-utils';
import { checkPublishedKnowledge, type ReadResult } from './projectReadiness';

const revision: WorkflowRevisionView = {
  id: 'rev1',
  projectId: 'p1',
  workflowKey: 'delivery',
  revision: 1,
  digest: 'd'.repeat(64),
  definition: {},
  compiledRules: {
    resolvedRoles: [{ stepKey: 'impl', roleKey: 'frontend', roleId: 'r-front' }],
    packageLocks: [],
    systemGates: [],
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

const document: DocumentSummary = {
  document: {
    id: 'd1',
    projectId: 'p1',
    knowledgeBaseId: 'kb1',
    requirementId: null,
    kind: 'KNOWLEDGE',
    version: 201,
    currentPublishedRevisionId: 'published1',
    archivedAt: null,
  },
  updatedAt: '2026-11-10T00:00:00Z',
  knowledgeBase: { id: 'kb1', name: '项目知识', kind: 'BUSINESS' },
  requirement: null,
  latestVisibleRevision: {
    id: 'candidate201',
    documentId: 'd1',
    seq: 201,
    title: '最新候选',
    digest: 'c'.repeat(64),
    state: 'CANDIDATE',
  },
  publishedRevision: {
    id: 'published1',
    documentId: 'd1',
    seq: 1,
    title: '早期发布版',
    digest: 'a'.repeat(64),
    state: 'PUBLISHED',
  },
  visibleRevisionCount: 201,
  candidateRevisionCount: 200,
};

const bindings: ReadResult<KnowledgeBindingsView> = {
  ok: true,
  value: {
    version: 1,
    canManage: true,
    items: [{ id: 'binding1', documentId: 'd1', roleId: 'r-front', required: true }],
  },
};

describe('必需知识的概要准备检查', () => {
  it('同一文档的多个必需输入只读一次概要，不为可选或外部输入读取文档', async () => {
    const source = revision.compiledRules!.inputSources[0]!;
    const selected: WorkflowRevisionView = {
      ...revision,
      compiledRules: {
        ...revision.compiledRules!,
        inputSources: [
          source,
          { ...source, inputKey: 'reference' },
          { ...source, inputKey: 'optional', reference: 'd2', required: false },
          { ...source, inputKey: 'external', reference: 'd3', source: 'EXTERNAL_INPUT' },
        ],
      },
    };
    const mock = mockFetch((_url, init) => {
      expect(methodOf(init)).toBe('GET');
      return { status: 200, body: envelope(document) };
    });

    const result = await checkPublishedKnowledge('p1', selected, bindings);

    expect(result.state).toBe('READY');
    expect(result.detail).toContain('已核对 2 项必需知识输入');
    expect(mock.mock.calls.map(([url]) => String(url))).toEqual(['/api/v1/documents/d1/summary']);
  });

  it.each([
    [403, 'FORBIDDEN', '访问受限'],
    [404, 'RESOURCE_NOT_FOUND', '不可见'],
    [409, 'RESOURCE_CONFLICT', 'DOCUMENT_SUMMARY_REFRESH_REQUIRED'],
    [503, 'UNAVAILABLE', '读取失败'],
  ] as const)('概要返回 %s 时保留待确认，不回退到完整文档', async (status, code, message) => {
    const mock = mockFetch(() => ({ status, body: { error: { code, message } } }));

    const result = await checkPublishedKnowledge('p1', revision, bindings);

    expect(result.state).toBe('UNKNOWN');
    expect(result.detail).toContain('不能据此判断资料缺失');
    expect(mock.mock.calls.map(([url]) => String(url))).toEqual(['/api/v1/documents/d1/summary']);
  });

  it.each([
    ['跨项目', { projectId: 'p2' }],
    ['已归档', { archivedAt: '2026-11-10T01:00:00Z' }],
    ['未发布', { currentPublishedRevisionId: null }],
    ['PRD 类型', { kind: 'PRD' as const }],
  ] satisfies Array<[string, Partial<DocumentSummary['document']>]>)(
    '成功概要确认%s时才标为待准备',
    async (_label, change) => {
      const value: DocumentSummary = {
        ...document,
        document: { ...document.document, ...change },
        ...('currentPublishedRevisionId' in change && change.currentPublishedRevisionId === null
          ? { publishedRevision: null, candidateRevisionCount: 201 }
          : {}),
      };
      mockFetch(() => ({ status: 200, body: envelope(value) }));

      const result = await checkPublishedKnowledge('p1', revision, bindings);

      expect(result.state).toBe('MISSING');
      expect(result.detail).toContain('仍需准备或更新：contract');
    },
  );

  it('支持已发布决策与绑定给全部角色，历史候选数量不改变准备判断', async () => {
    mockFetch(() => ({
      status: 200,
      body: envelope({ ...document, document: { ...document.document, kind: 'DECISION' } }),
    }));

    const result = await checkPublishedKnowledge('p1', revision, {
      ok: true,
      value: {
        version: 1,
        canManage: false,
        items: [{ id: 'binding1', documentId: 'd1', roleId: null, required: true }],
      },
    });

    expect(result.state).toBe('READY');
  });

  it.each([
    [false, 'UNKNOWN'],
    [true, 'MISSING'],
  ] as const)('缺少绑定且 canManage=%s 时保持原有权限语义', async (canManage, state) => {
    mockFetch(() => ({ status: 200, body: envelope(document) }));

    const result = await checkPublishedKnowledge('p1', revision, {
      ok: true,
      value: { version: 1, canManage, items: [] },
    });

    expect(result.state).toBe(state);
  });

  it('没有编译规则、没有必需知识或绑定读取失败时不读取概要', async () => {
    const mock = mockFetch(() => undefined);

    expect(
      (await checkPublishedKnowledge('p1', { ...revision, compiledRules: undefined }, bindings))
        .state,
    ).toBe('UNKNOWN');
    expect(
      (
        await checkPublishedKnowledge(
          'p1',
          { ...revision, compiledRules: { ...revision.compiledRules!, inputSources: [] } },
          bindings,
        )
      ).state,
    ).toBe('NOT_REQUIRED');
    expect(
      await checkPublishedKnowledge('p1', revision, { ok: false, reason: '绑定读取失败' }),
    ).toEqual({ state: 'UNKNOWN', detail: '绑定读取失败' });
    expect(mock).not.toHaveBeenCalled();
  });
});
