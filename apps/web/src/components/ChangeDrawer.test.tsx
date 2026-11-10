import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchChangeItem } from '../api/resources';
import { ChangeDrawer } from './ChangeDrawer';

afterEach(cleanup);

const change: WorkbenchChangeItem = {
  recipientId: 'recipient-1',
  eventId: 'event-1',
  projectId: 'project-1',
  projectKey: 'ORDER',
  projectName: '订单项目',
  requirement: { code: 'ORDER-001', title: '订单取消规则' },
  changedFields: ['currentPrdRevisionId', 'generation'],
  targets: {
    taskIds: ['task-a', 'task-b'],
    documentId: 'document-a',
    previousDocumentRevisionId: 'revision-before',
    documentRevisionId: 'revision-after',
    requirementGeneration: 5,
  },
  pendingRoles: [{ key: 'backend', title: '后端' }],
  version: 2,
  createdAt: '2026-11-09T01:00:00.000Z',
  ageSeconds: 100,
};

function drawer(props: Partial<Parameters<typeof ChangeDrawer>[0]> = {}) {
  return (
    <MemoryRouter>
      <ChangeDrawer
        change={change}
        busy={false}
        error=""
        onClose={vi.fn()}
        onAck={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  );
}

describe('变更知悉与交接', () => {
  it('将当前相关任务、恢复动作与直达输入入口呈现给收件人，并解释历史事件', () => {
    render(
      drawer({
        change: {
          ...change,
          guidance: {
            checkedAt: change.createdAt,
            scope: 'CURRENT_ACCEPTANCE_SCOPE',
            eventBaseline: 'SUPERSEDED',
            tasks: [
              {
                taskId: 'task-a',
                requirementId: 'req-1',
                taskCode: 'ORDER-001/backend',
                stepKey: 'backend',
                stepDisplayName: '后端实现',
                role: { id: 'role-backend', key: 'backend', title: '后端' },
                responsibleUserId: 'user-1',
                relation: 'RESPONSIBLE',
                version: 3,
                generation: 2,
                executionStatus: 'OPEN',
                workStatus: 'ACTIVE',
                reason: 'STALE_CONTEXT',
                action: 'INSPECT_AND_REFRESH',
                href: '/requirements/req-1?projectId=project-1&taskId=task-a',
                inspectCommand: 'workmesh context --task task-a --inspect',
              },
            ],
          },
        },
      }),
    );
    const tasks = screen.getByRole('list', { name: '相关任务与恢复动作' });
    expect(within(tasks).getByText('ORDER-001/backend · 后端实现')).toBeVisible();
    expect(within(tasks).getByText('后端 · 由你负责')).toBeVisible();
    expect(within(tasks).getByText('当前快照不属于任务的当前代次或需求基线')).toBeVisible();
    expect(within(tasks).getByText(/先检查输入，再用当前认领重新获取上下文/)).toBeVisible();
    expect(
      within(tasks).getByRole('link', { name: '查看 ORDER-001/backend 的任务与输入' }),
    ).toHaveAttribute('href', '/requirements/req-1?projectId=project-1&taskId=task-a');
    expect(within(tasks).getByText('workmesh context --task task-a --inspect')).toBeVisible();
    expect(screen.getByText(/此通知引用的基线已有后续更新/)).toBeVisible();
    expect(screen.getByText(/不表示事件发生时已使这些任务失效/)).toBeVisible();
    expect(screen.getByText(/知悉只确认你已收到/)).toBeVisible();
  });

  it('区分没有任务匹配和旧平台未提供诊断', () => {
    const view = render(
      drawer({
        change: {
          ...change,
          guidance: {
            checkedAt: change.createdAt,
            scope: 'EVENT_TASKS',
            eventBaseline: 'NOT_SPECIFIED',
            tasks: [],
          },
        },
      }),
    );
    expect(screen.getByText(/未匹配到你当前负责/)).toBeVisible();
    expect(screen.queryByText(/当前平台未提供任务级诊断/)).not.toBeInTheDocument();
    view.rerender(drawer());
    expect(screen.getByText(/当前平台未提供任务级诊断/)).toBeVisible();
  });
  it('展示真实基线影响，收件记录版本与文档修订不混淆，原始标识可展开核对', () => {
    render(drawer());

    const dialog = screen.getByRole('dialog', { name: '需求变更 · 需要确认' });
    expect(within(dialog).getByText('产品需求基线 / 需求工作版本')).toBeVisible();
    expect(within(dialog).getByText('新的发布修订已替换原修订')).toBeVisible();
    expect(within(dialog).getByText('受影响任务').parentElement).toHaveTextContent('2 项');
    expect(within(dialog).getByText('第 5 代')).toBeVisible();
    expect(within(dialog).getByText(/重新获取上下文/)).toBeVisible();
    expect(within(dialog).getByText(/知悉只确认你已收到/)).toBeVisible();
    expect(within(dialog).queryByText(/当前角色已处理/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: '查看项目任务' })).toHaveAttribute(
      'href',
      '/board?projectId=project-1',
    );
    expect(within(dialog).getByRole('link', { name: '查看项目知识文档' })).toHaveAttribute(
      'href',
      '/knowledge?projectId=project-1',
    );

    const details = within(dialog).getByText('查看技术详情').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(within(dialog).getByText(/收件记录版本：v2/)).not.toBeVisible();
    expect(details).toHaveTextContent('revision-before');
    expect(details).toHaveTextContent('revision-after');
    fireEvent.click(within(dialog).getByText('查看技术详情'));
    expect(details).toHaveAttribute('open');
    expect(within(dialog).getByText(/收件记录版本：v2/)).toBeVisible();
  });

  it('请求知悉只触发原有确认回调，未完成的调整仍需后续交付', () => {
    const onAck = vi.fn();
    const onClose = vi.fn();
    render(drawer({ onAck, onClose }));
    fireEvent.click(screen.getByRole('button', { name: '确认已知悉' }));
    expect(onAck).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/是否完成调整，以后续交付和验收为准/)).toBeVisible();
  });

  it('变更请求以验收条目说明影响，缺少任务和版本信息时不推测具体内容', () => {
    render(
      drawer({
        change: {
          ...change,
          changedFields: ['level:L2', 'acceptance:cancel-rule'],
          targets: {
            requirementId: 'requirement-1',
            acceptanceKeys: ['cancel-rule', 'cancel-confirm'],
            changeRequestId: 'request-1',
          },
          pendingRoles: [],
        },
      }),
    );

    expect(screen.getByText('变更级别 L2 / 验收条件 cancel-rule')).toBeVisible();
    expect(screen.getByText('cancel-rule、cancel-confirm')).toBeVisible();
    expect(screen.getByText('已接受的变更请求')).toBeVisible();
    expect(screen.queryByText('受影响任务')).not.toBeInTheDocument();
    expect(screen.queryByText('文档更新')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看项目知识文档' })).not.toBeInTheDocument();
    expect(screen.getByText('未提供角色信息')).toBeVisible();
  });

  it('未知结构仅保存在技术详情中，已有的人类可读摘要仍可呈现', () => {
    render(
      drawer({
        change: {
          ...change,
          changedFields: ['description', 'customPayload', 'constructor'],
          targets: { 角色: ['后端', '产品'], 版本: 'v3', customPayload: { internal: 'kept' } },
        },
      }),
    );
    expect(screen.getByText('需求描述 / 其他字段（详见技术详情）')).toBeVisible();
    expect(screen.getByText('角色').parentElement).toHaveTextContent('后端、产品');
    expect(screen.getByText('版本').parentElement).toHaveTextContent('v3');
    const details = screen.getByText('查看技术详情').closest('details');
    expect(details).toHaveTextContent('customPayload');
    expect(details).toHaveTextContent('kept');
    expect(details).not.toHaveAttribute('open');
  });

  it('没有结构化影响时明确提示缺少摘要，不把通知版本显示成文档版本', () => {
    render(drawer({ change: { ...change, targets: null, changedFields: [] } }));
    expect(screen.getByText('本次通知未提供可读的影响摘要，请核对关联需求。')).toBeVisible();
    expect(screen.getByText('未标注字段')).toBeVisible();
    expect(screen.getByText(/收件记录版本：v2/)).not.toBeVisible();
    expect(screen.queryByText('受影响任务')).not.toBeInTheDocument();
  });

  it('提交期间阻止重复确认和关闭，失败后保留影响与错误并允许再次操作', () => {
    const onAck = vi.fn();
    const onClose = vi.fn();
    const view = render(drawer({ busy: true, onAck, onClose }));
    expect(screen.getByRole('button', { name: '提交中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提交中…' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onAck).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    view.rerender(drawer({ error: '连接中断，请重试。', onAck, onClose }));
    expect(screen.getByRole('alert')).toHaveTextContent('连接中断，请重试。');
    expect(screen.getByText('受影响任务').parentElement).toHaveTextContent('2 项');
    expect(screen.getByRole('button', { name: '确认已知悉' })).toBeEnabled();
    expect(screen.getByRole('link', { name: '查看项目任务' })).toBeVisible();
  });
});
