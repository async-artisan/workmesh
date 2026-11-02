import { describe, expect, it } from 'vitest';
import { canonicalJson, CanonicalJsonError } from './canonical-json';

describe('canonicalJson', () => {
  it('sorts nested object keys and preserves array order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, 1] } })).toBe('{"a":{"c":[3,1],"d":2},"b":1}');
  });

  it('rejects floating point and unsupported values', () => {
    expect(() => canonicalJson({ value: 1.5 })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ value: undefined })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ value: Number.MAX_SAFE_INTEGER + 1 })).toThrow(CanonicalJsonError);
  });

  it('keeps stable escaping and null values', () => {
    expect(canonicalJson({ text: '引号"\\\n', empty: {}, list: [], nil: null })).toBe('{"empty":{},"list":[],"nil":null,"text":"引号\\\"\\\\\\n"}');
  });
});
