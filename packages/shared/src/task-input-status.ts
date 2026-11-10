/** Read-only diagnostics explain existing input gates; they never approve or repair inputs. */
export type TaskInputIssue = {
  kind: 'UNDERSTANDING' | 'PRD' | 'KNOWLEDGE' | 'ARTIFACT' | 'ROLE_RESOURCE';
  reason:
    | 'NOT_PUBLISHED'
    | 'NOT_BOUND'
    | 'NOT_CURRENT_PUBLISHED'
    | 'ACCEPTED_ARTIFACT_MISSING'
    | 'UNAVAILABLE_OR_UNREADABLE'
    | 'CONTENT_UNAVAILABLE'
    | 'EXTERNAL_REFERENCE'
    | 'UNVERIFIED';
  required: boolean;
  blocking: boolean;
  inputKey?: string;
  documentId?: string;
  revisionId?: string;
  fromStepKey?: string;
  artifactKind?: string;
  refId?: string;
  action:
    | 'PUBLISH_BASELINE'
    | 'BIND_KNOWLEDGE'
    | 'PUBLISH_KNOWLEDGE'
    | 'REFRESH_BASELINE'
    | 'CHECK_ACCESS'
    | 'DELIVER_UPSTREAM'
    | 'RESTORE_CONTENT'
    | 'PROVIDE_HOSTED_INPUT'
    | 'VERIFY_LOCALLY';
  responsible:
    'PRODUCT_OWNER' | 'KNOWLEDGE_MAINTAINER' | 'UPSTREAM_OWNER' | 'PROJECT_ADMIN' | 'LOCAL_AGENT';
};

export const TASK_INPUT_KIND_LABELS: Record<TaskInputIssue['kind'], string> = {
  UNDERSTANDING: '需求理解',
  PRD: '产品需求',
  KNOWLEDGE: '项目知识',
  ARTIFACT: '上游工件',
  ROLE_RESOURCE: '角色资源',
};
export const TASK_INPUT_REASON_LABELS: Record<TaskInputIssue['reason'], string> = {
  NOT_PUBLISHED: '缺少必需的已发布修订',
  NOT_BOUND: '必需知识尚未绑定给当前角色',
  NOT_CURRENT_PUBLISHED: '引用修订已不是当前发布版本',
  ACCEPTED_ARTIFACT_MISSING: '缺少已验收的上游工件',
  UNAVAILABLE_OR_UNREADABLE: '输入不可用或无权读取',
  CONTENT_UNAVAILABLE: '正文不可取得或摘要/长度核验失败',
  EXTERNAL_REFERENCE: '仅提供外部代码引用',
  UNVERIFIED: '正文尚未核验',
};
export const TASK_INPUT_ACTION_LABELS: Record<TaskInputIssue['action'], string> = {
  PUBLISH_BASELINE: '完成基线文档发布后重新核验输入',
  BIND_KNOWLEDGE: '将已发布知识绑定给当前角色后重新核验输入',
  PUBLISH_KNOWLEDGE: '发布必需知识文档后重新核验输入',
  REFRESH_BASELINE: '核对并修复当前发布基线后重新获取上下文',
  CHECK_ACCESS: '核对输入配置及读取权限后重新核验',
  DELIVER_UPSTREAM: '由上游完成对应工件交付与验收后重新核验输入',
  RESTORE_CONTENT: '修复正文存储或内容完整性后重新核验输入',
  PROVIDE_HOSTED_INPUT: '按流程补交已验收的 HOSTED 正文；本机检查不能替代快照输入',
  VERIFY_LOCALLY: '在本机核验引用与环境；本机结果不构成服务端正文核验',
};
export const TASK_INPUT_OWNER_LABELS: Record<TaskInputIssue['responsible'], string> = {
  PRODUCT_OWNER: '产品负责人',
  KNOWLEDGE_MAINTAINER: '项目知识维护者',
  UPSTREAM_OWNER: '上游任务负责人',
  PROJECT_ADMIN: '项目管理员',
  LOCAL_AGENT: '本地 Agent',
};

/** Advisory metadata for the immutable role package locked by this task's workflow revision. */
export type TaskRolePackageStatus = {
  workflowDefinitionRevisionId: string;
  roleKey: string;
  status: 'LOCKED' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
  locked: {
    packageId: string;
    version: string;
    packageDigest: string;
    source: 'PROJECT' | 'BUILTIN';
    resources: Array<{
      refId: string;
      path: string;
      sha256: string;
      byteLength: number;
    }>;
  } | null;
  /** Latest accessible strict SemVer in the same package and role; does not change the lock. */
  latestAvailable: {
    packageId: string;
    version: string;
    packageDigest: string;
    source: 'PROJECT' | 'BUILTIN';
  } | null;
  /** Compared with the task's previous readable snapshot, using role ref/hash/length only. */
  comparison?: {
    status: 'NO_SNAPSHOT' | 'CURRENT' | 'CHANGED' | 'UNAVAILABLE';
    changes: Array<{
      refId: string;
      path: string | null;
      status: 'ADDED' | 'REMOVED' | 'CHANGED';
      previousSha256: string | null;
      currentSha256: string | null;
    }>;
  };
};

export interface TaskInputStatusView {
  taskId: string;
  taskVersion: number;
  snapshotId: string | null;
  checkedAt: string;
  availability: 'VERIFIED' | 'UNAVAILABLE' | 'REQUIRES_LOCAL_CHECK';
  issue: string | null;
  /** Optional for clients connected to an older platform; absent is not an empty diagnosis. */
  issues?: TaskInputIssue[];
  issuesComplete?: boolean;
  /** Absent on older servers; absence never proves the local installation matches. */
  rolePackage?: TaskRolePackageStatus;
  resources: Array<{
    refId: string;
    kind: 'DOCUMENT_REVISION' | 'ARTIFACT' | 'ROLE_RESOURCE';
    targetId: string;
    sha256: string;
    byteLength: number;
    mediaType: string;
    authority: string;
    contentStatus: 'VERIFIED' | 'EXTERNAL_REFERENCE' | 'UNAVAILABLE' | 'UNVERIFIED';
  }>;
  comparison: {
    status: 'NO_SNAPSHOT' | 'CURRENT' | 'CHANGED' | 'UNAVAILABLE';
    changes: Array<{
      refId: string;
      kind: string;
      status: 'ADDED' | 'REMOVED' | 'CHANGED';
      previousTargetId: string | null;
      currentTargetId: string | null;
    }>;
    metadataChanges: string[];
  };
}
