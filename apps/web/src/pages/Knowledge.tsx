import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  base64ToUtf8,
  documentApi,
  knowledgeBaseApi,
  projectApi,
  workbenchApi,
  type KnowledgeBaseKind,
  type KnowledgeBaseSearchItem,
  type KnowledgeBaseView,
  type DocumentDetail,
  type RequirementView,
  type RevisionView,
  type RoleView,
} from '../api/resources';
import { formatApiError } from '../api/client';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import { DiffViewer } from '../components/DiffViewer';
import { ProjectSelect } from '../components/ProjectSelect';
import { InlineLoading, SkeletonLines, TableSkeletonRows } from '../components/Skeleton';
import { useProjectContext } from '../hooks/useProjectContext';
import { REVISION_STATE_LABELS } from '../lib/labels';
import { loadDocumentIndex } from '../lib/documentIndex';
import { loadRequirementIndex } from '../lib/requirementIndex';
import { KnowledgeSystemRelations } from '../components/KnowledgeSystemRelations';
import { MarkdownReader } from '../components/MarkdownReader';
import './knowledge-workspace.css';

const KIND_LABELS: Record<DocumentDetail['document']['kind'], string> = {
  UNDERSTANDING: '理解',
  DECISION: '决策',
  PRD: 'PRD',
  KNOWLEDGE: '知识',
};

const COLLECTIONS: Array<{
  kind: KnowledgeBaseKind;
  title: string;
  question: string;
  examples: string;
  marker: string;
}> = [
  {
    kind: 'BUSINESS',
    title: '业务事实库',
    question: '规则为什么这样定？',
    examples: '业务规则 · 术语 · 适用边界',
    marker: '规',
  },
  {
    kind: 'SYSTEM',
    title: '系统事实库',
    question: '系统由什么组成、如何运行？',
    examples: '服务 · 接口 · 运行方式',
    marker: '系',
  },
  {
    kind: 'PRACTICE',
    title: '角色实践库',
    question: '这项工作具体怎么完成？',
    examples: '操作步骤 · 模板 · 检查清单',
    marker: '作',
  },
];

function collectionTitle(kind: string): string {
  return COLLECTIONS.find((collection) => collection.kind === kind)?.title ?? '知识库';
}

function searchStatusLabel(status: string): string {
  switch (status) {
    case 'PUBLISHED':
      return '当前生效';
    case 'CANDIDATE':
      return '候选 · 尚未生效';
    case 'WITHDRAWN':
      return '历史版本 · 已撤回';
    default:
      return '状态暂不可用';
  }
}

function knowledgeBaseForDocument(
  document: DocumentDetail['document'],
  knowledgeBases: KnowledgeBaseView[],
): KnowledgeBaseView | undefined {
  return knowledgeBases.find((item) => item.id === document.knowledgeBaseId);
}

type RevisionWithReview = RevisionView & { reviewRequestId?: string | null };

type ContentView = {
  revisionId: string;
  text: string;
  sha256: string;
  baseRevisionId?: string;
  baseText?: string;
};

function revisionReviewId(revision: RevisionView): string | null {
  const value = (revision as RevisionWithReview).reviewRequestId;
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * 知识库页面是 Agent 产物的查看与决策台。文档和修订由本地 Agent 生成并提交，
 * 页面只展示版本、正文、差异和评审入口，并保留撤销发布这类需要人工确认的高风险操作。
 */
export function Knowledge() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const [docs, setDocs] = useState<DocumentDetail[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseView[]>([]);
  const [knowledgeBasesState, setKnowledgeBasesState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [knowledgeBasesError, setKnowledgeBasesError] = useState('');
  const [activeCollection, setActiveCollection] = useState<KnowledgeBaseKind | null>(null);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectSearchScope, setProjectSearchScope] = useState<KnowledgeBaseKind | ''>('');
  const [searchResults, setSearchResults] = useState<KnowledgeBaseSearchItem[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [searchError, setSearchError] = useState('');
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searchCursors, setSearchCursors] = useState<Record<string, string>>({});
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchRetry, setSearchRetry] = useState(0);
  const [requirementsById, setRequirementsById] = useState<Map<string, RequirementView>>(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [governanceOpen, setGovernanceOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [content, setContent] = useState<ContentView | null>(null);
  const [compareOldId, setCompareOldId] = useState('');
  const [compareNewId, setCompareNewId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requirementIndexError, setRequirementIndexError] = useState('');
  const [requirementIndexLoading, setRequirementIndexLoading] = useState(false);
  const [documentIndexError, setDocumentIndexError] = useState('');
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [rolesState, setRolesState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [readyTasks, setReadyTasks] = useState<
    Awaited<ReturnType<typeof workbenchApi.get>>['readyTasks']
  >([]);
  const [readyState, setReadyState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [commandCopied, setCommandCopied] = useState(false);
  const [documentIndexFailed, setDocumentIndexFailed] = useState(false);
  /** 有项目时首帧即视为加载中，避免先闪一屏「还没有文档」。 */
  const [docsLoading, setDocsLoading] = useState(Boolean(projectId));
  /** 当前项目是否已经拿到过一次文档列表结果；用于区分首次加载与「加载成功但为空」。 */
  const [docsLoaded, setDocsLoaded] = useState(false);
  /** 正文/对比请求本身也是异步面板：没有 loading 时点「查看正文」后卡片会一直不出现。 */
  const [contentLoading, setContentLoading] = useState(false);
  /** 文档列表请求序号：项目切换/刷新失败时旧请求不得覆盖新页面。 */
  const docsRequestRef = useRef(0);
  /** 需求索引请求序号：首次加载和手动重读都受保护，旧项目结果不得回写。 */
  const requirementIndexRequestRef = useRef(0);
  /** 正文请求序号：慢的旧版本请求完成后不得覆盖当前版本。 */
  const contentRequestRef = useRef(0);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const knowledgeBasesRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  /** 搜索结果打开请求序号：项目切换、新结果或卸载后旧文档详情不得回写。 */
  const searchResultOpenRequestRef = useRef(0);
  const readerRef = useRef<HTMLDivElement | null>(null);

  const selected = docs.find((item) => item.document.id === selectedId) ?? null;
  const isReadingDocument = Boolean(content);
  /** 首次加载（还没有任何文档结果）：表格用骨架行，不渲染空态与 0/0 计数。 */
  const docsInitialLoading = Boolean(projectId) && !docsLoaded && docs.length === 0;
  const requirementLabel = (id: string | null | undefined): string => {
    if (!id) return '—';
    const requirement = requirementsById.get(id);
    if (requirement) return `${requirement.code} · ${requirement.title}`;
    // 需求索引和文档列表是两条独立请求：索引还在读时不能把未绑定需求当成事实。
    if (requirementIndexLoading) return '读取中…';
    return requirementIndexError ? '关联需求暂时无法读取' : '—';
  };
  const revisionLabel = (id: string | null | undefined): string => {
    if (!id) return '—';
    const revision = selected?.revisions.find((item) => item.id === id);
    return revision ? `v${revision.seq}` : '—';
  };
  const revisionTitle = (id: string | null | undefined): string => {
    if (!id) return '—';
    const revision = selected?.revisions.find((item) => item.id === id);
    return revision ? `v${revision.seq} · ${revision.title}` : '—';
  };
  const filteredDocs = useMemo(() => {
    const text = query.trim().toLowerCase();
    return docs.filter((item) => {
      if (kindFilter && item.document.kind !== kindFilter) return false;
      if (!text) return true;
      const requirement = item.document.requirementId
        ? requirementsById.get(item.document.requirementId)
        : null;
      const revisionText = item.revisions.flatMap((revision) => [
        revision.title,
        `v${revision.seq}`,
        revision.state,
        REVISION_STATE_LABELS[revision.state] ?? '',
      ]);
      const searchText = [
        KIND_LABELS[item.document.kind],
        item.document.kind,
        requirement?.code ?? '',
        requirement?.title ?? '',
        requirement ? `${requirement.code} · ${requirement.title}` : '',
        ...revisionText,
      ]
        .join(' ')
        .toLowerCase();
      return searchText.includes(text);
    });
  }, [docs, kindFilter, query, requirementsById]);

  const activeCollectionBaseIds = useMemo(() => {
    if (!activeCollection) return null;
    return new Set(
      knowledgeBases
        .filter((knowledgeBase) => knowledgeBase.kind === activeCollection)
        .map((item) => item.id),
    );
  }, [activeCollection, knowledgeBases]);

  const activeCollectionInfo = useMemo(
    () => COLLECTIONS.find((collection) => collection.kind === activeCollection) ?? null,
    [activeCollection],
  );
  const activeCollectionBases = useMemo(
    () =>
      activeCollection
        ? knowledgeBases.filter((knowledgeBase) => knowledgeBase.kind === activeCollection)
        : [],
    [activeCollection, knowledgeBases],
  );

  const projectSearchBases = useMemo(
    () =>
      projectSearchScope
        ? knowledgeBases.filter((knowledgeBase) => knowledgeBase.kind === projectSearchScope)
        : knowledgeBases,
    [knowledgeBases, projectSearchScope],
  );
  const projectSearchScopeLabel = projectSearchScope
    ? collectionTitle(projectSearchScope)
    : '全部可访问知识库';

  const collectionFilteredDocs = useMemo(
    () =>
      activeCollectionBaseIds
        ? filteredDocs.filter((item) => activeCollectionBaseIds.has(item.document.knowledgeBaseId))
        : filteredDocs,
    [activeCollectionBaseIds, filteredDocs],
  );

  const pageCount = Math.max(1, Math.ceil(collectionFilteredDocs.length / PAGE_SIZE));
  const visibleDocs = collectionFilteredDocs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [projectId, kindFilter, query, activeCollection]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    if (content) readerRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [content]);

  const candidateCount =
    selected?.revisions.filter((revision) => revision.state === 'CANDIDATE').length ?? 0;
  const contentRevision = selected?.revisions.find(
    (revision) => revision.id === content?.revisionId,
  );
  const contentVersionLabel = contentRevision
    ? selected?.publishedRevision?.id === contentRevision.id
      ? `当前生效 · v${contentRevision.seq}`
      : contentRevision.state === 'CANDIDATE'
        ? `候选 · 尚未生效 · v${contentRevision.seq}`
        : `历史版本 · v${contentRevision.seq}`
    : content
      ? revisionLabel(content.revisionId)
      : '';
  const selectedKnowledgeBase = selected
    ? knowledgeBaseForDocument(selected.document, knowledgeBases)
    : undefined;
  const selectedRequirement = selected?.document.requirementId
    ? requirementsById.get(selected.document.requirementId)
    : undefined;
  const sourceRevisionForPanel =
    contentRevision ?? selected?.publishedRevision ?? selected?.revisions[0];
  const selectedSourceRevision = sourceRevisionForPanel?.basisUnderstandingRevisionId
    ? selected?.revisions.find(
        (revision) => revision.id === sourceRevisionForPanel.basisUnderstandingRevisionId,
      )
    : undefined;

  async function refreshRequirementIndex() {
    if (!projectId) return;
    const requestId = requirementIndexRequestRef.current + 1;
    requirementIndexRequestRef.current = requestId;
    setRequirementIndexLoading(true);
    try {
      const index = await loadRequirementIndex(projectId);
      if (requirementIndexRequestRef.current !== requestId) return;
      setRequirementsById(index.byId);
      setRequirementIndexError(index.error);
    } finally {
      if (requirementIndexRequestRef.current === requestId) setRequirementIndexLoading(false);
    }
  }

  async function load() {
    if (!projectId) {
      docsRequestRef.current += 1;
      requirementIndexRequestRef.current += 1;
      setDocs([]);
      setSelectedId('');
      setGovernanceOpen(false);
      setContent(null);
      setRequirementsById(new Map());
      setRequirementIndexError('');
      setRequirementIndexLoading(false);
      setDocumentIndexError('');
      setDocumentIndexFailed(false);
      setDocsLoading(false);
      setDocsLoaded(false);
      setContentLoading(false);
      setCompareOldId('');
      setCompareNewId('');
      return;
    }

    const requestId = docsRequestRef.current + 1;
    docsRequestRef.current = requestId;
    const requirementRequestId = requirementIndexRequestRef.current + 1;
    requirementIndexRequestRef.current = requirementRequestId;
    // 文档刷新会启动新的需求索引请求；它必须接管 loading 并在自身结束后清理。
    setRequirementIndexLoading(true);
    setDocsLoading(true);
    try {
      const [documents, requirementIndex] = await Promise.all([
        loadDocumentIndex(projectId),
        loadRequirementIndex(projectId),
      ]);
      const documentsCurrent = docsRequestRef.current === requestId;
      const requirementCurrent = requirementIndexRequestRef.current === requirementRequestId;
      if (!documentsCurrent && !requirementCurrent) return;
      if (requirementCurrent) {
        setRequirementsById(requirementIndex.byId);
        setRequirementIndexError(requirementIndex.error);
      }
      // 需求索引请求过期时，不能连带丢弃仍然有效的当前项目文档列表结果。
      if (!documentsCurrent) return;
      const documentsFailed = !documents.complete && documents.reason === null;
      // 首次分页请求失败时 helper 返回空 items：已有快照必须保留，不能把旧文档清空。
      const nextDocs = documentsFailed && docs.length > 0 ? docs : documents.items;
      setDocs(nextDocs);
      setDocumentIndexError(
        documentsFailed && docs.length > 0
          ? `${documents.error} 数据可能已过期，当前仍显示上次成功读取的 ${docs.length} 个文档。`
          : documents.error,
      );
      setDocumentIndexFailed(documentsFailed);
      setError('');
      setSelectedId((current) =>
        nextDocs.some((item) => item.document.id === current)
          ? current
          : (nextDocs[0]?.document.id ?? ''),
      );
      // 文档列表重新读取后，旧正文/旧 diff 不再对应当前列表。
      contentRequestRef.current += 1;
      setContent(null);
      setContentLoading(false);
      setCompareOldId('');
      setCompareNewId('');
    } catch (caught) {
      if (docsRequestRef.current !== requestId) return;
      setDocumentIndexFailed(true);
      setDocumentIndexError(`文档列表读取失败：${formatApiError(caught)}`);
    } finally {
      if (docsRequestRef.current === requestId) {
        setDocsLoading(false);
        setDocsLoaded(true);
      }
      // 只有当前有效的索引请求才能结束 loading；过期请求不能干扰新请求。
      if (requirementIndexRequestRef.current === requirementRequestId)
        setRequirementIndexLoading(false);
    }
  }

  useEffect(() => {
    // 项目切换：立即清空旧项目文档与正文，并让在途的文档/正文/需求索引请求全部失效。
    docsRequestRef.current += 1;
    requirementIndexRequestRef.current += 1;
    contentRequestRef.current += 1;
    searchResultOpenRequestRef.current += 1;
    setDocs([]);
    setSelectedId('');
    setGovernanceOpen(false);
    setContent(null);
    setError('');
    setDocumentIndexError('');
    setDocumentIndexFailed(false);
    setDocsLoading(false);
    setDocsLoaded(false);
    setContentLoading(false);
    setCompareOldId('');
    setCompareNewId('');
    setRequirementsById(new Map());
    setRequirementIndexError('');
    setRequirementIndexLoading(false);
    if (!projectId)
      return () => {
        searchResultOpenRequestRef.current += 1;
        contentRequestRef.current += 1;
      };
    void load();
    return () => {
      searchResultOpenRequestRef.current += 1;
      contentRequestRef.current += 1;
    };
  }, [projectId]);

  useEffect(() => {
    const requestId = knowledgeBasesRequestRef.current + 1;
    knowledgeBasesRequestRef.current = requestId;
    setKnowledgeBases([]);
    setKnowledgeBasesError('');
    setKnowledgeBasesState(projectId ? 'loading' : 'ready');
    setActiveCollection(null);
    if (!projectId) return;

    void (async () => {
      const all: KnowledgeBaseView[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      try {
        for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
          const pageResult = await knowledgeBaseApi.list(projectId, { limit: 50, cursor });
          if (knowledgeBasesRequestRef.current !== requestId) return;
          all.push(...pageResult.items);
          const nextCursor = pageResult.nextCursor ?? undefined;
          if (!nextCursor || !pageResult.hasMore) {
            setKnowledgeBases(all);
            setKnowledgeBasesState('ready');
            return;
          }
          if (seenCursors.has(nextCursor)) {
            setKnowledgeBases(all);
            setKnowledgeBasesError('知识库列表可能未完整加载：服务端游标重复。');
            setKnowledgeBasesState('error');
            return;
          }
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }
        setKnowledgeBases(all);
        setKnowledgeBasesError('知识库列表达到分页安全上限，当前展示已读取的内容。');
        setKnowledgeBasesState('error');
      } catch (caught) {
        if (knowledgeBasesRequestRef.current !== requestId) return;
        setKnowledgeBases(all);
        setKnowledgeBasesError(`知识库类别暂时无法读取：${formatApiError(caught)}`);
        setKnowledgeBasesState('error');
      }
    })();
  }, [projectId]);

  useEffect(() => {
    const q = projectSearch.trim();
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearchResults([]);
    setSearchCursors({});
    setSearchHasMore(false);
    setSearchTruncated(false);
    setSearchError('');

    if (!q) {
      setSearchState('idle');
      return;
    }
    if (!projectId || knowledgeBasesState === 'loading') {
      setSearchState('loading');
      return;
    }
    if (knowledgeBasesState === 'error' && knowledgeBases.length === 0) {
      setSearchState('error');
      setSearchError(knowledgeBasesError || '知识库列表暂时无法读取，无法开始搜索。');
      return;
    }
    if (projectSearchBases.length === 0) {
      setSearchState('ready');
      return;
    }

    setSearchState('loading');
    const timer = window.setTimeout(() => {
      void Promise.allSettled(
        projectSearchBases.map((knowledgeBase) =>
          knowledgeBaseApi.search(knowledgeBase.id, { q, limit: 50 }),
        ),
      ).then((settled) => {
        if (searchRequestRef.current !== requestId) return;
        const nextItems: KnowledgeBaseSearchItem[] = [];
        const nextCursors: Record<string, string> = {};
        const failures: string[] = [];
        let truncated = false;
        settled.forEach((result, index) => {
          const knowledgeBase = projectSearchBases[index];
          if (result.status === 'rejected') {
            failures.push(knowledgeBase?.name ?? '一个知识库');
            return;
          }
          nextItems.push(...result.value.items);
          if (result.value.hasMore && result.value.nextCursor && knowledgeBase)
            nextCursors[knowledgeBase.id] = result.value.nextCursor;
          truncated ||= result.value.truncated;
        });
        setSearchResults(nextItems);
        setSearchCursors(nextCursors);
        setSearchHasMore(Object.keys(nextCursors).length > 0);
        setSearchTruncated(truncated);
        const notices = [
          knowledgeBasesState === 'error' && knowledgeBasesError
            ? `${knowledgeBasesError} 搜索范围可能不完整。`
            : '',
          failures.length > 0 ? `${failures.join('、')}搜索暂时失败，当前结果可能不完整。` : '',
        ].filter(Boolean);
        setSearchError(notices.join(' '));
        setSearchState(failures.length === settled.length ? 'error' : 'ready');
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    projectId,
    projectSearch,
    projectSearchBases,
    projectSearchScope,
    knowledgeBasesState,
    knowledgeBasesError,
    searchRetry,
  ]);

  useEffect(() => {
    let alive = true;
    if (!projectId) {
      setRoles([]);
      setRolesState('ready');
      setReadyTasks([]);
      setReadyState('ready');
      return () => {
        alive = false;
      };
    }
    setRolesState('loading');
    setReadyState('loading');
    projectApi
      .roles(projectId)
      .then((list) => {
        if (!alive) return;
        setRoles(list);
        setRolesState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setRoles([]);
        setRolesState('error');
      });
    workbenchApi
      .get(projectId)
      .then((snapshot) => {
        if (!alive) return;
        setReadyTasks(snapshot.readyTasks ?? []);
        setReadyState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setReadyTasks([]);
        setReadyState('error');
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  function selectDocument(documentId: string) {
    contentRequestRef.current += 1;
    setSelectedId(documentId);
    setGovernanceOpen(false);
    setContent(null);
    setContentLoading(false);
    setCompareOldId('');
    setCompareNewId('');
    setError('');
  }

  function openDocumentGovernance(documentId: string) {
    selectDocument(documentId);
    setGovernanceOpen(true);
  }

  function openDocument(document: DocumentDetail) {
    const revision = document.publishedRevision ?? document.revisions[0] ?? null;
    selectDocument(document.document.id);
    if (!revision) {
      setNotice('该文档还没有可读取的修订。');
      return;
    }
    void openContent(revision, document);
  }

  function updateComparisonSelection(kind: 'old' | 'new', value: string) {
    // Selecting a new pair makes any old body or diff immediately stale.
    contentRequestRef.current += 1;
    setContent(null);
    setContentLoading(false);
    setError('');
    if (kind === 'old') setCompareOldId(value);
    else setCompareNewId(value);
  }

  async function openContent(revision: RevisionView, documentOverride?: DocumentDetail) {
    const requestId = contentRequestRef.current + 1;
    contentRequestRef.current = requestId;
    setContent(null);
    setContentLoading(true);
    setError('');
    try {
      const body = await documentApi.content(revision.id);
      if (contentRequestRef.current !== requestId) return;
      const next: ContentView = {
        revisionId: revision.id,
        text: base64ToUtf8(body.bodyBase64),
        sha256: body.sha256,
      };
      const published = (documentOverride ?? selected)?.publishedRevision;
      if (published && published.id !== revision.id && revision.state === 'CANDIDATE') {
        const publishedBody = await documentApi.content(published.id);
        if (contentRequestRef.current !== requestId) return;
        next.baseRevisionId = published.id;
        next.baseText = base64ToUtf8(publishedBody.bodyBase64);
      }
      setContent(next);
      setCompareOldId(next.baseRevisionId ?? '');
      setCompareNewId(revision.id);
      setError('');
    } catch (caught) {
      if (contentRequestRef.current !== requestId) return;
      setError(formatApiError(caught));
    } finally {
      if (contentRequestRef.current === requestId) setContentLoading(false);
    }
  }

  async function compareRevisions(oldId: string, newId: string) {
    if (!selected || !oldId || !newId || oldId === newId) {
      setError('请选择两个不同且可读取的修订版本。');
      return;
    }
    const requestId = contentRequestRef.current + 1;
    contentRequestRef.current = requestId;
    setContent(null);
    setContentLoading(true);
    setError('');
    try {
      const [oldBody, newBody] = await Promise.all([
        documentApi.content(oldId),
        documentApi.content(newId),
      ]);
      if (contentRequestRef.current !== requestId) return;
      setContent({
        revisionId: newId,
        text: base64ToUtf8(newBody.bodyBase64),
        sha256: newBody.sha256,
        baseRevisionId: oldId,
        baseText: base64ToUtf8(oldBody.bodyBase64),
      });
      setCompareOldId(oldId);
      setCompareNewId(newId);
    } catch (caught) {
      if (contentRequestRef.current !== requestId) return;
      setError(formatApiError(caught));
    } finally {
      if (contentRequestRef.current === requestId) setContentLoading(false);
    }
  }

  async function withdraw(confirmation: { ticketId: string; ticketSecret: string }) {
    if (!selected) throw new Error('缺少撤销目标');
    if (!withdrawReason.trim()) throw new Error('撤销原因不能为空');
    await documentApi.withdraw(selected.document.id, {
      expectedVersion: selected.document.version,
      reason: withdrawReason.trim(),
      confirmation,
    });
    setWithdrawOpen(false);
    setWithdrawReason('');
    await load();
    setNotice('发布已撤销；历史修订仍保留，原发布指针不会自动回退。');
  }

  function openReview(revision: RevisionView) {
    const reviewId = revisionReviewId(revision);
    if (reviewId) navigate(`/reviews?id=${encodeURIComponent(reviewId)}`);
  }

  async function openKnowledgeSearchResult(result: KnowledgeBaseSearchItem) {
    const requestId = searchResultOpenRequestRef.current + 1;
    searchResultOpenRequestRef.current = requestId;
    // A new search result supersedes any body request started by the previous result.
    contentRequestRef.current += 1;
    setContent(null);
    setContentLoading(false);
    setError('');
    let target = docs.find((item) => item.document.id === result.documentId);
    if (!target) {
      try {
        target = await documentApi.get(result.documentId);
        if (searchResultOpenRequestRef.current !== requestId) return;
        setDocs((current) =>
          current.some((item) => item.document.id === target?.document.id)
            ? current
            : [...current, target!],
        );
      } catch (caught) {
        if (searchResultOpenRequestRef.current !== requestId) return;
        setError(`文档暂时无法打开：${formatApiError(caught)}`);
        return;
      }
    }
    if (searchResultOpenRequestRef.current !== requestId) return;
    setActiveCollection(
      COLLECTIONS.some((collection) => collection.kind === result.knowledgeBaseKind)
        ? (result.knowledgeBaseKind as KnowledgeBaseKind)
        : null,
    );
    selectDocument(target.document.id);
    const revision =
      target.revisions.find((item) => item.id === result.revisionId) ?? target.publishedRevision;
    if (revision) void openContent(revision, target);
  }

  async function loadMoreKnowledgeSearch() {
    const q = projectSearch.trim();
    if (!q || Object.keys(searchCursors).length === 0) return;
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearchState('loading');
    const more = await Promise.allSettled(
      Object.entries(searchCursors).map(async ([knowledgeBaseId, cursor]) => ({
        knowledgeBaseId,
        page: await knowledgeBaseApi.search(knowledgeBaseId, { q, limit: 50, cursor }),
      })),
    );
    if (searchRequestRef.current !== requestId) return;
    const added: KnowledgeBaseSearchItem[] = [];
    const nextCursors = { ...searchCursors };
    let truncated = searchTruncated;
    const failed: string[] = [];
    more.forEach((result) => {
      if (result.status === 'rejected') {
        failed.push('部分知识库');
        return;
      }
      const { knowledgeBaseId, page: nextPage } = result.value;
      added.push(...nextPage.items);
      truncated ||= nextPage.truncated;
      if (nextPage.hasMore && nextPage.nextCursor)
        nextCursors[knowledgeBaseId] = nextPage.nextCursor;
      else delete nextCursors[knowledgeBaseId];
    });
    setSearchResults((current) => {
      const existing = new Set(
        current.map((item) => `${item.knowledgeBaseId}:${item.documentId}:${item.revisionId}`),
      );
      return [
        ...current,
        ...added.filter(
          (item) => !existing.has(`${item.knowledgeBaseId}:${item.documentId}:${item.revisionId}`),
        ),
      ];
    });
    setSearchCursors(nextCursors);
    setSearchHasMore(Object.keys(nextCursors).length > 0);
    setSearchTruncated(truncated);
    setSearchError(failed.length ? '部分知识库搜索暂时失败，当前结果可能不完整。' : '');
    setSearchState(failed.length === more.length ? 'error' : 'ready');
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>知识库</h2>
          <p className="page-sub">
            按业务事实、系统事实和角色实践浏览项目知识；版本、评审与发布操作集中在文档详情中。
          </p>
        </div>
        <div className="page-actions">
          <ProjectSelect
            onChange={() => {
              contentRequestRef.current += 1;
              searchResultOpenRequestRef.current += 1;
              setSelectedId('');
              setContent(null);
              setContentLoading(false);
              setProjectSearch('');
              setProjectSearchScope('');
              setCompareOldId('');
              setCompareNewId('');
            }}
            onCreateProject={() => navigate('/projects')}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => void load()}
            disabled={docsLoading}
          >
            {docsLoading ? '刷新中…' : '刷新文档'}
          </button>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="kb-notice">{notice}</p>}
      {documentIndexError && (
        <div
          className={documentIndexFailed ? 'error' : 'kb-notice'}
          role={documentIndexFailed ? 'alert' : 'status'}
        >
          {documentIndexError}
          <button
            type="button"
            className="ghost"
            onClick={() => void load()}
            disabled={docsLoading}
          >
            {docsLoading ? '读取中…' : '重新读取文档列表'}
          </button>
        </div>
      )}
      {requirementIndexError && (
        <div className="kb-notice" role="status">
          {requirementIndexError}
          <button
            type="button"
            className="ghost"
            onClick={() => void refreshRequirementIndex()}
            disabled={requirementIndexLoading}
          >
            {requirementIndexLoading ? '读取中…' : '重新读取需求索引'}
          </button>
        </div>
      )}
      <section className="knowledge-search-panel" aria-labelledby="knowledge-search-title">
        <div className="knowledge-search-copy sr-only">
          <h3 id="knowledge-search-title">在项目内搜索已发布知识</h3>
        </div>
        <label className="knowledge-search-field">
          <span className="sr-only">搜索项目知识</span>
          <span className="knowledge-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            aria-label="搜索项目知识"
            placeholder="试试业务规则、系统接口或操作步骤"
            value={projectSearch}
            onChange={(event) => setProjectSearch(event.target.value)}
            disabled={!projectId}
          />
          {projectSearch && (
            <button type="button" className="ghost" onClick={() => setProjectSearch('')}>
              清除
            </button>
          )}
        </label>
        <label className="knowledge-search-scope">
          <span>搜索范围</span>
          <select
            aria-label="知识搜索范围"
            value={projectSearchScope}
            onChange={(event) =>
              setProjectSearchScope(event.target.value as KnowledgeBaseKind | '')
            }
            disabled={!projectId || knowledgeBasesState !== 'ready'}
          >
            <option value="">全部可访问知识库</option>
            {COLLECTIONS.map((collection) => (
              <option key={collection.kind} value={collection.kind}>
                {collection.title}
              </option>
            ))}
          </select>
        </label>
        {projectSearch.trim() && (
          <div className="knowledge-search-results" aria-live="polite">
            {searchState === 'loading' && <InlineLoading label="正在搜索可访问的知识库…" />}
            {searchError && (
              <p
                className={searchState === 'error' ? 'error' : 'kb-notice'}
                role={searchState === 'error' ? 'alert' : 'status'}
              >
                {searchError}
                {searchState === 'error' && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setSearchRetry((n) => n + 1)}
                  >
                    重试
                  </button>
                )}
              </p>
            )}
            {searchTruncated && (
              <p className="kb-notice" role="status">
                部分知识库搜索达到扫描范围，结果可能不完整。
              </p>
            )}
            {searchState === 'ready' && searchResults.length === 0 && (
              <div className="knowledge-empty knowledge-search-empty" role="status">
                <strong>没有找到匹配的已发布知识</strong>
                <span>
                  可以更换关键词或搜索范围，再试一次。搜索只覆盖当前项目内你可访问的知识库。
                </span>
                <span className="knowledge-search-empty-scope">
                  搜索范围：{projectSearchScopeLabel}
                </span>
              </div>
            )}
            {searchResults.length > 0 && (
              <>
                <p className="knowledge-results-heading">
                  搜索结果 · {searchResults.length} 条 · {projectSearchScopeLabel}
                </p>
                <div className="knowledge-result-list">
                  {searchResults.map((result) => (
                    <button
                      type="button"
                      className="knowledge-search-result"
                      key={`${result.knowledgeBaseId}:${result.documentId}:${result.revisionId}`}
                      onClick={() => void openKnowledgeSearchResult(result)}
                    >
                      <span className="knowledge-result-meta">
                        {collectionTitle(result.knowledgeBaseKind)} ·{' '}
                        {KIND_LABELS[result.documentKind as DocumentDetail['document']['kind']] ??
                          result.documentKind}{' '}
                        · {searchStatusLabel(result.status)}
                      </span>
                      <strong>{result.title}</strong>
                      <span className="knowledge-result-excerpt">{result.excerpt}</span>
                      <span className="knowledge-result-base">{result.knowledgeBaseName}</span>
                    </button>
                  ))}
                </div>
                {searchHasMore && (
                  <button
                    type="button"
                    className="ghost knowledge-load-more"
                    onClick={() => void loadMoreKnowledgeSearch()}
                    disabled={searchState === 'loading'}
                  >
                    {searchState === 'loading' ? '读取中…' : '加载更多结果'}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {!activeCollection && !isReadingDocument && (
        <section className="knowledge-collections" aria-labelledby="knowledge-collections-title">
          <h3 id="knowledge-collections-title" className="sr-only">
            浏览三类知识
          </h3>
          <div className="knowledge-collection-grid">
            {COLLECTIONS.map((collection) => {
              const collectionBases = knowledgeBases.filter(
                (item) => item.kind === collection.kind,
              );
              const baseIds = new Set(collectionBases.map((item) => item.id));
              const collectionDocs = docs.filter((item) =>
                baseIds.has(item.document.knowledgeBaseId),
              );
              // The document endpoint is ordered by its server-provided update order. Keep that
              // order intact so the card's "最近更新" label remains truthful even when the newest
              // item is still a candidate revision.
              const recentDocs = collectionDocs.slice(0, 2);
              const unavailable = knowledgeBasesState === 'error' && collectionBases.length === 0;
              return (
                <article
                  key={collection.kind}
                  className={`knowledge-collection-card knowledge-collection-${collection.kind.toLowerCase()}${activeCollection === collection.kind ? ' is-selected' : ''}`}
                >
                  <button
                    type="button"
                    className="knowledge-collection-card-main"
                    aria-pressed={activeCollection === collection.kind}
                    onClick={() => setActiveCollection(collection.kind)}
                  >
                    <span className="knowledge-collection-topline">
                      <span className="knowledge-collection-marker" aria-hidden="true">
                        {collection.marker}
                      </span>
                      <span className="knowledge-collection-title">{collection.title}</span>
                      <span className="knowledge-collection-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </span>
                    <strong className="knowledge-collection-question">{collection.question}</strong>
                    <span className="knowledge-collection-docs">
                      {knowledgeBasesState === 'loading' || docsInitialLoading
                        ? '正在读取…'
                        : unavailable
                          ? '类别信息暂时无法读取'
                          : collectionBases.length === 0
                            ? '当前没有可浏览的此类内容'
                            : `${collectionDocs.length} 篇可浏览文档`}
                    </span>
                  </button>
                  {recentDocs.length > 0 && (
                    <details className="knowledge-featured-docs">
                      <summary className="knowledge-featured-caption">最近更新</summary>
                      {recentDocs.map((item) => {
                        const revision = item.publishedRevision ?? item.revisions[0];
                        return (
                          <button
                            type="button"
                            className="knowledge-featured-item"
                            key={item.document.id}
                            onClick={() => openDocument(item)}
                            disabled={!revision}
                          >
                            <span>{revision?.title ?? '未命名文档'}</span>
                            <small>
                              {item.publishedRevision
                                ? `当前生效 · v${item.publishedRevision.seq} · 阅读`
                                : revision
                                  ? `候选 · 尚未生效 · 查看`
                                  : '暂无可读取版本'}
                            </small>
                          </button>
                        );
                      })}
                    </details>
                  )}
                </article>
              );
            })}
          </div>
          {knowledgeBasesState === 'error' && knowledgeBasesError && (
            <p className="kb-notice" role="status">
              {knowledgeBasesError}
            </p>
          )}
        </section>
      )}

      {activeCollection && activeCollectionInfo && !isReadingDocument && (
        <section
          className={`knowledge-collection-context knowledge-collection-${activeCollection.toLowerCase()}`}
          aria-labelledby="knowledge-collection-context-title"
          data-testid="knowledge-collection-context"
        >
          <div className="knowledge-collection-context-copy">
            <h3 id="knowledge-collection-context-title">{activeCollectionInfo.title}</h3>
            <p className="knowledge-collection-context-question">{activeCollectionInfo.question}</p>
          </div>
          <button
            type="button"
            className="ghost knowledge-collection-context-clear"
            onClick={() => setActiveCollection(null)}
          >
            查看全部知识
          </button>
          <details className="knowledge-collection-context-more">
            <summary>集合信息</summary>
            <p className="knowledge-collection-context-examples">{activeCollectionInfo.examples}</p>
            <div className="knowledge-collection-context-details">
              <p>
                <strong>浏览范围</strong>
                <span>当前项目中你有权访问的{activeCollectionInfo.title}</span>
              </p>
              <p>
                <strong>库内知识库</strong>
                <span>
                  {knowledgeBasesState === 'loading'
                    ? '正在读取知识库…'
                    : knowledgeBasesState === 'error' && activeCollectionBases.length === 0
                      ? '知识库范围暂时无法确认'
                      : activeCollectionBases.length > 0
                        ? activeCollectionBases.map((base) => base.name).join('、')
                        : '当前没有可浏览的此类知识库'}
                </span>
              </p>
              <p>
                <strong>当前列表</strong>
                <span>
                  {docsLoading
                    ? '正在读取文档…'
                    : documentIndexFailed
                      ? `${collectionFilteredDocs.length} 篇已读取，列表可能不完整`
                      : `${collectionFilteredDocs.length} 篇符合当前筛选`}
                </span>
              </p>
            </div>
          </details>
        </section>
      )}

      {selected &&
        (query.trim() !== '' || kindFilter !== '' || activeCollection !== null) &&
        !collectionFilteredDocs.some((item) => item.document.id === selected.document.id) && (
          <p className="page-sub" role="status">
            当前查看的文档不在筛选结果中；详情仍保留，清除搜索或类型筛选可回到完整列表。
          </p>
        )}

      {!isReadingDocument && (
        <div className="table-card">
          <div className="card-head">
            <h3>
              文档
              <small>
                {docsInitialLoading
                  ? '加载中…'
                  : `${collectionFilteredDocs.length} / ${docs.length}`}
              </small>
            </h3>
            <div className="knowledge-table-scope" aria-live="polite">
              <span className="knowledge-scope-label">当前范围</span>
              {activeCollection ? (
                <button
                  type="button"
                  className="knowledge-scope-chip"
                  onClick={() => setActiveCollection(null)}
                  aria-label={`移除${collectionTitle(activeCollection)}范围`}
                >
                  {collectionTitle(activeCollection)} ×
                </button>
              ) : (
                <span className="knowledge-scope-chip is-all">全部知识库</span>
              )}
            </div>
            <div className="card-head-actions req-list-tools">
              {docsLoading && (
                <InlineLoading label={docsInitialLoading ? '正在加载文档…' : '正在刷新文档…'} />
              )}
              {requirementIndexLoading && !docsLoading && (
                <InlineLoading label="正在读取需求索引…" />
              )}
              <input
                aria-label="搜索文档"
                placeholder="筛选当前列表（标题 / 需求 / 类型）"
                title="仅筛选当前已加载文档的标题、类型、版本与需求关联，不搜索正文。"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                aria-label="文档类型筛选"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value)}
              >
                <option value="">全部类型</option>
                {Object.entries(KIND_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="collection-document-list" aria-label="文档列表">
            {docsInitialLoading ? (
              <div className="collection-document-loading">
                <SkeletonLines lines={5} />
              </div>
            ) : visibleDocs.length > 0 ? (
              visibleDocs.map((item) => {
                const latest = item.publishedRevision ?? item.revisions[0] ?? null;
                const knowledgeBase = knowledgeBaseForDocument(item.document, knowledgeBases);
                return (
                  <article
                    key={item.document.id}
                    className={`collection-document-item${selectedId === item.document.id ? ' is-selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="collection-document-body"
                      onClick={() => openDocument(item)}
                      disabled={!latest}
                    >
                      <strong className="collection-document-title">
                        {latest?.title ?? '未命名文档'}
                      </strong>
                      <span className="collection-document-meta">
                        <span>
                          {knowledgeBase ? collectionTitle(knowledgeBase.kind) : '类别暂不可用'}
                        </span>
                        <span>{knowledgeBase?.name ?? '知识库名称暂不可用'}</span>
                        <span>{KIND_LABELS[item.document.kind]}</span>
                        <span
                          className={item.publishedRevision ? 'collection-document-status' : ''}
                        >
                          {item.publishedRevision
                            ? `当前生效 · v${item.publishedRevision.seq}`
                            : latest
                              ? `候选 · 尚未生效 · v${latest.seq}`
                              : '暂无正文'}
                        </span>
                      </span>
                    </button>
                    <div className="collection-document-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => openDocument(item)}
                        disabled={!latest}
                      >
                        {item.publishedRevision
                          ? '阅读当前版本'
                          : latest
                            ? '查看最新候选'
                            : '暂无正文'}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => openDocumentGovernance(item.document.id)}
                      >
                        {selectedId === item.document.id ? '版本与评审（当前）' : '查看版本'}
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="collection-document-empty" role="status">
                {!projectId
                  ? '先选择项目。'
                  : docs.length === 0 && documentIndexError
                    ? '文档列表读取失败或未完整加载，暂时无法判断是否有文档。'
                    : docs.length === 0
                      ? '该项目还没有文档，等待本地 Agent 提交候选。'
                      : '没有匹配的文档，清空搜索或类型筛选。'}
              </p>
            )}
          </div>
          {collectionFilteredDocs.length > PAGE_SIZE && (
            <div className="table-pagination">
              <span>
                第 {page} / {pageCount} 页 · 共 {collectionFilteredDocs.length} 条
              </span>
              <div>
                <button
                  className="ghost"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  上一页
                </button>
                <button
                  className="ghost"
                  disabled={page >= pageCount}
                  onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeCollection === 'SYSTEM' && !isReadingDocument && (
        <details className="collection-relations">
          <summary>查看系统关系</summary>
          <KnowledgeSystemRelations
            projectId={projectId}
            loadUnits={projectApi.units}
            loadDependencies={projectApi.unitDependencies}
          />
        </details>
      )}
      {docs.length > 0 && !isReadingDocument && (
        <details className="knowledge-governance-note">
          <summary>了解知识内容如何产生</summary>
          <div className="page-card muted">
            Agent
            生成的候选会自动出现在这里。页面不提供手动新建文档、手写正文或追加修订入口；需要返修时，请在评审中提出意见，由本地
            Agent 生成下一版。
          </div>
        </details>
      )}

      {!isReadingDocument &&
        !docsLoading &&
        !docsInitialLoading &&
        docs.length === 0 &&
        !documentIndexFailed && (
          <details className="table-card knowledge-agent-guide" data-testid="knowledge-agent-guide">
            <summary className="card-head">如何让 Agent 产出第一份文档</summary>
            <div className="page-card muted">
              <p
                role={rolesState === 'loading' ? 'status' : undefined}
                aria-busy={rolesState === 'loading'}
              >
                <strong>当前项目可用角色：</strong>
                {rolesState === 'loading'
                  ? '正在读取角色…'
                  : rolesState === 'error'
                    ? '角色读取失败，暂时无法判断可用角色。'
                    : roles.length === 0
                      ? '当前项目没有可用业务角色。'
                      : roles.map((role) => (
                          <span className="status-tag" key={role.id}>
                            {role.title}
                            {role.key ? `（${role.key}）` : ''}
                          </span>
                        ))}
              </p>
              <p
                role={readyState === 'loading' ? 'status' : undefined}
                aria-busy={readyState === 'loading'}
              >
                <strong>可开工任务：</strong>
                {readyState === 'loading' ? (
                  '正在读取可开工任务…'
                ) : readyState === 'error' ? (
                  '可开工任务读取失败，请稍后重试或打开工作台。'
                ) : readyTasks.length === 0 ? (
                  '当前项目没有可开工任务。'
                ) : (
                  <>
                    {readyTasks.length} 项可开工任务。{' '}
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        navigate(`/?type=ready&project=${encodeURIComponent(projectId)}`)
                      }
                    >
                      查看可开工任务
                    </button>
                  </>
                )}
              </p>
              <p>
                <strong>CLI 初始化与任务流程：</strong>
                <code>workmesh auth login</code>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText('workmesh auth login')
                      .then(() => setCommandCopied(true))
                      .catch(() => setCommandCopied(false));
                  }}
                >
                  {commandCopied ? '已复制' : '复制初始化命令'}
                </button>
              </p>
              <p className="page-sub">
                认领：<code>workmesh claim --task &lt;taskId&gt; --json</code>；读取上下文：
                <code>
                  workmesh context --task &lt;taskId&gt; --claim &lt;claimId&gt; --expected-version
                  &lt;n&gt; --materialize --json
                </code>
                ；交付：<code>workmesh deliver ...</code>（参数见 CLI 帮助）。文档仍由 Agent
                生成和提交，本页不提供手工创建文档入口。
              </p>
            </div>
          </details>
        )}

      {contentLoading && !content && (
        <div className="table-card" data-testid="knowledge-content-loading">
          <div className="card-head">
            <h3>文档内容</h3>
          </div>
          <InlineLoading label="正在读取文档正文…" />
          <SkeletonLines lines={4} />
        </div>
      )}

      {content && (
        <div className="table-card knowledge-workspace-reader" ref={readerRef} tabIndex={-1}>
          <div className="card-head">
            <div className="knowledge-reader-heading">
              <nav className="knowledge-reader-breadcrumb" aria-label="当前位置">
                <button type="button" className="ghost" onClick={() => selectDocument('')}>
                  ← 返回{activeCollection ? collectionTitle(activeCollection) : '知识库'}
                </button>
                <span aria-hidden="true">/</span>
                <span>{activeCollection ? collectionTitle(activeCollection) : '全部知识库'}</span>
                {selectedKnowledgeBase && <span>{selectedKnowledgeBase.name}</span>}
              </nav>
              <h3>
                {contentRevision?.title ?? selected?.publishedRevision?.title ?? '文档内容'}
                <small>{contentVersionLabel}</small>
              </h3>
            </div>
          </div>
          <MarkdownReader text={content.text} />
          {content.baseText !== undefined && (
            <DiffViewer
              oldText={content.baseText}
              newText={content.text}
              baseLabel={
                selected?.publishedRevision?.id === content.baseRevisionId &&
                selected?.revisions.find((revision) => revision.id === content.revisionId)
                  ?.state === 'CANDIDATE'
                  ? `已发布 ${revisionLabel(content.baseRevisionId)}`
                  : `旧版本 ${revisionTitle(content.baseRevisionId)}`
              }
              currentLabel={
                selected?.publishedRevision?.id === content.baseRevisionId &&
                selected?.revisions.find((revision) => revision.id === content.revisionId)
                  ?.state === 'CANDIDATE'
                  ? `候选 ${revisionLabel(content.revisionId)}`
                  : `新版本 ${revisionTitle(content.revisionId)}`
              }
              testId="knowledge-diff"
            />
          )}
        </div>
      )}

      {selected && (
        <details
          className="knowledge-governance-panel"
          open={governanceOpen}
          onToggle={(event) => setGovernanceOpen(event.currentTarget.open)}
        >
          <summary>
            <span>版本与评审</span>
            <small>
              {candidateCount} 个候选待处理 · {requirementLabel(selected.document.requirementId)}
            </small>
          </summary>
          <details className="knowledge-source-panel">
            <summary>来源与适用信息</summary>
            <dl className="knowledge-source-grid">
              <div>
                <dt>所属知识库</dt>
                <dd>{selectedKnowledgeBase?.name ?? '知识库名称暂不可用'}</dd>
              </div>
              <div>
                <dt>文档类型</dt>
                <dd>{KIND_LABELS[selected.document.kind] ?? selected.document.kind}</dd>
              </div>
              <div>
                <dt>关联需求</dt>
                <dd>
                  {selectedRequirement
                    ? `${selectedRequirement.code} · ${selectedRequirement.title}`
                    : selected.document.requirementId
                      ? requirementLabel(selected.document.requirementId)
                      : '未关联需求'}
                </dd>
              </div>
              <div>
                <dt>理解基线</dt>
                <dd>
                  {selectedSourceRevision
                    ? revisionLabel(selectedSourceRevision.id)
                    : sourceRevisionForPanel?.basisUnderstandingRevisionId
                      ? revisionLabel(sourceRevisionForPanel.basisUnderstandingRevisionId)
                      : '未记录理解基线'}
                </dd>
              </div>
              {content && (
                <div>
                  <dt>正文 SHA-256</dt>
                  <dd className="knowledge-integrity-hash">{content.sha256}</dd>
                </div>
              )}
            </dl>
          </details>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>标题</th>
                  <th>状态</th>
                  <th>理解基线</th>
                  <th>验收标准</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {selected.revisions.map((revision) => {
                  const reviewId = revisionReviewId(revision);
                  return (
                    <tr key={revision.id}>
                      <td className="cell-num">v{revision.seq}</td>
                      <td>
                        <strong>{revision.title}</strong>
                        <div className="cell-mono cell-truncate">
                          摘要 {revision.digest.slice(0, 12)}
                        </div>
                      </td>
                      <td>
                        <span className="status-tag">
                          {REVISION_STATE_LABELS[revision.state] ?? revision.state}
                        </span>
                      </td>
                      <td>
                        <span>{revisionLabel(revision.basisUnderstandingRevisionId)}</span>
                      </td>
                      <td className="cell-num">{revision.acceptance?.length ?? 0}</td>
                      <td className="col-actions">
                        <div className="cell-actions row-actions">
                          <button className="ghost" onClick={() => void openContent(revision)}>
                            查看正文{content?.revisionId === revision.id ? '（当前）' : ''}
                          </button>
                          {revision.state === 'CANDIDATE' && reviewId ? (
                            <button className="primary" onClick={() => openReview(revision)}>
                              进入评审
                            </button>
                          ) : revision.state === 'CANDIDATE' ? (
                            <span className="muted">等待评审入口</span>
                          ) : null}
                          {revision.state === 'PUBLISHED' && (
                            <button
                              className="danger"
                              onClick={() => {
                                setWithdrawReason('');
                                setWithdrawOpen(true);
                              }}
                            >
                              撤销发布
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {selected.revisions.length === 0 && (
                  <tr className="table-empty">
                    <td colSpan={6}>该文档还没有修订。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {selected.revisions.length >= 2 && (
            <div
              className="knowledge-comparison-controls"
              data-testid="knowledge-comparison-controls"
            >
              <div className="card-head">
                <h3>
                  版本对比<small>选择任意两个修订版本</small>
                </h3>
              </div>
              <div className="card-head-actions" aria-label="选择对比版本">
                <label>
                  旧版本
                  <select
                    aria-label="对比旧版本"
                    value={compareOldId}
                    onChange={(event) => updateComparisonSelection('old', event.target.value)}
                  >
                    <option value="">选择旧版本</option>
                    {selected.revisions.map((revision) => (
                      <option key={revision.id} value={revision.id}>
                        v{revision.seq} · {revision.title} ·{' '}
                        {REVISION_STATE_LABELS[revision.state] ?? revision.state}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  新版本
                  <select
                    aria-label="对比新版本"
                    value={compareNewId}
                    onChange={(event) => updateComparisonSelection('new', event.target.value)}
                  >
                    <option value="">选择新版本</option>
                    {selected.revisions.map((revision) => (
                      <option key={revision.id} value={revision.id}>
                        v{revision.seq} · {revision.title} ·{' '}
                        {REVISION_STATE_LABELS[revision.state] ?? revision.state}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="ghost"
                  disabled={
                    contentLoading ||
                    !compareOldId ||
                    !compareNewId ||
                    compareOldId === compareNewId
                  }
                  onClick={() => void compareRevisions(compareOldId, compareNewId)}
                >
                  对比所选版本
                </button>
                {compareOldId && compareNewId && compareOldId === compareNewId && (
                  <span className="page-sub" role="status">
                    请选择两个不同的版本再对比。
                  </span>
                )}
              </div>
            </div>
          )}
        </details>
      )}

      <ConfirmationPrompt
        open={withdrawOpen}
        title="撤销发布（需二次验证）"
        description={selected ? `当前发布 v${selected.document.version}` : ''}
        targetLabel={
          selected
            ? `${(selected.publishedRevision ?? selected.revisions[0])?.title ?? '未命名文档'}${
                selected.document.requirementId
                  ? ` · ${
                      requirementsById.get(selected.document.requirementId)?.code ??
                      requirementLabel(selected.document.requirementId)
                    }`
                  : ''
              }`
            : ''
        }
        impact={[
          '撤销后该文档的“当前发布”指针会置空，读者将看不到这一版。',
          '历史修订、评审与审计记录会保留，不会删除。',
          '恢复发布需要重新发起并完成评审。',
        ]}
        binding={
          selected
            ? {
                action: 'KNOWLEDGE_WITHDRAW',
                projectId: selected.document.projectId,
                targetType: 'KNOWLEDGE_DOCUMENT',
                targetId: selected.document.id,
                expectedVersion: selected.document.version,
                roleSlot: null,
                payload: { reason: withdrawReason.trim() },
              }
            : null
        }
        submitLabel="撤销发布"
        onClose={() => setWithdrawOpen(false)}
        onConfirmed={withdraw}
      >
        <div className="field">
          <span>撤销原因（必填）</span>
          <textarea
            value={withdrawReason}
            onChange={(event) => setWithdrawReason(event.target.value)}
            aria-label="撤销原因"
            rows={3}
          />
        </div>
      </ConfirmationPrompt>
    </section>
  );
}
