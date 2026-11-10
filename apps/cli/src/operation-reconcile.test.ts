import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CliError } from './errors';
import { reconcileOperation } from './operation-reconcile';
import { beginOperation, readReceipt } from './receipts';

async function scenario() {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'wm-reconcile-'));
  const operationId = randomUUID();
  const local = await beginOperation({
    workspaceDir,
    operationId,
    scopeKey: 'scope',
    credentialId: 'credential',
    method: 'POST',
    relativeRoute: '/tasks/task/claims',
    requestDigest: 'a'.repeat(64),
    sourceFiles: [],
  });
  const server = {
    operationKey: operationId,
    status: 'COMMITTED',
    projectId: 'project',
    method: 'POST',
    route: '/api/v1/tasks/task/claims',
    requestDigest: 'b'.repeat(64),
    resultRefs: { claimId: 'claim', version: 4 },
    committedAt: '2026-11-09T00:00:00Z',
  };
  const args = {
    workspaceDir,
    operationId,
    scopeKey: 'scope',
    credentialId: 'credential',
    projectId: 'project',
    apiBasePath: '/proxy/api/v1',
    fetchReceipt: vi.fn(async () => server),
  };
  return { local, server, args };
}

describe('reconcile original operation', () => {
  it('accepts different local/server digest formats with matching identity, storing both separately', async () => {
    const { args } = await scenario();
    const result = await reconcileOperation(args);
    expect(result.updated.status).toBe('COMMITTED');
    expect(result.updated.requestDigest).toBe('a'.repeat(64));
    expect(result.server.requestDigest).toBe('b'.repeat(64));
  });
  it.each(['operationKey', 'projectId', 'method', 'route'])(
    'preserves pending when server %s is inconsistent',
    async (field) => {
      const { args, server } = await scenario();
      await expect(
        reconcileOperation({
          ...args,
          fetchReceipt: async () => ({ ...server, [field]: 'different' }),
        }),
      ).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILED' });
      expect((await readReceipt(args.workspaceDir, args.operationId)).status).toBe('PENDING');
    },
  );
  it('does not query under a different credential or scope', async () => {
    const { args } = await scenario();
    await expect(reconcileOperation({ ...args, credentialId: 'other' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(args.fetchReceipt).not.toHaveBeenCalled();
  });
  it('keeps 404 uncertain and retains the original pending operation', async () => {
    const { args } = await scenario();
    await expect(
      reconcileOperation({
        ...args,
        fetchReceipt: async () => {
          throw new CliError('RESOURCE_NOT_FOUND', 'not found', { status: 404 });
        },
      }),
    ).rejects.toMatchObject({
      details: { operationOutcome: 'UNKNOWN', operationId: args.operationId },
    });
    expect((await readReceipt(args.workspaceDir, args.operationId)).status).toBe('PENDING');
  });
});
