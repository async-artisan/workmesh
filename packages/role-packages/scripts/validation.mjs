import yaml from 'js-yaml';

export const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;

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
