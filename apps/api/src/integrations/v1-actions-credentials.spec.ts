import { describe, expect, it } from 'vitest';
import { resolveActionsCredential } from './v1-actions-credentials';

const identity = { projectId: 'p1', projectRepositoryId: 'r1', providerRepositoryId: '73' };
const variable = 'WORKMESH_GITHUB_ACTIONS_TOKEN_FIXTURE';
const binding = { ...identity, tokenEnvironmentVariable: variable };
const configured = (entries: unknown = [binding]) => ({
  WORKMESH_GITHUB_ACTIONS_CREDENTIALS_JSON: JSON.stringify(entries),
  [variable]: 'fixture-read-token',
});

describe('project isolated Actions credentials', () => {
  it('requires an exact project, registration and provider identity', () => {
    expect(resolveActionsCredential(identity, configured())).toBe('fixture-read-token');
    for (const key of ['projectId', 'projectRepositoryId', 'providerRepositoryId'] as const)
      expect(() => resolveActionsCredential({ ...identity, [key]: 'other' }, configured())).toThrow(
        'ACTIONS_READ_CREDENTIAL_UNAVAILABLE',
      );
  });
  it('rejects fallback tokens, ambiguous configuration and client secret fields', () => {
    expect(() => resolveActionsCredential(identity, { GITHUB_TOKEN: 'fixture' })).toThrow();
    for (const input of [[binding, binding], [{ ...binding, token: 'fixture' }], {}])
      expect(() => resolveActionsCredential(identity, configured(input))).toThrow();
    expect(() =>
      resolveActionsCredential(identity, configured([{ ...binding, tokenEnvironmentVariable: 'PATH' }])),
    ).toThrow();
  });
  it('does not disclose the secret or raw configuration on failure', () => {
    try {
      resolveActionsCredential(identity, { ...configured(), [variable]: 'private\nvalue' });
      expect.fail('must reject a multiline token');
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('private');
      expect(String(error)).not.toContain(variable);
    }
  });
});
