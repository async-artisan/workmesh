import type { WorkbenchChangeItem } from '../api/resources';
import { Modal } from './Modal';

interface ChangeDrawerProps {
  change: WorkbenchChangeItem | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onAck: () => void;
}

function targetRows(targets: unknown): Array<{ label: string; value: string }> {
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) return [];
  return Object.entries(targets as Record<string, unknown>).map(([label, value]) => ({
    label,
    value: Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('、')
      : typeof value === 'string'
        ? value
        : JSON.stringify(value),
  }));
}

/**
 * 变更影响抽屉：先看“变了什么、影响谁、还欠谁确认”，再确认已处理。
 * 确认只带收件人版本，版本变化由服务端判 409。
 */
export function ChangeDrawer({ change, busy, error, onClose, onAck }: ChangeDrawerProps) {
  const impacts = targetRows(change?.targets);

  return (
    <Modal
      open={Boolean(change)}
      title="需求变更 · 需要确认"
      description={change ? `${change.requirement?.code ?? '未关联需求'} · v${change.version}` : ''}
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
            {busy ? '提交中…' : '确认已处理'}
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
              {change.changedFields.length ? change.changedFields.join(' / ') : '未标注字段'}
            </p>
          </div>
          <div className="field">
            <span>待确认角色</span>
            <p className="detail-text">
              {change.pendingRoles.length
                ? change.pendingRoles.map((role) => role.title).join(' / ')
                : '—'}
            </p>
          </div>
          <div className="field">
            <span>影响面</span>
            {impacts.length === 0 ? (
              <p className="detail-empty">服务端没有记录结构化影响面。</p>
            ) : (
              <ul className="detail-list">
                {impacts.map((impact) => (
                  <li key={impact.label}>
                    <strong>{impact.label}</strong>：{impact.value}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="modal-note">
            确认只代表当前角色已处理这次变更，不会修改历史事件；版本变化会被服务端拒绝。
          </p>
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
