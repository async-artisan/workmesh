import { buildStandardWorkflowTemplate } from '@workmesh/shared';
import { ApiError, formatApiError } from '../api/client';
import {
  boardApi,
  documentApi,
  knowledgeBindingApi,
  projectApi,
  workflowApi,
  workspaceApi,
  type DocumentDetail,
  type KnowledgeBindingsView,
  type MemberView,
  type RoleView,
  type WorkflowRevisionView,
  type WorkspaceDefinitionView,
  type ProjectRepositoryView,
} from '../api/resources';

export type ReadinessState = 'READY' | 'MISSING' | 'UNKNOWN' | 'NOT_REQUIRED';
export type ReadinessCheck = { state: ReadinessState; detail: string };
export type ReadResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export async function readReadiness<T>(read: Promise<T>): Promise<ReadResult<T>> {
  try {
    return { ok: true, value: await read };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof ApiError && [403, 404].includes(error.status)
          ? '当前账号不可读取这项资料；可能受到访问限制，请项目管理员确认。'
          : `读取失败，请重试。${formatApiError(error)}`,
    };
  }
}

/** 每个来源独立保留失败状态；一个接口失败不能把其他准备项变成未配置。 */
export async function loadProjectReadiness(projectId: string) {
  const [members, roles, definitions, bindings, workspace, repositories, board] = await Promise.all(
    [
      readReadiness(projectApi.members(projectId)),
      readReadiness(projectApi.roles(projectId)),
      readReadiness(workflowApi.listDefinitions(projectId)),
      readReadiness(knowledgeBindingApi.list(projectId)),
      readReadiness(workspaceApi.definition(projectId)),
      readReadiness(workspaceApi.repositories(projectId)),
      readReadiness(boardApi.get(projectId, { limit: 1 })),
    ],
  );
  return { members, roles, definitions, bindings, workspace, repositories, board };
}

export type ProjectReadinessSnapshot = Awaited<ReturnType<typeof loadProjectReadiness>>;

function objects(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

export function checkPeople(
  members: ReadResult<MemberView[]>,
  roles: ReadResult<RoleView[]>,
  revision: WorkflowRevisionView | null,
): ReadinessCheck {
  if (!members.ok) return { state: 'UNKNOWN', detail: members.reason };
  if (!roles.ok) return { state: 'UNKNOWN', detail: roles.reason };
  if (members.value.some((member) => !Array.isArray(member.roles)))
    return {
      state: 'UNKNOWN',
      detail: '成员接口未提供完整业务角色分配；请在角色页确认人员与签字安排。',
    };
  const definition = revision?.definition ?? buildStandardWorkflowTemplate();
  const prefix = revision ? '' : '尚无选定的已发布流程，按标准模板预检：';
  const steps = objects(definition.steps);
  const slots = objects(definition.roleSlots);
  const roleMap = new Map(
    roles.value.filter((role) => role.isActive !== false).map((role) => [role.key, role]),
  );
  const users = (key: string) => {
    const role = roleMap.get(key);
    return role
      ? members.value
          .filter((member) => member.roles?.some((assignment) => assignment.id === role.id))
          .map((member) => member.id)
      : [];
  };
  const missing = [
    ...new Set(
      [...steps, ...slots]
        .map((item) => String(item.roleKey ?? ''))
        .filter((key) => !users(key).length),
    ),
  ];
  if (missing.length)
    return {
      state: 'MISSING',
      detail: `${prefix}还需安排${missing.map((key) => roleMap.get(key)?.title ?? key).join('、')}的业务角色人员。项目 OWNER 身份不会自动替代业务角色。`,
    };
  const conflicts = new Set<string>();
  for (const step of steps) {
    for (const gate of objects(step.gates)) {
      if (!Array.isArray(gate.reviewerSlots)) continue;
      for (const key of gate.reviewerSlots) {
        const slot = slots.find((item) => item.key === key);
        if (!slot) continue;
        if (
          !users(String(step.roleKey)).some((worker) =>
            users(String(slot.roleKey)).some((signer) => signer !== worker),
          )
        )
          conflicts.add(String(slot.key));
      }
    }
  }
  if (conflicts.size)
    return {
      state: 'MISSING',
      detail: `${prefix}签字槽 ${[...conflicts].join('、')} 尚无可与提交人分开的人员。请增加或调整角色分配，避免提交人审核自己的交付。`,
    };
  return {
    state: 'READY',
    detail: `${prefix}所需角色已有人员，并能安排不同人员提交与签字。创建流程实例时仍须逐项指定责任人和签字人，服务端会复核。`,
  };
}

export function checkWorkspace(
  workspace: ReadResult<WorkspaceDefinitionView>,
  repositories: ReadResult<ProjectRepositoryView[]>,
  revision: WorkflowRevisionView | null,
): ReadinessCheck {
  if (!workspace.ok) return { state: 'UNKNOWN', detail: workspace.reason };
  const value = workspace.value;
  if (value.definitionStatus !== 'CONFIGURED' || !value.revisionId)
    return {
      state: 'MISSING',
      detail:
        '还没有已发布的工作区定义。代码项目先声明仓库并发布定义；无代码项目明确选择 NONE 布局。',
    };
  const requiresCode =
    revision &&
    objects(revision.definition.steps).some(
      (step) => Array.isArray(step.outputKinds) && step.outputKinds.includes('IMPL'),
    );
  if (value.payload?.layout.kind === 'NONE')
    return requiresCode
      ? {
          state: 'MISSING',
          detail: '工作区声明无代码，但选定流程包含实现步骤；需要仓库与匹配的工作区定义。',
        }
      : {
          state: 'READY',
          detail: '已发布工作区定义，且显式声明无代码布局。未读取任何本机 checkout 状态。',
        };
  if (!repositories.ok) return { state: 'UNKNOWN', detail: repositories.reason };
  const references = value.payload?.repositories ?? [];
  const activeIds = new Set(
    repositories.value
      .filter((repository) => !repository.archivedAt)
      .map((repository) => repository.id),
  );
  if (
    !references.length ||
    references.some((repository) => !activeIds.has(repository.projectRepositoryId))
  )
    return {
      state: 'MISSING',
      detail: '当前工作区定义没有活动仓库，或引用了已归档仓库；请调整并发布新定义。',
    };
  return {
    state: 'READY',
    detail: `已发布工作区修订 v${value.revisionNo ?? '—'}，引用 ${references.length} 个活动仓库。人工声明身份不代表托管方已核验，本机接入仍需自行完成。`,
  };
}

/** 只核对服务端编译后声明为 required 的发布知识输入，不把可选资料当阻塞。 */
export async function checkPublishedKnowledge(
  projectId: string,
  revision: WorkflowRevisionView,
  bindings: ReadResult<KnowledgeBindingsView>,
): Promise<ReadinessCheck> {
  if (!revision.compiledRules)
    return {
      state: 'UNKNOWN',
      detail: '当前修订未返回编译后的资料要求；请在流程页重新校验，避免按猜测判断准备情况。',
    };
  const sources = revision.compiledRules.inputSources.filter(
    (source) => source.source === 'PUBLISHED_KNOWLEDGE' && source.required,
  );
  if (!sources.length)
    return {
      state: 'NOT_REQUIRED',
      detail: '选定流程没有必需的“已发布知识”输入；外部输入和需求资料仍需在任务上下文中提供。',
    };
  if (!bindings.ok) return { state: 'UNKNOWN', detail: bindings.reason };
  const documents = new Map<string, ReadResult<DocumentDetail>>();
  await Promise.all(
    [...new Set(sources.map((source) => source.reference))].map(async (id) =>
      documents.set(id, await readReadiness(documentApi.get(id))),
    ),
  );
  const missing: string[] = [];
  let restricted = false;
  for (const source of sources) {
    const document = documents.get(source.reference)!;
    if (!document.ok) {
      restricted = true;
      continue;
    }
    const value = document.value.document;
    const roleId = revision.compiledRules.resolvedRoles.find(
      (role) => role.stepKey === source.stepKey,
    )?.roleId;
    if (
      value.projectId !== projectId ||
      value.archivedAt ||
      !value.currentPublishedRevisionId ||
      !['KNOWLEDGE', 'DECISION'].includes(value.kind)
    )
      missing.push(source.inputKey);
    else if (
      !roleId ||
      !bindings.value.items.some(
        (binding) =>
          binding.documentId === value.id && (binding.roleId === null || binding.roleId === roleId),
      )
    ) {
      // 绑定列表按当前主体过滤；只读用户缺少一行可能是访问受限，不能当作未配置。
      if (!bindings.value.canManage) restricted = true;
      else missing.push(`${source.inputKey} 的角色绑定`);
    }
  }
  if (missing.length)
    return {
      state: 'MISSING',
      detail: `仍需准备或更新：${[...new Set(missing)].join('、')}。在流程配置页选择已发布文档，由管理员绑定给接收角色。`,
    };
  if (restricted)
    return {
      state: 'UNKNOWN',
      detail:
        '部分必需资料或绑定当前不可确认，可能受知识库阅读权限限制；请管理员在流程页检查。不能据此判断资料缺失。',
    };
  return {
    state: 'READY',
    detail: `已核对 ${sources.length} 项必需知识输入：同项目、已发布、未归档，且绑定给接收角色或全部角色。角色实际 READ 权限仍由服务端检查。`,
  };
}
