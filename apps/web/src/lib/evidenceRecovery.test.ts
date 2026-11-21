import { describe, expect, it } from 'vitest';
import { CODE_EVIDENCE_NEXT_ACTIONS } from '@workmesh/shared';
import { codeEvidenceRecovery, requirementGapRecovery } from './evidenceRecovery';

describe('evidenceRecovery', () => {
  it('复用既有代码证据恢复动作，并以角色建议区分仓库、评审与绑定责任', () => {
    expect(codeEvidenceRecovery('REPOSITORY_UNRESOLVED').responsible).toBe('项目管理员');
    expect(codeEvidenceRecovery('SHA_MISMATCH')).toEqual({
      responsible: '交付责任角色 / 代码评审人',
      nextStep: CODE_EVIDENCE_NEXT_ACTIONS.SHA_MISMATCH,
    });
    expect(codeEvidenceRecovery('TICKET_EXPIRED').nextStep).toContain('旧票据不能重放');
    expect(codeEvidenceRecovery('INCOMPLETE').nextStep).toContain('不能把部分记录当作无证据');
  });

  it('快照或交付失效先定位实际依据，复验范围由QA判断', () => {
    const snapshot = requirementGapRecovery('SNAPSHOT_STALE');
    expect(snapshot.responsible).toContain('QA');
    expect(snapshot.nextStep).toContain('由 QA 判断复验范围');
    expect(snapshot.nextStep).toContain('不能用最新版本覆盖原交付依据');
    expect(requirementGapRecovery('DELIVERY_STALE').nextStep).toContain('交付代次与流程修订');
    expect(requirementGapRecovery('APPROVAL_MISSING').responsible).toBe('本轮审批人');
  });

  it('读取边界与签字来源不足时不推断缺失、功能失败或正式批准', () => {
    expect(requirementGapRecovery('BASELINE_UNAVAILABLE').nextStep).toContain('不能判断基线缺失');
    expect(requirementGapRecovery('SNAPSHOT_UNVERIFIABLE').nextStep).toContain(
      '不能当作快照匹配或功能失败',
    );
    expect(requirementGapRecovery('VISIBILITY_LIMITED').nextStep).toContain('不能计作已完成或缺失');
    expect(requirementGapRecovery('SIGNATURE_UNRECORDED').nextStep).toContain(
      '不能从 Agent 报告或讨论状态推断',
    );
  });
});
