import { describe, expect, it } from 'vitest';
import { renderChangeGuidance } from './change-guidance';

describe('change task guidance output', () => {
  it('renders precise task, owner, recovery command and historical/current scope distinctions', () => {
    const text = renderChangeGuidance({
      scope: 'CURRENT_ACCEPTANCE_SCOPE',
      eventBaseline: 'SUPERSEDED',
      tasks: [
        {
          taskCode: 'KEY-001/impl',
          role: { title: '后端' },
          relation: 'ROLE',
          reason: 'STALE_CONTEXT',
          action: 'CONTACT_OWNER',
          inspectCommand: 'workmesh context --task task-1 --inspect',
          href: '/requirements/req?taskId=task-1',
        },
      ],
    }).join('|');
    expect(text).toContain('通知基线已有后续更新');
    expect(text).toContain('任务按当前验收范围匹配');
    expect(text).toContain('KEY-001/impl · 后端');
    expect(text).toContain('联系任务负责人');
    expect(text).toContain('workmesh context --task task-1 --inspect');
    expect(text).toContain('/requirements/req?taskId=task-1');
  });
  it('does not equate missing older-server diagnostics with a verified empty task list', () => {
    expect(renderChangeGuidance(undefined).join()).toContain('未提供任务级诊断');
    expect(renderChangeGuidance({ tasks: [] }).join()).toContain('未匹配到');
  });
});
