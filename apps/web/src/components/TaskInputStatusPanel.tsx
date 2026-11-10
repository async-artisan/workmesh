import { useEffect, useRef, useState } from 'react';
import { base64ToUtf8, documentApi, taskApi, type TaskInputStatus } from '../api/resources';
import { formatApiError } from '../api/client';
import { formatDateTime } from '../lib/datetime';
import { DiffViewer } from './DiffViewer';
import {
  TASK_INPUT_KIND_LABELS,
  TASK_INPUT_REASON_LABELS,
  TASK_INPUT_ACTION_LABELS,
  TASK_INPUT_OWNER_LABELS,
} from '@workmesh/shared';

const AVAILABILITY = {
  VERIFIED: '服务端输入内容已核验',
  UNAVAILABLE: '必需输入不可用',
  REQUIRES_LOCAL_CHECK: '部分输入仍需本机核验',
};
const COMPARISON = {
  NO_SNAPSHOT: '尚未生成任务快照',
  CURRENT: '当前输入与任务快照一致',
  CHANGED: '当前输入与任务快照存在变化',
  UNAVAILABLE: '快照对照暂不可用',
};
const CONTENT = {
  VERIFIED: '内容已核验',
  UNAVAILABLE: '内容不可用',
  EXTERNAL_REFERENCE: '代码引用需在本机核验',
  UNVERIFIED: '内容待核验',
};
const METADATA: Record<string, string> = {
  requirementGeneration: '需求代次',
  taskGeneration: '任务代次',
  workflowDefinitionRevisionId: '流程修订',
  workflowDigest: '流程内容',
  deliveryScope: '交付范围',
};

export function TaskInputStatusPanel({ taskId }: { taskId: string }) {
  const [data, setData] = useState<TaskInputStatus | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [diff, setDiff] = useState<{ oldText: string; newText: string; key: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState('');
  const [diffError, setDiffError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let alive = true;
    generation.current += 1;
    setData(null);
    setError('');
    setDiff(null);
    setDiffError('');
    setDiffLoading('');
    taskApi
      .inputs(taskId)
      .then((value) => {
        if (alive) setData(value);
      })
      .catch((caught: unknown) => {
        if (alive) setError(formatApiError(caught));
      });
    return () => {
      alive = false;
      generation.current += 1;
    };
  }, [taskId, attempt]);

  async function compare(change: TaskInputStatus['comparison']['changes'][number]) {
    const requestGeneration = generation.current;
    setDiff(null);
    setDiffError('');
    setDiffLoading(change.refId);
    try {
      const [before, after] = await Promise.all([
        documentApi.content(change.previousTargetId!),
        documentApi.content(change.currentTargetId!),
      ]);
      if (requestGeneration !== generation.current) return;
      if (
        ![before.mimeType, after.mimeType].every((type) =>
          /^(text\/|application\/(json|yaml))/.test(type),
        )
      )
        throw new Error('该输入不是可按文本对照的文档，请在知识页面查看原始内容。');
      setDiff({
        oldText: base64ToUtf8(before.bodyBase64),
        newText: base64ToUtf8(after.bodyBase64),
        key: change.refId,
      });
    } catch (caught) {
      if (requestGeneration === generation.current) setDiffError(formatApiError(caught));
    } finally {
      if (requestGeneration === generation.current) setDiffLoading('');
    }
  }

  return (
    <section aria-label="任务输入与快照对照">
      <p>输入核验独立于前置完成和本人领取资格；本机仓库、工具与运行环境仍需由本地 Agent 检查。</p>
      {error ? (
        <div role="alert">
          输入状态读取失败：{error}
          <button className="ghost" onClick={() => setAttempt((value) => value + 1)}>
            重试核验输入
          </button>
        </div>
      ) : !data ? (
        <p role="status">正在核验任务输入…</p>
      ) : (
        <>
          <p>
            <strong>{AVAILABILITY[data.availability]}</strong> ·{' '}
            {COMPARISON[data.comparison.status]}
          </p>
          <p>
            检查时间 {formatDateTime(data.checkedAt)} · 任务 v{data.taskVersion}
          </p>
          {data.issue === 'SNAPSHOT_EXTERNAL_INPUT_UNSUPPORTED' && (
            <p role="note">
              必需上游工件仅提供外部 Git
              引用，当前快照无法展开该正文。请由上游责任人按流程补交已验收的 HOSTED
              正文；本机检查代码引用后仍不能据此创建快照。
            </p>
          )}
          {data.availability === 'UNAVAILABLE' && (
            <p>
              请联系项目资料维护者发布并绑定必需知识，或由上游责任人完成交付；核验失败不会自动创建快照。
            </p>
          )}
          {data.issues?.length ? (
            <ul aria-label="输入问题与恢复动作">
              {data.issues.map((issue, index) => (
                <li
                  key={`${issue.kind}:${issue.inputKey ?? issue.refId ?? issue.documentId ?? index}`}
                  style={{ overflowWrap: 'anywhere' }}
                >
                  <strong>
                    {TASK_INPUT_KIND_LABELS[issue.kind]}：{TASK_INPUT_REASON_LABELS[issue.reason]}
                  </strong>
                  <p>
                    {issue.inputKey && <>输入 {issue.inputKey} · </>}
                    {issue.documentId && <>文档 {issue.documentId} · </>}
                    {issue.revisionId && <>修订 {issue.revisionId} · </>}
                    {issue.fromStepKey && (
                      <>
                        上游步骤 {issue.fromStepKey} · 工件 {issue.artifactKind} ·{' '}
                      </>
                    )}
                    {issue.refId && <>引用 {issue.refId} · </>}
                    {issue.blocking ? '阻止创建完整快照' : '仍需核验'}
                  </p>
                  <p>
                    {TASK_INPUT_OWNER_LABELS[issue.responsible]}：
                    {TASK_INPUT_ACTION_LABELS[issue.action]}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          {data.issuesComplete !== true && (
            <p role="note">平台未提供完整的逐项诊断，不能据此认定没有其他输入问题。</p>
          )}
          {data.snapshotId && (
            <p style={{ overflowWrap: 'anywhere' }}>对照快照 ID：{data.snapshotId}</p>
          )}
          {data.comparison.status === 'CHANGED' && (
            <p>
              请先查看变化，再由原领取者重新获取上下文并提交调整；知悉通知不会更新快照，也不代表调整已验证。
            </p>
          )}
          {data.comparison.status === 'UNAVAILABLE' && (
            <p>未取得当前可读的完整快照，无法判断变化；请重试或联系管理员核实读取权限。</p>
          )}
          {data.comparison.metadataChanges.length > 0 && (
            <p>
              变化范围：
              {data.comparison.metadataChanges.map((key) => METADATA[key] ?? key).join('、')}
            </p>
          )}
          {data.comparison.changes.length > 0 && (
            <ul>
              {data.comparison.changes.map((change) => (
                <li key={change.refId} style={{ overflowWrap: 'anywhere' }}>
                  {change.refId}：
                  {{ ADDED: '新增', REMOVED: '移除', CHANGED: '变化' }[change.status]} · 原引用{' '}
                  {change.previousTargetId ?? '无'} → 当前引用 {change.currentTargetId ?? '无'}
                  {change.kind === 'DOCUMENT_REVISION' &&
                    change.previousTargetId &&
                    change.currentTargetId && (
                      <button
                        className="ghost"
                        disabled={Boolean(diffLoading)}
                        onClick={() => void compare(change)}
                      >
                        对照 {change.refId} 正文
                      </button>
                    )}
                </li>
              ))}
            </ul>
          )}
          {diffLoading && <p role="status">正在读取对照正文…</p>}
          {diffError && <p role="alert">正文对照失败：{diffError}</p>}
          {diff && (
            <DiffViewer
              oldText={diff.oldText}
              newText={diff.newText}
              baseLabel={`任务快照 · ${diff.key}`}
              currentLabel="当前输入"
            />
          )}
          <details>
            <summary>输入引用与内容核验详情（{data.resources.length} 项）</summary>
            <ul>
              {data.resources.map((ref) => (
                <li key={ref.refId} style={{ overflowWrap: 'anywhere' }}>
                  {ref.refId} · {CONTENT[ref.contentStatus]} · 引用 {ref.targetId}
                </li>
              ))}
            </ul>
          </details>
          <button className="ghost" onClick={() => setAttempt((value) => value + 1)}>
            重新核验输入
          </button>
        </>
      )}
    </section>
  );
}
