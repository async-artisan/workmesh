import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, formatApiError } from '../api/client';
import { documentCatalogApi } from '../api/documentCatalog';
import type { DocumentSummary, DocumentSummaryRevision } from '../api/documentSummaries';
import { base64ToUtf8, documentApi, type RevisionView } from '../api/resources';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import { DiffViewer } from '../components/DiffViewer';
import { ProjectSelect } from '../components/ProjectSelect';
import { InlineLoading, SkeletonLines, TableSkeletonRows } from '../components/Skeleton';
import { useDocumentHistory } from '../hooks/useDocumentHistory';
import { useDocumentSummaries } from '../hooks/useDocumentSummaries';
import { useProjectContext } from '../hooks/useProjectContext';
import { REVISION_STATE_LABELS } from '../lib/labels';

type ContentView = {
  documentId: string;
  documentVersion: number;
  revisionId: string;
  text: string;
  sha256: string;
  baseRevisionId?: string;
  baseText?: string;
  candidateComparison?: boolean;
};

function requirementLabel(summary: DocumentSummary): string {
  return summary.requirement
    ? `${summary.requirement.code} · ${summary.requirement.title}`
    : summary.document.requirementId
      ? '关联需求暂时无法读取'
      : '未绑定需求';
}

function accessFailure(error: unknown): boolean {
  return error instanceof ApiError && [401, 403, 404].includes(error.status);
}

/** PRD 由本地 Product Agent 提交；目录、分页历史和准确修订分别读取。 */
export function Prds() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'candidate' | 'published'>('all');
  const catalog = useDocumentSummaries(projectId, {
    kind: 'PRD',
    searchProfile: 'prd',
    q: query,
    status: statusFilter,
  });
  // 阅读对象独立于当前目录页；搜索和翻页不撤掉正在阅读的文档。
  const [selection, setSelection] = useState<{
    projectId: string;
    summary: DocumentSummary;
  } | null>(null);
  const selected = selection?.projectId === projectId ? selection.summary : null;
  const selectedId = selected?.document.id ?? '';
  const history = useDocumentHistory(selectedId, { scopeKey: projectId });
  const [content, setContent] = useState<ContentView | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [compareOldId, setCompareOldId] = useState('');
  const [compareNewId, setCompareNewId] = useState('');
  const [exactOldId, setExactOldId] = useState('');
  const [exactNewId, setExactNewId] = useState('');
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [readingDenied, setReadingDenied] = useState(false);
  const [summaryStale, setSummaryStale] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const contentRequestRef = useRef(0);
  const summaryRequestRef = useRef(0);
  const activeScope = useRef('');
  activeScope.current = JSON.stringify([projectId, selectedId]);
  const { invalidateResolutions } = history;

  const revisions = useMemo(() => {
    const byId = new Map<string, RevisionView | DocumentSummaryRevision>();
    if (selected?.publishedRevision)
      byId.set(selected.publishedRevision.id, selected.publishedRevision);
    for (const revision of history.items) byId.set(revision.id, revision);
    for (const revision of history.metadataById.values()) byId.set(revision.id, revision);
    return byId;
  }, [history.items, history.metadataById, selected?.publishedRevision]);
  const comparisonRevisions = [...revisions.values()].sort((a, b) => b.seq - a.seq);
  const restricted = history.accessDenied || readingDenied || catalog.accessDenied;
  const actionsUnavailable =
    restricted || history.requiresReload || history.stale || history.loading;
  const documentVersionChanged =
    history.documentVersion !== null && history.documentVersion !== selected?.document.version;
  const docsInitialLoading =
    Boolean(projectId) && catalog.total === null && !catalog.error && !catalog.queryError;

  function clearReader() {
    ++contentRequestRef.current;
    setContent(null);
    setContentLoading(false);
    setMetadataLoading(false);
    setCompareOldId('');
    setCompareNewId('');
    setExactOldId('');
    setExactNewId('');
    invalidateResolutions();
  }

  useEffect(() => {
    ++contentRequestRef.current;
    ++summaryRequestRef.current;
    setContent(null);
    setContentLoading(false);
    setMetadataLoading(false);
    setCompareOldId('');
    setCompareNewId('');
    setExactOldId('');
    setExactNewId('');
    setError('');
    setNotice('');
    setReadingDenied(false);
    setSummaryStale(false);
    setWithdrawOpen(false);
    setWithdrawReason('');
    return () => {
      ++contentRequestRef.current;
      ++summaryRequestRef.current;
    };
  }, [projectId, selectedId]);

  useEffect(() => {
    // 同一文档的新概要也会使旧发布差异和比较请求失效。
    ++contentRequestRef.current;
    setContent(null);
    setContentLoading(false);
    setMetadataLoading(false);
    setCompareOldId('');
    setCompareNewId('');
    setExactOldId('');
    setExactNewId('');
    invalidateResolutions();
  }, [invalidateResolutions, selected?.document.version, selected?.publishedRevision?.id]);

  useEffect(() => {
    if (!projectId || catalog.accessDenied) {
      setSelection(null);
      return;
    }
    setSelection((previous) => {
      const current = previous?.projectId === projectId ? previous.summary : null;
      const next = current
        ? catalog.items.find((item) => item.document.id === current.document.id)
        : catalog.items[0];
      return next ? { projectId, summary: next } : previous;
    });
  }, [catalog.accessDenied, catalog.items, projectId]);

  useEffect(() => {
    if (!restricted && !history.requiresReload) return;
    ++contentRequestRef.current;
    setContent(null);
    setContentLoading(false);
    setMetadataLoading(false);
    setCompareOldId('');
    setCompareNewId('');
    setExactOldId('');
    setExactNewId('');
    setWithdrawOpen(false);
  }, [history.requiresReload, restricted]);

  function selectDocument(summary: DocumentSummary) {
    if (!projectId || selectedId === summary.document.id) return;
    ++summaryRequestRef.current;
    clearReader();
    setSelection({ projectId, summary });
    setError('');
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
      if (accessFailure(caught)) {
        setReadingDenied(true);
      }
    }
  }

  async function refreshDocuments() {
    clearReader();
    setError('');
    setReadingDenied(false);
    await Promise.all([
      catalog.reload(),
      ...(selected ? [history.reload(), refreshSelected(selected)] : []),
    ]);
  }

  async function refreshHistory() {
    clearReader();
    setError('');
    setReadingDenied(false);
    await Promise.all([history.reload(), ...(selected ? [refreshSelected(selected)] : [])]);
  }

  function updateComparisonSelection(kind: 'old' | 'new', value: string) {
    ++contentRequestRef.current;
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
      const published =
        publishedId && publishedId !== revision.id && revision.state === 'CANDIDATE'
          ? await history.resolveRevision(publishedId)
          : null;
      if (!current()) return;
      // 发布目标不可读时保留准确失败，不能用另一版代替它形成差异。
      if (
        publishedId &&
        publishedId !== revision.id &&
        revision.state === 'CANDIDATE' &&
        !published
      )
        return;
      const [body, baseBody] = await Promise.all([
        documentApi.content(revision.id),
        published ? documentApi.content(published.id) : Promise.resolve(null),
      ]);
      if (!current()) return;
      setContent({
        documentId: selected.document.id,
        documentVersion: selected.document.version,
        revisionId: revision.id,
        text: base64ToUtf8(body.bodyBase64),
        sha256: body.sha256,
        ...(baseBody && published
          ? {
              baseRevisionId: published.id,
              baseText: base64ToUtf8(baseBody.bodyBase64),
              candidateComparison: true,
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

  async function compareRevisions() {
    if (
      !selected ||
      actionsUnavailable ||
      !compareOldId ||
      !compareNewId ||
      compareOldId === compareNewId
    ) {
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
        history.resolveRevision(compareOldId),
        history.resolveRevision(compareNewId),
      ]);
      if (!current() || !oldRevision || !newRevision) return;
      const [oldBody, newBody] = await Promise.all([
        documentApi.content(oldRevision.id),
        documentApi.content(newRevision.id),
      ]);
      if (!current()) return;
      setContent({
        documentId: selected.document.id,
        documentVersion: selected.document.version,
        revisionId: newRevision.id,
        text: base64ToUtf8(newBody.bodyBase64),
        sha256: newBody.sha256,
        baseRevisionId: oldRevision.id,
        baseText: base64ToUtf8(oldBody.bodyBase64),
      });
    } catch (caught) {
      if (current()) contentFailure(caught);
    } finally {
      if (current()) setContentLoading(false);
    }
  }

  async function withdraw(confirmation: { ticketId: string; ticketSecret: string }) {
    if (!selected || actionsUnavailable || summaryStale || documentVersionChanged)
      throw new Error('请刷新文档后再撤销发布');
    if (!withdrawReason.trim()) throw new Error('撤销原因不能为空');
    const scope = activeScope.current;
    await documentApi.withdraw(selected.document.id, {
      expectedVersion: selected.document.version,
      reason: withdrawReason.trim(),
      confirmation,
    });
    if (scope !== activeScope.current) return;
    setWithdrawOpen(false);
    setWithdrawReason('');
    await refreshDocuments();
    if (scope === activeScope.current)
      setNotice('发布已撤销；历史修订仍保留，原发布指针不会自动回退。');
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>PRD 文档</h2>
          <p className="page-sub">
            PRD 由本地 Product Agent
            生成并提交候选。此页面用于查看版本、比较差异和进入评审，人工只在关键决策处介入。
          </p>
        </div>
        <div className="page-actions">
          <ProjectSelect
            onChange={() => {
              ++summaryRequestRef.current;
              clearReader();
              setSelection(null);
            }}
            onCreateProject={() => navigate('/projects')}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => void refreshDocuments()}
            disabled={catalog.loading}
          >
            {catalog.loading ? '刷新中…' : '刷新文档'}
          </button>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="kb-notice">{notice}</p>}
      {(catalog.error || catalog.queryError) && (
        <div className="error" role="alert">
          {catalog.queryError ?? catalog.error}
          {catalog.stale && ' 数据可能已过期，当前仍显示上次成功读取的目录页。'}
          {!catalog.queryError && (
            <button
              type="button"
              className="ghost"
              onClick={() => void catalog.reload()}
              disabled={catalog.loading}
            >
              重新读取文档列表
            </button>
          )}
        </div>
      )}
      {selected && !catalog.items.some((item) => item.document.id === selectedId) && (
        <p className="page-sub" role="status">
          当前查看的文档不在当前结果页中；搜索、筛选和翻页后仍保留阅读内容。
        </p>
      )}
      <div className="page-card muted">
        Agent 生成的候选会自动出现在这里。页面不提供手动新建或编辑 PRD
        的入口；需要返修时，请在评审中提出意见，由 Agent 生成下一版。
      </div>
      <div className="table-card">
        <div className="card-head">
          <h3>
            PRD
            <small>
              {docsInitialLoading
                ? '加载中…'
                : catalog.total === null
                  ? '数量尚未读取'
                  : `本页 ${catalog.items.length} / 共 ${catalog.total} 个文档`}
            </small>
          </h3>
          <div className="card-head-actions req-list-tools">
            {(catalog.loading || docsInitialLoading) && (
              <InlineLoading label={docsInitialLoading ? '正在加载 PRD…' : '正在刷新 PRD…'} />
            )}
            <input
              aria-label="搜索 PRD"
              placeholder="搜索标题 / 需求（最多 100 字符）"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-invalid={Boolean(catalog.queryError)}
            />
            <select
              aria-label="PRD 状态筛选"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as 'all' | 'candidate' | 'published')
              }
            >
              <option value="all">全部状态</option>
              <option value="candidate">有候选</option>
              <option value="published">已发布</option>
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>文档 / 最新版本</th>
                <th>需求</th>
                <th>文档版本</th>
                <th>候选</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {docsInitialLoading ? (
                <TableSkeletonRows rows={5} columns={5} />
              ) : (
                catalog.items.map((item) => {
                  const latest = item.latestVisibleRevision;
                  return (
                    <tr
                      key={item.document.id}
                      className={selectedId === item.document.id ? 'is-selected' : undefined}
                    >
                      <td>
                        <strong>{latest?.title ?? '未命名 PRD'}</strong>
                        <div className="task-row-meta">
                          {item.publishedRevision
                            ? `已发布 v${item.publishedRevision.seq}`
                            : latest
                              ? `最新候选 v${latest.seq}`
                              : '还没有修订'}
                        </div>
                      </td>
                      <td>{requirementLabel(item)}</td>
                      <td className="cell-num">v{item.document.version}</td>
                      <td className="cell-num">{item.candidateRevisionCount}</td>
                      <td className="col-actions">
                        <button className="ghost" onClick={() => selectDocument(item)}>
                          {selectedId === item.document.id ? '当前' : '查看版本'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
              {!docsInitialLoading && catalog.items.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={5}>
                    {!projectId
                      ? '先选择项目。'
                      : catalog.error || catalog.queryError
                        ? '文档列表读取失败或查询无效，暂时无法判断是否有 PRD 文档。'
                        : query.trim() || statusFilter !== 'all'
                          ? '没有匹配的 PRD，清空搜索或状态筛选。'
                          : '该项目还没有 PRD 文档，等待 Product Agent 提交候选。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card-head-actions" aria-label="PRD 目录分页">
          <button
            type="button"
            className="ghost"
            onClick={() => void catalog.previousPage()}
            disabled={!catalog.hasPrevious || catalog.loading}
          >
            上一页
          </button>
          <span>第 {catalog.pageIndex + 1} 页，每页最多 50 个文档</span>
          <button
            type="button"
            className="ghost"
            onClick={() => void catalog.nextPage()}
            disabled={!catalog.hasNext || catalog.loading}
          >
            下一页
          </button>
        </div>
      </div>
      {selected && (
        <>
          {selected.publishedRevision && !restricted && (
            <div className="table-card" data-testid="prd-published-revision">
              <div className="card-head">
                <h3>
                  当前发布
                  <small>
                    v{selected.publishedRevision.seq} · {selected.publishedRevision.title}
                  </small>
                </h3>
              </div>
              <p className="page-sub">
                {requirementLabel(selected)} · 发布修订独立于已加载的历史页。
              </p>
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
                  onClick={() => {
                    setWithdrawReason('');
                    setWithdrawOpen(true);
                  }}
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
          <div className="table-card">
            <div className="card-head">
              <h3>
                版本与评审<small>{requirementLabel(selected)}</small>
              </h3>
              <span className="card-head-actions">
                <small>{selected.candidateRevisionCount} 个候选待处理</small>
              </span>
            </div>
            {history.error && (
              <p className="error" role="alert">
                {history.error}
                {history.stale && ' 已加载历史可能已过期。'}
              </p>
            )}
            {history.metadataError && (
              <p className="error" role="alert">
                {history.metadataError}
              </p>
            )}
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
                onClick={() => void refreshHistory()}
                disabled={history.loading || history.loadingMore}
              >
                刷新历史
              </button>
              {history.hasMore && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void history.loadMore()}
                  disabled={
                    history.loading || history.loadingMore || restricted || history.requiresReload
                  }
                >
                  {history.loadingMore ? '正在加载更多历史…' : '加载更多历史'}
                </button>
              )}
            </div>
            {history.loading && <InlineLoading label="正在读取版本历史…" />}
            {!restricted && (
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
                    {history.loading ? (
                      <TableSkeletonRows rows={3} columns={6} />
                    ) : (
                      history.items.map((revision) => (
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
                            <span
                              title={
                                revision.basisUnderstandingRevisionId
                                  ? '准确理解基线引用，可能属于其他文档；未加载不代表不存在。'
                                  : undefined
                              }
                            >
                              {revisionLabel(revision.basisUnderstandingRevisionId)}
                            </span>
                          </td>
                          <td className="cell-num">{revision.acceptance?.length ?? 0}</td>
                          <td className="col-actions">
                            <div className="cell-actions row-actions">
                              <button
                                className="ghost"
                                disabled={actionsUnavailable}
                                onClick={() => void openContent(revision.id)}
                              >
                                查看内容{content?.revisionId === revision.id ? '（当前）' : ''}
                              </button>
                              {revision.state === 'CANDIDATE' && revision.reviewRequestId ? (
                                <button
                                  className="primary"
                                  disabled={actionsUnavailable}
                                  onClick={() =>
                                    navigate(
                                      `/reviews/${encodeURIComponent(revision.reviewRequestId!)}`,
                                    )
                                  }
                                >
                                  进入评审
                                </button>
                              ) : revision.state === 'CANDIDATE' ? (
                                <span className="muted">等待评审入口</span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                    {!history.loading && !history.error && history.total === 0 && (
                      <tr className="table-empty">
                        <td colSpan={6}>该文档还没有可见修订。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {!restricted && (
            <div className="table-card" data-testid="prd-comparison-controls">
              <div className="card-head">
                <h3>
                  版本对比<small>选择已加载版本，或按准确修订 ID 读取</small>
                </h3>
              </div>
              <div className="card-head-actions" aria-label="选择对比版本">
                {(['old', 'new'] as const).map((kind) => {
                  const value = kind === 'old' ? compareOldId : compareNewId;
                  return (
                    <label key={kind}>
                      {kind === 'old' ? '旧版本' : '新版本'}
                      <select
                        aria-label={kind === 'old' ? '对比旧版本' : '对比新版本'}
                        value={value}
                        disabled={actionsUnavailable}
                        onChange={(event) => updateComparisonSelection(kind, event.target.value)}
                      >
                        <option value="">{kind === 'old' ? '选择旧版本' : '选择新版本'}</option>
                        {value && !revisions.has(value) && (
                          <option value={value}>{revisionTitle(value)}</option>
                        )}
                        {comparisonRevisions.map((revision) => (
                          <option key={revision.id} value={revision.id}>
                            v{revision.seq} · {revision.title} ·{' '}
                            {REVISION_STATE_LABELS[revision.state] ?? revision.state}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
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
                  onClick={() => void compareRevisions()}
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
                  准确旧修订
                  <input
                    aria-label="比较旧修订 ID"
                    value={exactOldId}
                    disabled={actionsUnavailable}
                    onChange={(event) => updateExactSelection('old', event.target.value)}
                  />
                </label>
                <label>
                  准确新修订
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
                    !exactNewId.trim()
                  }
                  onClick={() => void resolveComparison()}
                >
                  {metadataLoading ? '正在读取比较版本…' : '读取比较版本'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {selected && contentLoading && !content && (
        <div className="table-card" data-testid="prd-content-loading">
          <div className="card-head">
            <h3>文档内容</h3>
          </div>
          <InlineLoading label="正在读取文档正文…" />
          <SkeletonLines lines={4} />
        </div>
      )}
      {content &&
        selected &&
        content.documentId === selectedId &&
        content.documentVersion === selected.document.version &&
        !restricted && (
          <div className="table-card">
            <div className="card-head">
              <h3>
                文档内容<small>{revisionLabel(content.revisionId)}</small>
              </h3>
              <span className="card-head-actions">
                <small className="cell-mono">sha256 {content.sha256}</small>
              </span>
            </div>
            <pre className="search-result">{content.text}</pre>
            {content.baseText !== undefined && (
              <DiffViewer
                oldText={content.baseText}
                newText={content.text}
                baseLabel={
                  content.candidateComparison
                    ? `已发布 ${revisionLabel(content.baseRevisionId)}`
                    : `旧版本 ${revisionTitle(content.baseRevisionId)}`
                }
                currentLabel={
                  content.candidateComparison
                    ? `候选 ${revisionLabel(content.revisionId)}`
                    : `新版本 ${revisionTitle(content.revisionId)}`
                }
                testId="prd-diff"
              />
            )}
          </div>
        )}
      <ConfirmationPrompt
        open={withdrawOpen}
        title="撤销发布（需二次验证）"
        description={selected ? `当前文档 v${selected.document.version}` : ''}
        targetLabel={
          selected
            ? `${selected.publishedRevision?.title ?? '未命名 PRD'}${selected.requirement ? ` · ${selected.requirement.code}` : ''}`
            : ''
        }
        impact={[
          '撤销后该 PRD 的“当前发布”指针会置空，读者将看不到这一版。',
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
