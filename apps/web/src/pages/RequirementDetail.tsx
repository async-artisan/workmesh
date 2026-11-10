import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Copy, Link2, MoreHorizontal, Terminal } from 'lucide-react';
import { ApiError, formatApiError } from '../api/client';
import { formatDateTime } from '../lib/datetime';
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
import { FullValueDisclosure } from '../components/FullValueDisclosure';
import {
  RequirementPipeline,
  type RequirementPipelinePhase,
  type RequirementPipelineTask,
} from '../components/RequirementPipeline';
import { WorkflowInstanceDialog } from '../components/WorkflowInstanceDialog';
import { TaskInputStatusPanel } from '../components/TaskInputStatusPanel';
import { TaskRelations } from '../components/TaskRelations';
import { RequirementTrustChain } from '../components/RequirementTrustChain';
import { LazyCodeEvidenceStatus } from '../components/CodeEvidenceStatus';
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
import { describeWorkflowInitState } from '../lib/workflowInitState';
import { stepDependencyGraph, type StepDependencyGraph } from '../lib/workflowInstance';

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
  return formatDateTime(value);
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

/** 任务行可见标题 / 状态的稳定 id，供 role="group" 的 aria-labelledby 使用。 */
function taskTitleDomId(taskId: string): string {
  return `requirement-task-title-${taskId}`;
}

function taskStateDomId(taskId: string): string {
  return `requirement-task-state-${taskId}`;
}

type InitLoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'forbidden';
type InitContextKind = 'members' | 'roles' | 'definitions';

const INIT_CONTEXT_KINDS: InitContextKind[] = ['members', 'roles', 'definitions'];

const INIT_STATUS_LABELS: Record<InitLoadStatus, string> = {
  idle: '未读取',
  loading: '读取中',
  ready: '已读取',
  error: '读取失败',
  forbidden: '无读取权限',
};

interface InitContextError {
  /** 面向用户的一句话说明。 */
  message: string;
  /** formatApiError 输出（含错误码与 requestId）。 */
  detail: string;
  requestId?: string;
}

/** 成员/角色/定义读取失败时保留真实错误，调用方据此决定是否可判定权限。 */
function initContextErrorOf(caught: unknown, label: string): InitContextError {
  const detail = formatApiError(caught);
  const requestId = caught instanceof ApiError ? caught.requestId : undefined;
  if (caught instanceof ApiError && caught.status === 403) {
    return {
      message: `当前账号没有查看${label}的权限（403），无法确认初始化权限。`,
      detail,
      requestId,
    };
  }
  return { message: `${label}读取失败，暂时无法确认初始化权限。`, detail, requestId };
}

/**
 * 依赖信号：只有「定义存在 + 该步骤存在 + 该步骤依赖图完整」时才交给状态映射；
 * 否则显式标记原因，让任务显示「状态待确认」，绝不退化成「无依赖 · 可领取」。
 */
function dependencySignalsOf(
  graph: StepDependencyGraph | undefined,
  task: RequirementTaskDetail,
  done: ReadonlySet<string> | undefined,
): Pick<TaskStateSignals, 'dependsOnStepKeys' | 'doneStepKeys' | 'dependencyInfoIssue'> {
  if (!graph || !graph.hasSteps) {
    return { dependsOnStepKeys: null, doneStepKeys: null, dependencyInfoIssue: 'unavailable' };
  }
  const info = graph.steps[task.stepKey];
  if (!info) {
    return { dependsOnStepKeys: null, doneStepKeys: null, dependencyInfoIssue: 'missing-step' };
  }
  if (!info.isDependencyGraphComplete) {
    return {
      dependsOnStepKeys: null,
      doneStepKeys: null,
      dependencyInfoIssue: 'unknown-dependencies',
    };
  }
  return {
    dependsOnStepKeys: info.dependencyKeys,
    doneStepKeys: done ?? new Set<string>(),
    dependencyInfoIssue: null,
  };
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
  const effectiveProjectId = searchParams.has('projectId')
    ? selectedProjectId
    : (routeProject?.id ?? selectedProjectId);

  const [detail, setDetail] = useState<RequirementDetailView | null>(null);
  const [prdDocs, setPrdDocs] = useState<DocumentDetail[]>([]);
  const focusedTaskId = searchParams.get('taskId');
  // 页签只由 URL 派生。taskId 深链优先显示任务，切换页签会同时清除该定位参数。
  const tab: DetailTab = focusedTaskId
    ? 'tasks'
    : isDetailTab(searchParams.get('tab'))
      ? (searchParams.get('tab') as DetailTab)
      : 'overview';
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // 「更多」菜单：点击外部或按 Esc 关闭，避免浮层挡住页头按钮。
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);
  const [notice, setNotice] = useState('');
  const [editDiscardOpen, setEditDiscardOpen] = useState(false);
  const [traceKind, setTraceKind] = useState('all');
  const user = useAuthStore((state) => state.user);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [membersStatus, setMembersStatus] = useState<InitLoadStatus>('idle');
  const [membersError, setMembersError] = useState<InitContextError | null>(null);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [rolesStatus, setRolesStatus] = useState<InitLoadStatus>('idle');
  const [rolesError, setRolesError] = useState<InitContextError | null>(null);
  /** null = 还没读过流程定义；失败时保留上一次成功的数据，不用 [] 冒充「未发布」。 */
  const [definitions, setDefinitions] = useState<WorkflowDefinitionView[] | null>(null);
  const [definitionsStatus, setDefinitionsStatus] = useState<InitLoadStatus>('idle');
  const [definitionError, setDefinitionError] = useState<InitContextError | null>(null);
  const [initOpen, setInitOpen] = useState(false);
  /** 上一次初始化失败的真实错误；关闭弹窗后仍驱动详情页的 CREATE_FAILED 状态。 */
  const [createFailure, setCreateFailure] = useState<{
    message: string;
    requestId?: string;
  } | null>(null);
  /** 初始化上下文的请求代号，切换需求/项目/重试时淘汰旧响应。 */
  const initRequestRef = useRef(0);
  /** 每个流程实例的步骤依赖图（含未知依赖与完整性）；缺失表示依赖信息不可用。 */
  const [stepDepsByInstance, setStepDepsByInstance] = useState<Record<string, StepDependencyGraph>>(
    {},
  );
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!searchParams.has('projectId') && routeProject && routeProject.id !== selectedProjectId)
      setProjectId(routeProject.id);
  }, [routeProject, selectedProjectId, setProjectId, searchParams]);

  // 切换需求或项目时清理旧上下文与失败状态，避免把上一条需求的角色/定义当成当前事实。
  useEffect(() => {
    setMembers([]);
    setMembersStatus('idle');
    setMembersError(null);
    setRoles([]);
    setRolesStatus('idle');
    setRolesError(null);
    setDefinitions(null);
    setDefinitionsStatus('idle');
    setDefinitionError(null);
    setCreateFailure(null);
    setInitOpen(false);
  }, [effectiveProjectId, routeKey]);

  useEffect(() => {
    if (!effectiveProjectId || !routeKey) {
      setDetail(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    // 切换需求/项目后，上一次初始化失败不再适用于新目标。
    setCreateFailure(null);
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

  /**
   * 流程初始化上下文：成员 / 角色 / 流程定义各自保留 idle|loading|ready|error|forbidden，
   * 失败只更新状态与错误，不覆盖最后一次成功读取的数据；权限判断只认 status=ready。
   */
  async function loadInitContext(projectId: string, only?: InitContextKind[]) {
    const kinds = new Set<InitContextKind>(only ?? INIT_CONTEXT_KINDS);
    const requestId = initRequestRef.current + 1;
    initRequestRef.current = requestId;
    if (kinds.has('members')) {
      setMembersStatus('loading');
      setMembersError(null);
    }
    if (kinds.has('roles')) {
      setRolesStatus('loading');
      setRolesError(null);
    }
    if (kinds.has('definitions')) {
      setDefinitionsStatus('loading');
      setDefinitionError(null);
    }

    const [memberResult, roleResult, definitionResult] = await Promise.allSettled([
      kinds.has('members') ? projectApi.members(projectId) : Promise.resolve(null),
      kinds.has('roles') ? projectApi.roles(projectId) : Promise.resolve(null),
      kinds.has('definitions') ? workflowApi.listDefinitions(projectId) : Promise.resolve(null),
    ]);
    if (initRequestRef.current !== requestId) return;

    if (kinds.has('members')) {
      if (memberResult.status === 'fulfilled' && memberResult.value) {
        setMembers(memberResult.value);
        setMembersStatus('ready');
        setMembersError(null);
      } else if (memberResult.status === 'rejected') {
        // 保留上一次成功读取的成员数据；失败事实只由 status/error 表达。
        setMembersError(initContextErrorOf(memberResult.reason, '项目成员信息'));
        setMembersStatus(
          memberResult.reason instanceof ApiError && memberResult.reason.status === 403
            ? 'forbidden'
            : 'error',
        );
      }
    }

    if (kinds.has('roles')) {
      if (roleResult.status === 'fulfilled' && roleResult.value) {
        setRoles(roleResult.value);
        setRolesStatus('ready');
        setRolesError(null);
      } else if (roleResult.status === 'rejected') {
        setRolesError(initContextErrorOf(roleResult.reason, '项目角色'));
        setRolesStatus(
          roleResult.reason instanceof ApiError && roleResult.reason.status === 403
            ? 'forbidden'
            : 'error',
        );
      }
    }

    if (kinds.has('definitions')) {
      if (definitionResult.status === 'fulfilled' && definitionResult.value) {
        setDefinitions(
          Array.isArray(definitionResult.value.items) ? definitionResult.value.items : [],
        );
        setDefinitionsStatus('ready');
        setDefinitionError(null);
      } else if (definitionResult.status === 'rejected') {
        // 保留上一次成功读取的定义数据；当前状态不允许断言「未发布」。
        setDefinitionError(initContextErrorOf(definitionResult.reason, '流程定义'));
        setDefinitionsStatus(
          definitionResult.reason instanceof ApiError && definitionResult.reason.status === 403
            ? 'forbidden'
            : 'error',
        );
      }
    }
  }

  const initContextLoading =
    membersStatus === 'loading' || rolesStatus === 'loading' || definitionsStatus === 'loading';

  useEffect(() => {
    if (!detail || detail.tasks.length > 0 || !effectiveProjectId) return;
    void loadInitContext(effectiveProjectId);
    return () => {
      // 组件卸载或目标变化时让在途响应失效。
      initRequestRef.current += 1;
    };
    // 只在目标需求/项目或流程实例数量变化时重新读取初始化上下文。
  }, [detail?.requirement.id, detail?.tasks.length, effectiveProjectId]);

  // 三个上下文全部 ready 且成员身份已确认，才允许打开/保留初始化表单。
  const initContextsReady =
    membersStatus === 'ready' && rolesStatus === 'ready' && definitionsStatus === 'ready';
  useEffect(() => {
    if (initOpen && !initContextsReady) setInitOpen(false);
  }, [initOpen, initContextsReady]);

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
      const next: Record<string, StepDependencyGraph> = {};
      const revisionCache = new Map<string, StepDependencyGraph>();
      for (const instanceId of instanceIds) {
        try {
          const instance = await workflowApi.instance(instanceId);
          const revisionId = instance.definitionRevisionId;
          let graph = revisionCache.get(revisionId);
          if (!graph) {
            const revision = await workflowApi.revision(revisionId);
            graph = stepDependencyGraph(revision.definition);
            revisionCache.set(revisionId, graph);
          }
          next[instanceId] = graph;
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

  useEffect(() => {
    if (focusedTaskId) setExpandedTaskId(focusedTaskId);
  }, [focusedTaskId]);

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
      if (task.executionStatus !== 'DONE' || task.workStatus !== 'ACTIVE') continue;
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
      const dependencySignals = dependencySignalsOf(
        stepDepsByInstance[task.instanceId],
        task,
        doneStepKeysByInstance.get(task.instanceId),
      );
      states[task.id] = resolveTaskDisplayState({
        executionStatus: task.executionStatus,
        workStatus: task.workStatus,
        currentClaimId: task.currentClaimId,
        reviewStatus: task.review?.status ?? null,
        ...dependencySignals,
      });
    }
    return states;
  }, [detail, stepDepsByInstance, doneStepKeysByInstance]);

  const selectedTask = detail?.tasks.find((task) => task.id === focusedTaskId);
  function canCopyClaim(task: RequirementTaskDetail) {
    return (
      detail?.requirement.workStatus === 'ACTIVE' &&
      task.workflowWorkStatus === 'ACTIVE' &&
      task.claimEligibility?.canClaim === true &&
      taskStates[task.id]?.claimable === true
    );
  }
  function copyClaim(task: RequirementTaskDetail) {
    if (!canCopyClaim(task)) return;
    void copyText(`workmesh claim --task ${task.id}`, '领取命令');
  }

  const currentMember =
    membersStatus === 'ready' ? members.find((member) => member.id === user?.id) : undefined;
  const isAdmin = Boolean(
    currentMember && (currentMember.role === 'OWNER' || currentMember.role === 'ADMIN'),
  );

  const initState = useMemo(() => {
    const base = describeWorkflowInitState({
      hasInstance: (detail?.tasks.length ?? 0) > 0,
      definitions,
      isAdmin,
      admins: members.filter((member) => member.role === 'OWNER' || member.role === 'ADMIN'),
      createError: createFailure?.message ?? null,
    });
    // 已有实例时不再进入初始化判断。
    if ((detail?.tasks.length ?? 0) > 0) return base;

    // 成员状态未知/失败/无权限时，优先修复权限上下文，绝不断言「未发布」或「普通成员」。
    if (membersStatus === 'error')
      return {
        ...base,
        kind: 'LOADING' as const,
        title: '项目成员信息读取失败，暂时无法确认初始化权限',
        description:
          '无法读取项目成员列表，因此不能判断你是否具备初始化流程实例的权限；这不等于当前账号没有权限。',
        canInitialize: false,
        linkToWorkflows: false,
        // 成员名单读取失败时不再展示旧名单，避免把过期管理员当成当前事实。
        adminNames: [],
      };
    if (membersStatus === 'forbidden')
      return {
        ...base,
        kind: 'NO_PERMISSION' as const,
        title: '当前账号没有初始化流程实例的权限',
        description:
          '项目成员接口返回 403：当前账号无法查看项目成员与管理员名单，因此也无法确认初始化权限；如需初始化，请联系项目管理员。',
        canInitialize: false,
        linkToWorkflows: false,
        // 403 时不伪造管理员姓名。
        adminNames: [],
      };
    if (membersStatus !== 'ready')
      return {
        ...base,
        kind: 'LOADING' as const,
        title: '正在确认项目权限',
        description: '正在读取项目成员与权限；读取完成前不会判断你是否可以初始化流程。',
        canInitialize: false,
        linkToWorkflows: false,
      };

    // 角色接口失败（含 403）只表示「角色暂时无法读取」，不能映射成没有初始化权限。
    if (rolesStatus === 'error' || rolesStatus === 'forbidden')
      return {
        ...base,
        kind: 'LOADING' as const,
        title: '项目角色暂时无法读取',
        description:
          '角色信息没有读取成功，无法确认初始化表单所需的角色与审批人；这不代表当前账号没有初始化权限。请重试读取。',
        canInitialize: false,
        linkToWorkflows: false,
      };
    if (rolesStatus !== 'ready')
      return {
        ...base,
        kind: 'LOADING' as const,
        title: '正在读取项目角色',
        description: '正在读取项目角色；读取完成前不会判断你是否可以初始化流程。',
        canInitialize: false,
        linkToWorkflows: false,
      };

    // 定义接口失败（含 403）只表示「定义暂时无法读取」，不能断言「未发布」或「无权限」。
    if (definitionsStatus === 'error' || definitionsStatus === 'forbidden')
      return {
        ...base,
        kind: 'LOADING' as const,
        title: '流程定义暂时无法读取',
        description:
          '流程定义没有读取成功，无法确认是否已有已发布定义；这不代表定义未发布，也不代表当前账号没有初始化权限。请重试读取。',
        canInitialize: false,
        linkToWorkflows: false,
      };
    if (definitionsStatus !== 'ready')
      return {
        ...base,
        kind: 'LOADING' as const,
        title: '正在读取流程定义',
        description: '还在读取本项目的流程定义；读取完成前不会断言「未发布」。',
        canInitialize: false,
        linkToWorkflows: false,
      };

    return base;
  }, [
    detail,
    definitions,
    definitionsStatus,
    membersStatus,
    rolesStatus,
    isAdmin,
    members,
    createFailure,
  ]);

  const adminContacts =
    membersStatus === 'ready'
      ? members
          .filter((member) => member.role === 'OWNER' || member.role === 'ADMIN')
          .map((member) => ({
            name: member.name?.trim() || member.email,
            email: member.email,
          }))
      : [];

  const pipelineTasks = useMemo<RequirementPipelineTask[]>(
    () =>
      (detail?.tasks ?? []).map((task) => {
        const dependencySignals = dependencySignalsOf(
          stepDepsByInstance[task.instanceId],
          task,
          doneStepKeysByInstance.get(task.instanceId),
        );
        return {
          id: task.id,
          stepKey: task.stepKey,
          title: task.stepDisplayName?.trim() || STEP_LABELS[task.stepKey] || task.stepKey,
          role: task.role.key,
          roleLabel: task.role.title,
          executionStatus: task.executionStatus,
          workStatus: task.workStatus,
          artifactCount: task.artifactCount,
          currentClaimId: task.currentClaimId,
          reviewStatus: task.review?.status ?? null,
          ownerLabel: task.responsibleUser?.email ?? null,
          dependsOnStepKeys: dependencySignals.dependsOnStepKeys ?? null,
          doneStepKeys: dependencySignals.doneStepKeys ? [...dependencySignals.doneStepKeys] : null,
          displayState: taskStates[task.id],
          updatedAt: undefined,
        };
      }),
    [detail, stepDepsByInstance, doneStepKeysByInstance, taskStates],
  );

  /**
   * 阶段分配：同一个任务只允许出现一次。先按 stepKey 归位（prd / design / impl-* / verify / release），
   * 未识别的步骤再按角色兜底，最后把剩余任务并入「需求发现」。
   * 这样概览统计（Pipeline 的「完成数 / 任务总数」）与页签「任务 N」同一数据源，
   * 不会因为 discovery/definition 都取 product 任务而出现 7 张卡 / 6 个任务。
   */
  const pipelinePhases = useMemo<RequirementPipelinePhase[]>(() => {
    type PhaseDef = {
      id: string;
      label: string;
      shortLabel: string;
      role: string;
      roles: string[];
      stepKeys: string[];
      nextAction: string;
    };
    const phaseDefs: PhaseDef[] = [
      {
        id: 'discovery',
        label: '需求发现',
        shortLabel: '发现',
        role: 'product',
        roles: ['product'],
        stepKeys: ['prd', 'requirement', 'discovery', 'analysis'],
        nextAction: '确认需求与验收标准',
      },
      {
        id: 'definition',
        label: '方案定义',
        shortLabel: '定义',
        role: 'product',
        roles: ['product'],
        stepKeys: ['definition', 'solution', 'spec', 'proposal'],
        nextAction: '完成方案与边界定义',
      },
      {
        id: 'design',
        label: '体验设计',
        shortLabel: '设计',
        role: 'ui',
        roles: ['ui'],
        stepKeys: ['design', 'ui', 'prototype'],
        nextAction: '完成设计交付',
      },
      {
        id: 'build',
        label: '开发实现',
        shortLabel: '开发',
        role: 'engineering',
        roles: ['frontend', 'backend', 'engineering'],
        stepKeys: ['impl', 'implement', 'frontend', 'backend', 'develop'],
        nextAction: '提交实现工件',
      },
      {
        id: 'verify',
        label: '测试验证',
        shortLabel: '验证',
        role: 'qa',
        roles: ['qa'],
        stepKeys: ['verify', 'test', 'qa', 'case', 'acceptance'],
        nextAction: '完成验收测试',
      },
      {
        id: 'release',
        label: '发布上线',
        shortLabel: '发布',
        role: 'ops',
        roles: ['ops'],
        stepKeys: ['release', 'deploy', 'ops', 'publish'],
        nextAction: '完成发布验收',
      },
    ];

    const tasksByPhase = new Map<string, RequirementPipelineTask[]>();
    const claimed = new Set<string>();
    const take = (predicate: (task: RequirementPipelineTask) => boolean) =>
      pipelineTasks.filter((task) => {
        if (claimed.has(task.id) || !predicate(task)) return false;
        claimed.add(task.id);
        return true;
      });

    // 1) stepKey 归位：精确匹配或 `impl-*` 这类前缀匹配。
    for (const def of phaseDefs) {
      tasksByPhase.set(
        def.id,
        take((task) => {
          const step = (task.stepKey ?? '').toLowerCase();
          if (!step) return false;
          return def.stepKeys.some((key) => step === key || step.startsWith(key));
        }),
      );
    }
    // 2) 未识别的步骤按角色兜底，避免任务从视图中消失。
    for (const def of phaseDefs) {
      const fallback = take((task) => def.roles.includes(task.role ?? ''));
      if (fallback.length) {
        tasksByPhase.set(def.id, [...(tasksByPhase.get(def.id) ?? []), ...fallback]);
      }
    }
    // 3) 仍无归属（例如 lead 任务）并入需求发现，保证总数与页签计数一致。
    const leftovers = take(() => true);
    if (leftovers.length) {
      tasksByPhase.set('discovery', [...(tasksByPhase.get('discovery') ?? []), ...leftovers]);
    }

    // Empty template stages are not part of this requirement's actual task flow.
    const visiblePhaseDefs = pipelineTasks.length
      ? phaseDefs.filter((def) => (tasksByPhase.get(def.id)?.length ?? 0) > 0)
      : phaseDefs;
    return visiblePhaseDefs.map((def) => {
      const phaseTasks = tasksByPhase.get(def.id) ?? [];
      const liveTask = phaseTasks.find((task) =>
        ['IN_PROGRESS', 'BLOCKED_OR_FROZEN', 'CLAIMABLE'].includes(task.displayState?.kind ?? ''),
      );
      const currentTask =
        liveTask ?? phaseTasks.find((task) => task.ownerLabel?.trim()) ?? phaseTasks[0];
      // When a live task is known but has no responsibleUser, preserve that fact instead of
      // borrowing the owner of a completed task in the same phase.
      const ownerLabel = liveTask
        ? (liveTask.ownerLabel?.trim() ?? null)
        : (currentTask?.ownerLabel?.trim() ?? null);
      return {
        id: def.id,
        label: def.label,
        shortLabel: def.shortLabel,
        role: def.role,
        roleLabel: labelFor(
          { product: '产品', ui: '设计', engineering: '前端 / 后端', qa: '测试', ops: '运维' },
          def.role,
        ),
        ownerLabel,
        tasks: phaseTasks,
        nextAction: def.nextAction,
        // 这是可定位到真实任务的入口；不把静态阶段文案冒充为已执行动作。
        actionLabel: currentTask ? '定位当前任务' : null,
        onAction: currentTask ? () => focusTask(currentTask.id) : undefined,
      };
    });
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
      const reviewSubjectLabel =
        (review.taskId && review.stepDisplayName?.trim()) || review.subjectLabel;
      items.push({
        id: `review-${review.id}`,
        kind: '评审',
        title: `${labelFor(REVIEW_KIND_LABELS, review.kind)} · ${reviewSubjectLabel}`,
        at: review.createdAt,
      });
      for (const decision of review.decisions) {
        items.push({
          id: `decision-${decision.id}`,
          kind: '决定',
          title: `${labelFor(DECISION_LABELS, decision.decision)} · ${reviewSubjectLabel}`,
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
        ? {
            label: initState.kind === 'CREATE_FAILED' ? '重新初始化流程' : '初始化流程',
            run: () => setInitOpen(true),
          }
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
        title: `有 ${claimableTasks.length} 个任务的前置任务已完成`,
        text: '已发布流程的直接前置步骤均已完成；请在任务详情核对本人领取资格与必需输入，再由本地 Agent 认领。',
        action: {
          label: '查看前置已完成的任务',
          run: () => focusTask(claimableTasks[0].id),
        },
      };
    if (unknownStateTasks.length > 0)
      return {
        title: '任务状态待确认',
        text: '服务端没有返回可用的流程依赖信息，无法确认哪些任务可以领取；请稍后刷新或联系项目管理员。',
        action: null,
      };
    if (
      detail.requirement.phase === 'RELEASED' &&
      detail.tasks.every((task) => taskStates[task.id]?.kind === 'DONE')
    )
      return {
        title: '需求已发布，全部任务已完成',
        text: '交付与验收已完成，可查看交付物和追溯记录。',
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
    taskStates,
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

  /** 页签键盘操作：左右方向键切换、Home/End 跳首尾，焦点跟随当前页签（roving tabindex）。 */
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function onTabKeyDown(event: { key: string; preventDefault: () => void }) {
    const keys = DETAIL_STAGES.map((stage) => stage.key);
    const index = keys.indexOf(tab);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % keys.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + keys.length) % keys.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = keys.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = keys[nextIndex];
    changeTab(nextTab);
    window.requestAnimationFrame(() => tabRefs.current[nextIndex!]?.focus());
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
      <section role="status" aria-live="polite" aria-busy="true">
        <span className="visually-hidden">正在读取需求详情…</span>
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

  /** 初始化上下文的失败说明、保留数据与重试入口；失败状态不能被空数组/空态掩盖。 */
  function initContextAlerts() {
    const retry = (kinds?: InitContextKind[]) => {
      if (effectiveProjectId) void loadInitContext(effectiveProjectId, kinds);
    };
    return (
      <>
        {membersStatus === 'error' && membersError && (
          <div className="wm-init-context-error" role="group" aria-label="项目成员读取状态">
            <p className="error" role="alert">
              项目成员信息读取失败，暂时无法确认初始化权限
            </p>
            <p className="task-row-meta">{membersError.detail}</p>
            <button type="button" className="ghost" onClick={() => retry(['members'])}>
              重试读取权限信息
            </button>
          </div>
        )}
        {membersStatus === 'forbidden' && membersError && (
          <div className="wm-init-context-error" role="group" aria-label="项目成员读取状态">
            <p className="error" role="alert">
              当前账号没有初始化流程实例的权限
            </p>
            <p className="task-row-meta">
              项目成员接口返回 403，无法读取项目成员与管理员名单，因此也无法确认初始化权限。
              {membersError.detail}
            </p>
          </div>
        )}
        {(rolesStatus === 'error' || rolesStatus === 'forbidden') && rolesError && (
          <div className="wm-init-context-error" role="group" aria-label="项目角色读取状态">
            <p className="error" role="alert">
              项目角色暂时无法读取
            </p>
            <p className="task-row-meta">{rolesError.detail}</p>
            {roles.length > 0 && (
              <p className="task-row-meta">
                上次成功读取的角色：{roles.map((role) => role.title).join('、')}
                （仅供展示；当前读取失败，不能据此提交初始化表单）
              </p>
            )}
            {rolesStatus === 'forbidden' && (
              <p className="task-row-meta">
                角色接口返回 403：这是角色读取权限问题，不代表当前账号被判定为无初始化权限。
              </p>
            )}
            <button
              type="button"
              className="ghost"
              aria-label="重试读取角色信息"
              onClick={() => retry(['roles'])}
            >
              重试读取权限信息
            </button>
          </div>
        )}
        {(definitionsStatus === 'error' || definitionsStatus === 'forbidden') &&
          definitionError && (
            <div className="wm-init-context-error" role="group" aria-label="流程定义读取状态">
              <p className="error" role="alert">
                流程定义暂时无法读取
              </p>
              <p className="task-row-meta">{definitionError.detail}</p>
              {definitions && definitions.length > 0 && (
                <p className="task-row-meta">
                  上次成功读取的流程定义：
                  {definitions
                    .map(
                      (definition) =>
                        `${definition.title}（${definition.currentPublishedRevisionId ? '已发布' : '未发布'}）`,
                    )
                    .join('、')}
                  （仅供展示；当前读取失败，不能据此判断「未发布」或初始化）
                </p>
              )}
              {definitionsStatus === 'forbidden' && (
                <p className="task-row-meta">
                  流程定义接口返回 403：这是定义读取权限问题，不代表当前账号被判定为无初始化权限。
                </p>
              )}
              <button
                type="button"
                className="ghost"
                aria-label="重试读取流程定义"
                onClick={() => retry(['definitions'])}
              >
                重试读取权限信息
              </button>
            </div>
          )}
        {createFailure?.requestId && (
          <p className="task-row-meta">requestId：{createFailure.requestId}</p>
        )}
      </>
    );
  }

  /** 统一刷新入口：明确说明会同时刷新三类上下文。 */
  function initRefreshControl() {
    return (
      <>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            if (effectiveProjectId) void loadInitContext(effectiveProjectId);
          }}
        >
          刷新权限信息
        </button>
        <span className="task-row-meta">刷新会同时重新读取项目成员、角色与流程定义。</span>
      </>
    );
  }

  function initContextStatusLine() {
    return (
      <p className="task-row-meta">
        权限上下文：成员 {INIT_STATUS_LABELS[membersStatus]} · 角色{' '}
        {INIT_STATUS_LABELS[rolesStatus]} · 流程定义 {INIT_STATUS_LABELS[definitionsStatus]}
      </p>
    );
  }

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
          <div className="page-more" ref={moreRef}>
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
                  disabled={Boolean(selectedTask) && !canCopyClaim(selectedTask!)}
                  onClick={() => {
                    if (selectedTask) copyClaim(selectedTask);
                    else {
                      changeTab('tasks');
                      setNotice('请在任务列表选择要操作的任务，再复制该任务的领取命令。');
                    }
                    setMoreOpen(false);
                  }}
                >
                  <Terminal size={14} />
                  {selectedTask ? '复制所选任务领取命令' : '选择任务并复制命令'}
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
        collapsible
        nextAction={next?.title}
        actionLabel={next?.action?.label}
        onAction={next?.action?.run}
        actionUnavailableReason={next?.action ? null : (next?.text ?? null)}
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
          {initContextStatusLine()}
          {membersStatus === 'ready' && adminContacts.length > 0 ? (
            <div className="task-row-meta">
              <p>
                项目管理员：
                {adminContacts.map((contact) => `${contact.name}（${contact.email}）`).join('、')}
              </p>
              <div className="next-step-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    void copyText(
                      adminContacts.map((contact) => contact.email).join('; '),
                      '管理员联系方式',
                    )
                  }
                >
                  复制管理员联系方式
                </button>
                {adminContacts[0]?.email && (
                  <a className="ghost" href={`mailto:${adminContacts[0].email}`}>
                    邮件联系管理员
                  </a>
                )}
              </div>
            </div>
          ) : membersStatus === 'ready' ? (
            <p className="task-row-meta">当前无法读取管理员联系方式。</p>
          ) : null}
          {initContextAlerts()}
          <div className="next-step-actions">
            {initState.canInitialize && (
              <button className="primary" onClick={() => setInitOpen(true)}>
                {initState.kind === 'CREATE_FAILED' ? '重新初始化流程' : '初始化流程'}
              </button>
            )}
            {initState.linkToWorkflows && (
              <button className="ghost" onClick={() => navigate('/workflows')}>
                查看流程定义
              </button>
            )}
            {initRefreshControl()}
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
      <ol className="req-tabs" role="tablist" aria-label="需求详情" onKeyDown={onTabKeyDown}>
        {DETAIL_STAGES.map((item, index) => {
          const count = stageCountOf(
            item.key,
            detail,
            prdDocs.length,
            detail.trustChain?.timeline.length ?? trace.length,
          );
          const active = tab === item.key;
          return (
            <li key={item.key}>
              <button
                type="button"
                role="tab"
                id={`req-tab-${item.key}`}
                aria-selected={active}
                aria-controls="req-tabpanel"
                tabIndex={active ? 0 : -1}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
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
        <div
          className="req-main"
          role="tabpanel"
          id="req-tabpanel"
          aria-labelledby={`req-tab-${tab}`}
          tabIndex={0}
        >
          {tab === 'overview' && (
            <div className="detail-card">
              <RequirementTrustChain
                chain={detail.trustChain}
                onTask={focusTask}
                onTimeline={() => changeTab('trace')}
              />
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
                  {initContextStatusLine()}
                  {initContextAlerts()}
                  <div className="next-step-actions">
                    {initState.canInitialize && (
                      <button className="primary" onClick={() => setInitOpen(true)}>
                        {initState.kind === 'CREATE_FAILED' ? '重新初始化流程' : '初始化流程'}
                      </button>
                    )}
                    {initRefreshControl()}
                  </div>
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
                            role="group"
                            aria-labelledby={`${taskTitleDomId(task.id)} ${taskStateDomId(task.id)}`}
                            tabIndex={-1}
                          >
                            <div className="task-row-main">
                              <div className="task-row-top">
                                <strong id={taskTitleDomId(task.id)} title={task.stepKey}>
                                  {task.stepDisplayName?.trim() ||
                                    labelFor(STEP_LABELS, task.stepKey)}
                                </strong>
                                <span
                                  className={`status-tag is-${display.tone}`}
                                  id={taskStateDomId(task.id)}
                                >
                                  {display.label}
                                </span>
                                {task.review && (
                                  <span className="status-tag">
                                    {labelFor(REVIEW_STATUS_LABELS, task.review.status)}
                                  </span>
                                )}
                                {task.currentClaimId && <span className="status-tag">已认领</span>}
                              </div>
                              <div className="task-row-meta">
                                责任人 {task.responsibleUser.email} · 工件 {task.artifactCount} 件 ·
                                v{task.version}
                              </div>
                              <div className="task-row-meta wm-task-state-desc">
                                {display.description}
                              </div>
                              <details
                                className="wm-task-detail"
                                open={expandedTaskId === task.id}
                                onToggle={(event) => {
                                  if (!event.currentTarget.open && expandedTaskId === task.id)
                                    setExpandedTaskId(null);
                                  else if (event.currentTarget.open) setExpandedTaskId(task.id);
                                }}
                              >
                                <summary>查看任务状态与证据详情</summary>
                                <div className="task-row-meta">
                                  <p>当前状态：{display.label}</p>
                                  <p>
                                    任务 ID：{task.id} · v{task.version} · 工件 {task.artifactCount}{' '}
                                    件
                                  </p>
                                  {task.currentClaimId && (
                                    <p>已认领，claim {task.currentClaimId}</p>
                                  )}
                                  {task.review ? (
                                    <p>
                                      评审：{labelFor(REVIEW_STATUS_LABELS, task.review.status)}
                                      {task.review.decisions?.[0]
                                        ? ` · ${labelFor(
                                            DECISION_LABELS,
                                            task.review.decisions[0].decision,
                                          )}`
                                        : ''}
                                      {task.review.decisions?.[0]?.actor
                                        ? ` · ${task.review.decisions[0].actor.email}`
                                        : ''}
                                    </p>
                                  ) : (
                                    <p>当前没有关联评审。</p>
                                  )}
                                  <TaskRelations
                                    task={task}
                                    tasks={detail.tasks}
                                    graph={stepDepsByInstance[task.instanceId]}
                                    onFocus={focusTask}
                                  />
                                  {expandedTaskId === task.id && (
                                    <TaskInputStatusPanel key={task.id} taskId={task.id} />
                                  )}
                                </div>
                              </details>
                            </div>
                            <div className="task-row-actions">
                              <button
                                className="ghost"
                                onClick={() => {
                                  focusTask(task.id);
                                  void copyText(task.id, '任务 ID');
                                }}
                              >
                                <Copy size={14} />
                                复制任务 ID
                              </button>
                              <button
                                className="ghost"
                                disabled={readOnly || !canCopyClaim(task)}
                                onClick={() => {
                                  focusTask(task.id);
                                  copyClaim(task);
                                }}
                                title={
                                  task.claimEligibility?.canClaim === true
                                    ? '前置完成后可复制；实际领取仍由服务端复核，输入可用性在获取上下文时检查。'
                                    : '仅当前负责人且拥有活动角色时可领取；资格缺失时请刷新。'
                                }
                              >
                                <Terminal size={14} />
                                复制领取命令
                              </button>
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
                              <div className="task-row-meta cell-mono">
                                <FullValueDisclosure
                                  label="sha256"
                                  value={artifact.sha256}
                                  preview={shortDigest(artifact.sha256)}
                                />
                                {artifact.commitSha && (
                                  <>
                                    {' · '}
                                    <FullValueDisclosure
                                      label="commit"
                                      value={artifact.commitSha}
                                      preview={artifact.commitSha.slice(0, 8)}
                                    />
                                  </>
                                )}
                              </div>
                              {artifact.summary && (
                                <div className="task-row-meta">{artifact.summary}</div>
                              )}
                              {(artifact.storage === 'GIT_REF' || artifact.commitSha) &&
                                artifact.artifactSetId && (
                                  <LazyCodeEvidenceStatus artifactSetId={artifact.artifactSetId} />
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
                          <td>
                            {(review.taskId && review.stepDisplayName?.trim()) ||
                              review.subjectLabel}
                          </td>
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
                          修订 {item.revisions.length} 个 ·{' '}
                          <FullValueDisclosure
                            label="文档"
                            value={item.document.id}
                            preview={shortDigest(item.document.id)}
                          />
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

          {tab === 'trace' && detail.trustChain && (
            <RequirementTrustChain chain={detail.trustChain} mode="timeline" onTask={focusTask} />
          )}
          {tab === 'trace' && !detail.trustChain && (
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
          setCreateFailure(null);
          setNotice(message);
          void reloadDetail();
        }}
        onCreateFailed={(failure) => {
          // 弹窗内仍保留错误；详情页同时进入 CREATE_FAILED，关闭弹窗后不会回到“尚未创建”。
          setCreateFailure(failure);
        }}
      />

      <Modal
        open={editOpen}
        title="编辑需求"
        description={`${requirement.code} · v${requirement.version}`}
        variant="drawer"
        size="md"
        busy={editBusy}
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
