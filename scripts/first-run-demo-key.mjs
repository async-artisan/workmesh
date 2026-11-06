import { randomInt, randomUUID } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const KEY_LENGTH = 6;

/**
 * Generate a project key accepted by CreateProjectDto (2-6 uppercase letters).
 *
 * A previous implementation derived a three-letter suffix from Date.now() % 676,
 * so every 676 ms it could produce the same key. The first-run path is often
 * repeated while troubleshooting, therefore use independent cryptographic
 * randomness for all six characters instead of a clock-derived value.
 */
export function createFirstRunProjectKey(random = randomInt) {
  let key = '';
  for (let index = 0; index < KEY_LENGTH; index += 1) {
    key += ALPHABET[random(ALPHABET.length)];
  }
  return key;
}

/** Create run-specific values that remain distinct when demos start together. */
export function createFirstRunIdentity({
  uuid = randomUUID,
  projectKey = createFirstRunProjectKey,
} = {}) {
  const runId = uuid();
  return {
    runId,
    email: `demo-${runId}@workmesh.local`,
    projectKey: projectKey(),
  };
}
