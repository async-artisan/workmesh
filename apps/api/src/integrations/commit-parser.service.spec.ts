import { describe, expect, it } from 'vitest';
import { CommitParserService } from './commit-parser.service';

describe('CommitParserService', () => {
  it('extracts requirement and PRD identifiers', () => {
    const parsed = new CommitParserService().parse('feat(api): add login #REQ-123 #PRD-456');
    expect(parsed.requirementIds).toEqual(['123']);
    expect(parsed.prdIds).toEqual(['456']);
  });
});
