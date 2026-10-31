import { useToastStore } from '../store/toast';

export function ToastHost() {
  const items = useToastStore((state) => state.items);
  const dismiss = useToastStore((state) => state.dismiss);

  if (items.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast is-${item.tone}`}>
          <span>{item.message}</span>
          <button className="icon-btn" onClick={() => dismiss(item.id)} aria-label="关闭提示">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
