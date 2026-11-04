import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { ApiError, formatApiError } from '../api/client';
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
import { DiffViewer } from '../components/DiffViewer';
import type { DecisionArtifactSummary, DecisionSummaryData } from '../components/DecisionSummary';
import { EmptyState } from '../components/EmptyState';
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
  decisionImpact,
  labelFor,
  reviewRequiresCompleteEvidence,
  type ReviewDecisionValue,
} from '../lib/labels';
import { diffLines, diffSummary } from '../lib/diff';
type DecisionValue = ReviewDecisionValue;

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

/** 上下文数据源：只有真正读取成功才允许展示数据；失败/无权限不得退化成“空数组”。 */
type ContextKind = 'artifactSet' | 'requirement' | 'prd' | 'repositories';
type ContextStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error' | 'forbidden';
type ContextErrorInfo = { message: string; detail?: string; requestId?: string };
type ContextState = { status: ContextStatus; error?: ContextErrorInfo };

const EMPTY_CONTEXTS: Record<ContextKind, ContextState> = {
  artifactSet: { status: 'idle' },
  requirement: { status: 'idle' },
  prd: { status: 'idle' },
  repositories: { status: 'idle' },
};

const CONTEXT_KIND_LABELS: Record<ContextKind, string> = {
  artifactSet: '交付物上下文',
  requirement: '需求上下文',
  prd: 'PRD 上下文',
  repositories: '仓库上下文',
};

/** 关键上下文：读取失败会直接影响“证据是否完整”的判断（PRD/仓库是补充证据）。 */
const CRITICAL_CONTEXTS: ContextKind[] = ['artifactSet', 'requirement'];

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

/** 把上下文请求失败映射成互斥状态：403 是权限边界，不诱导重试；其它才是可重试故障。 */
function toContextState(error: unknown): ContextState {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  const detail = formatApiError(error);
  if (error instanceof ApiError && error.status === 403) {
    return {
      status: 'forbidden',
      error: { message: '你没有查看该上下文的权限。', detail, requestId },
    };
  }
  return {
    status: 'error',
    error: { message: '暂时无法读取该上下文，请稍后重试。', detail, requestId },
  };
}

/** 确认摘要中的单个工件：名称与“介质 / 校验 / 截断”等关键事实都来自真实数据。 */
function artifactSummaryOf(
  artifact: ArtifactSetView['artifacts'][number],
): DecisionArtifactSummary {
  const passed = artifact.checks.filter((check) => check.passed).length;
  const name = artifact.summary ?? artifact.repoPath ?? artifact.mediaType;
  const details = [
    labelFor(ARTIFACT_STORAGE_LABELS, artifact.storage),
    artifact.mediaType,
    `校验 ${passed}/${artifact.checks.length}`,
    artifact.contentPreview?.truncated ? '正文预览已截断' : null,
    formatBytes(artifact.byteLength),
  ].filter((item): item is string => Boolean(item));
  return {
    label: `${labelFor(ARTIFACT_KIND_LABELS, artifact.kind)} · ${name}`,
    detail: details.join(' · '),
  };
}

function ContextLoading({ label }: { label: string }) {
  return (
    <div className="detail-card">
      <h3>{label}</h3>
      <p className="task-row-meta" role="status">
        正在读取{label}…
      </p>
    </div>
  );
}

function ContextFailureCard({
  title,
  description,
  failure,
  status,
  retryLabel,
  onRetry,
}: {
  title: string;
  description: string;
  failure?: ContextErrorInfo;
  status: 'error' | 'forbidden';
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="detail-card">
      <EmptyState
        title={title}
        description={failure?.message ?? description}
        hint={
          status === 'error'
            ? description
            : '这不是暂时故障，重试不会恢复；如需查看，请联系项目管理员开通该上下文的权限。'
        }
        variant={status === 'forbidden' ? 'no-access' : 'no-data'}
        actionLabel={status === 'error' && onRetry ? retryLabel : undefined}
        onAction={status === 'error' && onRetry ? onRetry : undefined}
      >
        {failure?.detail && (
          <details className="wm-error-state__details">
            <summary className="wm-error-state__summary">查看技术详情</summary>
            <pre className="wm-error-state__detail">{failure.detail}</pre>
          </details>
        )}
      </EmptyState>
    </div>
  );
}

function ContextEmptyCard({
  title,
  description,
  hint,
}: {
  title: string;
  description: string;
  hint?: string;
}) {
  return (
    <div className="detail-card">
      <EmptyState title={title} description={description} hint={hint} variant="no-data" />
    </div>
  );
}

/**
 * 决定页：左侧证据（正文 / 差异 / 验收 / 工件 / 上次决定），右侧决定。
 * 所有写操作仍由 ConfirmPrompt 签发一次性票据；页面不自行推断权限。
 *
 * 证据完整性边界：服务端只提供 artifact.contentPreview（上限 4 KiB、truncated 标记），
 * 没有完整正文读取或下载接口；页面如实展示预览范围与“打开原工件”，不伪造完整正文。
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
  const [contexts, setContexts] = useState<Record<ContextKind, ContextState>>(() => ({
    ...EMPTY_CONTEXTS,
  }));
  const [evidenceAcknowledged, setEvidenceAcknowledged] = useState(false);
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

  function setContext(kind: ContextKind, next: ContextState) {
    setContexts((prev) => ({ ...prev, [kind]: next }));
  }

  /** 交付物上下文：artifactSet 是任务验收的关键证据，失败时保留失败状态而不是空数组。 */
  async function loadArtifactSetContext(
    reviewValue: ReviewView,
    alive: () => boolean = () => true,
  ) {
    if (!reviewValue.artifactSetId) {
      setContext('artifactSet', { status: 'empty' });
      return;
    }
    setContext('artifactSet', { status: 'loading' });
    try {
      const value = await artifactApi.get(reviewValue.artifactSetId);
      if (!alive()) return;
      setArtifactSet(value);
      setContext('artifactSet', { status: 'loaded' });
    } catch (caught) {
      if (!alive()) return;
      setContext('artifactSet', toContextState(caught));
    }
  }

  /** 仓库上下文：只用于核对 GIT_REF 与“打开原工件”链接，是补充证据。 */
  async function loadRepositoryContext(reviewValue: ReviewView, alive: () => boolean = () => true) {
    setContext('repositories', { status: 'loading' });
    try {
      const list = await repositoryApi.list(reviewValue.projectId);
      if (!alive()) return;
      setRepositories(list);
      setContext('repositories', { status: list.length > 0 ? 'loaded' : 'empty' });
    } catch (caught) {
      if (!alive()) return;
      setContext('repositories', toContextState(caught));
    }
  }

  /** PRD 上下文：已发布 PRD 的验收标准；未绑定与读取失败是两种不同状态。 */
  async function loadPrdContext(
    reviewValue: ReviewView,
    requirementId: string | null,
    alive: () => boolean = () => true,
  ) {
    if (!requirementId) {
      setContext('prd', { status: 'empty' });
      return;
    }
    setContext('prd', { status: 'loading' });
    try {
      const page = await documentApi.list(reviewValue.projectId, 'PRD');
      if (!alive()) return;
      const prd = page.items.find((item) => item.document.requirementId === requirementId);
      setAcceptance(prd?.publishedRevision?.acceptance ?? []);
      setContext('prd', { status: prd ? 'loaded' : 'empty' });
    } catch (caught) {
      if (!alive()) return;
      setContext('prd', toContextState(caught));
    }
  }

  /** 需求上下文：任务 → 流程实例 → 需求；任何一步失败都不覆盖已有成功数据。 */
  async function loadRequirementContext(
    reviewValue: ReviewView,
    alive: () => boolean = () => true,
  ) {
    if (!reviewValue.taskId) {
      setContext('requirement', { status: reviewValue.requirement ? 'loaded' : 'empty' });
      return;
    }
    setContext('requirement', { status: 'loading' });
    setContext('prd', { status: 'loading' });
    try {
      const taskValue = await taskApi.get(reviewValue.taskId);
      const instance = await workflowApi.instance(taskValue.workflowInstanceId);
      const requirementDetail = await requirementApi.detail(
        reviewValue.projectId,
        instance.requirementId,
      );
      if (!alive()) return;
      const stepKey =
        requirementDetail.tasks.find((item) => item.id === reviewValue.taskId)?.stepKey ??
        taskValue.stepKey;
      setTask(taskValue);
      setRequirement(requirementDetail.requirement);
      setTaskStepKey(stepKey);
      setContext('requirement', { status: 'loaded' });
      await loadPrdContext(reviewValue, requirementDetail.requirement.id, alive);
    } catch (caught) {
      if (!alive()) return;
      setContext('requirement', toContextState(caught));
      setContext('prd', { status: 'idle' });
    }
  }

  useEffect(() => {
    if (!reviewId) return;
    let alive = true;
    const isAlive = () => alive;
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
    setContexts({ ...EMPTY_CONTEXTS });
    setEvidenceAcknowledged(false);
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
        // 文档评审的正文由 content 接口完整返回，不受 4 KiB 预览限制。
        setContext('requirement', { status: value.requirement ? 'loaded' : 'idle' });
        return;
      }

      if (value.artifactSetId || value.taskId) {
        await loadArtifactSetContext(value, isAlive);
        if (!alive) return;
        // 仓库与 PRD 都是补充证据；并行读取，失败只影响各自上下文卡片。
        await Promise.all([
          loadRepositoryContext(value, isAlive),
          loadRequirementContext(value, isAlive),
        ]);
        return;
      }

      setContext('artifactSet', { status: 'empty' });
      setContext('requirement', { status: value.requirement ? 'loaded' : 'empty' });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId]);

  const revision = useMemo<RevisionView | null>(() => {
    if (!document || !review?.documentRevisionId) return null;
    return document.revisions.find((item) => item.id === review.documentRevisionId) ?? null;
  }, [document, review]);

  const diffStats = useMemo(() => {
    if (!content || publishedText === null) return null;
    try {
      return diffSummary(diffLines(publishedText, content.text));
    } catch {
      // 超长文档的差异由 DiffViewer 显示可见降级原因；摘要处不能伪造统计。
      return null;
    }
  }, [content, publishedText]);

  const subjectLabel =
    revision?.title ||
    (taskStepKey ? (STEP_LABELS[taskStepKey] ?? taskStepKey) : '') ||
    (review?.kind ? labelFor(REVIEW_KIND_LABELS, review.kind) : '评审对象');
  const requirementLabel = requirement ? `${requirement.code} · ${requirement.title}` : '';

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
  const isTaskEvidence = Boolean(review.artifactSetId || review.taskId);
  const contextRequirementLabel = requirement
    ? `${requirement.code} · ${requirement.title}`
    : review.requirement
      ? `${review.requirement.code} · ${review.requirement.title}`
      : '';

  // ---- 证据完整性 ----
  const truncatedArtifacts = (artifactSet?.artifacts ?? []).filter(
    (artifact) => artifact.contentPreview?.truncated,
  );
  const criticalContextStates = CRITICAL_CONTEXTS.map((kind) => ({
    kind,
    status: contexts[kind].status,
  }));
  const criticalLoading = criticalContextStates.some((item) => item.status === 'loading');
  const criticalFailures = criticalContextStates.filter(
    (item) => item.status === 'error' || item.status === 'forbidden',
  );
  const evidenceIssues: string[] = [];
  if (truncatedArtifacts.length > 0)
    evidenceIssues.push(`${truncatedArtifacts.length} 条工件正文只有截断预览`);
  for (const failure of criticalFailures) {
    evidenceIssues.push(
      `${CONTEXT_KIND_LABELS[failure.kind]}${failure.status === 'forbidden' ? '无权查看' : '读取失败'}`,
    );
  }
  const evidenceIncomplete = evidenceIssues.length > 0;
  const hasDocumentEvidence = Boolean(content);
  const hasArtifactEvidence = Boolean(artifactSet && artifactSet.artifacts.length > 0);
  const evidenceAbsent =
    !hasDocumentEvidence && !hasArtifactEvidence && !criticalLoading && !evidenceIncomplete;
  const requiresEvidenceAck = reviewRequiresCompleteEvidence(review.kind) && evidenceIncomplete;

  // ---- 确认摘要数据（全部来自真实已加载数据）----
  const allChecks = (artifactSet?.artifacts ?? []).flatMap((artifact) => artifact.checks);
  const checksSummary =
    allChecks.length > 0
      ? {
          passed: allChecks.filter((check) => check.passed).length,
          total: allChecks.length,
          failed: allChecks.filter((check) => !check.passed).length,
        }
      : undefined;
  const codeRefs = artifactSet
    ? artifactSet.artifacts.filter((artifact) => artifact.storage === 'GIT_REF').length
    : undefined;
  const summaryArtifacts: DecisionArtifactSummary[] = [];
  if (revision) {
    summaryArtifacts.push({
      label: `文档修订 v${revision.seq}`,
      detail: `${revision.title} · ${formatBytes(revision.byteLength)}`,
    });
  }
  if (revision && publishedText !== null) {
    summaryArtifacts.push({
      label: '与已发布版本的差异',
      detail: diffStats
        ? `+${diffStats.added} / -${diffStats.removed}`
        : '差异未计算（文档过长或正在读取）',
    });
  }
  const acceptanceCount = revision?.acceptance?.length ?? acceptance.length;
  if (acceptanceCount > 0) {
    summaryArtifacts.push({ label: '验收标准', detail: `${acceptanceCount} 项` });
  }
  for (const artifact of artifactSet?.artifacts ?? []) {
    summaryArtifacts.push(artifactSummaryOf(artifact));
  }
  if (summaryArtifacts.length === 0 && content) {
    summaryArtifacts.push({ label: '文档正文', detail: `${content.text.length} 字符` });
  }

  function decisionSummaryFor(value: {
    slot: ReviewSlot;
    decision: DecisionValue;
    comment: string;
  }): DecisionSummaryData {
    const roleSuffix = review!.role?.title
      ? ` · ${review!.role.title}`
      : value.slot.requiredRoleId
        ? ' · 按角色指派'
        : ' · 按个人指派';
    return {
      decision: value.decision,
      subject: contextRequirementLabel || revision?.title || subjectLabel,
      reviewKindLabel: labelFor(REVIEW_KIND_LABELS, review!.kind),
      slotLabel: `${value.slot.slotKey}${roleSuffix}`,
      version: review!.version,
      artifacts: summaryArtifacts,
      checks: checksSummary,
      codeRefs,
      comment: value.comment,
      impact: decisionImpact(value.decision, review!.kind),
      evidenceNote: evidenceIncomplete
        ? `证据不完整：${evidenceIssues.join('；')}。${
            value.decision === 'APPROVE'
              ? evidenceAcknowledged
                ? '你已确认在不完整证据下继续批准。'
                : '批准前必须勾选“我已知晓证据不完整，仍继续批准”。'
              : '请在确认前自行判断证据是否足以支持该决定。'
          }`
        : undefined,
    };
  }

  function repositoryOf(artifact: ArtifactSetView['artifacts'][number]) {
    return repositories.find((repo) => repo.id === artifact.projectRepositoryId) ?? null;
  }

  // ---- 上下文卡片渲染助手：加载 / 失败 / 无权限 / 空态互斥 ----
  function contextLoading(kind: ContextKind, label: string) {
    if (contexts[kind].status !== 'loading') return null;
    return <ContextLoading label={label} />;
  }

  function contextFailure(
    kind: ContextKind,
    title: string,
    description: string,
    retryLabel: string,
    onRetry?: () => void,
  ) {
    const state = contexts[kind];
    if (state.status !== 'error' && state.status !== 'forbidden') return null;
    return (
      <ContextFailureCard
        title={title}
        description={description}
        failure={state.error}
        status={state.status}
        retryLabel={retryLabel}
        onRetry={onRetry}
      />
    );
  }

  function contextEmpty(kind: ContextKind, title: string, description: string, hint?: string) {
    if (contexts[kind].status !== 'empty') return null;
    return <ContextEmptyCard title={title} description={description} hint={hint} />;
  }

  function retryArtifactSet() {
    if (review) void loadArtifactSetContext(review);
  }

  function retryRepositories() {
    if (review) void loadRepositoryContext(review);
  }

  function retryRequirement() {
    if (review) void loadRequirementContext(review);
  }

  function retryPrd() {
    if (review) void loadPrdContext(review, requirement?.id ?? review.requirement?.id ?? null);
  }

  const nextStepBlockedByComment =
    (decision === 'CHANGES_REQUESTED' || decision === 'REJECT') && !comment.trim();
  const nextStepBlockedByEvidence =
    decision === 'APPROVE' && requiresEvidenceAck && !evidenceAcknowledged;
  const nextStepBlockedByEvidenceLoading =
    decision === 'APPROVE' && reviewRequiresCompleteEvidence(review.kind) && criticalLoading;

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
          <div
            className={`detail-card review-evidence-status${evidenceIncomplete ? ' is-warning' : ''}`}
            role="status"
          >
            <div className="detail-card-head">
              <h3>证据完整性</h3>
              <span
                className={
                  criticalLoading || evidenceAbsent
                    ? 'task-row-meta'
                    : evidenceIncomplete
                      ? 'cell-danger'
                      : 'task-signed'
                }
              >
                {criticalLoading
                  ? '读取中'
                  : evidenceIncomplete
                    ? '不完整'
                    : evidenceAbsent
                      ? '无证据'
                      : '完整'}
              </span>
            </div>
            {criticalLoading ? (
              <p className="task-row-meta">
                正在读取交付物与需求上下文，读取完成后才能判断证据是否完整。
              </p>
            ) : evidenceIncomplete ? (
              <>
                <p className="review-warning">证据不完整：{evidenceIssues.join('；')}。</p>
                {truncatedArtifacts.length > 0 && (
                  <p className="task-row-meta">
                    服务端只提供 4 KiB
                    以内的正文预览，没有完整正文读取或下载接口；请在确认前对照原始工件核对全文。
                  </p>
                )}
                {criticalFailures.length > 0 && (
                  <p className="task-row-meta">
                    建议先重试读取失败的关键上下文；在无法确认证据完整性前，建议暂缓作出批准决定。
                  </p>
                )}
                {requiresEvidenceAck && (
                  <p className="task-row-meta">批准前必须勾选“我已知晓证据不完整，仍继续批准”。</p>
                )}
              </>
            ) : evidenceAbsent ? (
              <p className="task-row-meta">
                该评审没有附带正文或工件证据；决定仅依据评审对象本身，请自行确认依据是否充分。
              </p>
            ) : (
              <p className="task-row-meta">
                证据完整：正文/工件预览未被截断，关键上下文均已成功读取。
              </p>
            )}
          </div>

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
                <div style={{ marginTop: 14 }}>
                  <h3 style={{ marginBottom: 8 }}>与已发布版本的差异</h3>
                  <DiffViewer
                    oldText={publishedText}
                    newText={content.text}
                    baseLabel="已发布版本"
                    currentLabel={`修订 v${revision.seq}`}
                  />
                </div>
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

          {(isTaskEvidence || (!revision && !review.documentRevisionId)) && (
            <>
              {contextLoading('artifactSet', '交付物上下文')}
              {contextFailure(
                'artifactSet',
                '无法读取交付物上下文',
                '交付物证据没有读取成功，无法确认工件正文、校验结果与代码引用；这是读取失败，不是没有交付物。',
                '重试读取交付物',
                retryArtifactSet,
              )}
              {contextEmpty(
                'artifactSet',
                '该评审没有关联交付物',
                '评审请求没有关联工件集，因此没有工件正文、校验或代码引用证据。',
                '决定将只依据评审对象本身；如果预期应有交付物，请让交付方重新提交。',
              )}
              {contexts.artifactSet.status === 'loaded' && artifactSet && (
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
                      const preview = artifact.contentPreview ?? null;
                      const truncationReasonId = `artifact-truncation-${artifact.id}`;
                      return (
                        <div className="task-row review-artifact-row" key={artifact.id}>
                          <div className="task-row-main">
                            <div className="task-row-top">
                              <strong>{labelFor(ARTIFACT_KIND_LABELS, artifact.kind)}</strong>
                              <span className="status-tag">
                                {labelFor(ARTIFACT_STORAGE_LABELS, artifact.storage)}
                              </span>
                              <span className="status-tag">{artifact.mediaType}</span>
                              <span className="task-row-meta">
                                {formatBytes(artifact.byteLength)}
                              </span>
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
                            {preview && (
                              <>
                                <pre className="paper-content artifact-preview">{preview.text}</pre>
                                <div className="task-row-meta">
                                  预览 {preview.text.length} 字符 · 工件{' '}
                                  {formatBytes(artifact.byteLength)}
                                  {preview.truncated ? ' · 正文预览已截断' : ' · 预览未截断'}
                                </div>
                                {preview.truncated && (
                                  <div
                                    className="review-warning"
                                    id={truncationReasonId}
                                    title="正文预览已截断：服务端只提供预览，没有完整正文读取或下载接口"
                                  >
                                    <p>
                                      <strong>正文预览已截断。</strong>
                                      当前服务只提供预览，未提供完整正文读取或下载接口，因此这里无法展示完整正文。
                                    </p>
                                    {commitUrl ? (
                                      <p>
                                        <a href={commitUrl} target="_blank" rel="noreferrer">
                                          打开原工件
                                        </a>
                                        （GitHub 提交{' '}
                                        {artifact.commitSha ? artifact.commitSha.slice(0, 8) : ''}
                                        ）可在仓库中查看完整内容。
                                      </p>
                                    ) : (
                                      <p>
                                        无可用原工件链接：该工件没有关联可访问的 GitHub
                                        仓库或提交记录，无法跳转查看完整内容。
                                      </p>
                                    )}
                                    <p>
                                      <button
                                        type="button"
                                        className="ghost"
                                        disabled
                                        title="不可用：服务端没有提供完整正文读取或下载接口。"
                                        aria-describedby={`${truncationReasonId}-disabled`}
                                      >
                                        读取完整正文
                                      </button>
                                      <button
                                        type="button"
                                        className="ghost"
                                        disabled
                                        title="不可用：服务端没有提供证据下载接口。"
                                        aria-describedby={`${truncationReasonId}-disabled`}
                                      >
                                        下载证据
                                      </button>
                                      <span
                                        id={`${truncationReasonId}-disabled`}
                                        className="task-row-meta"
                                      >
                                        不可用：服务端没有提供完整正文读取或下载接口。
                                      </span>
                                    </p>
                                  </div>
                                )}
                              </>
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
            </>
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

          {(isTaskEvidence ||
            Boolean(review.requirement) ||
            Boolean(requirement) ||
            contexts.requirement.status === 'empty') && (
            <>
              {contextLoading('requirement', '需求上下文')}
              {contextFailure(
                'requirement',
                '无法读取需求上下文',
                '需求信息没有读取成功，评审对象与验收范围可能不完整；这是读取失败，不是没有关联需求。',
                '重试读取需求',
                retryRequirement,
              )}
              {contextEmpty(
                'requirement',
                '暂无关联需求',
                '这条评审没有关联需求，因此无法展示需求编号、标题与阶段。',
                '你可以直接依据评审对象与证据作出决定。',
              )}
              {contexts.requirement.status === 'loaded' && requirement && (
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
              {contexts.requirement.status === 'loaded' && !requirement && review.requirement && (
                <div className="detail-card review-context-card">
                  <div className="detail-card-head">
                    <h3>需求上下文</h3>
                    <button
                      className="ghost"
                      onClick={() => navigate(`/requirements/${review.requirement!.code}`)}
                    >
                      打开需求
                    </button>
                  </div>
                  <div className="review-context-title">
                    <strong>
                      {review.requirement.code} · {review.requirement.title}
                    </strong>
                  </div>
                </div>
              )}
            </>
          )}

          {isTaskEvidence && (
            <>
              {contextLoading('prd', 'PRD 上下文')}
              {contextFailure(
                'prd',
                '无法读取 PRD 上下文',
                'PRD 验收标准没有读取成功，批准前请确认验收范围；这是读取失败，不是没有绑定 PRD。',
                '重试读取 PRD',
                retryPrd,
              )}
              {contextEmpty(
                'prd',
                '该需求没有绑定 PRD 文档',
                '没有找到与该需求关联的 PRD，因此没有可对照的已发布验收标准。',
                '不影响作出决定，但请自行确认证据足以覆盖验收范围。',
              )}
              {contexts.prd.status === 'loaded' && acceptance.length > 0 && (
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
              {contexts.prd.status === 'loaded' && acceptance.length === 0 && (
                <ContextEmptyCard
                  title="PRD 没有可对照的验收标准"
                  description="该需求已绑定 PRD，但已发布版本没有提取到验收标准。"
                  hint="不影响作出决定，请自行确认验收范围与证据是否充分。"
                />
              )}
            </>
          )}

          {isTaskEvidence && (
            <>
              {contextLoading('repositories', '仓库上下文')}
              {contextFailure(
                'repositories',
                '无法读取仓库上下文',
                '无法确认代码引用对应的仓库与提交链接；这是读取失败，不是没有仓库。',
                '重试读取仓库',
                retryRepositories,
              )}
              {contextEmpty(
                'repositories',
                '暂无已登记的代码仓库',
                '项目还没有登记代码仓库，因此工件没有可跳转的 GitHub 原工件链接。',
                '如果代码交付应关联仓库，请项目管理员先登记仓库。',
              )}
              {contexts.repositories.status === 'loaded' && (
                <div className="detail-card">
                  <div className="detail-card-head">
                    <h3>
                      仓库上下文<small>{repositories.length}</small>
                    </h3>
                  </div>
                  <ul className="detail-list">
                    {repositories.map((repository) => (
                      <li key={repository.id}>
                        {repository.owner}/{repository.name}{' '}
                        <span className="task-row-meta">
                          （{repository.adapter} · 默认分支 {repository.defaultBranch ?? '未设置'}）
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
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
                            setEvidenceAcknowledged(false);
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
              {requiresEvidenceAck && (
                <div className="review-evidence-ack">
                  <p className="review-warning">
                    证据不完整：{evidenceIssues.join('；')}。批准前必须明确确认你已知晓。
                  </p>
                  <label className="review-evidence-ack-label">
                    <input
                      type="checkbox"
                      checked={evidenceAcknowledged}
                      onChange={(event) => setEvidenceAcknowledged(event.target.checked)}
                    />
                    我已知晓证据不完整，仍继续批准
                  </label>
                </div>
              )}
              <div className="next-step-actions">
                <button
                  className="primary"
                  disabled={
                    nextStepBlockedByComment ||
                    nextStepBlockedByEvidence ||
                    nextStepBlockedByEvidenceLoading
                  }
                  aria-describedby={
                    nextStepBlockedByComment ||
                    nextStepBlockedByEvidence ||
                    nextStepBlockedByEvidenceLoading
                      ? 'review-next-step-blocked'
                      : undefined
                  }
                  onClick={() => setPending({ slot: activeSlot, decision, comment })}
                >
                  下一步：预览并验证
                  <ArrowRight size={14} />
                </button>
              </div>
              {(nextStepBlockedByComment ||
                nextStepBlockedByEvidence ||
                nextStepBlockedByEvidenceLoading) && (
                <p className="task-row-meta" id="review-next-step-blocked">
                  {nextStepBlockedByEvidenceLoading
                    ? '正在读取证据完整性，请稍候再进入确认。'
                    : nextStepBlockedByEvidence
                      ? '证据不完整：请先勾选“我已知晓证据不完整，仍继续批准”。'
                      : '要求修改或驳回时必须填写说明。'}
                </p>
              )}
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
        summary={pending ? decisionSummaryFor(pending) : undefined}
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
