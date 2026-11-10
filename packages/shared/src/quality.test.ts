import { describe, expect, it } from 'vitest';
import { analyzeQualityBundle, type QualityBundle } from './quality';

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
      issues: [{ code: 'EVIDENCE_REQUIRES_REVIEW' }],
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
