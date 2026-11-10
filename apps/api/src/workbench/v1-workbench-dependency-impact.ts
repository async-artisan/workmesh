import type { DependencyImpact } from '@workmesh/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  WorkbenchChangeItem,
  WorkbenchReadyTaskItem,
  WorkbenchReviewItem,
} from './v1-workbench.service';
import { dependencyCounts, unavailableImpact } from './v1-dependency-impact';

type Items = {
  reviews: WorkbenchReviewItem[];
  changes: WorkbenchChangeItem[];
  readyTasks: WorkbenchReadyTaskItem[];
};

/** Reads complete affected workflow instances, independently of the displayed workbench page. */
export async function attachDependencyImpact(
  prisma: PrismaService,
  projectId: string,
  items: Items,
  authorize: () => Promise<void>,
): Promise<void> {
  const checkedAt = new Date().toISOString();
  const allItems = [...items.reviews, ...items.changes, ...items.readyTasks];
  if (!allItems.length) return;
  try {
    await authorize();
    const reviews = items.reviews.length
      ? await prisma.reviewRequest.findMany({
          where: { projectId, id: { in: items.reviews.map((item) => item.reviewId) } },
          select: {
            id: true,
            kind: true,
            status: true,
            taskId: true,
            taskGeneration: true,
            artifactSetId: true,
            documentRevision: { select: { document: { select: { requirementId: true } } } },
            approvalSlots: {
              select: {
                id: true,
                decisions: { where: { revocation: null }, select: { decision: true } },
              },
            },
          },
        })
      : [];
    const taskIds = [
      ...new Set([
        ...reviews.flatMap((review) => (review.taskId ? [review.taskId] : [])),
        ...items.readyTasks.map((task) => task.taskId),
        ...items.changes.flatMap(
          (change) => change.guidance?.tasks.map((task) => task.taskId) ?? [],
        ),
      ]),
    ];
    const requirementIds = [
      ...new Set(
        reviews.flatMap((review) =>
          review.documentRevision?.document.requirementId
            ? [review.documentRevision.document.requirementId]
            : [],
        ),
      ),
    ];
    const roots =
      taskIds.length || requirementIds.length
        ? await prisma.task.findMany({
            where: {
              projectId,
              OR: [
                ...(taskIds.length ? [{ id: { in: taskIds } }] : []),
                ...(requirementIds.length
                  ? [{ instance: { requirementId: { in: requirementIds }, retiredAt: null } }]
                  : []),
              ],
            },
            select: { id: true, workflowInstanceId: true },
          })
        : [];
    const instanceIds = [...new Set(roots.map((task) => task.workflowInstanceId))];
    const tasks = instanceIds.length
      ? await prisma.task.findMany({
          where: { projectId, workflowInstanceId: { in: instanceIds } },
          select: {
            id: true,
            stepKey: true,
            workflowInstanceId: true,
            generation: true,
            executionStatus: true,
            workStatus: true,
            currentClaimId: true,
            currentArtifactSetId: true,
            instance: {
              select: {
                projectId: true,
                requirementId: true,
                retiredAt: true,
                workStatus: true,
                definitionRevisionId: true,
                requirement: { select: { workStatus: true } },
              },
            },
          },
        })
      : [];
    const revisionIds = [
      ...new Set(
        tasks.flatMap((task) =>
          task.instance.definitionRevisionId ? [task.instance.definitionRevisionId] : [],
        ),
      ),
    ];
    const revisions = revisionIds.length
      ? await prisma.workflowRevision.findMany({
          where: { projectId, id: { in: revisionIds } },
          select: { id: true, definition: true },
        })
      : [];
    const byRevision = new Map(revisions.map((revision) => [revision.id, revision.definition]));
    const byTask = new Map(tasks.map((task) => [task.id, task]));
    const byReview = new Map(reviews.map((review) => [review.id, review]));
    const count = (ids: string[], simulate: boolean, includeRoots = false) => {
      if (ids.some((id) => !byTask.has(id))) return null;
      const groups = new Map<string, string[]>();
      for (const id of new Set(ids)) {
        const task = byTask.get(id)!;
        if (
          task.instance.retiredAt ||
          task.instance.projectId !== projectId ||
          task.instance.workStatus === 'CANCELLED' ||
          task.instance.requirement.workStatus === 'CANCELLED'
        )
          continue;
        groups.set(task.workflowInstanceId, [...(groups.get(task.workflowInstanceId) ?? []), id]);
      }
      let blocking = 0;
      let readyAfterAction = 0;
      for (const [instanceId, group] of groups) {
        const nodes = tasks.filter((task) => task.workflowInstanceId === instanceId);
        const instance = nodes[0].instance;
        const result = dependencyCounts(
          byRevision.get(instance.definitionRevisionId ?? ''),
          nodes,
          group,
          simulate &&
            instance.workStatus === 'ACTIVE' &&
            instance.requirement.workStatus === 'ACTIVE',
          includeRoots,
        );
        if (!result) return null;
        blocking += result.blocking;
        readyAfterAction += result.readyAfterAction;
      }
      return { blocking, readyAfterAction };
    };
    const set = (item: (typeof allItems)[number], value: DependencyImpact) => {
      item.dependencyImpact = value;
      item.blocking = value.blocking;
    };
    for (const item of items.reviews) {
      const review = byReview.get(item.reviewId);
      if (!review) {
        set(item, unavailableImpact(checkedAt));
        continue;
      }
      if (review.kind !== 'TASK_ACCEPTANCE' && review.kind !== 'RELEASE_ACCEPTANCE') {
        const requirementId = review.documentRevision?.document.requirementId;
        if (!requirementId) {
          set(item, { ...unavailableImpact(checkedAt), reason: 'NOT_ACTIONABLE' });
          continue;
        }
        const counts = count(
          tasks
            .filter((task) => task.instance.requirementId === requirementId)
            .map((task) => task.id),
          false,
          true,
        );
        set(item, {
          status: counts ? 'AVAILABLE' : 'UNAVAILABLE',
          checkedAt,
          blocking: counts?.blocking ?? null,
          readyAfterAction: null,
          scenario: requirementId ? 'BASELINE_PUBLICATION' : 'UNSUPPORTED',
          reason: requirementId ? 'BASELINE_RECHECK' : 'NOT_ACTIONABLE',
        });
        continue;
      }
      const task = byTask.get(review.taskId ?? '');
      const current =
        task &&
        review.status === 'OPEN' &&
        task.generation === review.taskGeneration &&
        task.currentArtifactSetId === review.artifactSetId &&
        task.executionStatus === 'REVIEW_PENDING' &&
        !task.instance.retiredAt;
      const slots = review.approvalSlots ?? [];
      const undecided = slots.filter(
        (slot) => !slot.decisions.some((decision) => decision.decision === 'APPROVE'),
      );
      const actionable = item.slots.some((slot) => slot.viewerCanDecide && !slot.decided);
      const active = Boolean(
        task &&
        task.workStatus === 'ACTIVE' &&
        task.instance.workStatus === 'ACTIVE' &&
        task.instance.requirement.workStatus === 'ACTIVE',
      );
      const completes = Boolean(
        current && actionable && slots.length && undecided.length === 1 && active,
      );
      const counts = task ? count([task.id], completes) : null;
      set(
        item,
        counts
          ? {
              status: 'AVAILABLE',
              checkedAt,
              ...counts,
              scenario: 'TASK_APPROVAL',
              reason: !current
                ? 'STALE_SUBJECT'
                : !actionable || !active || !undecided.length
                  ? 'NOT_ACTIONABLE'
                  : undecided.length > 1
                    ? 'OTHER_SLOTS_PENDING'
                    : 'LAST_REQUIRED_SLOT',
            }
          : unavailableImpact(checkedAt),
      );
    }
    for (const item of items.changes) {
      const counts =
        item.guidance && item.guidance.scope !== 'UNKNOWN'
          ? count(
              item.guidance.tasks.map((task) => task.taskId),
              false,
              true,
            )
          : null;
      set(
        item,
        counts
          ? {
              status: 'AVAILABLE',
              checkedAt,
              ...counts,
              scenario: 'CHANGE_ACK',
              reason: 'ACK_ONLY',
            }
          : unavailableImpact(checkedAt),
      );
    }
    for (const item of items.readyTasks) {
      const task = byTask.get(item.taskId);
      const counts = task
        ? count(
            [task.id],
            task.workStatus === 'ACTIVE' &&
              task.executionStatus === 'OPEN' &&
              item.claimEligibility?.canClaim === true,
          )
        : null;
      set(
        item,
        counts
          ? {
              status: 'AVAILABLE',
              checkedAt,
              ...counts,
              scenario: 'TASK_COMPLETION',
              reason: 'COMPLETE_TASK',
            }
          : unavailableImpact(checkedAt),
      );
    }
    await authorize();
  } catch {
    // Never report unknown graph data as zero impact or lose usable domain lists.
    for (const item of allItems) {
      item.dependencyImpact = unavailableImpact(checkedAt);
      item.blocking = null;
    }
  }
}
