import { useId, useState } from 'react';
import { DECISION_LABELS, labelFor, type ReviewDecisionValue } from '../lib/labels';

export interface DecisionArtifactSummary {
  /** 工件/证据名称，例如“实现 · 后端实现”。 */
  label: string;
  /** 补充说明，例如 介质类型、校验结果、截断状态。 */
  detail?: string;
}

/** 确认前必须让用户看懂的业务决定摘要；字段与最终提交 payload 一一对应。 */
export interface DecisionSummaryData {
  decision: ReviewDecisionValue;
  /** 评审对象：优先“需求编号 · 需求标题”，缺失时用标题/步骤。 */
  subject: string;
  /** 评审类型中文名，例如“任务验收”“PRD 发布”。 */
  reviewKindLabel: string;
  /** 角色或评审槽位，例如“product · 产品角色”。 */
  slotLabel: string;
  /** 与最终 API payload 中 expectedVersion 完全一致。 */
  version: number;
  /** 涉及工件/证据；空数组表示评审没有附带工件。 */
  artifacts: DecisionArtifactSummary[];
  /** 汇总后的检查结果。 */
  checks?: { passed: number; total: number; failed?: number };
  /** 代码引用数量（GIT_REF 工件数或服务端汇总值）。 */
  codeRefs?: number;
  /** 评审说明；过长时组件内折叠并明确标注截断。 */
  comment?: string;
  /** 提交后影响，由 lib/labels 的 decisionImpact 生成。 */
  impact: string;
  /** 证据完整性提示，例如“证据不完整，已确认在不完整证据下继续”。 */
  evidenceNote?: string;
}

export interface DecisionSummaryProps {
  summary: DecisionSummaryData;
  className?: string;
}

const COMMENT_MAX_CHARS = 240;

function decisionTone(decision: ReviewDecisionValue): string {
  if (decision === 'APPROVE') return 'is-approve';
  if (decision === 'CHANGES_REQUESTED') return 'is-changes';
  return 'is-reject';
}

/**
 * 业务决定摘要：把“用户实际要提交的决定”用人话完整展示。
 * 不展示 JSON/哈希；技术摘要由 ConfirmationPrompt 放在“查看技术详情”折叠区。
 */
export function DecisionSummary({ summary, className }: DecisionSummaryProps) {
  const autoId = useId();
  const titleId = `${autoId}-title`;
  const [expanded, setExpanded] = useState(false);
  const comment = summary.comment?.trim() ?? '';
  const truncated = comment.length > COMMENT_MAX_CHARS;
  const visibleComment =
    truncated && !expanded ? `${comment.slice(0, COMMENT_MAX_CHARS)}…` : comment;
  const failed = summary.checks?.failed ?? 0;

  return (
    <section
      className={`wm-decision-summary${className ? ` ${className}` : ''}`}
      aria-labelledby={titleId}
    >
      <div className="wm-decision-summary__head">
        <h4 className="wm-decision-summary__title" id={titleId}>
          即将提交的决定
        </h4>
        <span className={`wm-decision-badge ${decisionTone(summary.decision)}`}>
          {labelFor(DECISION_LABELS, summary.decision)}
        </span>
      </div>

      <dl className="wm-decision-summary__list">
        <div>
          <dt>决定</dt>
          <dd>{labelFor(DECISION_LABELS, summary.decision)}</dd>
        </div>
        <div>
          <dt>评审对象</dt>
          <dd>{summary.subject}</dd>
        </div>
        <div>
          <dt>评审类型</dt>
          <dd>{summary.reviewKindLabel}</dd>
        </div>
        <div>
          <dt>角色 / 槽位</dt>
          <dd>{summary.slotLabel || '未指定'}</dd>
        </div>
        <div>
          <dt>版本</dt>
          <dd>v{summary.version}（与提交版本一致）</dd>
        </div>
        <div>
          <dt>涉及工件</dt>
          <dd>
            {summary.artifacts.length === 0 ? (
              <span className="wm-decision-summary__muted">该评审没有附带工件证据</span>
            ) : (
              <ul className="wm-decision-summary__artifacts">
                {summary.artifacts.map((artifact) => (
                  <li key={`${artifact.label}-${artifact.detail ?? ''}`}>
                    <strong>{artifact.label}</strong>
                    {artifact.detail ? ` · ${artifact.detail}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt>检查结果</dt>
          <dd>
            {summary.checks
              ? `通过 ${summary.checks.passed} / ${summary.checks.total}${
                  failed > 0 ? `（${failed} 项失败）` : ''
                }`
              : '该评审没有结构化检查结果'}
          </dd>
        </div>
        {summary.codeRefs !== undefined && (
          <div>
            <dt>代码引用</dt>
            <dd>{summary.codeRefs} 处</dd>
          </div>
        )}
        <div>
          <dt>评审说明</dt>
          <dd>
            {comment ? (
              <>
                <span className="wm-decision-summary__comment">{visibleComment}</span>
                {truncated && (
                  <>
                    {!expanded && (
                      <span className="wm-decision-summary__muted">
                        （已截断，共 {comment.length} 字）
                      </span>
                    )}
                    <button
                      type="button"
                      className="wm-decision-summary__toggle"
                      aria-expanded={expanded}
                      onClick={() => setExpanded((value) => !value)}
                    >
                      {expanded ? '收起说明' : '展开完整说明'}
                    </button>
                  </>
                )}
              </>
            ) : (
              <span className="wm-decision-summary__muted">未填写说明</span>
            )}
          </dd>
        </div>
        <div>
          <dt>提交后影响</dt>
          <dd>{summary.impact}</dd>
        </div>
        {summary.evidenceNote && (
          <div className="wm-decision-summary__row-warning">
            <dt>证据完整性</dt>
            <dd>{summary.evidenceNote}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
