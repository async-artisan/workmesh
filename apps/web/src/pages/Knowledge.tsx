import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  base64ToUtf8,
  documentApi,
  requirementApi,
  type DocumentDetail,
  type RequirementView,
  type RevisionView,
} from '../api/resources';
import { formatApiError } from '../api/client';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';

const KIND_LABELS: Record<DocumentDetail['document']['kind'], string> = {
  UNDERSTANDING: '理解',
  DECISION: '决策',
  PRD: 'PRD',
  KNOWLEDGE: '知识',
};

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

function diffLines(baseText: string, candidateText: string): string[] {
  const base = baseText.split(/\r?\n/);
  const candidate = candidateText.split(/\r?\n/);
  const lines: string[] = [];
  const max = Math.max(base.length, candidate.length);
  for (let index = 0; index < max; index += 1) {
    const before = base[index];
    const after = candidate[index];
    if (before === after) {
      if (after !== undefined) lines.push(`  ${after}`);
      continue;
    }
    if (before !== undefined) lines.push(`- ${before}`);
    if (after !== undefined) lines.push(`+ ${after}`);
  }
  return lines;
}

/**
 * 知识库页面是 Agent 产物的查看与决策台。文档和修订由本地 Agent 生成并提交，
 * 页面只展示版本、正文、差异和评审入口，并保留撤销发布这类需要人工确认的高风险操作。
 */
export function Knowledge() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const [docs, setDocs] = useState<DocumentDetail[]>([]);
  const [requirementsById, setRequirementsById] = useState<Map<string, RequirementView>>(
    new Map(),
  );
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [content, setContent] = useState<ContentView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');

  const selected = docs.find((item) => item.document.id === selectedId) ?? null;
  const requirementLabel = (id: string | null | undefined): string => {
    if (!id) return '—';
    const requirement = requirementsById.get(id);
    return requirement ? `${requirement.code} · ${requirement.title}` : '—';
  };
  const revisionLabel = (id: string | null | undefined): string => {
    if (!id) return '—';
    const revision = selected?.revisions.find((item) => item.id === id);
    return revision ? `v${revision.seq}` : '—';
  };
  const filteredDocs = useMemo(() => {
    const text = query.trim().toLowerCase();
    return docs.filter((item) => {
      if (kindFilter && item.document.kind !== kindFilter) return false;
      if (!text) return true;
      const latest = item.publishedRevision ?? item.revisions[0] ?? null;
      return [
        latest?.title ?? '',
        requirementLabel(item.document.requirementId),
        KIND_LABELS[item.document.kind],
      ]
        .join(' ')
        .toLowerCase()
        .includes(text);
    });
  }, [docs, kindFilter, query, requirementsById]);

  const pageCount = Math.max(1, Math.ceil(filteredDocs.length / PAGE_SIZE));
  const visibleDocs = filteredDocs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [projectId, kindFilter, query]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const candidateCount =
    selected?.revisions.filter((revision) => revision.state === 'CANDIDATE').length ?? 0;
  const diff = useMemo(
    () => (content?.baseText === undefined ? [] : diffLines(content.baseText, content.text)),
    [content],
  );

  async function load() {
    if (!projectId) {
      setDocs([]);
      setSelectedId('');
      setContent(null);
      return;
    }
    try {
      const [page, requirementPage] = await Promise.all([
        documentApi.list(projectId),
        requirementApi.list(projectId).catch(() => null),
      ]);
      setDocs(page.items);
      setRequirementsById(
        new Map((requirementPage?.items ?? []).map((item) => [item.id, item])),
      );
      setError('');
      setSelectedId((current) =>
        page.items.some((item) => item.document.id === current)
          ? current
          : (page.items[0]?.document.id ?? ''),
      );
      setContent(null);
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function openContent(revision: RevisionView) {
    try {
      const body = await documentApi.content(revision.id);
      const next: ContentView = {
        revisionId: revision.id,
        text: base64ToUtf8(body.bodyBase64),
        sha256: body.sha256,
      };
      const published = selected?.publishedRevision;
      if (published && published.id !== revision.id && revision.state === 'CANDIDATE') {
        const publishedBody = await documentApi.content(published.id);
        next.baseRevisionId = published.id;
        next.baseText = base64ToUtf8(publishedBody.bodyBase64);
      }
      setContent(next);
      setError('');
    } catch (caught) {
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
          <h2>知识库</h2>
          <p className="page-sub">
            文档由本地 Agent
            生成并提交。此页面用于查看版本、正文、差异和评审状态，人工只在关键决策和高风险操作处介入。
          </p>
        </div>
        <div className="page-actions">
          <ProjectSelect
            onChange={() => {
              setSelectedId('');
              setContent(null);
            }}
          />
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="kb-notice">{notice}</p>}

      <div className="page-card muted">
        Agent
        生成的候选会自动出现在这里。页面不提供手动新建文档、手写正文或追加修订入口；需要返修时，请在评审中提出意见，由本地
        Agent 生成下一版。
      </div>

      <div className="table-card">
        <div className="card-head">
          <h3>
            文档<small>{filteredDocs.length} / {docs.length}</small>
          </h3>
          <div className="card-head-actions req-list-tools">
            <input
              aria-label="搜索文档"
              placeholder="搜索标题 / 需求"
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
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>文档 / 最新版本</th>
                <th>绑定需求</th>
                <th>文档版本</th>
                <th>候选</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleDocs.map((item) => {
                const latest = item.publishedRevision ?? item.revisions[0] ?? null;
                return (
                <tr
                  key={item.document.id}
                  className={selectedId === item.document.id ? 'is-selected' : undefined}
                >
                  <td>
                    <span className="status-tag">{KIND_LABELS[item.document.kind]}</span>
                  </td>
                  <td>
                    <strong>{latest?.title ?? '未命名文档'}</strong>
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
                    <button
                      className="ghost"
                      onClick={() => {
                        setSelectedId(item.document.id);
                        setContent(null);
                      }}
                    >
                      {selectedId === item.document.id ? '当前' : '查看版本'}
                    </button>
                  </td>
                </tr>
                );
              })}
              {visibleDocs.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={6}>
                    {!projectId
                      ? '先选择项目。'
                      : docs.length === 0
                        ? '该项目还没有文档，等待本地 Agent 提交候选。'
                        : '没有匹配的文档，清空搜索或类型筛选。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredDocs.length > PAGE_SIZE && (
          <div className="table-pagination">
            <span>
              第 {page} / {pageCount} 页 · 共 {filteredDocs.length} 条
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
                        <span className="status-tag">{revision.state}</span>
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
          {content.baseText !== undefined && (
            <>
              <div className="card-head">
                <h3>
                  与已发布版本的差异<small>{revisionLabel(content.baseRevisionId)}</small>
                </h3>
              </div>
              <pre className="search-result" data-testid="knowledge-diff">
                {diff.length > 0 ? diff.join('\n') : '与已发布版本内容相同。'}
              </pre>
            </>
          )}
        </div>
      )}

      <ConfirmationPrompt
        open={withdrawOpen}
        title="撤销发布（需二次验证）"
        description={selected ? `文档 ${selected.document.id} v${selected.document.version}` : ''}
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
