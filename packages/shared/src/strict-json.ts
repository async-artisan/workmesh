export class StrictJsonError extends Error {
  readonly code = 'INVALID_JSON';

  constructor(message: string) {
    super(message);
    this.name = 'StrictJsonError';
  }
}

function decodeUtf8(input: Uint8Array | string): string {
  if (typeof input === 'string') return input;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw new StrictJsonError('input is not valid UTF-8');
  }
}

export function parseJsonStrict(input: Uint8Array | string, maxDepth = 32): unknown {
  const source = decodeUtf8(input);
  let index = 0;

  const fail = (message: string): never => {
    throw new StrictJsonError(`${message} at byte ${index}`);
  };
  const skipWhitespace = () => {
    while (/\s/.test(source[index] ?? '')) index += 1;
  };
  const parseString = (): string => {
    const start = index;
    if (source[index] !== '"') fail('expected string');
    index += 1;
    let escaped = false;
    while (index < source.length) {
      const char = source[index++];
      if (escaped) {
        escaped = false;
        if (char === 'u') {
          const hex = source.slice(index, index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid unicode escape');
          index += 4;
        } else if (!/["\\/bfnrt]/.test(char)) fail('invalid escape');
      } else if (char === '\\') escaped = true;
      else if (char === '"') return JSON.parse(source.slice(start, index)) as string;
      else if (char < ' ') fail('control character in string');
    }
    return fail('unterminated string');
  };
  const parseValue = (depth: number): unknown => {
    skipWhitespace();
    if (depth > maxDepth) fail('maximum depth exceeded');
    const char = source[index];
    if (char === '"') return parseString();
    if (char === '{') {
      index += 1;
      const object: Record<string, unknown> = {};
      const keys = new Set<string>();
      skipWhitespace();
      if (source[index] === '}') {
        index += 1;
        return object;
      }
      while (index < source.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) fail(`duplicate object key ${key}`);
        keys.add(key);
        skipWhitespace();
        if (source[index++] !== ':') fail('expected colon');
        object[key] = parseValue(depth + 1);
        skipWhitespace();
        if (source[index] === '}') {
          index += 1;
          return object;
        }
        if (source[index++] !== ',') fail('expected comma');
      }
      fail('unterminated object');
    }
    if (char === '[') {
      index += 1;
      const array: unknown[] = [];
      skipWhitespace();
      if (source[index] === ']') {
        index += 1;
        return array;
      }
      while (index < source.length) {
        array.push(parseValue(depth + 1));
        skipWhitespace();
        if (source[index] === ']') {
          index += 1;
          return array;
        }
        if (source[index++] !== ',') fail('expected comma');
      }
      fail('unterminated array');
    }
    const token = source
      .slice(index)
      .match(/^(true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!token) fail('invalid JSON value');
    const parsedToken = token as string;
    index += parsedToken.length;
    if (/^-?\d/.test(parsedToken) && !/^-?(?:0|[1-9]\d*)$/.test(parsedToken))
      fail('floating point number is not supported');
    const value = JSON.parse(parsedToken) as unknown;
    if (typeof value === 'number' && (!Number.isFinite(value) || !Number.isSafeInteger(value)))
      fail('number is not a safe integer');
    return value;
  };

  const value = parseValue(0);
  skipWhitespace();
  if (index !== source.length) fail('trailing data');
  return value;
}
