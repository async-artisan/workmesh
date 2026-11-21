import { useState } from 'react';
import {
  CODE_EVIDENCE_REASON_LABELS,
  CODE_EVIDENCE_STATUS_LABELS,
  type CodeEvidenceDiagnostics,
} from '@workmesh/shared';
import { artifactApi } from '../api/resources';
import { codeEvidenceRecovery } from '../lib/evidenceRecovery';

export function CodeEvidenceStatus({
  diagnostics,
  taskHref,
}: {
  diagnostics?: CodeEvidenceDiagnostics;
  taskHref?: string;
}) {
  if (!diagnostics)
    return <p className="text-muted">服务端未提供代码证据诊断，请核对代码证据和投递日志。</p>;
  return (
    <div className="code-evidence-diagnostics" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
      <p>
        诊断时间：{diagnostics.checkedAt} · 工件代次 {diagnostics.taskGeneration} / 当前任务代次{' '}
        {diagnostics.currentTaskGeneration}
      </p>
      <p className="text-muted">
        此处解释证据来源与绑定，正式门禁仍以平台评审结果为准。签名失败在创建收据前拒绝；没有关联记录不能判断是否曾投递或验签失败。
      </p>
      {!diagnostics.complete && (
        <p role="status">关联记录超过查询范围，以下结果不完整，不能据此判定无证据或已就绪。</p>
      )}
      {diagnostics.currentBinding !== 'CURRENT' && (
        <p role="status">该交付已不属于当前有效工件，请核对任务的当前交付。</p>
      )}
      <p className="text-muted">
        下方版本仅来自已登记的工件、评审与票据；关联评审 head 是记录值，不代表当前远端 PR head。
        若交付内容或基线变化，由 QA 判断复验范围；这里不会推断需要重跑哪些用例。
      </p>
      {taskHref && (
        <p>
          <a href={taskHref}>定位当前任务与交付</a>
        </p>
      )}
      {diagnostics.references.length === 0 && <p>此工件集未声明需要代码来源诊断的提交。</p>}
      {diagnostics.references.map((reference) => (
        <section
          key={reference.artifactId}
          aria-label={`代码来源 ${reference.commitSha ?? reference.artifactId}`}
        >
          <p>
            <strong>{CODE_EVIDENCE_STATUS_LABELS[reference.status]}</strong>
          </p>
          <p>
            {reference.repository
              ? `${reference.repository.owner}/${reference.repository.name}`
              : '仓库身份未确定'}{' '}
            · SHA <code>{reference.commitSha ?? '未声明'}</code>
          </p>
          <p>建议处理角色：{codeEvidenceRecovery(reference.status).responsible}</p>
          <p>{codeEvidenceRecovery(reference.status).nextStep}</p>
          <details>
            <summary>查看提交与代次对照</summary>
            <ul className="detail-list">
              <li>
                交付声明 SHA：<code>{reference.commitSha ?? '未提供'}</code>
              </li>
              <li>
                交付代次：{diagnostics.taskGeneration}；当前任务代次：
                {diagnostics.currentTaskGeneration}
              </li>
              {reference.reviews.map((review) => (
                <li key={review.id}>
                  关联评审 PR {review.changeRequestId} 的 head 记录值：<code>{review.headSha}</code>
                  ； 评审提交：<code>{review.commitSha ?? '未提供'}</code>
                </li>
              ))}
              {reference.reviews.length === 0 && (
                <li>未提供可关联的评审 head 记录，无法比较提交。</li>
              )}
              {reference.tickets.map((ticket) => (
                <li key={ticket.id}>
                  票据 {ticket.id} 的任务代次：{ticket.generation ?? '未提供'}； 当前任务代次：
                  {diagnostics.currentTaskGeneration}
                </li>
              ))}
            </ul>
          </details>
          {reference.deliveries.map((delivery) => (
            <p key={delivery.id}>
              可信投递 {delivery.id} · {delivery.signatureValid ? '签名有效' : '签名无效'} ·{' '}
              {delivery.status} · 收到 {delivery.receivedAt}
              {delivery.processedAt ? ` · 处理 ${delivery.processedAt}` : ''}
            </p>
          ))}
          {reference.reviews.map((review) => (
            <p key={review.id}>
              PR {review.changeRequestId} · head <code>{review.headSha}</code> · 评审者{' '}
              {review.reviewerExternalId} · {review.state}
              {review.reasons.length
                ? ` · ${review.reasons.map((reason) => CODE_EVIDENCE_REASON_LABELS[reason] ?? reason).join('；')}`
                : ' · 符合来源诊断条件'}
            </p>
          ))}
          {reference.tickets.map((ticket) => (
            <p key={ticket.id}>
              绑定票据 {ticket.id} · 仓库 {ticket.repositoryId} / PR {ticket.changeRequestId} ·{' '}
              {
                { LIVE: '未消费', EXPIRED: '已过期', CONSUMED: '已消费', INVALID: '无有效绑定' }[
                  ticket.state
                ]
              }{' '}
              · 提交{ticket.matchesReference ? '匹配' : '不匹配'} · 代次
              {ticket.matchesGeneration ? '匹配' : '不匹配'}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Loads only on explicit expansion, using the same authorized artifact detail API. */
export function LazyCodeEvidenceStatus({ artifactSetId }: { artifactSetId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CodeEvidenceDiagnostics>();
  const [error, setError] = useState(false);
  async function load() {
    setOpen(true);
    setLoading(true);
    setError(false);
    try {
      setDiagnostics((await artifactApi.get(artifactSetId)).codeReview?.diagnostics);
      setLoaded(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (open) setOpen(false);
          else if (loaded) setOpen(true);
          else void load();
        }}
      >
        代码证据状态
      </button>
      {open &&
        (loading ? (
          <p role="status">正在读取代码证据诊断…</p>
        ) : error ? (
          <div role="alert">
            无法读取代码证据，请确认当前权限并重试。
            <button type="button" onClick={() => void load()}>
              重试代码证据
            </button>
          </div>
        ) : (
          <CodeEvidenceStatus diagnostics={diagnostics} />
        ))}
    </div>
  );
}
