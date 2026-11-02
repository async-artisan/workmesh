import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { sha256Bytes } from '@workmesh/shared';
import { CliError } from './errors';
import type { SourceFile } from './receipts';

export type CandidateKind = 'UNDERSTANDING' | 'DECISION' | 'PRD' | 'KNOWLEDGE';

const KINDS: CandidateKind[] = ['UNDERSTANDING', 'DECISION', 'PRD', 'KNOWLEDGE'];
const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const MIME: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

export type CandidateRequest = {
  knowledgeBaseId?: string;
  kind: CandidateKind;
  file: string;
  title?: string;
  requirementId?: string;
  documentId?: string;
  basisUnderstandingRevisionId?: string;
  deliveryScope?: unknown;
  acceptance?: unknown;
};

export type CandidatePayload = {
  relativeRoute: string;
  body: Record<string, unknown>;
  sourceFiles: SourceFile[];
  title: string;
};

/** Parse inline JSON or `@path/to/file.json` without treating the file as candidate content. */
export async function parseCandidateJson(value: string, optionName: string): Promise<unknown> {
  const source = value.startsWith('@') ? value.slice(1) : value;
  if (!source) throw new CliError('LOCAL_INPUT_INVALID', `${optionName} 不能为空`);
  let text = source;
  if (value.startsWith('@')) {
    const path = resolve(source);
    try {
      text = await readFile(path, 'utf8');
    } catch {
      throw new CliError('LOCAL_INPUT_INVALID', `${optionName} 无法读取 JSON 文件：${path}`);
    }
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CliError('LOCAL_INPUT_INVALID', `${optionName} 必须是合法 JSON，或使用 @<path> 指定 JSON 文件`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validatePrdBinding(request: CandidateRequest): void {
  if (!request.basisUnderstandingRevisionId)
    throw new CliError('VALIDATION_FAILED', 'PRD 候选必须显式提供 --basis-understanding-revision <uuid>');
  if (!UUID.test(request.basisUnderstandingRevisionId))
    throw new CliError('VALIDATION_FAILED', '--basis-understanding-revision 必须是 UUID');

  const scope = request.deliveryScope;
  if (!isRecord(scope)) throw new CliError('VALIDATION_FAILED', '--delivery-scope 必须是 JSON 对象或 @<path>');
  const participating = scope.participatingRoleIds;
  const outputKinds = scope.requiredOutputKinds;
  const excluded = scope.excludedRoles ?? [];
  if (!Array.isArray(participating) || participating.length === 0 || participating.some((id) => typeof id !== 'string' || !id))
    throw new CliError('VALIDATION_FAILED', '--delivery-scope.participatingRoleIds 必须是非空字符串数组');
  if (!Array.isArray(outputKinds) || outputKinds.length === 0 || outputKinds.some((kind) => typeof kind !== 'string'))
    throw new CliError('VALIDATION_FAILED', '--delivery-scope.requiredOutputKinds 必须是非空字符串数组');
  if (!outputKinds.includes('IMPL'))
    throw new CliError('VALIDATION_FAILED', '--delivery-scope.requiredOutputKinds 必须包含 IMPL');
  if (!Array.isArray(excluded)) throw new CliError('VALIDATION_FAILED', '--delivery-scope.excludedRoles 必须是数组');
  for (const entry of excluded) {
    if (!isRecord(entry) || typeof entry.roleId !== 'string' || !entry.roleId || typeof entry.reason !== 'string' || !entry.reason.trim())
      throw new CliError('VALIDATION_FAILED', '--delivery-scope.excludedRoles 必须是 {roleId, reason} 数组');
  }

  const acceptance = request.acceptance;
  if (!Array.isArray(acceptance) || acceptance.length === 0)
    throw new CliError('VALIDATION_FAILED', '--acceptance 必须是非空 JSON 数组或 @<path>');
  if (acceptance.length > 200) throw new CliError('VALIDATION_FAILED', '--acceptance 最多包含 200 条验收条款');
  const keyPattern = /^[a-z][a-z0-9-]{1,63}$/;
  const keys = new Set<string>();
  for (const item of acceptance) {
    if (!isRecord(item)) throw new CliError('VALIDATION_FAILED', '--acceptance 每项必须是 {key, text, verification}');
    if (typeof item.key !== 'string' || !keyPattern.test(item.key) || keys.has(item.key))
      throw new CliError('VALIDATION_FAILED', '--acceptance.key 必须唯一且匹配 [a-z][a-z0-9-]{1,63}');
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000)
      throw new CliError('VALIDATION_FAILED', '--acceptance.text 长度必须为 1–2000');
    if (item.verification !== 'TEST' && item.verification !== 'INSPECTION' && item.verification !== 'DEMO')
      throw new CliError('VALIDATION_FAILED', '--acceptance.verification 仅支持 TEST/INSPECTION/DEMO');
    keys.add(item.key);
  }
}

/** 只提交显式选定的单个文件；不扫描目录、不上传聊天、不自动发布。 */
export async function buildCandidate(
  projectId: string,
  request: CandidateRequest,
): Promise<CandidatePayload> {
  if (!UUID.test(projectId)) throw new CliError('VALIDATION_FAILED', '工作区 projectId 非法');
  if (request.knowledgeBaseId !== undefined && !UUID.test(request.knowledgeBaseId))
    throw new CliError('VALIDATION_FAILED', '--kb 必须是 UUID');
  if (!request.documentId && !request.knowledgeBaseId)
    throw new CliError('VALIDATION_FAILED', '创建新文档时必须提供 --kb <uuid>');
  if (!KINDS.includes(request.kind))
    throw new CliError('VALIDATION_FAILED', `--kind 必须是 ${KINDS.join('|')}`);
  if (request.requirementId !== undefined && !UUID.test(request.requirementId))
    throw new CliError('VALIDATION_FAILED', '--requirement 必须是 UUID');
  if (request.documentId !== undefined && !UUID.test(request.documentId))
    throw new CliError('VALIDATION_FAILED', '--document 必须是 UUID');
  if ((request.kind === 'UNDERSTANDING' || request.kind === 'PRD') && !request.requirementId && !request.documentId)
    throw new CliError('VALIDATION_FAILED', `${request.kind} 候选必须显式提供 --requirement <uuid>`);

  if (request.kind === 'PRD') validatePrdBinding(request);
  else if (
    request.basisUnderstandingRevisionId !== undefined ||
    request.deliveryScope !== undefined ||
    request.acceptance !== undefined
  )
    throw new CliError('VALIDATION_FAILED', 'basisUnderstanding/deliveryScope/acceptance 仅适用于 PRD 候选');

  const path = resolve(request.file);
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await readFile(path));
  } catch {
    throw new CliError('LOCAL_INPUT_INVALID', `无法读取候选文件：${path}`);
  }
  const digest = await sha256Bytes(new Uint8Array(bytes));
  const mimeType = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const title = (request.title ?? basename(path)).slice(0, 200);
  const body: Record<string, unknown> = {
    title,
    mimeType,
    bodyBase64: bytes.toString('base64'),
  };
  if (request.basisUnderstandingRevisionId) body.basisUnderstandingRevisionId = request.basisUnderstandingRevisionId;
  if (request.deliveryScope !== undefined) body.deliveryScope = request.deliveryScope;
  if (request.acceptance !== undefined) body.acceptance = request.acceptance;
  const sourceFiles = [{ path, sha256: digest, byteLength: bytes.length }];
  if (request.documentId) {
    return {
      relativeRoute: `/documents/${encodeURIComponent(request.documentId)}/revisions`,
      body,
      sourceFiles,
      title,
    };
  }
  body.knowledgeBaseId = request.knowledgeBaseId;
  body.kind = request.kind;
  if (request.requirementId) body.requirementId = request.requirementId;
  return {
    relativeRoute: `/projects/${encodeURIComponent(projectId)}/documents`,
    body,
    sourceFiles,
    title,
  };
}
