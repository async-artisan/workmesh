import {
  canonicalJson,
  workflowStepDisplayNameOf,
  type RequirementTrustActor,
  type RequirementTrustChain,
  type RequirementTrustEvent,
  type RequirementTrustGap,
  type RequirementTrustGapCode,
} from '@workmesh/shared';
import { createHash } from 'node:crypto';
import { boundEvidenceIds } from '../reviews/v1-review-code-evidence';
import { needsCodeEvidence, isCodeEvidenceAcceptable } from '../reviews/v1-review-policy';

type Stamp = { kind: string; user: { id: string; email: string } | null } | null;
type Publication = {
  id: string;
  kind: string;
  revisionId: string;
  reviewRequestId: string | null;
  createdAt: Date;
};
type Revision = {
  id: string;
  seq: number;
  title: string;
  sha256: string;
  basisUnderstandingRevisionId: string | null;
  acceptance: unknown;
  publications: Publication[];
};
export type TrustDocument = {
  id: string;
  knowledgeBaseId: string;
  kind: string;
  archivedAt: Date | null;
  currentPublishedRevisionId: string | null;
  revisions: Revision[];
};
export type TrustTask = {
  id: string;
  stepKey: string;
  generation: number;
  acceptanceKeys: string[];
  executionStatus: string;
  workStatus: string;
  currentSnapshotId: string | null;
  currentArtifactSetId: string | null;
  instance: {
    id: string;
    definitionRevisionId: string | null;
    workStatus: string;
    retiredAt: Date | null;
  };
};
export type TrustReview = {
  id: string;
  kind: string;
  taskId: string | null;
  taskGeneration: number | null;
  artifactSetId: string | null;
  documentRevisionId: string | null;
  status: string;
  subjectDigest: string;
  createdAt: Date;
  approvalSlots: Array<{ id: string }>;
  decisions: Array<{
    id: string;
    approvalSlotId: string;
    decision: string;
    subjectDigest: string;
    createdAt: Date;
    createdByStamp: Stamp;
    revocation: { id: string; createdAt: Date; createdByStamp: Stamp } | null;
  }>;
};
export type TrustSet = {
  id: string;
  taskId: string;
  taskGeneration: number;
  snapshotId: string;
  workflowDefinitionRevisionId: string;
  manifestDigest: string;
  createdAt: Date;
  createdByStamp: Stamp;
  artifacts: Array<{
    storage: string;
    commitSha: string | null;
    projectRepositoryId: string | null;
  }>;
};
export type TrustSnapshot = {
  id: string;
  taskId: string;
  taskGeneration: number;
  requirementId: string;
  requirementGeneration: number;
  workflowDefinitionRevisionId: string;
  manifest: unknown;
};
export type TrustCodeEvidence = {
  id: string;
  artifactSetId: string | null;
  preparedSecretHash: string | null;
  preparedExpiresAt: Date | null;
  preparedEvidenceId: string | null;
  ticketGeneration: number | null;
  state: string;
  reviewerKind: string;
  repositoryId: string;
  headSha: string;
  commitSha: string | null;
  receipt: { signatureValid: boolean; status: string } | null;
};
export type TrustData = {
  requirement: {
    id: string;
    generation: number;
    currentUnderstandingRevisionId: string | null;
    currentPrdRevisionId: string | null;
    deliveryScope?: unknown;
  };
  tasks: TrustTask[];
  documents: TrustDocument[];
  reviews: TrustReview[];
  sets: TrustSet[];
  snapshots: TrustSnapshot[];
  evidence: TrustCodeEvidence[];
  repositories: Array<{ id: string; externalId: string | null; archivedAt: Date | null }>;
  definitions: Array<{ id: string; definition: unknown }>;
  changes: Array<{ id: string; sourceKind: string; changedFields: string[]; createdAt: Date }>;
};

function actor(stamp: Stamp): RequirementTrustActor {
  return {
    kind: stamp?.kind === 'HUMAN' ? 'HUMAN' : stamp?.kind === 'AGENT' ? 'AGENT' : 'UNKNOWN',
    userId: stamp?.user?.id ?? null,
    label: stamp?.user?.email ?? null,
  };
}
function signed(review: TrustReview): boolean {
  return (
    review.approvalSlots.length > 0 &&
    review.approvalSlots.every((slot) =>
      review.decisions.some(
        (d) =>
          d.approvalSlotId === slot.id &&
          d.decision === 'APPROVE' &&
          !d.revocation &&
          d.subjectDigest === review.subjectDigest &&
          d.createdByStamp?.kind === 'HUMAN' &&
          Boolean(d.createdByStamp.user?.id),
      ),
    )
  );
}
function approved(review: TrustReview): boolean {
  return (
    review.status === 'APPROVED' &&
    review.approvalSlots.length > 0 &&
    review.approvalSlots.every((slot) =>
      review.decisions.some(
        (d) =>
          d.approvalSlotId === slot.id &&
          d.decision === 'APPROVE' &&
          !d.revocation &&
          d.subjectDigest === review.subjectDigest,
      ),
    )
  );
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stepOf(data: TrustData, task: TrustTask): Record<string, unknown> | null {
  const definition = objectOf(
    data.definitions.find((item) => item.id === task.instance.definitionRevisionId)?.definition,
  );
  return Array.isArray(definition?.steps)
    ? (definition.steps.map(objectOf).find((step) => step?.key === task.stepKey) ?? null)
    : null;
}

function snapshotIdentityMatches(snapshot: TrustSnapshot): boolean {
  const manifest = objectOf(snapshot.manifest);
  return Boolean(
    manifest &&
    manifest.taskId === snapshot.taskId &&
    manifest.requirementId === snapshot.requirementId &&
    manifest.taskGeneration === snapshot.taskGeneration &&
    manifest.requirementGeneration === snapshot.requirementGeneration &&
    manifest.workflowDefinitionRevisionId === snapshot.workflowDefinitionRevisionId,
  );
}

function snapshotBaselineOf(
  snapshot: TrustSnapshot,
  task: TrustTask,
  data: TrustData,
  documents: TrustDocument[],
): 'CURRENT' | 'STALE' | 'UNKNOWN' {
  const manifest = objectOf(snapshot.manifest);
  const expectedPolicy =
    stepOf(data, task)?.baselinePolicy === 'PUBLISHED_PRD' ? 'PUBLISHED_PRD' : 'NONE';
  if (!manifest || !snapshotIdentityMatches(snapshot) || manifest.baselinePolicy !== expectedPolicy)
    return 'STALE';
  if (expectedPolicy === 'NONE') return manifest.productBaseline === null ? 'CURRENT' : 'STALE';
  const understanding = documents
    .filter((document) => document.kind === 'UNDERSTANDING')
    .flatMap((document) => document.revisions)
    .find((revision) => revision.id === data.requirement.currentUnderstandingRevisionId);
  const prd = documents
    .filter((document) => document.kind === 'PRD')
    .flatMap((document) => document.revisions)
    .find((revision) => revision.id === data.requirement.currentPrdRevisionId);
  if (!understanding || !prd) return 'UNKNOWN';
  const baseline = objectOf(manifest.productBaseline);
  const scopeDigest = createHash('sha256')
    .update(canonicalJson(data.requirement.deliveryScope ?? null))
    .digest('hex');
  if (
    !baseline ||
    baseline.understandingRevisionId !== understanding.id ||
    baseline.prdRevisionId !== prd.id ||
    baseline.prdSha256 !== prd.sha256 ||
    baseline.deliveryScopeDigest !== scopeDigest ||
    !Array.isArray(manifest.resources)
  )
    return 'STALE';
  const resources = manifest.resources.map(objectOf);
  return [understanding, prd].every((revision) =>
    resources.some(
      (resource) =>
        resource?.kind === 'DOCUMENT_REVISION' &&
        resource.targetId === revision.id &&
        resource.sha256 === revision.sha256 &&
        resource.authority === 'PUBLISHED',
    ),
  )
    ? 'CURRENT'
    : 'STALE';
}
function codeStatus(set: TrustSet, data: TrustData): RequirementTrustGapCode | null {
  if (!needsCodeEvidence(set.artifacts)) return null;
  const tickets = data.evidence.filter(
    (item) => item.artifactSetId === set.id && item.ticketGeneration === set.taskGeneration,
  );
  const ids = boundEvidenceIds(tickets);
  const bound = data.evidence.filter(
    (item) => ids.includes(item.id) && item.preparedSecretHash === null,
  );
  if (!ids.length || bound.length !== ids.length) return 'CODE_EVIDENCE_MISSING';
  if (
    !isCodeEvidenceAcceptable(bound) ||
    bound.some((item) => !item.receipt?.signatureValid || item.receipt.status !== 'PROCESSED')
  )
    return 'CODE_EVIDENCE_INVALID';
  for (const artifact of set.artifacts) {
    if (artifact.storage !== 'GIT_REF' && !artifact.commitSha) continue;
    const repository = data.repositories.find(
      (item) => item.id === artifact.projectRepositoryId && !item.archivedAt,
    );
    if (
      !artifact.commitSha ||
      !bound.some(
        (item) =>
          (item.commitSha === artifact.commitSha || item.headSha === artifact.commitSha) &&
          (!artifact.projectRepositoryId || repository?.externalId === item.repositoryId),
      )
    )
      return 'CODE_EVIDENCE_INVALID';
  }
  return null;
}

/** All data is from one database snapshot. Permission filtering happens before projection. */
export function buildRequirementTrustChain(
  data: TrustData,
  readableDocumentIds: ReadonlySet<string>,
  checkedAt = new Date(),
  visibilityLimited = false,
): RequirementTrustChain {
  const documents = data.documents.filter((doc) => readableDocumentIds.has(doc.id));
  const readableRevisions = new Set(documents.flatMap((doc) => doc.revisions.map((rev) => rev.id)));
  const reviews = data.reviews.filter(
    (review) => !review.documentRevisionId || readableRevisions.has(review.documentRevisionId),
  );
  const timeline: RequirementTrustEvent[] = [];
  const gaps: RequirementTrustGap[] = [];
  const visibility =
    documents.length === data.documents.length && !visibilityLimited ? 'FULL' : 'PARTIAL';
  if (visibility === 'PARTIAL') gaps.push({ code: 'VISIBILITY_LIMITED' });
  const baselines: RequirementTrustChain['baselines'] = (['UNDERSTANDING', 'PRD'] as const).map(
    (kind) => {
      const revisionId =
        kind === 'PRD'
          ? data.requirement.currentPrdRevisionId
          : data.requirement.currentUnderstandingRevisionId;
      if (!revisionId) {
        gaps.push({ code: 'BASELINE_MISSING', baselineKind: kind });
        return { kind, state: 'MISSING' };
      }
      const document = documents.find(
        (doc) => doc.kind === kind && doc.revisions.some((rev) => rev.id === revisionId),
      );
      const revision = document?.revisions.find((rev) => rev.id === revisionId);
      if (!document || !revision || document.archivedAt) {
        gaps.push({ code: 'BASELINE_UNAVAILABLE', baselineKind: kind });
        return { kind, state: 'UNAVAILABLE' };
      }
      const latest = document.revisions
        .flatMap((rev) => rev.publications)
        .sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
        )[0];
      const consistent =
        document.currentPublishedRevisionId === revisionId &&
        latest?.kind === 'PUBLISH' &&
        latest.revisionId === revisionId &&
        (kind !== 'PRD' ||
          revision.basisUnderstandingRevisionId ===
            data.requirement.currentUnderstandingRevisionId);
      if (!consistent) gaps.push({ code: 'BASELINE_INCONSISTENT', baselineKind: kind });
      else {
        const publicationReview = reviews.find(
          (review) =>
            review.id === latest.reviewRequestId &&
            review.documentRevisionId === revisionId &&
            review.subjectDigest === revision.sha256,
        );
        if (!publicationReview || !approved(publicationReview) || !signed(publicationReview))
          gaps.push({ code: 'SIGNATURE_UNRECORDED', baselineKind: kind });
      }
      return {
        kind,
        state: consistent ? 'CURRENT' : 'INCONSISTENT',
        documentId: document.id,
        revisionId,
        seq: revision.seq,
        title: revision.title,
      };
    },
  );
  const taskViews: RequirementTrustChain['tasks'] = data.tasks.map((task) => {
    const stepLabel =
      workflowStepDisplayNameOf(
        data.definitions.find((item) => item.id === task.instance.definitionRevisionId)?.definition,
        task.stepKey,
      ) ?? task.stepKey;
    const set = data.sets.find(
      (item) => item.id === task.currentArtifactSetId && item.taskId === task.id,
    );
    const snapshot = set ? data.snapshots.find((item) => item.id === set.snapshotId) : undefined;
    const result: RequirementTrustChain['tasks'][number] = {
      taskId: task.id,
      taskGeneration: task.generation,
      stepLabel,
      state: 'PENDING',
      baselineRelation: 'UNKNOWN',
      artifactSetId: set?.id ?? null,
      snapshotId: snapshot?.id ?? null,
      reviewId: null,
      gapCodes: [],
    };
    if (
      task.instance.retiredAt ||
      task.instance.workStatus === 'CANCELLED' ||
      task.workStatus === 'CANCELLED'
    )
      return { ...result, state: 'RETIRED' };
    const add = (code: RequirementTrustGapCode) => {
      if (!result.gapCodes.includes(code)) result.gapCodes.push(code);
    };
    if (!set) add('DELIVERY_MISSING');
    else {
      if (
        set.taskGeneration !== task.generation ||
        set.workflowDefinitionRevisionId !== task.instance.definitionRevisionId
      )
        add('DELIVERY_STALE');
      if (!snapshot) add('SNAPSHOT_MISSING');
      else if (
        snapshot.id !== task.currentSnapshotId ||
        snapshot.taskId !== task.id ||
        snapshot.taskGeneration !== task.generation ||
        snapshot.requirementId !== data.requirement.id ||
        snapshot.workflowDefinitionRevisionId !== set.workflowDefinitionRevisionId ||
        !snapshotIdentityMatches(snapshot)
      )
        add('SNAPSHOT_STALE');
      const review = reviews.find(
        (item) =>
          item.taskId === task.id &&
          item.taskGeneration === task.generation &&
          item.artifactSetId === set.id &&
          item.kind ===
            (stepOf(data, task)?.kind === 'RELEASE' ? 'RELEASE_ACCEPTANCE' : 'TASK_ACCEPTANCE') &&
          item.subjectDigest === set.manifestDigest &&
          approved(item),
      );
      result.reviewId =
        review?.id ??
        reviews.find(
          (item) =>
            item.taskId === task.id &&
            item.taskGeneration === task.generation &&
            item.artifactSetId === set.id,
        )?.id ??
        null;
      if (!review) add('APPROVAL_MISSING');
      else if (!signed(review)) add('SIGNATURE_UNRECORDED');
      if (snapshot) {
        if (snapshot.requirementGeneration === data.requirement.generation) {
          result.baselineRelation = snapshotBaselineOf(snapshot, task, data, documents);
          if (result.baselineRelation === 'STALE') add('SNAPSHOT_STALE');
          if (result.baselineRelation === 'UNKNOWN') add('SNAPSHOT_UNVERIFIABLE');
        } else if (
          snapshot.requirementGeneration < data.requirement.generation &&
          task.executionStatus === 'DONE' &&
          review &&
          !result.gapCodes.length
        )
          result.baselineRelation = 'PRESERVED_ACCEPTANCE';
        else {
          result.baselineRelation = 'STALE';
          add('SNAPSHOT_STALE');
        }
      }
      const codeIssue = codeStatus(set, data);
      if (codeIssue) add(codeIssue);
    }
    if (task.executionStatus !== 'DONE') add('TASK_NOT_ACCEPTED');
    result.state = result.gapCodes.some((code) =>
      ['DELIVERY_STALE', 'SNAPSHOT_STALE'].includes(code),
    )
      ? 'STALE'
      : result.gapCodes.length
        ? 'PENDING'
        : 'ACCEPTED';
    for (const code of result.gapCodes) gaps.push({ code, taskId: task.id });
    return result;
  });
  const activeTasks = taskViews.filter((task) => task.state !== 'RETIRED');
  if (!activeTasks.length) gaps.push({ code: 'WORKFLOW_MISSING' });
  const prd = baselines.find((item) => item.kind === 'PRD' && item.state === 'CURRENT');
  const acceptanceRaw = documents
    .flatMap((doc) => doc.revisions)
    .find((rev) => rev.id === prd?.revisionId)?.acceptance;
  const acceptanceKeys = Array.isArray(acceptanceRaw)
    ? [
        ...new Set(
          acceptanceRaw.flatMap((item) =>
            item && typeof item === 'object' && typeof (item as { key?: unknown }).key === 'string'
              ? [(item as { key: string }).key]
              : [],
          ),
        ),
      ]
    : [];
  const acceptance = acceptanceKeys.map((key) => {
    const taskIds = data.tasks
      .filter(
        (task) =>
          task.acceptanceKeys.includes(key) && activeTasks.some((item) => item.taskId === task.id),
      )
      .map((task) => task.id);
    if (!taskIds.length) gaps.push({ code: 'ACCEPTANCE_UNASSIGNED', acceptanceKey: key });
    return {
      key,
      taskIds,
      acceptedTaskIds: taskIds.filter((id) =>
        taskViews.some((task) => task.taskId === id && task.state === 'ACCEPTED'),
      ),
    };
  });

  for (const document of documents)
    for (const revision of document.revisions) {
      const publications = document.revisions
        .flatMap((rev) => rev.publications)
        .filter((pub) => pub.revisionId === revision.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
      for (const publication of revision.publications) {
        const review = reviews.find((item) => item.id === publication.reviewRequestId);
        const signers =
          publication.kind === 'PUBLISH'
            ? (review?.decisions
                .filter((d) => d.decision === 'APPROVE')
                .map((d) => actor(d.createdByStamp)) ?? [])
            : [];
        timeline.push({
          id: `publication:${publication.id}`,
          kind: publication.kind === 'PUBLISH' ? 'PUBLICATION' : 'WITHDRAWAL',
          at: publication.createdAt.toISOString(),
          source: 'PLATFORM_FACT',
          applicability:
            publication.kind === 'WITHDRAW' || publications[0]?.kind === 'WITHDRAW'
              ? 'WITHDRAWN'
              : document.currentPublishedRevisionId === revision.id &&
                  baselines.some(
                    (item) => item.revisionId === revision.id && item.state === 'CURRENT',
                  )
                ? 'CURRENT'
                : 'HISTORICAL',
          label: `${document.kind} · ${revision.title} · v${revision.seq}`,
          actors: signers,
          documentId: document.id,
          revisionId: revision.id,
          ...(publication.reviewRequestId ? { reviewId: publication.reviewRequestId } : {}),
        });
      }
    }
  for (const set of data.sets) {
    const current = taskViews.find((task) => task.taskId === set.taskId);
    const submittedBy = actor(set.createdByStamp);
    timeline.push({
      id: `delivery:${set.id}`,
      kind: 'DELIVERY',
      at: set.createdAt.toISOString(),
      source:
        submittedBy.kind === 'AGENT'
          ? 'AGENT_SUBMITTED'
          : submittedBy.kind === 'HUMAN'
            ? 'HUMAN_SUBMITTED'
            : 'UNRECORDED_ACTOR',
      applicability:
        current?.artifactSetId === set.id &&
        current.state !== 'RETIRED' &&
        current.state !== 'STALE'
          ? 'CURRENT'
          : 'HISTORICAL',
      label: current?.stepLabel ?? set.taskId,
      actors: [submittedBy],
      taskId: set.taskId,
      taskGeneration: set.taskGeneration,
      artifactSetId: set.id,
      ...(data.snapshots.find((s) => s.id === set.snapshotId)
        ? {
            requirementGeneration: data.snapshots.find((s) => s.id === set.snapshotId)!
              .requirementGeneration,
          }
        : {}),
    });
  }
  for (const review of reviews) {
    const task = taskViews.find((item) => item.taskId === review.taskId);
    const current = review.documentRevisionId
      ? baselines.some(
          (item) => item.revisionId === review.documentRevisionId && item.state === 'CURRENT',
        )
      : task?.artifactSetId === review.artifactSetId &&
        task?.taskGeneration === review.taskGeneration &&
        task?.state !== 'RETIRED' &&
        task?.state !== 'STALE';
    const label =
      task?.stepLabel ??
      documents.flatMap((doc) => doc.revisions).find((rev) => rev.id === review.documentRevisionId)
        ?.title ??
      review.kind;
    const refs = {
      reviewId: review.id,
      ...(review.taskId ? { taskId: review.taskId } : {}),
      ...(review.taskGeneration != null ? { taskGeneration: review.taskGeneration } : {}),
      ...(review.artifactSetId ? { artifactSetId: review.artifactSetId } : {}),
      ...(review.documentRevisionId ? { revisionId: review.documentRevisionId } : {}),
    };
    timeline.push({
      id: `review:${review.id}`,
      kind: 'REVIEW_REQUEST',
      at: review.createdAt.toISOString(),
      source: 'PLATFORM_FACT',
      applicability: current ? 'CURRENT' : 'HISTORICAL',
      label,
      actors: [],
      ...refs,
    });
    for (const decision of review.decisions) {
      const signer = actor(decision.createdByStamp);
      timeline.push({
        id: `decision:${decision.id}`,
        kind: 'DECISION',
        at: decision.createdAt.toISOString(),
        source: signer.kind === 'HUMAN' && signer.userId ? 'HUMAN_SIGNED' : 'UNRECORDED_ACTOR',
        applicability: decision.revocation ? 'REVOKED' : current ? 'CURRENT' : 'HISTORICAL',
        label,
        actors: [signer],
        decision: decision.decision,
        ...refs,
      });
      if (decision.revocation) {
        const revoker = actor(decision.revocation.createdByStamp);
        timeline.push({
          id: `revocation:${decision.revocation.id}`,
          kind: 'REVOCATION',
          at: decision.revocation.createdAt.toISOString(),
          source: revoker.kind === 'HUMAN' && revoker.userId ? 'HUMAN_SIGNED' : 'UNRECORDED_ACTOR',
          applicability: 'REVOKED',
          label,
          actors: [revoker],
          ...refs,
        });
      }
    }
  }
  for (const change of data.changes)
    timeline.push({
      id: `change:${change.id}`,
      kind: 'CHANGE',
      at: change.createdAt.toISOString(),
      source: 'PLATFORM_FACT',
      applicability: 'HISTORICAL',
      label: change.changedFields.join(' / ') || change.sourceKind,
      actors: [],
    });
  timeline.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return {
    scope: 'FORMAL_FACT_CHAIN',
    checkedAt: checkedAt.toISOString(),
    requirementGeneration: data.requirement.generation,
    status:
      visibility === 'PARTIAL' || baselines.some((item) => item.state === 'UNAVAILABLE')
        ? 'UNAVAILABLE'
        : gaps.length
          ? 'GAPS'
          : 'LINKED',
    visibility,
    baselines,
    tasks: taskViews,
    acceptance,
    gaps,
    timeline,
  };
}
