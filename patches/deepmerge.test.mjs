import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
const api = createRequire(new URL('../apps/api/package.json', import.meta.url));
const nest = createRequire(api.resolve('@nestjs/cli/package.json'));
const checker = createRequire(nest.resolve('fork-ts-checker-webpack-plugin/package.json'));
const deepmerge = checker('deepmerge');
const packageRoot = path.dirname(checker.resolve('deepmerge/package.json'));
const implementations = [
  ['cjs', deepmerge],
  ['umd', checker(path.join(packageRoot, 'dist/umd.js'))],
];

for (const [name, merge] of implementations) {
  test(`${name}: target own __proto__ cannot replace the result prototype`, () => {
    const target = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
    const result = merge(target, { other: 2 });
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.polluted, undefined);
    assert.equal(Object.hasOwn(result, '__proto__'), true);
    assert.deepEqual(result.__proto__, { polluted: true });
    assert.equal({}.polluted, undefined);
  });
  test(`${name}: null-prototype target and malicious source remain safe`, () => {
    const source = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
    const result = merge(Object.create(null), source);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.polluted, undefined);
    assert.equal(Object.hasOwn(result, '__proto__'), true);
    assert.equal(result.safe, 1);
  });
  test(`${name}: nested and customMerge writes preserve normal prototypes`, () => {
    const left = JSON.parse('{"nested":{"__proto__":{"left":1}}}');
    const right = JSON.parse('{"nested":{"__proto__":{"right":2}}}');
    const result = merge(left, right);
    assert.equal(Object.getPrototypeOf(result.nested), Object.prototype);
    assert.equal(result.nested.left, undefined);
    assert.deepEqual(result.nested.__proto__, { left: 1, right: 2 });
    const custom = merge(left, right, {
      customMerge: (key) => (key === '__proto__' ? () => ({ safe: true }) : undefined),
    });
    assert.equal(Object.getPrototypeOf(custom.nested), Object.prototype);
    assert.deepEqual(custom.nested.__proto__, { safe: true });
  });
  test(`${name}: ordinary config merges and array concatenation are unchanged`, () => {
    const left = { compilerOptions: { strict: true, paths: ['a'] }, mode: 'old' };
    const right = { compilerOptions: { skipLibCheck: true, paths: ['b'] }, mode: 'new' };
    assert.deepEqual(merge(left, right), {
      compilerOptions: { strict: true, skipLibCheck: true, paths: ['a', 'b'] },
      mode: 'new',
    });
    assert.deepEqual(left.compilerOptions.paths, ['a']);
    assert.deepEqual(right.compilerOptions.paths, ['b']);
  });
  test(`${name}: clone, clone false, dates, regex and symbols retain semantics`, () => {
    const symbol = Symbol('config');
    const item = { nested: true };
    const date = new Date(0);
    const regexp = /workmesh/;
    const source = { list: [item], date, regexp, [symbol]: { enabled: true } };
    const result = merge({}, source);
    assert.notEqual(result.list[0], item);
    assert.equal(result.date, date);
    assert.equal(result.regexp, regexp);
    assert.deepEqual(result[symbol], { enabled: true });
    assert.notEqual(result[symbol], source[symbol]);
    assert.equal(merge({}, source, { clone: false }).list, source.list);
  });
  test(`${name}: all(), custom arrayMerge and property descriptors remain usable`, () => {
    assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }, { a: 3 }]), { a: 3, b: 2 });
    assert.deepEqual(merge({ a: [1] }, { a: [2] }, { arrayMerge: (_target, source) => source }), {
      a: [2],
    });
    const result = merge({ a: 1 }, { b: 2 });
    assert.deepEqual(Object.getOwnPropertyDescriptor(result, 'a'), {
      value: 1,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    result.a = 3;
    delete result.b;
    assert.deepEqual(result, { a: 3 });
  });
}
