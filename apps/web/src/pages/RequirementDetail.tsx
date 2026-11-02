import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Copy, Link2, MoreHorizontal, Terminal } from 'lucide-react';
import { formatApiError } from '../api/client';
import {
  documentApi,
  requirementApi,
  type DocumentDetail,
  type RequirementArtifactDetail,
  type RequirementDetail as RequirementDetailView,
  type RequirementReviewDetail,
  type RequirementTaskDetail,
} from '../api/resources';
import { ConfirmDialog, Modal } from '../components/Modal';
import { useProjectContext } from '../hooks/useProjectContext';
import {
  ARTIFACT_KIND_LABELS,
  DECISION_LABELS,
  EXECUTION_STATUS_LABELS,
  PHASE_LABELS,
  REVIEW_KIND_LABELS,
  REVIEW_STATUS_LABELS,
  REVISION_STATE_LABELS,
  WORK_STATUS_LABELS,
  labelFor,
} from '../lib/labels';

type DetailTab = 'overview' | 'tasks' | 'artifacts' | 'changes' | 'prd' | 'reviews' | 'trace';

const DETAIL_TABS: Array<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'artifacts', label: '交付物' },
  { key: 'tasks', label: '任务' },
  { key: 'changes', label: '变更' },
  { key: 'prd', label: 'PRD' },
  { key: 'reviews', label: '评审' },
  { key: 'trace', label: '追溯' },
];

function isDetailTab(value: string | null): value is DetailTab {
  return value !== null && DETAIL_TABS.some((item) => item.key === value);
}

type GateState = 'done' | 'current' | 'todo' | 'na';

type GateNode = {
  key: string;
  label: string;
  roleLabel: string;
  roleKeys: string[];
  state: GateState;
  stateLabel: string;
};

function dateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN');
}

function shortDigest(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function scrollToRole(roleKeys: string[]): void {
  const first = roleKeys[0];
  if (!first) return;
  document
    .getElementById(`task-group-${first}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildGates(tasks: RequirementTaskDetail[]): GateNode[] {
  const byRole = (keys: string[]) => tasks.filter((task) => keys.includes(task.role.key));
  const allDone = (list: RequirementTaskDetail[]) =>
    list.length > 0 && list.every((task) => task.executionStatus === 'DONE');
  const anyStarted = (list: RequirementTaskDetail[]) =>
    list.some((task) => task.executionStatus !== 'OPEN');
  const blocked = (list: RequirementTaskDetail[]) =>
    list.some((task) => task.workStatus === 'BLOCKED');

  const product = byRole(['product']);
  const design = byRole(['ui']);
  const dev = byRole(['frontend', 'backend']);
  const qa = byRole(['qa']);
  const ops = byRole(['ops']);

  const raw: Array<Omit<GateNode, 'state' | 'stateLabel'> & { done: boolean }> = [
    {
      key: 'draft',
      label: '草稿',
      roleLabel: '—',
      roleKeys: [],
      done: true,
    },
    {
      key: 'prd',
      label: 'PRD 就绪',
      roleLabel: '产品',
      roleKeys: ['product'],
      done: allDone(product),
    },
    {
      key: 'design',
      label: '设计就绪',
      roleLabel: '设计',
      roleKeys: ['ui'],
      done: allDone(design),
    },
    {
      key: 'dev',
      label: '开发中',
      roleLabel: '前端 / 后端',
      roleKeys: ['frontend', 'backend'],
      done: anyStarted(dev),
    },
    {
      key: 'code',
      label: '代码已关联',
      roleLabel: '前端 / 后端',
      roleKeys: ['frontend', 'backend'],
      done: allDone(dev),
    },
    {
      key: 'tested',
      label: '已测试',
      roleLabel: '测试',
      roleKeys: ['qa'],
      done: allDone(qa),
    },
    {
      key: 'released',
      label: '已发布',
      roleLabel: '运维',
      roleKeys: ['ops'],
      done: allDone(ops),
    },
  ];

  let currentAssigned = false;
  return raw.map((gate) => {
    const applicable =
      gate.key === 'draft' || gate.roleKeys.length === 0 || byRole(gate.roleKeys).length > 0;
    if (!applicable) return { ...gate, state: 'na', stateLabel: '不适用' };
    if (gate.done) return { ...gate, state: 'done', stateLabel: '已满足' };
    if (!currentAssigned) {
      currentAssigned = true;
      const list = byRole(gate.roleKeys);
      return {
        ...gate,
        state: 'current',
        stateLabel: blocked(list) ? '阻塞' : anyStarted(list) ? '进行中' : '未开始',
      };
    }
    return { ...gate, state: 'todo', stateLabel: '未开始' };
  });
}

/**
 * 需求详情：把散落在任务、工件、评审、变更里的证据收进一个页面。
 * 页面本身只读；签字仍进入评审页，由服务端票据与版本校验。
 */
export function RequirementDetail() {
  const navigate = useNavigate();
  const params = useParams<{ requirementId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projects, projectId: selectedProjectId, setProjectId } = useProjectContext();
  const routeKey = params.requirementId ?? '';
  const routePrefix = routeKey.includes('-') ? routeKey.split('-')[0] : '';
  const routeProject = projects.find((project) => project.key === routePrefix);
  const effectiveProjectId = routeProject?.id ?? selectedProjectId;

  const [detail, setDetail] = useState<RequirementDetailView | null>(null);
  const [prdDocs, setPrdDocs] = useState<DocumentDetail[]>([]);
  const [tab, setTab] = useState<DetailTab>(
    isDetailTab(searchParams.get('tab')) ? (searchParams.get('tab') as DetailTab) : 'overview',
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [editDiscardOpen, setEditDiscardOpen] = useState(false);
  const [traceKind, setTraceKind] = useState('all');

  useEffect(() => {
    if (routeProject && routeProject.id !== selectedProjectId) setProjectId(routeProject.id);
  }, [routeProject, selectedProjectId, setProjectId]);

  useEffect(() => {
    if (!effectiveProjectId || !routeKey) {
      setDetail(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    requirementApi
      .detail(effectiveProjectId, routeKey)
      .then((value) => {
        if (alive) setDetail(value);
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setDetail(null);
        setError(formatApiError(caught));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [effectiveProjectId, routeKey]);

  useEffect(() => {
    if (!detail) {
      setPrdDocs([]);
      return;
    }
    let alive = true;
    documentApi
      .list(detail.requirement.projectId, 'PRD')
      .then((page) => {
        if (!alive) return;
        setPrdDocs(
          page.items.filter((item) => item.document.requirementId === detail.requirement.id),
        );
      })
      .catch(() => {
        if (alive) setPrdDocs([]);
      });
    return () => {
      alive = false;
    };
  }, [detail?.requirement.id, detail?.requirement.projectId]);

  const taskGroups = useMemo(() => {
    const map = new Map<string, { key: string; title: string; tasks: RequirementTaskDetail[] }>();
    for (const task of detail?.tasks ?? []) {
      const group = map.get(task.role.key) ?? {
        key: task.role.key,
        title: task.role.title,
        tasks: [],
      };
      group.tasks.push(task);
      map.set(task.role.key, group);
    }
    return [...map.values()];
  }, [detail]);

  const artifactGroups = useMemo(() => {
    const map = new Map<string, RequirementArtifactDetail[]>();
    for (const artifact of detail?.artifacts ?? []) {
      const group = map.get(artifact.kind) ?? [];
      group.push(artifact);
      map.set(artifact.kind, group);
    }
    return [...map.entries()].map(([kind, items]) => ({ kind, items }));
  }, [detail]);

  const missingArtifactKinds = useMemo(() => {
    const expected = ['PRD', 'DESIGN', 'IMPL', 'CASES', 'RELEASE'];
    const present = new Set((detail?.artifacts ?? []).map((artifact) => artifact.kind));
    return expected.filter((kind) => !present.has(kind));
  }, [detail]);

  const gates = useMemo(() => buildGates(detail?.tasks ?? []), [detail]);

  const trace = useMemo(() => {
    if (!detail) return [];
    const items: Array<{
      id: string;
      kind: string;
      title: string;
      at: string;
      actor?: string;
      detail?: string;
    }> = [];
    for (const artifact of detail.artifacts) {
      items.push({
        id: `artifact-${artifact.id}`,
        kind: '交付物',
        title: `${labelFor(ARTIFACT_KIND_LABELS, artifact.kind)} · ${artifact.repoPath ?? shortDigest(artifact.sha256)}`,
        at: artifact.createdAt,
        detail: artifact.commitSha ? `commit ${artifact.commitSha.slice(0, 8)}` : undefined,
      });
    }
    for (const review of detail.reviews) {
      items.push({
        id: `review-${review.id}`,
        kind: '评审',
        title: `${labelFor(REVIEW_KIND_LABELS, review.kind)} · ${review.subjectLabel}`,
        at: review.createdAt,
      });
      for (const decision of review.decisions) {
        items.push({
          id: `decision-${decision.id}`,
          kind: '决定',
          title: `${labelFor(DECISION_LABELS, decision.decision)} · ${review.subjectLabel}`,
          at: decision.createdAt,
          actor: decision.actor?.email,
        });
      }
    }
    for (const change of detail.changes) {
      items.push({
        id: `change-${change.id}`,
        kind: '变更',
        title: change.changedFields.join(' / ') || '未标注字段',
        at: change.createdAt,
      });
    }
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [detail]);

  const visibleTrace =
    traceKind === 'all' ? trace : trace.filter((item) => item.kind === traceKind);

  const openReviews = detail?.reviews.filter((review) => review.status === 'OPEN') ?? [];
  const readyTasks = detail?.tasks.filter((task) => task.executionStatus === 'OPEN') ?? [];

  const next = useMemo(() => {
    if (!detail) return null;
    if (detail.requirement.workStatus === 'CANCELLED')
      return {
        title: '需求已取消',
        text: '只保留历史证据，不再提供签字或编辑入口。',
        action: null,
      };
    if (detail.tasks.length === 0)
      return {
        title: '等待初始化流程',
        text: '项目管理员需要为这条需求创建流程实例，之后任务才会出现。',
        action: null,
      };
    if (openReviews.length > 0)
      return {
        title: `有 ${openReviews.length} 条评审待签字`,
        text: '签字前请确认正文、验收标准、工件与上一次决定。',
        action: { label: '去签字', run: () => navigate(`/reviews/${openReviews[0].id}`) },
      };
    if (readyTasks.length > 0)
      return {
        title: `有 ${readyTasks.length} 个任务可开工`,
        text: '任务由本地 Agent 通过 CLI 认领与交付；这里只读。',
        action: { label: '查看看板', run: () => navigate('/board') },
      };
    return {
      title: '当前没有待处理动作',
      text: '等待 Agent 交付或下一次评审触发。',
      action: null,
    };
  }, [detail, openReviews, readyTasks, navigate]);

  async function copyText(text: string, label: string) {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setNotice(`已复制${label}。`);
    } catch {
      setNotice(`复制失败，请手动选择${label}。`);
    }
  }

  function changeTab(next: DetailTab) {
    setTab(next);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', next);
    setSearchParams(nextParams, { replace: true });
  }

  function openEdit() {
    if (!detail) return;
    setEditTitle(detail.requirement.title);
    setEditDescription(detail.requirement.description ?? '');
    setEditError('');
    setEditOpen(true);
  }

  function requestCloseEdit() {
    if (!detail || editBusy) return;
    const dirty =
      editTitle !== detail.requirement.title ||
      editDescription !== (detail.requirement.description ?? '');
    if (dirty) setEditDiscardOpen(true);
    else setEditOpen(false);
  }

  async function saveEdit() {
    if (!detail || !effectiveProjectId) return;
    if (!editTitle.trim()) {
      setEditError('标题不能为空。');
      return;
    }
    setEditBusy(true);
    setEditError('');
    try {
      const updated = await requirementApi.update(effectiveProjectId, detail.requirement.id, {
        expectedVersion: detail.requirement.version,
        title: editTitle.trim(),
        description: editDescription.trim(),
      });
      setDetail({ ...detail, requirement: updated });
      setEditOpen(false);
    } catch (caught) {
      setEditError(formatApiError(caught));
    } finally {
      setEditBusy(false);
    }
  }

  if (loading && !detail) {
    return (
      <section>
        <div className="req-head req-head-skeleton">
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
        </div>
        <div className="gate-bar gate-skeleton" />
      </section>
    );
  }

  if (error) {
    return (
      <section>
        <header className="page-head">
          <div>
            <h2>需求详情</h2>
            <p className="page-sub">无法打开这条需求。</p>
          </div>
          <div className="page-actions">
            <button className="ghost" onClick={() => navigate('/requirements')}>
              <ArrowLeft size={14} />
              返回需求
            </button>
          </div>
        </header>
        <p className="error" role="alert">
          {error}
        </p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section>
        <p className="page-card muted">先选择项目，或从需求列表进入一条需求。</p>
      </section>
    );
  }

  const { requirement } = detail;
  const projectName = projects.find((project) => project.id === requirement.projectId)?.name;
  const readOnly = requirement.workStatus === 'CANCELLED';

  return (
    <section>
      <header className="req-head">
        <div className="req-head-main">
          <div className="req-head-title">
            <span className="req-code">
              {requirement.code}
              <button
                className="icon-btn"
                aria-label="复制需求编号"
                onClick={() => void copyText(requirement.code, '需求编号')}
              >
                <Copy size={13} />
              </button>
            </span>
            <h2>{requirement.title}</h2>
            <span className="status-tag">{labelFor(PHASE_LABELS, requirement.phase)}</span>
            <span className="status-tag">v{requirement.version}</span>
            {readOnly && <span className="status-tag">已取消</span>}
          </div>
          <div className="req-head-meta">
            {projectName ? `${projectName} · ` : ''}创建于 {dateTime(requirement.createdAt)} · 更新于{' '}
            {dateTime(requirement.updatedAt)}
          </div>
        </div>
        <div className="page-actions">
          {!readOnly && (
            <button className="ghost" onClick={openEdit}>
              编辑需求
            </button>
          )}
          <div className="page-more">
            <button
              className="ghost"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((value) => !value)}
            >
              <MoreHorizontal size={15} />
              更多
            </button>
            {moreOpen && (
              <div className="page-more-panel" role="menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    void copyText(window.location.href, '链接');
                    setMoreOpen(false);
                  }}
                >
                  <Link2 size={14} />
                  复制链接
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    void copyText(`workmesh context ${requirement.code}`, 'CLI 命令');
                    setMoreOpen(false);
                  }}
                >
                  <Terminal size={14} />
                  复制 CLI 命令
                </button>
              </div>
            )}
          </div>
          <button className="ghost" onClick={() => navigate('/requirements')}>
            <ArrowLeft size={14} />
            返回需求
          </button>
        </div>
      </header>

      {readOnly && (
        <div className="readonly-banner" role="status">
          这条需求已取消，页面只读；签字与编辑入口已隐藏。
        </div>
      )}
      {notice && <p className="kb-notice">{notice}</p>}

      <div className="gate-bar">
        {gates.map((gate) => (
          <button
            type="button"
            className={`gate-step is-${gate.state}`}
            key={gate.key}
            onClick={() => {
              changeTab('tasks');
              window.setTimeout(() => scrollToRole(gate.roleKeys), 0);
            }}
          >
            <span className="gate-dot" />
            <span className="gate-label">{gate.label}</span>
            <span className="gate-roles">{gate.roleLabel}</span>
            <span className="gate-state">{gate.stateLabel}</span>
          </button>
        ))}
      </div>

      <div className="req-tabs" role="tablist" aria-label="需求详情">
        {DETAIL_TABS.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            className={`req-tab${tab === item.key ? ' is-active' : ''}`}
            onClick={() => changeTab(item.key)}
          >
            {item.label}
            {item.key !== 'overview' && (
              <span>
                {item.key === 'tasks'
                  ? detail.counts.tasks
                  : item.key === 'artifacts'
                    ? detail.counts.artifacts
                    : item.key === 'changes'
                      ? detail.counts.changes
                      : item.key === 'prd'
                        ? prdDocs.length
                        : item.key === 'reviews'
                          ? detail.counts.reviews
                          : trace.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="req-layout">
        <div className="req-main">
          {tab === 'overview' && (
            <div className="detail-card">
              <h3>需求描述</h3>
              <p className="detail-text">{requirement.description || '暂无描述。'}</p>
              {detail.changes.length > 0 && (
                <div className="overview-recent">
                  <div className="detail-card-head">
                    <h3>最近变更</h3>
                    <button className="ghost" onClick={() => changeTab('changes')}>
                      查看全部
                    </button>
                  </div>
                  {detail.changes.slice(0, 3).map((change) => (
                    <div className="task-row" key={change.id}>
                      <div className="task-row-main">
                        <div className="task-row-top">
                          <span className="status-tag">{change.sourceKind}</span>
                          <strong>
                            {change.changedFields.join(' / ') || '未标注字段'}
                          </strong>
                        </div>
                        <div className="task-row-meta">{dateTime(change.createdAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'tasks' && (
            <div className="detail-card">
              <div className="detail-card-head">
                <h3>
                  任务<small>{detail.counts.tasks}</small>
                </h3>
              </div>
              {taskGroups.length === 0 ? (
                <p className="detail-empty">还没有任务；等待管理员初始化流程实例。</p>
              ) : (
                <div className="task-groups">
                  {taskGroups.map((group) => (
                    <div className="task-group" id={`task-group-${group.key}`} key={group.key}>
                      <div className="task-group-head">
                        <strong>{group.title}</strong>
                        <span className="task-row-meta">{group.tasks.length} 个任务</span>
                      </div>
                      {group.tasks.map((task) => (
                        <div
                          className={`task-row${task.review?.status === 'OPEN' ? ' is-pending' : ''}`}
                          key={task.id}
                        >
                          <div className="task-row-main">
                            <div className="task-row-top">
                              <strong>{task.stepKey}</strong>
                              <span className="status-tag">
                                {labelFor(EXECUTION_STATUS_LABELS, task.executionStatus)}
                              </span>
                              {task.workStatus !== 'ACTIVE' && (
                                <span className="status-tag">
                                  {labelFor(WORK_STATUS_LABELS, task.workStatus)}
                                </span>
                              )}
                              {task.review && (
                                <span className="status-tag">
                                  {labelFor(REVIEW_STATUS_LABELS, task.review.status)}
                                </span>
                              )}
                            </div>
                            <div className="task-row-meta">
                              责任人 {task.responsibleUser.email} · 工件 {task.artifactCount} 件 · v
                              {task.version}
                            </div>
                          </div>
                          <div className="task-row-actions">
                            {!readOnly && task.review?.status === 'OPEN' ? (
                              <button
                                className="primary"
                                onClick={() => navigate(`/reviews/${task.review!.id}`)}
                              >
                                去签字
                                <ArrowRight size={14} />
                              </button>
                            ) : task.review ? (
                              <span className="task-signed">
                                {labelFor(REVIEW_STATUS_LABELS, task.review.status)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'artifacts' && (
            <div className="detail-card">
              <div className="detail-card-head">
                <h3>
                  交付物<small>{detail.counts.artifacts}</small>
                </h3>
              </div>
              {artifactGroups.length === 0 ? (
                <p className="detail-empty">还没有交付物；Agent 交付后会出现在这里。</p>
              ) : (
                <div className="artifact-groups">
                  {artifactGroups.map((group) => (
                    <div className="artifact-group" key={group.kind}>
                      <div className="task-group-head">
                        <strong>{labelFor(ARTIFACT_KIND_LABELS, group.kind)}</strong>
                        <span className="task-row-meta">{group.items.length} 件</span>
                      </div>
                      {group.items.map((artifact) => (
                        <div className="task-row" key={artifact.id}>
                          <div className="task-row-main">
                            <div className="task-row-top">
                              <strong className="cell-mono">{artifact.repoPath ?? artifact.mediaType}</strong>
                              <span className="status-tag">{artifact.mediaType}</span>
                              <span className="task-row-meta">{artifact.byteLength} B</span>
                            </div>
                            <div className="task-row-meta cell-mono" title={artifact.sha256}>
                              sha256 {shortDigest(artifact.sha256)}
                              {artifact.commitSha
                                ? ` · commit ${artifact.commitSha.slice(0, 8)}`
                                : ''}
                            </div>
                            {artifact.summary && (
                              <div className="task-row-meta">{artifact.summary}</div>
                            )}
                          </div>
                          {artifact.repoPath && (
                            <div className="task-row-actions">
                              <button
                                className="ghost"
                                onClick={() => void copyText(artifact.repoPath!, '交付物路径')}
                              >
                                复制路径
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                  {missingArtifactKinds.map((kind) => (
                    <div className="artifact-missing" key={kind}>
                      <strong>{labelFor(ARTIFACT_KIND_LABELS, kind)}</strong>
                      <span>缺失 · 等待对应任务交付</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'reviews' && (
            <div className="detail-card">
              <div className="detail-card-head">
                <h3>
                  评审<small>{detail.counts.reviews}</small>
                </h3>
              </div>
              {detail.reviews.length === 0 ? (
                <p className="detail-empty">还没有评审请求。</p>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>类型</th>
                        <th>对象</th>
                        <th>状态</th>
                        <th>版本</th>
                        <th>决定</th>
                        <th className="col-actions">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.reviews.map((review: RequirementReviewDetail) => (
                        <tr key={review.id}>
                          <td>{labelFor(REVIEW_KIND_LABELS, review.kind)}</td>
                          <td>{review.subjectLabel}</td>
                          <td>
                            <span className="status-tag">
                              {labelFor(REVIEW_STATUS_LABELS, review.status)}
                            </span>
                          </td>
                          <td className="cell-num">v{review.version}</td>
                          <td>
                            {review.decisions.length === 0
                              ? '—'
                              : review.decisions
                                  .map(
                                    (decision) =>
                                      `${labelFor(DECISION_LABELS, decision.decision)}${
                                        decision.actor ? `（${decision.actor.email}）` : ''
                                      }`,
                                  )
                                  .join(' / ')}
                          </td>
                          <td className="col-actions">
                            <button
                              className="ghost"
                              onClick={() => navigate(`/reviews/${review.id}`)}
                            >
                              {review.status === 'OPEN' ? '去签字' : '查看'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'changes' && (
            <div className="detail-card">
              <div className="detail-card-head">
                <h3>
                  变更<small>{detail.counts.changes}</small>
                </h3>
              </div>
              {detail.changes.length === 0 ? (
                <p className="detail-empty">还没有变更事件。</p>
              ) : (
                <div className="task-groups">
                  {detail.changes.map((change) => (
                    <div className="task-row" key={change.id}>
                      <div className="task-row-main">
                        <div className="task-row-top">
                          <strong>{change.sourceKind}</strong>
                          <span className="task-row-meta">{dateTime(change.createdAt)}</span>
                        </div>
                        <div className="task-row-meta">
                          变更字段：{change.changedFields.join(' / ') || '未标注'}
                        </div>
                        <div className="task-row-meta">
                          确认 {change.recipients.filter((item) => item.ackedAt).length}/
                          {change.recipients.length}
                          {change.recipients.some((item) => !item.ackedAt)
                            ? ' · 仍有角色待确认'
                            : ' · 全部已确认'}
                        </div>
                      </div>
                      {change.recipients.some((item) => !item.ackedAt) && (
                        <div className="task-row-actions">
                          <button className="ghost" onClick={() => navigate('/?type=changes')}>
                            去工作台确认
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'prd' && (
            <div className="detail-card">
              <div className="detail-card-head">
                <h3>
                  PRD<small>{prdDocs.length}</small>
                </h3>
              </div>
              {prdDocs.length === 0 ? (
                <p className="detail-empty">该需求还没有绑定 PRD 文档。</p>
              ) : (
                <div className="task-groups">
                  {prdDocs.map((item) => (
                    <div className="task-row" key={item.document.id}>
                      <div className="task-row-main">
                        <div className="task-row-top">
                          <strong>
                            {item.publishedRevision?.title ??
                              item.revisions[0]?.title ??
                              '尚未发布'}
                          </strong>
                          <span className="status-tag">v{item.document.version}</span>
                          <span className="task-row-meta">
                            候选{' '}
                            {
                              item.revisions.filter((revision) => revision.state === 'CANDIDATE')
                                .length
                            }
                          </span>
                        </div>
                        <div className="task-row-meta">
                          修订 {item.revisions.length} 个 · 文档 {shortDigest(item.document.id)}
                        </div>
                        <div className="revision-list">
                          {item.revisions.slice(0, 5).map((revision) => (
                            <div className="revision-row" key={revision.id}>
                              <span className="cell-mono">v{revision.seq}</span>
                              <span>{labelFor(REVISION_STATE_LABELS, revision.state)}</span>
                              <span className="cell-truncate" title={revision.title}>
                                {revision.title}
                              </span>
                              {revision.reviewRequestId && (
                                <button
                                  className="ghost"
                                  onClick={() => navigate(`/reviews/${revision.reviewRequestId}`)}
                                >
                                  评审
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="task-row-actions">
                        <button className="ghost" onClick={() => navigate('/prd')}>
                          打开 PRD
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'trace' && (
            <div className="detail-card">
              <div className="detail-card-head">
                <h3>
                  追溯<small>{visibleTrace.length}</small>
                </h3>
                <select
                  className="select"
                  aria-label="追溯类型筛选"
                  value={traceKind}
                  onChange={(event) => setTraceKind(event.target.value)}
                >
                  <option value="all">全部类型</option>
                  <option value="交付物">交付物</option>
                  <option value="评审">评审</option>
                  <option value="决定">决定</option>
                  <option value="变更">变更</option>
                </select>
              </div>
              {visibleTrace.length === 0 ? (
                <p className="detail-empty">还没有可追溯的事件。</p>
              ) : (
                <div className="task-groups">
                  {visibleTrace.map((item) => (
                    <div className="task-row" key={item.id}>
                      <div className="task-row-main">
                        <div className="task-row-top">
                          <span className="status-tag">{item.kind}</span>
                          <strong>{item.title}</strong>
                        </div>
                        <div className="task-row-meta">
                          {item.detail ? `${item.detail} · ` : ''}
                          {item.actor ? `${item.actor} · ` : ''}
                          {dateTime(item.at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="req-side">
          {next && (
            <div className="detail-card next-step">
              <strong>{next.title}</strong>
              <p>{next.text}</p>
              {next.action && (
                <div className="next-step-actions">
                  <button className="primary" onClick={next.action.run}>
                    {next.action.label}
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="detail-card">
            <h3>门禁清单</h3>
            <ul className="gate-list">
              {gates.map((gate) => (
                <li
                  key={gate.key}
                  className={
                    gate.state === 'done'
                      ? 'is-done'
                      : gate.state === 'current'
                        ? 'is-current'
                        : gate.state === 'na'
                          ? 'is-na'
                          : ''
                  }
                >
                  <span className="gate-list-label">{gate.label}</span>
                  <span className="gate-list-role">{gate.roleLabel}</span>
                  <span className="gate-list-state">{gate.stateLabel}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <Modal
        open={editOpen}
        title="编辑需求"
        description={`${requirement.code} · v${requirement.version}`}
        variant="drawer"
        size="md"
        onClose={requestCloseEdit}
        footer={
          <>
            <button className="ghost" onClick={requestCloseEdit} disabled={editBusy}>
              取消
            </button>
            <button className="primary" onClick={() => void saveEdit()} disabled={editBusy}>
              {editBusy ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>标题</span>
            <input
              aria-label="需求标题编辑"
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
            />
          </div>
          <div className="field">
            <span>描述</span>
            <textarea
              aria-label="需求描述编辑"
              rows={5}
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
            />
          </div>
          <p className="modal-note">
            只编辑标题与描述；优先级、用户故事、验收标准当前数据模型没有，不会伪造字段。
          </p>
          {editError && (
            <p className="modal-error" role="alert">
              {editError}
            </p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={editDiscardOpen}
        title="放弃未保存修改？"
        description="标题或描述已经改动，关闭后不会保存。"
        tone="danger"
        confirmLabel="放弃修改"
        onCancel={() => setEditDiscardOpen(false)}
        onConfirm={() => {
          setEditDiscardOpen(false);
          setEditOpen(false);
        }}
      />
    </section>
  );
}
