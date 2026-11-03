import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { formatApiError } from '../api/client';
import {
  artifactApi,
  base64ToUtf8,
  documentApi,
  requirementApi,
  repositoryApi,
  reviewApi,
  taskApi,
  workflowApi,
  type ArtifactSetView,
  type DocumentDetail,
  type RequirementView,
  type ReviewSlot,
  type ReviewView,
  type RevisionView,
  type TaskView,
} from '../api/resources';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import { useAuthStore } from '../store/auth';
import {
  ARTIFACT_KIND_LABELS,
  ARTIFACT_STORAGE_LABELS,
  DECISION_LABELS,
  EXECUTION_STATUS_LABELS,
  PHASE_LABELS,
  REVIEW_KIND_LABELS,
  REVIEW_STATUS_LABELS,
  STEP_LABELS,
  labelFor,
} from '../lib/labels';
import { countDiff, diffLines } from '../lib/diff';

type DecisionValue = 'APPROVE' | 'CHANGES_REQUESTED' | 'REJECT';

type DocumentSubject = {
  documentId: string;
  revisionId: string;
  publishedRevisionId: string | null;
};

type Receipt = {
  decision: DecisionValue;
  slotKey: string;
  version: number;
  subjectDigest: string;
  at: string;
  actor: string;
};

function documentSubjectOf(review: ReviewView): DocumentSubject | null {
  const subject = review.subject;
  if (!subject) return null;
  const documentId = subject.documentId;
  const revisionId = subject.revisionId;
  if (typeof documentId !== 'string' || typeof revisionId !== 'string') return null;
  return {
    documentId,
    revisionId,
    publishedRevisionId:
      typeof subject.currentPublishedRevisionId === 'string'
        ? subject.currentPublishedRevisionId
        : null,
  };
}

function shortDigest(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function shortDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN');
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * 决定页：左侧证据（正文 / 差异 / 验收 / 工件 / 上次决定），右侧决定。
 * 所有写操作仍由 ConfirmPrompt 签发一次性票据；页面不自行推断权限。
 */
export function ReviewDecision({
  reviewId: reviewIdProp,
  embedded = false,
}: {
  reviewId?: string;
  embedded?: boolean;
} = {}) {
  const navigate = useNavigate();
  const params = useParams<{ reviewId: string }>();
  const reviewId = reviewIdProp ?? params.reviewId;
  const user = useAuthStore((state) => state.user);

  const [review, setReview] = useState<ReviewView | null>(null);
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [content, setContent] = useState<{
    revisionId: string;
    text: string;
    sha256: string;
  } | null>(null);
  const [publishedText, setPublishedText] = useState<string | null>(null);
  const [artifactSet, setArtifactSet] = useState<ArtifactSetView | null>(null);
  const [requirement, setRequirement] = useState<RequirementView | null>(null);
  const [task, setTask] = useState<TaskView | null>(null);
  const [taskStepKey, setTaskStepKey] = useState('');
  const [repositories, setRepositories] = useState<Awaited<ReturnType<typeof repositoryApi.list>>>(
    [],
  );
  const [acceptance, setAcceptance] = useState<NonNullable<RevisionView['acceptance']>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeSlot, setActiveSlot] = useState<ReviewSlot | null>(null);
  const [decision, setDecision] = useState<DecisionValue>('APPROVE');
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState<{
    slot: ReviewSlot;
    decision: DecisionValue;
    comment: string;
  } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!reviewId) return;
    let alive = true;
    setLoading(true);
    setError('');
    setReview(null);
    setDocument(null);
    setContent(null);
    setPublishedText(null);
    setArtifactSet(null);
    setRequirement(null);
    setTask(null);
    setTaskStepKey('');
    setRepositories([]);
    setAcceptance([]);
    setActiveSlot(null);
    setReceipt(null);

    async function load() {
      const value = await reviewApi.get(reviewId!);
      if (!alive) return;
      setReview(value);

      const subject = documentSubjectOf(value);
      if (subject) {
        const detail = await documentApi.get(subject.documentId);
        const body = await documentApi.content(subject.revisionId);
        let baseText: string | null = null;
        if (subject.publishedRevisionId && subject.publishedRevisionId !== subject.revisionId) {
          const published = await documentApi.content(subject.publishedRevisionId);
          baseText = base64ToUtf8(published.bodyBase64);
        }
        if (!alive) return;
        setDocument(detail);
        setContent({
          revisionId: subject.revisionId,
          text: base64ToUtf8(body.bodyBase64),
          sha256: body.sha256,
        });
        setPublishedText(baseText);
        return;
      }

      if (value.artifactSetId) {
        const set = await artifactApi.get(value.artifactSetId);
        if (!alive) return;
        setArtifactSet(set);
        // 仓库与 PRD 都是补充证据；读取失败不应阻塞现有交付物。
        const [repoResult] = await Promise.allSettled([repositoryApi.list(value.projectId)]);
        if (repoResult.status === 'fulfilled' && alive) setRepositories(repoResult.value);
        if (value.taskId) {
          const taskValue = await taskApi.get(value.taskId);
          if (!alive) return;
          setTask(taskValue);
          setTaskStepKey(taskValue.stepKey);
          try {
            const instance = await workflowApi.instance(taskValue.workflowInstanceId);
            const requirementDetail = await requirementApi.detail(
              value.projectId,
              instance.requirementId,
            );
            if (!alive) return;
            setRequirement(requirementDetail.requirement);
            setTaskStepKey(
              requirementDetail.tasks.find((item) => item.id === value.taskId)?.stepKey ??
                taskValue.stepKey,
            );
            try {
              const prds = await documentApi.list(value.projectId, 'PRD');
              const prd = prds.items.find(
                (item) => item.document.requirementId === requirementDetail.requirement.id,
              );
              if (alive) setAcceptance(prd?.publishedRevision?.acceptance ?? []);
            } catch {
              // PRD is optional evidence; preserve task and artifact data.
            }
          } catch {
            // 保留 artifactSet / task 证据，仅缺少需求上下文。
          }
        }
      }
    }

    load()
      .catch((caught: unknown) => {
        if (alive) setError(formatApiError(caught));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [reviewId]);

  const revision = useMemo<RevisionView | null>(() => {
    if (!document || !review?.documentRevisionId) return null;
    return document.revisions.find((item) => item.id === review.documentRevisionId) ?? null;
  }, [document, review]);

  const diff = useMemo(
    () => (content && publishedText !== null ? diffLines(publishedText, content.text) : []),
    [content, publishedText],
  );
  const diffCount = useMemo(() => countDiff(diff), [diff]);

  const subjectLabel =
    revision?.title ||
    (taskStepKey ? (STEP_LABELS[taskStepKey] ?? taskStepKey) : '') ||
    (review?.kind ? labelFor(REVIEW_KIND_LABELS, review.kind) : '评审对象');
  const requirementLabel = requirement ? `${requirement.code} · ${requirement.title}` : '';

  function repositoryOf(artifact: ArtifactSetView['artifacts'][number]) {
    return repositories.find((repo) => repo.id === artifact.projectRepositoryId) ?? null;
  }

  async function refreshTaskContext(taskId: string, projectId: string) {
    try {
      const refreshedTask = await taskApi.get(taskId);
      setTask(refreshedTask);
      setTaskStepKey(refreshedTask.stepKey);

      try {
        const instance = await workflowApi.instance(refreshedTask.workflowInstanceId);
        const requirementDetail = await requirementApi.detail(projectId, instance.requirementId);
        setRequirement(requirementDetail.requirement);
        setTaskStepKey(
          requirementDetail.tasks.find((item) => item.id === taskId)?.stepKey ??
            refreshedTask.stepKey,
        );
      } catch {
        // 需求上下文是补充信息；保留已刷新的任务状态。
      }
    } catch {
      // 审批已成功；刷新失败时保留页面已有上下文和审批回执。
    }
  }

  async function submitDecision(confirmation: { ticketId: string; ticketSecret: string }) {
    if (!review || !pending) throw new Error('缺少评审目标');
    if (
      (pending.decision === 'CHANGES_REQUESTED' || pending.decision === 'REJECT') &&
      !pending.comment.trim()
    )
      throw new Error('要求修改或驳回时必须填写说明');
    const result = await reviewApi.decide(review.id, {
      slotId: pending.slot.id,
      decision: pending.decision,
      expectedVersion: review.version,
      comment: pending.comment.trim() || undefined,
      confirmation,
    });
    setReview(result.review);
    setReceipt({
      decision: pending.decision,
      slotKey: pending.slot.slotKey,
      version: review.version,
      subjectDigest: review.subjectDigest,
      at: new Date().toLocaleString('zh-CN'),
      actor: user?.email ?? '当前用户',
    });
    setPending(null);
    setActiveSlot(null);
    setComment('');
    setError('');
    if (review.taskId) await refreshTaskContext(review.taskId, review.projectId);
  }

  async function copyReceipt() {
    if (!receipt) return;
    const text = `${labelFor(DECISION_LABELS, receipt.decision)} · ${subjectLabel} · v${receipt.version} · ${shortDigest(receipt.subjectDigest)} · ${receipt.at} · ${receipt.actor}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (loading && !review) {
    return (
      <section>
        <header className="page-head">
          <div>
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </div>
        </header>
        <div className="detail-card">
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
      </section>
    );
  }

  if (error && !review) {
    return (
      <section>
        <header className="page-head">
          <div>
            <h2>评审决定</h2>
            <p className="page-sub">无法打开这条评审。</p>
          </div>
          <div className="page-actions">
            <button className="ghost" onClick={() => navigate('/reviews')}>
              <ArrowLeft size={14} />
              返回评审
            </button>
          </div>
        </header>
        <p className="error" role="alert">
          {error}
        </p>
      </section>
    );
  }

  if (!review) return null;

  const open = review.status === 'OPEN';
  const actionableSlots = review.slots.filter((slot) => slot.viewerCanDecide && open);

  return (
    <section>
      {!embedded && (
        <header className="req-head">
          <div className="req-head-main">
            <div className="req-head-title">
              <span className="req-code">{labelFor(REVIEW_KIND_LABELS, review.kind)}</span>
              <h2>{subjectLabel}</h2>
              <span className="status-tag">{labelFor(REVIEW_STATUS_LABELS, review.status)}</span>
              <span className="status-tag">v{review.version}</span>
            </div>
            <div className="req-head-meta">
              {requirementLabel && `${requirementLabel} · `}摘要 {shortDigest(review.subjectDigest)}
            </div>
          </div>
          <div className="page-actions">
            <button className="ghost" onClick={() => navigate('/reviews')}>
              <ArrowLeft size={14} />
              返回评审
            </button>
          </div>
        </header>
      )}

      <div className={`req-layout${embedded ? ' is-embedded' : ''}`}>
        <div className="req-main">
          {revision && content && (
            <div className="detail-card">
              <div className="detail-card-head">
                <h3>
                  正文<small>v{revision.seq}</small>
                </h3>
                <span className="task-row-meta cell-mono" title={content.sha256}>
                  sha256 {shortDigest(content.sha256)}
                </span>
              </div>
              <pre className="paper-content">{content.text}</pre>
              {publishedText !== null && (
                <>
                  <div className="detail-card-head" style={{ marginTop: 14 }}>
                    <h3>
                      与已发布版本的差异
                      <small>
                        +{diffCount.added} / -{diffCount.removed}
                      </small>
                    </h3>
                  </div>
                  <div className="diff-view">
                    {diff.map((line, index) => (
                      <div className={`diff-line is-${line.kind}`} key={`${index}-${line.kind}`}>
                        <span className="diff-num">{line.oldNumber ?? ''}</span>
                        <span className="diff-num">{line.newNumber ?? ''}</span>
                        <span className="diff-text">
                          {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}
                          {line.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {revision && revision.acceptance && revision.acceptance.length > 0 && (
            <div className="detail-card">
              <h3>验收标准</h3>
              <ul className="detail-list">
                {revision.acceptance.map((item) => (
                  <li key={item.key}>
                    {item.text} <span className="task-row-meta">（{item.verification}）</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {requirement && (
            <div className="detail-card review-context-card">
              <div className="detail-card-head">
                <h3>需求上下文</h3>
                <button
                  className="ghost"
                  onClick={() => navigate(`/requirements/${requirement.code}`)}
                >
                  打开需求
                </button>
              </div>
              <div className="review-context-title">
                <strong>
                  {requirement.code} · {requirement.title}
                </strong>
                <span className="status-tag">{labelFor(PHASE_LABELS, requirement.phase)}</span>
              </div>
              {requirement.description && (
                <p className="review-context-description">{requirement.description}</p>
              )}
            </div>
          )}

          {acceptance.length > 0 && (
            <div className="detail-card">
              <div className="detail-card-head">
                <h3>
                  验收标准<small>已发布 PRD</small>
                </h3>
              </div>
              <ul className="detail-list">
                {acceptance.map((item) => (
                  <li key={item.key}>
                    {item.text} <span className="task-row-meta">（{item.verification}）</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {artifactSet && (
            <div className="detail-card">
              <div className="detail-card-head">
                <h3>
                  交付物<small>{artifactSet.artifacts.length}</small>
                </h3>
                <span className="task-row-meta cell-mono">
                  manifest {shortDigest(artifactSet.manifestDigest)}
                </span>
              </div>
              <div className="artifact-group">
                {artifactSet.artifacts.map((artifact) => {
                  const repository = repositoryOf(artifact);
                  const passedChecks = artifact.checks.filter((check) => check.passed).length;
                  const repoUrl =
                    repository?.adapter === 'github' && repository.owner && repository.name
                      ? `https://github.com/${repository.owner}/${repository.name}`
                      : null;
                  const commitUrl =
                    repoUrl && artifact.commitSha
                      ? `${repoUrl}/commit/${artifact.commitSha}`
                      : null;
                  return (
                    <div className="task-row review-artifact-row" key={artifact.id}>
                      <div className="task-row-main">
                        <div className="task-row-top">
                          <strong>{labelFor(ARTIFACT_KIND_LABELS, artifact.kind)}</strong>
                          <span className="status-tag">
                            {labelFor(ARTIFACT_STORAGE_LABELS, artifact.storage)}
                          </span>
                          <span className="status-tag">{artifact.mediaType}</span>
                          <span className="task-row-meta">{formatBytes(artifact.byteLength)}</span>
                        </div>
                        {artifact.summary && (
                          <div className="review-artifact-summary">{artifact.summary}</div>
                        )}
                        {artifact.storage === 'GIT_REF' && artifact.byteLength === 0 && (
                          <div className="task-row-meta">
                            代码引用不保存文件字节，需按提交与路径核对变更。
                          </div>
                        )}
                        {repository && (
                          <div className="task-row-meta">
                            仓库{' '}
                            {repoUrl ? (
                              <a href={repoUrl} target="_blank" rel="noreferrer">
                                {repository.owner}/{repository.name}
                              </a>
                            ) : (
                              `${repository.owner}/${repository.name}`
                            )}
                          </div>
                        )}
                        <div className="task-row-meta cell-mono" title={artifact.sha256}>
                          sha256 {shortDigest(artifact.sha256)}
                          {artifact.commitSha && (
                            <>
                              {' '}
                              ·{' '}
                              {commitUrl ? (
                                <a href={commitUrl} target="_blank" rel="noreferrer">
                                  commit {artifact.commitSha.slice(0, 8)}
                                </a>
                              ) : (
                                `commit ${artifact.commitSha.slice(0, 8)}`
                              )}
                            </>
                          )}
                          {artifact.repoPath && ` · ${artifact.repoPath}`}
                        </div>
                        {artifact.contentPreview && (
                          <pre className="paper-content artifact-preview">
                            {artifact.contentPreview.text}
                          </pre>
                        )}
                        {artifact.contentPreview?.truncated && (
                          <div className="task-row-meta">正文预览已截断。</div>
                        )}
                        <div className="review-checks">
                          <strong>
                            校验 {passedChecks}/{artifact.checks.length}
                          </strong>
                          {artifact.checks.length === 0 ? (
                            <span className="task-row-meta">无校验项</span>
                          ) : (
                            artifact.checks.map((check) => (
                              <span
                                key={check.code}
                                className={check.passed ? 'task-signed' : 'cell-danger'}
                              >
                                {check.passed ? '✓' : '✗'} {check.code}
                                {check.message ? `：${check.message}` : ''}
                                {check.source === 'EXTERNAL_REFERENCE' && check.evidence ? (
                                  <>
                                    {' · '}
                                    <a
                                      href={
                                        check.evidence.url.startsWith('https://')
                                          ? check.evidence.url
                                          : undefined
                                      }
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {check.evidence.provider} 引用（未核验）
                                    </a>
                                  </>
                                ) : (
                                  ' · Agent 自述'
                                )}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {artifactSet?.codeReview?.required && (
            <div
              className={`detail-card review-code-evidence${artifactSet.codeReview.acceptable ? '' : ' is-warning'}`}
            >
              <div className="detail-card-head">
                <h3>代码评审证据</h3>
                <span className={artifactSet.codeReview.acceptable ? 'task-signed' : 'cell-danger'}>
                  {artifactSet.codeReview.acceptable ? '已满足' : '缺少有效证据'}
                </span>
              </div>
              {artifactSet.codeReview.acceptable ? (
                <div className="evidence-list">
                  {artifactSet.codeReview.evidence.map((item) => (
                    <div className="evidence-card" key={item.id}>
                      <div className="evidence-head">
                        <strong>{item.changeRequestId}</strong>
                        <span className="status-tag">{item.state}</span>
                      </div>
                      <div className="evidence-meta">
                        评审人 {item.reviewerExternalId} · {item.reviewerKind} · 提交人{' '}
                        {item.authorExternalId}
                      </div>
                      <div className="evidence-meta cell-mono">
                        head {shortDigest(item.headSha)} · commit{' '}
                        {item.commitSha ? shortDigest(item.commitSha) : '—'}
                      </div>
                      {item.submittedAt && (
                        <div className="evidence-meta">{shortDate(item.submittedAt)}</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="review-warning">
                  该代码交付尚未获得有效的人类代码评审；批准会被服务端以
                  CODE_REVIEW_EVIDENCE_MISSING 拒绝。
                </p>
              )}
            </div>
          )}

          {!revision && !artifactSet && (
            <div className="detail-card detail-empty-block">
              <X size={18} />
              <span>该评审没有可展示的正文或工件证据。</span>
            </div>
          )}

          <div className="detail-card">
            <div className="detail-card-head">
              <h3>
                决定历史<small>{review.decisions.length}</small>
              </h3>
            </div>
            {review.decisions.length === 0 ? (
              <p className="detail-empty">还没有决定。</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>决定</th>
                      <th>决定人</th>
                      <th>说明</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.decisions.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <span className="status-tag">
                            {labelFor(DECISION_LABELS, item.decision)}
                          </span>
                        </td>
                        <td>{item.actor?.email ?? '—'}</td>
                        <td>{item.comment || '—'}</td>
                        <td>{shortDate(item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <aside className="req-side">
          {receipt && (
            <div className="detail-card next-step">
              <strong>
                <Check size={14} /> {labelFor(DECISION_LABELS, receipt.decision)} ·{' '}
                {receipt.slotKey}
              </strong>
              <p>
                v{receipt.version} · {receipt.at} · {receipt.actor}
                <br />
                <span className="cell-mono">{shortDigest(receipt.subjectDigest)}</span>
              </p>
              <div className="next-step-actions">
                <button className="ghost" onClick={() => void copyReceipt()}>
                  {copied ? '已复制' : '复制审计行'}
                </button>
                <button className="primary" onClick={() => navigate('/')}>
                  回工作台
                </button>
              </div>
            </div>
          )}

          <div className="detail-card">
            <h3>审批槽位</h3>
            {review.slots.length === 0 ? (
              <p className="detail-empty">该评审没有槽位。</p>
            ) : (
              <div className="task-groups">
                {review.slots.map((slot) => {
                  const decided = review.decisions.find((item) => item.approvalSlotId === slot.id);
                  return (
                    <div className="task-row" key={slot.id}>
                      <div className="task-row-main">
                        <div className="task-row-top">
                          <strong>{slot.slotKey}</strong>
                          {decided ? (
                            <span className="status-tag">
                              {labelFor(DECISION_LABELS, decided.decision)}
                            </span>
                          ) : slot.viewerCanDecide ? (
                            <span className="status-tag">待你决定</span>
                          ) : (
                            <span className="status-tag">等待审批人</span>
                          )}
                        </div>
                        <div className="task-row-meta">
                          {slot.requiredRoleId ? '按角色指派' : '按个人指派'}
                        </div>
                      </div>
                      {!decided && open && slot.viewerCanDecide && (
                        <button
                          className="primary"
                          onClick={() => {
                            setActiveSlot(slot);
                            setDecision('APPROVE');
                            setComment('');
                          }}
                        >
                          作出决定
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {open && activeSlot && (
            <div className="detail-card">
              <h3>作出决定 · {activeSlot.slotKey}</h3>
              <div className="form-grid">
                <div className="field">
                  <span>决定</span>
                  <select
                    aria-label="评审决定"
                    value={decision}
                    onChange={(event) => setDecision(event.target.value as DecisionValue)}
                  >
                    <option value="APPROVE">批准</option>
                    <option value="CHANGES_REQUESTED">要求修改</option>
                    <option value="REJECT">驳回</option>
                  </select>
                </div>
                <div className="field">
                  <span>
                    说明
                    {decision === 'CHANGES_REQUESTED' || decision === 'REJECT' ? '（必填）' : ''}
                  </span>
                  <textarea
                    aria-label="评审说明"
                    rows={3}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                </div>
              </div>
              <div className="next-step-actions">
                <button
                  className="primary"
                  disabled={
                    (decision === 'CHANGES_REQUESTED' || decision === 'REJECT') && !comment.trim()
                  }
                  onClick={() => setPending({ slot: activeSlot, decision, comment })}
                >
                  下一步：预览并验证
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {open && actionableSlots.length === 0 && (
            <div className="detail-card detail-empty">没有轮到你处理的槽位；等待指定审批人。</div>
          )}

          {!open && <div className="detail-card detail-empty">该评审已结束，只读。</div>}

          {task && (
            <div className="detail-card">
              <h3>任务上下文</h3>
              <ul className="detail-list">
                <li>步骤：{labelFor(STEP_LABELS, taskStepKey || task.stepKey)}</li>
                {review?.role && (
                  <li>
                    角色：{review.role.title}（{review.role.key}）
                  </li>
                )}
                <li>责任人：{task.responsibleUserId}</li>
                <li>状态：{labelFor(EXECUTION_STATUS_LABELS, task.executionStatus)}</li>
                <li>
                  版本：v{task.version} · 代次 {task.generation}
                </li>
              </ul>
            </div>
          )}
        </aside>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <ConfirmationPrompt
        open={Boolean(pending)}
        title="确认评审决定"
        description={pending ? `槽位 ${pending.slot.slotKey} · 评审 v${review.version}` : ''}
        binding={
          pending
            ? {
                action: 'REVIEW_DECIDE',
                projectId: review.projectId,
                targetType: 'REVIEW_REQUEST',
                targetId: review.id,
                expectedVersion: review.version,
                roleSlot: pending.slot.requiredRoleId
                  ? {
                      roleId: pending.slot.requiredRoleId,
                      approvalSlotId: pending.slot.id,
                    }
                  : null,
                payload: {
                  slotId: pending.slot.id,
                  decision: pending.decision,
                  subjectDigest: review.subjectDigest,
                  comment: pending.comment.trim() || null,
                },
              }
            : null
        }
        submitLabel="提交决定"
        onClose={() => setPending(null)}
        onConfirmed={submitDecision}
      />
    </section>
  );
}
