import { describe, expect, it } from 'vitest';
import type { TaskInputStatusView } from '@workmesh/shared';
import { renderInputStatus } from './input-status';

describe('input diagnosis output', () => {
  const status: TaskInputStatusView = {
    taskId: 'task-1',
    taskVersion: 2,
    snapshotId: null,
    checkedAt: '2026-11-09T12:00:00Z',
    availability: 'UNAVAILABLE',
    issue: 'INPUT_UNAVAILABLE',
    resources: [],
    comparison: { status: 'UNAVAILABLE', changes: [], metadataChanges: [] },
  };
  it('explains precise inputs, responsible roles and actions without claiming success', () => {
    const result = renderInputStatus({
      ...status,
      issuesComplete: true,
      issues: [
        {
          kind: 'KNOWLEDGE',
          reason: 'NOT_PUBLISHED',
          required: true,
          blocking: true,
          documentId: 'doc-policy',
          action: 'PUBLISH_KNOWLEDGE',
          responsible: 'KNOWLEDGE_MAINTAINER',
        },
      ],
    });
    expect(result).toContain('文档 doc-policy');
    expect(result).toContain('项目知识维护者：发布必需知识文档后重新核验输入');
    expect(result).toContain('未认领任务或创建快照');
    expect(result).not.toContain('平台未提供');
  });
  it('preserves uncertainty when the platform has no structured diagnostics', () => {
    expect(renderInputStatus(status)).toContain('平台未提供完整逐项诊断');
  });
});
