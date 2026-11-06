import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatApiError } from '../api/client';
import {
  delegationApi,
  projectApi,
  reviewApi,
  type ApprovalSlotDelegationView,
  type MemberView,
  type OverdueApprovalSlotView,
  type ReviewView,
} from '../api/resources';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { InlineLoading, SkeletonLines } from './Skeleton';
import { STEP_LABELS, labelFor } from '../lib/labels';
import { formatDateTime } from '../lib/datetime';
import { useAuthStore } from '../store/auth';
import { toast } from '../store/toast';

interface DelegationsPanelProps {
  projectId: string;
}

interface SlotOption {
  slotId: string;
  label: string;
  reviewId: string;
}

/** 按动作区分进行中的写操作：按钮文案要说明“正在做什么”，而不是笼统的“提交中”。 */
type DelegationBusyAction =
  { kind: 'create' } | { kind: 'revoke'; id: string } | { kind: 'escalate' } | null;

function defaultExpiry(): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 槽位委托 + 超时升级：服务端已有委托与逾期视图，Web 此前零入口。
 * 写操作限 OWNER/ADMIN；成员可只读查看逾期槽位。
 */
export function DelegationsPanel({ projectId }: DelegationsPanelProps) {
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.user);
  const [delegations, setDelegations] = useState<ApprovalSlotDelegationView[]>([]);
  const [overdue, setOverdue] = useState<OverdueApprovalSlotView[]>([]);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [openReviews, setOpenReviews] = useState<ReviewView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<DelegationBusyAction>(null);
  const busy = busyAction !== null;
  const [slotId, setSlotId] = useState('');
  const [delegateUserId, setDelegateUserId] = useState('');
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [formError, setFormError] = useState('');

  async function load(): Promise<boolean> {
    setLoading(true);
    try {
      const [delegationList, overdueList, memberList, openPage] = await Promise.all([
        delegationApi.list(projectId),
        delegationApi.overdue(projectId),
        projectApi.members(projectId),
        reviewApi.list(projectId, { assignedToMe: false, status: 'OPEN' }),
      ]);
      setDelegations(delegationList);
      setOverdue(overdueList);
      setMembers(memberList);
      setOpenReviews(openPage.items);
      setError('');
      return true;
    } catch (caught) {
      setError(formatApiError(caught));
      return false;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // 只随项目切换重新加载。
  }, [projectId]);

  const memberEmail = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((member) => map.set(member.id, member.email));
    return map;
  }, [members]);

  const myMembership = members.find((member) => member.id === currentUser?.id);
  const canWrite = myMembership?.role === 'OWNER' || myMembership?.role === 'ADMIN';

  const slotLabels = useMemo(() => {
    const map = new Map<string, string>();
    openReviews.forEach((review) => {
      const requirement = review.requirement
        ? `${review.requirement.code} · ${review.requirement.title}`
        : review.subjectLabel
          ? labelFor(STEP_LABELS, review.subjectLabel)
          : `评审 ${review.id.slice(0, 8)}`;
      review.slots.forEach((slot) => {
        map.set(slot.id, `${requirement} · ${slot.slotKey}`);
      });
    });
    overdue.forEach((slot) => {
      map.set(slot.id, `${labelFor(STEP_LABELS, slot.slotKey)} · 逾期`);
    });
    return map;
  }, [openReviews, overdue]);

  const slotOptions = useMemo<SlotOption[]>(() => {
    const options = new Map<string, SlotOption>();
    openReviews.forEach((review) => {
      const requirement = review.requirement
        ? `${review.requirement.code} · ${review.requirement.title}`
        : review.subjectLabel
          ? labelFor(STEP_LABELS, review.subjectLabel)
          : `评审 ${review.id.slice(0, 8)}`;
      review.slots.forEach((slot) => {
        if (options.has(slot.id)) return;
        options.set(slot.id, {
          slotId: slot.id,
          reviewId: review.id,
          label: `${requirement} · ${slot.slotKey}`,
        });
      });
    });
    overdue.forEach((slot) => {
      if (options.has(slot.id)) return;
      options.set(slot.id, {
        slotId: slot.id,
        reviewId: slot.reviewRequestId,
        label: `${labelFor(STEP_LABELS, slot.slotKey)} · 逾期槽位`,
      });
    });
    return [...options.values()];
  }, [openReviews, overdue]);

  async function createDelegation() {
    if (!slotId) {
      setFormError('请选择要委托的审批槽位。');
      return;
    }
    if (!delegateUserId) {
      setFormError('请选择被委托人。');
      return;
    }
    const expires = new Date(expiresAt);
    if (Number.isNaN(expires.getTime())) {
      setFormError('请填写有效的到期时间。');
      return;
    }
    if (expires.getTime() <= Date.now()) {
      setFormError('到期时间必须晚于当前时间。');
      return;
    }
    setBusyAction({ kind: 'create' });
    setFormError('');
    try {
      await delegationApi.create(projectId, {
        slotId,
        delegateUserId,
        expiresAt: expires.toISOString(),
      });
      setSlotId('');
      setDelegateUserId('');
      setExpiresAt(defaultExpiry());
      toast.success('委托已创建，到期或撤销后自动失效。');
      await load();
    } catch (caught) {
      setFormError(formatApiError(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function revoke(delegation: ApprovalSlotDelegationView) {
    setBusyAction({ kind: 'revoke', id: delegation.id });
    try {
      await delegationApi.revoke(projectId, delegation.id);
      toast.success('委托已撤销。');
      await load();
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function escalateOverdue() {
    setBusyAction({ kind: 'escalate' });
    try {
      const result = await delegationApi.escalate(projectId);
      toast.success(`已标记 ${result.escalated} 条逾期槽位为升级。`);
      await load();
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusyAction(null);
    }
  }

  if (loading && delegations.length === 0 && overdue.length === 0 && members.length === 0) {
    // 首次加载：用骨架顶住卡片结构，避免先闪一下“还没有委托记录”的空态。
    return (
      <div className="delegations-panel" aria-busy="true">
        <div className="table-card">
          <div className="card-head">
            <h3>
              审批委托<small>读取中</small>
            </h3>
          </div>
          <InlineLoading label="正在读取委托与逾期信息…" />
          <SkeletonLines lines={3} />
        </div>
        <div className="table-card">
          <div className="card-head">
            <h3>
              超时未决定<small>读取中</small>
            </h3>
          </div>
          <SkeletonLines lines={2} />
        </div>
      </div>
    );
  }
  if (error && members.length === 0) {
    return (
      <ErrorState
        title="委托信息加载失败"
        message="暂时无法读取委托与逾期信息。"
        detail={error}
        onRetry={() => void load()}
        retryAriaLabel="重试加载委托信息"
      />
    );
  }

  const activeDelegations = delegations.filter(
    (delegation) => !delegation.revokedAt && new Date(delegation.expiresAt).getTime() > Date.now(),
  );
  const expiringSoon = activeDelegations.filter((delegation) => {
    const hoursLeft = (new Date(delegation.expiresAt).getTime() - Date.now()) / 3_600_000;
    return hoursLeft > 0 && hoursLeft <= 24;
  });

  return (
    <div className="delegations-panel" aria-busy={loading || busy}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && <InlineLoading label="正在刷新委托与逾期信息…" />}

      <div className="table-card">
        <div className="card-head">
          <h3>
            审批委托<small>{activeDelegations.length} 条生效中</small>
          </h3>
          <span className="card-head-actions">
            {canWrite ? (
              <button className="ghost" onClick={() => void load()} disabled={loading || busy}>
                {loading ? '刷新中…' : '刷新'}
              </button>
            ) : (
              <small>只读：仅 OWNER/ADMIN 可建立或撤销委托</small>
            )}
          </span>
        </div>

        {expiringSoon.length > 0 && (
          <p className="delegation-reminder" role="status">
            {expiringSoon.length} 条委托将在 24 小时内到期，请确认交接、延期或撤销。
          </p>
        )}

        {canWrite && (
          <div className="delegation-form form-grid">
            <label className="field">
              <span>审批槽位</span>
              <select
                value={slotId}
                onChange={(event) => setSlotId(event.target.value)}
                aria-label="委托槽位"
              >
                <option value="">选择要委托的槽位</option>
                {slotOptions.map((option) => (
                  <option key={option.slotId} value={option.slotId}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>被委托人</span>
              <select
                value={delegateUserId}
                onChange={(event) => setDelegateUserId(event.target.value)}
                aria-label="被委托人"
              >
                <option value="">选择项目成员</option>
                {members
                  .filter((member) => member.id !== myMembership?.id)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name ? `${member.name}（${member.email}）` : member.email}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>到期时间</span>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                aria-label="委托到期时间"
              />
            </label>
            {formError && (
              <p className="field-error" role="alert">
                {formError}
              </p>
            )}
            <div className="delegation-form-actions">
              <button
                className="primary"
                onClick={() => void createDelegation()}
                disabled={busy || slotOptions.length === 0}
              >
                {busyAction?.kind === 'create' ? '创建中…' : '创建委托'}
              </button>
              {slotOptions.length === 0 && <small>当前没有可委托的开放审批槽位。</small>}
            </div>
          </div>
        )}

        {delegations.length === 0 ? (
          <p className="detail-empty">还没有委托记录。</p>
        ) : (
          <ul className="delegation-list">
            {delegations.map((delegation) => {
              const hoursLeft = (new Date(delegation.expiresAt).getTime() - Date.now()) / 3_600_000;
              const expired = hoursLeft <= 0;
              const revoked = Boolean(delegation.revokedAt);
              const expiring = !revoked && !expired && hoursLeft <= 24;
              return (
                <li key={delegation.id} className="delegation-row">
                  <div>
                    <strong>
                      {slotLabels.get(delegation.slotId) ?? `槽位 ${delegation.slotId.slice(0, 8)}`}
                    </strong>
                    <small>
                      委托人{' '}
                      {memberEmail.get(delegation.delegatorUserId) ??
                        delegation.delegatorUserId.slice(0, 8)}{' '}
                      → 被委托人{' '}
                      {memberEmail.get(delegation.delegateUserId) ??
                        delegation.delegateUserId.slice(0, 8)}
                    </small>
                    <small>到期 {formatDateTime(delegation.expiresAt)}</small>
                  </div>
                  <div className="delegation-row-actions">
                    <span className={`status-tag${expiring ? ' is-warning' : ''}`}>
                      {revoked
                        ? '已撤销'
                        : expired
                          ? '已过期'
                          : expiring
                            ? `即将到期（${Math.max(1, Math.ceil(hoursLeft))} 小时）`
                            : '生效中'}
                    </span>
                    {canWrite && !revoked && !expired && (
                      <button
                        className="danger"
                        onClick={() => void revoke(delegation)}
                        disabled={busy}
                      >
                        {busyAction?.kind === 'revoke' && busyAction.id === delegation.id
                          ? '撤销中…'
                          : '撤销委托'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="table-card">
        <div className="card-head">
          <h3>
            超时未决定<small>{overdue.length} 条</small>
          </h3>
          <span className="card-head-actions">
            {canWrite && (
              <button
                className="primary"
                onClick={() => void escalateOverdue()}
                disabled={busy || overdue.length === 0}
              >
                {busyAction?.kind === 'escalate' ? '升级中…' : '标记全部升级'}
              </button>
            )}
          </span>
        </div>
        {overdue.length === 0 ? (
          <EmptyState
            title="没有逾期审批"
            description="审批槽位到期且未决定时会出现在这里；升级只发提醒，不会自动批准。"
          />
        ) : (
          <ul className="delegation-list">
            {overdue.map((slot) => (
              <li key={slot.id} className="delegation-row">
                <div>
                  <strong>{labelFor(STEP_LABELS, slot.slotKey)}</strong>
                  <small>
                    {slot.kind} · 到期 {formatDateTime(slot.dueAt)} · 责任人{' '}
                    {memberEmail.get(slot.requiredUserId) ?? slot.requiredUserId.slice(0, 8)}
                  </small>
                </div>
                <div className="delegation-row-actions">
                  <button
                    className="ghost"
                    onClick={() => navigate(`/reviews/${encodeURIComponent(slot.reviewRequestId)}`)}
                  >
                    打开评审
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
