import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CodeEvidenceDiagnostics } from '@workmesh/shared';
import { CodeEvidenceStatus, LazyCodeEvidenceStatus } from './CodeEvidenceStatus';
import { artifactApi } from '../api/resources';

function diagnostics(): CodeEvidenceDiagnostics {
  return {
    checkedAt: '2026-11-10T00:00:00Z',
    complete: true,
    currentBinding: 'CURRENT',
    taskGeneration: 1,
    currentTaskGeneration: 1,
    signaturePolicy: 'REJECTED_BEFORE_RECEIPT',
    references: [
      {
        artifactId: 'artifact',
        projectRepositoryId: 'repo',
        commitSha: 'a'.repeat(40),
        repository: {
          owner: 'team',
          name: 'source',
          externalId: '42',
          identityMode: 'PROVIDER',
          adapter: 'GITHUB',
          archived: false,
        },
        status: 'SHA_MISMATCH',
        deliveries: [
          {
            id: 'trusted-receipt',
            signatureValid: true,
            eventType: 'pull_request',
            status: 'PROCESSED',
            receivedAt: '2026-11-10T00:00:00Z',
            processedAt: null,
          },
        ],
        reviews: [
          {
            id: 'review',
            changeRequestId: '10',
            headSha: 'f'.repeat(40),
            commitSha: 'f'.repeat(40),
            authorExternalId: 'author',
            reviewerExternalId: 'reviewer',
            reviewerKind: 'USER',
            state: 'APPROVED',
            submittedAt: null,
            reasons: ['SHA_MISMATCH'],
          },
        ],
        tickets: [
          {
            id: 'ticket',
            repositoryId: '42',
            evidenceId: 'review',
            changeRequestId: '10',
            headSha: 'f'.repeat(40),
            generation: 1,
            state: 'CONSUMED',
            matchesReference: false,
            matchesGeneration: true,
          },
        ],
      },
    ],
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('CodeEvidenceStatus', () => {
  it('展示记录中的准确提交和代次对照，恢复入口只导航且不猜当前远端head', () => {
    const current = diagnostics();
    current.taskGeneration = 2;
    current.currentTaskGeneration = 4;
    current.references[0].tickets[0].generation = null;
    const fetch = vi.spyOn(globalThis, 'fetch');
    render(
      <CodeEvidenceStatus
        diagnostics={current}
        taskHref="/requirements/DEMO-001?tab=tasks&taskId=task-1"
      />,
    );
    expect(screen.getByText(/关联评审 head 是记录值，不代表当前远端 PR head/)).toBeInTheDocument();
    expect(screen.getByText(/由 QA 判断复验范围/)).toBeInTheDocument();
    expect(screen.getByText(/建议处理角色：交付责任角色/)).toHaveTextContent('代码评审人');
    const details = screen.getByText('查看提交与代次对照').closest('details')!;
    fireEvent.click(within(details).getByText('查看提交与代次对照'));
    expect(details).toHaveTextContent('交付声明 SHA：' + 'a'.repeat(40));
    expect(details).toHaveTextContent('关联评审 PR 10 的 head 记录值：' + 'f'.repeat(40));
    expect(details).toHaveTextContent('交付代次：2；当前任务代次：4');
    expect(details).toHaveTextContent('票据 ticket 的任务代次：未提供');
    expect(screen.getByRole('link', { name: '定位当前任务与交付' })).toHaveAttribute(
      'href',
      '/requirements/DEMO-001?tab=tasks&taskId=task-1',
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /批准|重跑/ })).not.toBeInTheDocument();
  });

  it('没有可比较的声明或评审记录时保留未知，任务入口仅在明确提供时出现', () => {
    const current = diagnostics();
    current.references[0] = { ...current.references[0], commitSha: null, reviews: [], tickets: [] };
    render(<CodeEvidenceStatus diagnostics={current} />);
    expect(screen.getByText(/交付声明 SHA/)).toHaveTextContent('未提供');
    expect(screen.getByText('未提供可关联的评审 head 记录，无法比较提交。')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '定位当前任务与交付' })).not.toBeInTheDocument();
  });

  it('explains each chain stage without changing the actual platform gate', () => {
    render(<CodeEvidenceStatus diagnostics={diagnostics()} />);
    expect(screen.getByText(/提交 SHA 与当前工件不匹配/)).toBeTruthy();
    expect(screen.getByText(/核对交付的完整 commit SHA/)).toBeTruthy();
    expect(screen.getByText(/正式门禁仍以平台评审结果为准/)).toBeTruthy();
    expect(screen.getByText(/trusted-receipt.*签名有效/)).toBeTruthy();
    expect(screen.getByText(/评审提交或 PR head 与工件 SHA 不同/)).toBeTruthy();
    expect(screen.getByText(/绑定票据 ticket.*已消费.*提交不匹配/)).toBeTruthy();
  });
  it('distinguishes old server, incomplete diagnostics and historical binding', () => {
    const { rerender } = render(<CodeEvidenceStatus />);
    expect(screen.getByText(/服务端未提供代码证据诊断/)).toBeTruthy();
    rerender(
      <CodeEvidenceStatus
        diagnostics={{ ...diagnostics(), complete: false, currentBinding: 'HISTORICAL' }}
      />,
    );
    expect(screen.getByText(/以下结果不完整/)).toBeTruthy();
    expect(screen.getByText(/已不属于当前有效工件/)).toBeTruthy();
  });
  it('only reads on expansion, preserves errors, and retries with no writes', async () => {
    const read = vi
      .spyOn(artifactApi, 'get')
      .mockRejectedValueOnce(new Error('forbidden'))
      .mockResolvedValueOnce({ codeReview: { diagnostics: diagnostics() } } as any);
    render(<LazyCodeEvidenceStatus artifactSetId="set" />);
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '代码证据状态' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取代码证据');
    fireEvent.click(screen.getByRole('button', { name: '重试代码证据' }));
    expect(await screen.findByText(/提交 SHA 与当前工件不匹配/)).toBeTruthy();
    expect(read.mock.calls).toEqual([['set'], ['set']]);
    fireEvent.click(screen.getByRole('button', { name: '代码证据状态' }));
    fireEvent.click(screen.getByRole('button', { name: '代码证据状态' }));
    expect(read).toHaveBeenCalledTimes(2);
  });
});
