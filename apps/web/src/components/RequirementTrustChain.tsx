import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  REQUIREMENT_TRUST_GAP_LABELS,
  type RequirementTrustChain as TrustChain,
  type RequirementTrustEvent,
} from '@workmesh/shared';
import { formatDateTime } from '../lib/datetime';

const KIND: Record<RequirementTrustEvent['kind'], string> = {
  PUBLICATION: '发布',
  WITHDRAWAL: '撤回',
  DELIVERY: '交付',
  REVIEW_REQUEST: '请求评审',
  DECISION: '正式决定',
  REVOCATION: '撤销决定',
  CHANGE: '变更',
};
const SOURCE: Record<RequirementTrustEvent['source'], string> = {
  PLATFORM_FACT: '平台登记事实',
  HUMAN_SIGNED: 'HUMAN 签字',
  AGENT_SUBMITTED: 'Agent 提交',
  HUMAN_SUBMITTED: '人类提交',
  UNRECORDED_ACTOR: '来源未完整记录',
};
const APPLICABILITY: Record<RequirementTrustEvent['applicability'], string> = {
  CURRENT: '当前关联',
  HISTORICAL: '历史事实',
  WITHDRAWN: '已撤回',
  REVOKED: '已撤销',
  UNKNOWN: '有效性待核对',
};
const DECISION: Record<string, string> = { APPROVE: '批准', REWORK: '要求返修', REJECT: '拒绝' };

export function RequirementTrustChain({
  chain,
  mode = 'summary',
  onTask,
  onTimeline,
}: {
  chain?: TrustChain;
  mode?: 'summary' | 'timeline';
  onTask: (id: string) => void;
  onTimeline?: () => void;
}) {
  const [kind, setKind] = useState('all');
  const [applicability, setApplicability] = useState('all');
  if (!chain)
    return (
      <section className="detail-card" aria-label="需求证据完整性">
        <h3>需求证据完整性</h3>
        <p className="detail-text">
          当前平台未返回信任链诊断，暂时无法确认完整性。可分别核对交付与评审记录。
        </p>
      </section>
    );
  const accepted = chain.tasks.filter((task) => task.state === 'ACCEPTED').length;
  const active = chain.tasks.filter((task) => task.state !== 'RETIRED').length;
  const events = chain.timeline.filter(
    (event) =>
      (kind === 'all' || event.kind === kind) &&
      (applicability === 'all' || event.applicability === applicability),
  );
  return (
    <section className="detail-card" aria-label="需求证据完整性">
      <div className="detail-card-head">
        <h3>需求证据完整性</h3>
        <span className="status-tag">
          {chain.status === 'LINKED'
            ? '正式链已关联'
            : chain.status === 'UNAVAILABLE'
              ? '部分资料待核对'
              : '存在证据缺口'}
        </span>
      </div>
      <p className="detail-text">
        当前需求第 {chain.requirementGeneration} 代 · {accepted}/{active}{' '}
        项有效任务的正式证据链已完整关联。核对时间：{formatDateTime(chain.checkedAt)}
      </p>
      <p className="modal-note">
        此处只读核对平台已登记事实的关联、来源与签字，不改变任务或批准状态。功能是否正确、Agent
        自报与外部测试是否可信，仍需在评审中逐条核验。历史批准不代表当前有效。
      </p>
      <ul className="detail-list" aria-label="当前发布基线">
        {chain.baselines.map((baseline) => (
          <li key={baseline.kind}>
            <strong>{baseline.kind === 'PRD' ? '产品需求' : '需求理解'}</strong>：
            {baseline.state === 'CURRENT'
              ? `当前发布 v${baseline.seq} · ${baseline.title}`
              : baseline.state === 'MISSING'
                ? '尚未发布'
                : baseline.state === 'UNAVAILABLE'
                  ? '不可读取或归属待核对'
                  : '发布事实不一致'}
          </li>
        ))}
      </ul>
      {chain.visibility === 'PARTIAL' && (
        <p role="status" className="detail-text">
          部分文档或修订当前不可见，诊断不覆盖这些内容；隐藏记录不会被计为已完成。
        </p>
      )}
      {chain.gaps.length > 0 && (
        <details open={mode === 'timeline'}>
          <summary>查看 {chain.gaps.length} 项缺口与定位</summary>
          <ul className="detail-list" aria-label="信任链缺口">
            {chain.gaps.map((gap, index) => (
              <li
                key={`${gap.code}-${gap.taskId ?? gap.acceptanceKey ?? gap.baselineKind}-${index}`}
              >
                <span>{REQUIREMENT_TRUST_GAP_LABELS[gap.code]}</span>
                {gap.baselineKind && (
                  <span> · {gap.baselineKind === 'PRD' ? '产品需求' : '需求理解'}</span>
                )}
                {gap.acceptanceKey && <span> · 验收 {gap.acceptanceKey}</span>}
                {gap.taskId && (
                  <>
                    <span> · </span>
                    <button className="ghost" onClick={() => onTask(gap.taskId!)}>
                      定位{' '}
                      {chain.tasks.find((task) => task.taskId === gap.taskId)?.stepLabel ?? '任务'}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {chain.acceptance.length > 0 && (
        <details>
          <summary>验收条件与当前任务关联</summary>
          <ul className="detail-list" aria-label="验收关联">
            {chain.acceptance.map((item) => (
              <li key={item.key}>
                <strong>{item.key}</strong>：{item.acceptedTaskIds.length}/{item.taskIds.length}{' '}
                个承接任务具备正式验收链{item.taskIds.length === 0 ? ' · 尚未分配' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {chain.tasks.some((task) => task.baselineRelation === 'PRESERVED_ACCEPTANCE') && (
        <p className="modal-note">
          部分已完成任务保留了正式批准，快照来自历史需求代次；它们显示为“保留的已验收事实”，不会伪装成当前基线快照。
        </p>
      )}
      {mode === 'summary' && onTimeline && (
        <button className="ghost" onClick={onTimeline}>
          展开信任链时间线（{chain.timeline.length}）
        </button>
      )}
      {mode === 'timeline' && (
        <>
          <div className="detail-card-head">
            <h3>
              正式事实时间线<small>{events.length}</small>
            </h3>
          </div>
          <div className="form-grid">
            <label>
              事件类型
              <select
                className="select"
                aria-label="信任链事件类型"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="all">全部类型</option>
                {Object.entries(KIND).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              关联状态
              <select
                className="select"
                aria-label="信任链关联状态"
                value={applicability}
                onChange={(event) => setApplicability(event.target.value)}
              >
                <option value="all">全部状态</option>
                {Object.entries(APPLICABILITY).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {events.length === 0 ? (
            <p className="detail-empty">当前筛选下没有已登记事实。</p>
          ) : (
            <ol className="detail-list" aria-label="正式事实时间线">
              {events.map((event) => (
                <li key={event.id} style={{ overflowWrap: 'anywhere' }}>
                  <div>
                    <strong>
                      {KIND[event.kind]}
                      {event.decision
                        ? ` · ${DECISION[event.decision] ?? event.decision}`
                        : ''} · {event.label}
                    </strong>
                  </div>
                  <p className="task-row-meta">
                    {APPLICABILITY[event.applicability]} · {SOURCE[event.source]} ·{' '}
                    {formatDateTime(event.at)}
                    {event.taskGeneration !== undefined
                      ? ` · 任务第 ${event.taskGeneration} 代`
                      : ''}
                    {event.requirementGeneration !== undefined
                      ? ` · 需求第 ${event.requirementGeneration} 代`
                      : ''}
                  </p>
                  <p className="task-row-meta">
                    {event.actors.length
                      ? event.actors
                          .map(
                            (actor) =>
                              `${actor.kind === 'HUMAN' ? 'HUMAN' : actor.kind === 'AGENT' ? 'Agent' : '身份未记录'} · ${actor.label ?? '姓名未记录'}`,
                          )
                          .join('；')
                      : event.kind === 'WITHDRAWAL'
                        ? '撤回操作人未记录；不推断签字人'
                        : '该事实未独立记录签字人；正式签字见关联决定'}
                  </p>
                  {event.taskId && (
                    <button className="ghost" onClick={() => onTask(event.taskId!)}>
                      定位任务
                    </button>
                  )}
                  {event.reviewId && (
                    <Link to={`/reviews/${encodeURIComponent(event.reviewId)}`}>
                      查看评审与证据
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
