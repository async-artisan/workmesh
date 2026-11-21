import { describe, expect, it } from 'vitest';
import { parseJsonStrict, StrictJsonError } from './strict-json';

describe('parseJsonStrict', () => {
  it('rejects duplicate decoded keys, including escaped equivalents', () => {
    expect(() => parseJsonStrict('{"a":1,"\\u0061":2}')).toThrow(StrictJsonError);
  });

  it('allows same keys in nested objects', () => {
    expect(parseJsonStrict('{"a":{"a":1}}')).toEqual({ a: { a: 1 } });
  });
  it('preserves __proto__ as an ordinary own JSON key without injecting inherited fields', () => {
    const input = parseJsonStrict(
      '{"__proto__":{"stage":"DELIVERY","verified":true},"safe":1}',
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(Object.hasOwn(input, '__proto__')).toBe(true);
    expect(input.stage).toBeUndefined();
    expect(input.verified).toBeUndefined();
    expect(JSON.stringify(input)).toBe(
      '{"__proto__":{"stage":"DELIVERY","verified":true},"safe":1}',
    );
    expect(() => parseJsonStrict('{"__proto__":{},"\\u005f_proto__":{}}')).toThrow(StrictJsonError);
  });

  it('rejects invalid UTF-8, trailing data and excessive depth', () => {
    expect(() => parseJsonStrict(new Uint8Array([0xc3, 0x28]))).toThrow('UTF-8');
    expect(() => parseJsonStrict('{"a":1} trailing')).toThrow(StrictJsonError);
    expect(() => parseJsonStrict('['.repeat(34) + '0' + ']'.repeat(34))).toThrow('depth');
  });

  it('parses raw bytes without re-encoding their content', () => {
    const bytes = new TextEncoder().encode('{"body":"CRLF\\r\\n"}');
    expect(parseJsonStrict(bytes)).toEqual({ body: 'CRLF\r\n' });
  });
});
