import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  base64ToUtf8,
  documentApi,
  type DocumentDetail,
  type RequirementView,
  type RevisionView,
} from '../api/resources';
import { formatApiError } from '../api/client';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import { DiffViewer } from '../components/DiffViewer';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';
import { REVISION_STATE_LABELS } from '../lib/labels';
import { loadDocumentIndex } from '../lib/documentIndex';
import { loadRequirementIndex } from '../lib/requirementIndex';

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
 * PRD 页面是 Agent 产物的查看与决策台。
 * PRD 由本地 Product Agent 生成并提交候选；这里展示版本、差异和评审入口，
 * 只保留撤销发布等需要人工确认的高风险操作。
 */
export function Prds() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const [docs, setDocs] = useState<DocumentDetail[]>([]);
  const [requirementsById, setRequirementsById] = useState<Map<string, RequirementView>>(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'candidate' | 'published'>('all');
  const [content, setContent] = useState<ContentView | null>(null);
  const [compareOldId, setCompareOldId] = useState('');
  const [compareNewId, setCompareNewId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requirementIndexError, setRequirementIndexError] = useState('');
  const [requirementIndexLoading, setRequirementIndexLoading] = useState(false);
  const [documentIndexError, setDocumentIndexError] = useState('');
  const [documentIndexFailed, setDocumentIndexFailed] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  /** 文档列表请求序号：项目切换/刷新失败时旧请求不得覆盖新页面。 */
  const docsRequestRef = useRef(0);
  /** 需求索引请求序号：首次加载和手动重读都受保护，旧项目结果不得回写。 */
  const requirementIndexRequestRef = useRef(0);
  /** 正文请求序号：慢的旧版本请求完成后不得覆盖当前版本。 */
  const contentRequestRef = useRef(0);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');

  const selected = docs.find((item) => item.document.id === selectedId) ?? null;
  const requirementLabel = (id: string | null | undefined): string => {
    if (!id) return '未绑定需求';
    const requirement = requirementsById.get(id);
    if (requirement) return `${requirement.code} · ${requirement.title}`;
    return requirementIndexError ? '关联需求暂时无法读取' : '未绑定需求';
  };
  const revisionLabel = (id: string | null | undefined): string => {
    if (!id) return '—';
    const revision = selected?.revisions.find((item) => item.id === id);
    return revision ? `v${revision.seq}` : '—';
  };
  const filteredDocs = useMemo(() => {
    const text = query.trim().toLowerCase();
    return docs.filter((item) => {
      if (
        statusFilter === 'candidate' &&
        !item.revisions.some((revision) => revision.state === 'CANDIDATE')
      )
        return false;
      if (statusFilter === 'published' && !item.publishedRevision) return false;
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
        'PRD',
        'prd',
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
  }, [docs, query, statusFilter, requirementsById]);

  const candidateCount =
    selected?.revisions.filter((revision) => revision.state === 'CANDIDATE').length ?? 0;

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
      setContent(null);
      setRequirementsById(new Map());
      setRequirementIndexError('');
      setRequirementIndexLoading(false);
      setDocumentIndexError('');
      setDocumentIndexFailed(false);
      setDocsLoading(false);
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
        loadDocumentIndex(projectId, 'PRD'),
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
    } catch (caught) {
      if (docsRequestRef.current !== requestId) return;
      setDocumentIndexFailed(true);
      setDocumentIndexError(`文档列表读取失败：${formatApiError(caught)}`);
    } finally {
      if (docsRequestRef.current === requestId) setDocsLoading(false);
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
    setDocs([]);
    setSelectedId('');
    setContent(null);
    setError('');
    setDocumentIndexError('');
    setDocumentIndexFailed(false);
    setDocsLoading(false);
    setRequirementsById(new Map());
    setRequirementIndexError('');
    setRequirementIndexLoading(false);
    if (!projectId) return;
    void load();
  }, [projectId]);

  function selectDocument(documentId: string) {
    contentRequestRef.current += 1;
    setSelectedId(documentId);
    setContent(null);
    setCompareOldId('');
    setCompareNewId('');
    setError('');
  }

  async function openContent(revision: RevisionView) {
    const requestId = contentRequestRef.current + 1;
    contentRequestRef.current = requestId;
    setContent(null);
    setError('');
    try {
      const body = await documentApi.content(revision.id);
      if (contentRequestRef.current !== requestId) return;
      const next: ContentView = {
        revisionId: revision.id,
        text: base64ToUtf8(body.bodyBase64),
        sha256: body.sha256,
      };
      const published = selected?.publishedRevision;
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
              contentRequestRef.current += 1;
              setSelectedId('');
              setContent(null);
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
      {selected &&
        (query.trim() !== '' || statusFilter !== 'all') &&
        !filteredDocs.some((item) => item.document.id === selected.document.id) && (
          <p className="page-sub" role="status">
            当前查看的文档不在筛选结果中；详情仍保留，清除搜索或状态筛选可回到完整列表。
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
              {filteredDocs.length} / {docs.length}
            </small>
          </h3>
          <div className="card-head-actions req-list-tools">
            <input
              aria-label="搜索 PRD"
              placeholder="搜索标题 / 需求"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
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
              {filteredDocs.map((item) => {
                const latest = item.publishedRevision ?? item.revisions[0] ?? null;
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
                    <td>{requirementLabel(item.document.requirementId)}</td>
                    <td className="cell-num">v{item.document.version}</td>
                    <td className="cell-num">
                      {item.revisions.filter((revision) => revision.state === 'CANDIDATE').length}
                    </td>
                    <td className="col-actions">
                      <button className="ghost" onClick={() => selectDocument(item.document.id)}>
                        {selectedId === item.document.id ? '当前' : '查看版本'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredDocs.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={5}>
                    {!projectId
                      ? '先选择项目。'
                      : docs.length === 0 && documentIndexError
                        ? '文档列表读取失败或未完整加载，暂时无法判断是否有 PRD 文档。'
                        : docs.length === 0
                          ? '该项目还没有 PRD 文档，等待 Product Agent 提交候选。'
                          : '没有匹配的 PRD，清空搜索或状态筛选。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="table-card">
          <div className="card-head">
            <h3>
              版本与评审<small>{requirementLabel(selected.document.requirementId)}</small>
            </h3>
            <span className="card-head-actions">
              <small>{candidateCount} 个候选待处理</small>
            </span>
          </div>
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
                            查看内容{content?.revisionId === revision.id ? '（当前）' : ''}
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
        </div>
      )}

      {content && (
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
          {selected && selected.revisions.length >= 2 && (
            <div className="card-head-actions" aria-label="选择对比版本">
              <label>
                旧版本
                <select
                  aria-label="对比旧版本"
                  value={compareOldId}
                  onChange={(event) => setCompareOldId(event.target.value)}
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
                  onChange={(event) => setCompareNewId(event.target.value)}
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
                disabled={!compareOldId || !compareNewId || compareOldId === compareNewId}
                onClick={() => void compareRevisions(compareOldId, compareNewId)}
              >
                对比所选版本
              </button>
            </div>
          )}
          {content.baseText !== undefined && (
            <DiffViewer
              oldText={content.baseText}
              newText={content.text}
              baseLabel={`已发布 ${revisionLabel(content.baseRevisionId)}`}
              currentLabel={`候选 ${revisionLabel(content.revisionId)}`}
              testId="prd-diff"
            />
          )}
        </div>
      )}

      <ConfirmationPrompt
        open={withdrawOpen}
        title="撤销发布（需二次验证）"
        description={selected ? `当前发布 v${selected.document.version}` : ''}
        targetLabel={
          selected
            ? `${(selected.publishedRevision ?? selected.revisions[0])?.title ?? '未命名 PRD'}${
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
