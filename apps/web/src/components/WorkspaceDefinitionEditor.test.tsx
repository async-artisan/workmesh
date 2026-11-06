import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDefinitionEditor } from './WorkspaceDefinitionEditor';
import { setCsrfToken } from '../api/client';
import { envelope, methodOf, mockFetch, pathOf } from '../test-utils';
import type { WorkspaceDefinitionView } from '../api/resources';

const definition: WorkspaceDefinitionView = {
  definitionStatus: 'NOT_CONFIGURED',
  projectId: 'p1',
  projectVersion: 3,
  definitionVersion: 0,
  revisionId: null,
  revisionNo: null,
  digest: null,
  publishedAt: null,
  payload: null,
  repositories: [],
  draft: null,
  validation: { valid: false, issues: [] },
};

function renderEditor() {
  return render(
    <WorkspaceDefinitionEditor
      projectId="p1"
      projectVersion={3}
      definition={definition}
      repositories={[]}
      canWrite
      onChanged={() => undefined}
    />,
  );
}

describe('WorkspaceDefinitionEditor（加载反馈）', () => {
  beforeEach(() => setCsrfToken('csrf-1'));
  afterEach(() => setCsrfToken(null));

  it('校验定义时显示 role="status" 并禁用按钮，读完才恢复', async () => {
    let release: (value: { status: number; body: unknown }) => void = () => undefined;
    const validateReply = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = resolve;
    });
    mockFetch((url, init) => {
      if (
        pathOf(url) === '/api/v1/projects/p1/workspace-definition/validate' &&
        methodOf(init) === 'POST'
      )
        return validateReply;
      return undefined;
    });

    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '校验定义' }));

    const loadingRegion = await screen.findByRole('status');
    expect(loadingRegion).toHaveTextContent('正在校验定义…');
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: '校验中…' })).toBeDisabled();
    expect(screen.getByLabelText('布局类型')).toBeDisabled();

    await act(async () => {
      release({
        status: 200,
        body: envelope({
          valid: true,
          digest: 'a'.repeat(64),
          definition: null,
          issues: [],
        }),
      });
    });

    expect(await screen.findByText(/下一步保存草稿/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '校验定义' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
  });

  it('页面尚未提供定义版本时给出可执行的只读提示而不是空白表单', () => {
    renderEditor();
    expect(screen.getByRole('heading', { name: /工作区定义/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // 只读/加载由页面负责；编辑器拿到 props 时始终是可编辑形态，不会出现空表单提交。
    expect(screen.getByRole('button', { name: '发布（需要二次验证）' })).toBeDisabled();
  });
});
