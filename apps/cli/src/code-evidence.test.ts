import { describe, expect, it } from 'vitest';
import { renderCodeEvidence } from './code-evidence';
describe('code evidence CLI explanation', () => {
  it('distinguishes absent diagnostics from a verified empty code reference list', () => {
    expect(renderCodeEvidence(undefined).join('\n')).toContain('服务端未提供');
    const lines = renderCodeEvidence({
      checkedAt: 'now',
      complete: false,
      currentBinding: 'HISTORICAL',
      taskGeneration: 1,
      currentTaskGeneration: 2,
      signaturePolicy: 'REJECTED_BEFORE_RECEIPT',
      references: [],
    }).join('\n');
    expect(lines).toContain('HISTORICAL');
    expect(lines).toContain('记录不完整');
    expect(lines).toContain('无关联记录不能区分');
  });
});
