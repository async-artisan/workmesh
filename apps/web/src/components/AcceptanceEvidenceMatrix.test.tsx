import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { QualityBundle, QualityBundleV11 } from '@workmesh/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import {
  artifactApi,
  type ArtifactContentView,
  type ArtifactSetView,
  type ArtifactView,
} from '../api/resources';
import { AcceptanceEvidenceMatrix } from './AcceptanceEvidenceMatrix';
import type { ReviewEvidenceSummary } from '../lib/reviewEvidenceSummary';

const commit = 'a'.repeat(40);
const acceptance = [
  { key: 'ac-login', text: '有效账号可以登录', verification: 'TEST' },
  { key: 'ac-lock', text: '连续失败后锁定账号', verification: 'TEST' },
];
const basis = { prdRevisionId: 'prd-1', snapshotId: 'snapshot-1', commitSha: commit };
const quality: QualityBundle = {
  schemaVersion: '1.0',
  stage: 'DELIVERY',
  requirementId: 'req-1',
  basis,
  acceptance: [acceptance[0] as QualityBundle['acceptance'][number]],
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
      basis,
    },
  ],
};
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
  contentPreview: { text: '{"evidence":[', truncated: true },
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
const props = { acceptance, requirementId: 'req-1', prdRevisionId: 'prd-1', artifactSet };
function content(id = artifact.id, text = JSON.stringify(quality)): ArtifactContentView {
  return {
    artifactId: id,
    storage: 'HOSTED',
    mediaType: 'application/json',
    byteLength: artifact.byteLength,
    sha256: artifact.sha256,
    text,
    bodyBase64: '',
  };
}
function row(text: string) {
  return within(screen.getByText(text).closest('tr')!);
}
afterEach(() => vi.restoreAllMocks());

describe('AcceptanceEvidenceMatrix', () => {
  it('首屏摘要复用一次全文请求，读取完成前不报告最终缺失', async () => {
    let resolveContent!: (value: ArtifactContentView) => void;
    const pending = new Promise<ArtifactContentView>((resolve) => {
      resolveContent = resolve;
    });
    const read = vi.spyOn(artifactApi, 'content').mockReturnValue(pending);
    const summary = vi.fn<(value: ReviewEvidenceSummary) => void>();
    render(
      <AcceptanceEvidenceMatrix {...props} scopeKey="review-1:v1" onSummaryChange={summary} />,
    );
    expect(summary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scopeKey: 'review-1:v1',
        status: 'LOADING',
        totalAcceptance: 2,
        counts: expect.objectContaining({ MISSING: 0, REPORTED_PASS: 0 }),
      }),
    );
    await act(async () => resolveContent(content()));
    expect(summary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'READY',
        candidateCount: 1,
        readableCount: 1,
        unreadableCount: 0,
        counts: expect.objectContaining({ REPORTED_PASS: 1, MISSING: 1 }),
        basisCounts: { MATCHED: 1, MISMATCH: 0, UNVERIFIED: 0 },
      }),
    );
    expect(read).toHaveBeenCalledExactlyOnceWith('set-1', 'artifact-1');
  });

  it('部分不可读时摘要保留已知失败，未知条款不计最终缺失', async () => {
    vi.spyOn(artifactApi, 'content').mockImplementation(async (_set, id) => {
      if (id === 'restricted') throw new ApiError(403, 'FORBIDDEN', 'no access');
      return content(
        artifact.id,
        JSON.stringify({
          ...quality,
          evidence: [{ ...quality.evidence[0], result: 'FAILED' }],
        }),
      );
    });
    const summary = vi.fn<(value: ReviewEvidenceSummary) => void>();
    render(
      <AcceptanceEvidenceMatrix
        {...props}
        scopeKey="review-1:v1"
        onSummaryChange={summary}
        artifactSet={{
          ...artifactSet,
          artifacts: [artifact, { ...artifact, id: 'restricted', summary: '受限质量包' }],
        }}
      />,
    );
    await screen.findByText('ev-login · 报告失败');
    expect(summary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'PARTIAL',
        candidateCount: 2,
        readableCount: 1,
        unreadableCount: 1,
        counts: expect.objectContaining({ FAILED: 1, UNKNOWN: 1, MISSING: 0, REPORTED_PASS: 0 }),
      }),
    );
    expect(row(acceptance[0].text).getByText('有失败报告')).toBeInTheDocument();
  });

  it('切换scope及PRD复用正文重新核对，切换交付物不以旧结果发送新scope摘要', async () => {
    let resolveNext!: (value: ArtifactContentView) => void;
    const next = new Promise<ArtifactContentView>((resolve) => {
      resolveNext = resolve;
    });
    const read = vi
      .spyOn(artifactApi, 'content')
      .mockImplementation(async (set) => (set === 'set-1' ? content() : next));
    const summary = vi.fn<(value: ReviewEvidenceSummary) => void>();
    const rendered = render(
      <AcceptanceEvidenceMatrix {...props} scopeKey="scope-1" onSummaryChange={summary} />,
    );
    await screen.findByText('报告通过，待人工核验');
    rendered.rerender(
      <AcceptanceEvidenceMatrix
        {...props}
        scopeKey="scope-2"
        prdRevisionId="prd-2"
        onSummaryChange={summary}
      />,
    );
    expect(summary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scopeKey: 'scope-2',
        status: 'READY',
        counts: expect.objectContaining({ REPORTED_PASS: 0, NEEDS_REVIEW: 1 }),
      }),
    );
    expect(read).toHaveBeenCalledTimes(1);
    rendered.rerender(
      <AcceptanceEvidenceMatrix
        {...props}
        scopeKey="scope-3"
        onSummaryChange={summary}
        artifactSet={{ ...artifactSet, id: 'set-2' }}
      />,
    );
    expect(summary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scopeKey: 'scope-3',
        status: 'LOADING',
        counts: expect.objectContaining({ REPORTED_PASS: 0, MISSING: 0 }),
      }),
    );
    expect(
      summary.mock.calls
        .map(([value]) => value)
        .filter((value) => value.scopeKey === 'scope-3' && value.status === 'READY'),
    ).toHaveLength(0);
    await act(async () => resolveNext(content()));
    expect(summary).toHaveBeenLastCalledWith(
      expect.objectContaining({ scopeKey: 'scope-3', status: 'READY' }),
    );
  });

  it('读取完整JSON后逐条展示来源、结果、引用与版本；没有关联的条款单独显示缺口', async () => {
    const read = vi.spyOn(artifactApi, 'content').mockResolvedValue(content());
    render(<AcceptanceEvidenceMatrix {...props} />);
    await screen.findByText('ev-login · 提交者报告通过');
    expect(row(acceptance[0].text).getByText('报告通过，待人工核验')).toBeInTheDocument();
    expect(row(acceptance[1].text).getByText('缺少关联证据')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: quality.evidence[0].ref })).toHaveAttribute(
      'href',
      quality.evidence[0].ref,
    );
    expect(screen.getByText(/外部引用（尚未核验）/)).toBeInTheDocument();
    expect(screen.getByText(/这张表不会自动批准/)).toBeInTheDocument();
    expect(screen.getByText(/另有 1 项工件检查未提供逐条验收关联/)).toBeInTheDocument();
    expect(screen.getByText(/未建立执行到用例修订的精确关联/)).toBeInTheDocument();
    expect(screen.queryByText(/执行引用用例/)).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledExactlyOnceWith('set-1', 'artifact-1');
    expect(screen.queryByRole('button', { name: /批准/ })).not.toBeInTheDocument();
  });

  it('1.1展示精确用例修订和缺少执行关联，单个PASS不能使摘要或该验收显示通过', async () => {
    const revision = { artifactId: 'cases-1', sha256: 'e'.repeat(64) };
    const linkedBasis = { ...basis, projectRepositoryId: 'repo-1' };
    const linked: QualityBundleV11 = {
      ...quality,
      schemaVersion: '1.1',
      basis: linkedBasis,
      cases: [
        { id: 'case-login', covers: ['ac-login'], kind: 'TEST', revision },
        { id: 'case-second', covers: ['ac-login'], kind: 'TEST', revision },
      ],
      evidence: [
        {
          ...quality.evidence[0],
          basis: linkedBasis,
          caseRefs: [{ caseId: 'case-login', revision }],
        },
      ],
    };
    vi.spyOn(artifactApi, 'content').mockResolvedValue(
      content(artifact.id, JSON.stringify(linked)),
    );
    const summary = vi.fn<(value: ReviewEvidenceSummary) => void>();
    render(<AcceptanceEvidenceMatrix {...props} onSummaryChange={summary} />);
    await screen.findByText('ev-login · 提交者报告通过');
    const login = row(acceptance[0].text);
    expect(login.getByText('版本或覆盖待核对')).toBeInTheDocument();
    expect(login.getByText('缺少执行关联', { exact: false })).toBeInTheDocument();
    expect(login.getByText('执行引用用例：', { exact: false })).toHaveTextContent('case-login');
    expect(login.getAllByText(revision.sha256).length).toBeGreaterThan(0);
    expect(login.getByText('登记仓库 ID：', { exact: false })).toHaveTextContent('repo-1');
    expect(screen.getByText(/实际 CASES 工件内容、执行及来源仍需核验/)).toBeInTheDocument();
    expect(summary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        counts: expect.objectContaining({ REPORTED_PASS: 0, NEEDS_REVIEW: 1, MISSING: 1 }),
      }),
    );
    expect(screen.queryByText(/未建立执行到用例修订的精确关联/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /批准|触发|重跑/ })).not.toBeInTheDocument();
  });

  it('一个质量包403时保留另一个成功包的关联；不可读内容保留未知而非缺失', async () => {
    vi.spyOn(artifactApi, 'content').mockImplementation(async (_set, id) => {
      if (id === 'restricted') throw new ApiError(403, 'FORBIDDEN', 'no access');
      return content();
    });
    render(
      <AcceptanceEvidenceMatrix
        {...props}
        artifactSet={{
          ...artifactSet,
          artifacts: [artifact, { ...artifact, id: 'restricted', summary: '受限质量包' }],
        }}
      />,
    );
    await screen.findByText('ev-login · 提交者报告通过');
    expect(screen.getByText(/当前账号不可读取这份完整正文/)).toBeInTheDocument();
    expect(row(acceptance[0].text).getByText('部分证据待确认')).toBeInTheDocument();
    expect(row(acceptance[0].text).getByText(/当前逐条覆盖结论不完整/)).toBeInTheDocument();
    expect(row(acceptance[1].text).getByText('证据待确认')).toBeInTheDocument();
    expect(row(acceptance[1].text).queryByText('缺少关联证据')).not.toBeInTheDocument();
  });

  it('完整内容解析失败时不使用貌似通过的预览；修正后可以重新读取', async () => {
    const read = vi
      .spyOn(artifactApi, 'content')
      .mockResolvedValueOnce(content(artifact.id, '{"bad":'))
      .mockResolvedValue(content());
    render(
      <AcceptanceEvidenceMatrix
        {...props}
        artifactSet={{
          ...artifactSet,
          artifacts: [
            { ...artifact, contentPreview: { text: JSON.stringify(quality), truncated: true } },
          ],
        }}
      />,
    );
    await screen.findByText(/完整正文不是合法 JSON/);
    expect(screen.queryByText('ev-login · 提交者报告通过')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取验收映射' }));
    await screen.findByText('ev-login · 提交者报告通过');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('PRD修订变化立即重新核对，不把原通过报告沿用到新版本', async () => {
    vi.spyOn(artifactApi, 'content').mockResolvedValue(content());
    const rendered = render(<AcceptanceEvidenceMatrix {...props} />);
    await screen.findByText('报告通过，待人工核验');
    rendered.rerender(<AcceptanceEvidenceMatrix {...props} prdRevisionId="prd-2" />);
    expect(row(acceptance[0].text).getByText('版本或覆盖待核对')).toBeInTheDocument();
    expect(
      row(acceptance[0].text).getAllByText(/PRD 修订与当前已发布 PRD 不一致/).length,
    ).toBeGreaterThan(0);
  });

  it('切换交付物时忽略旧请求晚到的证据', async () => {
    let resolveOld!: (value: ArtifactContentView) => void;
    const old = new Promise<ArtifactContentView>((resolve) => {
      resolveOld = resolve;
    });
    vi.spyOn(artifactApi, 'content').mockImplementation(async (set) =>
      set === 'set-1' ? old : content('artifact-2', '{"bad":'),
    );
    const summary = vi.fn<(value: ReviewEvidenceSummary) => void>();
    const rendered = render(
      <AcceptanceEvidenceMatrix {...props} scopeKey="old" onSummaryChange={summary} />,
    );
    rendered.rerender(
      <AcceptanceEvidenceMatrix
        {...props}
        scopeKey="current"
        onSummaryChange={summary}
        artifactSet={{
          ...artifactSet,
          id: 'set-2',
          artifacts: [{ ...artifact, id: 'artifact-2' }],
        }}
      />,
    );
    await screen.findByText(/完整正文不是合法 JSON/);
    const callCount = summary.mock.calls.length;
    await act(async () => resolveOld(content()));
    await waitFor(() =>
      expect(screen.queryByText('ev-login · 提交者报告通过')).not.toBeInTheDocument(),
    );
    expect(summary).toHaveBeenCalledTimes(callCount);
    expect(summary).toHaveBeenLastCalledWith(
      expect.objectContaining({ scopeKey: 'current', status: 'PARTIAL' }),
    );
  });

  it('没有可识别质量包时不增加请求，已确认的验收缺失保留为缺失', () => {
    const read = vi.spyOn(artifactApi, 'content');
    const summary = vi.fn<(value: ReviewEvidenceSummary) => void>();
    render(
      <AcceptanceEvidenceMatrix
        {...props}
        artifactSet={{ ...artifactSet, artifacts: [] }}
        scopeKey="no-quality"
        onSummaryChange={summary}
      />,
    );
    expect(read).not.toHaveBeenCalled();
    expect(summary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scopeKey: 'no-quality',
        status: 'READY',
        candidateCount: 0,
        counts: expect.objectContaining({ MISSING: 2 }),
      }),
    );
  });
});
