import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createCycloneDxValidator,
  isIdnEmail,
  isIriReference,
  runCli,
  SCHEMA_DIRECTORY,
} from './validate-cyclonedx.mjs';

const temporaryRoot = mkdtempSync(join(tmpdir(), 'workmesh-cyclonedx-test-'));
after(() => {
  assert.equal(dirname(temporaryRoot), resolve(tmpdir()));
  assert.ok(basename(temporaryRoot).startsWith('workmesh-cyclonedx-test-'));
  rmSync(temporaryRoot, { recursive: true, force: true });
});
const minimal = () => ({ bomFormat: 'CycloneDX', specVersion: '1.7', version: 1 });
let validator;
const validate = (document) => (validator ??= createCycloneDxValidator())(document);
function modifiedSchemas(name, mutate) {
  const directory = join(temporaryRoot, name);
  cpSync(SCHEMA_DIRECTORY, directory, { recursive: true });
  const file = join(directory, 'bom-1.7.schema.json');
  const schema = JSON.parse(readFileSync(file, 'utf8'));
  mutate(schema, directory);
  writeFileSync(file, JSON.stringify(schema));
  return { schemaDirectory: directory };
}

test('vendored official resources retain their pinned upstream bytes', () => {
  const expected = {
    'bom-1.7.schema.json': 'df472ef4aaf593904c479293723a1a5c191d6672715c93b3c0b5c318f3914221',
    'spdx.schema.json': '54a6288292bc6c90b0d3952f5f939f17436fa76704ffe68a46e5b78539c7cc1b',
    'jsf-0.82.schema.json': '8bae002c25e723db7ee1f26afde680ae1a2b1a8f6b4b4b0fd65dc3becb090aae',
    'cryptography-defs.schema.json':
      '018ea7f78b5208ec647cfd10f669cc9c26aba6aceb79c4da7f9c0ef4c99b60de',
    LICENSE: '6c29f22a4a7385285c6f579ec9f33c5e989f00739d6b257243a0b082ec9447ae',
  };
  for (const [name, digest] of Object.entries(expected))
    assert.equal(
      createHash('sha256')
        .update(readFileSync(join(SCHEMA_DIRECTORY, name)))
        .digest('hex'),
      digest,
      name,
    );
});

test('accepts minimal 1.7 and a component with an externally referenced SPDX license', () => {
  assert.equal(validate(minimal()).valid, true);
  const result = validate({
    ...minimal(),
    components: [
      {
        type: 'library',
        name: 'sample',
        version: '1.0.0',
        licenses: [{ license: { id: 'MIT' } }],
      },
    ],
  });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('rejects wrong types, required fields, extra fields, and invalid external SPDX enum', () => {
  for (const document of [
    null,
    [],
    { specVersion: '1.7' },
    { ...minimal(), extra: true },
    { ...minimal(), components: [{ type: 'not-a-component-type', name: 'bad' }] },
    {
      ...minimal(),
      components: [
        { type: 'library', name: 'bad', licenses: [{ license: { id: 'Not-A-License' } }] },
      ],
    },
  ])
    assert.equal(validate(document).valid, false, JSON.stringify(document));
});

test('rejects 1.6 and conflicting schema declarations despite the upstream string field', () => {
  assert.equal(validate({ ...minimal(), specVersion: '1.6' }).valid, false);
  assert.equal(
    validate({ ...minimal(), $schema: 'https://example.invalid/schema.json' }).valid,
    false,
  );
  assert.equal(
    validate({ ...minimal(), $schema: 'https://cyclonedx.org/schema/bom-1.7.schema.json' }).valid,
    true,
  );
});

test('validates date-time format through the actual BOM schema', () => {
  assert.equal(
    validate({ ...minimal(), metadata: { timestamp: '2026-11-07T01:02:03Z' } }).valid,
    true,
  );
  for (const timestamp of ['not-a-date', '2026-02-30T01:02:03Z', '2026-11-07'])
    assert.equal(validate({ ...minimal(), metadata: { timestamp } }).valid, false, timestamp);
});

test('validates IRI and international email formats through the actual BOM schema', () => {
  for (const email of ['用户@例子.测试', '"a b"@example.test'])
    assert.equal(validate({ ...minimal(), metadata: { authors: [{ email }] } }).valid, true, email);
  assert.equal(
    validate({ ...minimal(), metadata: { authors: [{ email: 'bad@@example.test' }] } }).valid,
    false,
  );
  assert.equal(
    validate({
      ...minimal(),
      externalReferences: [{ type: 'website', url: 'https://例子.测试/路径' }],
    }).valid,
    true,
  );
  assert.equal(
    validate({
      ...minimal(),
      externalReferences: [{ type: 'website', url: 'https://bad host/path' }],
    }).valid,
    false,
  );
});

test('IRI syntax accepts absolute, relative, Unicode, percent-encoded, and IP references', () => {
  for (const value of [
    '',
    '#fragment',
    '../路径?q=值#片段',
    'https://例子.测试/路径',
    'https://user:pass@example.test:443/a%20b',
    '//example.test/path',
    'urn:example:sample',
    'https://[2001:db8::1]:443/a',
    'https://[v1.a:b]/',
    '?query=\ue000',
    '/path/\u{10000}',
  ])
    assert.equal(isIriReference(value), true, value);
});

test('IRI syntax rejects malformed escapes, whitespace, authority, and forbidden code points', () => {
  for (const value of [
    'http://bad host',
    'http://x/%GG',
    'http://x/%',
    'http://x/\\x',
    'http://[not-ip]/',
    'http://[2001:db8::1',
    'http://x:port/',
    '1bad:relative',
    'http://a@b@c/',
    'http://x/#a#b',
    'http://x/\ue000',
    'http://x/\ud800',
    'x\n',
    'http://x/\u{1ffff}',
  ])
    assert.equal(isIriReference(value), false, JSON.stringify(value));
});

test('international mailbox syntax accepts IDNA, UTF8 local parts, quotes, and address literals', () => {
  for (const value of [
    'a@example.test',
    '用户@例子.测试',
    'user@xn--fsqu00a.xn--0zwm56d',
    '"a b"@example.test',
    '"a@b"@example.test',
    'a+b@example.test',
    'a@[192.0.2.1]',
    'a@[IPv6:2001:db8::1]',
    'a@localhost',
  ])
    assert.equal(isIdnEmail(value), true, value);
});

test('international mailbox syntax rejects malformed local parts, domains, and lengths', () => {
  for (const value of [
    '',
    'a',
    '@example.test',
    'a@@example.test',
    'a..b@example.test',
    '.a@example.test',
    'a.@example.test',
    'a b@example.test',
    'a@bad_domain.test',
    'a@-bad.test',
    'a@example.test/evil',
    'a@example.test%20',
    'a@[999.0.0.1]',
    'a@[IPv6:bad]',
    '"unterminated@example.test',
    'a\n@example.test',
    'a@\ud800.test',
    'a'.repeat(65) + '@example.test',
    'a@' + 'b'.repeat(64) + '.test',
  ])
    assert.equal(isIdnEmail(value), false, JSON.stringify(value));
});

test('missing external schema file fails closed', () => {
  const options = modifiedSchemas('missing-file', (_schema, directory) =>
    unlinkSync(join(directory, 'jsf-0.82.schema.json')),
  );
  assert.throws(() => createCycloneDxValidator(options), /ENOENT/);
});

test('unknown local and remote references fail before any network fallback', () => {
  for (const [name, ref] of [
    ['missing-ref', 'missing.schema.json'],
    ['remote-ref', 'https://example.invalid/remote.schema.json'],
  ]) {
    const options = modifiedSchemas(name, (schema) => {
      schema.definitions.unused = { $ref: ref };
    });
    assert.throws(() => createCycloneDxValidator(options), /Unresolved offline schema reference/);
  }
});

test('missing JSON Pointer reference fails closed', () => {
  const options = modifiedSchemas('missing-pointer', (schema) => {
    schema.properties.metadata = { $ref: 'spdx.schema.json#/definitions/does-not-exist' };
  });
  assert.throws(() => createCycloneDxValidator(options), /reference|resolve|schema/i);
});

test('unknown format in an unused definition fails closed', () => {
  const options = modifiedSchemas('unknown-format', (schema) => {
    schema.definitions.unused = { type: 'string', format: 'made-up-format' };
  });
  assert.throws(() => createCycloneDxValidator(options), /Unknown schema format|unknown format/i);
});

test('invalid schema and wrong schema identity fail closed', () => {
  const invalid = modifiedSchemas('invalid-schema', (schema) => {
    schema.properties.version.type = 'not-a-type';
  });
  assert.throws(() => createCycloneDxValidator(invalid), /schema is invalid|must be equal/i);
  const identity = modifiedSchemas('wrong-identity', (schema) => {
    schema.$id = 'https://example.invalid/other';
  });
  assert.throws(() => createCycloneDxValidator(identity), /Unexpected schema identity/);
});

test('CLI usage and help have explicit exit status', () => {
  const messages = [];
  const io = { out: (value) => messages.push(value), err: (value) => messages.push(value) };
  assert.equal(runCli([], io), 2);
  assert.equal(runCli(['--unknown'], io), 2);
  assert.equal(runCli(['--help'], io), 0);
  assert.match(messages.join('\n'), /does not certify inventory or license completeness/);
});

test('CLI accepts multiple files and fails with precise document positions and unreadable JSON', () => {
  const valid = join(temporaryRoot, 'valid.cdx.json');
  const invalid = join(temporaryRoot, 'invalid.cdx.json');
  const malformed = join(temporaryRoot, 'malformed.cdx.json');
  writeFileSync(valid, JSON.stringify(minimal()));
  writeFileSync(invalid, JSON.stringify({ ...minimal(), components: [{ type: 'library' }] }));
  writeFileSync(malformed, '{');
  const executable = fileURLToPath(new URL('./validate-cyclonedx.mjs', import.meta.url));
  const result = spawnSync(
    process.execPath,
    [executable, valid, invalid, malformed, join(temporaryRoot, 'missing.json')],
    { encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /PASS .*valid.cdx.json/);
  assert.match(result.stderr, /invalid.cdx.json#\/components\/0\/name/);
  assert.match(result.stderr, /FAIL .*malformed.cdx.json/);
  assert.match(result.stderr, /ENOENT/);
  assert.match(result.stdout, /license completeness require separate evidence/);
});
