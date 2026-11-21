import { describe, expect, it } from 'vitest';
import {
  analyzeQualityBundle,
  getQualityEvidenceLinkIssues,
  type QualityBundle,
  type QualityBundleV11,
  type QualityEvidenceV11,
} from './quality';

const basis = { prdRevisionId: 'prd-r1', snapshotId: 'snapshot-1', commitSha: 'a'.repeat(40) };
const bundle = (stage: 'PLAN' | 'DELIVERY' = 'PLAN'): QualityBundle => ({
  schemaVersion: '1.0',
  stage,
  requirementId: 'WM-001',
  basis,
  acceptance: [{ key: 'import-works', text: '可导入有效文件', verification: 'TEST' }],
  tasks: [
    { id: 'impl', acceptanceKeys: ['import-works'], dependsOn: [], files: ['src/import.ts'] },
  ],
  cases: [{ id: 'TC-01', covers: ['import-works'], kind: 'TEST' }],
  evidence: [],
});

describe('quality coverage', () => {
  it('handles a long dependency chain without recursive stack growth', () => {
    const input = bundle();
    input.tasks = Array.from({ length: 2000 }, (_, i) => ({
      id: `t${i}`,
      acceptanceKeys: ['import-works'],
      dependsOn: i ? [`t${i - 1}`] : [],
      files: ['src/shared.ts'],
      parallel: i === 0 || i === 1999,
    }));
    expect(analyzeQualityBundle(input).status).toBe('CONSISTENT');
  });
  it('keeps planning coverage distinct from executed delivery evidence', () => {
    expect(analyzeQualityBundle(bundle())).toMatchObject({
      status: 'CONSISTENT',
      coverage: [{ status: 'PLANNED' }],
    });
    expect(analyzeQualityBundle(bundle('DELIVERY'))).toMatchObject({
      status: 'INCOMPLETE',
      coverage: [{ status: 'MISSING' }],
    });
  });
  it.each([
    null,
    {},
    { ...bundle(), evidence: undefined },
    { ...bundle(), acceptance: [] },
    { ...bundle(), basis: { ...basis, commitSha: 'short' } },
    { ...bundle(), acceptance: [{ key: 'A1', text: 'x', verification: 'TEST' }] },
    {
      ...bundle(),
      tasks: [{ id: 'x', acceptanceKeys: ['import-works'], dependsOn: [], files: ['../secret'] }],
    },
  ])('refuses malformed or empty input without reporting success: %j', (input) => {
    expect(analyzeQualityBundle(input).status).toBe('INVALID');
  });
  it('reports unknown references, duplicate IDs and missing coverage', () => {
    const input = bundle();
    input.tasks[0].acceptanceKeys = ['wrong-key'];
    input.tasks.push({ ...input.tasks[0], dependsOn: ['absent'] });
    input.cases = [];
    const codes = analyzeQualityBundle(input).issues.map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'UNKNOWN_ACCEPTANCE',
        'DUPLICATE_ID',
        'UNKNOWN_DEPENDENCY',
        'TASK_COVERAGE_MISSING',
        'CASE_COVERAGE_MISSING',
      ]),
    );
  });
  it('checks verification kinds and does not accept a mismatched case as coverage', () => {
    const input = bundle();
    input.cases[0].kind = 'DEMO';
    expect(analyzeQualityBundle(input).issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['VERIFICATION_MISMATCH', 'CASE_COVERAGE_MISSING']),
    );
  });
  it('detects cycles and overlapping parallel changes, including directory paths', () => {
    const input = bundle();
    input.tasks[0].parallel = true;
    input.tasks.push({
      id: 'second',
      acceptanceKeys: ['import-works'],
      dependsOn: [],
      files: ['src'],
      parallel: true,
    });
    expect(
      analyzeQualityBundle(input).issues.some((i) => i.code === 'PARALLEL_FILE_CONFLICT'),
    ).toBe(true);
    input.tasks[1].dependsOn = ['impl'];
    expect(
      analyzeQualityBundle(input).issues.some((i) => i.code === 'PARALLEL_FILE_CONFLICT'),
    ).toBe(false);
    input.tasks[0].dependsOn = ['second'];
    expect(analyzeQualityBundle(input).issues.some((i) => i.code === 'DEPENDENCY_CYCLE')).toBe(
      true,
    );
  });
  it('binds evidence to all versions and never converts a report to formal verification', () => {
    const input = bundle('DELIVERY');
    input.evidence = [
      {
        id: 'e1',
        acceptanceKeys: ['import-works'],
        result: 'PASSED',
        source: 'EXTERNAL_REFERENCE',
        ref: 'https://ci.example/run/1',
        basis,
      },
    ];
    expect(analyzeQualityBundle(input)).toMatchObject({
      status: 'CONSISTENT',
      authority: 'LOCAL_REPORTED',
      coverage: [{ status: 'REPORTED_PASS' }],
      issues: expect.arrayContaining([
        {
          code: 'EVIDENCE_REQUIRES_REVIEW',
          severity: 'WARNING',
          location: 'acceptance.import-works',
          message: expect.any(String),
        },
      ]),
    });
    input.evidence[0].basis = { ...basis, commitSha: 'b'.repeat(40) };
    expect(analyzeQualityBundle(input)).toMatchObject({
      status: 'INCOMPLETE',
      coverage: [{ status: 'MISSING' }],
    });
    expect(analyzeQualityBundle(input).issues.some((i) => i.code === 'EVIDENCE_STALE')).toBe(true);
  });
  it.each(['FAILED', 'BLOCKED', 'NOT_RUN'] as const)(
    'a reported pass cannot hide %s evidence',
    (result) => {
      const input = bundle('DELIVERY');
      input.evidence = [
        {
          id: 'pass',
          acceptanceKeys: ['import-works'],
          result: 'PASSED',
          source: 'AGENT_REPORTED',
          ref: 'log/pass.txt',
          basis,
        },
        {
          id: 'other',
          acceptanceKeys: ['import-works'],
          result,
          source: 'AGENT_REPORTED',
          ref: 'log/other.txt',
          basis,
        },
      ];
      expect(analyzeQualityBundle(input)).toMatchObject({
        status: 'INCOMPLETE',
        coverage: [{ status: result }],
      });
    },
  );
});

const revision = { artifactId: 'cases-artifact-1', sha256: 'c'.repeat(64) };
const linkedBundle = (stage: 'PLAN' | 'DELIVERY' = 'DELIVERY'): QualityBundleV11 => ({
  ...bundle(stage),
  schemaVersion: '1.1',
  basis: { ...basis, projectRepositoryId: 'repo-1' },
  cases: [{ id: 'TC-01', covers: ['import-works'], kind: 'TEST', revision }],
  evidence: [],
});
const execution = (
  input: QualityBundleV11,
  result: QualityEvidenceV11['result'] = 'PASSED',
  caseId = 'TC-01',
): QualityEvidenceV11 => ({
  id: `${caseId}-${result}`,
  acceptanceKeys: ['import-works'],
  caseRefs: [{ caseId, revision: { ...revision } }],
  result,
  source: 'AGENT_REPORTED',
  ref: 'reports/results.json',
  basis: { ...input.basis, commitSha: basis.commitSha },
});

describe('quality 1.1 exact case execution', () => {
  it('retains legacy behavior with an explicit missing-link warning', () => {
    expect(analyzeQualityBundle(bundle())).toMatchObject({
      bundleSchemaVersion: '1.0',
      executionLinkage: 'LEGACY_UNLINKED',
      status: 'CONSISTENT',
      caseCoverage: [],
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'LEGACY_CASE_LINKAGE_MISSING', severity: 'WARNING' }),
      ]),
    });
  });
  it('requires an immutable CASES reference even for a 1.1 plan, and does not claim execution', () => {
    const input = linkedBundle('PLAN');
    expect(analyzeQualityBundle(input)).toMatchObject({
      status: 'CONSISTENT',
      executionLinkage: 'EXPLICIT_CASE_REVISION',
      caseCoverage: [{ caseId: 'TC-01', revision, evidenceIds: [], status: 'PLANNED' }],
      coverage: [{ status: 'PLANNED' }],
    });
    expect(
      analyzeQualityBundle({
        ...input,
        cases: [{ id: 'TC-01', covers: ['import-works'], kind: 'TEST' }],
      }).status,
    ).toBe('INVALID');
  });
  it('binds a reported pass to a case revision without upgrading its authority', () => {
    const input = linkedBundle();
    input.evidence = [execution(input)];
    expect(analyzeQualityBundle(input)).toMatchObject({
      status: 'CONSISTENT',
      authority: 'LOCAL_REPORTED',
      bundleSchemaVersion: '1.1',
      caseCoverage: [
        { caseId: 'TC-01', revision, evidenceIds: ['TC-01-PASSED'], status: 'REPORTED_PASS' },
      ],
      coverage: [{ status: 'REPORTED_PASS' }],
    });
  });
  it('does not report all cases executed when just one of two cases has a pass', () => {
    const input = linkedBundle();
    input.cases.push({ ...input.cases[0], id: 'TC-02' });
    input.evidence = [execution(input)];
    expect(analyzeQualityBundle(input)).toMatchObject({
      status: 'INCOMPLETE',
      caseCoverage: [{ status: 'REPORTED_PASS' }, { status: 'MISSING' }],
      coverage: [{ status: 'MISSING' }],
    });
    input.evidence.push(execution(input, 'PASSED', 'TC-02'));
    expect(analyzeQualityBundle(input).status).toBe('CONSISTENT');
  });
  it.each(['FAILED', 'BLOCKED', 'NOT_RUN'] as const)(
    'retains %s despite another pass or absent case',
    (result) => {
      const input = linkedBundle();
      input.cases.push({ ...input.cases[0], id: 'TC-02' });
      input.evidence = [execution(input), execution(input, result)];
      expect(analyzeQualityBundle(input)).toMatchObject({
        status: 'INCOMPLETE',
        caseCoverage: [{ status: result }, { status: 'MISSING' }],
        coverage: [{ status: result }],
      });
    },
  );
  it.each([
    [
      'unknown case',
      (e: QualityEvidenceV11) => {
        e.caseRefs[0].caseId = 'absent';
      },
      'UNKNOWN_CASE',
    ],
    [
      'duplicate case',
      (e: QualityEvidenceV11) => {
        e.caseRefs.push({ ...e.caseRefs[0] });
      },
      'DUPLICATE_CASE_REF',
    ],
    [
      'old artifact',
      (e: QualityEvidenceV11) => {
        e.caseRefs[0].revision.artifactId = 'old-artifact';
      },
      'CASE_REVISION_MISMATCH',
    ],
    [
      'old digest',
      (e: QualityEvidenceV11) => {
        e.caseRefs[0].revision.sha256 = 'd'.repeat(64);
      },
      'CASE_REVISION_MISMATCH',
    ],
    [
      'wrong acceptance',
      (e: QualityEvidenceV11) => {
        e.acceptanceKeys = ['wrong-key'];
      },
      'CASE_ACCEPTANCE_MISMATCH',
    ],
  ] as const)(
    'rejects %s from execution coverage while retaining its diagnostic',
    (_label, mutate, code) => {
      const input = linkedBundle();
      const e = execution(input);
      mutate(e);
      input.evidence = [e];
      const report = analyzeQualityBundle(input);
      expect(report.status).toBe('INCOMPLETE');
      expect(report.issues.some((issue) => issue.code === code)).toBe(true);
      expect(report.caseCoverage[0].status).toBe('MISSING');
      expect(getQualityEvidenceLinkIssues(input, e).some((issue) => issue.code === code)).toBe(
        true,
      );
    },
  );
  it.each(['projectRepositoryId', 'prdRevisionId', 'snapshotId', 'commitSha'] as const)(
    'rejects stale %s, including a different repository with the same SHA',
    (field) => {
      const input = linkedBundle();
      input.evidence = [execution(input)];
      input.evidence[0].basis[field] = field === 'commitSha' ? 'b'.repeat(40) : 'other';
      expect(analyzeQualityBundle(input)).toMatchObject({
        status: 'INCOMPLETE',
        caseCoverage: [{ status: 'MISSING' }],
        coverage: [{ status: 'MISSING' }],
        issues: expect.arrayContaining([expect.objectContaining({ code: 'EVIDENCE_STALE' })]),
      });
    },
  );
  it('rejects conflicting digests for an immutable CASES artifact', () => {
    const input = linkedBundle();
    input.cases.push({
      ...input.cases[0],
      id: 'TC-02',
      revision: { ...revision, sha256: 'd'.repeat(64) },
    });
    expect(
      analyzeQualityBundle(input).issues.some((issue) => issue.code === 'CASE_ARTIFACT_CONFLICT'),
    ).toBe(true);
  });
  it.each([
    (input: QualityBundleV11) => ({ ...input, schemaVersion: '2.0' }),
    (input: QualityBundleV11) => ({ ...input, verified: true }),
    (input: QualityBundleV11) => ({
      ...input,
      basis: { ...input.basis, projectRepositoryId: undefined },
    }),
    (input: QualityBundleV11) => ({
      ...input,
      evidence: [{ ...execution(input), verified: true }],
    }),
    (input: QualityBundleV11) => ({ ...input, evidence: [{ ...execution(input), caseRefs: [] }] }),
    (input: QualityBundleV11) => ({
      ...input,
      evidence: [{ ...execution(input), caseRefs: undefined }],
    }),
    (input: QualityBundleV11) => ({
      ...input,
      cases: [{ ...input.cases[0], revision: { ...revision, sha256: 'short' } }],
    }),
  ])('refuses malformed 1.1 fields or self-declared authority', (mutate) => {
    expect(analyzeQualityBundle(mutate(linkedBundle())).status).toBe('INVALID');
  });
});
