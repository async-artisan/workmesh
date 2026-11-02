import { describe, expect, it } from 'vitest';
import { assertHumanCredential, classifyCredential } from './v1-credential-policy';

describe('v1 credential classification', () => {
  it('rejects mixed bearer and session credentials', () => {
    expect(classifyCredential({ authorization: 'Bearer agent', sessionCookie: 'wm_s1.x' })).toBe('CONFLICT');
    expect(() => assertHumanCredential({ authorization: 'Bearer agent', sessionCookie: 'wm_s1.x' })).toThrow('CREDENTIAL_CONFLICT');
  });

  it('does not treat an agent bearer as a human session', () => {
    expect(classifyCredential({ authorization: 'Bearer agent' })).toBe('AGENT_BEARER');
    expect(() => assertHumanCredential({ authorization: 'Bearer agent' })).toThrow('HUMAN_SESSION_REQUIRED');
  });
});
