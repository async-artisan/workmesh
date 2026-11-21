import { useEffect, useState, type ComponentType } from 'react';
import type { NotificationPanelProps } from './NotificationPanel';

let component: ComponentType<NotificationPanelProps> | null = null;
let pending: Promise<ComponentType<NotificationPanelProps>> | null = null;

function loadPanel() {
  if (component) return Promise.resolve(component);
  if (!pending) {
    pending = import('./NotificationPanel').then(
      (module) => {
        component = module.NotificationPanel;
        return component;
      },
      (caught: unknown) => {
        pending = null;
        throw caught;
      },
    );
  }
  return pending;
}

/** Mounted only inside the open shell dialog; loading never owns focus or data. */
export function DeferredNotificationPanel(props: NotificationPanelProps) {
  const [loaded, setLoaded] = useState(() => component);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadPanel().then(
      (panel) => {
        if (active) setLoaded(() => panel);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  if (loaded) {
    const Loaded = loaded;
    return <Loaded {...props} />;
  }
  if (failed)
    return (
      <div role="alert">
        <p>无法加载通知内容，请检查网络后重试。通知数字仍会在后台更新。</p>
        <button
          className="ghost"
          onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          重试加载
        </button>
        <p>若重试后仍无法加载，请先保存其他未提交输入，再刷新页面。</p>
        <button className="ghost" onClick={() => window.location.reload()}>
          刷新页面
        </button>
      </div>
    );
  return (
    <p className="page-sub" role="status">
      正在加载通知内容…
    </p>
  );
}
