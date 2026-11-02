import {
  canonicalJson,
  compareSemver,
  isStrictSemver,
  sha256Bytes,
  validateRolePackage,
  type RolePackageManifest,
} from '@workmesh/shared';

export const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_TOTAL_RESOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 16 * 1024 * 1024;

export type V1RolePackageIssue = { path: string; code: string; message: string };

export type V1RolePackageResourceInput = { resourceId: string; bodyBytes: Uint8Array };

export type V1NormalizedPackageResource = {
  resourceId: string;
  path: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  bodyBytes: Uint8Array;
};

export type V1RolePackageValidation = {
  valid: boolean;
  issues: V1RolePackageIssue[];
  manifest: RolePackageManifest | null;
  manifestDigest: string | null;
  resources: V1NormalizedPackageResource[];
};

function isSafeRelativePath(path: string): boolean {
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  const segments = path.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

/**
 * 角色包接收条件：严格 manifest schema、SemVer、路径安全、资源逐项摘要与大小。
 * 只做纯策略，不读写数据库；服务端另行检查 roleKey 与内置包 shadow。
 */
export async function validateRolePackageInput(
  manifestInput: unknown,
  provided: V1RolePackageResourceInput[],
): Promise<V1RolePackageValidation> {
  const issues: V1RolePackageIssue[] = [];
  const schema = validateRolePackage(manifestInput);
  if (!schema.valid) {
    return {
      valid: false,
      issues: schema.issues.map((issue) => ({
        path: issue.path,
        code: 'MANIFEST_INVALID',
        message: issue.message,
      })),
      manifest: null,
      manifestDigest: null,
      resources: [],
    };
  }
  const manifest = manifestInput as RolePackageManifest;

  for (const [path, value] of [
    ['/version', manifest.version],
    ['/compatibility/minCliVersion', manifest.compatibility.minCliVersion],
    ['/compatibility/maxCliVersionExclusive', manifest.compatibility.maxCliVersionExclusive],
    ...manifest.agentEntries.map(
      (entry, index) =>
        [`/agentEntries/${index}/adapterVersion` as string, entry.adapterVersion] as const,
    ),
  ] as Array<[string, string]>) {
    if (!isStrictSemver(value))
      issues.push({
        path,
        code: 'SEMVER_INVALID',
        message: 'value must be a strict SemVer 2.0 string',
      });
  }
  if (
    isStrictSemver(manifest.compatibility.minCliVersion) &&
    isStrictSemver(manifest.compatibility.maxCliVersionExclusive) &&
    compareSemver(
      manifest.compatibility.minCliVersion,
      manifest.compatibility.maxCliVersionExclusive,
    ) >= 0
  ) {
    issues.push({
      path: '/compatibility',
      code: 'COMPATIBILITY_RANGE_INVALID',
      message: 'minCliVersion must be lower than maxCliVersionExclusive',
    });
  }

  const resourceIds = new Set<string>();
  const paths = new Set<string>();
  for (const [index, resource] of manifest.resources.entries()) {
    if (resourceIds.has(resource.id))
      issues.push({
        path: `/resources/${index}/id`,
        code: 'RESOURCE_DUPLICATE',
        message: 'resource id is duplicated',
      });
    resourceIds.add(resource.id);
    if (paths.has(resource.path))
      issues.push({
        path: `/resources/${index}/path`,
        code: 'RESOURCE_PATH_DUPLICATE',
        message: 'resource path is duplicated',
      });
    paths.add(resource.path);
    if (!isSafeRelativePath(resource.path))
      issues.push({
        path: `/resources/${index}/path`,
        code: 'RESOURCE_PATH_UNSAFE',
        message: 'path must be a safe POSIX relative path',
      });
    if (resource.byteLength > MAX_RESOURCE_BYTES)
      issues.push({
        path: `/resources/${index}/byteLength`,
        code: 'RESOURCE_TOO_LARGE',
        message: 'resource exceeds 4 MiB',
      });
  }

  for (const output of manifest.outputs) {
    if (output.templateResourceId && !resourceIds.has(output.templateResourceId))
      issues.push({
        path: '/outputs',
        code: 'RESOURCE_UNKNOWN',
        message: 'templateResourceId must reference a declared resource',
      });
  }
  const hosts = new Set<string>();
  for (const [index, entry] of manifest.agentEntries.entries()) {
    if (hosts.has(entry.host))
      issues.push({
        path: `/agentEntries/${index}/host`,
        code: 'AGENT_ENTRY_DUPLICATE',
        message: 'each host may appear at most once',
      });
    hosts.add(entry.host);
    if (!resourceIds.has(entry.resourceId))
      issues.push({
        path: `/agentEntries/${index}/resourceId`,
        code: 'RESOURCE_UNKNOWN',
        message: 'agent entry must reference a declared resource',
      });
  }

  const providedIds = new Set<string>();
  for (const [index, item] of provided.entries()) {
    if (providedIds.has(item.resourceId))
      issues.push({
        path: `/resources/${index}/resourceId`,
        code: 'RESOURCE_DUPLICATE',
        message: 'uploaded resource id is duplicated',
      });
    providedIds.add(item.resourceId);
    if (!resourceIds.has(item.resourceId))
      issues.push({
        path: `/resources/${index}/resourceId`,
        code: 'RESOURCE_UNKNOWN',
        message: 'uploaded resource is not declared by the manifest',
      });
    if (item.bodyBytes.byteLength > MAX_RESOURCE_BYTES)
      issues.push({
        path: `/resources/${index}`,
        code: 'RESOURCE_TOO_LARGE',
        message: 'resource exceeds 4 MiB',
      });
  }
  for (const resource of manifest.resources) {
    if (!providedIds.has(resource.id))
      issues.push({
        path: '/resources',
        code: 'RESOURCE_MISSING',
        message: `resource ${resource.id} is not uploaded`,
      });
  }

  const normalized: V1NormalizedPackageResource[] = [];
  let total = 0;
  for (const item of provided) {
    const declared = manifest.resources.find((resource) => resource.id === item.resourceId);
    if (!declared) continue;
    total += item.bodyBytes.byteLength;
    const sha256 = await sha256Bytes(item.bodyBytes);
    if (sha256 !== declared.sha256)
      issues.push({
        path: `/resources/${item.resourceId}/sha256`,
        code: 'RESOURCE_DIGEST_MISMATCH',
        message: 'resource bytes do not match the declared digest',
      });
    if (item.bodyBytes.byteLength !== declared.byteLength)
      issues.push({
        path: `/resources/${item.resourceId}/byteLength`,
        code: 'RESOURCE_LENGTH_MISMATCH',
        message: 'resource bytes do not match the declared length',
      });
    normalized.push({
      resourceId: declared.id,
      path: declared.path,
      mediaType: declared.mediaType,
      byteLength: item.bodyBytes.byteLength,
      sha256,
      bodyBytes: item.bodyBytes,
    });
  }
  if (total > MAX_TOTAL_RESOURCE_BYTES)
    issues.push({
      path: '/resources',
      code: 'RESOURCE_TOTAL_TOO_LARGE',
      message: 'total raw resource bytes exceed 10 MiB',
    });

  if (issues.length > 0)
    return { valid: false, issues, manifest: null, manifestDigest: null, resources: [] };

  const manifestDigest = await sha256Bytes(new TextEncoder().encode(canonicalJson(manifest)));
  return { valid: true, issues: [], manifest, manifestDigest, resources: normalized };
}
