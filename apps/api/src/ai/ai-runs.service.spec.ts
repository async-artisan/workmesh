import { describe, expect, it, vi } from 'vitest';
import { AiRunEventType, AiRunStatus, AiRunStep, AiRunType, Priority } from '@prisma/client';
import { AiRunsService } from './ai-runs.service';

function harness(status: AiRunStatus, step: AiRunStep = AiRunStep.BACKGROUND_GOAL) {
  const run: {
    id: string;
    projectId: string;
    createdById: string;
    type: AiRunType;
    status: AiRunStatus;
    step: AiRunStep;
    eventSequence: number;
    draft: {
      backgroundGoal: string;
      usersScenarios: string[];
      userStoriesFlows: string[];
      acceptanceCriteria: string[];
      title: string;
      priority: Priority;
    };
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  } = {
    id: 'run-1',
    projectId: 'project-1',
    createdById: 'user-1',
    type: AiRunType.PRODUCT_DISCOVERY,
    status,
    step,
    eventSequence: 0,
    draft: {
      backgroundGoal: '',
      usersScenarios: [],
      userStoriesFlows: [],
      acceptanceCriteria: [],
      title: 'Discovery title',
      priority: Priority.MEDIUM,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
  };
  const events: Array<Record<string, unknown>> = [];
  let requirement: Record<string, unknown> | null = null;
  const tx = {
    aiRun: {
      findUnique: vi.fn(async () => ({ ...run })),
      updateMany: vi.fn(async ({ where }: { where: { status?: AiRunStatus } }) => {
        if (where.status && run.status !== where.status) return { count: 0 };
        run.status = AiRunStatus.PROCESSING;
        return { count: 1 };
      }),
      update: vi.fn(
        async ({ data, select }: { data: Record<string, unknown>; select?: unknown }) => {
          if (data.status) run.status = data.status as AiRunStatus;
          if (data.step) run.step = data.step as AiRunStep;
          if (data.draft) run.draft = data.draft as typeof run.draft;
          if (data.completedAt) run.completedAt = data.completedAt as Date;
          if (data.eventSequence) {
            run.eventSequence += (data.eventSequence as { increment: number }).increment;
          }
          run.updatedAt = new Date();
          return select ? { eventSequence: run.eventSequence } : { ...run };
        },
      ),
    },
    aiRunMessage: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const event = { id: `event-${String(data.sequence)}`, createdAt: new Date(), ...data };
        events.push(event);
        return event;
      }),
    },
    requirement: {
      findUnique: vi.fn(async () => requirement),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        requirement = { id: 'requirement-1', ...data };
        return requirement;
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    aiRun: {
      findUnique: vi.fn(async () => ({ ...run, messages: events, requirement })),
      findUniqueOrThrow: vi.fn(async () => ({ ...run })),
    },
    requirement: {
      findUnique: vi.fn(async () => requirement),
    },
  };
  const access = { assertMember: vi.fn(async () => undefined) };
  const requirements = { get: vi.fn(async (_userId: string, id: string) => ({ id })) };
  const ai = { complete: vi.fn(async () => 'offline fallback') };
  const service = new AiRunsService(
    prisma as never,
    access as never,
    requirements as never,
    ai as never,
  );
  return { service, run, events, tx, prisma, access, requirements, ai };
}

describe('AiRunsService', () => {
  it('advances the four fixed discovery steps and persists each draft field', async () => {
    const { service, run, events } = harness(AiRunStatus.ACTIVE);
    const answers = [
      'Reduce duplicate work',
      'Operations staff use the dashboard each morning',
      'Staff create and review a work item',
      'A saved item appears in the project list',
    ];

    for (const answer of answers) await service.addMessage('user-1', 'run-1', answer);

    expect(run.status).toBe(AiRunStatus.WAITING_CONFIRMATION);
    expect(run.step).toBe(AiRunStep.WAITING_CONFIRMATION);
    expect(run.draft).toMatchObject({
      backgroundGoal: answers[0],
      usersScenarios: [answers[1]],
      userStoriesFlows: [answers[2]],
      acceptanceCriteria: [answers[3]],
    });
    expect(
      events.filter((event) => event.eventType === AiRunEventType.MESSAGE_CREATED),
    ).toHaveLength(8);
    expect(events.at(-1)).toMatchObject({ eventType: AiRunEventType.RUN_WAITING_CONFIRMATION });
  });

  it('creates the requirement in the confirmation transaction and reuses it on retry', async () => {
    const { service, tx, prisma, requirements } = harness(AiRunStatus.WAITING_CONFIRMATION);

    await expect(service.confirm('user-1', 'run-1', {})).resolves.toMatchObject({
      id: 'requirement-1',
    });
    await expect(
      service.confirm('user-1', 'run-1', { title: 'Changed on retry' }),
    ).resolves.toMatchObject({
      id: 'requirement-1',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.requirement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aiRunId: 'run-1',
        projectId: 'project-1',
        description: expect.stringMatching(
          /## Background & Goal[\s\S]*## Users & Scenarios[\s\S]*## Stories\/Flows[\s\S]*## Acceptance Criteria/,
        ),
      }),
    });
    expect(requirements.get).toHaveBeenCalledTimes(2);
  });

  it('lets a failed AI step resume at the same discovery stage', async () => {
    const { service, run, events } = harness(AiRunStatus.FAILED, AiRunStep.USERS_SCENARIOS);

    await service.resume('user-1', 'run-1');

    expect(run.status).toBe(AiRunStatus.ACTIVE);
    expect(run.step).toBe(AiRunStep.USERS_SCENARIOS);
    expect(events.at(-1)).toMatchObject({ eventType: AiRunEventType.RUN_RESUMED });
  });
});
