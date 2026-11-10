import yaml from 'js-yaml';
import { ACCEPTANCE_KEY_PATTERN, canonicalJson } from '@workmesh/shared';

export const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;

/** 模板必须能直接映射正式 API，不允许示例与契约静默分叉。 */
export function validateAcceptanceTemplates(yamlSource, jsonSource) {
  const items = yaml.load(yamlSource)?.acceptance;
  const jsonItems = JSON.parse(jsonSource);
  for (const [source, values] of [
    ['acceptance.yaml', items],
    ['acceptance.json', jsonItems],
  ]) {
    if (!Array.isArray(values) || !values.length || values.length > 200)
      fail(source, 'acceptance must contain 1–200 items');
    const seen = new Set();
    for (const item of values) {
      if (
        !item ||
        typeof item.key !== 'string' ||
        !ACCEPTANCE_KEY_PATTERN.test(item.key) ||
        seen.has(item.key)
      )
        fail(source, 'acceptance key must be unique and match the API contract');
      if (
        typeof item.text !== 'string' ||
        !item.text.trim() ||
        item.text.length > 2000 ||
        !['TEST', 'INSPECTION', 'DEMO'].includes(item.verification)
      )
        fail(source, 'acceptance text and verification must match the API contract');
      if (Object.keys(item).some((key) => !['key', 'text', 'verification'].includes(key)))
        fail(source, 'template contains acceptance fields not persisted by the API');
      seen.add(item.key);
    }
  }
  if (canonicalJson(items) !== canonicalJson(jsonItems))
    fail('acceptance.json', 'JSON and YAML templates must describe the same acceptance');
  return items;
}

export function validateCaseTemplate(source, acceptance) {
  const cases = yaml.load(source)?.cases;
  if (!Array.isArray(cases) || !cases.length) fail('cases.yaml', 'cases must not be empty');
  const kinds = new Map(acceptance.map((item) => [item.key, item.verification]));
  const ids = new Set();
  const covered = new Set();
  for (const item of cases) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id))
      fail('cases.yaml', 'case ids must be non-empty and unique');
    ids.add(item.id);
    if (
      !Array.isArray(item.covers) ||
      !item.covers.length ||
      item.covers.some((key) => !kinds.has(key) || kinds.get(key) !== item.kind)
    )
      fail('cases.yaml', 'case references must match acceptance keys and verification');
    for (const key of item.covers) covered.add(key);
  }
  if (acceptance.some((item) => !covered.has(item.key)))
    fail('cases.yaml', 'case template must cover every example acceptance');
}

function fail(sourcePath, message) {
  throw new Error(`${sourcePath}: ${message}`);
}

/** Validate the small, documented SKILL.md frontmatter contract used by role packages. */
export function validateSkillFrontmatter(source, { sourcePath = 'SKILL.md', expectedName } = {}) {
  const normalized = source.replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/);
  if (lines[0] !== '---') fail(sourcePath, 'frontmatter must start with "---" on the first line');
  const closingLine = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
  if (closingLine < 0) fail(sourcePath, 'frontmatter is missing its closing "---" delimiter');

  let fields;
  try {
    fields = yaml.load(lines.slice(1, closingLine).join('\n'));
  } catch (error) {
    fail(sourcePath, `frontmatter is not valid YAML: ${error.message}`);
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields))
    fail(sourcePath, 'frontmatter must be a YAML mapping');
  for (const field of ['name', 'description']) {
    if (!(field in fields)) fail(sourcePath, `frontmatter is missing required field "${field}"`);
    if (typeof fields[field] !== 'string' || !fields[field].trim())
      fail(sourcePath, `frontmatter field "${field}" must be a non-empty string`);
  }

  const name = fields.name;
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(name))
    fail(sourcePath, 'frontmatter "name" must match ^[a-z][a-z0-9-]{0,47}$');
  if (expectedName && name !== expectedName)
    fail(sourcePath, `frontmatter name "${name}" must match skill directory "${expectedName}"`);
  return { name, description: fields.description };
}

export function validateResourceRecords(roleKey, resources) {
  const ids = new Set();
  for (const resource of resources) {
    const sourcePath = resource.path;
    const segments = sourcePath.split('/');
    if (
      sourcePath.includes('\\') ||
      sourcePath.startsWith('/') ||
      /^[a-zA-Z]:/.test(sourcePath) ||
      segments.some((segment) => !segment || segment === '.' || segment === '..') ||
      segments[0] !== 'roles' ||
      segments[1] !== roleKey
    )
      fail(sourcePath, 'resource path must be a safe package-relative path');
    if (resource.byteLength > MAX_RESOURCE_BYTES)
      fail(sourcePath, `resource exceeds ${MAX_RESOURCE_BYTES} bytes`);
    if (ids.has(resource.id)) fail(sourcePath, `duplicate resource id "${resource.id}"`);
    ids.add(resource.id);
  }
}
