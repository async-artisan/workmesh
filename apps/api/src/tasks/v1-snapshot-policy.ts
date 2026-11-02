import { canonicalJson, sha256Bytes } from '@workmesh/shared';

export type V1SnapshotRefKind = 'DOCUMENT_REVISION' | 'ARTIFACT' | 'ROLE_RESOURCE';
export type V1SnapshotAuthority = 'PUBLISHED' | 'CANDIDATE';

/** manifest 中的资源行只含可验证定位与摘要，不含正文、本机路径或可被服务器任意读取的 URL。 */
export type V1SnapshotManifestResource = {
  refId: string;
  kind: V1SnapshotRefKind;
  targetId: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
  authority: V1SnapshotAuthority;
};

export type V1SnapshotManifest = {
  schemaVersion: '1.0';
  projectId: string;
  requirementId: string;
  requirementGeneration: number;
  taskId: string;
  taskGeneration: number;
  workflowDefinitionRevisionId: string;
  workflowDigest: string;
  knowledgeBindingsVersion: number;
  stepKey: string;
  baselinePolicy: 'NONE' | 'PUBLISHED_PRD';
  productBaseline: null | {
    understandingRevisionId: string;
    prdRevisionId: string;
    prdSha256: string;
    deliveryScopeDigest: string;
  };
  resources: V1SnapshotManifestResource[];
};

const DIGEST = /^[0-9a-f]{64}$/;

/** refId 字典序（按 UTF-16 code unit 比较），保证跨语言稳定排序。 */
export function compareRefId(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * 组装确定性 manifest 并计算 digest；重复 refId、摘要非法或字长非法直接拒绝，
 * 不生成“部分可误用”的快照。
 */
export async function assembleSnapshotManifest(
  input: Omit<V1SnapshotManifest, 'schemaVersion' | 'resources'> & {
    resources: V1SnapshotManifestResource[];
  },
): Promise<{ manifest: V1SnapshotManifest; manifestDigest: string }> {
  const seen = new Set<string>();
  for (const resource of input.resources) {
    if (seen.has(resource.refId)) throw new Error(`SNAPSHOT_REF_DUPLICATE:${resource.refId}`);
    seen.add(resource.refId);
    if (!DIGEST.test(resource.sha256))
      throw new Error(`SNAPSHOT_REF_DIGEST_INVALID:${resource.refId}`);
    if (!Number.isSafeInteger(resource.byteLength) || resource.byteLength < 0)
      throw new Error(`SNAPSHOT_REF_LENGTH_INVALID:${resource.refId}`);
    if (!resource.mediaType) throw new Error(`SNAPSHOT_REF_MEDIA_TYPE_INVALID:${resource.refId}`);
  }
  const manifest: V1SnapshotManifest = {
    ...input,
    schemaVersion: '1.0',
    resources: [...input.resources].sort((left, right) => compareRefId(left.refId, right.refId)),
  };
  const manifestDigest = await sha256Bytes(new TextEncoder().encode(canonicalJson(manifest)));
  return { manifest, manifestDigest };
}

/** 交付范围摘要：deliveryScope 为 null 时用稳定占位，避免“null 与空对象”不同摘要歧义。 */
export async function deliveryScopeDigestOf(deliveryScope: unknown): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(canonicalJson(deliveryScope ?? null)));
}
