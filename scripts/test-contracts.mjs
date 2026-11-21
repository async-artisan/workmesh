import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createFirstRunIdentity, createFirstRunProjectKey } from './first-run-demo-key.mjs';

const require = createRequire(import.meta.url);
const shared = require('../packages/shared/dist/index.cjs');

const {
  PROTOCOL_VERSION,
  API_ROOT,
  DEFAULT_READ_SCOPES,
  WorkmeshError,
  errorEnvelope,
  canonicalJson,
  parseJsonStrict,
  sha256Bytes,
  validateRolePackage,
  validateWorkflowDefinition,
} = shared;

const manifest = {
  packageSchemaVersion: '1.0',
  id: 'workmesh.role.product',
  version: '1.0.0',
  protocolVersion: '1.0',
  title: 'Product role',
  roleKey: 'product',
  compatibility: {
    minCliVersion: '1.0.0',
    maxCliVersionExclusive: '2.0.0',
    contractVersion: '1.0',
  },
  inputs: [
    {
      key: 'requirement',
      source: 'platform',
      kind: 'json',
      required: true,
      contractVersion: '1.0',
    },
  ],
  outputs: [{ key: 'prd', channel: 'artifact', kind: 'PRD', contractVersion: '1.0' }],
  resources: [
    {
      id: 'guide',
      kind: 'prompt',
      path: 'roles/product/guide.md',
      sha256: 'a'.repeat(64),
      byteLength: 128,
      mediaType: 'text/markdown',
    },
  ],
  agentEntries: [
    { host: 'codex', type: 'instructions', resourceId: 'guide', adapterVersion: '1.0.0' },
  ],
};

const workflow = {
  schemaVersion: '1.0',
  protocolVersion: '1.0',
  workflowKey: 'standard',
  title: 'Standard delivery',
  baseRevisionId: 'rev-0',
  roleExclusions: [],
  stepRemovals: [],
  roleSlots: [],
  steps: [
    { key: 'prd', kind: 'PRODUCT', deps: [], outputKinds: ['PRD'] },
    { key: 'release', kind: 'RELEASE', deps: ['prd'], outputKinds: [] },
  ],
};

const checks = [
  [
    'workbench attention reasons preserve reported failure and unqueried detail meanings',
    () =>
      JSON.stringify(shared.WORKBENCH_ATTENTION_REASON_CODES) ===
      JSON.stringify(['REPORTED_CHECK_FAILED', 'DETAILS_NOT_QUERIED']),
  ],
  [
    'first-run project key matches API format',
    () => /^[A-Z]{2,6}$/.test(createFirstRunProjectKey(() => 25)),
  ],
  [
    'first-run identities remain unique within one clock tick',
    () => {
      let nextId = 0;
      const uuid = () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`;
      const first = createFirstRunIdentity({ uuid, projectKey: () => 'AAAAAA' });
      const second = createFirstRunIdentity({ uuid, projectKey: () => 'BBBBBB' });
      return first.email !== second.email && first.runId !== second.runId;
    },
  ],
  [
    'protocol constants',
    () =>
      PROTOCOL_VERSION === '1.0' &&
      API_ROOT === '/api/v1' &&
      DEFAULT_READ_SCOPES.includes('knowledge:read'),
  ],
  [
    'error envelope shape',
    () => {
      const envelope = errorEnvelope(new WorkmeshError('FORBIDDEN', 'denied'), 'req-1');
      return (
        JSON.stringify(envelope) ===
        JSON.stringify({ error: { code: 'FORBIDDEN', message: 'denied', requestId: 'req-1' } })
      );
    },
  ],
  [
    'canonical json ordering',
    () => canonicalJson({ b: 1, a: { d: 4, c: 3 } }) === '{"a":{"c":3,"d":4},"b":1}',
  ],
  [
    'canonical json preserves array order',
    () => canonicalJson({ items: [3, 1, 2] }) === '{"items":[3,1,2]}',
  ],
  [
    'canonical json rejects floats',
    () => {
      try {
        canonicalJson({ ratio: 1.5 });
        return false;
      } catch {
        return true;
      }
    },
  ],
  [
    'strict json rejects duplicate decoded keys',
    () => {
      try {
        parseJsonStrict('{"a":1,"\\u0061":2}');
        return false;
      } catch {
        return true;
      }
    },
  ],
  [
    'strict json rejects trailing payload',
    () => {
      try {
        parseJsonStrict('{"a":1}{"b":2}');
        return false;
      } catch {
        return true;
      }
    },
  ],
  [
    'strict json rejects floats',
    () => {
      try {
        parseJsonStrict('{"a":1.25}');
        return false;
      } catch {
        return true;
      }
    },
  ],
  [
    'strict json enforces depth limit',
    () => {
      const deep = `${'[ '.repeat(40)}${'] '.repeat(40)}`.trim();
      try {
        parseJsonStrict(deep);
        return false;
      } catch {
        return true;
      }
    },
  ],
  [
    'raw bytes sha256 vector',
    async () => {
      const digest = await sha256Bytes(new TextEncoder().encode('abc'));
      return digest === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    },
  ],
  [
    'role package manifest accepts a complete manifest',
    () => validateRolePackage(manifest).valid === true,
  ],
  [
    'role package manifest rejects unknown fields',
    () => validateRolePackage({ ...manifest, extra: true }).valid === false,
  ],
  [
    'role package manifest rejects truncated digests',
    () =>
      validateRolePackage({
        ...manifest,
        resources: [{ ...manifest.resources[0], sha256: 'a'.repeat(16) }],
      }).valid === false,
  ],
  [
    'workflow validation accepts a release-gated workflow',
    () => {
      const result = validateWorkflowDefinition(workflow);
      return result.valid === true && typeof result.digest === 'string' && result.digest.length > 0;
    },
  ],
  [
    'workflow validation requires a release step',
    () =>
      validateWorkflowDefinition({ ...workflow, steps: [workflow.steps[0]] }).issues.some(
        (issue) => issue.code === 'WORKFLOW_RELEASE_GATE_REQUIRED',
      ),
  ],
  [
    'workflow validation rejects dependency cycles',
    () =>
      validateWorkflowDefinition({
        ...workflow,
        steps: [{ ...workflow.steps[0], deps: ['release'] }, workflow.steps[1]],
      }).valid === false,
  ],
  [
    'quality 1.0 keeps legacy linkage explicit and local',
    () => {
      const input = JSON.parse(
        readFileSync(
          new URL(
            '../project-templates/software/quality-bundle.legacy.example.json',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      const report = shared.analyzeQualityBundle(input);
      return (
        report.status === 'CONSISTENT' &&
        report.authority === 'LOCAL_REPORTED' &&
        report.executionLinkage === 'LEGACY_UNLINKED' &&
        report.issues.some((issue) => issue.code === 'LEGACY_CASE_LINKAGE_MISSING')
      );
    },
  ],
  [
    'quality 1.1 keeps exact case revisions and all-case execution coverage',
    () => {
      const input = JSON.parse(
        readFileSync(
          new URL(
            '../project-templates/software/quality-bundle.delivery.example.json',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      if (shared.analyzeQualityBundle(input).coverage[0].status !== 'NOT_RUN') return false;
      input.evidence[0].result = 'PASSED';
      const complete = shared.analyzeQualityBundle(input);
      input.cases.push({ ...input.cases[0], id: 'TC-02' });
      const partial = shared.analyzeQualityBundle(input);
      return (
        complete.status === 'CONSISTENT' &&
        complete.authority === 'LOCAL_REPORTED' &&
        complete.executionLinkage === 'EXPLICIT_CASE_REVISION' &&
        partial.status === 'INCOMPLETE' &&
        partial.coverage[0].status === 'MISSING'
      );
    },
  ],
  [
    'quality 1.1 rejects client authority and an old case revision',
    () => {
      const input = JSON.parse(
        readFileSync(
          new URL(
            '../project-templates/software/quality-bundle.delivery.example.json',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      if (shared.analyzeQualityBundle({ ...input, verified: true }).status !== 'INVALID')
        return false;
      input.evidence[0].result = 'PASSED';
      input.evidence[0].caseRefs[0].revision.sha256 = 'c'.repeat(64);
      const report = shared.analyzeQualityBundle(input);
      return (
        report.status === 'INCOMPLETE' &&
        report.coverage[0].status === 'MISSING' &&
        report.issues.some((issue) => issue.code === 'CASE_REVISION_MISMATCH')
      );
    },
  ],
  [
    'CI report parsing remains a local declaration and rejects self-verified content',
    () => {
      const input = JSON.parse(
        readFileSync(
          new URL('../project-templates/software/ci-result-report.example.json', import.meta.url),
          'utf8',
        ),
      );
      const result = shared.parseCiResultReport(JSON.stringify(input));
      return (
        result.ok &&
        result.authority === 'LOCAL_REPORTED' &&
        result.report.results[0].result === 'NOT_RUN' &&
        !shared.analyzeCiResultReport({ ...input, verified: true }).ok
      );
    },
  ],
];

const results = [];
for (const [name, check] of checks) {
  try {
    const passed = await check();
    results.push({ name, passed: Boolean(passed) });
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
const failed = results.filter((result) => !result.passed);
console.log(
  JSON.stringify(
    { suite: 'contracts', target: 'packages/shared/dist/index.cjs', results },
    null,
    2,
  ),
);
if (failed.length) {
  console.error(`contracts failed: ${failed.map((item) => item.name).join(', ')}`);
  process.exit(1);
}
console.log(`contracts passed: ${results.length} runtime checks`);
