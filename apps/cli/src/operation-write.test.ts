import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliError } from './errors';
import { executeReceiptWrite, type ReceiptWriteInput } from './operation-write';
import * as receipts from './receipts';

afterEach(() => vi.restoreAllMocks());

async function input(): Promise<ReceiptWriteInput> {
  return {
    workspaceDir: await mkdtemp(join(tmpdir(), 'wm-operation-')),
    scopeKey: 'scope',
    credentialId: randomUUID(),
    operationId: randomUUID(),
    method: 'POST',
    route: '/tasks/task/claims',
    body: { expectedVersion: 3 },
    resultRefs: () => ({ claimId: 'claim' }),
    request: async () => ({ data: { claimId: 'claim' }, requestId: 'req-success' }),
  };
}

describe('receipt-backed writes', () => {
  it('records PENDING before sending and commits safe references after success', async () => {
    const write = await input();
    write.request = vi.fn(async (operationId) => {
      expect(operationId).toBe(write.operationId);
      expect((await receipts.readReceipt(write.workspaceDir, operationId)).status).toBe('PENDING');
      return { data: { claimId: 'claim', secret: 'never-persist' }, requestId: 'req-success' };
    });
    await expect(executeReceiptWrite(write)).resolves.toMatchObject({
      operationId: write.operationId,
    });
    expect(await receipts.readReceipt(write.workspaceDir, write.operationId)).toMatchObject({
      status: 'COMMITTED',
      resultRefs: { claimId: 'claim' },
    });
    expect(write.request).toHaveBeenCalledOnce();
  });

  it.each([undefined, 408, 429, 500, 503])(
    'keeps uncertain outcome %s pending, with no automatic retry',
    async (status) => {
      const write = await input();
      write.request = vi.fn(async () => {
        throw new CliError('NETWORK_TIMEOUT', 'lost response', { status, requestId: 'req-lost' });
      });
      await expect(executeReceiptWrite(write)).rejects.toMatchObject({
        code: 'NETWORK_TIMEOUT',
        requestId: 'req-lost',
        details: {
          operationId: write.operationId,
          operationOutcome: 'UNKNOWN',
          recoveryAction: 'RECONCILE',
        },
      });
      expect((await receipts.readReceipt(write.workspaceDir, write.operationId)).status).toBe(
        'PENDING',
      );
      expect(write.request).toHaveBeenCalledOnce();
    },
  );

  it('records a definite rejection without concealing the original error', async () => {
    const write = await input();
    write.request = async () => {
      throw new CliError('VERSION_CONFLICT', 'changed', { status: 409, requestId: 'req-conflict' });
    };
    await expect(executeReceiptWrite(write)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
      requestId: 'req-conflict',
      exitCode: 5,
      details: { operationOutcome: 'REJECTED' },
    });
    expect((await receipts.readReceipt(write.workspaceDir, write.operationId)).status).toBe(
      'REJECTED',
    );
  });

  it('replays the original key only for identical intent and never downgrades a committed receipt', async () => {
    const write = await input();
    await executeReceiptWrite(write);
    await expect(
      executeReceiptWrite({ ...write, body: { expectedVersion: 4 } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const replay = vi.fn(async () => ({ data: {}, requestId: 'replay' }));
    await executeReceiptWrite({ ...write, request: replay });
    expect(replay).toHaveBeenCalledWith(write.operationId);
    await expect(
      executeReceiptWrite({
        ...write,
        request: async () => {
          throw new CliError('FORBIDDEN', 'revoked', { status: 403 });
        },
      }),
    ).rejects.toMatchObject({ details: { operationOutcome: 'UNKNOWN' } });
    expect((await receipts.readReceipt(write.workspaceDir, write.operationId)).status).toBe(
      'COMMITTED',
    );
  });

  it('does not call an idempotency conflict proof of rejection', async () => {
    const write = await input();
    write.request = async () => {
      throw new CliError('IDEMPOTENCY_CONFLICT', 'already used', { status: 409 });
    };
    await expect(executeReceiptWrite(write)).rejects.toMatchObject({
      details: { operationOutcome: 'UNKNOWN' },
    });
    expect((await receipts.readReceipt(write.workspaceDir, write.operationId)).status).toBe(
      'PENDING',
    );
  });

  it('keeps an earlier uncertain write pending if a later replay loses authorization', async () => {
    const write = await input();
    await expect(
      executeReceiptWrite({
        ...write,
        request: async () => {
          throw new CliError('NETWORK_TIMEOUT', 'lost');
        },
      }),
    ).rejects.toMatchObject({ details: { operationOutcome: 'UNKNOWN' } });
    await expect(
      executeReceiptWrite({
        ...write,
        request: async () => {
          throw new CliError('FORBIDDEN', 'revoked', { status: 403 });
        },
      }),
    ).rejects.toMatchObject({ details: { operationOutcome: 'UNKNOWN' } });
    expect((await receipts.readReceipt(write.workspaceDir, write.operationId)).status).toBe(
      'PENDING',
    );
  });

  it('reports a confirmed server success even if saving the local receipt fails', async () => {
    const write = await input();
    vi.spyOn(receipts, 'finishOperation').mockRejectedValue(new Error('disk unavailable'));
    await expect(executeReceiptWrite(write)).rejects.toMatchObject({
      code: 'LOCAL_RECEIPT_UPDATE_FAILED',
      requestId: 'req-success',
      details: { operationOutcome: 'COMMITTED', recoveryAction: 'RECONCILE' },
    });
  });
});
