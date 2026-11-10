#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { domainToASCII, fileURLToPath, pathToFileURL } from 'node:url';

const sharedRequire = createRequire(new URL('../packages/shared/package.json', import.meta.url));
const Ajv = sharedRequire('ajv');
const addFormats = sharedRequire('ajv-formats');
export const SCHEMA_FILES = Object.freeze([
  'bom-1.7.schema.json',
  'spdx.schema.json',
  'jsf-0.82.schema.json',
  'cryptography-defs.schema.json',
]);
export const SCHEMA_DIRECTORY = fileURLToPath(new URL('./vendor/cyclonedx-1.7/', import.meta.url));
const ROOT_SCHEMA = 'http://cyclonedx.org/schema/bom-1.7.schema.json';
const DRAFT_07 = 'http://json-schema.org/draft-07/schema#';

// RFC 3987 sections 2.2 and 2.3: keep private characters confined to the query.
const UCS =
  '\\u00a0-\\ud7ff\\uf900-\\ufdcf\\ufdf0-\\uffef' +
  '\\u{10000}-\\u{1fffd}\\u{20000}-\\u{2fffd}\\u{30000}-\\u{3fffd}' +
  '\\u{40000}-\\u{4fffd}\\u{50000}-\\u{5fffd}\\u{60000}-\\u{6fffd}' +
  '\\u{70000}-\\u{7fffd}\\u{80000}-\\u{8fffd}\\u{90000}-\\u{9fffd}' +
  '\\u{a0000}-\\u{afffd}\\u{b0000}-\\u{bfffd}\\u{c0000}-\\u{cfffd}' +
  '\\u{d0000}-\\u{dfffd}\\u{e1000}-\\u{efffd}';
const PRIVATE = '\\ue000-\\uf8ff\\u{f0000}-\\u{ffffd}\\u{100000}-\\u{10fffd}';
const UNRESERVED = `[A-Za-z0-9._~\\-${UCS}]`;
const SUBDELIMS = "[!$&'()*+,;=]";
const PERCENT = '%[0-9A-Fa-f]{2}';
const PCHAR = `(?:${UNRESERVED}|${SUBDELIMS}|${PERCENT}|[:@])`;
const PATH = new RegExp(`^(?:${PCHAR}|/)*$`, 'u');
const QUERY = new RegExp(`^(?:${PCHAR}|[/?${PRIVATE}])*$`, 'u');
const FRAGMENT = new RegExp(`^(?:${PCHAR}|[/?])*$`, 'u');
const USERINFO = new RegExp(`^(?:${UNRESERVED}|${SUBDELIMS}|${PERCENT}|:)*$`, 'u');
const REGNAME = new RegExp(`^(?:${UNRESERVED}|${SUBDELIMS}|${PERCENT})*$`, 'u');

function validAuthority(authority) {
  const at = authority.lastIndexOf('@');
  if (at !== -1 && !USERINFO.test(authority.slice(0, at))) return false;
  const hostPort = authority.slice(at + 1);
  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']');
    if (end === -1 || !/^(?::[0-9]*)?$/.test(hostPort.slice(end + 1))) return false;
    const literal = hostPort.slice(1, end);
    return isIP(literal) === 6 || /^v[0-9a-f]+\.[A-Za-z0-9._~!$&'()*+,;=:-]+$/i.test(literal);
  }
  const colon = hostPort.lastIndexOf(':');
  if (colon === -1) return REGNAME.test(hostPort);
  return REGNAME.test(hostPort.slice(0, colon)) && /^[0-9]*$/.test(hostPort.slice(colon + 1));
}

export function isIriReference(value) {
  if (
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return code <= 32 || (code >= 127 && code <= 159);
    })
  )
    return false;
  let rest = value;
  const fragment = rest.indexOf('#');
  if (fragment !== -1) {
    if (!FRAGMENT.test(rest.slice(fragment + 1))) return false;
    rest = rest.slice(0, fragment);
  }
  const query = rest.indexOf('?');
  if (query !== -1) {
    if (!QUERY.test(rest.slice(query + 1))) return false;
    rest = rest.slice(0, query);
  }
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(rest);
  if (scheme) rest = rest.slice(scheme[0].length);
  if (rest.startsWith('//')) {
    const slash = rest.indexOf('/', 2);
    return (
      validAuthority(rest.slice(2, slash === -1 ? undefined : slash)) &&
      (slash === -1 || PATH.test(rest.slice(slash)))
    );
  }
  if (!PATH.test(rest)) return false;
  // Relative path-noscheme may not have a colon in its first segment.
  return Boolean(scheme) || rest.startsWith('/') || !rest.split('/', 1)[0].includes(':');
}

// RFC 6531 mailbox: SMTPUTF8 local-part, IDNA domain, or an IPv4/IPv6 address literal.
export function isIdnEmail(value) {
  const at = value.lastIndexOf('@');
  if (at < 1) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (
    Buffer.byteLength(local, 'utf8') > 64 ||
    /[\uD800-\uDFFF]/u.test(value) ||
    [...local].some(
      (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
    )
  )
    return false;
  const nonAscii = '\\u0080-\\u{10ffff}';
  const atom = `[A-Za-z0-9!#$%&'*+/=?^_\\x60{|}~\\-${nonAscii}]+`;
  const dotAtom = new RegExp(`^${atom}(?:\\.${atom})*$`, 'u');
  const quoted = new RegExp(
    `^"(?:[\\x20-\\x21\\x23-\\x5b\\x5d-\\x7e${nonAscii}]|\\\\[\\x20-\\x7e${nonAscii}])*"$`,
    'u',
  );
  if (!dotAtom.test(local) && !quoted.test(local)) return false;
  if (domain.startsWith('[') && domain.endsWith(']')) {
    const address = domain.slice(1, -1);
    return /^IPv6:/i.test(address) ? isIP(address.slice(5)) === 6 : isIP(address) === 4;
  }
  // Reject delimiters before URL/IDNA conversion, which otherwise normalizes them.
  if (/[\s/@:[\]\\?#%]/u.test(domain)) return false;
  const ascii = domainToASCII(domain);
  if (!ascii || ascii.length > 253 || Buffer.byteLength(local) + ascii.length + 1 > 254)
    return false;
  return ascii
    .split('.')
    .every(
      (label) => label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
    );
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}

/** Compile only local, explicit resources. No async loader or network access is configured. */
export function createCycloneDxValidator({ schemaDirectory = SCHEMA_DIRECTORY } = {}) {
  const resources = SCHEMA_FILES.map((name) => {
    const schema = JSON.parse(readFileSync(resolve(schemaDirectory, name), 'utf8'));
    if (schema.$schema !== DRAFT_07 || schema.$id !== `http://cyclonedx.org/schema/${name}`)
      throw new Error(`Unexpected schema identity or draft in ${name}`);
    return schema;
  });
  const ids = new Set(resources.map((schema) => schema.$id));
  for (const schema of resources)
    walk(schema, (node) => {
      if (typeof node.$ref !== 'string') return;
      const target = new URL(node.$ref, schema.$id);
      target.hash = '';
      if (!ids.has(target.href))
        throw new Error(`Unresolved offline schema reference: ${node.$ref} in ${schema.$id}`);
    });
  const ajv = new Ajv({
    strictSchema: true,
    strictTypes: false,
    strictTuples: false,
    strictRequired: false,
    allErrors: true,
    validateFormats: true,
    validateSchema: true,
    inlineRefs: false,
  });
  addFormats(ajv, { mode: 'full' });
  ajv.addFormat('iri-reference', { type: 'string', validate: isIriReference });
  ajv.addFormat('idn-email', { type: 'string', validate: isIdnEmail });
  // The official schema uses this annotation to describe enum values; enum still validates.
  ajv.addKeyword({ keyword: 'meta:enum', schemaType: 'object', valid: true });
  for (const schema of resources) ajv.addSchema(schema);
  for (const schema of resources)
    walk(schema, (node) => {
      if (typeof node.format === 'string' && !ajv.formats[node.format])
        throw new Error(`Unknown schema format: ${node.format} in ${schema.$id}`);
      if (typeof node.$ref === 'string' && !ajv.getSchema(new URL(node.$ref, schema.$id).href))
        throw new Error(`Unresolved offline schema reference: ${node.$ref} in ${schema.$id}`);
    });
  // Compile every resource, including definitions not reached by a particular BOM.
  for (const schema of resources) ajv.getSchema(schema.$id);
  const validate = ajv.getSchema(ROOT_SCHEMA);
  if (!validate) throw new Error('CycloneDX 1.7 schema did not compile');
  return (document) => {
    const errors = [];
    if (document?.specVersion !== '1.7')
      errors.push({
        instancePath: '/specVersion',
        message: 'must equal 1.7; this validator supports only CycloneDX 1.7',
      });
    if (
      document?.$schema !== undefined &&
      ![ROOT_SCHEMA, ROOT_SCHEMA.replace('http:', 'https:')].includes(document.$schema)
    )
      errors.push({
        instancePath: '/$schema',
        message: 'must identify the CycloneDX 1.7 JSON schema',
      });
    if (!validate(document)) errors.push(...globalThis.structuredClone(validate.errors));
    return { valid: errors.length === 0, errors };
  };
}

function errorPointer(error) {
  const property = error.params?.missingProperty ?? error.params?.additionalProperty;
  return (
    (error.instancePath || '') +
    (property === undefined
      ? ''
      : '/' + String(property).replaceAll('~', '~0').replaceAll('/', '~1'))
  );
}

export function runCli(args, { out = console.log, err = console.error } = {}) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    out('Usage: node scripts/validate-cyclonedx.mjs <bom.cdx.json> [more.cdx.json ...]');
    out(
      'Offline CycloneDX 1.7 structure and format validation; does not certify inventory or license completeness.',
    );
    return 0;
  }
  if (args.length === 0 || args.some((arg) => arg.startsWith('-'))) {
    err('Usage: node scripts/validate-cyclonedx.mjs <bom.cdx.json> [more.cdx.json ...]');
    return 2;
  }
  let validate;
  try {
    validate = createCycloneDxValidator();
  } catch (error) {
    err(`Schema setup failed (offline, no fallback): ${error.message}`);
    return 2;
  }
  let failed = false;
  for (const name of args) {
    try {
      const document = JSON.parse(readFileSync(name, 'utf8').replace(/^\uFEFF/, ''));
      const result = validate(document);
      if (result.valid) out(`PASS ${name}: CycloneDX 1.7 schema and formats`);
      else {
        failed = true;
        err(`FAIL ${name}: ${result.errors.length} schema/format error(s)`);
        for (const error of result.errors.slice(0, 100))
          err(
            `  ${name}#${errorPointer(error)}: ${error.message}${error.schemaPath ? ` (${error.schemaPath})` : ''}`,
          );
        if (result.errors.length > 100)
          err(`  ${result.errors.length - 100} further errors omitted`);
      }
    } catch (error) {
      failed = true;
      err(`FAIL ${name}: ${error.message}`);
    }
  }
  out(
    'Scope: JSON schema and format conformance only; component coverage, provenance, and license completeness require separate evidence.',
  );
  return failed ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = runCli(process.argv.slice(2));
