export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function assertValue(value: unknown, path = '$'): asserts value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new CanonicalJsonError(`non-integer number at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertValue(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError(`non-plain object at ${path}`);
    }
    for (const [key, item] of Object.entries(value)) assertValue(item, `${path}.${key}`);
    return;
  }
  throw new CanonicalJsonError(`unsupported value at ${path}`);
}

export function canonicalJson(value: unknown): string {
  assertValue(value);
  return JSON.stringify(value, (_key, item: JsonValue) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
    }
    return item;
  });
}
