import { describe, expect, it } from 'vitest';
import { etagOf, ifNoneMatchMatches } from './conditional-request';

const page = {
  items: [{ id: 'a', version: 1 }],
  nextCursor: null,
};

describe('etagOf', () => {
  it('is stable for semantically equal payloads', () => {
    expect(etagOf(page)).toBe(etagOf({ items: [{ id: 'a', version: 1 }], nextCursor: null }));
  });

  it('changes as soon as the payload changes', () => {
    expect(etagOf(page)).not.toBe(etagOf({ ...page, nextCursor: 'cursor-1' }));
    expect(etagOf(page)).not.toBe(etagOf({ ...page, items: [{ id: 'b', version: 1 }] }));
    // 版本号变了也必须换验证器：Agent 靠它判断任务是否被他人动过。
    expect(etagOf(page)).not.toBe(etagOf({ ...page, items: [{ id: 'a', version: 2 }] }));
  });

  it('emits a weak validator', () => {
    expect(etagOf(page)).toMatch(/^W\/"[A-Za-z0-9_-]{27}"$/);
  });
});

describe('ifNoneMatchMatches', () => {
  const etag = etagOf(page);

  it.each([undefined, '', '   '])('does not match a missing or blank header: %s', (header) => {
    expect(ifNoneMatchMatches(header, etag)).toBe(false);
  });

  it('matches the same validator', () => {
    expect(ifNoneMatchMatches(etag, etag)).toBe(true);
  });

  it('matches across weak and strong forms of the same tag', () => {
    const strong = etag.replace(/^W\//, '');
    expect(ifNoneMatchMatches(strong, etag)).toBe(true);
    expect(ifNoneMatchMatches(etag, strong)).toBe(true);
  });

  it('matches the wildcard', () => {
    expect(ifNoneMatchMatches('*', etag)).toBe(true);
    // 服务端验证器永远不是 `*`；通配只能出现在请求头一侧。
    expect(ifNoneMatchMatches('*', etagOf(null))).toBe(true);
  });

  it('matches a wildcard candidate inside a list', () => {
    expect(ifNoneMatchMatches('"stale", *', etag)).toBe(true);
  });

  it('matches one candidate inside a list', () => {
    expect(ifNoneMatchMatches(`"stale", "older", ${etag}`, etag)).toBe(true);
  });

  it('does not match a different validator', () => {
    expect(ifNoneMatchMatches(etagOf({ items: [], nextCursor: null }), etag)).toBe(false);
  });
});
