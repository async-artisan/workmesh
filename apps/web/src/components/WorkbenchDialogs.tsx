import { useEffect, useState, type ComponentProps, type ComponentType } from 'react';
import type { BatchReviewApprove } from './BatchReviewApprove';
import type { ChangeDrawer } from './ChangeDrawer';
import { Modal } from './Modal';

type ChangeProps = ComponentProps<typeof ChangeDrawer>;
type BatchProps = ComponentProps<typeof BatchReviewApprove>;

interface DialogModule<Props> {
  component: ComponentType<Props> | null;
  load: () => Promise<ComponentType<Props>>;
}

function deferredDialog<Props>(importComponent: () => Promise<ComponentType<Props>>) {
  let pending: Promise<ComponentType<Props>> | null = null;
  const module: DialogModule<Props> = {
    component: null,
    load() {
      if (module.component) return Promise.resolve(module.component);
      if (!pending) {
        pending = importComponent().then(
          (component) => {
            module.component = component;
            return component;
          },
          (error: unknown) => {
            // A failed request must not become a permanently rejected lazy component.
            pending = null;
            throw error;
          },
        );
      }
      return pending;
    },
  };
  return module;
}

const changeModule = deferredDialog<ChangeProps>(() =>
  import('./ChangeDrawer').then((module) => module.ChangeDrawer),
);
const batchModule = deferredDialog<BatchProps>(() =>
  import('./BatchReviewApprove').then((module) => module.BatchReviewApprove),
);

function useDialogModule<Props>(module: DialogModule<Props>) {
  const [component, setComponent] = useState(() => module.component);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    module.load().then(
      (loaded) => {
        if (active) setComponent(() => loaded);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      // Closing while a chunk is loading must not mount a dialog later.
      active = false;
    };
  }, [module, attempt]);

  return {
    component,
    failed,
    retry() {
      setFailed(false);
      setAttempt((value) => value + 1);
    },
  };
}

function DialogLoading({
  title,
  variant,
  busy,
  failed,
  retry,
  onClose,
}: {
  title: string;
  variant?: 'dialog' | 'drawer';
  busy?: boolean;
  failed: boolean;
  retry: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open title={title} variant={variant} busy={busy} onClose={onClose}>
      {failed ? (
        <div role="alert">
          <p>无法加载此窗口，请检查网络后重试。当前待办仍保留。</p>
          <button className="ghost" onClick={retry} disabled={busy}>
            重试加载
          </button>
          <p>若重试后仍无法加载，请先保存其他未提交输入，再刷新页面。</p>
          <button className="ghost" onClick={() => window.location.reload()} disabled={busy}>
            刷新页面
          </button>
        </div>
      ) : (
        <p role="status">正在加载{title}…</p>
      )}
    </Modal>
  );
}

function OpenChangeDrawer(props: ChangeProps) {
  const { component: Loaded, failed, retry } = useDialogModule(changeModule);
  return Loaded ? (
    <Loaded {...props} />
  ) : (
    <DialogLoading
      title="需求变更 · 需要确认"
      variant="drawer"
      busy={props.busy}
      failed={failed}
      retry={retry}
      onClose={props.onClose}
    />
  );
}

export function DeferredChangeDrawer(props: ChangeProps) {
  return props.change ? <OpenChangeDrawer {...props} /> : null;
}

function OpenBatchReviewApprove(props: BatchProps) {
  const { component: Loaded, failed, retry } = useDialogModule(batchModule);
  return Loaded ? (
    <Loaded {...props} />
  ) : (
    <DialogLoading title="批量批准" failed={failed} retry={retry} onClose={props.onClose} />
  );
}

export function DeferredBatchReviewApprove(props: BatchProps) {
  // Unmount on close so passwords and transient submission state cannot survive it.
  return props.open ? <OpenBatchReviewApprove {...props} /> : null;
}
