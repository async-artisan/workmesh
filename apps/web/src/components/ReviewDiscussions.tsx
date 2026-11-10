import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, formatApiError } from '../api/client';
import {
  reviewDiscussionApi,
  type DiscussionEntry,
  type DiscussionPage,
  type DiscussionReply,
  type ReviewDiscussion,
} from '../api/reviewDiscussions';
import { formatDateTime } from '../lib/datetime';
import { useAuthStore } from '../store/auth';

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function useWriteKey() {
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  return {
    forInput: (input: unknown) => {
      const fingerprint = JSON.stringify(input);
      if (pending.current?.fingerprint !== fingerprint)
        pending.current = { fingerprint, key: crypto.randomUUID() };
      return pending.current.key;
    },
    clear: () => {
      pending.current = null;
    },
  };
}

function DiscussionThread({
  item,
  currentReviewId,
  onChanged,
}: {
  item: ReviewDiscussion;
  currentReviewId: string;
  onChanged: () => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [deliveryId, setDeliveryId] = useState('');
  const [entries, setEntries] = useState<DiscussionEntry[]>(item.entries);
  const [cursor, setCursor] = useState(item.nextEntriesCursor);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const key = useWriteKey();
  const mounted = useMounted();
  useEffect(() => {
    setEntries(item.entries);
    setCursor(item.nextEntriesCursor);
  }, [item.entries, item.nextEntriesCursor]);

  async function submit(kind: DiscussionReply['kind']) {
    if (!body.trim() || busy) return;
    const input: DiscussionReply = {
      kind,
      expectedVersion: item.version,
      body: body.trim(),
      ...(deliveryId.trim() ? { addressedInReviewId: deliveryId.trim() } : {}),
    };
    setBusy(true);
    setError('');
    try {
      await reviewDiscussionApi.reply(
        currentReviewId,
        item.id,
        input,
        key.forInput([item.id, input]),
      );
      if (!mounted.current) return;
      key.clear();
      setBody('');
      setDeliveryId('');
      await onChanged();
    } catch (caught) {
      if (!mounted.current) return;
      setError(
        `${formatApiError(caught)}${caught instanceof ApiError && caught.status === 409 ? '；请刷新问题，核对新回应后再提交。' : '；可使用相同内容重试。'}`,
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function more() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await reviewDiscussionApi.entries(item.source.reviewId, item.id, cursor);
      if (!mounted.current) return;
      setEntries((previous) => [
        ...new Map([...previous, ...page.items].map((entry) => [entry.id, entry])).values(),
      ]);
      setCursor(page.nextCursor);
      setError('');
    } catch (caught) {
      if (mounted.current) setError(formatApiError(caught));
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }
  return (
    <article className="task-row" aria-label={`评审问题：${item.title}`}>
      <div className="task-row-main">
        <div className="task-row-top">
          <strong>{item.title}</strong>
          <span className="status-tag">{item.resolved ? '已解决' : '未解决'}</span>
        </div>
        <p className="task-row-meta">
          {item.author.email} · {item.author.kind === 'AGENT' ? 'Agent' : '人工'} ·{' '}
          {formatDateTime(item.createdAt)}
        </p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{item.body}</p>
        <p className="task-row-meta">
          {item.source.reviewId === currentReviewId ? '本轮问题' : '来自此前评审轮次的未解决问题'} ·{' '}
          <Link to={`/reviews/${encodeURIComponent(item.source.reviewId)}`}>查看来源评审</Link> ·{' '}
          {item.source.artifactSetId
            ? `交付集 ${item.source.artifactSetId}`
            : `文档修订 ${item.source.documentRevisionId}`}
        </p>
        <ol className="detail-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <p className="task-row-meta">
                {entry.author.email} · {entry.author.kind === 'AGENT' ? 'Agent' : '人工'} ·{' '}
                {entry.kind === 'RESOLVED'
                  ? '标记已解决'
                  : entry.kind === 'REOPENED'
                    ? '重新打开'
                    : '回应'}{' '}
                · {formatDateTime(entry.createdAt)}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</p>
              {entry.addressedInReview && (
                <p>
                  <Link to={`/reviews/${encodeURIComponent(entry.addressedInReview.reviewId)}`}>
                    查看回应关联的实际交付轮次
                  </Link>{' '}
                  ·{' '}
                  {entry.addressedInReview.artifactSetId ??
                    entry.addressedInReview.documentRevisionId}
                </p>
              )}
            </li>
          ))}
        </ol>
        {cursor && (
          <button className="ghost" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? '正在加载回应…' : '加载更多回应'}
          </button>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {(item.canReply || item.canManage) && (
          <div className="form-grid">
            <label>
              逐条回应 / 解决依据
              <textarea
                aria-label={`回应 ${item.title}`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={10000}
                disabled={busy}
                rows={3}
              />
            </label>
            <label>
              关联实际交付评审编号（可选）
              <input
                aria-label={`关联交付 ${item.title}`}
                value={deliveryId}
                onChange={(event) => setDeliveryId(event.target.value)}
                disabled={busy}
                placeholder="填写真实评审 UUID"
              />
            </label>
            {item.source.reviewId !== currentReviewId && (
              <button
                className="ghost"
                disabled={busy}
                onClick={() => setDeliveryId(currentReviewId)}
              >
                关联当前交付轮次
              </button>
            )}
            <div className="cell-actions">
              {item.canReply && (
                <button
                  className="ghost"
                  disabled={busy || !body.trim()}
                  onClick={() => void submit('REPLY')}
                >
                  提交回应
                </button>
              )}
              {item.canManage && (
                <button
                  className="ghost"
                  disabled={busy || !body.trim()}
                  onClick={() => void submit(item.resolved ? 'REOPENED' : 'RESOLVED')}
                >
                  {item.resolved ? '重新打开问题' : '标记问题已解决'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

export function ReviewDiscussions({ reviewId }: { reviewId: string }) {
  const viewerId = useAuthStore((state) => state.user?.id ?? 'anonymous');
  return <ReviewDiscussionsView key={`${viewerId}:${reviewId}`} reviewId={reviewId} />;
}

function ReviewDiscussionsView({ reviewId }: { reviewId: string }) {
  const [page, setPage] = useState<DiscussionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  const key = useWriteKey();
  const mounted = useMounted();
  const load = useCallback(async () => {
    if (!mounted.current) return;
    const request = ++sequence.current;
    setLoading(true);
    try {
      const value = await reviewDiscussionApi.list(reviewId);
      if (request !== sequence.current) return;
      setPage(value);
      setError('');
    } catch (caught) {
      if (request === sequence.current) setError(formatApiError(caught));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [reviewId, mounted]);
  useEffect(() => {
    setPage(null);
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [load]);
  async function more() {
    if (!page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    const request = sequence.current;
    try {
      const value = await reviewDiscussionApi.list(reviewId, page.nextCursor);
      if (request !== sequence.current) return;
      setPage((previous) =>
        previous
          ? {
              ...value,
              items: [
                ...new Map(
                  [...previous.items, ...value.items].map((item) => [item.id, item]),
                ).values(),
              ],
            }
          : value,
      );
      setError('');
    } catch (caught) {
      if (request === sequence.current) setError(formatApiError(caught));
    } finally {
      if (request === sequence.current) setLoadingMore(false);
    }
  }
  async function create() {
    if (!title.trim() || !body.trim() || busy) return;
    const input = { title: title.trim(), body: body.trim() };
    setBusy(true);
    try {
      await reviewDiscussionApi.create(reviewId, input, key.forInput(input));
      if (!mounted.current) return;
      key.clear();
      setTitle('');
      setBody('');
      setNotice('评审问题已记录。');
      await load();
    } catch (caught) {
      if (mounted.current) setError(`${formatApiError(caught)}；可使用相同内容重试。`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="detail-card" aria-label="结构化评审问题">
      <div className="detail-card-head">
        <h3>评审问题{page && <small>未解决 {page.unresolvedCount}</small>}</h3>
        <button className="ghost" disabled={loading || busy} onClick={() => void load()}>
          刷新问题
        </button>
      </div>
      <p className="task-row-meta">
        问题与回应绑定具体评审和交付版本。标记已解决只关闭问题；人工批准仍需在审批槽位单独提交。
      </p>
      {loading && <p role="status">正在读取评审问题…</p>}
      {error && (
        <p className="error" role="alert">
          评审问题读取或提交失败：{error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {page?.items.map((item) => (
        <DiscussionThread key={item.id} item={item} currentReviewId={reviewId} onChanged={load} />
      ))}
      {!loading && !error && page?.items.length === 0 && (
        <p className="task-row-meta">没有本轮问题或此前轮次的未解决问题。</p>
      )}
      {page?.nextCursor && (
        <button className="ghost" disabled={loadingMore || loading} onClick={() => void more()}>
          {loadingMore ? '正在加载问题…' : '加载更多问题'}
        </button>
      )}
      {page?.canCreate && (
        <div className="form-grid">
          <label>
            问题标题
            <input
              aria-label="评审问题标题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              disabled={busy}
            />
          </label>
          <label>
            问题与期望调整
            <textarea
              aria-label="评审问题内容"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={10000}
              rows={3}
              disabled={busy}
            />
          </label>
          <button
            className="ghost"
            disabled={busy || !title.trim() || !body.trim()}
            onClick={() => void create()}
          >
            {busy ? '正在记录问题…' : '提出评审问题'}
          </button>
        </div>
      )}
    </section>
  );
}
