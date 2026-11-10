import type { ActivityItem, WorkbenchSnapshot } from '../api/resources';

/** Count only decisions assigned to this viewer and claims the server says this viewer can make. */
export function actionableNotificationCounts(snapshot: WorkbenchSnapshot) {
  const reviews = snapshot.reviews.filter((review) =>
    review.slots.some((slot) => slot.viewerCanDecide && !slot.decided),
  );
  const signOffs = reviews.filter(
    (review) => review.kind === 'TASK_ACCEPTANCE' || review.kind === 'RELEASE_ACCEPTANCE',
  ).length;
  const readyTasks = snapshot.readyTasks.filter(
    (task) => task.claimEligibility?.canClaim === true,
  ).length;
  const changes = snapshot.changes.length;
  return {
    signOffs,
    approvals: reviews.length - signOffs,
    changes,
    readyTasks,
    total: reviews.length + changes + readyTasks,
  };
}

/** Links use supported routes and explicit project context. Collection destinations remain labeled as such. */
export function activityDestination(item: ActivityItem): { path: string; label: string } | null {
  const id = encodeURIComponent(item.targetId);
  const projectQuery = item.projectId ? `?projectId=${encodeURIComponent(item.projectId)}` : '';
  const projectCollection = (path: string, label: string) =>
    item.projectId ? { path: `${path}${projectQuery}`, label } : null;
  switch (item.targetType) {
    case 'REVIEW_REQUEST':
      return { path: `/reviews/${id}${projectQuery}`, label: '打开该评审' };
    case 'REQUIREMENT':
      return { path: `/requirements/${id}${projectQuery}`, label: '打开该需求' };
    case 'PROJECT':
      return { path: `/projects/${id}`, label: '打开该项目' };
    case 'KNOWLEDGE_DOCUMENT':
    case 'KNOWLEDGE_BASE':
      return projectCollection('/knowledge', '打开项目知识库');
    case 'WORKFLOW_DEFINITION':
    case 'WORKFLOW_DEFINITION_REVISION':
      return projectCollection('/workflows', '打开项目流程');
    case 'PROJECT_REPOSITORY':
    case 'WORKSPACE_DEFINITION':
    case 'WORKSPACE_DEFINITION_REVISION':
      return projectCollection('/workspace', '打开项目工作区');
    case 'CREDENTIAL':
      return { path: '/profile', label: '打开我的凭据' };
    case 'CLI_AUTHORIZATION':
      return { path: '/authorization', label: '打开设备授权' };
    case 'PROJECT_MEMBER':
    case 'PROJECT_INVITATION':
      return projectCollection('/roles', '打开项目成员');
    default:
      return null;
  }
}
