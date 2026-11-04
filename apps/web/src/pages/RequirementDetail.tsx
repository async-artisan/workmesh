import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Copy, Link2, MoreHorizontal, Terminal } from 'lucide-react';
import { formatApiError } from '../api/client';
import {
  documentApi,
  projectApi,
  requirementApi,
  workflowApi,
  type DocumentDetail,
  type MemberView,
  type RequirementArtifactDetail,
  type RequirementDetail as RequirementDetailView,
  type RequirementReviewDetail,
  type RequirementTaskDetail,
  type RoleView,
  type WorkflowDefinitionView,
} from '../api/resources';
import { ConfirmDialog, Modal } from '../components/Modal';
import {
  RequirementPipeline,
  type RequirementPipelinePhase,
  type RequirementPipelineTask,
} from '../components/RequirementPipeline';
import { WorkflowInstanceDialog } from '../components/WorkflowInstanceDialog';
import { useProjectContext } from '../hooks/useProjectContext';
import { useAuthStore } from '../store/auth';
import {
  ARTIFACT_KIND_LABELS,
  DECISION_LABELS,
  PHASE_LABELS,
  REVIEW_KIND_LABELS,
  REVIEW_STATUS_LABELS,
  REVISION_STATE_LABELS,
  STEP_LABELS,
  labelFor,
} from '../lib/labels';
import {
  resolveTaskDisplayState,
  type TaskDisplayState,
  type TaskStateSignals,
} from '../lib/taskDisplayState';
import {
  describeWorkflowInitState,
} from '../lib/workflowInitState';
import { stepDependencyMap } from '../lib/workflowInstance';

type DetailTab = 'overview' | 'tasks' | 'artifacts' | 'changes' | 'prd' | 'reviews' | 'trace';

/**
 * 需求详情页签：名称 + 计数，纯导航，不再伪装成步骤条。
 */
const DETAIL_STAGES: Array<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'artifacts', label: '交付物' },
  { key: 'tasks', label: '任务' },
  { key: 'changes', label: '变更' },
  { key: 'prd', label: 'PRD' },
  { key: 'reviews', label: '评审' },
  { key: 'trace', label: '追溯' },
];

function stageCountOf(
  key: DetailTab,
  detail: { counts: { tasks: number; artifacts: number; changes: number; reviews: number } },
  prdCount: number,
  traceCount: number,
): number | null {
  switch (key) {
    case 'overview':
      return null;
    case 'tasks':
      return detail.counts.tasks;
    case 'artifacts':
      return detail.counts.artifacts;
    case 'changes':
      return detail.counts.changes;
    case 'prd':
      return prdCount;
    case 'reviews':
      return detail.counts.reviews;
    case 'trace':
      return traceCount;
  }
}

function isDetailTab(value: string | null): value is DetailTab {
  return value !== null && DETAIL_STAGES.some((item) => item.key === value);
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

function artifactChecks(value: unknown): Array<{
  code: string;
  passed: boolean;
  source: 'AGENT_REPORTED' | 'EXTERNAL_REFERENCE';
  evidence?: { provider: string; url: string };
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record.code !== 'string' || typeof record.passed !== 'boolean') return [];
    const evidence = record.evidence;
    const externalEvidence =
      record.source === 'EXTERNAL_REFERENCE' &&
      evidence &&
      typeof evidence === 'object' &&
      typeof (evidence as Record<string, unknown>).provider === 'string' &&
      typeof (evidence as Record<string, unknown>).url === 'string'
        ? (evidence as { provider: string; url: string })
        : undefined;
    return [
      {
        code: record.code,
        passed: record.passed,
        source: externalEvidence ? 'EXTERNAL_REFERENCE' : 'AGENT_REPORTED',
        ...(externalEvidence ? { evidence: externalEvidence } : {}),
      },
    ];
  });
}

function scrollToRole(roleKeys: string[]): void {
  const first = roleKeys[0];
  if (!first) return;
  document
    .getElementById(`task-group-${first}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 任务行的 DOM id：流程图点击后用它定位（刷新/复制链接后同样可用）。 */
function taskDomId(taskId: string): string {
  return `requirement-task-${taskId}`;
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
export function RequirementDetail({
  requirementId: requirementIdProp,
}: {
  requirementId?: string;
} = {}) {
  const navigate = useNavigate();
  const params = useParams<{ requirementId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    projects,
    projectId: selectedProjectId,
    setProjectId,
    loading: projectsLoading,
    error: projectsError,
  } = useProjectContext();
  const routeKey = requirementIdProp ?? params.requirementId ?? '';
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
  const user = useAuthStore((state) => state.user);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [roles, setRoles] = useState<RoleView[]>([]);
  /** null = 还没读到流程定义；不能用 [] 假装「未发布」。 */
  const [definitions, setDefinitions] = useState<WorkflowDefinitionView[] | null>(null);
  const [definitionError, setDefinitionError] = useState('');
  const [initContextLoading, setInitContextLoading] = useState(false);
  const [initOpen, setInitOpen] = useState(false);
  /** 每个流程实例的 步骤→前置步骤 映射；缺失表示依赖信息不可用。 */
  const [stepDepsByInstance, setStepDepsByInstance] = useState<
    Record<string, Record<string, string[]>>
  >({});
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);

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
    if (!detail || detail.tasks.length > 0 || !effectiveProjectId) return;
    let alive = true;
    setInitContextLoading(true);
    (async () => {
      const [memberResult, roleResult, definitionResult] = await Promise.allSettled([
        projectApi.members(effectiveProjectId),
        projectApi.roles(effectiveProjectId),
        workflowApi.listDefinitions(effectiveProjectId),
      ]);
      if (!alive) return;
      if (memberResult.status === 'fulfilled') setMembers(memberResult.value);
      else setMembers([]);
      if (roleResult.status === 'fulfilled') setRoles(roleResult.value);
      else setRoles([]);
      if (definitionResult.status === 'fulfilled') {
        setDefinitions(definitionResult.value.items);
        setDefinitionError('');
      } else {
        setDefinitions([]);
        setDefinitionError(formatApiError(definitionResult.reason));
      }
      setInitContextLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [detail, effectiveProjectId]);

  /**
   * 依赖信息来自「实例 → 定义修订」两步 GET；任何一步失败都标记该实例依赖不可用，
   * 页面据此显示「状态待确认」，不会退化成「无依赖 · 可领取」。
   */
  useEffect(() => {
    if (!detail || detail.tasks.length === 0) {
      setStepDepsByInstance({});
      return;
    }
    const instanceIds = [...new Set(detail.tasks.map((task) => task.instanceId))].filter(Boolean);
    let alive = true;
    (async () => {
      const next: Record<string, Record<string, string[]>> = {};
      const revisionCache = new Map<string, Record<string, string[]>>();
      for (const instanceId of instanceIds) {
        try {
          const instance = await workflowApi.instance(instanceId);
          const revisionId = instance.definitionRevisionId;
          let deps = revisionCache.get(revisionId);
          if (!deps) {
            const revision = await workflowApi.revision(revisionId);
            deps = stepDependencyMap(revision.definition);
            revisionCache.set(revisionId, deps);
          }
          next[instanceId] = deps;
        } catch {
          // 缺失即不可用；保留空对象会被误读成「没有依赖」，所以这里不写入 next。
        }
      }
      if (alive) setStepDepsByInstance(next);
    })();
    return () => {
      alive = false;
    };
  }, [detail]);

  const focusedTaskId = searchParams.get('taskId');

  // 带 taskId 的链接（刷新/复制）即使 tab 不是 tasks，也自动切到任务页签。
  useEffect(() => {
    if (focusedTaskId && tab !== 'tasks') setTab('tasks');
  }, [focusedTaskId, tab]);

  /**
   * 流程图/链接定位任务：校验存在性 → 滚动到可视区 → 临时高亮 → 聚焦。
   * 无效 taskId 清理参数并给出轻量提示，避免页面报错或一直等待。
   */
  useEffect(() => {
    if (tab !== 'tasks' || !detail || !focusedTaskId) {
      setHighlightTaskId(null);
      return;
    }
    const exists = detail.tasks.some((task) => task.id === focusedTaskId);
    if (!exists) {
      setNotice('未找到该任务，已清除无效的任务定位参数。');
      setSearchParams(
        (current) => {
          const nextParams = new URLSearchParams(current);
          nextParams.delete('taskId');
          return nextParams;
        },
        { replace: true },
      );
      return;
    }
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const element = document.getElementById(taskDomId(focusedTaskId));
      if (!element) return;
      element.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      element.focus({ preventScroll: true });
      setHighlightTaskId(focusedTaskId);
    });
    const timer = window.setTimeout(() => {
      if (!cancelled) setHighlightTaskId(null);
    }, 2600);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [tab, focusedTaskId, detail, setSearchParams]);

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

  /** 每个实例里已完成的步骤 key；没拿到依赖信息时不会被使用。 */
  const doneStepKeysByInstance = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const task of detail?.tasks ?? []) {
      if (task.executionStatus !== 'DONE') continue;
      const set = map.get(task.instanceId) ?? new Set<string>();
      set.add(task.stepKey);
      map.set(task.instanceId, set);
    }
    return map;
  }, [detail]);

  /**
   * 任务状态统一由共享映射推出：依赖信息可用时按「直接前置步骤是否完成」判断可领取，
   * 不可用时一律「状态待确认」。绝不以 executionStatus === 'OPEN' 推断可领取。
   */
  const taskStates = useMemo<Record<string, TaskDisplayState>>(() => {
    const states: Record<string, TaskDisplayState> = {};
    for (const task of detail?.tasks ?? []) {
      const deps = stepDepsByInstance[task.instanceId];
      const done = doneStepKeysByInstance.get(task.instanceId);
      // 定义里找不到该 stepKey 时不能当成「没有依赖」，只能当作依赖信息不可用。
      const hasStepDefinition = Boolean(deps && Object.prototype.hasOwnProperty.call(deps, task.stepKey));
      const signals: TaskStateSignals = {
        executionStatus: task.executionStatus,
        workStatus: task.workStatus,
        currentClaimId: task.currentClaimId,
        reviewStatus: task.review?.status ?? null,
        dependsOnStepKeys: hasStepDefinition ? deps![task.stepKey] : null,
        // 依赖可用但没有任务完成时也要给空集合，否则会被误判成「依赖信息不可用」。
        doneStepKeys: hasStepDefinition ? (done ?? new Set<string>()) : null,
      };
      states[task.id] = resolveTaskDisplayState(signals);
    }
    return states;
  }, [detail, stepDepsByInstance, doneStepKeysByInstance]);

  const currentMember = members.find((member) => member.id === user?.id);
  const isAdmin = currentMember?.role === 'OWNER' || currentMember?.role === 'ADMIN';

  const initState = useMemo(() => {
    const base = describeWorkflowInitState({
      hasInstance: (detail?.tasks.length ?? 0) > 0,
      definitions,
      isAdmin,
      admins: members.filter((member) => member.role === 'OWNER' || member.role === 'ADMIN'),
    });
    // 定义读取失败时不能断言「尚未发布」，只能说明「无法确认」。
    if (!definitionError || (definitions?.length ?? 0) > 0) return base;
    return {
      ...base,
      kind: 'LOADING' as const,
      title: '流程定义读取失败',
      description: '无法确认流程定义是否已发布或已创建实例；请稍后重试，或联系项目管理员核对流程配置。',
      canInitialize: false,
      linkToWorkflows: false,
    };
  }, [detail, definitions, definitionError, isAdmin, members]);

  const pipelineTasks = useMemo<RequirementPipelineTask[]>(
    () =>
      (detail?.tasks ?? []).map((task) => {
        const deps = stepDepsByInstance[task.instanceId];
        const done = doneStepKeysByInstance.get(task.instanceId);
        const hasStepDefinition = Boolean(deps && Object.prototype.hasOwnProperty.call(deps, task.stepKey));
        return {
          id: task.id,
          stepKey: task.stepKey,
          title: STEP_LABELS[task.stepKey] ?? task.stepKey,
          role: task.role.key,
          roleLabel: task.role.title,
          executionStatus: task.executionStatus,
          workStatus: task.workStatus,
          artifactCount: task.artifactCount,
          currentClaimId: task.currentClaimId,
          reviewStatus: task.review?.status ?? null,
          dependsOnStepKeys: hasStepDefinition ? deps![task.stepKey] : null,
          doneStepKeys: hasStepDefinition ? [...(done ?? [])] : null,
          displayState: taskStates[task.id],
          updatedAt: undefined,
        };
      }),
    [detail, stepDepsByInstance, doneStepKeysByInstance, taskStates],
  );

  const pipelinePhases = useMemo<RequirementPipelinePhase[]>(() => {
    const roleTasks = (roles: string[]) =>
      pipelineTasks.filter((task) => roles.includes(task.role ?? ''));
    const phase = (
      id: string,
      label: string,
      shortLabel: string,
      role: string,
      roles: string[],
    ): RequirementPipelinePhase => ({
      id,
      label,
      shortLabel,
      role,
      roleLabel: labelFor(
        { product: '产品', ui: '设计', engineering: '前端 / 后端', qa: '测试', ops: '运维' },
        role,
      ),
      tasks: roleTasks(roles),
      nextAction:
        role === 'product'
          ? '确认需求与验收标准'
          : role === 'ui'
            ? '完成设计交付'
            : role === 'engineering'
              ? '提交实现工件'
              : role === 'qa'
                ? '完成验收测试'
                : '完成发布验收',
    });
    return [
      phase('discovery', '需求发现', '发现', 'product', ['product']),
      phase('definition', '方案定义', '定义', 'product', ['product']),
      phase('design', '体验设计', '设计', 'ui', ['ui']),
      phase('build', '开发实现', '开发', 'engineering', ['frontend', 'backend']),
      phase('verify', '测试验证', '验证', 'qa', ['qa']),
      phase('release', '发布上线', '发布', 'ops', ['ops']),
    ];
  }, [pipelineTasks]);

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
  const claimableTasks = detail?.tasks.filter((task) => taskStates[task.id]?.claimable) ?? [];
  const unknownStateTasks =
    detail?.tasks.filter((task) => taskStates[task.id]?.kind === 'UNKNOWN') ?? [];

  const next = useMemo(() => {
    if (!detail) return null;
    if (detail.requirement.workStatus === 'CANCELLED')
      return {
        title: '需求已取消',
        text: '只保留历史证据，不再提供签字或编辑入口。',
        action: null,
      };
    if (detail.tasks.length === 0) {
      const action = initState.canInitialize
        ? { label: '初始化流程', run: () => setInitOpen(true) }
        : initState.linkToWorkflows
          ? { label: '查看流程定义', run: () => navigate('/workflows') }
          : {
              label: '复制需求链接',
              run: () => void copyText(window.location.href, '需求链接'),
            };
      return { title: initState.title, text: initState.description, action };
    }
    if (openReviews.length > 0)
      return {
        title: `有 ${openReviews.length} 条评审待签字`,
        text: '签字前请确认正文、验收标准、工件与上一次决定。',
        action: { label: '去签字', run: () => navigate(`/reviews/${openReviews[0].id}`) },
      };
    if (claimableTasks.length > 0)
      return {
        title: `有 ${claimableTasks.length} 个任务可立即领取`,
        text: '判定依据：已发布流程的直接前置步骤均已完成。任务由本地 Agent 认领与交付；这里只读。',
        action: { label: '查看看板', run: () => navigate('/board') },
      };
    if (unknownStateTasks.length > 0)
      return {
        title: '任务状态待确认',
        text: '服务端没有返回可用的流程依赖信息，无法确认哪些任务可以领取；请稍后刷新或联系项目管理员。',
        action: null,
      };
    return {
      title: '当前没有待处理动作',
      text: '等待 Agent 交付或下一次评审触发。',
      action: null,
    };
  }, [
    detail,
    openReviews,
    claimableTasks,
    unknownStateTasks,
    initState,
    navigate,
    copyText,
  ]);

  async function copyText(text: string, label: string) {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setNotice(`已复制${label}。`);
    } catch {
      setNotice(`复制失败，请手动选择${label}。`);
    }
  }

  function changeTab(next: DetailTab, taskId?: string) {
    setTab(next);
    setSearchParams(
      (current) => {
        const nextParams = new URLSearchParams(current);
        nextParams.set('tab', next);
        if (taskId) nextParams.set('taskId', taskId);
        else nextParams.delete('taskId');
        return nextParams;
      },
      { replace: true },
    );
  }

  /** 流程图任务点击：切到任务页签并记录目标 taskId（可刷新/复制恢复）。 */
  function focusTask(taskId: string) {
    changeTab('tasks', taskId);
  }

  async function reloadDetail() {
    if (!effectiveProjectId || !routeKey) return;
    try {
      const value = await requirementApi.detail(effectiveProjectId, routeKey);
      setDetail(value);
      setError('');
    } catch (caught) {
      setError(formatApiError(caught));
    }
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

  if ((loading || projectsLoading) && !detail) {
    return (
      <section>
        <div className="req-head req-head-skeleton">
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
        </div>
      </section>
    );
  }

  if (projectsError && !effectiveProjectId) {
    return (
      <section>
        <header className="page-head">
          <div>
            <h2>需求详情</h2>
            <p className="page-sub">项目上下文没有加载成功。</p>
          </div>
          <div className="page-actions">
            <button className="primary" onClick={() => navigate('/login')}>
              重新登录
            </button>
          </div>
        </header>
        <p className="error" role="alert">
          {projectsError}
        </p>
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
            {projectName ? `${projectName} · ` : ''}创建于 {dateTime(requirement.createdAt)} ·
            更新于 {dateTime(requirement.updatedAt)}
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

      <RequirementPipeline
        phases={pipelinePhases}
        tasks={pipelineTasks}
        nextAction={next?.title}
        onPhaseClick={(phase) => {
          changeTab('tasks');
          const firstTaskRole = phase.tasks?.[0]?.role;
          window.setTimeout(() => scrollToRole(firstTaskRole ? [firstTaskRole] : []), 0);
        }}
        onTaskClick={(task) => focusTask(task.id)}
      />

      {detail.tasks.length === 0 && (
        <div className="detail-card wm-init-state" role="status" aria-live="polite">
          <div className="detail-card-head">
            <h3>流程初始化</h3>
            {initContextLoading && <span className="task-row-meta">正在读取流程定义…</span>}
          </div>
          <strong>{initState.title}</strong>
          <p>{initState.description}</p>
          {initState.adminNames.length > 0 && (
            <p className="task-row-meta">项目管理员：{initState.adminNames.join('、')}</p>
          )}
          {definitionError && (
            <p className="error" role="alert">
              流程定义读取失败：{definitionError}
            </p>
          )}
          <div className="next-step-actions">
            {initState.canInitialize && (
              <button className="primary" onClick={() => setInitOpen(true)}>
                初始化流程
              </button>
            )}
            {initState.linkToWorkflows && (
              <button className="ghost" onClick={() => navigate('/workflows')}>
                查看流程定义
              </button>
            )}
            <button
              className="ghost"
              onClick={() => void copyText(window.location.href, '需求链接')}
            >
              复制需求链接
            </button>
            <button className="ghost" onClick={() => navigate('/requirements')}>
              返回需求列表
            </button>
          </div>
        </div>
      )}
      <ol className="req-tabs" role="tablist" aria-label="需求详情">
        {DETAIL_STAGES.map((item) => {
          const count = stageCountOf(item.key, detail, prdDocs.length, trace.length);
          const active = tab === item.key;
          return (
            <li key={item.key}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={`req-tab${active ? ' is-active' : ''}`}
                onClick={() => changeTab(item.key)}
              >
                {item.label}
                {count !== null && <span className="req-tab-count">{count}</span>}
              </button>
            </li>
          );
        })}
      </ol>

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
                          <strong>{change.changedFields.join(' / ') || '未标注字段'}</strong>
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
                <div className="detail-empty wm-init-hint">
                  <p>
                    <strong>{initState.title}</strong>
                  </p>
                  <p>{initState.description}</p>
                  {initState.canInitialize && (
                    <button className="primary" onClick={() => setInitOpen(true)}>
                      初始化流程
                    </button>
                  )}
                </div>
              ) : (
                <div className="task-groups">
                  {taskGroups.map((group) => (
                    <div className="task-group" id={`task-group-${group.key}`} key={group.key}>
                      <div className="task-group-head">
                        <strong>{group.title}</strong>
                        <span className="task-row-meta">{group.tasks.length} 个任务</span>
                      </div>
                      {group.tasks.map((task) => {
                        const display =
                          taskStates[task.id] ??
                          resolveTaskDisplayState({
                            executionStatus: task.executionStatus,
                            workStatus: task.workStatus,
                          });
                        return (
                          <div
                            className={`task-row wm-task-row${task.review?.status === 'OPEN' ? ' is-pending' : ''}${highlightTaskId === task.id ? ' is-task-focus' : ''}`}
                            key={task.id}
                            id={taskDomId(task.id)}
                            data-task-id={task.id}
                            data-task-state={display.kind}
                            tabIndex={-1}
                            aria-label={`任务 ${labelFor(STEP_LABELS, task.stepKey)}，状态：${display.label}`}
                          >
                            <div className="task-row-main">
                              <div className="task-row-top">
                                <strong title={task.stepKey}>
                                  {labelFor(STEP_LABELS, task.stepKey)}
                                </strong>
                                <span className={`status-tag is-${display.tone}`}>
                                  {display.label}
                                </span>
                                {task.review && (
                                  <span className="status-tag">
                                    {labelFor(REVIEW_STATUS_LABELS, task.review.status)}
                                  </span>
                                )}
                                {task.currentClaimId && (
                                  <span className="status-tag">已认领</span>
                                )}
                              </div>
                              <div className="task-row-meta">
                                责任人 {task.responsibleUser.email} · 工件 {task.artifactCount} 件 ·
                                v{task.version}
                              </div>
                              <div className="task-row-meta wm-task-state-desc">
                                {display.description}
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
                                <div className="task-signed">
                                  <span>{labelFor(REVIEW_STATUS_LABELS, task.review.status)}</span>
                                  {task.review.decisions?.[0] && (
                                    <span className="task-row-meta">
                                      {labelFor(DECISION_LABELS, task.review.decisions[0].decision)}
                                      {task.review.decisions[0].actor
                                        ? ` · ${task.review.decisions[0].actor.email}`
                                        : ''}
                                      {` · ${dateTime(task.review.decisions[0].createdAt)}`}
                                    </span>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
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
                      {group.items.map((artifact) => {
                        const checks = artifactChecks(artifact.checks);
                        const failed = checks.filter((check) => !check.passed);
                        return (
                          <div className="task-row" key={artifact.id}>
                            <div className="task-row-main">
                              <div className="task-row-top">
                                <strong className="cell-mono">
                                  {artifact.repoPath ?? artifact.mediaType}
                                </strong>
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
                              {checks.length > 0 && (
                                <div className="artifact-checks">
                                  <span>
                                    校验 {checks.length - failed.length}/{checks.length}
                                  </span>
                                  <span>
                                    Agent 自述{' '}
                                    {
                                      checks.filter((check) => check.source === 'AGENT_REPORTED')
                                        .length
                                    }
                                  </span>
                                  <span>
                                    外部引用{' '}
                                    {
                                      checks.filter(
                                        (check) => check.source === 'EXTERNAL_REFERENCE',
                                      ).length
                                    }
                                    （未核验）
                                  </span>
                                  {failed.map((check) => (
                                    <span className="status-tag is-danger" key={check.code}>
                                      {check.code} 失败
                                    </span>
                                  ))}
                                  {checks
                                    .filter(
                                      (check) =>
                                        check.source === 'EXTERNAL_REFERENCE' && check.evidence,
                                    )
                                    .map((check) => (
                                      <a
                                        className="status-tag"
                                        href={
                                          check.evidence!.url.startsWith('https://')
                                            ? check.evidence!.url
                                            : undefined
                                        }
                                        target="_blank"
                                        rel="noreferrer"
                                        key={`${check.code}:evidence`}
                                      >
                                        查看 {check.evidence!.provider} 引用
                                      </a>
                                    ))}
                                </div>
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
                        );
                      })}
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

      <WorkflowInstanceDialog
        open={initOpen}
        requirement={detail.requirement}
        definitions={definitions ?? []}
        roles={roles}
        members={members}
        onClose={() => setInitOpen(false)}
        onCreated={(message) => {
          setInitOpen(false);
          setNotice(message);
          void reloadDetail();
        }}
      />

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
