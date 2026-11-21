import { useLayoutEffect, useRef, useState } from 'react';
import { ApiError, formatApiError } from '../api/client';
import { changeApi } from '../api/resources';
import { Modal } from './Modal';

/** Targets are a current workbench preview, not a server-side preflight. */
export interface BatchChangeTarget {
  recipientId: string;
  label: string;
  version: number;
}

type BatchItemStatus = 'success' | 'failed' | 'unprocessed';

interface BatchResult extends BatchChangeTarget {
  status: BatchItemStatus;
  error?: string;
  conflict?: boolean;
}

interface BatchChangeAcknowledgeProps {
  open: boolean;
  targets: BatchChangeTarget[];
  /** Read at retry time so an older preview cannot supply the next expectedVersion. */
  getCurrentTargets: () => BatchChangeTarget[];
  onAcknowledged: (recipientId: string) => void;
  refresh: () => Promise<boolean>;
  onCompleted: (confirmed: number) => void;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}

const CONFLICT_HINT = '数据已变化，请重新加载';
const REFRESH_FAILED = '批量确认已完成，但刷新工作台失败；当前显示的是上次成功的数据。';

function statusLabel(status: BatchItemStatus): string {
  if (status === 'success') return '已确认';
  if (status === 'failed') return '失败';
  return '未处理';
}

export function BatchChangeAcknowledge({
  open,
  targets,
  getCurrentTargets,
  onAcknowledged,
  refresh,
  onCompleted,
  onBusyChange,
  onClose,
}: BatchChangeAcknowledgeProps) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [progress, setProgress] = useState<{
    recipientId: string;
    current: number;
    total: number;
  } | null>(null);
  const [refreshError, setRefreshError] = useState('');
  const busyRef = useRef(false);
  const resultsRef = useRef<BatchResult[]>([]);
  const lifecycleRef = useRef(0);
  const mountedRef = useRef(false);

  useLayoutEffect(() => {
    mountedRef.current = true;
    lifecycleRef.current += 1;
    return () => {
      mountedRef.current = false;
      lifecycleRef.current += 1;
    };
  }, []);

  function publish(next: BatchResult[]) {
    resultsRef.current = next;
    setResults(next);
  }

  async function runBatch(nextTargets: BatchChangeTarget[], retry = false) {
    // State alone leaves a gap before React renders the disabled button.
    if (busyRef.current || nextTargets.length === 0 || !mountedRef.current) return;
    busyRef.current = true;
    const lifecycle = lifecycleRef.current;
    const isCurrent = () => mountedRef.current && lifecycleRef.current === lifecycle;
    setBusy(true);
    onBusyChange(true);
    setRefreshError('');
    const carried = retry ? resultsRef.current.filter((result) => result.status === 'success') : [];
    const currentResults: BatchResult[] = nextTargets.map((target) => ({
      ...target,
      status: 'unprocessed',
    }));
    publish([...carried, ...currentResults]);

    try {
      for (const [index, target] of nextTargets.entries()) {
        if (!isCurrent()) return;
        setProgress({
          recipientId: target.recipientId,
          current: index + 1,
          total: nextTargets.length,
        });
        try {
          await changeApi.ack(target.recipientId, target.version);
        } catch (caught) {
          if (!isCurrent()) return;
          currentResults[index] = {
            ...target,
            status: 'failed',
            error: formatApiError(caught),
            conflict: caught instanceof ApiError && caught.status === 409,
          };
          publish([...carried, ...currentResults]);
          // A failed item stops the sequence; the remainder needs an explicit retry.
          break;
        }
        if (!isCurrent()) return;
        currentResults[index] = { ...target, status: 'success' };
        publish([...carried, ...currentResults]);
        onAcknowledged(target.recipientId);
      }
      if (!isCurrent()) return;
      let refreshed = false;
      try {
        refreshed = await refresh();
      } catch {
        // A refresh error does not turn an already acknowledged item into a failed write.
      }
      if (!isCurrent()) return;
      if (!refreshed) setRefreshError(REFRESH_FAILED);
      else {
        const confirmed = currentResults.filter((result) => result.status === 'success').length;
        if (confirmed > 0) onCompleted(confirmed);
      }
    } finally {
      if (isCurrent()) {
        setProgress(null);
        setBusy(false);
        busyRef.current = false;
        onBusyChange(false);
      }
    }
  }

  function retryFailed() {
    if (busyRef.current) return;
    const current = new Map(getCurrentTargets().map((target) => [target.recipientId, target]));
    const retryTargets = resultsRef.current.flatMap((result) => {
      const target = current.get(result.recipientId);
      return result.status !== 'success' && target ? [target] : [];
    });
    void runBatch(retryTargets, true);
  }

  function close() {
    if (!busyRef.current) onClose();
  }

  const alive = new Set(getCurrentTargets().map((target) => target.recipientId));
  const retryCount = results.filter(
    (result) => result.status !== 'success' && alive.has(result.recipientId),
  ).length;
  const successCount = results.filter((result) => result.status === 'success').length;
  const failedCount = results.filter((result) => result.status === 'failed').length;
  const unprocessedCount = results.filter((result) => result.status === 'unprocessed').length;

  return (
    <Modal
      open={open}
      title={results.length > 0 || busy ? '批量确认结果' : '批量确认变更'}
      description={
        results.length > 0 || busy
          ? `共 ${results.length} 条；每条仍按自己的版本提交。`
          : `将逐一确认 ${targets.length} 条变更；每条仍按自己的版本提交。`
      }
      size="md"
      busy={busy}
      onClose={close}
      footer={
        busy ? (
          <button className="ghost" disabled>
            处理中…
          </button>
        ) : results.length === 0 ? (
          <>
            <button className="ghost" onClick={close}>
              取消
            </button>
            <button
              className="primary"
              onClick={() => void runBatch(targets)}
              disabled={targets.length === 0}
            >
              确认开始
            </button>
          </>
        ) : (
          <>
            <button className="ghost" onClick={close}>
              关闭
            </button>
            {retryCount > 0 && (
              <button className="primary" onClick={retryFailed}>
                重试失败项（{retryCount}）
              </button>
            )}
          </>
        )
      }
    >
      {results.length === 0 && !busy ? (
        <>
          <p className="modal-note">
            任一失败会立即停止，剩余条目标记为“未处理”；已确认的条目不会再次提交。
          </p>
          <ul className="detail-list" aria-label="待提交变更列表">
            {targets.map((target) => (
              <li key={target.recipientId}>
                {target.label} · v{target.version}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {busy && progress && (
            <p className="modal-note" role="status">
              正在处理 {progress.current} / {progress.total}
            </p>
          )}
          <p className="modal-note" role="status">
            已确认 {successCount} 条 · 失败 {failedCount} 条 · 未处理 {unprocessedCount} 条
          </p>
          {refreshError && (
            <p className="modal-error" role="alert">
              {refreshError}
            </p>
          )}
          <ul className="detail-list" aria-label="批量确认结果">
            {results.map((result) => {
              const processing =
                busy &&
                result.status === 'unprocessed' &&
                progress?.recipientId === result.recipientId;
              return (
                <li key={result.recipientId}>
                  <strong>{result.label}</strong> · v{result.version} ·{' '}
                  {processing ? '处理中…' : statusLabel(result.status)}
                  {result.status === 'failed' && result.conflict ? ` · ${CONFLICT_HINT}` : ''}
                  {result.status === 'failed' && result.error ? `（${result.error}）` : ''}
                  {result.status === 'unprocessed' && !alive.has(result.recipientId)
                    ? ' · 已不在当前列表中'
                    : ''}
                </li>
              );
            })}
          </ul>
          {refreshError && (
            <p className="modal-note">
              工作台仍显示上次成功数据；可以关闭弹窗后重试刷新，已确认的条目不会重复提交。
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
