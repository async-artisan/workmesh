#!/usr/bin/env node
/**
 * 角色包构建：读取 package.meta.json + 内容文件，计算摘要，生成 manifest.json。
 *
 * 用法：
 *   node scripts/build-role-packages.mjs            # 构建 role-packages/ 下全部包
 *   node scripts/build-role-packages.mjs product    # 只构建指定包
 *   node scripts/build-role-packages.mjs product --schema=1.1
 *
 * 默认输出 manifest schema 1.0（当前 CLI 可安装）；
 * --schema=1.1 会额外写入 description / license / skills / outputs[].evidence，
 * 需要 shared 包同步升级到 1.1 后才能被 CLI 接受。
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve('role-packages');
const MAX_BYTES = 4 * 1024 * 1024;
const SKIP = new Set(['manifest.json', 'package.meta.json']);

const args = process.argv.slice(2);
const schemaArg = args.find((arg) => arg.startsWith('--schema='));
const schema = schemaArg ? schemaArg.split('=')[1] : '1.0';
const only = args.filter((arg) => !arg.startsWith('--'));

const errors = [];

function fail(pkg, message) {
  errors.push(`[${pkg}] ${message}`);
}

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

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function portable(pkg, rel) {
  if (rel.startsWith('/') || rel.includes('\\') || rel.split('/').includes('..'))
    fail(pkg, `非法路径：${rel}`);
  return rel;
}

/** 路径 → 资源 id / kind。规则固定，避免每个包各自命名。 */
function classify(rel) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1].replace(/\.[^.]+$/, '');
  if (rel === 'skills/index.md') return { id: 'skills-index', kind: 'INDEX' };
  if (parts[0] === 'skills' && parts.length === 3 && base === 'SKILL')
    return { id: `skill-${slug(parts[1])}`, kind: 'SKILL' };
  if (parts[0] === 'assets' && parts[1] === 'templates')
    return { id: `template-${slug(base)}`, kind: 'TEMPLATE' };
  if (parts[0] === 'assets' && parts[1] === 'examples')
    return { id: `example-${slug(base)}`, kind: 'EXAMPLE' };
  if (parts[0] === 'checklists') return { id: `checklist-${slug(base)}`, kind: 'CHECKLIST' };
  if (parts[0] === 'references') return { id: `reference-${slug(base)}`, kind: 'REFERENCE' };
  return { id: `resource-${slug(rel)}`, kind: 'OTHER' };
}

/** 解析 SKILL.md 的 YAML frontmatter，只取 name / description。 */
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return fields;
}

async function buildPackage(name) {
  const dir = join(ROOT, name);
  let meta;
  try {
    meta = JSON.parse(await readFile(join(dir, 'package.meta.json'), 'utf8'));
  } catch {
    fail(name, '缺少或无法解析 package.meta.json');
    return;
  }
  for (const field of ['id', 'version', 'title', 'roleKey', 'compatibility', 'inputs', 'outputs'])
    if (!(field in meta)) fail(name, `package.meta.json 缺少 ${field}`);

  if (meta.roleKey && slug(meta.roleKey) !== meta.roleKey)
    fail(name, `roleKey 必须是小写短横线格式：${meta.roleKey}`);

  const files = await walk(dir);
  const resources = [];
  for (const file of files) {
    const rel = portable(name, relative(dir, file).split(sep).join('/'));
    const info = await stat(file);
    if (info.size > MAX_BYTES) fail(name, `${rel} 超过 4MB`);
    const bytes = await readFile(file);
    const { id, kind } = classify(rel);
    resources.push({
      id,
      kind,
      path: rel,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
      mediaType: mediaTypeOf(rel),
    });
    if (kind === 'SKILL') {
      const fm = frontmatter(bytes.toString('utf8'));
      if (!fm) fail(name, `${rel} 缺少 YAML frontmatter`);
      else {
        if (!/^[a-z0-9]([a-z0-9-]{0,62})?[a-z0-9]$|^[a-z0-9]$/.test(fm.name ?? ''))
          fail(name, `${rel} 的 name 不合法：${fm.name ?? '(空)'}`);
        if (!fm.description) fail(name, `${rel} 缺少 description`);
        else if (fm.description.length > 1024) fail(name, `${rel} 的 description 超过 1024 字符`);
      }
    }
  }
  resources.sort((a, b) => a.path.localeCompare(b.path));

  const ids = new Set(resources.map((item) => item.id));
  if (ids.size !== resources.length) fail(name, '资源 id 重复');
  for (const skill of meta.skills ?? [])
    if (!resources.some((item) => item.path === skill.path))
      fail(name, `skills[].path 不存在：${skill.path}`);
  for (const output of meta.outputs ?? [])
    if (output.templateResourceId && !ids.has(output.templateResourceId))
      fail(name, `outputs[].templateResourceId 不存在：${output.templateResourceId}`);
  for (const entry of meta.agentEntries ?? [])
    if (!ids.has(entry.resourceId))
      fail(name, `agentEntries[].resourceId 不存在：${entry.resourceId}`);

  const base = {
    packageSchemaVersion: schema,
    id: meta.id,
    version: meta.version,
    protocolVersion: '1.0',
    title: meta.title,
    roleKey: meta.roleKey,
    compatibility: meta.compatibility,
    inputs: meta.inputs,
    outputs: (meta.outputs ?? []).map(({ evidence, ...rest }) =>
      schema === '1.1' ? { ...rest, ...(evidence ? { evidence } : {}) } : rest,
    ),
    resources,
    agentEntries: meta.agentEntries,
  };
  const manifest =
    schema === '1.1'
      ? {
          ...base,
          ...(meta.description ? { description: meta.description } : {}),
          ...(meta.license ? { license: meta.license } : {}),
          ...(meta.skills ? { skills: meta.skills } : {}),
        }
      : base;

  const path = join(dir, 'manifest.json');
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(
    `[${name}] ${resources.length} 个资源，schema ${schema} → ${relative(process.cwd(), path)}`,
  );
}

const packages = (await readdir(ROOT, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => only.length === 0 || only.includes(name));

if (packages.length === 0) {
  console.error(`没有找到可构建的角色包：${ROOT}`);
  process.exit(1);
}

for (const name of packages) await buildPackage(name);

if (errors.length > 0) {
  console.error('\n构建失败：');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log('\n全部通过。');
