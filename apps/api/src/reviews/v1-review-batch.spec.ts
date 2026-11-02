import { describe, expect, it, vi } from 'vitest';
import { V1ReviewController } from './v1-review.controller';

const BATCH_KEY = '11111111-1111-4111-8111-111111111111';

function request() {
  return {
    v1Principal: {
      kind: 'HUMAN',
      userId: 'u-1',
      sessionId: 's-1',
      authVersion: 1,
    },
    method: 'POST',
    originalUrl: '/api/v1/review-requests/batch-decisions',
    requestId: 'req-1',
  } as never;
}

function dto() {
  return {
    decision: 'APPROVE',
    items: [
      {
        reviewId: '22222222-2222-4222-8222-222222222222',
        slotId: '33333333-3333-4333-8333-333333333333',
        expectedVersion: 1,
        confirmation: { ticketId: '44444444-4444-4444-8444-444444444444', ticketSecret: 'x' },
      },
      {
        reviewId: '55555555-5555-4555-8555-555555555555',
        slotId: '66666666-6666-4666-8666-666666666666',
        expectedVersion: 1,
        confirmation: { ticketId: '77777777-7777-4777-8777-777777777777', ticketSecret: 'y' },
      },
    ],
  } as never;
}

describe('批量决定', () => {
  it('逐条返回结果，部分失败不影响已成功条目', async () => {
    const decide = vi
      .fn()
      .mockResolvedValueOnce({ decisionId: 'd-1' })
      .mockRejectedValueOnce({ code: 'VERSION_CONFLICT', message: 'stale' });
    const controller = new V1ReviewController({ decide } as never);

    const result = await controller.batchDecide(request(), dto(), BATCH_KEY);

    expect(result.results).toEqual([
      { reviewId: '22222222-2222-4222-8222-222222222222', status: 'APPLIED', decisionId: 'd-1' },
      {
        reviewId: '55555555-5555-4555-8555-555555555555',
        status: 'VERSION_CONFLICT',
        message: 'stale',
      },
    ]);
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it('非 HUMAN 会话被拒绝', async () => {
    const controller = new V1ReviewController({ decide: vi.fn() } as never);
    const agentRequest = {
      ...request(),
      v1Principal: { kind: 'AGENT', userId: 'u-1', sessionId: null, authVersion: 1 },
    } as never;

    await expect(controller.batchDecide(agentRequest, dto(), BATCH_KEY)).rejects.toMatchObject({
      code: 'HUMAN_SESSION_REQUIRED',
    });
  });
});
