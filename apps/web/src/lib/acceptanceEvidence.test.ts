import { analyzeQualityBundle, type QualityBundle } from '@workmesh/shared';
import { describe, expect, it } from 'vitest';
import type { ArtifactSetView, ArtifactView } from '../api/resources';
import {
  buildAcceptanceEvidenceMapping,
  isQualityJsonCandidate,
  parseQualityArtifact,
  safeEvidenceUrl,
  type QualityArtifactSource,
} from './acceptanceEvidence';

const commit = 'a'.repeat(40);
const acceptance = [
  { key: 'ac-login', text: '有效账号可以登录', verification: 'TEST' },
  { key: 'ac-lock', text: '连续失败后锁定账号', verification: 'TEST' },
];
const basis = { prdRevisionId: 'prd-1', snapshotId: 'snapshot-1', commitSha: commit };
const artifact: ArtifactView = {
  id: 'artifact-1',
  kind: 'CASES',
  schemaVersion: '1.0',
  storage: 'HOSTED',
  mediaType: 'application/json',
  byteLength: 500,
  sha256: 'b'.repeat(64),
  projectRepositoryId: 'repo-1',
  commitSha: commit,
  repoPath: 'quality.json',
  summary: 'QA 质量包',
  checks: [{ code: 'lint', passed: true }],
};
const artifactSet: ArtifactSetView = {
  id: 'set-1',
  taskId: 'task-1',
  taskGeneration: 1,
  snapshotId: 'snapshot-1',
  manifestDigest: 'c'.repeat(64),
  workflowDefinitionRevisionId: 'workflow-1',
  localRunId: 'run-1',
  candidateRevisionIds: [],
  artifacts: [artifact],
  createdAt: '2026-11-09T00:00:00Z',
};

function bundle(): QualityBundle {
  return {
    schemaVersion: '1.0',
    stage: 'DELIVERY',
    requirementId: 'req-1',
    basis: { ...basis },
    acceptance: [{ ...acceptance[0] } as QualityBundle['acceptance'][number]],
    tasks: [
      { id: 'task-login', acceptanceKeys: ['ac-login'], dependsOn: [], files: ['src/login.ts'] },
    ],
    cases: [{ id: 'case-login', covers: ['ac-login'], kind: 'TEST' }],
    evidence: [
      {
        id: 'ev-login',
        acceptanceKeys: ['ac-login'],
        result: 'PASSED',
        source: 'EXTERNAL_REFERENCE',
        ref: 'https://ci.example.com/runs/42',
        basis: { ...basis },
      },
    ],
  };
}
function source(value = bundle()): QualityArtifactSource {
  return {
    artifactId: artifact.id,
    label: 'QA 质量包',
    bundle: value,
    report: analyzeQualityBundle(value),
  };
}
function map(
  value = bundle(),
  changes: Partial<Parameters<typeof buildAcceptanceEvidenceMapping>[0]> = {},
) {
  return buildAcceptanceEvidenceMapping({
    acceptance,
    requirementId: 'req-1',
    prdRevisionId: 'prd-1',
    artifactSet,
    sources: [source(value)],
    ...changes,
  });
}

describe('逐条验收证据映射', () => {
  it('只使用显式 acceptanceKeys 关联，普通通过检查不覆盖另一条验收', () => {
    const result = map();
    expect(result.rows[0]).toMatchObject({
      status: 'REPORTED_PASS',
      taskIds: ['task-login'],
      caseIds: ['case-login'],
    });
    expect(result.rows[0].evidence[0]).toMatchObject({
      id: 'ev-login',
      source: 'EXTERNAL_REFERENCE',
      result: 'PASSED',
      basisState: 'MATCHED',
      ref: 'https://ci.example.com/runs/42',
    });
    expect(result.rows[1]).toMatchObject({ status: 'MISSING', evidence: [] });
    expect(result.unlinkedCheckCount).toBe(1);
  });

  it.each(['requirement', 'prd', 'snapshot', 'commit', 'wording', 'verification'] as const)(
    '标出 %s 不匹配，不把通过报告当作当前验收证据',
    (dimension) => {
      const value = bundle();
      if (dimension === 'requirement') value.requirementId = 'other-req';
      if (dimension === 'prd') value.basis.prdRevisionId = 'old-prd';
      if (dimension === 'snapshot') value.basis.snapshotId = 'old-snapshot';
      if (dimension === 'commit') value.basis.commitSha = 'd'.repeat(40);
      if (dimension === 'wording') value.acceptance[0].text = '另一项功能';
      if (dimension === 'verification') value.acceptance[0].verification = 'DEMO';
      value.evidence[0].basis = { ...value.basis } as typeof basis;
      const row = map(value).rows[0];
      expect(row.status).toBe('NEEDS_REVIEW');
      expect(row.evidence[0].basisState).toBe('MISMATCH');
      expect(row.gaps.length).toBeGreaterThan(0);
    },
  );

  it('单条证据的旧 basis 保留原值并标出，不被质量包新 basis 掩盖', () => {
    const value = bundle();
    value.evidence[0].basis.snapshotId = 'old-snapshot';
    const row = map(value).rows[0];
    expect(row.status).toBe('NEEDS_REVIEW');
    expect(row.evidence[0]).toMatchObject({
      basisState: 'MISMATCH',
      basis: { snapshotId: 'old-snapshot' },
      issues: expect.arrayContaining([expect.stringContaining('证据的 PRD、快照或 commit')]),
    });
  });

  it('缺少当前 commit 或 PRD标识时保留待核对，不声称版本已验证', () => {
    const result = map(bundle(), {
      prdRevisionId: null,
      artifactSet: { ...artifactSet, artifacts: [{ ...artifact, commitSha: null }] },
    });
    expect(result.rows[0]).toMatchObject({
      status: 'NEEDS_REVIEW',
      evidence: [expect.objectContaining({ basisState: 'UNVERIFIED' })],
    });
    expect(result.rows[0].gaps).toEqual(
      expect.arrayContaining([
        expect.stringContaining('PRD 修订标识不可确认'),
        expect.stringContaining('代码版本待核对'),
      ]),
    );
  });

  it.each(['FAILED', 'BLOCKED', 'NOT_RUN'] as const)(
    '新增 PASSED 不能隐藏已有 %s 报告',
    (result) => {
      const value = bundle();
      value.evidence.push({ ...value.evidence[0], id: 'ev-second', result });
      expect(map(value).rows[0].status).toBe(result);
    },
  );

  it('PLAN 与任务/用例覆盖缺口均不能显示交付通过', () => {
    const plan = bundle();
    plan.stage = 'PLAN';
    expect(map(plan).rows[0].status).toBe('NEEDS_REVIEW');
    const missingCase = bundle();
    missingCase.cases = [];
    expect(map(missingCase).rows[0].status).toBe('NEEDS_REVIEW');
    expect(map(missingCase).rows[0].gaps).toContain('验收没有匹配验证方式的用例');
  });

  it('跨PRD未知key不计入当前覆盖，交付物不可读时保留未知态', () => {
    const value = bundle();
    value.evidence[0].acceptanceKeys = ['unknown-key'];
    expect(map(value).unknownAcceptanceKeys).toEqual(['unknown-key']);
    expect(map(value).rows[0].evidence).toEqual([]);
    expect(
      map(bundle(), { artifactSet: null, sources: [] }).rows.every(
        (row) => row.status === 'UNKNOWN',
      ),
    ).toBe(true);
  });
});

describe('完整质量包解析', () => {
  it.each(['result', 'res\\u0075lt'])('拒绝重复字段 %s，后写 PASSED 不得覆盖先写 FAILED', (key) => {
    const text = JSON.stringify(bundle()).replace(
      '"result":"PASSED"',
      '"result":"FAILED","' + key + '":"PASSED"',
    );
    expect(
      parseQualityArtifact(artifact, {
        artifactId: artifact.id,
        storage: 'HOSTED',
        mediaType: 'application/json',
        byteLength: artifact.byteLength,
        sha256: artifact.sha256,
        text,
        bodyBase64: '',
      }).ok,
    ).toBe(false);
  });

  it('只解析经过受限内容接口读取的完整JSON，不把截断预览当正文', () => {
    const text = JSON.stringify(bundle());
    const candidate = { ...artifact, contentPreview: { text: '{"evidence":[', truncated: true } };
    const parsed = parseQualityArtifact(candidate, {
      artifactId: artifact.id,
      storage: 'HOSTED',
      mediaType: 'application/json',
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
      text,
      bodyBase64: '',
    });
    expect(parsed.ok).toBe(true);
    expect(isQualityJsonCandidate(candidate)).toBe(true);
    expect(isQualityJsonCandidate({ ...candidate, storage: 'GIT_REF' })).toBe(false);
  });

  it.each(['invalid-json', 'invalid-schema', 'wrong-id', 'wrong-hash', 'wrong-size'] as const)(
    '拒绝 %s，缺少证明不能降级成全绿',
    (reason) => {
      const content = {
        artifactId: artifact.id,
        storage: 'HOSTED',
        mediaType: 'application/json',
        byteLength: artifact.byteLength,
        sha256: artifact.sha256,
        text: JSON.stringify(bundle()),
        bodyBase64: '',
      };
      if (reason === 'invalid-json') content.text = '{"evidence":';
      if (reason === 'invalid-schema')
        content.text = JSON.stringify({ stage: 'DELIVERY', evidence: [] });
      if (reason === 'wrong-id') content.artifactId = 'other-artifact';
      if (reason === 'wrong-hash') content.sha256 = 'd'.repeat(64);
      if (reason === 'wrong-size') content.byteLength += 1;
      expect(parseQualityArtifact(artifact, content).ok).toBe(false);
    },
  );

  it.each([
    'javascript:alert(1)',
    'file:///tmp/report',
    'https://user:secret@example.com/report',
    'reports/test.xml',
  ])('不把危险或本地引用转换为可点击链接：%s', (ref) => expect(safeEvidenceUrl(ref)).toBeNull());
});
