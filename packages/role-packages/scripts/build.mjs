#!/usr/bin/env node
/**
 * 生成内置角色包：把 `roles/<roleKey>/` 下的内容转成带摘要的 manifest 与资源字节。
 *
 * 为什么需要生成而不是手写：manifest 里的 `sha256` / `byteLength` 必须与真实字节一致，
 * 而 `validateRolePackageInput` 会逐项复核；手写必然漂移。生成的 `src/generated.ts` 会被提交，
 * 因此构建产物可审计、可复现，且不需要运行时读文件。
 *
 * 摘要算法在服务端（shared 的 canonicalJson + sha256）再算一次并比对，
 * 所以这里只负责「算出资源摘要」，不负责 manifestDigest。
 *
 * 目录约定：
 *   roles/<roleKey>/
 *   ├── package.meta.json      # 身份、兼容性、inputs/outputs、agentEntries
 *   ├── guide.md               # 角色入口（短）
 *   ├── skills/<skill>/SKILL.md
 *   ├── assets/templates/*     # 工件模板
 *   ├── checklists/*           # 交付前自检
 *   └── references/*.json      # 只放指针
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateAcceptanceTemplates,
  validateCaseTemplate,
  validateResourceRecords,
  validateSkillFrontmatter,
} from './validation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const rolesRoot = join(packageRoot, 'roles');
const SKIP = new Set(['manifest.json', 'package.meta.json']);

const acceptanceTemplate = validateAcceptanceTemplates(
  readFileSync(join(rolesRoot, 'product/assets/templates/acceptance.yaml'), 'utf8'),
  readFileSync(join(rolesRoot, 'product/assets/templates/acceptance.json'), 'utf8'),
);
validateCaseTemplate(
  readFileSync(join(rolesRoot, 'qa/assets/templates/cases.yaml'), 'utf8'),
  acceptanceTemplate,
);

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mediaTypeOf(file) {
  switch (extname(file).toLowerCase()) {
    case '.md':
      return 'text/markdown';
    case '.yaml':
    case '.yml':
      return 'application/yaml';
    case '.json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** 路径 → 资源 id / kind，规则固定，避免每个包各自命名。 */
function classify(rel) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1].replace(/\.[^.]+$/, '');
  if (rel === 'guide.md') return { id: 'guide', kind: 'prompt' };
  if (rel === 'skills/index.md') return { id: 'skills-index', kind: 'index' };
  if (parts[0] === 'skills' && parts.length === 3 && base === 'SKILL')
    return { id: `skill-${slug(parts[1])}`, kind: 'skill' };
  if (parts[0] === 'assets' && parts[1] === 'templates')
    return {
      id: `template-${slug(base)}${extname(rel) === '.json' ? '-json' : ''}`,
      kind: 'template',
    };
  if (parts[0] === 'assets' && parts[1] === 'examples')
    return { id: `example-${slug(base)}`, kind: 'example' };
  if (parts[0] === 'checklists') return { id: `checklist-${slug(base)}`, kind: 'checklist' };
  if (parts[0] === 'references') return { id: `reference-${slug(base)}`, kind: 'reference' };
  return { id: `resource-${slug(rel)}`, kind: 'other' };
}

const roleDirs = readdirSync(rolesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => {
    try {
      return statSync(join(rolesRoot, name, 'package.meta.json')).isFile();
    } catch {
      return false;
    }
  })
  .sort();

const packages = roleDirs.map((roleKey) => {
  const roleRoot = join(rolesRoot, roleKey);
  const meta = JSON.parse(readFileSync(join(roleRoot, 'package.meta.json'), 'utf8'));
  const resourceFiles = walk(roleRoot)
    .map((file) => {
      const rel = relative(roleRoot, file).split(sep).join('/');
      const { id, kind } = classify(rel);
      return {
        file,
        rel,
        id,
        kind,
        path: `roles/${roleKey}/${rel}`,
        byteLength: statSync(file).size,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  // Check the inexpensive metadata first, before reading and base64-encoding resources.
  validateResourceRecords(roleKey, resourceFiles);
  const resources = resourceFiles.map(({ file, rel, id, kind, path, byteLength }) => {
    if (rel.startsWith('skills/') && rel.endsWith('/SKILL.md')) {
      const match = rel.match(/^skills\/([^/]+)\/SKILL\.md$/);
      if (!match) throw new Error(`${path}: SKILL.md must be directly inside skills/<name>/`);
      const expectedName = match[1];
      validateSkillFrontmatter(readFileSync(file, 'utf8'), {
        sourcePath: path,
        expectedName,
      });
      const declaredSkill = (meta.skills ?? []).find((skill) => skill.key === expectedName);
      if (!declaredSkill || declaredSkill.path !== rel)
        throw new Error(
          `${path}: skill must be declared in package.meta.json with the same key and path`,
        );
    }
    const bytes = readFileSync(file);
    if (bytes.byteLength !== byteLength)
      throw new Error(
        `${path}: resource changed while the package was being built; rerun the build`,
      );
    return {
      id,
      kind,
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
      mediaType: mediaTypeOf(rel),
      bodyBase64: bytes.toString('base64'),
    };
  });

  const manifest = {
    packageSchemaVersion: '1.1',
    id: meta.id,
    version: meta.version,
    protocolVersion: '1.0',
    title: meta.title,
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.license ? { license: meta.license } : {}),
    roleKey,
    compatibility: meta.compatibility,
    ...(meta.skills ? { skills: meta.skills } : {}),
    inputs: meta.inputs,
    outputs: meta.outputs.map(({ evidence, ...rest }) => (evidence ? { ...rest, evidence } : rest)),
    // CLI 从 roles/<role> 目录安装，资源路径必须相对该目录；
    // generated.ts 里的路径保留 `roles/<role>/` 前缀，供服务端登记时定位。
    resources: resources.map(({ id, kind, path, sha256, byteLength, mediaType }) => ({
      id,
      kind,
      path: path.replace(`roles/${roleKey}/`, ''),
      sha256,
      byteLength,
      mediaType,
    })),
    agentEntries: meta.agentEntries,
  };

  // 供 `workmesh roles install --package packages/role-packages/roles/<role>` 直接安装。
  writeFileSync(join(roleRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    packageId: manifest.id,
    version: manifest.version,
    roleKey,
    manifest,
    resources: resources.map(
      ({ id: resourceId, path, sha256, byteLength, mediaType, bodyBase64 }) => ({
        resourceId,
        path,
        sha256,
        byteLength,
        mediaType,
        bodyBase64,
      }),
    ),
  };
});

const header = `// 由 scripts/build.mjs 生成，请勿手改。
// 修改 roles/<roleKey>/ 下的内容后运行：pnpm --filter @workmesh/role-packages build
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
