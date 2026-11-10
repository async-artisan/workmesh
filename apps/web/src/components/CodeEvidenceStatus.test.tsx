import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
