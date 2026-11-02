import { describe, expect, it } from 'vitest';
import {
  agentProjectAllowed,
  agentRoleAllowed,
  assertPrincipalShape,
  containsForbiddenAgentScope,
  hasScope,
  principalScopeKey,
  type Principal,
  validateScopeSet,
} from './auth';

const human: Principal = { kind: 'HUMAN', userId: 'u-1', scopes: [] };
const agent: Principal = {
  kind: 'AGENT',
  userId: 'u-1',
  agentCredentialId: 'c-1',
  projectId: 'p-1',
  roleIds: ['r-product'],
  scopes: ['knowledge:read', 'knowledge:propose'],
};

describe('scope registry', () => {
  it('rejects wildcard, unknown, duplicate and empty scope sets', () => {
    expect(validateScopeSet(['project:read']).ok).toBe(true);
    expect(validateScopeSet([])).toEqual({ ok: false, reason: 'EMPTY' });
    expect(validateScopeSet(['*'])).toEqual({ ok: false, reason: 'WILDCARD' });
    expect(validateScopeSet(['project:*'])).toEqual({ ok: false, reason: 'WILDCARD' });
    expect(validateScopeSet(['knowledge:publish'])).toEqual({ ok: false, reason: 'UNKNOWN_SCOPE' });
    expect(validateScopeSet(['task:read', 'task:read'])).toEqual({
      ok: false,
      reason: 'DUPLICATE',
    });
    expect(validateScopeSet(['knowledge:READ'])).toEqual({ ok: false, reason: 'UNKNOWN_SCOPE' });
  });

  it('detects capabilities an agent must never receive', () => {
    expect(containsForbiddenAgentScope(['knowledge:read'])).toBe(false);
    expect(containsForbiddenAgentScope(['knowledge:publish'])).toBe(true);
    expect(containsForbiddenAgentScope(['workflow:publish'])).toBe(true);
    expect(containsForbiddenAgentScope(['review:approve'])).toBe(true);
    expect(containsForbiddenAgentScope(['publish'])).toBe(true);
  });
});

describe('principal shape', () => {
  it('rejects HUMAN carrying an agent credential', () => {
    expect(() => assertPrincipalShape({ ...human, agentCredentialId: 'c-9' })).toThrow(
      /agentCredentialId/,
    );
  });

  it('requires credential, project and exactly one role for AGENT', () => {
    expect(() => assertPrincipalShape({ kind: 'AGENT', userId: 'u-1', scopes: [] })).toThrow(
      /agentCredentialId/,
    );
    expect(() =>
      assertPrincipalShape({ kind: 'AGENT', userId: 'u-1', agentCredentialId: 'c-1', scopes: [] }),
    ).toThrow(/projectId/);
    expect(() =>
      assertPrincipalShape({
        kind: 'AGENT',
        userId: 'u-1',
        agentCredentialId: 'c-1',
        projectId: 'p-1',
        roleIds: ['r-a', 'r-b'],
        scopes: [],
      }),
    ).toThrow(/exactly one roleId/);
  });

  it('derives distinct idempotency principal keys for HUMAN and AGENT', () => {
    expect(principalScopeKey(human)).toBe('user:u-1');
    expect(principalScopeKey(agent)).toBe('agent:c-1');
    expect(principalScopeKey({ ...agent, agentCredentialId: 'c-2' })).toBe('agent:c-2');
  });
});

describe('agent project and role boundary', () => {
  it('never allows a cross-project agent, even for the same role', () => {
    expect(agentProjectAllowed(agent, 'p-1')).toBe(true);
    expect(agentProjectAllowed(agent, 'p-2')).toBe(false);
    expect(agentProjectAllowed(human, 'p-2')).toBe(true);
  });

  it('never allows an agent to act through another business role', () => {
    expect(agentRoleAllowed(agent, 'r-product')).toBe(true);
    expect(agentRoleAllowed(agent, 'r-backend')).toBe(false);
    expect(agentRoleAllowed(agent, null)).toBe(false);
    expect(agentRoleAllowed(human, 'r-backend')).toBe(true);
  });

  it('checks scope presence without treating it as the whole authorization', () => {
    expect(hasScope(agent, 'knowledge:propose')).toBe(true);
    expect(hasScope(agent, 'task:deliver')).toBe(false);
  });
});
