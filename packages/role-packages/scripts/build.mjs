#!/usr/bin/env node
/**
 * 生成内置角色包：把 `roles/<roleKey>/guide.md` 转成带摘要的 manifest 与资源字节。
 *
 * 为什么需要生成而不是手写：manifest 里的 `sha256` / `byteLength` 必须与真实字节一致，
 * 而 `validateRolePackageInput` 会逐项复核；手写必然漂移。生成的 `src/generated.ts` 会被提交，
 * 因此构建产物可审计、可复现，且不需要运行时读文件。
 *
 * 摘要算法在服务端（shared 的 canonicalJson + sha256）再算一次并比对，
 * 所以这里只负责「算出资源摘要」，不负责 manifestDigest。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');

/** 每个角色的输出契约：kind 与 WorkMesh 的工件/文档类型一一对应。 */
const ROLE_SPECS = [
  {
    roleKey: 'product',
    title: '产品',
    inputs: [{ key: 'requirement', source: 'platform', kind: 'json', required: true }],
    outputs: [
      { key: 'understanding', channel: 'document', kind: 'UNDERSTANDING' },
      { key: 'prd', channel: 'document', kind: 'PRD' },
    ],
  },
  {
    roleKey: 'ui',
    title: 'UI 设计',
    inputs: [
      { key: 'published-prd', source: 'platform', kind: 'document-revision', required: true },
    ],
    outputs: [{ key: 'design', channel: 'artifact', kind: 'DESIGN' }],
  },
  {
    roleKey: 'frontend',
    title: '前端',
    inputs: [{ key: 'context-snapshot', source: 'platform', kind: 'json', required: true }],
    outputs: [{ key: 'impl', channel: 'artifact', kind: 'IMPL' }],
  },
  {
    roleKey: 'backend',
    title: '后端',
    inputs: [{ key: 'context-snapshot', source: 'platform', kind: 'json', required: true }],
    outputs: [{ key: 'impl', channel: 'artifact', kind: 'IMPL' }],
  },
  {
    roleKey: 'qa',
    title: '测试',
    inputs: [{ key: 'context-snapshot', source: 'platform', kind: 'json', required: true }],
    outputs: [{ key: 'cases', channel: 'artifact', kind: 'CASES' }],
  },
  {
    roleKey: 'ops',
    title: '运维',
    inputs: [{ key: 'context-snapshot', source: 'platform', kind: 'json', required: true }],
    outputs: [{ key: 'release', channel: 'artifact', kind: 'RELEASE' }],
  },
];

const VERSION = '1.0.0';
const PROTOCOL_VERSION = '1.0';
const CONTRACT_VERSION = '1.0';

function resourceOf(roleKey) {
  const relativePath = `roles/${roleKey}/guide.md`;
  const bytes = readFileSync(join(packageRoot, relativePath));
  return {
    id: 'guide',
    kind: 'prompt',
    path: relativePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mediaType: 'text/markdown',
    bodyBase64: bytes.toString('base64'),
  };
}

const packages = ROLE_SPECS.map((spec) => {
  const resource = resourceOf(spec.roleKey);
  const manifest = {
    packageSchemaVersion: '1.0',
    id: `workmesh.role.${spec.roleKey}`,
    version: VERSION,
    protocolVersion: PROTOCOL_VERSION,
    title: `${spec.title}角色包`,
    roleKey: spec.roleKey,
    compatibility: {
      minCliVersion: '1.0.0',
      maxCliVersionExclusive: '2.0.0',
      contractVersion: CONTRACT_VERSION,
    },
    inputs: spec.inputs.map((input) => ({ ...input, contractVersion: CONTRACT_VERSION })),
    outputs: spec.outputs.map((output) => ({ ...output, contractVersion: CONTRACT_VERSION })),
    resources: [
      {
        id: resource.id,
        kind: resource.kind,
        path: resource.path,
        sha256: resource.sha256,
        byteLength: resource.byteLength,
        mediaType: resource.mediaType,
      },
    ],
    agentEntries: [
      { host: 'codex', type: 'instructions', resourceId: resource.id, adapterVersion: VERSION },
      {
        host: 'claude-code',
        type: 'instructions',
        resourceId: resource.id,
        adapterVersion: VERSION,
      },
    ],
  };
  return {
    packageId: manifest.id,
    version: VERSION,
    roleKey: spec.roleKey,
    manifest,
    resources: [
      {
        resourceId: resource.id,
        path: resource.path,
        mediaType: resource.mediaType,
        sha256: resource.sha256,
        byteLength: resource.byteLength,
        bodyBase64: resource.bodyBase64,
      },
    ],
  };
});

const header = `// 由 scripts/build.mjs 生成，请勿手改。
// 修改 roles/<roleKey>/guide.md 后运行：pnpm --filter @workmesh/role-packages build
import type { RolePackageManifest } from '@workmesh/shared';

export type BuiltinRolePackageResource = {
  resourceId: string;
  path: string;
  mediaType: string;
  sha256: string;
  byteLength: number;
  bodyBase64: string;
};

export type BuiltinRolePackage = {
  packageId: string;
  version: string;
  roleKey: string;
  manifest: RolePackageManifest;
  resources: BuiltinRolePackageResource[];
};

`;

const body = `export const BUILTIN_ROLE_PACKAGES: BuiltinRolePackage[] = ${JSON.stringify(packages, null, 2)};\n`;

mkdirSync(join(packageRoot, 'src'), { recursive: true });
writeFileSync(join(packageRoot, 'src', 'generated.ts'), `${header}${body}`, 'utf8');
process.stdout.write(`generated ${packages.length} builtin role packages\n`);
