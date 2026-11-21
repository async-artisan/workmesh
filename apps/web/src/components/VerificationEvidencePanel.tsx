import { useCallback, useEffect, useRef, useState } from 'react';
import type { VerificationApplicability, VerificationDimension } from '@workmesh/shared';
import { ApiError, formatApiError } from '../api/client';
import { verificationEvidenceApi, type VerificationEvidencePage } from '../api/resources';
import { safeEvidenceUrl } from '../lib/acceptanceEvidence';
import { formatDateTime } from '../lib/datetime';
import { useAuthStore } from '../store/auth';

const DIMENSIONS = [
  ['origin', '运行来源'],
  ['reportAssociation', '报告与 attempt / job 的关联'],
  ['currentness', '当前交付适用性'],
  ['definitionIndependence', '验证定义独立性'],
] as const;
const DIMENSION_STATUS: Record<VerificationDimension['status'], string> = {
  MATCHED: '字段与规则匹配',
  MISMATCH: '不匹配',
  UNKNOWN: '待确认',
};
const OUTCOME: Record<VerificationApplicability['outcome'], string> = {
  REPORTED_PASS: '报告通过，待人工核验',
  FAILED: '报告失败',
  BLOCKED: '报告阻塞',
  NOT_RUN: '报告未执行',
  UNKNOWN: '结果待确认',
};
const REPORT_RESULT = {
  PASSED: '报告通过',
  FAILED: '报告失败',
  BLOCKED: '报告阻塞',
  NOT_RUN: '报告未执行',
};

function ApplicabilityDimensions({ diagnostics }: { diagnostics: VerificationApplicability }) {
  return (
    <dl className="detail-list">
      {DIMENSIONS.map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            <span>{DIMENSION_STATUS[diagnostics[key].status]}</span>
            {diagnostics[key].reasons.length > 0 && (
              <ul>
                {diagnostics[key].reasons.map((reason, index) => (
                  <li key={`${reason}:${index}`}>{reason}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type ReadItem = VerificationEvidencePage['items'][number] & { checkedAt: string };

function VerificationEvidenceItem({ item, stale }: { item: ReadItem; stale: boolean }) {
  const { binding, evidence, diagnostics, checkedAt } = item;
  const collection = evidence.collection;
  const runUrl = safeEvidenceUrl(collection.htmlUrl);
  return (
    <article
      className="task-row"
      aria-label={`验证运行 ${collection.runId} attempt ${collection.attempt}`}
    >
      <div className="task-row-main">
        <div className="task-row-top">
          <strong>
            运行 {collection.runId} / attempt {collection.attempt}
          </strong>
          <span className="status-tag">{OUTCOME[diagnostics.outcome]}</span>
        </div>
        <p className="task-row-meta">
          登记仓库：<code>{evidence.projectRepositoryId}</code> · 提供方仓库 ID：
          <code>{collection.repositoryId}</code>
        </p>
        <p className="task-row-meta">
          采集于 {formatDateTime(evidence.collectedAt)} · 此条诊断核对于 {formatDateTime(checkedAt)}
          ，不代表之后实时有效。
        </p>
        <p>
          提供方原始运行状态：<code>{collection.status}</code> · 原始结论：
          <code>{collection.conclusion ?? '未提供'}</code>
        </p>
        <p>
          运行事件：<code>{collection.event}</code> · head SHA：<code>{collection.headSha}</code>
        </p>
        <p className="task-row-meta">
          采集来源：{collection.origin} · 完整性：
          {collection.completeness === 'COMPLETE' ? '本次采集完整' : '本次采集不完整'} · 身份
          {collection.identityStable ? '在采集校验时稳定' : '稳定性待确认'} · 记录的最新 attempt：
          {collection.latestAttempt}
        </p>
        <p className="task-row-meta">
          工作流：<code>{collection.workflowPath}</code> · workflow ID：
          <code>{collection.workflowId}</code>
        </p>
        <p className="task-row-meta">
          提供方创建于 {formatDateTime(collection.createdAt)} · 记录更新于{' '}
          {formatDateTime(collection.updatedAt)}
        </p>
        {runUrl && (
          <p>
            <a href={runUrl} target="_blank" rel="noopener noreferrer">
              打开提供方运行
            </a>
          </p>
        )}
        <h4>{stale ? '上次读取时的适用性诊断' : '本次读取的适用性诊断'}</h4>
        <ApplicabilityDimensions diagnostics={diagnostics} />
        {diagnostics.reasons.length > 0 && (
          <ul aria-label="适用性说明">
            {diagnostics.reasons.map((reason, index) => (
              <li key={`${reason}:${index}`}>{reason}</li>
            ))}
          </ul>
        )}
        {collection.issues.length > 0 && (
          <ul aria-label="采集缺口">
            {collection.issues.map((issue, index) => (
              <li key={`${issue}:${index}`}>{issue}</li>
            ))}
          </ul>
        )}
        <details>
          <summary>查看提供方原始 jobs 与步骤</summary>
          <p className="task-row-meta">
            以下保留提供方原始状态与结论；success 不证明测试充分、报告真实或 HUMAN 已批准。
          </p>
          {collection.jobs.length === 0 && <p>本次采集没有可展示的 job，不能推断运行通过。</p>}
          <ul className="detail-list">
            {collection.jobs.map((job) => (
              <li key={`${job.id}:${job.attempt}`}>
                <strong>{job.name}</strong> · job <code>{job.id}</code> · attempt {job.attempt} ·
                run <code>{job.runId}</code> · 状态 <code>{job.status}</code> · 结论{' '}
                <code>{job.conclusion ?? '未提供'}</code>
                <p className="task-row-meta">
                  head SHA：<code>{job.headSha}</code> · 开始{' '}
                  {job.startedAt ? formatDateTime(job.startedAt) : '未提供'} · 结束{' '}
                  {job.completedAt ? formatDateTime(job.completedAt) : '未提供'}
                </p>
                {job.steps.length > 0 && (
                  <ol>
                    {job.steps.map((step, index) => (
                      <li key={`${step.number}:${index}`}>
                        {step.name} · <code>{step.status}</code> /{' '}
                        <code>{step.conclusion ?? '未提供'}</code>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </details>
        <details>
          <summary>查看结果报告与精确用例修订</summary>
          <p className="task-row-meta">
            报告内容为 LOCAL_REPORTED。提供方运行事实、下载字节与报告中的测试声明分别核对。
          </p>
          {collection.reports.length === 0 && (
            <p>本次采集未提供可展示的报告，不能推断提供方从未产生报告或用例已经通过。</p>
          )}
          {collection.reports.map((report, reportIndex) => (
            <section
              key={`${report.artifactId}:${reportIndex}`}
              aria-label={`结果报告 ${report.name}`}
            >
              <h5>{report.name}</h5>
              <p>
                提供方 artifact ID：<code>{report.artifactId}</code> ·{' '}
                {report.expired ? '提供方工件已过期' : '采集时未标记过期'}
              </p>
              <p>
                报告关联：
                {report.association === 'RUN_ONLY'
                  ? '仅关联 run，未证明所属 attempt / job'
                  : '待确认'}
              </p>
              <p className="task-row-meta">
                归档 SHA-256：<code>{report.archiveSha256 ?? '未提供'}</code> · 报告 SHA-256：
                <code>{report.reportSha256 ?? '未提供'}</code> · 正文字节：
                {report.reportByteLength ?? '未提供'}
              </p>
              {report.issues.length > 0 && (
                <ul>
                  {report.issues.map((issue, index) => (
                    <li key={`${issue}:${index}`}>{issue}</li>
                  ))}
                </ul>
              )}
              {!report.report ? (
                <p>未解析到有效结果报告；结果待确认。</p>
              ) : (
                <>
                  <p>
                    报告声明：run <code>{report.report.run.runId}</code> / attempt{' '}
                    {report.report.run.runAttempt} / job{' '}
                    <code>{report.report.run.jobId ?? '未提供'}</code> / job key{' '}
                    <code>{report.report.run.jobKey}</code>
                  </p>
                  <p>
                    报告声称被测 SHA：<code>{report.report.run.testedCommitSha}</code> ·
                    这是报告声明，不能由 run head 自动推导。
                  </p>
                  <p className="task-row-meta">
                    报告声称提供方仓库 ID：<code>{report.report.run.repositoryId}</code> · 事件：
                    <code>{report.report.run.event}</code> · head SHA：
                    <code>{report.report.run.headSha}</code>
                  </p>
                  <p className="task-row-meta">
                    报告依据 PRD：<code>{report.report.basis.prdRevisionId}</code> · 快照：
                    <code>{report.report.basis.snapshotId}</code> · 仓库：
                    <code>{report.report.basis.projectRepositoryId}</code>
                  </p>
                  <p className="task-row-meta">
                    报告环境：{report.report.environment.summary} ·{' '}
                    {formatDateTime(report.report.environment.startedAt)} —{' '}
                    {formatDateTime(report.report.environment.completedAt)}
                  </p>
                  <ul className="detail-list">
                    {report.report.results.map((result) => {
                      const resultUrl = result.ref ? safeEvidenceUrl(result.ref) : null;
                      return (
                        <li key={result.id}>
                          <strong>
                            {result.caseRef.caseId} · {REPORT_RESULT[result.result]}
                          </strong>
                          <p className="task-row-meta">
                            CASES 工件：<code>{result.caseRef.revision.artifactId}</code> ·
                            SHA-256：<code>{result.caseRef.revision.sha256}</code>
                          </p>
                          {result.ref && (
                            <p>
                              {resultUrl ? (
                                <a href={resultUrl} target="_blank" rel="noopener noreferrer">
                                  {result.ref}
                                </a>
                              ) : (
                                <code>{result.ref}</code>
                              )}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>
          ))}
        </details>
        <details>
          <summary>查看绑定时记录与历史诊断</summary>
          <p className="task-row-meta">
            绑定 <code>{binding.id}</code> · 交付物集 <code>{binding.artifactSetId}</code> · 创建于{' '}
            {formatDateTime(binding.createdAt)}
          </p>
          <p className="task-row-meta">
            采集记录 <code>{evidence.id}</code> · 载荷摘要 <code>{evidence.payloadDigest}</code>
          </p>
          <p>以下只保留绑定时的诊断，不能代替本次读取的适用性，也不会撤销原 HUMAN 决定。</p>
          <p>绑定时报告结果：{OUTCOME[binding.diagnostics.outcome]}</p>
          <ApplicabilityDimensions diagnostics={binding.diagnostics} />
          {binding.diagnostics.reasons.length > 0 && (
            <ul>
              {binding.diagnostics.reasons.map((reason, index) => (
                <li key={`${reason}:${index}`}>{reason}</li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </article>
  );
}

function VerificationEvidenceReader({
  projectId,
  artifactSetId,
  taskHref,
}: {
  projectId: string;
  artifactSetId: string;
  taskHref?: string;
}) {
  const [items, setItems] = useState<ReadItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const read = useCallback(
    async (cursor?: string) => {
      const identity = ++requestId.current;
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      setError('');
      try {
        const page = await verificationEvidenceApi.list(projectId, artifactSetId, cursor);
        if (identity !== requestId.current) return;
        const added = page.items.map((item) => ({ ...item, checkedAt: page.checkedAt }));
        setItems((previous) =>
          cursor
            ? [...new Map([...previous, ...added].map((item) => [item.binding.id, item])).values()]
            : added,
        );
        setCheckedAt(page.checkedAt);
        setNextCursor(page.nextCursor);
      } catch (caught) {
        if (identity !== requestId.current) return;
        setError(
          caught instanceof ApiError && [403, 404].includes(caught.status)
            ? '当前账号不可读取验证证据，或服务端尚未提供该接口；不能据此认定没有证据。'
            : formatApiError(caught),
        );
      } finally {
        if (identity === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [projectId, artifactSetId],
  );
  useEffect(() => {
    void read();
    return () => {
      requestId.current += 1;
    };
  }, [read]);
  const stale = loading || Boolean(error);
  return (
    <section
      className="detail-card"
      aria-label="提供方运行与验证证据"
      style={{ overflowWrap: 'anywhere', minWidth: 0 }}
    >
      <div className="detail-card-head">
        <h3>提供方运行与验证证据</h3>
        <button
          type="button"
          className="ghost"
          disabled={loading || loadingMore}
          onClick={() => void read()}
        >
          刷新验证证据
        </button>
      </div>
      <p className="page-sub">
        运行来源、报告关联、当前适用性与验证定义独立性分别展示。这些只读诊断属于
        ADVISORY，不增加批准门禁，也不代替 HUMAN 签字或既有代码评审要求。
      </p>
      {taskHref && (
        <p>
          <a href={taskHref}>定位当前任务与交付</a>
        </p>
      )}
      {loading && (
        <p role="status">
          {checkedAt
            ? '正在刷新验证证据；下方保留上次读取内容，当前适用性待确认。'
            : '正在读取验证证据，数量与适用性待确认。'}
        </p>
      )}
      {error && (
        <p role="alert">
          {checkedAt
            ? '刷新或分页读取失败；下方为上次读取的诊断，不能作为当前适用性结论。'
            : '验证证据读取失败。'}
          {error}
        </p>
      )}
      {checkedAt && (
        <p className="task-row-meta">
          最近读取批次：{formatDateTime(checkedAt)} · 已展示 {items.length}{' '}
          条绑定记录；各条核对时间见详情。
        </p>
      )}
      {!loading && !error && checkedAt && items.length === 0 && (
        <p>本次读取没有关联的验证证据记录。这不代表未曾运行测试，也不代表验收通过。</p>
      )}
      {items.map((item) => (
        <VerificationEvidenceItem key={item.binding.id} item={item} stale={stale} />
      ))}
      {nextCursor && (
        <div>
          <p role="status">还有绑定记录未读取；当前列表不完整，不能据此认定整体无异常。</p>
          <button
            type="button"
            className="ghost"
            disabled={loading || loadingMore}
            onClick={() => void read(nextCursor)}
          >
            {loadingMore ? '正在加载更多验证证据…' : '加载更多验证证据'}
          </button>
        </div>
      )}
    </section>
  );
}

/** The keyed reader prevents old project, delivery or viewer responses from crossing scope. */
export function VerificationEvidencePanel(props: {
  projectId: string;
  artifactSetId: string;
  taskHref?: string;
}) {
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  return (
    <VerificationEvidenceReader
      key={JSON.stringify([viewerId, props.projectId, props.artifactSetId])}
      {...props}
    />
  );
}
