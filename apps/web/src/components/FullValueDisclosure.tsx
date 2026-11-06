import { useId, useState } from 'react';
import '../styles/full-value-disclosure.css';

/** Show a compact hash preview while keeping the complete server value keyboard-readable. */
export function FullValueDisclosure({
  label,
  value,
  preview,
}: {
  label: string;
  value: string;
  preview: string;
}) {
  const valueId = useId();
  const [expanded, setExpanded] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
  }

  return (
    <span className="full-value-disclosure">
      <button
        className="full-value-disclosure__toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={valueId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>
          {label} {preview}
        </span>
        <span className="full-value-disclosure__hint">
          {expanded ? '收起完整值' : '展开查看完整值'}
        </span>
      </button>
      {expanded && (
        <span className="full-value-disclosure__value" id={valueId}>
          <code aria-label={`${label}完整值`}>{value}</code>
          <button type="button" className="ghost" onClick={() => void copyValue()}>
            {copyStatus === 'copied' ? '已复制' : '复制完整值'}
          </button>
          {copyStatus === 'error' && (
            <span className="full-value-disclosure__status" role="status">
              无法自动复制，请选择完整值后手动复制。
            </span>
          )}
        </span>
      )}
    </span>
  );
}
