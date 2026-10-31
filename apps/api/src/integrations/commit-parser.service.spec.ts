import { describe, expect, it } from 'vitest';
import { CommitParserService } from './commit-parser.service';

describe('CommitParserService', () => {
  it('extracts project scoped requirement and PRD identifiers', () => {
    const parsed = new CommitParserService().parse('feat(api): add login YFF-REQ-123 PRD-456');
    expect(parsed.requirementIds).toEqual(['YFF-REQ-123']);
    expect(parsed.prdIds).toEqual(['456']);
  });

  it('ignores requirement numbers without a project key', () => {
    const parsed = new CommitParserService().parse('feat(api): add login REQ-123');
    expect(parsed.requirementIds).toEqual([]);
  });
});
