import type { WorkflowDefinitionView } from '../api/resources';

/**
 * 「流程实例为什么还没建」的唯一状态映射（需求列表 / 需求详情共用）。
 *
 * 四种失败原因必须分开，不能用同一句「请联系管理员」糊过去：
 * 流程未发布、已发布但未创建、初始化失败、当前账号无权限；已有实例时不再提示初始化。
 * 前端不虚构站内通知/邮件：没有联系人数据时如实说明「请联系项目管理员」。
 */

export type WorkflowInitKind =
  'LOADING' | 'UNPUBLISHED' | 'NOT_CREATED' | 'CREATE_FAILED' | 'NO_PERMISSION' | 'EXISTS';

export interface WorkflowInitAdmin {
  name?: string | null;
  email: string;
}

export interface WorkflowInitInput {
  hasInstance: boolean;
  /** null 表示还没加载完/加载失败，不能因此断言「未发布」。 */
  definitions: WorkflowDefinitionView[] | null;
  isAdmin: boolean;
  admins: WorkflowInitAdmin[];
  /** 上一次初始化尝试失败的错误原文；仅在管理员侧作为可重试状态。 */
  createError?: string | null;
}

export interface WorkflowInitView {
  kind: WorkflowInitKind;
  title: string;
  description: string;
  /** 当前账号是否可以打开初始化表单。 */
  canInitialize: boolean;
  /** 项目管理员（用于「请联系谁」的如实说明）。 */
  adminNames: string[];
  /** 是否需要引导去「流程」页查看/发布定义。 */
  linkToWorkflows: boolean;
}

export function publishedWorkflowDefinitions(
  definitions: WorkflowDefinitionView[] | null,
): WorkflowDefinitionView[] {
  return (definitions ?? []).filter((definition) => Boolean(definition.currentPublishedRevisionId));
}

function adminNamesOf(admins: WorkflowInitAdmin[]): string[] {
  return admins.map((admin) => admin.name?.trim() || admin.email);
}

export function describeWorkflowInitState(input: WorkflowInitInput): WorkflowInitView {
  const adminNames = adminNamesOf(input.admins);

  if (input.hasInstance)
    return {
      kind: 'EXISTS',
      title: '流程实例已创建',
      description: '任务已派生；由各步骤责任人通过本地 Agent 认领与交付，Web 只读见证。',
      canInitialize: false,
      adminNames,
      linkToWorkflows: false,
    };

  if (input.definitions === null)
    return {
      kind: 'LOADING',
      title: '正在确认流程定义',
      description: '还在读取本项目的流程定义，读完之前不会断言「未发布」或「无权限」。',
      canInitialize: false,
      adminNames,
      linkToWorkflows: false,
    };

  const published = publishedWorkflowDefinitions(input.definitions);
  if (published.length === 0)
    return {
      kind: 'UNPUBLISHED',
      title: '流程定义尚未发布',
      description: input.isAdmin
        ? '先到「流程」页校验并发布一个流程定义，再回来为这条需求初始化实例。'
        : '当前项目还没有已发布的流程定义，因此无法初始化流程实例；请联系项目管理员先发布流程定义。',
      canInitialize: false,
      adminNames,
      linkToWorkflows: true,
    };

  if (input.createError)
    return {
      kind: 'CREATE_FAILED',
      title: '流程初始化失败',
      description: input.isAdmin
        ? `上次创建没有成功：${input.createError}。已填写的配置仍保留，修正后可重试。`
        : `管理员上次初始化没有成功：${input.createError}。请联系项目管理员处理，页面不会自动重试。`,
      canInitialize: input.isAdmin,
      adminNames,
      linkToWorkflows: false,
    };

  if (input.isAdmin)
    return {
      kind: 'NOT_CREATED',
      title: '流程实例尚未创建',
      description:
        '流程定义已发布。初始化需要逐项绑定步骤责任人、审批人、代码仓库与验收归属，不能默认绑成当前用户。',
      canInitialize: true,
      adminNames,
      linkToWorkflows: false,
    };

  return {
    kind: 'NO_PERMISSION',
    title: '流程实例尚未创建',
    description:
      adminNames.length > 0
        ? `当前账号没有初始化流程实例的权限；请联系项目管理员（${adminNames.join('、')}）初始化后再继续。`
        : '当前账号没有初始化流程实例的权限；请联系项目管理员初始化后再继续。',
    canInitialize: false,
    adminNames,
    linkToWorkflows: true,
  };
}
