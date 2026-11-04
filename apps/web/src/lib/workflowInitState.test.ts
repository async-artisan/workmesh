import { describe, expect, it } from 'vitest';
import {
  describeWorkflowInitState,
  publishedWorkflowDefinitions,
  type WorkflowInitAdmin,
} from './workflowInitState';

const published = [
  {
    workflowKey: 'standard',
    title: '标准交付流程',
    version: 1,
    currentRevision: 1,
    currentPublishedRevisionId: 'rev-1',
  },
];
const unpublished = [
  {
    workflowKey: 'standard',
    title: '标准交付流程',
    version: 1,
    currentRevision: 0,
    currentPublishedRevisionId: null,
  },
];
const admins: WorkflowInitAdmin[] = [
  { email: 'owner@example.com', name: 'Owner' },
  { email: 'admin@example.com', name: null },
];

describe('describeWorkflowInitState（流程初始化状态映射）', () => {
  it('已有实例时不再提示初始化', () => {
    const state = describeWorkflowInitState({
      hasInstance: true,
      definitions: published,
      isAdmin: false,
      admins,
    });
    expect(state.kind).toBe('EXISTS');
    expect(state.canInitialize).toBe(false);
  });

  it('定义未加载完时不断言未发布', () => {
    const state = describeWorkflowInitState({
      hasInstance: false,
      definitions: null,
      isAdmin: true,
      admins,
    });
    expect(state.kind).toBe('LOADING');
    expect(state.title).not.toContain('未发布');
  });

  it('未发布定义：管理员看到去发布的下一步，成员看到需要管理员发布', () => {
    const admin = describeWorkflowInitState({
      hasInstance: false,
      definitions: unpublished,
      isAdmin: true,
      admins,
    });
    expect(admin.kind).toBe('UNPUBLISHED');
    expect(admin.linkToWorkflows).toBe(true);
    expect(admin.description).toContain('流程');
    expect(admin.canInitialize).toBe(false);

    const member = describeWorkflowInitState({
      hasInstance: false,
      definitions: unpublished,
      isAdmin: false,
      admins,
    });
    expect(member.kind).toBe('UNPUBLISHED');
    expect(member.description).toContain('项目管理员');
  });

  it('已发布但未创建：管理员可初始化，成员得到管理员名单', () => {
    const admin = describeWorkflowInitState({
      hasInstance: false,
      definitions: published,
      isAdmin: true,
      admins,
    });
    expect(admin.kind).toBe('NOT_CREATED');
    expect(admin.canInitialize).toBe(true);

    const member = describeWorkflowInitState({
      hasInstance: false,
      definitions: published,
      isAdmin: false,
      admins,
    });
    expect(member.kind).toBe('NO_PERMISSION');
    expect(member.canInitialize).toBe(false);
    expect(member.description).toContain('Owner');
    expect(member.description).toContain('admin@example.com');
    expect(member.description).not.toContain('通知');
  });

  it('初始化失败与「尚未创建」是不同状态，管理员可重试', () => {
    const state = describeWorkflowInitState({
      hasInstance: false,
      definitions: published,
      isAdmin: true,
      admins,
      createError: '[VERSION_CONFLICT] 版本冲突',
    });
    expect(state.kind).toBe('CREATE_FAILED');
    expect(state.description).toContain('版本冲突');
    expect(state.canInitialize).toBe(true);

    const member = describeWorkflowInitState({
      hasInstance: false,
      definitions: published,
      isAdmin: false,
      admins,
      createError: '[VERSION_CONFLICT] 版本冲突',
    });
    expect(member.kind).toBe('CREATE_FAILED');
    expect(member.canInitialize).toBe(false);
  });

  it('没有联系人数据时不虚构通知渠道', () => {
    const state = describeWorkflowInitState({
      hasInstance: false,
      definitions: published,
      isAdmin: false,
      admins: [],
    });
    expect(state.kind).toBe('NO_PERMISSION');
    expect(state.description).toContain('项目管理员');
    expect(state.description).not.toContain('邮件');
  });

  it('只把有已发布修订的定义算作已发布', () => {
    expect(publishedWorkflowDefinitions(published)).toHaveLength(1);
    expect(publishedWorkflowDefinitions(unpublished)).toHaveLength(0);
    expect(publishedWorkflowDefinitions(null)).toHaveLength(0);
  });
});
