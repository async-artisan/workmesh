import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  base64ToUtf8,
  documentApi,
  type DocumentDetail,
  type RevisionView,
} from '../api/resources';
import { formatApiError } from '../api/client';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';

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
 * PRD 页面是 Agent 产物的查看与决策台。
 * PRD 由本地 Product Agent 生成并提交候选；这里展示版本、差异和评审入口，
 * 只保留撤销发布等需要人工确认的高风险操作。
 */
export function Prds() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const [docs, setDocs] = useState<DocumentDetail[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [content, setContent] = useState<ContentView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');

  const selected = docs.find((item) => item.document.id === selectedId) ?? null;
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
      const page = await documentApi.list(projectId, 'PRD');
      setDocs(page.items);
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
          <h2>PRD 文档</h2>
          <p className="page-sub">
            PRD 由本地 Product Agent
            生成并提交候选。此页面用于查看版本、比较差异和进入评审，人工只在关键决策处介入。
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
        Agent 生成的候选会自动出现在这里。页面不提供手动新建或编辑 PRD
        的入口；需要返修时，请在评审中提出意见，由 Agent 生成下一版。
      </div>

      <div className="table-card">
        <div className="card-head">
          <h3>
            PRD<small>{docs.length}</small>
          </h3>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>当前发布版本</th>
                <th>需求</th>
                <th>文档版本</th>
                <th>候选</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((item) => (
                <tr
                  key={item.document.id}
                  className={selectedId === item.document.id ? 'is-selected' : undefined}
                >
                  <td>
                    <strong>{item.publishedRevision?.title ?? '尚未发布'}</strong>
                    <div className="cell-mono cell-truncate">{item.document.id}</div>
                  </td>
                  <td>
                    <span className="cell-mono cell-truncate">
                      {item.document.requirementId ?? '—'}
                    </span>
                  </td>
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
              ))}
              {docs.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={5}>
                    {projectId
                      ? '该项目还没有 PRD 文档，等待 Product Agent 提交候选。'
                      : '先选择项目。'}
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
              版本与评审<small>{selected.document.id}</small>
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
                        <div className="cell-mono cell-truncate">{revision.id}</div>
                      </td>
                      <td>
                        <span className="status-tag">{revision.state}</span>
                      </td>
                      <td>
                        <span className="cell-mono cell-truncate">
                          {revision.basisUnderstandingRevisionId ?? '—'}
                        </span>
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
              文档内容<small>{content.revisionId}</small>
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
                  与已发布版本的差异<small>{content.baseRevisionId}</small>
                </h3>
              </div>
              <pre className="search-result" data-testid="prd-diff">
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
