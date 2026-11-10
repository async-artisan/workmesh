import type { WorkbenchChangeItem } from '../api/resources';
import { Link } from 'react-router-dom';
import { changeFieldLabel, changeImpactSummary } from '../lib/changeDisplay';
import { Modal } from './Modal';
import { CHANGE_TASK_REASON_LABELS, CHANGE_TASK_ACTION_LABELS } from '@workmesh/shared';

interface ChangeDrawerProps {
  change: WorkbenchChangeItem | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onAck: () => void;
}

/**
 * 变更影响抽屉：先看“变了什么、影响谁、下一步做什么”，再确认已知悉。
 * 确认只带收件人版本，版本变化由服务端判 409。
 */
export function ChangeDrawer({ change, busy, error, onClose, onAck }: ChangeDrawerProps) {
  const impact = changeImpactSummary(change?.targets, change?.changedFields ?? []);

  return (
    <Modal
      open={Boolean(change)}
      title="需求变更 · 需要确认"
      description={
        change ? `${change.projectName} · ${change.requirement?.code ?? '未关联需求'}` : ''
      }
      variant="drawer"
      size="md"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="primary" onClick={onAck} disabled={busy}>
            {busy ? '提交中…' : '确认已知悉'}
          </button>
        </>
      }
    >
      {change && (
        <div className="form-grid">
          <div className="field">
            <span>需求</span>
            <strong>
              {change.requirement
                ? `${change.requirement.code} · ${change.requirement.title}`
                : '未关联需求'}
            </strong>
          </div>
          <div className="field">
            <span>变更字段</span>
            <p className="detail-text">
              {change.changedFields.length
                ? [...new Set(change.changedFields.map(changeFieldLabel))].join(' / ')
                : '未标注字段'}
            </p>
          </div>
          <div className="field">
            <span>仍待知悉的角色</span>
            <p className="detail-text">
              {change.pendingRoles.length
                ? change.pendingRoles.map((role) => role.title).join(' / ')
                : '未提供角色信息'}
            </p>
          </div>
          <div className="field">
            <span>影响面</span>
            {impact.rows.length === 0 ? (
              <p className="detail-empty">本次通知未提供可读的影响摘要，请核对关联需求。</p>
            ) : (
              <ul className="detail-list">
                {impact.rows.map((row, index) => (
                  <li key={`${index}-${row.label}`}>
                    <strong>{row.label}</strong>：<span>{row.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="field">
            <span>下一步</span>
            <p className="detail-text">
              {impact.baselineChanged
                ? '开始或继续任务前，重新获取上下文，并核对本次变更与当前交付的差异。'
                : '核对关联需求与验收条件，确认哪些工作需要调整。'}
              调整完成后提交交付，由评审确认结果。
            </p>
            {!busy && (
              <div>
                <Link to={`/board?projectId=${encodeURIComponent(change.projectId)}`}>
                  查看项目任务
                </Link>
                {impact.hasDocument && (
                  <>
                    {' · '}
                    <Link to={`/knowledge?projectId=${encodeURIComponent(change.projectId)}`}>
                      查看项目知识文档
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="field">
            <span>与你相关的任务</span>
            {!change.guidance ? (
              <p className="detail-empty">当前平台未提供任务级诊断，请打开关联需求核对影响。</p>
            ) : (
              <>
                {change.guidance.eventBaseline === 'SUPERSEDED' && (
                  <p className="detail-text">
                    此通知引用的基线已有后续更新；以下按任务当前状态给出动作。
                  </p>
                )}
                {change.guidance.scope === 'CURRENT_ACCEPTANCE_SCOPE' && (
                  <p className="detail-text">
                    原事件未记录任务
                    ID；以下按当前需求及验收范围匹配，不表示事件发生时已使这些任务失效。
                  </p>
                )}
                {change.guidance.tasks.length ? (
                  <ul className="detail-list" aria-label="相关任务与恢复动作">
                    {change.guidance.tasks.map((task) => (
                      <li key={task.taskId}>
                        <strong>
                          {task.taskCode}
                          {task.stepDisplayName ? ` · ${task.stepDisplayName}` : ''}
                        </strong>
                        <p>
                          {task.role.title} ·{' '}
                          {task.relation === 'RESPONSIBLE'
                            ? '由你负责'
                            : '与你的角色相关，由其他成员负责'}
                        </p>
                        <p>{CHANGE_TASK_REASON_LABELS[task.reason]}</p>
                        <p>{CHANGE_TASK_ACTION_LABELS[task.action]}</p>
                        {!busy && <Link to={task.href}>查看 {task.taskCode} 的任务与输入</Link>}
                        <code style={{ display: 'block', overflowWrap: 'anywhere' }}>
                          {task.inspectCommand}
                        </code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="detail-empty">
                    未匹配到你当前负责或当前角色相关的任务；仍需核对通知与关联需求。
                  </p>
                )}
              </>
            )}
          </div>
          <p className="modal-note">
            知悉只确认你已收到这次变更；是否完成调整，以后续交付和验收为准。
          </p>
          <details className="wm-decision-technical">
            <summary>查看技术详情</summary>
            <p className="detail-text">收件记录版本：v{change.version}（用于提交一致性校验）</p>
            <pre className="detail-text" style={{ overflowWrap: 'anywhere' }}>
              {JSON.stringify(
                {
                  eventId: change.eventId,
                  changedFields: change.changedFields,
                  targets: change.targets,
                },
                null,
                2,
              )}
            </pre>
          </details>
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
