import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, formatApiError } from '../api/client';
import {
  repositoryApi,
  requirementApi,
  workflowApi,
  type MemberView,
  type ProjectRepositoryView,
  type RequirementView,
  type RoleView,
  type WorkflowDefinitionView,
  type WorkflowRevisionView,
  type WorkflowSlotDefinition,
  type WorkflowStepDefinition,
} from '../api/resources';
import {
  buildInstanceBindings,
  defaultAcceptanceOwners,
  isImplStep,
} from '../lib/workflowInstance';
import { STEP_LABELS } from '../lib/labels';
import { Modal } from './Modal';
import { InlineLoading, SkeletonLines } from './Skeleton';

interface WorkflowInstanceDialogProps {
  open: boolean;
  requirement: RequirementView | null;
  definitions: WorkflowDefinitionView[];
  roles: RoleView[];
  members: MemberView[];
  onClose: () => void;
  onCreated: (message: string) => void;
  /**
   * 初始化提交失败：详情页据此保持 CREATE_FAILED 状态（关闭弹窗后仍可见），
   * 同时保留可读错误与 requestId 供重试定位。
   */
  onCreateFailed?: (failure: { message: string; requestId?: string }) => void;
}

function isStep(value: unknown): value is WorkflowStepDefinition {
  if (!value || typeof value !== 'object') return false;
  const step = value as Record<string, unknown>;
  return typeof step.key === 'string' && typeof step.roleKey === 'string';
}

function isSlot(value: unknown): value is WorkflowSlotDefinition {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Record<string, unknown>;
  return typeof slot.key === 'string' && typeof slot.roleKey === 'string';
}

function readSteps(definition: Record<string, unknown>): WorkflowStepDefinition[] {
  return Array.isArray(definition.steps) ? definition.steps.filter(isStep) : [];
}

function readSlots(definition: Record<string, unknown>): WorkflowSlotDefinition[] {
  return Array.isArray(definition.roleSlots) ? definition.roleSlots.filter(isSlot) : [];
}

function stepDisplayLabel(step: WorkflowStepDefinition): string {
  const displayName = typeof step.displayName === 'string' ? step.displayName.trim() : '';
  return displayName || STEP_LABELS[step.key] || step.key;
}

/** 表单分组：顺序即页面上从上到下的阅读顺序。 */
type SectionKey = 'basics' | 'owners' | 'repo' | 'review' | 'publish';

const SECTION_TITLES: Record<SectionKey, string> = {
  basics: '基本信息',
  owners: '步骤责任人',
  repo: '仓库和代码来源',
  review: '评审与验收',
  publish: '发布配置',
};

/** 一条「为什么还不能提交」的缺项；与服务端的硬规则一一对应。 */
interface MissingItem {
  /** React 列表 key，同时用于区分同类缺项。 */
  id: string;
  /** 缺项摘要里展示的完整说明。 */
  text: string;
  /** 缺项所属分组：字段不在时回退到该分组。 */
  section: SectionKey;
  /** 需要聚焦的控件 id（ref 映射的 key）。 */
  targetId: string;
}

interface SelfReviewConflict {
  slotKey: string;
  stepKey: string;
  text: string;
}

/** 所有 DOM id 统一前缀，测试与 aria-describedby 都依赖这些稳定 id。 */
const ID_PREFIX = 'wf-instance';

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-');
}

const sectionHeadingId = (section: SectionKey) => `${ID_PREFIX}-heading-${section}`;
const stepFieldId = (key: string) => `${ID_PREFIX}-step-${safeId(key)}`;
const stepErrorId = (key: string) => `${ID_PREFIX}-error-step-${safeId(key)}`;
const slotFieldId = (key: string) => `${ID_PREFIX}-slot-${safeId(key)}`;
const slotErrorId = (key: string) => `${ID_PREFIX}-error-slot-${safeId(key)}`;
const slotConflictId = (key: string) => `${ID_PREFIX}-conflict-slot-${safeId(key)}`;
const acceptanceFieldId = (key: string) => `${ID_PREFIX}-acceptance-${safeId(key)}`;
const acceptanceErrorId = (key: string) => `${ID_PREFIX}-error-acceptance-${safeId(key)}`;
const repoStepFieldId = (key: string) => `${ID_PREFIX}-repo-${safeId(key)}`;
const repoStepErrorId = (key: string) => `${ID_PREFIX}-error-repo-${safeId(key)}`;
const repoOwnerFieldId = `${ID_PREFIX}-repo-owner`;
const repoEmptyErrorId = `${ID_PREFIX}-error-repo-empty`;
const flowSelectId = `${ID_PREFIX}-flow`;
const readinessId = `${ID_PREFIX}-readiness`;

/**
 * 服务端拒绝原因 → 最可能出问题的分组（轻量映射，不替代真实错误文本）。
 * 顺序有讲究：`自审` 比 `审批` 更具体，`仓库` 比 `验收` 更具体。
 */
function mapErrorToSection(message: string): SectionKey | null {
  if (/自审/.test(message)) return 'review';
  if (/仓库/.test(message)) return 'repo';
  if (/验收/.test(message)) return 'review';
  if (/责任人/.test(message)) return 'owners';
  if (/步骤/.test(message)) return 'owners';
  if (/审批/.test(message)) return 'review';
  return null;
}

/**
 * 管理员初始化流程实例：责任人、审批人、代码仓库与验收归属都必须逐项显式选择。
 * 同角色的审批槽审批人不得与步骤责任人相同，避免把“作者自审”做成默认值。
 *
 * 这里的四类输入与服务端的四条硬规则一一对应：
 * - 步骤责任人 → 任务的责任人（人，不是角色）；
 * - IMPL 步骤的仓库 → 交付的 GIT_REF 必须落在已登记仓库里；
 * - 验收条目归属 → PRD 的每条验收至少被一个任务覆盖；
 * - 审批槽审批人 → 不能是该步骤责任人。
 *
 * 长表单改造要点：顶部先给「准备度 + 缺项摘要」，每条缺项可点击跳到对应控件；
 * 字段错误同时有 aria-invalid / aria-describedby 与可见文字，不只用颜色；
 * 提交失败保留全部已填内容，错误原文 + 重试都留在弹窗里。
 */
export function WorkflowInstanceDialog({
  open,
  requirement,
  definitions,
  roles,
  members,
  onClose,
  onCreated,
  onCreateFailed,
}: WorkflowInstanceDialogProps) {
  const [revisionId, setRevisionId] = useState('');
  const [revision, setRevision] = useState<WorkflowRevisionView | null>(null);
  const [steps, setSteps] = useState<WorkflowStepDefinition[]>([]);
  const [slots, setSlots] = useState<WorkflowSlotDefinition[]>([]);
  const [stepUsers, setStepUsers] = useState<Record<string, string>>({});
  const [slotUsers, setSlotUsers] = useState<Record<string, string>>({});
  const [repositories, setRepositories] = useState<ProjectRepositoryView[]>([]);
  const [repoSelect, setRepoSelect] = useState<Record<string, string[]>>({});
  const [acceptanceKeys, setAcceptanceKeys] = useState<string[]>([]);
  const [acceptanceOwners, setAcceptanceOwners] = useState<Record<string, string>>({});
  const [repoForm, setRepoForm] = useState({
    owner: '',
    name: '',
    externalId: '',
    defaultBranch: 'main',
  });
  const [repoError, setRepoError] = useState('');
  /** 流程定义加载 / 校验失败（读不到修订、没有步骤）。 */
  const [error, setError] = useState('');
  /** 提交失败：与加载错误分开保存，失败后不清空任何输入。 */
  const [submitError, setSubmitError] = useState('');
  const [submitErrorSection, setSubmitErrorSection] = useState<SectionKey | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * 仓库与验收依据（需求详情）的加载进度：首次打开必须等它们读完再渲染表单，
   * 否则会先闪一个「项目还没有登记代码仓库」的空表单，用户可能据此重复登记仓库。
   * 重新打开同一需求时键相同，直接复用已加载数据，不再用加载态盖住表单。
   */
  const requirementId = requirement?.id ?? '';
  const requirementProjectId = requirement?.projectId ?? '';
  const contextKey = requirementId ? `${requirementId}:${requirementProjectId}` : '';
  const [contextLoadedKey, setContextLoadedKey] = useState('');
  const contextLoading = Boolean(requirement) && contextLoadedKey !== contextKey;

  /** 表单控件与分组节点的 ref 映射：缺项跳转时据此滚动 + 聚焦。 */
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const sectionRefs = useRef<Partial<Record<SectionKey, HTMLElement | null>>>({});
  /** 表单初始化只针对「需求 + 已发布修订」组合；同一组合重新打开时保留已填内容。 */
  const resetKeyRef = useRef('');
  /** 已加载过的流程修订；重新打开同一修订时不再清空表单。 */
  const loadedRevisionRef = useRef('');

  const published = definitions.filter((definition) => definition.currentPublishedRevisionId);
  const implSteps = useMemo(() => steps.filter(isImplStep), [steps]);

  useEffect(() => {
    if (!open || !requirement) return;
    const publishedKey = published
      .map((definition) => definition.currentPublishedRevisionId ?? '')
      .join(',');
    const resetKey = `${requirement.id}:${requirement.version}:${publishedKey}`;
    // 失败后关闭再打开：同一需求/修订保留已填内容，便于直接重试。
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    loadedRevisionRef.current = '';
    const first = published[0]?.currentPublishedRevisionId ?? '';
    setRevisionId(first);
    setRevision(null);
    setSteps([]);
    setSlots([]);
    setStepUsers({});
    setSlotUsers({});
    setRepositories([]);
    setRepoSelect({});
    setAcceptanceKeys([]);
    setAcceptanceOwners({});
    setRepoForm({ owner: '', name: '', externalId: '', defaultBranch: 'main' });
    setRepoError('');
    setError('');
    setSubmitError('');
    setSubmitErrorSection(null);
    // `published` 由父级 definitions 派生；打开时取第一个已发布修订即可。
  }, [open, requirement?.id, requirement?.version, definitions]);

  // 仓库范围与验收条目来自项目与需求本身，与流程修订无关，打开时各取一次。
  // 两个请求互不阻塞：仓库取不到只影响 IMPL 步骤，验收取不到就当没有 PRD。
  useEffect(() => {
    if (!open || !requirementId) return;
    let alive = true;
    setRepoError('');
    Promise.allSettled([
      repositoryApi.list(requirementProjectId),
      requirementApi.detail(requirementProjectId, requirementId),
    ]).then(([repoResult, detailResult]) => {
      if (!alive) return;
      if (repoResult.status === 'fulfilled') setRepositories(repoResult.value);
      else setRepoError(formatApiError(repoResult.reason));
      if (detailResult.status === 'fulfilled')
        setAcceptanceKeys(detailResult.value.acceptanceKeys ?? []);
      else setAcceptanceKeys([]);
      // 无论成功失败都结束加载：失败状态由 repoError / 空验收兜底，不能一直停在加载态。
      setContextLoadedKey(`${requirementId}:${requirementProjectId}`);
    });
    return () => {
      alive = false;
    };
  }, [open, requirementId, requirementProjectId]);

  useEffect(() => {
    // 关闭弹窗时保留 revision 与已填内容，便于失败后直接重试。
    if (!open) return;
    if (!revisionId) {
      setRevision(null);
      return;
    }
    // 重新打开同一修订（例如失败后重试）：保留已填内容，不重新拉取并清空表单。
    if (loadedRevisionRef.current === revisionId) return;
    loadedRevisionRef.current = revisionId;
    let alive = true;
    setRevision(null);
    setSteps([]);
    setSlots([]);
    setStepUsers({});
    setSlotUsers({});
    setRepoSelect({});
    setAcceptanceOwners({});
    setError('');
    setSubmitError('');
    setSubmitErrorSection(null);
    workflowApi
      .revision(revisionId)
      .then((value) => {
        if (!alive) return;
        const nextSteps = readSteps(value.definition);
        const nextSlots = readSlots(value.definition);
        setRevision(value);
        setSteps(nextSteps);
        setSlots(nextSlots);
        if (nextSteps.length === 0) setError('该流程定义没有步骤，无法创建实例。');
      })
      .catch((caught: unknown) => {
        if (alive) setError(formatApiError(caught));
      });
    return () => {
      alive = false;
    };
  }, [open, revisionId]);

  // 默认值只补空位：项目只有一个仓库时自动勾上，验收默认归到验证步骤。
  useEffect(() => {
    if (!revision) return;
    setRepoSelect((current) => {
      const only = repositories.length === 1 ? repositories[0].id : null;
      let changed = false;
      const next = { ...current };
      for (const step of steps) {
        if (!isImplStep(step)) continue;
        if ((next[step.key] ?? []).length > 0) continue;
        if (!only) continue;
        next[step.key] = [only];
        changed = true;
      }
      return changed ? next : current;
    });
    setAcceptanceOwners((current) => {
      const defaults = defaultAcceptanceOwners(acceptanceKeys, steps);
      let changed = false;
      const next = { ...current };
      for (const [key, owner] of Object.entries(defaults)) {
        if (next[key]) continue;
        next[key] = owner;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [revision, repositories, steps, acceptanceKeys]);

  const roleTitle = useMemo(() => {
    const byKey = new Map(roles.map((role) => [role.key, role.title]));
    return (roleKey: string) => byKey.get(roleKey) ?? roleKey;
  }, [roles]);

  const conflicts = useMemo<SelfReviewConflict[]>(() => {
    const items: SelfReviewConflict[] = [];
    for (const slot of slots) {
      const approver = slotUsers[slot.key];
      if (!approver) continue;
      for (const step of steps) {
        if (step.roleKey !== slot.roleKey) continue;
        if (stepUsers[step.key] === approver) {
          items.push({
            slotKey: slot.key,
            stepKey: step.key,
            text: `「${slot.key}」审批人与「${step.key}」责任人是同一人`,
          });
        }
      }
    }
    return items;
  }, [slots, steps, slotUsers, stepUsers]);

  /**
   * 缺项清单是页面唯一的「还差什么」真相：
   * 步骤责任人 / 审批人 / IMPL 仓库 / 验收归属各算一项，自审冲突也单独计入。
   * 项目完全没有登记仓库时，用一个「先登记仓库」的条目替代逐个 IMPL 步骤的仓库缺项。
   */
  const missingItems = useMemo<MissingItem[]>(() => {
    const items: MissingItem[] = [];
    for (const step of steps) {
      if (stepUsers[step.key]) continue;
      items.push({
        id: `step-owner:${step.key}`,
        text: `步骤 ${step.key}（${roleTitle(step.roleKey)}）责任人未选择`,
        section: 'owners',
        targetId: stepFieldId(step.key),
      });
    }
    for (const slot of slots) {
      if (slotUsers[slot.key]) continue;
      items.push({
        id: `slot-approver:${slot.key}`,
        text: `审批槽 ${slot.key}（${roleTitle(slot.roleKey)}）审批人未选择`,
        section: 'review',
        targetId: slotFieldId(slot.key),
      });
    }
    if (implSteps.length > 0) {
      if (repositories.length === 0) {
        items.push({
          id: 'repo-empty',
          text: '项目还没有登记代码仓库',
          section: 'repo',
          targetId: repoOwnerFieldId,
        });
      } else {
        for (const step of implSteps) {
          if ((repoSelect[step.key] ?? []).length > 0) continue;
          items.push({
            id: `repo:${step.key}`,
            text: `步骤 ${step.key} 未选择代码仓库`,
            section: 'repo',
            targetId: repoStepFieldId(step.key),
          });
        }
      }
    }
    for (const key of acceptanceKeys) {
      if (acceptanceOwners[key]) continue;
      items.push({
        id: `acceptance:${key}`,
        text: `验收条目 ${key} 未指定归属步骤`,
        section: 'review',
        targetId: acceptanceFieldId(key),
      });
    }
    for (const conflict of conflicts) {
      items.push({
        id: `conflict:${conflict.slotKey}:${conflict.stepKey}`,
        text: conflict.text,
        section: 'review',
        targetId: slotFieldId(conflict.slotKey),
      });
    }
    return items;
  }, [
    steps,
    slots,
    stepUsers,
    slotUsers,
    implSteps,
    repositories,
    repoSelect,
    acceptanceKeys,
    acceptanceOwners,
    conflicts,
    roleTitle,
  ]);

  // Y 的口径与服务端硬规则一致：每个步骤 / 审批槽 / IMPL 仓库 / 验收条目各一项，
  // 自审冲突作为「已完成的检查项被打破」计入总数，X 始终等于通过项数。
  const repoRequirementCount =
    implSteps.length > 0 ? (repositories.length === 0 ? 1 : implSteps.length) : 0;
  const requiredCount =
    steps.length + slots.length + repoRequirementCount + acceptanceKeys.length + conflicts.length;
  const missingCount = missingItems.length;
  const completedCount = Math.max(0, requiredCount - missingCount);
  const ready = requiredCount > 0 && missingCount === 0;

  const canSubmit = Boolean(
    requirement && revision && !busy && !contextLoading && missingCount === 0 && steps.length > 0,
  );

  /** footer 的禁用原因：只说差多少，不重复缺项原文（长表单里已经列过一次）。 */
  const disabledReason = useMemo(() => {
    if (busy) return '';
    if (!revision) return '正在读取流程定义，读完才能提交。';
    if (contextLoading) return '正在读取项目仓库与验收依据，读完才能提交。';
    if (steps.length === 0) return '该流程定义没有步骤，无法创建实例。';
    if (!requirement) return '还没有选择需求。';
    if (missingCount === 0) return '';
    const conflictCount = conflicts.length;
    const otherCount = Math.max(0, missingCount - conflictCount);
    // 只报分组，不重复缺项原文：缺项摘要（包括 Requirements 页的既有断言）已经逐条列过一次。
    const groups = [
      ...new Set(
        missingItems
          .filter((item) => !item.id.startsWith('conflict:'))
          .map((item) => SECTION_TITLES[item.section]),
      ),
    ];
    const parts: string[] = [];
    if (otherCount > 0)
      parts.push(
        `还有 ${otherCount} 项未完成${groups.length > 0 ? `（${groups.join('、')}）` : ''}`,
      );
    if (conflictCount > 0) parts.push(`存在 ${conflictCount} 处自审冲突`);
    return `还不能提交：${parts.join('；')}`;
  }, [
    busy,
    revision,
    contextLoading,
    steps.length,
    requirement,
    missingItems,
    missingCount,
    conflicts.length,
  ]);

  /** 流程定义相关区段在未读完 / 读失败时的统一说明，避免一直显示“正在读取”。 */
  const revisionNote = error ? '流程定义读取失败，无法继续。' : '正在读取流程定义…';

  function registerField(targetId: string) {
    return (element: HTMLElement | null) => {
      if (element) fieldRefs.current[targetId] = element;
      else delete fieldRefs.current[targetId];
    };
  }

  function registerSection(section: SectionKey) {
    return (element: HTMLElement | null) => {
      if (element) sectionRefs.current[section] = element;
      else delete sectionRefs.current[section];
    };
  }

  /** 滚动到目标并聚焦；jsdom 没有实现 scrollIntoView，做一次可选调用。 */
  function revealAndFocus(element: HTMLElement | null | undefined) {
    if (!element) return;
    try {
      element.scrollIntoView?.({ block: 'center' });
    } catch {
      // 测试环境（jsdom）没有布局实现，忽略滚动，聚焦仍然有效。
    }
    element.focus();
  }

  function jumpToMissing(item: MissingItem) {
    revealAndFocus(fieldRefs.current[item.targetId] ?? sectionRefs.current[item.section]);
  }

  function focusSection(section: SectionKey) {
    revealAndFocus(sectionRefs.current[section]);
  }

  function toggleRepo(stepKey: string, repositoryId: string, checked: boolean) {
    setRepoSelect((current) => {
      const chosen = new Set(current[stepKey] ?? []);
      if (checked) chosen.add(repositoryId);
      else chosen.delete(repositoryId);
      return { ...current, [stepKey]: [...chosen] };
    });
  }

  async function registerRepository() {
    if (!requirement) return;
    // T2 之后仓库登记必须走 /workspace 的声明 + 票据流程；
    // 此旧弹窗不再直接写 provider externalId，也不再做 owner/name 兜底。
    setRepoError('请先在“接入与工作区”声明仓库，再重新打开此对话框。');
  }

  async function submit() {
    if (!requirement || !revisionId || busy) return;
    setBusy(true);
    setError('');
    setSubmitError('');
    setSubmitErrorSection(null);
    try {
      const { stepBindings, roleSlotBindings } = buildInstanceBindings({
        steps,
        slots,
        roles,
        stepUsers,
        slotUsers,
        repositories: repoSelect,
        acceptanceKeys,
        acceptanceOwners,
      });
      await workflowApi.createInstance(requirement.id, {
        definitionRevisionId: revisionId,
        expectedRequirementVersion: requirement.version,
        stepBindings,
        roleSlotBindings,
      });
      onCreated(`需求 ${requirement.code} 的流程实例已创建。`);
    } catch (caught) {
      const message = formatApiError(caught);
      setSubmitError(message);
      setSubmitErrorSection(mapErrorToSection(message));
      onCreateFailed?.({
        message,
        requestId: caught instanceof ApiError ? caught.requestId : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="初始化流程实例"
      description={requirement ? `${requirement.code} · ${requirement.title}` : ''}
      size="lg"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {!canSubmit && disabledReason && (
            <p className="modal-foot-note wm-wf-footer-reason" aria-live="polite">
              {disabledReason}
            </p>
          )}
          <button className="ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="primary" onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? '提交中…' : '确认创建'}
          </button>
        </>
      }
    >
      {published.length === 0 ? (
        <section
          className="wm-wf-section"
          aria-labelledby={sectionHeadingId('basics')}
          ref={registerSection('basics')}
          tabIndex={-1}
        >
          <h3 className="wm-wf-section__title" id={sectionHeadingId('basics')}>
            基本信息
          </h3>
          <p className="modal-note">
            该项目还没有已发布的流程定义。先到「流程」页发布，再回来初始化实例。
          </p>
        </section>
      ) : !error && (!revision || contextLoading) ? (
        /* 流程定义 / 仓库 / 验收依据任一未读完：整段正文先给 loading，不渲染半成品表单。 */
        <div>
          <InlineLoading label={!revision ? '正在读取流程定义…' : '正在读取项目仓库与验收依据…'} />
          <SkeletonLines lines={revision ? 3 : 4} />
        </div>
      ) : (
        <div className="wm-wf">
          {revision && steps.length > 0 ? (
            <section className="wm-wf-readiness" aria-labelledby={readinessId}>
              <div className="wm-wf-readiness__head">
                <p className="wm-wf-readiness__progress" id={readinessId}>
                  初始化准备度：已完成 {completedCount} / {requiredCount} 项
                </p>
                <span className={`wm-wf-readiness__badge ${ready ? 'is-ready' : 'is-incomplete'}`}>
                  {ready ? `已完成全部 ${requiredCount} 项` : `缺项 ${missingCount} 项`}
                </span>
              </div>
              <p className="wm-wf-readiness__status">
                {ready
                  ? '可以提交：全部必填项已完成，创建后任务会按这里的绑定派生。'
                  : '还不能提交：请按下方缺项逐项补齐，标有「建议先处理」的条目建议优先处理。'}
              </p>
              {missingCount > 0 && (
                <div className="wm-wf-missing">
                  <h4 className="wm-wf-missing__title">缺项摘要（{missingCount} 项）</h4>
                  <ul className="wm-wf-missing__list">
                    {missingItems.map((item, index) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="wm-wf-missing__item"
                          onClick={() => jumpToMissing(item)}
                        >
                          <span className="wm-wf-missing__icon" aria-hidden="true">
                            ⚠
                          </span>
                          <span className="wm-wf-missing__text">{item.text}</span>
                          {index === 0 && <span className="wm-wf-missing__first">建议先处理</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ) : !revision ? (
            <p className="modal-note" aria-live="polite">
              {revisionNote}
            </p>
          ) : null}

          {/* 提交失败必须保留表单：错误原文 + requestId（formatApiError 已带）+ 重试。 */}
          {submitError && (
            <div className="wm-wf-alert" role="alert">
              <p className="wm-wf-alert__title">⚠ 创建流程实例失败</p>
              <p className="wm-wf-alert__message">{submitError}</p>
              {submitErrorSection && (
                <p className="wm-wf-alert__hint">
                  可能与该分组配置有关：
                  <button
                    type="button"
                    className="wm-wf-link"
                    onClick={() => focusSection(submitErrorSection)}
                  >
                    跳到「{SECTION_TITLES[submitErrorSection]}」
                  </button>
                </p>
              )}
              <p className="wm-wf-alert__note">
                已填写的责任人与审批人不会清空，修正后可直接重试。
              </p>
              <div className="wm-wf-alert__actions">
                <button
                  type="button"
                  className="wm-wf-button"
                  onClick={() => void submit()}
                  disabled={busy}
                >
                  {busy ? '提交中…' : '重试提交'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="modal-error wm-wf-load-error" role="alert">
              {error}
            </p>
          )}

          <section
            className="wm-wf-section"
            aria-labelledby={sectionHeadingId('basics')}
            ref={registerSection('basics')}
            tabIndex={-1}
          >
            <h3 className="wm-wf-section__title" id={sectionHeadingId('basics')}>
              基本信息
            </h3>
            <div className="wm-wf-field">
              <label className="wm-wf-field__label" htmlFor={flowSelectId}>
                已发布流程
              </label>
              <select
                id={flowSelectId}
                className="select"
                aria-label="已发布流程"
                value={revisionId}
                onChange={(event) => setRevisionId(event.target.value)}
              >
                {published.map((definition) => (
                  <option
                    key={definition.workflowKey}
                    value={definition.currentPublishedRevisionId ?? ''}
                  >
                    {definition.title}（{definition.workflowKey} · 第 {definition.currentRevision}{' '}
                    版）
                  </option>
                ))}
              </select>
              <p className="wm-wf-field__hint">
                切换流程修订会清空下面已选择的责任人、审批人和仓库绑定。
              </p>
            </div>
          </section>

          <section
            className="wm-wf-section"
            aria-labelledby={sectionHeadingId('owners')}
            ref={registerSection('owners')}
            tabIndex={-1}
          >
            <h3 className="wm-wf-section__title" id={sectionHeadingId('owners')}>
              步骤责任人
            </h3>
            {revision && steps.length > 0 ? (
              <div className="table-scroll">
                <table className="data-table">
                  <caption className="wm-wf-table-caption">
                    每个步骤都必须明确到一名成员，不能留空。
                  </caption>
                  <thead>
                    <tr>
                      <th>步骤</th>
                      <th>角色</th>
                      <th>责任人</th>
                    </tr>
                  </thead>
                  <tbody>
                    {steps.map((step) => {
                      const ownerMissing = !stepUsers[step.key];
                      return (
                        <tr key={step.key}>
                          <td>
                            <div>{stepDisplayLabel(step)}</div>
                            <small className="cell-mono">
                              key: <code>{step.key}</code>
                            </small>
                          </td>
                          <td>{roleTitle(step.roleKey)}</td>
                          <td>
                            <select
                              id={stepFieldId(step.key)}
                              ref={registerField(stepFieldId(step.key))}
                              className="select"
                              aria-label={`步骤 ${step.key} 责任人`}
                              aria-invalid={ownerMissing ? 'true' : undefined}
                              aria-describedby={ownerMissing ? stepErrorId(step.key) : undefined}
                              value={stepUsers[step.key] ?? ''}
                              onChange={(event) =>
                                setStepUsers((current) => ({
                                  ...current,
                                  [step.key]: event.target.value,
                                }))
                              }
                            >
                              <option value="">选择责任人</option>
                              {members.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.name || member.email}
                                </option>
                              ))}
                            </select>
                            {ownerMissing && (
                              <p className="wm-wf-field-error" id={stepErrorId(step.key)}>
                                ⚠ 未选择责任人：请为步骤 {step.key}（{roleTitle(step.roleKey)}）
                                指定一名成员
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="wm-wf-section__note">
                {revision ? '没有可绑定的步骤。' : revisionNote}
              </p>
            )}
          </section>

          <section
            className="wm-wf-section"
            aria-labelledby={sectionHeadingId('repo')}
            ref={registerSection('repo')}
            tabIndex={-1}
          >
            <h3 className="wm-wf-section__title" id={sectionHeadingId('repo')}>
              仓库和代码来源
            </h3>
            {!revision ? (
              <p className="wm-wf-section__note">{revisionNote}</p>
            ) : implSteps.length === 0 ? (
              <p className="wm-wf-section__note">
                当前流程没有需要代码仓库的 IMPL 步骤，不需要选择仓库。
              </p>
            ) : repositories.length === 0 ? (
              <div className="wm-wf-repo-empty">
                <p className="wm-wf-section__note">
                  这个项目还没有可用的代码仓库。IMPL
                  步骤交付的提交必须落回已登记的仓库，先登记一个：
                </p>
                <div className="form-grid">
                  <div className="field">
                    <label className="wm-wf-field__label" htmlFor={repoOwnerFieldId}>
                      仓库 owner
                    </label>
                    <input
                      id={repoOwnerFieldId}
                      ref={registerField(repoOwnerFieldId)}
                      aria-label="仓库 owner"
                      aria-invalid="true"
                      aria-describedby={repoEmptyErrorId}
                      value={repoForm.owner}
                      placeholder="输入 locator 后到“接入与工作区”声明"
                      onChange={(event) =>
                        setRepoForm((current) => ({ ...current, owner: event.target.value }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="wm-wf-field__label" htmlFor={`${ID_PREFIX}-repo-name`}>
                      仓库 name
                    </label>
                    <input
                      id={`${ID_PREFIX}-repo-name`}
                      aria-label="仓库 name"
                      aria-invalid="true"
                      aria-describedby={repoEmptyErrorId}
                      value={repoForm.name}
                      placeholder="仓库 name（仅展示）"
                      onChange={(event) =>
                        setRepoForm((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="wm-wf-field__label" htmlFor={`${ID_PREFIX}-repo-branch`}>
                      默认分支
                    </label>
                    <input
                      id={`${ID_PREFIX}-repo-branch`}
                      aria-label="默认分支"
                      value={repoForm.defaultBranch}
                      onChange={(event) =>
                        setRepoForm((current) => ({
                          ...current,
                          defaultBranch: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="wm-wf-field__label" htmlFor={`${ID_PREFIX}-repo-external`}>
                      GitHub 仓库 ID（可留空）
                    </label>
                    <input
                      id={`${ID_PREFIX}-repo-external`}
                      aria-label="GitHub 仓库 ID"
                      value={repoForm.externalId}
                      placeholder="provider 外部 ID（登记已迁移到接入与工作区）"
                      onChange={(event) =>
                        setRepoForm((current) => ({
                          ...current,
                          externalId: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <p className="wm-wf-field-error" id={repoEmptyErrorId}>
                  ⚠ 需要先登记代码仓库：IMPL 步骤必须声明仓库范围，登记后会自动带入所有 IMPL 步骤。
                </p>
                <button className="ghost" onClick={() => void registerRepository()}>
                  登记仓库
                </button>
                {repoError && (
                  <p className="modal-error" role="alert">
                    {repoError}
                  </p>
                )}
              </div>
            ) : (
              <div className="form-grid">
                {implSteps.map((step) => {
                  const chosen = repoSelect[step.key] ?? [];
                  const repoMissing = chosen.length === 0;
                  return (
                    <fieldset
                      key={step.key}
                      className="wm-wf-repo-group"
                      aria-describedby={repoMissing ? repoStepErrorId(step.key) : undefined}
                    >
                      <legend className="wm-wf-repo-group__legend">
                        <div>{stepDisplayLabel(step)}</div>
                        <small className="cell-mono">
                          key: <code>{step.key}</code>
                        </small>
                      </legend>
                      <div className="role-chips">
                        {repositories.map((repository, index) => {
                          const isChosen = chosen.includes(repository.id);
                          return (
                            <label
                              key={repository.id}
                              className={`chip${isChosen ? ' is-active' : ''}`}
                            >
                              <input
                                type="checkbox"
                                ref={
                                  index === 0 ? registerField(repoStepFieldId(step.key)) : undefined
                                }
                                aria-label={`步骤 ${step.key} 仓库 ${repository.owner}/${repository.name}`}
                                aria-invalid={repoMissing ? 'true' : undefined}
                                aria-describedby={
                                  repoMissing ? repoStepErrorId(step.key) : undefined
                                }
                                checked={isChosen}
                                onChange={(event) =>
                                  toggleRepo(step.key, repository.id, event.target.checked)
                                }
                              />
                              {repository.owner}/{repository.name}
                            </label>
                          );
                        })}
                      </div>
                      {repoMissing && (
                        <p className="wm-wf-field-error" id={repoStepErrorId(step.key)}>
                          ⚠ 未选择代码仓库：步骤 {step.key} 要交付代码，至少选择一个已登记仓库
                        </p>
                      )}
                    </fieldset>
                  );
                })}
              </div>
            )}
            {revision && implSteps.length > 0 && repositories.length > 0 && (
              <p className="wm-wf-section__note">
                仓库来自「项目设置」里已登记的代码仓库；GIT_REF 工件只能引用这里的仓库。
              </p>
            )}
          </section>

          <section
            className="wm-wf-section"
            aria-labelledby={sectionHeadingId('review')}
            ref={registerSection('review')}
            tabIndex={-1}
          >
            <h3 className="wm-wf-section__title" id={sectionHeadingId('review')}>
              评审与验收
            </h3>

            {conflicts.length > 0 && (
              <p className="wm-wf-conflict" role="alert">
                不能自审：
                {conflicts
                  .map(
                    (conflict) =>
                      `审批槽「${conflict.slotKey}」的审批人不能与步骤「${conflict.stepKey}」的责任人相同`,
                  )
                  .join('；')}
                ，请更换审批人。
              </p>
            )}

            <h4 className="wm-wf-subsection__title">审批槽审批人</h4>
            {!revision ? (
              <p className="wm-wf-section__note">{revisionNote}</p>
            ) : slots.length > 0 ? (
              <div className="table-scroll">
                <table className="data-table">
                  <caption className="wm-wf-table-caption">
                    每审批槽都必须明确到一名成员，且不能与同角色步骤的责任人相同。
                  </caption>
                  <thead>
                    <tr>
                      <th>审批槽</th>
                      <th>角色</th>
                      <th>审批人</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map((slot) => {
                      const approverMissing = !slotUsers[slot.key];
                      const slotConflicts = conflicts.filter(
                        (conflict) => conflict.slotKey === slot.key,
                      );
                      const describedBy = [
                        approverMissing ? slotErrorId(slot.key) : '',
                        slotConflicts.length > 0 ? slotConflictId(slot.key) : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <tr key={slot.key}>
                          <td>
                            <span className="cell-mono">{slot.key}</span>
                          </td>
                          <td>{roleTitle(slot.roleKey)}</td>
                          <td>
                            <select
                              id={slotFieldId(slot.key)}
                              ref={registerField(slotFieldId(slot.key))}
                              className="select"
                              aria-label={`审批槽 ${slot.key} 审批人`}
                              aria-invalid={
                                approverMissing || slotConflicts.length > 0 ? 'true' : undefined
                              }
                              aria-describedby={describedBy || undefined}
                              value={slotUsers[slot.key] ?? ''}
                              onChange={(event) =>
                                setSlotUsers((current) => ({
                                  ...current,
                                  [slot.key]: event.target.value,
                                }))
                              }
                            >
                              <option value="">选择审批人</option>
                              {members.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.name || member.email}
                                </option>
                              ))}
                            </select>
                            {approverMissing && (
                              <p className="wm-wf-field-error" id={slotErrorId(slot.key)}>
                                ⚠ 未选择审批人：审批槽 {slot.key}（{roleTitle(slot.roleKey)}）
                                需要指定一名成员
                              </p>
                            )}
                            {slotConflicts.length > 0 && (
                              <p
                                className="wm-wf-field-error wm-wf-field-error--conflict"
                                id={slotConflictId(slot.key)}
                              >
                                ⚠ 自审冲突：不能与步骤「
                                {slotConflicts.map((conflict) => conflict.stepKey).join('、')}
                                」的责任人是同一人
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="wm-wf-section__note">当前流程没有审批槽，无需指派审批人。</p>
            )}

            <h4 className="wm-wf-subsection__title">验收条目归属</h4>
            {!revision ? (
              <p className="wm-wf-section__note">{revisionNote}</p>
            ) : acceptanceKeys.length > 0 ? (
              <div className="table-scroll">
                <table className="data-table">
                  <caption className="wm-wf-table-caption">
                    每条验收至少由一个任务覆盖，默认归到验证步骤，可按需调整。
                  </caption>
                  <thead>
                    <tr>
                      <th>验收 key</th>
                      <th>由哪个任务负责</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acceptanceKeys.map((key) => {
                      const ownerMissing = !acceptanceOwners[key];
                      return (
                        <tr key={key}>
                          <td>
                            <span className="cell-mono">{key}</span>
                          </td>
                          <td>
                            <select
                              id={acceptanceFieldId(key)}
                              ref={registerField(acceptanceFieldId(key))}
                              className="select"
                              aria-label={`验收 ${key} 归属步骤`}
                              aria-invalid={ownerMissing ? 'true' : undefined}
                              aria-describedby={ownerMissing ? acceptanceErrorId(key) : undefined}
                              value={acceptanceOwners[key] ?? ''}
                              onChange={(event) =>
                                setAcceptanceOwners((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                }))
                              }
                            >
                              <option value="">选择步骤</option>
                              {steps.map((step) => (
                                <option key={step.key} value={step.key}>
                                  {stepDisplayLabel(step)}（{step.key} · {roleTitle(step.roleKey)}）
                                </option>
                              ))}
                            </select>
                            {ownerMissing && (
                              <p className="wm-wf-field-error" id={acceptanceErrorId(key)}>
                                ⚠ 未指定归属步骤：验收条目 {key} 必须由至少一个步骤覆盖
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="wm-wf-section__note">该需求没有需要归属的验收条目。</p>
            )}

            <p className="wm-wf-section__note">
              责任人与审批人必须逐项选择；同角色的审批槽审批人不能与步骤责任人相同，否则会被判定为自审。
            </p>
          </section>

          <section
            className="wm-wf-section"
            aria-labelledby={sectionHeadingId('publish')}
            ref={registerSection('publish')}
            tabIndex={-1}
          >
            <h3 className="wm-wf-section__title" id={sectionHeadingId('publish')}>
              发布配置
            </h3>
            <dl className="wm-wf-publish">
              <div className="wm-wf-publish__row">
                <dt>当前流程 key</dt>
                <dd>{revision?.workflowKey ?? '—'}</dd>
              </div>
              <div className="wm-wf-publish__row">
                <dt>修订号</dt>
                <dd>{revision ? `第 ${revision.revision} 版` : '—'}</dd>
              </div>
              <div className="wm-wf-publish__row">
                <dt>definitionDigest</dt>
                <dd className="wm-wf-mono">{revision ? revision.digest.slice(0, 12) : '—'}</dd>
              </div>
            </dl>
            <p className="wm-wf-section__note">
              流程定义在「流程」页发布；这里只创建执行实例，不修改流程定义。
            </p>
          </section>
        </div>
      )}
    </Modal>
  );
}
