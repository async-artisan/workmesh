import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewDiscussions } from './ReviewDiscussions';
import { setCsrfToken } from '../api/client';
import type { DiscussionEntry, DiscussionPage, ReviewDiscussion } from '../api/reviewDiscussions';
import { bodyOf, envelope, headersOf, methodOf, mockFetch, pathOf } from '../test-utils';
import { useAuthStore } from '../store/auth';

const source = {
  reviewId: 'original-review',
  artifactSetId: 'artifact-set-1',
  documentRevisionId: null,
  subjectDigest: 'a'.repeat(64),
  createdAt: '2026-11-01T00:00:00.000Z',
};
const author = { id: 'user-1', email: 'reviewer@example.test', kind: 'HUMAN' };
function issue(overrides: Partial<ReviewDiscussion> = {}): ReviewDiscussion {
  return {
    id: 'issue-1',
    title: '补充失败场景',
    body: '请提供重试耗尽的实际证据',
    resolved: false,
    version: 2,
    createdAt: source.createdAt,
    updatedAt: source.createdAt,
    author,
    source,
    canReply: true,
    canManage: true,
    entries: [],
    nextEntriesCursor: null,
    ...overrides,
  };
}
function page(
  items: ReviewDiscussion[] = [],
  overrides: Partial<DiscussionPage> = {},
): DiscussionPage {
  return {
    items,
    nextCursor: null,
    unresolvedCount: items.filter((item) => !item.resolved).length,
    canCreate: true,
    ...overrides,
  };
}
function entry(id: string): DiscussionEntry {
  return {
    id,
    kind: 'REPLY',
    body: `回应 ${id}`,
    createdAt: source.createdAt,
    author,
    addressedInReview: null,
  };
}
function mount() {
  return render(
    <MemoryRouter>
      <ReviewDiscussions reviewId="current-review" />
    </MemoryRouter>,
  );
}

describe('ReviewDiscussions（逐条评审问题）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-discussion');
  });
  afterEach(() => {
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    vi.restoreAllMocks();
  });

  it('记录问题并重新读取，网络重试保留相同幂等键和内容', async () => {
    const writes: RequestInit[] = [];
    let created = false;
    mockFetch((url, init) => {
      if (pathOf(url) !== '/api/v1/review-requests/current-review/discussions') return;
      if (methodOf(init) === 'GET')
        return { status: 200, body: envelope(page(created ? [issue()] : [])) };
      writes.push(init);
      if (writes.length === 1) throw new TypeError('connection lost');
      created = true;
      return { status: 201, body: envelope({ discussionId: 'issue-1', version: 1 }) };
    });
    mount();
    await screen.findByText('没有本轮问题或此前轮次的未解决问题。');
    fireEvent.change(screen.getByLabelText('评审问题标题'), {
      target: { value: ' 补充失败场景 ' },
    });
    fireEvent.change(screen.getByLabelText('评审问题内容'), {
      target: { value: ' 请提供重试耗尽的实际证据 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提出评审问题' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('可使用相同内容重试');
    fireEvent.click(screen.getByRole('button', { name: '提出评审问题' }));
    expect(
      await screen.findByRole('article', { name: '评审问题：补充失败场景' }),
    ).toBeInTheDocument();
    expect(writes).toHaveLength(2);
    expect(bodyOf(writes[0])).toEqual({ title: '补充失败场景', body: '请提供重试耗尽的实际证据' });
    expect(headersOf(writes[0])['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(headersOf(writes[0])['Idempotency-Key']).toBe(headersOf(writes[1])['Idempotency-Key']);
    expect(headersOf(writes[0])['X-CSRF-Token']).toBe('csrf-discussion');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('在新轮次逐条回应并关联真实交付编号，保留来源版本与并发版本', async () => {
    let reply: Record<string, unknown> | undefined;
    const fetch = mockFetch((url, init) => {
      if (
        pathOf(url) === '/api/v1/review-requests/current-review/discussions' &&
        methodOf(init) === 'GET'
      )
        return { status: 200, body: envelope(page([issue()])) };
      if (
        pathOf(url) === '/api/v1/review-requests/current-review/discussions/issue-1/entries' &&
        methodOf(init) === 'POST'
      ) {
        reply = bodyOf(init);
        return {
          status: 201,
          body: envelope({ discussionId: 'issue-1', entryId: 'entry-1', version: 3 }),
        };
      }
    });
    mount();
    const thread = within(await screen.findByRole('article', { name: '评审问题：补充失败场景' }));
    expect(thread.getByText(/来自此前评审轮次/)).toHaveTextContent('交付集 artifact-set-1');
    expect(thread.getByRole('link', { name: '查看来源评审' })).toHaveAttribute(
      'href',
      '/reviews/original-review',
    );
    fireEvent.change(thread.getByLabelText('回应 补充失败场景'), {
      target: { value: '新版本已补充超时用例' },
    });
    fireEvent.click(thread.getByRole('button', { name: '关联当前交付轮次' }));
    fireEvent.click(thread.getByRole('button', { name: '提交回应' }));
    await waitFor(() =>
      expect(reply).toEqual({
        kind: 'REPLY',
        expectedVersion: 2,
        body: '新版本已补充超时用例',
        addressedInReviewId: 'current-review',
      }),
    );
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/decisions'))).toBe(false);
  });

  it('解决和重开均要求依据，仅修改问题而不会触发正式批准', async () => {
    let resolved = false;
    let version = 2;
    const actions: Record<string, unknown>[] = [];
    const fetch = mockFetch((url, init) => {
      if (
        pathOf(url) === '/api/v1/review-requests/current-review/discussions' &&
        methodOf(init) === 'GET'
      )
        return { status: 200, body: envelope(page([issue({ resolved, version })])) };
      if (pathOf(url).endsWith('/issue-1/entries') && methodOf(init) === 'POST') {
        const action = bodyOf(init);
        actions.push(action);
        resolved = action.kind === 'RESOLVED';
        version += 1;
        return { status: 201, body: envelope({ discussionId: 'issue-1', version }) };
      }
    });
    mount();
    const resolve = await screen.findByRole('button', { name: '标记问题已解决' });
    expect(resolve).toBeDisabled();
    expect(screen.getByText(/人工批准仍需在审批槽位单独提交/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('回应 补充失败场景'), {
      target: { value: '已核对完整证据' },
    });
    fireEvent.click(resolve);
    const reopen = await screen.findByRole('button', { name: '重新打开问题' });
    expect(reopen).toBeDisabled();
    fireEvent.change(screen.getByLabelText('回应 补充失败场景'), {
      target: { value: '仍缺少断网场景' },
    });
    fireEvent.click(reopen);
    await screen.findByRole('button', { name: '标记问题已解决' });
    expect(actions).toEqual([
      { kind: 'RESOLVED', expectedVersion: 2, body: '已核对完整证据' },
      { kind: 'REOPENED', expectedVersion: 3, body: '仍缺少断网场景' },
    ]);
    expect(fetch.mock.calls.filter(([, init]) => methodOf(init ?? {}) === 'POST')).toHaveLength(2);
    expect(
      fetch.mock.calls.some(([url]) =>
        /decisions|confirmation-tickets|action-previews/.test(String(url)),
      ),
    ).toBe(false);
  });

  it('仅可回应的 Agent 看不到解决操作，版本冲突保留草稿并要求核对最新回应', async () => {
    mockFetch((url, init) => {
      if (pathOf(url).endsWith('/discussions') && methodOf(init) === 'GET')
        return {
          status: 200,
          body: envelope(page([issue({ canManage: false })], { canCreate: false })),
        };
      if (methodOf(init) === 'POST')
        return {
          status: 409,
          body: { error: { code: 'VERSION_CONFLICT', message: 'DISCUSSION_VERSION_CONFLICT' } },
        };
    });
    mount();
    await screen.findByRole('button', { name: '提交回应' });
    expect(screen.queryByRole('button', { name: '标记问题已解决' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('评审问题标题')).not.toBeInTheDocument();
    const body = screen.getByLabelText('回应 补充失败场景');
    fireEvent.change(body, { target: { value: '保留我的解释' } });
    fireEvent.click(screen.getByRole('button', { name: '提交回应' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请刷新问题，核对新回应后再提交');
    expect(body).toHaveValue('保留我的解释');
  });

  it('读取失败展示错误，重试成功后才显示空状态', async () => {
    let failed = true;
    mockFetch(() =>
      failed
        ? { status: 503, body: { error: { code: 'UNAVAILABLE', message: 'database unavailable' } } }
        : { status: 200, body: envelope(page([], { canCreate: false })) },
    );
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('database unavailable');
    expect(screen.queryByText('没有本轮问题或此前轮次的未解决问题。')).not.toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: '刷新问题' }));
    expect(await screen.findByText('没有本轮问题或此前轮次的未解决问题。')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('展开问题和回应分页时保留已有内容，并沿原来源评审读取历史回应', async () => {
    const requested: string[] = [];
    mockFetch((url) => {
      requested.push(url);
      if (pathOf(url) === '/api/v1/review-requests/original-review/discussions/issue-1/entries')
        return {
          status: 200,
          body: envelope({ items: [entry('older'), entry('more')], nextCursor: null }),
        };
      if (url.includes('cursor=issues-next'))
        return {
          status: 200,
          body: envelope(page([issue({ id: 'issue-2', title: '核对错误提示' })])),
        };
      return {
        status: 200,
        body: envelope(
          page([issue({ entries: [entry('older')], nextEntriesCursor: 'entries-next' })], {
            nextCursor: 'issues-next',
          }),
        ),
      };
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '加载更多回应' }));
    expect(await screen.findByText('回应 more')).toBeInTheDocument();
    expect(screen.getAllByText('回应 older')).toHaveLength(1);
    expect(requested).toContain(
      '/api/v1/review-requests/original-review/discussions/issue-1/entries?cursor=entries-next',
    );
    fireEvent.click(screen.getByRole('button', { name: '加载更多问题' }));
    expect(
      await screen.findByRole('article', { name: '评审问题：核对错误提示' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('article', { name: '评审问题：补充失败场景' })).toBeInTheDocument();
  });

  it.each(['review', 'account'])('切换 %s 后忽略旧页面迟到的写入结果与刷新', async (target) => {
    useAuthStore.getState().setSession({ id: 'old-user', email: 'old@example.test' });
    let finishWrite!: (reply: { status: number; body: unknown }) => void;
    let reads = 0;
    mockFetch((url, init) => {
      if (methodOf(init) === 'POST')
        return new Promise((resolve) => {
          finishWrite = resolve;
        });
      reads += 1;
      return { status: 200, body: envelope(page()) };
    });
    const view = mount();
    await screen.findByLabelText('评审问题标题');
    fireEvent.change(screen.getByLabelText('评审问题标题'), { target: { value: '旧视图草稿' } });
    fireEvent.change(screen.getByLabelText('评审问题内容'), { target: { value: '旧视图内容' } });
    fireEvent.click(screen.getByRole('button', { name: '提出评审问题' }));
    await waitFor(() => expect(finishWrite).toBeTypeOf('function'));
    if (target === 'review')
      view.rerender(
        <MemoryRouter>
          <ReviewDiscussions reviewId="different-review" />
        </MemoryRouter>,
      );
    else
      act(() => useAuthStore.getState().setSession({ id: 'new-user', email: 'new@example.test' }));
    await waitFor(() => expect(reads).toBe(2));
    fireEvent.change(screen.getByLabelText('评审问题标题'), { target: { value: '新视图草稿' } });
    await act(async () => {
      finishWrite({ status: 201, body: envelope({ discussionId: 'late-issue', version: 1 }) });
    });
    expect(screen.getByLabelText('评审问题标题')).toHaveValue('新视图草稿');
    expect(screen.queryByText('评审问题已记录。')).not.toBeInTheDocument();
    expect(reads).toBe(2);
  });
});
