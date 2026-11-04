import { useEffect, useMemo, useRef, useState } from 'react';
import { DiffTooLargeError, buildDiffModel, type DiffBlock, type DiffLine } from '../lib/diff';

export interface DiffViewerProps {
  /** 对照版本正文（例如已发布版本）。 */
  oldText: string;
  /** 当前版本正文。 */
  newText: string;
  /** 对照版本名称，例如“已发布 v2”。 */
  baseLabel?: string;
  /** 当前版本名称，例如“候选 v3”。 */
  currentLabel?: string;
  /** 读取状态：loading / error 时不渲染旧 diff 或旧导航。 */
  loading?: boolean;
  error?: string;
  /** 透传给根节点的测试 id；三个页面统一复用同一组件。 */
  testId?: string;
  className?: string;
}

const CONTEXT_FOLD_THRESHOLD = 6;

const css = `
.wm-diff { border: 1px solid var(--border, #e2e8f0); border-radius: 10px; background: var(--surface, #fff); overflow: hidden; }
.wm-diff__head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border, #e2e8f0); background: var(--surface-hover, #f8fafc); }
.wm-diff__summary { font-size: 14px; color: var(--text-primary, #0f172a); }
.wm-diff__summary strong { margin-right: 6px; }
.wm-diff__nav { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.wm-diff__nav-label { font-size: 12px; color: var(--text-secondary, #475569); }
.wm-diff__blocks { display: grid; }
.wm-diff-context { border-bottom: 1px solid var(--border, #e2e8f0); }
.wm-diff-context__toggle { width: 100%; text-align: left; border: 0; background: var(--surface-hover, #f8fafc); color: var(--text-secondary, #475569); font: inherit; font-size: 12px; padding: 8px 14px; cursor: pointer; }
.wm-diff-context__toggle:focus-visible { outline: 2px solid var(--accent, #0891b2); outline-offset: -2px; }
.wm-diff-change { border-bottom: 1px solid var(--border, #e2e8f0); }
.wm-diff-change:focus-visible { outline: 2px solid var(--accent, #0891b2); outline-offset: -2px; background: var(--accent-soft, rgba(8,145,178,.06)); }
.wm-diff-change[data-active='true'] { background: var(--accent-soft, rgba(8,145,178,.06)); }
.wm-diff-change__head { padding: 7px 14px; font-size: 12px; color: var(--text-secondary, #475569); background: var(--surface-hover, #f8fafc); border-top: 1px solid var(--border, #e2e8f0); }
.wm-diff-line { display: grid; grid-template-columns: 46px 46px 24px minmax(0, 1fr); gap: 4px; padding: 1px 14px; font-family: var(--wm-font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.6; color: var(--text-primary, #0f172a); }
.wm-diff-line__num { color: var(--text-muted, #7b8aa0); text-align: right; user-select: none; }
.wm-diff-line__sign { color: var(--text-secondary, #475569); user-select: none; }
.wm-diff-line__text { white-space: pre-wrap; word-break: break-word; }
.wm-diff-line[data-kind='add'] { background: var(--success-soft, rgba(5,150,105,.08)); }
.wm-diff-line[data-kind='add'] .wm-diff-line__sign { color: var(--success, #059669); font-weight: 700; }
.wm-diff-line[data-kind='remove'] { background: var(--danger-soft, rgba(225,29,72,.07)); }
.wm-diff-line[data-kind='remove'] .wm-diff-line__sign { color: var(--danger, #e11d48); font-weight: 700; }
.wm-diff-empty { padding: 18px 14px; color: var(--text-secondary, #475569); font-size: 14px; }
.wm-diff-status { padding: 18px 14px; color: var(--text-secondary, #475569); font-size: 14px; }
.wm-diff-status[data-tone='error'] { color: var(--danger, #e11d48); }
.wm-diff-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@media (max-width: 640px) { .wm-diff-line { grid-template-columns: 36px 36px 20px minmax(0, 1fr); padding: 1px 10px; } }
`;

function lineSign(line: DiffLine): string {
  if (line.kind === 'add') return '+ ';
  if (line.kind === 'remove') return '- ';
  return '  ';
}

function kindText(kind: DiffLine['kind']): string {
  if (kind === 'add') return '新增';
  if (kind === 'remove') return '删除';
  return '未修改';
}

function contextToggleLabel(block: Extract<DiffBlock, { kind: 'context' }>): string {
  const start = block.oldStart ?? block.newStart ?? 1;
  const end = block.oldEnd ?? block.newEnd ?? start;
  return `显示第 ${start}–${end} 行 · 共 ${block.lines.length} 行未修改`;
}

function DiffLines({ lines }: { lines: DiffLine[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <div
          className="wm-diff-line"
          data-kind={line.kind}
          // 行内容可能重复，行号与索引共同保证稳定 key。
          key={`${line.kind}-${line.oldNumber ?? 'x'}-${line.newNumber ?? 'x'}-${index}`}
        >
          <span className="wm-diff-line__num" aria-hidden="true">
            {line.oldNumber ?? ''}
          </span>
          <span className="wm-diff-line__num" aria-hidden="true">
            {line.newNumber ?? ''}
          </span>
          <span className="wm-diff-line__sign" aria-hidden="true">
            {lineSign(line)}
          </span>
          <span className="wm-diff-line__text">
            <span className="wm-diff-sr-only">{kindText(line.kind)}：</span>
            {line.text || ' '}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * 三个页面共用的差异阅读组件：
 * - 顶部统一统计 + 修改点导航；
 * - 连续未修改上下文默认折叠，可逐个展开；
 * - 修改块有 role=region、序号、可访问名称与临时高亮；
 * - 超长文档/读取失败/无差异都显示明确状态，不伪造 diff。
 */
export function DiffViewer({
  oldText,
  newText,
  baseLabel,
  currentLabel,
  loading = false,
  error,
  testId,
  className = '',
}: DiffViewerProps) {
  const model = useMemo(() => {
    try {
      return {
        result: buildDiffModel(oldText, newText),
        tooLarge: null as DiffTooLargeError | null,
      };
    } catch (caught) {
      if (caught instanceof DiffTooLargeError) return { result: null, tooLarge: caught };
      throw caught;
    }
  }, [oldText, newText]);

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [activeChange, setActiveChange] = useState(0);
  /** 独立于 activeChange 的导航请求序号：单修改块时 activeChange 不变也必须聚焦。 */
  const [navigationRequest, setNavigationRequest] = useState(0);
  const changeRefs = useRef(new Map<number, HTMLDivElement>());
  const focusRequestRef = useRef(false);

  // 版本切换/正文重新读取后重置展开状态与导航位置，避免把定位带到另一份 diff。
  useEffect(() => {
    setExpanded(new Set());
    setActiveChange(0);
    setNavigationRequest(0);
    focusRequestRef.current = false;
  }, [oldText, newText]);

  useEffect(() => {
    if (!focusRequestRef.current) return;
    focusRequestRef.current = false;
    const element = changeRefs.current.get(activeChange);
    element?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    element?.focus({ preventScroll: true });
  }, [navigationRequest, activeChange]);

  if (loading) {
    return (
      <div className={`wm-diff ${className}`.trim()} data-testid={testId}>
        <style>{css}</style>
        <p className="wm-diff-status" role="status">
          正在读取差异…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`wm-diff ${className}`.trim()} data-testid={testId}>
        <style>{css}</style>
        <p className="wm-diff-status" role="alert" data-tone="error">
          差异读取失败：{error}
        </p>
      </div>
    );
  }

  if (model.tooLarge) {
    return (
      <div className={`wm-diff ${className}`.trim()} data-testid={testId}>
        <style>{css}</style>
        <div className="wm-diff-status" role="status">
          <strong>文档过长，差异需要分段加载</strong>
          <p>
            对照版本 {model.tooLarge.oldLineCount} 行、当前版本 {model.tooLarge.newLineCount} 行，
            超过前端安全上限，因此没有生成完整 diff，避免浏览器卡死；正文仍可单独查看。
          </p>
        </div>
      </div>
    );
  }

  if (!model.result) return null;
  const { blocks, summary } = model.result;
  const changeBlocks = blocks.filter(
    (block): block is Extract<DiffBlock, { kind: 'change' }> => block.kind === 'change',
  );

  if (!summary.hasChanges) {
    return (
      <div className={`wm-diff ${className}`.trim()} data-testid={testId}>
        <style>{css}</style>
        <div className="wm-diff__head">
          <span className="wm-diff__summary">
            {baseLabel && currentLabel ? `${baseLabel} → ${currentLabel}` : '差异'}
          </span>
          <span className="wm-diff__summary">共 0 处修改 · 新增 +0 · 删除 -0</span>
        </div>
        <p className="wm-diff-empty" role="status">
          与对照版本内容相同
        </p>
      </div>
    );
  }

  function goToChange(delta: number) {
    if (changeBlocks.length === 0) return;
    focusRequestRef.current = true;
    setActiveChange((current) => (current + delta + changeBlocks.length) % changeBlocks.length);
    // 即使只有一个修改块、activeChange 仍为 0，也要触发新的聚焦请求。
    setNavigationRequest((current) => current + 1);
  }

  function toggleContext(index: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <section className={`wm-diff ${className}`.trim()} data-testid={testId} aria-label="版本差异">
      <style>{css}</style>
      <div className="wm-diff__head">
        <span className="wm-diff__summary">
          {(baseLabel || currentLabel) && (
            <strong>
              {baseLabel ?? '对照版本'} → {currentLabel ?? '当前版本'}
            </strong>
          )}
          共 {summary.changeBlocks} 处修改 · 新增 +{summary.added} · 删除 -{summary.removed}
        </span>
        <div className="wm-diff__nav" aria-label="修改点导航">
          <span className="wm-diff__nav-label" role="status">
            第 {(activeChange % changeBlocks.length) + 1} / {changeBlocks.length} 处修改
          </span>
          <button
            type="button"
            className="ghost"
            onClick={() => goToChange(-1)}
            disabled={changeBlocks.length === 0}
            aria-label="上一处修改"
          >
            上一处
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => goToChange(1)}
            disabled={changeBlocks.length === 0}
            aria-label="下一处修改"
          >
            下一处
          </button>
        </div>
      </div>

      <div className="wm-diff__blocks">
        {blocks.map((block, blockIndex) => {
          if (block.kind === 'context') {
            const foldable = block.lines.length > CONTEXT_FOLD_THRESHOLD;
            const isExpanded = expanded.has(blockIndex);
            return (
              <div className="wm-diff-context" key={`context-${blockIndex}`}>
                {foldable && !isExpanded ? (
                  <button
                    type="button"
                    className="wm-diff-context__toggle"
                    aria-expanded="false"
                    onClick={() => toggleContext(blockIndex)}
                  >
                    {contextToggleLabel(block)}
                  </button>
                ) : (
                  <>
                    <DiffLines lines={block.lines} />
                    {foldable && (
                      <button
                        type="button"
                        className="wm-diff-context__toggle"
                        aria-expanded="true"
                        onClick={() => toggleContext(blockIndex)}
                      >
                        收起未修改行
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          }

          return (
            <div
              className="wm-diff-change"
              key={`change-${block.index}`}
              data-active={activeChange === block.index - 1}
              role="region"
              tabIndex={-1}
              aria-label={`第 ${block.index} 处修改：新增 ${block.added} 行，删除 ${block.removed} 行`}
              ref={(element) => {
                if (element) changeRefs.current.set(block.index - 1, element);
                else changeRefs.current.delete(block.index - 1);
              }}
            >
              <div className="wm-diff-change__head">
                第 {block.index} 处修改 · 新增 +{block.added} · 删除 -{block.removed}
              </div>
              <DiffLines lines={block.lines} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
