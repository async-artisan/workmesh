import Ajv2020, { type JSONSchemaType, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export type RolePackageManifest = {
  packageSchemaVersion: '1.0' | '1.1';
  id: string;
  version: string;
  protocolVersion: '1.0';
  title: string;
  /** 1.1：包级描述与许可证，用于发现与开源合规 */
  description?: string;
  license?: string;
  roleKey: string;
  compatibility: { minCliVersion: string; maxCliVersionExclusive: string; contractVersion: '1.0' };
  /** 1.1：一个包多个 skill，path 指向 SKILL.md */
  skills?: Array<{ key: string; path: string; description: string; whenToUse?: string }>;
  inputs: Array<{
    key: string;
    source: string;
    kind: string;
    required: boolean;
    contractVersion: '1.0';
  }>;
  outputs: Array<{
    key: string;
    channel: string;
    kind: string;
    contractVersion: '1.0';
    templateResourceId?: string;
    /** 1.1：该类产出需要的证据类型 */
    evidence?: Array<'TEST' | 'INSPECTION' | 'DEMO'>;
  }>;
  resources: Array<{
    id: string;
    kind: string;
    path: string;
    sha256: string;
    byteLength: number;
    mediaType: string;
  }>;
  agentEntries: Array<{ host: string; type: string; resourceId: string; adapterVersion: string }>;
};

const key = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' } as const;
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const semver = { type: 'string', minLength: 5, maxLength: 80 } as const;

export const rolePackageManifestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: [
    'packageSchemaVersion',
    'id',
    'version',
    'protocolVersion',
    'title',
    'roleKey',
    'compatibility',
    'inputs',
    'outputs',
    'resources',
    'agentEntries',
  ],
  properties: {
    packageSchemaVersion: { enum: ['1.0', '1.1'] },
    id: { type: 'string', maxLength: 120 },
    version: semver,
    protocolVersion: { const: '1.0' },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', minLength: 1, maxLength: 1024 },
    license: { type: 'string', minLength: 1, maxLength: 120 },
    roleKey: key,
    skills: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'path', 'description'],
        properties: {
          key,
          path: { type: 'string', minLength: 1, maxLength: 240 },
          description: { type: 'string', minLength: 1, maxLength: 1024 },
          whenToUse: { type: 'string', maxLength: 500 },
        },
      },
    },
    compatibility: {
      type: 'object',
      additionalProperties: false,
      required: ['minCliVersion', 'maxCliVersionExclusive', 'contractVersion'],
      properties: {
        minCliVersion: semver,
        maxCliVersionExclusive: semver,
        contractVersion: { const: '1.0' },
      },
    },
    inputs: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'source', 'kind', 'required', 'contractVersion'],
        properties: {
          key,
          source: { type: 'string' },
          kind: { type: 'string' },
          required: { type: 'boolean' },
          contractVersion: { const: '1.0' },
        },
      },
    },
    outputs: {
      type: 'array',
      minItems: 1,
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'channel', 'kind', 'contractVersion'],
        properties: {
          key,
          channel: { type: 'string' },
          kind: { type: 'string' },
          contractVersion: { const: '1.0' },
          templateResourceId: key,
          evidence: {
            type: 'array',
            maxItems: 3,
            items: { enum: ['TEST', 'INSPECTION', 'DEMO'] },
          },
        },
      },
    },
    resources: {
      type: 'array',
      minItems: 1,
      maxItems: 128,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'path', 'sha256', 'byteLength', 'mediaType'],
        properties: {
          id: key,
          kind: { type: 'string' },
          path: { type: 'string', minLength: 1, maxLength: 240 },
          sha256: digest,
          byteLength: { type: 'integer', minimum: 0, maximum: 4194304 },
          mediaType: { type: 'string', minLength: 3, maxLength: 100 },
        },
      },
    },
    agentEntries: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['host', 'type', 'resourceId', 'adapterVersion'],
        properties: {
          host: { enum: ['codex', 'claude-code'] },
          type: { type: 'string' },
          resourceId: key,
          adapterVersion: semver,
        },
      },
    },
  },
} as unknown as JSONSchemaType<RolePackageManifest>;

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
export const validateRolePackageManifest: ValidateFunction<RolePackageManifest> =
  ajv.compile(rolePackageManifestSchema);

const STRICT_SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** 严格 SemVer 2.0：拒绝 `v1`、省略 patch、前导零和非 SemVer 字符串。 */
export function isStrictSemver(value: unknown): value is string {
  return typeof value === 'string' && STRICT_SEMVER.test(value);
}

/** semver 排序按 2.0 规则：核心数字先行，预发布低于同核心的正式版。 */
export function compareSemver(left: string, right: string): number {
  const parse = (value: string) => {
    const match = STRICT_SEMVER.exec(value);
    if (!match) return null;
    return {
      core: [Number(match[1]), Number(match[2]), Number(match[3])] as const,
      pre: match[4] ? match[4].split('.') : null,
    };
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) throw new Error('compareSemver requires strict SemVer values');
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.pre === null && b.pre === null) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const leftPart = a.pre[index];
    const rightPart = b.pre[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^[0-9]+$/.test(leftPart);
    const rightNumeric = /^[0-9]+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(leftPart);
      const rightNumber = Number(rightPart);
      if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1;
    } else if (leftNumeric) return -1;
    else if (rightNumeric) return 1;
    else if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function validateRolePackage(value: unknown): {
  valid: boolean;
  issues: Array<{ path: string; message: string }>;
} {
  const valid = validateRolePackageManifest(value);
  return {
    valid: Boolean(valid),
    issues: valid
      ? []
      : (validateRolePackageManifest.errors ?? []).map((error) => ({
          path: error.instancePath || '/',
          message: error.message ?? 'invalid value',
        })),
  };
}
