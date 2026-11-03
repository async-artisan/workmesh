import { describe, expect, it } from 'vitest';
import {
  artifactClaimsCode,
  collectDownstreamStepKeys,
  isCodeEvidenceAcceptable,
  needsCodeEvidence,
} from './v1-review-policy';

function definition(steps: Array<{ key: string; deps?: unknown }>) {
  return { schemaVersion: '1.0', steps };
}

describe('collectDownstreamStepKeys', () => {
  it('returns direct and transitive dependents of the reviewed step', () => {
    const downstream = collectDownstreamStepKeys(
      definition([
        { key: 'product', deps: [] },
        { key: 'impl', deps: ['product'] },
        { key: 'cases', deps: ['impl'] },
        { key: 'release', deps: ['impl', 'cases'] },
        { key: 'unrelated', deps: [] },
      ]),
      'impl',
    );
    expect(downstream).toEqual(['cases', 'release']);
  });

  it('includes every reachable descendant regardless of ordering', () => {
    const downstream = collectDownstreamStepKeys(
      definition([
        { key: 'release', deps: ['verify'] },
        { key: 'verify', deps: ['impl'] },
        { key: 'impl', deps: ['product'] },
        { key: 'product' },
      ]),
      'product',
    );
    expect(downstream).toEqual(['impl', 'release', 'verify']);
  });

  it('excludes the reviewed step itself and unrelated branches', () => {
    const downstream = collectDownstreamStepKeys(
      definition([
        { key: 'a', deps: [] },
        { key: 'b', deps: ['a'] },
        { key: 'c', deps: ['b'] },
        { key: 'd', deps: [] },
      ]),
      'a',
    );
    expect(downstream).not.toContain('a');
    expect(downstream).not.toContain('d');
  });

  it('ignores malformed definitions instead of throwing', () => {
    expect(collectDownstreamStepKeys(null, 'a')).toEqual([]);
    expect(collectDownstreamStepKeys({ steps: 'nope' }, 'a')).toEqual([]);
    expect(
      collectDownstreamStepKeys(
        {
          steps: [
            null,
            { key: 1, deps: ['a'] },
            { key: 'b', deps: 'a' },
            { key: 'c', deps: ['a', 2] },
          ],
        },
        'a',
      ),
    ).toEqual(['c']);
  });

  it('terminates on a cyclic dependency graph', () => {
    const downstream = collectDownstreamStepKeys(
      definition([
        { key: 'a', deps: ['c'] },
        { key: 'b', deps: ['a'] },
        { key: 'c', deps: ['b'] },
      ]),
      'a',
    );
    expect(downstream).toEqual(['b', 'c']);
  });

  it('returns a deterministic sorted list', () => {
    const downstream = collectDownstreamStepKeys(
      definition([
        { key: 'z', deps: ['root'] },
        { key: 'm', deps: ['root'] },
        { key: 'a', deps: ['m'] },
      ]),
      'root',
    );
    expect(downstream).toEqual(['a', 'm', 'z']);
  });
});

describe('代码评审证据的适用范围', () => {
  it('HOSTED 且没有 commitSha 的实现说明不算代码交付', () => {
    expect(artifactClaimsCode({ storage: 'HOSTED', commitSha: null })).toBe(false);
    expect(artifactClaimsCode({ storage: 'HOSTED' })).toBe(false);
    expect(needsCodeEvidence([{ storage: 'HOSTED', commitSha: null }])).toBe(false);
  });

  it('GIT_REF 或带 commitSha 的工件算代码交付', () => {
    expect(artifactClaimsCode({ storage: 'GIT_REF' })).toBe(true);
    expect(artifactClaimsCode({ storage: 'HOSTED', commitSha: 'a'.repeat(40) })).toBe(true);
    expect(needsCodeEvidence([{ storage: 'GIT_REF', commitSha: null }])).toBe(true);
  });

  it('空交付集不要求证据；混合交付只要含代码就要求', () => {
    expect(needsCodeEvidence([])).toBe(false);
    expect(
      needsCodeEvidence([
        { storage: 'HOSTED', commitSha: null },
        { storage: 'GIT_REF', commitSha: null },
      ]),
    ).toBe(true);
  });
});

describe('代码评审证据是否可接受', () => {
  it('空证据不通过', () => {
    expect(isCodeEvidenceAcceptable([])).toBe(false);
  });

  it('全部 APPROVED 且非 Bot 才通过', () => {
    expect(isCodeEvidenceAcceptable([{ state: 'APPROVED', reviewerKind: 'USER' }])).toBe(true);
    expect(
      isCodeEvidenceAcceptable([
        { state: 'APPROVED', reviewerKind: 'USER' },
        { state: 'APPROVED', reviewerKind: 'USER' },
      ]),
    ).toBe(true);
  });

  it('机器人评审、待定、被驳回、混合状态一律不通过', () => {
    expect(isCodeEvidenceAcceptable([{ state: 'APPROVED', reviewerKind: 'BOT' }])).toBe(false);
    expect(isCodeEvidenceAcceptable([{ state: 'PENDING', reviewerKind: 'USER' }])).toBe(false);
    expect(isCodeEvidenceAcceptable([{ state: 'CHANGES_REQUESTED', reviewerKind: 'USER' }])).toBe(
      false,
    );
    expect(
      isCodeEvidenceAcceptable([
        { state: 'APPROVED', reviewerKind: 'USER' },
        { state: 'DISMISSED', reviewerKind: 'USER' },
      ]),
    ).toBe(false);
  });
});
