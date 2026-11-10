import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskInputStatusPanel } from './TaskInputStatusPanel';
import { taskApi, documentApi, type TaskInputStatus } from '../api/resources';

function status(overrides: Partial<TaskInputStatus> = {}): TaskInputStatus {
  return {
    taskId: 'task',
    taskVersion: 3,
    snapshotId: 'snapshot',
    checkedAt: '2026-11-09T00:00:00Z',
    availability: 'VERIFIED',
    issue: null,
    issues: [],
    issuesComplete: true,
    resources: [],
    comparison: { status: 'CURRENT', changes: [], metadataChanges: [] },
    ...overrides,
  };
}

describe('task input inspection', () => {
  it('shows the exact readable missing input, upstream step, owner and recovery action', async () => {
    vi.spyOn(taskApi, 'inputs').mockResolvedValue(
      status({
        availability: 'UNAVAILABLE',
        issue: 'INPUT_UNAVAILABLE',
        issues: [
          {
            kind: 'KNOWLEDGE',
            reason: 'NOT_PUBLISHED',
            required: true,
            blocking: true,
            documentId: 'doc-policy',
            action: 'PUBLISH_KNOWLEDGE',
            responsible: 'KNOWLEDGE_MAINTAINER',
          },
          {
            kind: 'ARTIFACT',
            reason: 'ACCEPTED_ARTIFACT_MISSING',
            required: true,
            blocking: true,
            inputKey: 'api',
            fromStepKey: 'backend',
            artifactKind: 'API_SPEC',
            action: 'DELIVER_UPSTREAM',
            responsible: 'UPSTREAM_OWNER',
          },
        ],
      }),
    );
    render(<TaskInputStatusPanel taskId="task" />);
    const issues = await screen.findByRole('list', { name: '输入问题与恢复动作' });
    expect(issues).toHaveTextContent('文档 doc-policy');
    expect(issues).toHaveTextContent('项目知识维护者：发布必需知识文档后重新核验输入');
    expect(issues).toHaveTextContent('上游步骤 backend · 工件 API_SPEC');
    expect(issues).toHaveTextContent('上游任务负责人');
    expect(issues).toHaveTextContent('阻止创建完整快照');
  });
  it('does not interpret an older response without diagnostics as a complete empty diagnosis', async () => {
    vi.spyOn(taskApi, 'inputs').mockResolvedValue(
      status({ issues: undefined, issuesComplete: undefined }),
    );
    render(<TaskInputStatusPanel taskId="task" />);
    expect(await screen.findByRole('note')).toHaveTextContent('平台未提供完整的逐项诊断');
  });
  it('explains that checking an external Git reference cannot make it a materializable snapshot input', async () => {
    vi.spyOn(taskApi, 'inputs').mockResolvedValue(
      status({
        availability: 'REQUIRES_LOCAL_CHECK',
        issue: 'SNAPSHOT_EXTERNAL_INPUT_UNSUPPORTED',
      }),
    );
    render(<TaskInputStatusPanel taskId="task" />);
    expect(await screen.findByRole('note')).toHaveTextContent('补交已验收的 HOSTED 正文');
    expect(screen.getByRole('note')).toHaveTextContent('本机检查代码引用后仍不能据此创建快照');
  });
  it('distinguishes input verification, snapshot comparison and local environment checks', async () => {
    vi.spyOn(taskApi, 'inputs').mockResolvedValue(status());
    render(<TaskInputStatusPanel taskId="task" />);
    expect(await screen.findByText('服务端输入内容已核验')).toBeInTheDocument();
    expect(screen.getByText(/当前输入与任务快照一致/)).toBeInTheDocument();
    expect(screen.getByText(/本机仓库、工具与运行环境仍需/)).toBeInTheDocument();
  });
  it('keeps failed reads visible with retry, rather than showing missing inputs', async () => {
    vi.spyOn(taskApi, 'inputs')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(status());
    render(<TaskInputStatusPanel taskId="task" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('输入状态读取失败');
    expect(screen.queryByText('必需输入不可用')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试核验输入' }));
    expect(await screen.findByText('服务端输入内容已核验')).toBeInTheDocument();
  });
  it('shows real snapshot revision changes and loads the exact pair of readable bodies', async () => {
    vi.spyOn(taskApi, 'inputs').mockResolvedValue(
      status({
        comparison: {
          status: 'CHANGED',
          metadataChanges: ['deliveryScope'],
          changes: [
            {
              refId: 'prd',
              kind: 'DOCUMENT_REVISION',
              status: 'CHANGED',
              previousTargetId: 'old-revision',
              currentTargetId: 'new-revision',
            },
          ],
        },
      }),
    );
    const content = vi.spyOn(documentApi, 'content').mockImplementation(async (revisionId) => ({
      revisionId,
      mimeType: 'text/markdown',
      encoding: 'base64',
      bodyBase64: btoa(revisionId === 'old-revision' ? 'before' : 'after'),
      byteLength: 5,
      sha256: 'a'.repeat(64),
    }));
    render(<TaskInputStatusPanel taskId="task" />);
    fireEvent.click(await screen.findByRole('button', { name: '对照 prd 正文' }));
    expect(await screen.findByText(/任务快照 · prd → 当前输入/)).toBeInTheDocument();
    expect(content).toHaveBeenCalledWith('old-revision');
    expect(content).toHaveBeenCalledWith('new-revision');
    expect(screen.getByText(/知悉通知不会更新快照/)).toBeInTheDocument();
  });
  it('discards late responses when the task changes', async () => {
    let resolveOld!: (value: TaskInputStatus) => void;
    vi.spyOn(taskApi, 'inputs')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      )
      .mockResolvedValueOnce(status({ taskId: 'new', snapshotId: 'new-snapshot' }));
    const { rerender } = render(<TaskInputStatusPanel taskId="old" />);
    rerender(<TaskInputStatusPanel taskId="new" />);
    expect(await screen.findByText(/new-snapshot/)).toBeInTheDocument();
    resolveOld(status({ snapshotId: 'obsolete-snapshot' }));
    await waitFor(() => expect(screen.queryByText(/obsolete-snapshot/)).not.toBeInTheDocument());
  });
});
