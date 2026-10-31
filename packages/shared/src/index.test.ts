import { describe, expect, it } from 'vitest';
import type { RequirementStatus } from './index';

describe('shared contracts', () => {
  it('keeps the requirement status contract explicit', () => {
    const status: RequirementStatus = 'DRAFT';
    expect(status).toBe('DRAFT');
  });
});
