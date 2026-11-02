import { describe, expect, it } from 'vitest';
import { parseJsonStrict, StrictJsonError } from './strict-json';

describe('parseJsonStrict', () => {
  it('rejects duplicate decoded keys, including escaped equivalents', () => {
    expect(() => parseJsonStrict('{"a":1,"\\u0061":2}')).toThrow(StrictJsonError);
  });

  it('allows same keys in nested objects', () => {
    expect(parseJsonStrict('{"a":{"a":1}}')).toEqual({ a: { a: 1 } });
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
