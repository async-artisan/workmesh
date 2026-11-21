import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type DocumentKind,
  type RevisionView,
  type RoleView,
} from '../api/resources';
import { ApiError, formatApiError } from '../api/client';
import { documentCatalogApi, type DocumentCatalogOverview } from '../api/documentCatalog';
import type { DocumentSummary, DocumentSummaryRevision } from '../api/documentSummaries';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import { DiffViewer } from '../components/DiffViewer';
import { ProjectSelect } from '../components/ProjectSelect';
import { InlineLoading, SkeletonLines } from '../components/Skeleton';
import { useProjectContext } from '../hooks/useProjectContext';
import { REVISION_STATE_LABELS } from '../lib/labels';
import { useDocumentSummaries } from '../hooks/useDocumentSummaries';
import { useDocumentHistory } from '../hooks/useDocumentHistory';
import { KnowledgeSystemRelations } from '../components/KnowledgeSystemRelations';
import { MarkdownReader } from '../components/MarkdownReader';
import './knowledge-workspace.css';

const KIND_LABELS: Record<DocumentKind, string> = {
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

type RevisionWithReview = RevisionView & { reviewRequestId?: string | null };

type ContentView = {
  documentId: string;
  documentVersion: number;
  revision: RevisionView;
  baseRevision?: RevisionView;
  revisionId: string;
  text: string;
  sha256: string;
  baseRevisionId?: string;
  baseText?: string;
};

function accessFailure(error: unknown): boolean {
  return error instanceof ApiError && [401, 403, 404].includes(error.status);
}

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
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<DocumentKind | ''>('');
  const catalog = useDocumentSummaries(projectId, {
    kind: kindFilter || undefined,
    knowledgeBaseKind: activeCollection ?? undefined,
    q: query,
    searchProfile: 'knowledge',
  });
  const [selection, setSelection] = useState<{
    projectId: string;
    summary: DocumentSummary;
  } | null>(null);
  const selected = selection?.projectId === projectId ? selection.summary : null;
  const selectedId = selected?.document.id ?? '';
  const history = useDocumentHistory(selectedId, { scopeKey: projectId });
  const { invalidateResolutions } = history;
  const [governanceOpen, setGovernanceOpen] = useState(false);
  const [content, setContent] = useState<ContentView | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [compareOldId, setCompareOldId] = useState('');
  const [compareNewId, setCompareNewId] = useState('');
  const [exactOldId, setExactOldId] = useState('');
  const [exactNewId, setExactNewId] = useState('');
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [summaryStale, setSummaryStale] = useState(false);
  const [readingDenied, setReadingDenied] = useState(false);
  const [pendingRead, setPendingRead] = useState<{
    projectId: string;
    documentId: string;
    revisionId: string;
    intent: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [rolesState, setRolesState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [readyTasks, setReadyTasks] = useState<
    Awaited<ReturnType<typeof workbenchApi.get>>['readyTasks']
  >([]);
  const [readyState, setReadyState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [commandCopied, setCommandCopied] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<{
    projectId: string;
    summary: DocumentSummary;
  } | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [overviewState, setOverviewState] = useState<{
    projectId: string;
    data: DocumentCatalogOverview | null;
    loading: boolean;
    error: string;
    stale: boolean;
  }>({ projectId, data: null, loading: Boolean(projectId), error: '', stale: false });
  const overview = overviewState.projectId === projectId ? overviewState.data : null;
  const overviewLoading =
    Boolean(projectId) && (overviewState.projectId !== projectId || overviewState.loading);
  const overviewError = overviewState.projectId === projectId ? overviewState.error : '';
  const overviewStale = overviewState.projectId === projectId && overviewState.stale;
  const activeProject = useRef(projectId);
  activeProject.current = projectId;
  const activeScope = useRef('');
  activeScope.current = JSON.stringify([projectId, selectedId]);
  const activeMutationScope = useRef('');
  activeMutationScope.current = JSON.stringify([
    projectId,
    selectedId,
    selected?.document.version,
    selected?.publishedRevision?.id,
  ]);
  const overviewRequestRef = useRef(0);
  const overviewController = useRef<AbortController | null>(null);
  const summaryRequestRef = useRef(0);
  const contentRequestRef = useRef(0);
  const readIntentRef = useRef(0);
  const knowledgeBasesRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const searchConsumedCursors = useRef(new Map<string, Set<string>>());
  const searchResultOpenRequestRef = useRef(0);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const docs = catalog.items;
  const docsLoading = catalog.loading;
  const docsInitialLoading =
    Boolean(projectId) && catalog.total === null && !catalog.error && !catalog.queryError;
  const documentIndexError = catalog.queryError ?? catalog.error;
  const restricted = readingDenied || history.accessDenied || catalog.accessDenied;
  const historyReadErrors = [...new Set([history.error, history.metadataError].filter(Boolean))];
  const actionsUnavailable =
    restricted || history.requiresReload || history.stale || history.loading;
  const documentVersionChanged =
    history.documentVersion !== null && history.documentVersion !== selected?.document.version;
  const isReadingDocument = Boolean(content);
  const revisions = useMemo(() => {
    const result = new Map<string, RevisionView | DocumentSummaryRevision>();
    if (selected?.publishedRevision)
      result.set(selected.publishedRevision.id, selected.publishedRevision);
    for (const revision of history.items) result.set(revision.id, revision);
    for (const [id, revision] of history.metadataById) result.set(id, revision);
    return result;
  }, [selected?.publishedRevision, history.items, history.metadataById]);
  const comparisonRevisions = [...revisions.values()].sort((a, b) => b.seq - a.seq);
  const activeCollectionInfo = COLLECTIONS.find((item) => item.kind === activeCollection) ?? null;
  const activeCollectionBases = knowledgeBases.filter((item) => item.kind === activeCollection);
  const projectSearchBases = useMemo(
    () =>
      projectSearchScope
        ? knowledgeBases.filter((item) => item.kind === projectSearchScope)
        : knowledgeBases,
    [knowledgeBases, projectSearchScope],
  );
  const projectSearchScopeLabel = projectSearchScope
    ? collectionTitle(projectSearchScope)
    : '全部可访问知识库';
  const candidateCount = selected?.candidateRevisionCount ?? 0;
  const contentRevision = content?.revision;
  const selectedKnowledgeBase = selected?.knowledgeBase;
  const selectedRequirement = selected?.requirement;
  const sourceRevisionForPanel =
    contentRevision ??
    (selected?.publishedRevision
      ? history.metadataById.get(selected.publishedRevision.id)
      : undefined);
  const contentVersionLabel = contentRevision
    ? selected?.publishedRevision?.id === contentRevision.id
      ? `当前生效 · v${contentRevision.seq}`
      : contentRevision.state === 'CANDIDATE'
        ? `候选 · 尚未生效 · v${contentRevision.seq}`
        : `历史版本 · v${contentRevision.seq}`
    : '';

  function requirementLabel(summary: DocumentSummary): string {
    return summary.requirement
      ? `${summary.requirement.code} · ${summary.requirement.title}`
      : summary.document.requirementId
        ? `关联需求暂不可读（${summary.document.requirementId}）`
        : '未关联需求';
  }
  function revisionLabel(id: string | null | undefined): string {
    if (!id) return '—';
    const revision = revisions.get(id);
    return revision ? `v${revision.seq}` : `未加载（${id}）`;
  }
  function revisionTitle(id: string | null | undefined): string {
    if (!id) return '—';
    const revision = revisions.get(id);
    return revision ? `v${revision.seq} · ${revision.title}` : `修订 ${id}（需读取元数据）`;
  }
  function clearReader() {
    ++contentRequestRef.current;
    ++readIntentRef.current;
    setPendingRead(null);
    invalidateResolutions();
    setContent(null);
    setContentLoading(false);
    setMetadataLoading(false);
    setCompareOldId('');
    setCompareNewId('');
    setExactOldId('');
    setExactNewId('');
  }
  const refreshOverview = useCallback(async () => {
    overviewController.current?.abort();
    const controller = new AbortController();
    overviewController.current = controller;
    const requestId = ++overviewRequestRef.current;
    if (!projectId) {
      setOverviewState({ projectId, data: null, loading: false, error: '', stale: false });
      return;
    }
    setOverviewState((previous) => ({
      projectId,
      data: previous.projectId === projectId ? previous.data : null,
      loading: true,
      error: '',
      stale: previous.projectId === projectId && previous.data !== null,
    }));
    try {
      const data = await documentCatalogApi.overview(projectId, controller.signal);
      if (
        controller.signal.aborted ||
        requestId !== overviewRequestRef.current ||
        activeProject.current !== projectId
      )
        return;
      setOverviewState({ projectId, data, loading: false, error: '', stale: false });
    } catch (caught) {
      if (
        controller.signal.aborted ||
        requestId !== overviewRequestRef.current ||
        activeProject.current !== projectId
      )
        return;
      setOverviewState((previous) => ({
        projectId,
        data: accessFailure(caught) ? null : previous.data,
        loading: false,
        error: `门户统计读取失败：${formatApiError(caught)}`,
        stale: !accessFailure(caught) && previous.data !== null,
      }));
    }
  }, [projectId]);
  useEffect(() => {
    void refreshOverview();
    return () => {
      ++overviewRequestRef.current;
      overviewController.current?.abort();
    };
  }, [refreshOverview]);
  useEffect(() => {
    ++contentRequestRef.current;
    ++summaryRequestRef.current;
    ++searchResultOpenRequestRef.current;
    ++readIntentRef.current;
    setSelection(null);
    setPendingRead(null);
    setContent(null);
    setContentLoading(false);
    setMetadataLoading(false);
    setGovernanceOpen(false);
    setProjectSearch('');
    setProjectSearchScope('');
    setQuery('');
    setKindFilter('');
    setCompareOldId('');
    setCompareNewId('');
    setExactOldId('');
    setExactNewId('');
    setWithdrawTarget(null);
    setError('');
    setNotice('');
    return () => {
      ++contentRequestRef.current;
      ++summaryRequestRef.current;
      ++searchResultOpenRequestRef.current;
      ++searchRequestRef.current;
      ++knowledgeBasesRequestRef.current;
    };
  }, [projectId]);
  useEffect(() => {
    setSelection((previous) => {
      if (!previous || previous.projectId !== projectId) return previous;
      const summary = catalog.items.find(
        (item) => item.document.id === previous.summary.document.id,
      );
      return summary ? { projectId, summary } : previous;
    });
  }, [catalog.items, projectId]);
  useEffect(() => {
    ++contentRequestRef.current;
    invalidateResolutions();
    setContent(null);
    setContentLoading(false);
    setMetadataLoading(false);
    setReadingDenied(false);
    setSummaryStale(false);
    setCompareOldId('');
    setCompareNewId('');
    setExactOldId('');
    setExactNewId('');
    setWithdrawTarget(null);
  }, [
    invalidateResolutions,
    selectedId,
    selected?.document.version,
    selected?.publishedRevision?.id,
  ]);
  useEffect(() => {
    if (!restricted && !history.requiresReload && !history.stale) return;
    ++contentRequestRef.current;
    ++readIntentRef.current;
    setPendingRead(null);
    setContent(null);
    setContentLoading(false);
    setMetadataLoading(false);
    setCompareOldId('');
    setCompareNewId('');
    setWithdrawTarget(null);
  }, [restricted, history.requiresReload, history.stale]);
  useEffect(() => {
    if (content) readerRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [content]);

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
    searchConsumedCursors.current.clear();

    if (!q) {
      setSearchState('idle');
      return;
    }
    if (q.length > 500) {
      setSearchState('error');
      setSearchError('正文搜索最多支持 500 个字符，请缩短搜索词。');
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

  function selectDocument(summary: DocumentSummary | null) {
    ++summaryRequestRef.current;
    ++searchResultOpenRequestRef.current;
    clearReader();
    setSelection(projectId && summary ? { projectId, summary } : null);
    setReadingDenied(false);
    setSummaryStale(false);
    setGovernanceOpen(false);
    setWithdrawTarget(null);
    setError('');
  }
  function openDocumentGovernance(summary: DocumentSummary) {
    selectDocument(summary);
    setGovernanceOpen(true);
  }
  function queueRead(summary: DocumentSummary, revisionId: string) {
    selectDocument(summary);
    setPendingRead({
      projectId,
      documentId: summary.document.id,
      revisionId,
      intent: readIntentRef.current,
    });
  }
  function openDocument(summary: DocumentSummary) {
    const revision = summary.publishedRevision ?? summary.latestVisibleRevision;
    if (!revision) {
      selectDocument(summary);
      setNotice('该文档还没有可读取的修订。');
      return;
    }
    queueRead(summary, revision.id);
  }
  async function refreshSelected(summary: DocumentSummary) {
    const scope = activeScope.current;
    const requestId = ++summaryRequestRef.current;
    setSummaryStale(true);
    try {
      const next = await documentCatalogApi.summary(summary.document.id);
      if (scope !== activeScope.current || requestId !== summaryRequestRef.current) return;
      setSelection({ projectId: next.document.projectId, summary: next });
      setSummaryStale(false);
    } catch (caught) {
      if (scope !== activeScope.current || requestId !== summaryRequestRef.current) return;
      setError(`当前文档概要读取失败：${formatApiError(caught)}`);
      if (accessFailure(caught)) setReadingDenied(true);
    }
  }
  async function load() {
    clearReader();
    setWithdrawTarget(null);
    setError('');
    setReadingDenied(false);
    await Promise.all([
      catalog.reload(),
      refreshOverview(),
      ...(selected ? [history.reload(), refreshSelected(selected)] : []),
    ]);
  }
  async function refreshHistory() {
    clearReader();
    setWithdrawTarget(null);
    setError('');
    setReadingDenied(false);
    await Promise.all([history.reload(), ...(selected ? [refreshSelected(selected)] : [])]);
  }
  function updateComparisonSelection(kind: 'old' | 'new', value: string) {
    ++contentRequestRef.current;
    ++readIntentRef.current;
    setPendingRead(null);
    invalidateResolutions();
    setContent(null);
    setContentLoading(false);
    setMetadataLoading(false);
    setError('');
    if (kind === 'old') setCompareOldId(value);
    else setCompareNewId(value);
  }
  function updateExactSelection(kind: 'old' | 'new', value: string) {
    updateComparisonSelection('old', '');
    setCompareNewId('');
    if (kind === 'old') setExactOldId(value);
    else setExactNewId(value);
  }
  async function resolveComparison() {
    if (actionsUnavailable) return;
    const oldId = exactOldId.trim();
    const newId = exactNewId.trim();
    if (!oldId || !newId || oldId === newId) {
      setError('请输入两个不同的准确修订 ID。');
      return;
    }
    const requestId = ++contentRequestRef.current;
    const scope = activeScope.current;
    invalidateResolutions();
    setContent(null);
    setMetadataLoading(true);
    setError('');
    const [oldRevision, newRevision] = await Promise.all([
      history.resolveRevision(oldId),
      history.resolveRevision(newId),
    ]);
    if (scope !== activeScope.current || requestId !== contentRequestRef.current) return;
    setMetadataLoading(false);
    if (!oldRevision || !newRevision) return;
    setCompareOldId(oldRevision.id);
    setCompareNewId(newRevision.id);
  }
  function contentFailure(caught: unknown) {
    setError(formatApiError(caught));
    if (accessFailure(caught)) {
      setReadingDenied(true);
      invalidateResolutions();
    }
  }
  async function openContent(revisionId: string) {
    if (!selected || actionsUnavailable) return;
    const publishedId = selected.publishedRevision?.id;
    const requestId = ++contentRequestRef.current;
    const scope = activeScope.current;
    const current = () => scope === activeScope.current && requestId === contentRequestRef.current;
    invalidateResolutions();
    setContent(null);
    setContentLoading(true);
    setMetadataLoading(false);
    setError('');
    try {
      const revision = await history.resolveRevision(revisionId);
      if (!current() || !revision) return;
      const needsBase =
        publishedId && publishedId !== revision.id && revision.state === 'CANDIDATE';
      const published = needsBase ? await history.resolveRevision(publishedId) : null;
      if (!current() || (needsBase && !published)) return;
      const [body, baseBody] = await Promise.all([
        documentApi.content(revision.id),
        published ? documentApi.content(published.id) : Promise.resolve(null),
      ]);
      if (!current()) return;
      setContent({
        documentId: selected.document.id,
        documentVersion: selected.document.version,
        revision,
        revisionId: revision.id,
        text: base64ToUtf8(body.bodyBase64),
        sha256: body.sha256,
        ...(published && baseBody
          ? {
              baseRevision: published,
              baseRevisionId: published.id,
              baseText: base64ToUtf8(baseBody.bodyBase64),
            }
          : {}),
      });
      setCompareOldId(published?.id ?? '');
      setCompareNewId(revision.id);
    } catch (caught) {
      if (current()) contentFailure(caught);
    } finally {
      if (current()) setContentLoading(false);
    }
  }
  async function compareRevisions(oldId: string, newId: string) {
    if (!selected || actionsUnavailable || !oldId || !newId || oldId === newId) {
      setError('请选择两个不同且可读取的修订版本。');
      return;
    }
    const requestId = ++contentRequestRef.current;
    const scope = activeScope.current;
    const current = () => scope === activeScope.current && requestId === contentRequestRef.current;
    setContent(null);
    setContentLoading(true);
    setError('');
    try {
      const [oldRevision, newRevision] = await Promise.all([
        history.resolveRevision(oldId),
        history.resolveRevision(newId),
      ]);
      if (!current() || !oldRevision || !newRevision) return;
      const [oldBody, newBody] = await Promise.all([
        documentApi.content(oldId),
        documentApi.content(newId),
      ]);
      if (!current()) return;
      setContent({
        documentId: selected.document.id,
        documentVersion: selected.document.version,
        revision: newRevision,
        baseRevision: oldRevision,
        revisionId: newId,
        text: base64ToUtf8(newBody.bodyBase64),
        sha256: newBody.sha256,
        baseRevisionId: oldId,
        baseText: base64ToUtf8(oldBody.bodyBase64),
      });
      setCompareOldId(oldId);
      setCompareNewId(newId);
    } catch (caught) {
      if (current()) contentFailure(caught);
    } finally {
      if (current()) setContentLoading(false);
    }
  }
  function openWithdraw() {
    if (!selected || actionsUnavailable || summaryStale || documentVersionChanged) return;
    setWithdrawReason('');
    setWithdrawTarget({ projectId, summary: selected });
  }
  async function withdraw(confirmation: { ticketId: string; ticketSecret: string }) {
    const target = withdrawTarget;
    if (
      !target ||
      !selected ||
      actionsUnavailable ||
      summaryStale ||
      documentVersionChanged ||
      target.projectId !== projectId ||
      target.summary.document.id !== selectedId ||
      target.summary.document.version !== selected.document.version ||
      target.summary.publishedRevision?.id !== selected.publishedRevision?.id
    )
      throw new Error('文档已变化，请刷新文档并重新确认撤销发布');
    if (!withdrawReason.trim()) throw new Error('撤销原因不能为空');
    const scope = activeScope.current;
    const mutationScope = activeMutationScope.current;
    try {
      await documentApi.withdraw(target.summary.document.id, {
        expectedVersion: target.summary.document.version,
        reason: withdrawReason.trim(),
        confirmation,
      });
    } catch (caught) {
      if (
        mutationScope === activeMutationScope.current &&
        caught instanceof ApiError &&
        caught.status === 409
      ) {
        setWithdrawTarget(null);
        await load();
        if (scope === activeScope.current) setError('文档已变化，请重新核对当前发布并确认撤销。');
      }
      throw caught;
    }
    if (mutationScope !== activeMutationScope.current) return;
    setWithdrawTarget(null);
    setWithdrawReason('');
    await load();
    if (scope === activeScope.current)
      setNotice('发布已撤销；历史修订仍保留，原发布指针不会自动回退。');
  }
  function openReview(revision: RevisionView) {
    const reviewId = revisionReviewId(revision);
    if (reviewId && !actionsUnavailable) navigate(`/reviews/${encodeURIComponent(reviewId)}`);
  }
  async function openKnowledgeSearchResult(result: KnowledgeBaseSearchItem) {
    const requestId = ++searchResultOpenRequestRef.current;
    const sourceProject = projectId;
    clearReader();
    setError('');
    try {
      const target = await documentCatalogApi.summary(result.documentId);
      if (
        requestId !== searchResultOpenRequestRef.current ||
        activeProject.current !== sourceProject
      )
        return;
      if (target.document.projectId !== sourceProject) throw new Error('搜索结果不属于当前项目');
      setActiveCollection(
        COLLECTIONS.some((item) => item.kind === result.knowledgeBaseKind)
          ? (result.knowledgeBaseKind as KnowledgeBaseKind)
          : null,
      );
      queueRead(target, result.revisionId);
    } catch (caught) {
      if (
        requestId !== searchResultOpenRequestRef.current ||
        activeProject.current !== sourceProject
      )
        return;
      setError(`文档暂时无法打开：${formatApiError(caught)}`);
    }
  }
  useEffect(() => {
    if (
      !pendingRead ||
      pendingRead.projectId !== projectId ||
      pendingRead.documentId !== selectedId ||
      pendingRead.intent !== readIntentRef.current ||
      history.loading
    )
      return;
    setPendingRead(null);
    if (!actionsUnavailable) void openContent(pendingRead.revisionId);
    // The intent waits for the history hook to bind to the selected document before resolving metadata.
  }, [pendingRead, projectId, selectedId, history.loading, actionsUnavailable]);

  async function loadMoreKnowledgeSearch() {
    const q = projectSearch.trim();
    if (
      !q ||
      q.length > 500 ||
      searchState === 'loading' ||
      Object.keys(searchCursors).length === 0
    )
      return;
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
      const seen = searchConsumedCursors.current.get(knowledgeBaseId) ?? new Set<string>();
      seen.add(searchCursors[knowledgeBaseId]);
      searchConsumedCursors.current.set(knowledgeBaseId, seen);
      if (nextPage.hasMore && nextPage.nextCursor && seen.has(nextPage.nextCursor)) {
        failed.push('游标重复的知识库（已停止续页）');
        delete nextCursors[knowledgeBaseId];
      } else if (nextPage.hasMore && nextPage.nextCursor)
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
              selectDocument(null);
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
      {selected && (restricted || historyReadErrors.length > 0) && (
        <div className="error" role="alert">
          {restricted && <p>当前文档已不可读取，请刷新文档或选择其他文档。</p>}
          {historyReadErrors.map((message) => (
            <p key={message}>{message}</p>
          ))}
          {history.stale && ' 已加载历史可能已过期。'}
          {!governanceOpen && (
            <button
              type="button"
              className="ghost"
              disabled={history.loading || history.loadingMore}
              onClick={() => void refreshHistory()}
            >
              刷新历史
            </button>
          )}
        </div>
      )}
      {documentIndexError && (
        <div className="error" role="alert">
          {documentIndexError}
          {catalog.stale && ' 数据可能已过期，当前仍显示上次成功读取的目录页。'}
          {!catalog.queryError && (
            <button
              type="button"
              className="ghost"
              onClick={() => void catalog.reload()}
              disabled={docsLoading}
            >
              重新读取文档列表
            </button>
          )}
        </div>
      )}
      {overviewError && (
        <div className="error" role="alert">
          {overviewError}
          {overviewStale && ' 统计可能已过期，当前保留上次成功结果。'}
        </div>
      )}
      <div className="card-head-actions" aria-busy={overviewLoading}>
        <span>
          {overviewLoading
            ? '正在读取门户统计…'
            : overview
              ? `项目共 ${overview.total} 篇可浏览文档${overviewStale ? '（统计可能已过期）' : ''}`
              : '门户统计尚未读取'}
        </span>
        <button
          type="button"
          className="ghost"
          disabled={overviewLoading || !projectId}
          onClick={() => void refreshOverview()}
        >
          重新读取门户
        </button>
      </div>
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
            disabled={!projectId || knowledgeBasesState === 'loading'}
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
                        {KIND_LABELS[result.documentKind as DocumentKind] ?? result.documentKind} ·{' '}
                        {searchStatusLabel(result.status)}
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
        <section
          className="knowledge-collections"
          aria-labelledby="knowledge-collections-title"
          data-testid="knowledge-overview"
        >
          <h3 id="knowledge-collections-title" className="sr-only">
            浏览三类知识
          </h3>
          <div className="knowledge-collection-grid">
            {COLLECTIONS.map((collection) => {
              const group = overview?.collections.find(
                (item) => item.knowledgeBaseKind === collection.kind,
              );
              const recentDocs = group?.recentItems ?? [];
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
                      {overviewLoading && !overview
                        ? '正在读取…'
                        : !group
                          ? '统计暂时无法读取'
                          : `${group.documentCount} 篇可浏览文档`}
                      {group && <small> · {group.knowledgeBaseCount} 个知识库</small>}
                    </span>
                  </button>
                  {recentDocs.length > 0 && (
                    <details className="knowledge-featured-docs">
                      <summary className="knowledge-featured-caption">最近更新</summary>
                      {recentDocs.map((item) => {
                        const revision = item.publishedRevision ?? item.latestVisibleRevision;
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
                    : catalog.total === null
                      ? '目录数量暂时无法确认'
                      : `${catalog.total} 篇符合当前筛选${catalog.stale ? '（数据可能已过期）' : ''}`}
                </span>
              </p>
            </div>
          </details>
        </section>
      )}

      {selected && !docs.some((item) => item.document.id === selected.document.id) && (
        <p className="page-sub" role="status">
          当前查看的文档不在当前结果页；详情仍保留，可以翻页或调整筛选继续浏览。
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
                  : catalog.total === null
                    ? '数量尚未读取'
                    : `当前页 ${docs.length} / 共 ${catalog.total} 篇`}
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
              <input
                aria-label="搜索文档"
                placeholder="搜索文档目录（标题 / 需求 / 类型）"
                title="在服务端搜索可访问文档目录；最多 100 个字符。正文使用上方独立搜索。"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                aria-label="文档类型筛选"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as DocumentKind | '')}
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
            ) : docs.length > 0 ? (
              docs.map((item) => {
                const latest = item.publishedRevision ?? item.latestVisibleRevision;
                const knowledgeBase = item.knowledgeBase;
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
                        onClick={() => openDocumentGovernance(item)}
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
                  : documentIndexError
                    ? '文档列表读取失败或未完整加载，暂时无法判断是否有文档。'
                    : overview?.total === 0 && !overviewStale
                      ? '该项目还没有文档，等待本地 Agent 提交候选。'
                      : '没有匹配的文档，清空搜索或类型筛选。'}
              </p>
            )}
          </div>
          <div className="table-pagination" aria-label="知识目录分页">
            <span>
              第 {catalog.pageIndex + 1} 页 · 每页最多 50 个文档
              {catalog.total !== null && ` · 共 ${catalog.total} 条`}
            </span>
            <div>
              <button
                type="button"
                className="ghost"
                disabled={!catalog.hasPrevious || docsLoading}
                onClick={() => void catalog.previousPage()}
              >
                上一页
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!catalog.hasNext || docsLoading}
                onClick={() => void catalog.nextPage()}
              >
                下一页
              </button>
            </div>
          </div>
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
        overview?.total === 0 &&
        !overviewLoading &&
        !overviewStale &&
        !overviewError && (
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
                <strong>前置已完成的团队任务：</strong>
                {readyState === 'loading' ? (
                  '正在读取前置已完成的团队任务…'
                ) : readyState === 'error' ? (
                  '前置已完成的团队任务读取失败，请稍后重试或打开工作台。'
                ) : readyTasks.length === 0 ? (
                  '当前项目没有前置已完成的团队任务。'
                ) : (
                  <>
                    {readyTasks.length} 项前置已完成的团队任务。{' '}
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        navigate(`/?type=ready&project=${encodeURIComponent(projectId)}`)
                      }
                    >
                      查看前置已完成的团队任务
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
                <button type="button" className="ghost" onClick={() => selectDocument(null)}>
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
                content.revision.state === 'CANDIDATE'
                  ? `已发布 ${revisionLabel(content.baseRevisionId)}`
                  : `旧版本 ${revisionTitle(content.baseRevisionId)}`
              }
              currentLabel={
                selected?.publishedRevision?.id === content.baseRevisionId &&
                content.revision.state === 'CANDIDATE'
                  ? `候选 ${revisionLabel(content.revisionId)}`
                  : `新版本 ${revisionTitle(content.revisionId)}`
              }
              testId="knowledge-diff"
            />
          )}
        </div>
      )}

      {selected && (
        <>
          {selected.publishedRevision && !restricted && (
            <div className="table-card" data-testid="knowledge-current-publication">
              <div className="card-head">
                <h3>
                  当前发布
                  <small>
                    v{selected.publishedRevision.seq} · {selected.publishedRevision.title}
                  </small>
                </h3>
              </div>
              <p className="page-sub">发布修订独立于已加载的历史页。{requirementLabel(selected)}</p>
              <div className="card-head-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={actionsUnavailable}
                  onClick={() => void openContent(selected.publishedRevision!.id)}
                >
                  查看当前发布
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={actionsUnavailable || summaryStale || documentVersionChanged}
                  onClick={openWithdraw}
                >
                  撤销发布
                </button>
              </div>
              {(summaryStale || documentVersionChanged) && (
                <p className="kb-notice" role="status">
                  文档概要尚未更新，请刷新文档后再撤销发布。
                </p>
              )}
            </div>
          )}
          <details
            className="knowledge-governance-panel"
            open={governanceOpen}
            onToggle={(event) => setGovernanceOpen(event.currentTarget.open)}
          >
            <summary>
              <span>版本与评审</span>
              <small>
                {candidateCount} 个候选待处理 · {requirementLabel(selected)}
              </small>
            </summary>
            {history.requiresReload && (
              <p className="kb-notice" role="status">
                历史已变化，请刷新历史后继续读取。
              </p>
            )}
            <div className="card-head-actions">
              <span>
                {history.total === null
                  ? '历史数量尚未读取'
                  : `已加载 ${history.items.length} / ${history.total} 条历史`}
              </span>
              <button
                type="button"
                className="ghost"
                disabled={history.loading || history.loadingMore}
                onClick={() => void refreshHistory()}
              >
                刷新历史
              </button>
              {history.hasMore && (
                <button
                  type="button"
                  className="ghost"
                  disabled={
                    history.loading || history.loadingMore || restricted || history.requiresReload
                  }
                  onClick={() => void history.loadMore()}
                >
                  {history.loadingMore ? '正在加载更多历史…' : '加载更多历史'}
                </button>
              )}
            </div>
            {history.loading && <InlineLoading label="正在读取版本历史…" />}
            {!restricted && (
              <>
                <details className="knowledge-source-panel">
                  <summary>来源与适用信息</summary>
                  <dl className="knowledge-source-grid">
                    <div>
                      <dt>所属知识库</dt>
                      <dd>{selectedKnowledgeBase?.name ?? '知识库名称暂不可用'}</dd>
                    </div>
                    <div>
                      <dt>文档类型</dt>
                      <dd>{KIND_LABELS[selected.document.kind]}</dd>
                    </div>
                    <div>
                      <dt>关联需求</dt>
                      <dd>
                        {selectedRequirement
                          ? `${selectedRequirement.code} · ${selectedRequirement.title}`
                          : requirementLabel(selected)}
                      </dd>
                    </div>
                    <div>
                      <dt>理解基线</dt>
                      <dd>
                        {sourceRevisionForPanel?.basisUnderstandingRevisionId
                          ? `${revisionLabel(sourceRevisionForPanel.basisUnderstandingRevisionId)} · 引用可能属于其他文档，未加载不代表不存在。`
                          : sourceRevisionForPanel
                            ? '未记录理解基线'
                            : '尚未读取准确修订元数据'}
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
                      {history.items.map((revision) => {
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
                              <span title="准确理解基线引用可能属于其他文档；未加载不代表不存在。">
                                {revisionLabel(revision.basisUnderstandingRevisionId)}
                              </span>
                            </td>
                            <td className="cell-num">{revision.acceptance?.length ?? 0}</td>
                            <td className="col-actions">
                              <div className="cell-actions row-actions">
                                <button
                                  type="button"
                                  className="ghost"
                                  disabled={actionsUnavailable}
                                  onClick={() => void openContent(revision.id)}
                                >
                                  查看正文{content?.revisionId === revision.id ? '（当前）' : ''}
                                </button>
                                {revision.state === 'CANDIDATE' && reviewId ? (
                                  <button
                                    type="button"
                                    className="primary"
                                    disabled={actionsUnavailable}
                                    onClick={() => openReview(revision)}
                                  >
                                    进入评审
                                  </button>
                                ) : revision.state === 'CANDIDATE' ? (
                                  <span className="muted">等待评审入口</span>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!history.loading && !history.error && history.total === 0 && (
                        <tr className="table-empty">
                          <td colSpan={6}>该文档还没有可见修订。</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div
                  className="knowledge-comparison-controls"
                  data-testid="knowledge-comparison-controls"
                >
                  <div className="card-head">
                    <h3>
                      版本对比<small>选择已加载版本，或按准确修订 ID 读取</small>
                    </h3>
                  </div>
                  <div className="card-head-actions" aria-label="选择对比版本">
                    {(['old', 'new'] as const).map((kind) => (
                      <label key={kind}>
                        {kind === 'old' ? '旧版本' : '新版本'}
                        <select
                          aria-label={kind === 'old' ? '对比旧版本' : '对比新版本'}
                          value={kind === 'old' ? compareOldId : compareNewId}
                          disabled={actionsUnavailable}
                          onChange={(event) => updateComparisonSelection(kind, event.target.value)}
                        >
                          <option value="">{kind === 'old' ? '选择旧版本' : '选择新版本'}</option>
                          {comparisonRevisions.map((revision) => (
                            <option key={revision.id} value={revision.id}>
                              v{revision.seq} · {revision.title} ·{' '}
                              {REVISION_STATE_LABELS[revision.state] ?? revision.state}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                    <button
                      type="button"
                      className="ghost"
                      disabled={
                        actionsUnavailable ||
                        contentLoading ||
                        metadataLoading ||
                        !compareOldId ||
                        !compareNewId ||
                        compareOldId === compareNewId
                      }
                      onClick={() => void compareRevisions(compareOldId, compareNewId)}
                    >
                      对比所选版本
                    </button>
                    {compareOldId && compareOldId === compareNewId && (
                      <span className="page-sub" role="status">
                        请选择两个不同的版本再对比。
                      </span>
                    )}
                  </div>
                  <div className="card-head-actions">
                    <label>
                      比较旧修订 ID
                      <input
                        aria-label="比较旧修订 ID"
                        value={exactOldId}
                        disabled={actionsUnavailable}
                        onChange={(event) => updateExactSelection('old', event.target.value)}
                      />
                    </label>
                    <label>
                      比较新修订 ID
                      <input
                        aria-label="比较新修订 ID"
                        value={exactNewId}
                        disabled={actionsUnavailable}
                        onChange={(event) => updateExactSelection('new', event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="ghost"
                      disabled={
                        actionsUnavailable ||
                        metadataLoading ||
                        !exactOldId.trim() ||
                        !exactNewId.trim() ||
                        exactOldId.trim() === exactNewId.trim()
                      }
                      onClick={() => void resolveComparison()}
                    >
                      读取比较版本
                    </button>
                    {metadataLoading && <InlineLoading label="正在读取准确修订元数据…" />}
                  </div>
                </div>
              </>
            )}
          </details>
        </>
      )}
      <ConfirmationPrompt
        open={Boolean(withdrawTarget)}
        title="撤销发布（需二次验证）"
        description={
          withdrawTarget
            ? `当前发布 v${withdrawTarget.summary.publishedRevision?.seq ?? '—'} · 文档版本 ${withdrawTarget.summary.document.version}`
            : ''
        }
        targetLabel={
          withdrawTarget
            ? `${withdrawTarget.summary.publishedRevision?.title ?? '未命名文档'} · ${requirementLabel(withdrawTarget.summary)}`
            : ''
        }
        impact={[
          '撤销后该文档的“当前发布”指针会置空，读者将看不到这一版。',
          '历史修订、评审与审计记录会保留，不会删除。',
          '恢复发布需要重新发起并完成评审。',
        ]}
        binding={
          withdrawTarget
            ? {
                action: 'KNOWLEDGE_WITHDRAW',
                projectId: withdrawTarget.projectId,
                targetType: 'KNOWLEDGE_DOCUMENT',
                targetId: withdrawTarget.summary.document.id,
                expectedVersion: withdrawTarget.summary.document.version,
                roleSlot: null,
                payload: { reason: withdrawReason.trim() },
              }
            : null
        }
        submitLabel="撤销发布"
        onClose={() => setWithdrawTarget(null)}
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
