import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DecisionSummary, type DecisionSummaryData } from './DecisionSummary';

const summary: DecisionSummaryData = {
  decision: 'CHANGES_REQUESTED',
  subject: 'DEMO-REQ-1 · 登录页改版',
  reviewKindLabel: '任务验收',
  slotLabel: 'product · 产品角色',
  version: 3,
  artifacts: [
    { label: '实现 · 后端实现', detail: 'text/x-source · 校验 2/2' },
    { label: '设计 · 登录页稿', detail: 'image/png · 已截断' },
  ],
  checks: { passed: 2, total: 3, failed: 1 },
  codeRefs: 2,
  comment: '请补充登录失败锁定的验收证据，并说明限流策略。',
  impact: '评审退回交付方修改，需要按说明调整后重新提交评审；当前版本不会发布。',
  evidenceNote: '部分证据正文被截断，无法确认完整性。',
};

describe('DecisionSummary（确认前展示完整业务决定）', () => {
  it('展示决定、对象、类型、槽位、版本、工件、检查、代码引用、说明与提交后影响', () => {
    render(<DecisionSummary summary={summary} />);

    const section = screen.getByRole('region', { name: '即将提交的决定' });
    expect(section).toHaveTextContent('要求修改');
    expect(section).toHaveTextContent('DEMO-REQ-1 · 登录页改版');
    expect(section).toHaveTextContent('任务验收');
    expect(section).toHaveTextContent('product · 产品角色');
    expect(section).toHaveTextContent('v3（与提交版本一致）');
    expect(section).toHaveTextContent('实现 · 后端实现');
    expect(section).toHaveTextContent('text/x-source · 校验 2/2');
    expect(section).toHaveTextContent('通过 2 / 3（1 项失败）');
    expect(section).toHaveTextContent('2 处');
    expect(section).toHaveTextContent('请补充登录失败锁定的验收证据');
    expect(section).toHaveTextContent('当前版本不会发布');
    expect(section).toHaveTextContent('部分证据正文被截断');
    // 决定不能只靠颜色：文本本身必须出现，且带语义化的徽标。
    expect(screen.getByText('要求修改', { selector: '.wm-decision-badge' })).toBeInTheDocument();
  });

  it('长说明明确标注截断，并可展开完整说明', () => {
    const longComment = `${'需要补充验收证据。'.repeat(40)}完整结尾。`;
    render(<DecisionSummary summary={{ ...summary, comment: longComment }} />);

    const section = screen.getByRole('region', { name: '即将提交的决定' });
    expect(section).toHaveTextContent(`（已截断，共 ${longComment.length} 字）`);
    expect(screen.queryByText(/完整结尾/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开完整说明' }));
    expect(section).toHaveTextContent('完整结尾。');
    expect(screen.getByRole('button', { name: '收起说明' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('没有工件与说明时给出明确说明，而不是空白', () => {
    render(
      <DecisionSummary
        summary={{ ...summary, artifacts: [], checks: undefined, codeRefs: undefined, comment: '' }}
      />,
    );

    const section = screen.getByRole('region', { name: '即将提交的决定' });
    expect(section).toHaveTextContent('该评审没有附带工件证据');
    expect(section).toHaveTextContent('该评审没有结构化检查结果');
    expect(section).toHaveTextContent('未填写说明');
  });

  it('批准决定使用可读文案与对应影响说明', () => {
    render(
      <DecisionSummary
        summary={{
          ...summary,
          decision: 'APPROVE',
          comment: '检查通过，同意验收。',
          impact: '该槽位记为验收通过；若全部槽位通过，任务进入已完成状态。',
          evidenceNote: undefined,
        }}
      />,
    );

    expect(screen.getByText('批准', { selector: '.wm-decision-badge' })).toBeInTheDocument();
    expect(screen.getByText(/任务进入已完成状态/)).toBeInTheDocument();
    expect(screen.queryByText('证据完整性')).not.toBeInTheDocument();
  });
});
