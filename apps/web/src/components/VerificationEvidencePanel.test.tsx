import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { VerificationApplicability, VerificationCollection } from '@workmesh/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { verificationEvidenceApi, type VerificationEvidencePage } from '../api/resources';
import { envelope, mockFetch, pathOf } from '../test-utils';
import { useAuthStore } from '../store/auth';
import { VerificationEvidencePanel } from './VerificationEvidencePanel';

const commit = 'a'.repeat(40);
const checkedAt = '2026-11-12T02:00:00.000Z';
function diagnostics(): VerificationApplicability {
  return {
    authority: 'ADVISORY',
    origin: { status: 'MATCHED', reasons: ['采集身份已匹配'] },
    reportAssociation: {
      status: 'UNKNOWN',
      reasons: ['仅有 run artifact，没有 attempt / job 依据'],
    },
    currentness: { status: 'MISMATCH', reasons: ['当前任务已进入新代次'] },
    definitionIndependence: { status: 'UNKNOWN', reasons: ['缺少已发布验证定义依据'] },
    outcome: 'FAILED',
    reasons: ['报告中仍有失败用例'],
  };
}
function collection(): VerificationCollection {
  return {
    schemaVersion: '1.0',
    provider: 'GITHUB_ACTIONS',
    origin: 'PROVIDER_OBSERVED',
    collectedAt: '2026-11-12T01:00:00.000Z',
    repositoryId: '42',
    runId: '123',
    attempt: 2,
    event: 'push',
    headSha: commit,
    status: 'completed',
    conclusion: 'success',
    workflowId: '10',
    workflowPath: '.github/workflows/check.yml',
    htmlUrl: 'https://github.com/team/isolated/actions/runs/123/attempts/2',
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:30:00.000Z',
    latestAttempt: 3,
    identityStable: true,
    completeness: 'INCOMPLETE',
    jobs: [
      {
        id: '456',
        runId: '123',
        attempt: 2,
        name: 'unit-tests',
        headSha: commit,
        status: 'completed',
        conclusion: null,
        startedAt: null,
        completedAt: null,
        steps: [{ number: 1, name: 'Run cases', status: 'completed', conclusion: 'success' }],
      },
    ],
    reports: [
      {
        artifactId: '789',
        name: 'results.json',
        expired: false,
        archiveSha256: 'b'.repeat(64),
        reportSha256: 'c'.repeat(64),
        reportByteLength: 1000,
        association: 'RUN_ONLY',
        issues: ['无法证明报告所属 job'],
        report: {
          kind: 'WORKMESH_CI_RESULTS',
          schemaVersion: '1.0',
          run: {
            provider: 'GITHUB_ACTIONS',
            repositoryId: '42',
            runId: '123',
            runAttempt: 2,
            jobId: '456',
            jobKey: 'unit',
            event: 'push',
            headSha: commit,
            testedCommitSha: commit,
          },
          basis: {
            prdRevisionId: 'prd-1',
            snapshotId: 'snapshot-1',
            projectRepositoryId: 'repo-1',
            commitSha: commit,
          },
          environment: {
            summary: '隔离测试环境',
            startedAt: '2026-11-12T00:00:00.000Z',
            completedAt: '2026-11-12T00:30:00.000Z',
          },
          results: [
            {
              id: 'result-1',
              caseRef: {
                caseId: 'case-login',
                revision: { artifactId: 'cases-1', sha256: 'd'.repeat(64) },
              },
              result: 'FAILED',
              ref: 'javascript:alert(1)',
            },
          ],
        },
      },
    ],
    issues: ['本次仅完整读取了部分 job'],
  };
}
function item(id = 'binding-1'): VerificationEvidencePage['items'][number] {
  const original = diagnostics();
  original.currentness = { status: 'MATCHED', reasons: ['绑定时版本匹配'] };
  original.outcome = 'REPORTED_PASS';
  return {
    binding: {
      id,
      evidenceId: `evidence-${id}`,
      artifactSetId: 'set-1',
      createdAt: '2026-11-12T01:30:00.000Z',
      diagnostics: original,
    },
    evidence: {
      id: `evidence-${id}`,
      projectId: 'project-1',
      projectRepositoryId: 'repo-1',
      collectedAt: '2026-11-12T01:00:00.000Z',
      collection: collection(),
      payloadDigest: 'e'.repeat(64),
    },
    diagnostics: diagnostics(),
  };
}
function page(items = [item()], nextCursor: string | null = null): VerificationEvidencePage {
  return { items, checkedAt, nextCursor };
}
const props = {
  projectId: 'project-1',
  artifactSetId: 'set-1',
  taskHref: '/requirements/DEMO-001?tab=tasks&taskId=task-1',
};

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().clearAuth();
});

describe('VerificationEvidencePanel', () => {
  it('读取完成前保留未知，分别展示四维诊断、原始提供方结论和本地报告失败', async () => {
    let resolve!: (value: VerificationEvidencePage) => void;
    const read = vi.spyOn(verificationEvidenceApi, 'list').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<VerificationEvidencePanel {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('数量与适用性待确认');
    expect(screen.queryByText(/没有关联的验证证据/)).not.toBeInTheDocument();
    await act(async () => resolve(page()));
    expect(read).toHaveBeenCalledExactlyOnceWith('project-1', 'set-1', undefined);
    const run = screen.getByRole('article', { name: '验证运行 123 attempt 2' });
    expect(within(run).getByText(/提供方原始运行状态/)).toHaveTextContent(
      'completed · 原始结论：success',
    );
    expect(within(run).getByText(/采集来源/)).toHaveTextContent(
      'PROVIDER_OBSERVED · 完整性：本次采集不完整',
    );
    expect(within(run).getByText('报告失败', { selector: '.status-tag' })).toBeInTheDocument();
    expect(within(run).getAllByText('运行来源').length).toBe(2);
    expect(within(run).getAllByText('报告与 attempt / job 的关联').length).toBe(2);
    expect(within(run).getAllByText('当前交付适用性').length).toBe(2);
    expect(within(run).getAllByText('验证定义独立性').length).toBe(2);
    expect(within(run).getByText('当前任务已进入新代次')).toBeInTheDocument();
    expect(within(run).getByText(/报告内容为 LOCAL_REPORTED/)).toBeInTheDocument();
    expect(
      within(run).getByText('仅关联 run，未证明所属 attempt / job', { exact: false }),
    ).toBeInTheDocument();
    expect(within(run).getByText('case-login · 报告失败')).toBeInTheDocument();
    expect(within(run).getByText('d'.repeat(64))).toBeInTheDocument();
    expect(within(run).getByText(/原始 jobs/)).toBeInTheDocument();
    expect(within(run).getByText('unit-tests').closest('li')).toHaveTextContent('结论 未提供');
    expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开提供方运行' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(screen.getByRole('link', { name: '定位当前任务与交付' })).toHaveAttribute(
      'href',
      props.taskHref,
    );
    expect(screen.getByText(/不增加批准门禁/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /批准|同步|触发|重跑|撤销|绑定/ }),
    ).not.toBeInTheDocument();
  });

  it('历史绑定诊断保留原通过和对象，本次不匹配不会篡改原记录或撤销签字', async () => {
    vi.spyOn(verificationEvidenceApi, 'list').mockResolvedValue(page());
    render(<VerificationEvidencePanel {...props} />);
    const history = (await screen.findByText('查看绑定时记录与历史诊断')).closest('details')!;
    fireEvent.click(within(history).getByText('查看绑定时记录与历史诊断'));
    expect(history).toHaveTextContent('绑定时报告结果：报告通过，待人工核验');
    expect(history).toHaveTextContent('绑定时版本匹配');
    expect(history).toHaveTextContent('交付物集 set-1');
    expect(history).toHaveTextContent('不会撤销原 HUMAN 决定');
    expect(screen.getByText('当前任务已进入新代次')).toBeInTheDocument();
  });

  it('刷新失败保留上次内容并标记过期诊断，成功重读后替换列表', async () => {
    const read = vi
      .spyOn(verificationEvidenceApi, 'list')
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValueOnce(page([]));
    render(<VerificationEvidencePanel {...props} />);
    await screen.findByRole('article');
    fireEvent.click(screen.getByRole('button', { name: '刷新验证证据' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('不能作为当前适用性结论');
    expect(screen.getByText('上次读取时的适用性诊断')).toBeInTheDocument();
    expect(screen.queryByText(/没有关联的验证证据/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新验证证据' }));
    expect(await screen.findByText(/本次读取没有关联的验证证据记录/)).toHaveTextContent(
      '不代表验收通过',
    );
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it.each([403, 404, 503])('初始读取 %s 不降为没有证据，仍可显式重试', async (status) => {
    vi.spyOn(verificationEvidenceApi, 'list')
      .mockRejectedValueOnce(new ApiError(status, 'TEST', 'unavailable'))
      .mockResolvedValueOnce(page([]));
    render(<VerificationEvidencePanel {...props} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('验证证据读取失败');
    expect(screen.queryByText(/本次读取没有关联/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新验证证据' }));
    await screen.findByText(/本次读取没有关联的验证证据记录/);
  });

  it('分页未读与分页失败保持不完整提示，同一绑定不会重复展示', async () => {
    const next = item('binding-2');
    next.evidence.collection.runId = '124';
    const read = vi
      .spyOn(verificationEvidenceApi, 'list')
      .mockResolvedValueOnce(page([item()], 'next/batch'))
      .mockRejectedValueOnce(new Error('page unavailable'))
      .mockResolvedValueOnce(page([item(), next]));
    render(<VerificationEvidencePanel {...props} />);
    await screen.findByText(/还有绑定记录未读取/);
    fireEvent.click(screen.getByRole('button', { name: '加载更多验证证据' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('分页读取失败');
    expect(screen.getByText(/当前列表不完整/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多验证证据' }));
    await screen.findByRole('article', { name: '验证运行 124 attempt 2' });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '加载更多验证证据' })).not.toBeInTheDocument();
    expect(read).toHaveBeenNthCalledWith(2, 'project-1', 'set-1', 'next/batch');
    expect(read).toHaveBeenNthCalledWith(3, 'project-1', 'set-1', 'next/batch');
  });

  it('项目、交付或查看人切换不沿用旧结果，晚到响应不会穿透scope', async () => {
    let resolveOld!: (value: VerificationEvidencePage) => void;
    let resolveViewer!: (value: VerificationEvidencePage) => void;
    const old = new Promise<VerificationEvidencePage>((resolve) => {
      resolveOld = resolve;
    });
    const viewer = new Promise<VerificationEvidencePage>((resolve) => {
      resolveViewer = resolve;
    });
    const read = vi
      .spyOn(verificationEvidenceApi, 'list')
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce(page([]))
      .mockReturnValueOnce(viewer);
    const rendered = render(<VerificationEvidencePanel {...props} />);
    rendered.rerender(
      <VerificationEvidencePanel {...props} projectId="project-2" artifactSetId="set-2" />,
    );
    await screen.findByText(/本次读取没有关联的验证证据记录/);
    await act(async () => resolveOld(page()));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    act(() =>
      useAuthStore.getState().setSession({ id: 'another-user', email: 'another@example.test' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('数量与适用性待确认');
    expect(screen.queryByText(/本次读取没有关联/)).not.toBeInTheDocument();
    await act(async () => resolveViewer(page([])));
    expect(read).toHaveBeenNthCalledWith(3, 'project-2', 'set-2', undefined);
  });

  it('API仅发编码后的同源GET，cursor不能改变路径或插入查询字段', async () => {
    const fetch = mockFetch(() => ({ status: 200, body: envelope(page([])) }));
    await verificationEvidenceApi.list('project/a', 'set?b', 'next&admin=true');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(pathOf(String(url))).toBe(
      '/api/v1/projects/project%2Fa/artifact-sets/set%3Fb/verification-evidence',
    );
    expect(new URL(String(url), 'http://localhost').search).toBe('?cursor=next%26admin%3Dtrue');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.credentials).toBe('include');
    expect(init?.body).toBeUndefined();
  });
});
