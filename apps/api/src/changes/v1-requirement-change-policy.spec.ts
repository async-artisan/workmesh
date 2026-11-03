import { describe, expect, it } from 'vitest';
import { affectedRecipients, changedFieldsOf } from './v1-requirement-change-policy';

const task = (taskId: string, userId: string, roleId: string) => ({ taskId, userId, roleId });

describe('affectedRecipients', () => {
  it('按任务责任人派生收件人', () => {
    expect(
      affectedRecipients(
        [task('t1', 'u-dev', 'r-frontend'), task('t2', 'u-qa', 'r-qa')],
        'u-actor',
      ),
    ).toEqual([
      { userId: 'u-dev', roleId: 'r-frontend' },
      { userId: 'u-qa', roleId: 'r-qa' },
    ]);
  });

  it('同一人同角色的多个任务只通知一次', () => {
    const recipients = affectedRecipients(
      [task('t1', 'u-dev', 'r-frontend'), task('t2', 'u-dev', 'r-frontend')],
      'u-actor',
    );
    expect(recipients).toEqual([{ userId: 'u-dev', roleId: 'r-frontend' }]);
  });

  it('同一人不同角色各保留一条', () => {
    const recipients = affectedRecipients(
      [task('t1', 'u-1', 'r-frontend'), task('t2', 'u-1', 'r-qa')],
      'u-actor',
    );
    expect(recipients).toEqual([
      { userId: 'u-1', roleId: 'r-frontend' },
      { userId: 'u-1', roleId: 'r-qa' },
    ]);
  });

  it('不通知发起人自己', () => {
    const recipients = affectedRecipients(
      [task('t1', 'u-actor', 'r-product'), task('t2', 'u-dev', 'r-frontend')],
      'u-actor',
    );
    expect(recipients).toEqual([{ userId: 'u-dev', roleId: 'r-frontend' }]);
  });

  it('没有任务时不产生收件人，且结果顺序稳定', () => {
    expect(affectedRecipients([], 'u-actor')).toEqual([]);
    expect(
      affectedRecipients(
        [task('t2', 'u-b', 'r-x'), task('t1', 'u-a', 'r-y'), task('t3', 'u-a', 'r-x')],
        'u-actor',
      ).map((item) => item.userId),
    ).toEqual(['u-a', 'u-a', 'u-b']);
  });
});

describe('changedFieldsOf', () => {
  it('记录发生变化的字段并保持固定顺序', () => {
    expect(changedFieldsOf({ description: 'd', title: 't' })).toEqual(['title', 'description']);
    expect(changedFieldsOf({ title: 't' })).toEqual(['title']);
    expect(changedFieldsOf({})).toEqual([]);
  });
});
