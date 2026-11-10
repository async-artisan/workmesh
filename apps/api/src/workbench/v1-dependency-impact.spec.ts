import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { dependencyCounts, type DependencyTask } from './v1-dependency-impact';
import { attachDependencyImpact } from './v1-workbench-dependency-impact';
import type { WorkbenchReviewItem } from './v1-workbench.service';

const task = (stepKey: string, overrides: Partial<DependencyTask> = {}): DependencyTask => ({
  id: stepKey,
  stepKey,
  executionStatus: 'OPEN',
  workStatus: 'ACTIVE',
  currentClaimId: null,
  ...overrides,
});
const graph = (steps: Record<string, string[]>) => ({
  steps: Object.entries(steps).map(([key, deps]) => ({ key, deps })),
});

describe('dependency impact explanations', () => {
  it('deduplicates a diamond while separating reachability from immediately satisfied dependencies', () => {
    const definition = graph({
      root: [],
      left: ['root'],
      right: ['root'],
      join: ['left', 'right'],
    });
    expect(
      dependencyCounts(
        definition,
        ['root', 'left', 'right', 'join'].map((key) => task(key)),
        ['root'],
        true,
      ),
    ).toEqual({ blocking: 3, readyAfterAction: 2 });
  });
  it('requires every prerequisite and excludes already ready, claimed, paused and done tasks', () => {
    const definition = graph({
      root: [],
      other: [],
      join: ['root', 'other'],
      ready: [],
      paused: ['root'],
      claimed: ['root'],
      done: ['root'],
    });
    const nodes = [
      task('root'),
      task('other'),
      task('join'),
      task('ready'),
      task('paused', { workStatus: 'PAUSED' }),
      task('claimed', { currentClaimId: 'claim' }),
      task('done', { executionStatus: 'DONE' }),
    ];
    expect(dependencyCounts(definition, nodes, ['root'], true)).toEqual({
      blocking: 3,
      readyAfterAction: 0,
    });
    nodes[1].executionStatus = 'DONE';
    expect(dependencyCounts(definition, nodes, ['root'], true)?.readyAfterAction).toBe(1);
  });
  it('uses every graph node beyond the workbench page and deduplicates overlapping change roots', () => {
    const steps = Object.fromEntries(
      Array.from({ length: 130 }, (_, index) => [`s${index}`, index ? [`s${index - 1}`] : []]),
    );
    const nodes = Object.keys(steps).map((key) => task(key));
    expect(dependencyCounts(graph(steps), nodes, ['s0'], true)).toEqual({
      blocking: 129,
      readyAfterAction: 1,
    });
    expect(dependencyCounts(graph(steps), nodes, ['s0', 's1', 's1'], false, true)).toEqual({
      blocking: 130,
      readyAfterAction: 0,
    });
  });
  it('rejects missing nodes, duplicate steps and cycles instead of claiming zero impact', () => {
    expect(
      dependencyCounts(graph({ a: ['b'], b: ['a'] }), [task('a'), task('b')], ['a'], true),
    ).toBeNull();
    expect(dependencyCounts(graph({ a: [], b: ['a'] }), [task('a')], ['a'], true)).toBeNull();
    expect(dependencyCounts(graph({ a: [] }), [task('a'), task('a')], ['a'], true)).toBeNull();
  });
});

function reviewHarness(slotCount = 1) {
  const instance = {
    projectId: 'p',
    requirementId: 'r',
    retiredAt: null,
    workStatus: 'ACTIVE',
    definitionRevisionId: 'rev',
    requirement: { workStatus: 'ACTIVE' },
  };
  const root = {
    ...task('root', { executionStatus: 'REVIEW_PENDING' }),
    workflowInstanceId: 'instance',
    generation: 2,
    currentArtifactSetId: 'set',
    instance,
  };
  const downstream = {
    ...task('next'),
    workflowInstanceId: 'instance',
    generation: 1,
    currentArtifactSetId: null,
    instance,
  };
  const review = {
    id: 'review',
    kind: 'TASK_ACCEPTANCE',
    status: 'OPEN',
    taskId: 'root',
    taskGeneration: 2,
    artifactSetId: 'set',
    documentRevision: null,
    approvalSlots: Array.from({ length: slotCount }, (_, index) => ({
      id: `slot${index}`,
      decisions: [],
    })),
  };
  const prisma = {
    reviewRequest: { findMany: vi.fn().mockResolvedValue([review]) },
    task: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'root', workflowInstanceId: 'instance' }])
        .mockResolvedValueOnce([root, downstream]),
    },
    workflowRevision: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'rev', definition: graph({ root: [], next: ['root'] }) }]),
    },
  };
  const item = {
    reviewId: 'review',
    slots: [{ id: 'slot0', decided: false, viewerCanDecide: true }],
  } as unknown as WorkbenchReviewItem;
  const authorize = vi.fn().mockResolvedValue(undefined);
  const run = () =>
    attachDependencyImpact(
      prisma as unknown as PrismaService,
      'p',
      { reviews: [item], changes: [], readyTasks: [] },
      authorize,
    );
  return { run, item, prisma, review, root, authorize };
}

describe('workbench graph aggregation', () => {
  it('only counts immediate dependency readiness for the last required slot on the current subject', async () => {
    const last = reviewHarness();
    await last.run();
    expect(last.item).toMatchObject({
      blocking: 1,
      dependencyImpact: { readyAfterAction: 1, reason: 'LAST_REQUIRED_SLOT' },
    });
    expect(last.prisma.task.findMany.mock.calls[1][0]).not.toHaveProperty('take');
    const multiple = reviewHarness(2);
    await multiple.run();
    expect(multiple.item.dependencyImpact).toMatchObject({
      blocking: 1,
      readyAfterAction: 0,
      reason: 'OTHER_SLOTS_PENDING',
    });
    const stale = reviewHarness();
    stale.review.taskGeneration = 1;
    await stale.run();
    expect(stale.item.dependencyImpact).toMatchObject({
      readyAfterAction: 0,
      reason: 'STALE_SUBJECT',
    });
  });
  it('preserves unknown on failed reads or revoked access and does not publish counts', async () => {
    const failed = reviewHarness();
    failed.prisma.task.findMany.mockReset().mockRejectedValueOnce(new Error('offline'));
    await failed.run();
    expect(failed.item.dependencyImpact).toMatchObject({
      status: 'UNAVAILABLE',
      blocking: null,
      readyAfterAction: null,
    });
    const revoked = reviewHarness();
    revoked.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('revoked'));
    await revoked.run();
    expect(revoked.item.blocking).toBeNull();
    expect(revoked.authorize).toHaveBeenCalledTimes(2);
  });
  it('does not suggest an approval will advance paused or retired work', async () => {
    const paused = reviewHarness();
    paused.root.instance.workStatus = 'PAUSED';
    await paused.run();
    expect(paused.item.dependencyImpact).toMatchObject({
      blocking: 1,
      readyAfterAction: 0,
      reason: 'NOT_ACTIONABLE',
    });
    const retired = reviewHarness();
    retired.root.instance.retiredAt = new Date() as unknown as null;
    await retired.run();
    expect(retired.item.dependencyImpact).toMatchObject({
      blocking: 0,
      readyAfterAction: 0,
      reason: 'STALE_SUBJECT',
    });
  });
  it('treats change acknowledgments as receipt only and baseline publication as a recheck', async () => {
    const change = reviewHarness();
    const changeItem = { guidance: { scope: 'EVENT_TASKS', tasks: [{ taskId: 'root' }] } };
    await attachDependencyImpact(
      change.prisma as unknown as PrismaService,
      'p',
      {
        reviews: [],
        changes: [changeItem as unknown as import('./v1-workbench.service').WorkbenchChangeItem],
        readyTasks: [],
      },
      change.authorize,
    );
    expect(changeItem).toMatchObject({
      dependencyImpact: { blocking: 2, readyAfterAction: 0, reason: 'ACK_ONLY' },
    });
    const baseline = reviewHarness();
    baseline.review.kind = 'DOCUMENT_PUBLICATION';
    baseline.review.documentRevision = { document: { requirementId: 'r' } } as unknown as null;
    await baseline.run();
    expect(baseline.item.dependencyImpact).toMatchObject({
      blocking: 2,
      readyAfterAction: null,
      reason: 'BASELINE_RECHECK',
    });
  });
});
