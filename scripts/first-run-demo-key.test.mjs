import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirstRunIdentity, createFirstRunProjectKey } from './first-run-demo-key.mjs';

test('first-run project keys satisfy the API format', () => {
  const key = createFirstRunProjectKey(() => 0);
  assert.equal(key, 'AAAAAA');
  assert.match(key, /^[A-Z]{2,6}$/);
});

test('first-run project key generation does not depend on the wall clock', () => {
  let next = 0;
  const key = createFirstRunProjectKey(() => next++);
  assert.equal(key, 'ABCDEF');
  assert.match(key, /^[A-Z]{6}$/);
});

test('consecutive first-run identities use distinct emails even within one millisecond', () => {
  let nextId = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`;
  const first = createFirstRunIdentity({ uuid, projectKey: () => 'AAAAAA' });
  const second = createFirstRunIdentity({ uuid, projectKey: () => 'BBBBBB' });

  assert.notEqual(first.email, second.email);
  assert.match(first.email, /^demo-[0-9a-f-]{36}@workmesh\.local$/);
  assert.match(second.email, /^demo-[0-9a-f-]{36}@workmesh\.local$/);
});
