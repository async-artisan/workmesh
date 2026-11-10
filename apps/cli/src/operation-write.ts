import { asCliError, CliError } from './errors';
import { canonicalJson } from '@workmesh/shared';
import {
  assertReusable,
  beginOperation,
  finishOperation,
  readReceipt,
  requestDigestOf,
  type SourceFile,
  type ExecutionLink,
} from './receipts';

type WriteResponse = { data: unknown; requestId: string };

export type ReceiptWriteInput = {
  workspaceDir: string;
  scopeKey: string;
  credentialId: string;
  operationId: string;
  method: 'POST' | 'PATCH' | 'PUT';
  route: string;
  body: unknown;
  sourceFiles?: SourceFile[];
  execution?: ExecutionLink;
  resultRefs?: (data: unknown) => Record<string, string | number | null>;
  request: (operationId: string) => Promise<WriteResponse>;
};

/** Persist the original operation before sending, and expose uncertainty without retrying it. */
export async function executeReceiptWrite(
  input: ReceiptWriteInput,
): Promise<WriteResponse & { operationId: string }> {
  const digest = await requestDigestOf(input.method, input.route, input.body);
  let existing;
  try {
    existing = await readReceipt(input.workspaceDir, input.operationId);
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'RESOURCE_NOT_FOUND') throw error;
  }
  if (existing) {
    assertReusable(existing, {
      scopeKey: input.scopeKey,
      credentialId: input.credentialId,
      requestDigest: digest,
    });
    if (canonicalJson(existing.execution ?? null) !== canonicalJson(input.execution ?? null))
      throw new CliError('IDEMPOTENCY_CONFLICT', 'operation 已绑定其他本地执行，不能重新关联');
  } else {
    await beginOperation({
      workspaceDir: input.workspaceDir,
      operationId: input.operationId,
      scopeKey: input.scopeKey,
      credentialId: input.credentialId,
      method: input.method,
      relativeRoute: input.route,
      requestDigest: digest,
      sourceFiles: input.sourceFiles ?? [],
      execution: input.execution,
    });
  }

  let response: WriteResponse;
  try {
    response = await input.request(input.operationId);
  } catch (error) {
    const failure = asCliError(error);
    const rejected =
      failure.status !== undefined &&
      failure.status >= 400 &&
      failure.status < 500 &&
      failure.status !== 408 &&
      failure.status !== 429 &&
      failure.code !== 'IDEMPOTENCY_CONFLICT' &&
      existing?.status !== 'COMMITTED' &&
      existing?.status !== 'PENDING';
    if (rejected) {
      // A failure to update a local receipt must not hide the server's original rejection.
      await finishOperation(input.workspaceDir, input.operationId, 'REJECTED', {}).catch(() => {});
    }
    throw new CliError(failure.code, failure.message, {
      status: failure.status,
      requestId: failure.requestId,
      exitCode: failure.exitCode,
      details: {
        ...failure.details,
        operationId: input.operationId,
        operationOutcome: rejected ? 'REJECTED' : 'UNKNOWN',
        recoveryAction: rejected ? 'REVIEW_REJECTION' : 'RECONCILE',
      },
    });
  }

  try {
    const resultRefs = input.resultRefs?.(response.data) ?? {};
    await finishOperation(input.workspaceDir, input.operationId, 'COMMITTED', resultRefs);
  } catch {
    // The server response has arrived; asking the user to create another operation could duplicate it.
    throw new CliError(
      'LOCAL_RECEIPT_UPDATE_FAILED',
      '服务端已返回成功，但本地操作记录未完成更新。',
      {
        requestId: response.requestId,
        exitCode: 9,
        details: {
          operationId: input.operationId,
          operationOutcome: 'COMMITTED',
          recoveryAction: 'RECONCILE',
        },
      },
    );
  }
  return { ...response, operationId: input.operationId };
}
