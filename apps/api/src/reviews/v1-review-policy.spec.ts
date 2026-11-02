import { describe, expect, it } from 'vitest';
import { collectDownstreamStepKeys } from './v1-review-policy';

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
