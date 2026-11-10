import { asCliError, CliError } from './errors';
import { assertReusable, finishOperation, readReceipt } from './receipts';

export async function reconcileOperation(input: {
  workspaceDir: string;
  operationId: string;
  scopeKey: string;
  credentialId: string;
  projectId: string;
  apiBasePath: string;
  fetchReceipt: () => Promise<unknown>;
}) {
  const local = await readReceipt(input.workspaceDir, input.operationId);
  assertReusable(local, { ...input, requestDigest: local.requestDigest });
  let value: unknown;
  try {
    value = await input.fetchReceipt();
  } catch (error) {
    const failure = asCliError(error);
    // A uniform 404 also covers inaccessible or not-yet-committed records.
    // It is not evidence that a timed-out request can safely be sent under a new key.
    throw new CliError(
      failure.code,
      failure.status === 404
        ? '暂未取得可访问的已提交收据，原操作结果仍待核对。请保留原操作编号与凭据后再次核对。'
        : failure.message,
      {
        status: failure.status,
        requestId: failure.requestId,
        exitCode: failure.exitCode,
        details: {
          ...failure.details,
          operationId: input.operationId,
          operationOutcome: 'UNKNOWN',
          recoveryAction: 'RECONCILE',
        },
      },
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('PROTOCOL_INVALID', '服务端 receipt 结构非法');
  const server = value as Record<string, unknown>;
  if (server.status !== 'COMMITTED')
    throw new CliError('PROTOCOL_INVALID', `服务端 receipt 状态非法：${String(server.status)}`);
  const normalize = (route: string) => route.split('?')[0].replace(/\/+$/, '') || '/';
  const localRoute = normalize(local.relativeRoute);
  // Local and server digests intentionally use different canonical payloads.
  // Match operation identity, authenticated project, method and known route forms instead.
  if (
    server.operationKey !== input.operationId ||
    server.projectId !== input.projectId ||
    server.method !== local.method ||
    typeof server.route !== 'string' ||
    ![
      localRoute,
      normalize(`${input.apiBasePath}${localRoute}`),
      normalize(`/api/v1${localRoute}`),
    ].includes(normalize(server.route))
  )
    throw new CliError(
      'CONTENT_INTEGRITY_FAILED',
      '服务端操作身份或范围与本地记录不一致；已保留本地状态。',
      {
        details: { operationId: input.operationId, operationOutcome: 'UNKNOWN' },
      },
    );
  const refs = server.resultRefs;
  if (!refs || typeof refs !== 'object' || Array.isArray(refs))
    throw new CliError('PROTOCOL_INVALID', '服务端 resultRefs 非法');
  const resultRefs: Record<string, string | number | null> = {};
  for (const [key, ref] of Object.entries(refs)) {
    if (
      typeof ref === 'string' ||
      (typeof ref === 'number' && Number.isFinite(ref)) ||
      ref === null
    )
      resultRefs[key] = ref;
    else throw new CliError('PROTOCOL_INVALID', `服务端 resultRefs.${key} 非法`);
  }
  const updated = await finishOperation(
    input.workspaceDir,
    input.operationId,
    'COMMITTED',
    resultRefs,
  );
  return { local, updated, server, resultRefs };
}
