import { describe, expect, it, vi } from 'vitest';
import {
  analyzeCiResultReport,
  CI_RESULT_REPORT_MAX_BYTES,
  parseCiResultReport,
  type CiResultReportV1,
} from './ci-result-report';

const report = (): CiResultReportV1 => ({
  kind: 'WORKMESH_CI_RESULTS',
  schemaVersion: '1.0',
  run: {
    provider: 'GITHUB_ACTIONS',
    repositoryId: '123',
    runId: '456',
    runAttempt: 2,
    jobId: '789',
    jobKey: 'contract-tests',
    event: 'push',
    headSha: 'a'.repeat(40),
    testedCommitSha: 'a'.repeat(40),
  },
  basis: {
    prdRevisionId: 'prd-1',
    snapshotId: 'snapshot-1',
    projectRepositoryId: 'repo-1',
    commitSha: 'a'.repeat(40),
  },
  environment: {
    summary: 'Node 24; isolated PostgreSQL',
    startedAt: '2026-11-12T12:00:00Z',
    completedAt: '2026-11-12T12:01:00Z',
  },
  results: [
    {
      id: 'result-1',
      caseRef: { caseId: 'TC-01', revision: { artifactId: 'cases-1', sha256: 'b'.repeat(64) } },
      result: 'FAILED',
      durationMs: 23,
      ref: 'logs/test.txt',
    },
  ],
});

describe('CI result report pure input contract', () => {
  it('parses a report as local content, preserving failure and making no provider request', () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('forbidden'));
    try {
      expect(parseCiResultReport(JSON.stringify(report()))).toEqual({
        ok: true,
        authority: 'LOCAL_REPORTED',
        report: report(),
      });
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
  it.each(['PASSED', 'FAILED', 'BLOCKED', 'NOT_RUN'] as const)(
    'preserves %s rather than normalizing it to success',
    (result) => {
      const input = report();
      input.results[0].result = result;
      expect(analyzeCiResultReport(input)).toMatchObject({
        ok: true,
        report: { results: [{ result }] },
      });
    },
  );
  it.each([
    (input: CiResultReportV1) => ({ ...input, verified: true }),
    (input: CiResultReportV1) => ({ ...input, artifactId: 'self-declared' }),
    (input: CiResultReportV1) => ({ ...input, authority: 'PROVIDER_VERIFIED' }),
    (input: CiResultReportV1) => ({ ...input, schemaVersion: '1.1' }),
    (input: CiResultReportV1) => ({ ...input, results: [] }),
    (input: CiResultReportV1) => ({ ...input, results: Array(2001).fill(input.results[0]) }),
    (input: CiResultReportV1) => ({ ...input, results: [input.results[0], input.results[0]] }),
    (input: CiResultReportV1) => ({
      ...input,
      results: [input.results[0], { ...input.results[0], id: 'different-id', result: 'PASSED' }],
    }),
    (input: CiResultReportV1) => ({
      ...input,
      results: [
        input.results[0],
        {
          ...input.results[0],
          id: 'other-revision',
          caseRef: {
            ...input.results[0].caseRef,
            revision: { artifactId: 'old-cases', sha256: 'c'.repeat(64) },
          },
        },
      ],
    }),
    (input: CiResultReportV1) => ({
      ...input,
      results: [
        input.results[0],
        {
          ...input.results[0],
          id: 'other-case',
          caseRef: { caseId: 'TC-02', revision: { artifactId: 'cases-1', sha256: 'c'.repeat(64) } },
        },
      ],
    }),
    (input: CiResultReportV1) => ({
      ...input,
      results: [{ ...input.results[0], result: 'SKIPPED' }],
    }),
    (input: CiResultReportV1) => ({ ...input, run: { ...input.run, runAttempt: 0 } }),
    (input: CiResultReportV1) => ({ ...input, run: { ...input.run, runId: 456 } }),
    (input: CiResultReportV1) => ({
      ...input,
      basis: { ...input.basis, commitSha: 'c'.repeat(40) },
    }),
    (input: CiResultReportV1) => ({
      ...input,
      environment: { ...input.environment, completedAt: '2026-11-12T11:59:00Z' },
    }),
    (input: CiResultReportV1) => ({ ...input, results: [{ ...input.results[0], durationMs: -1 }] }),
  ])('refuses ambiguous, empty or unsupported input', (mutate) => {
    expect(analyzeCiResultReport(mutate(report()))).toMatchObject({ ok: false });
  });
  it('permits different checkout/head SHAs as declarations without claiming the push binding is valid', () => {
    const input = report();
    input.run.event = 'pull_request';
    input.run.headSha = 'd'.repeat(40);
    expect(analyzeCiResultReport(input)).toMatchObject({ ok: true, authority: 'LOCAL_REPORTED' });
  });
  it.each([
    '{"kind":"WORKMESH_CI_RESULTS","kind":"other"}',
    '{"a":1.5}',
    '[',
    new Uint8Array([0xff]),
    '[ '.repeat(40) + '] '.repeat(40),
  ])('rejects invalid strict JSON', (input) => {
    expect(parseCiResultReport(input)).toMatchObject({
      ok: false,
      issues: [{ code: 'CI_REPORT_JSON_INVALID' }],
    });
  });
  it('rejects bytes exceeding the limit before JSON parsing', () => {
    expect(parseCiResultReport(new Uint8Array(CI_RESULT_REPORT_MAX_BYTES + 1))).toMatchObject({
      ok: false,
      issues: [{ code: 'CI_REPORT_TOO_LARGE' }],
    });
  });
  it('rejects a __proto__ key instead of inheriting a hidden report schema', () => {
    expect(parseCiResultReport('{"__proto__":' + JSON.stringify(report()) + '}')).toMatchObject({
      ok: false,
    });
    const source = JSON.stringify(report()).replace('{', '{"__proto__":{"verified":true},');
    expect(parseCiResultReport(source)).toMatchObject({ ok: false });
  });
});
