import { notificationApi, type ActivityItem } from '../api/resources';
import { activityDestination } from '../lib/notificationDisplay';
import { ACTION_LABELS, labelFor } from '../lib/labels';
import { formatDateTime } from '../lib/datetime';

export interface NotificationPanelProps {
  todoCounts: { signOffs: number; approvals: number; changes: number; readyTasks: number };
  todoLoading: boolean;
  todoError: string;
  recentActivity: ActivityItem[];
  activityLoading: boolean;
  activityError: string;
  mailBusy: boolean;
  mailNotice: string;
  onRetryTodo: () => void;
  onRetryActivity: () => void;
  onNavigate: (path: string) => void;
  onOpenActivity: (item: ActivityItem, path: string) => void;
  onSendEmail: (send: () => Promise<{ to: string }>) => void;
}

/** Data, read state and mail progress stay in the shell across panel mounts. */
export function NotificationPanel(props: NotificationPanelProps) {
  return (
    <>
      <h4>我的待办</h4>
      <p className="page-sub">仅统计服务端确认我可签字、待我确认的变更和我可领取的任务。</p>
      {props.todoLoading && (
        <p className="page-sub" role="status">
          正在更新我的待办…
        </p>
      )}
      {props.todoError && (
        <div role="alert">
          <p className="field-error">{props.todoError}</p>
          <button className="ghost" disabled={props.todoLoading} onClick={props.onRetryTodo}>
            重试待办
          </button>
        </div>
      )}
      <div className="notification-stats">
        <button onClick={() => props.onNavigate('/?type=signOffs')}>
          <span>待签字</span>
          <strong>{props.todoCounts.signOffs}</strong>
        </button>
        <button onClick={() => props.onNavigate('/?type=approvals')}>
          <span>待审批</span>
          <strong>{props.todoCounts.approvals}</strong>
        </button>
        <button onClick={() => props.onNavigate('/?type=changes')}>
          <span>待确认变更</span>
          <strong>{props.todoCounts.changes}</strong>
        </button>
        <button onClick={() => props.onNavigate('/?type=ready')}>
          <span>我可领取</span>
          <strong>{props.todoCounts.readyTasks}</strong>
        </button>
      </div>
      <button
        className="ghost notification-mail"
        disabled={props.mailBusy}
        onClick={() => props.onSendEmail(notificationApi.sendEmailDigest)}
      >
        {props.mailBusy ? '发送中…' : '发送邮件摘要'}
      </button>
      {props.mailNotice && <p className="page-sub">{props.mailNotice}</p>}
      <div className="notification-list">
        <h4>审计活动</h4>
        <p className="page-sub">
          最近 8 条审计记录用于追溯，可能无需你处理。已读仅保存在此浏览器的当前账号下。
        </p>
        {props.activityLoading && (
          <p className="page-sub" role="status">
            正在更新审计活动…
          </p>
        )}
        {props.activityError && (
          <div role="alert">
            <p className="field-error">{props.activityError}</p>
            <button
              className="ghost"
              disabled={props.activityLoading}
              onClick={props.onRetryActivity}
            >
              重试活动
            </button>
          </div>
        )}
        {props.recentActivity.length === 0 && !props.activityLoading && !props.activityError ? (
          <p className="detail-empty">暂无审计事件。</p>
        ) : (
          props.recentActivity.map((item) => {
            const destination = activityDestination(item);
            const content = (
              <>
                <span className="status-tag">{labelFor(ACTION_LABELS, item.action)}</span>
                <span>{item.projectName ?? '—'}</span>
                <small>
                  {item.actor?.email ?? '系统'} · {formatDateTime(item.createdAt)}
                </small>
              </>
            );
            return destination ? (
              <button
                type="button"
                className="notification-item is-link"
                key={item.id}
                onClick={() => props.onOpenActivity(item, destination.path)}
              >
                {content}
                <small>{destination.label}</small>
              </button>
            ) : (
              <div className="notification-item" key={item.id}>
                {content}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
