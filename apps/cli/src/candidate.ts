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
  knowledgeBaseId: string;
  kind: CandidateKind;
  file: string;
  title?: string;
  requirementId?: string;
  documentId?: string;
};

export type CandidatePayload = {
  relativeRoute: string;
  body: Record<string, unknown>;
  sourceFiles: SourceFile[];
  title: string;
};

/** 只提交显式选定的单个文件；不扫描目录、不上传聊天、不自动发布。 */
export async function buildCandidate(
  projectId: string,
  request: CandidateRequest,
): Promise<CandidatePayload> {
  if (!UUID.test(projectId)) throw new CliError('VALIDATION_FAILED', '工作区 projectId 非法');
  if (!UUID.test(request.knowledgeBaseId))
    throw new CliError('VALIDATION_FAILED', '--kb 必须是 UUID');
  if (!KINDS.includes(request.kind))
    throw new CliError('VALIDATION_FAILED', `--kind 必须是 ${KINDS.join('|')}`);
  if (request.requirementId !== undefined && !UUID.test(request.requirementId))
    throw new CliError('VALIDATION_FAILED', '--requirement 必须是 UUID');
  if (request.documentId !== undefined && !UUID.test(request.documentId))
    throw new CliError('VALIDATION_FAILED', '--document 必须是 UUID');
  if ((request.kind === 'UNDERSTANDING' || request.kind === 'PRD') && !request.requirementId)
    throw new CliError('VALIDATION_FAILED', `${request.kind} 候选必须显式提供 --requirement <uuid>`);

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
  if (request.documentId) {
    if (request.requirementId) body.requirementId = request.requirementId;
    return {
      relativeRoute: `/documents/${encodeURIComponent(request.documentId)}/revisions`,
      body,
      sourceFiles: [{ path, sha256: digest, byteLength: bytes.length }],
      title,
    };
  }
  body.knowledgeBaseId = request.knowledgeBaseId;
  body.kind = request.kind;
  if (request.requirementId) body.requirementId = request.requirementId;
  return {
    relativeRoute: `/projects/${encodeURIComponent(projectId)}/documents`,
    body,
    sourceFiles: [{ path, sha256: digest, byteLength: bytes.length }],
    title,
  };
}
