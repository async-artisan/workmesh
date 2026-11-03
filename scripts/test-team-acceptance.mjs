#!/usr/bin/env node
/**
 * Real deployment acceptance for the account -> project -> invitation -> team flow.
 * Uses only the public /api/v1 routes. Credentials and IDs are written to the
 * ignored .tmp/team-acceptance-<date>-<run>/team-state.json fixture for the UI pass.
 * Invitation tokens are intentionally never printed or persisted.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.env.WORKMESH_ACCEPTANCE_BASE ?? 'http://127.0.0.1:5180').replace(/\/$/, '');
const api = `${base}/api/v1`;
const origin = process.env.WORKMESH_ACCEPTANCE_ORIGIN ?? base;
const stamp = `${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Date.now().toString(36)}`;
const outDir = resolve(
  root,
  process.env.WORKMESH_ACCEPTANCE_OUTPUT_DIR ?? `.tmp/team-acceptance-${stamp}`,
);
const statePath = resolve(outDir, 'team-state.json');
const testPassword = process.env.WORKMESH_ACCEPTANCE_PASSWORD ?? 'Wm-Team-2026!';
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const projectKey = `TEAM${letters[randomInt(letters.length)]}${letters[randomInt(letters.length)]}`;

function safeFailure(label, status, payload) {
  const error = payload?.error ?? payload;
  const code = typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED';
  const requestId = typeof error?.requestId === 'string' ? error.requestId : undefined;
  throw new Error(
    `${label} -> HTTP ${status} ${code}${requestId ? ` (request ${requestId})` : ''}`,
  );
}

function client(label) {
  const jar = new Map();
  async function call(method, path, body, idempotencyKey) {
    const headers = { Accept: 'application/json', Origin: origin };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    const csrf = [...jar].find(([name]) => name.endsWith('wm_csrf'))?.[1];
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const response = await fetch(`${api}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const entry of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...attributes] = entry.split(';');
      const equals = pair.indexOf('=');
      const name = pair.slice(0, equals).trim();
      const value = pair.slice(equals + 1);
      if (!value || attributes.some((item) => /^\s*max-age=0\s*$/i.test(item))) jar.delete(name);
      else jar.set(name, value);
    }
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { error: { code: 'NON_JSON_RESPONSE' } };
    }
    if (!response.ok) safeFailure(`${label} ${method} ${path}`, response.status, payload);
    return payload?.data ?? payload;
  }
  return {
    call,
    async bootstrap() {
      return call('GET', '/auth/session');
    },
  };
}

async function writeState(state) {
  await mkdir(outDir, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function emailFor(role) {
  return `${role}-${stamp}@workmesh.local`;
}

async function ticketFor(owner, project, roleIds, inviteEmail) {
  const binding = {
    action: 'PROJECT_INVITATION_CREATE',
    projectId: project.id,
    targetType: 'PROJECT_INVITATION',
    targetId: project.id,
    expectedVersion: project.version,
    roleSlot: null,
    payload: {
      roleIds: [...roleIds].sort(),
      email: inviteEmail.toLowerCase(),
      expiresInHours: 72,
    },
  };
  const preview = await owner.call('POST', '/auth/action-previews', binding);
  return owner.call('POST', '/auth/confirmation-tickets', {
    ...binding,
    actionDigest: preview.actionDigest,
    password: testPassword,
  });
}

async function currentProject(owner, projectId) {
  const projects = await owner.call('GET', '/projects');
  const project = projects.find((item) => item.id === projectId);
  if (!project) throw new Error('owner cannot see the acceptance project');
  return project;
}

const state = {
  generatedAt: new Date().toISOString(),
  baseUrl: base,
  accounts: {},
  project: null,
  memberships: [],
  completed: [],
};

process.stdout.write(`Team acceptance against ${api}\n`);
const ownerClient = client('owner');
await ownerClient.bootstrap();
const owner = {
  email: emailFor('owner'),
  password: testPassword,
  name: 'Team Acceptance Owner',
};
await ownerClient.call('POST', '/auth/register', owner);
const ownerSession = await ownerClient.call('GET', '/auth/session');
if (!ownerSession?.user?.id) throw new Error('owner registration completed without a user session');
state.accounts.owner = { ...owner, id: ownerSession.user.id };
state.completed.push('owner registration and authenticated session');
await writeState(state);
process.stdout.write('  ok  owner account registered\n');

const project = await ownerClient.call('POST', '/projects', {
  name: `Team Acceptance ${stamp}`,
  key: projectKey,
  description: 'Isolated real-deployment team acceptance fixture.',
});
state.project = { id: project.id, key: project.key, name: project.name, version: project.version };
state.completed.push('project creation with seeded project roles');
await writeState(state);
process.stdout.write(`  ok  project ${project.key} created\n`);

const roles = await ownerClient.call('GET', `/projects/${project.id}/roles`);
const roleByKey = new Map(roles.filter((role) => role.isActive).map((role) => [role.key, role]));
const invitePlans = [
  { role: 'dev', name: 'Team Acceptance Developer', roleKey: 'frontend' },
  { role: 'reviewer', name: 'Team Acceptance Reviewer', roleKey: 'qa' },
];
for (const plan of invitePlans) {
  const projectNow = await currentProject(ownerClient, project.id);
  const role = roleByKey.get(plan.roleKey);
  if (!role) throw new Error(`required active role is missing: ${plan.roleKey}`);
  const inviteEmail = emailFor(plan.role);
  const ticket = await ticketFor(ownerClient, projectNow, [role.id], inviteEmail);
  const invitation = await ownerClient.call(
    'POST',
    `/projects/${project.id}/invitations`,
    {
      roleKeys: [plan.roleKey],
      email: inviteEmail,
      expiresInHours: 72,
      expectedVersion: projectNow.version,
      confirmation: { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret },
    },
    randomUUID(),
  );
  if (typeof invitation.token !== 'string' || !invitation.token.startsWith('wmi_'))
    throw new Error(`${plan.role} invitation was created without a usable invitation link`);

  const inviteeClient = client(plan.role);
  await inviteeClient.bootstrap();
  const resolved = await inviteeClient.call('GET', `/invitations/${invitation.token}`);
  if (resolved.status !== 'PENDING' || !resolved.roles?.some((item) => item.key === plan.roleKey))
    throw new Error(`${plan.role} invitation resolved with unexpected status or roles`);
  const joined = await inviteeClient.call('POST', `/invitations/${invitation.token}/accept`, {
    email: inviteEmail,
    password: testPassword,
    name: plan.name,
  });
  if (
    joined.invitation?.projectId !== project.id ||
    !joined.invitation.roleKeys?.includes(plan.roleKey)
  )
    throw new Error(`${plan.role} invitation was accepted without the expected project role`);
  const projects = await inviteeClient.call('GET', '/projects');
  if (!projects.some((item) => item.id === project.id))
    throw new Error(`${plan.role} account does not see the joined project`);

  state.accounts[plan.role] = { email: inviteEmail, password: testPassword, name: plan.name };
  state.memberships.push({ account: plan.role, projectId: project.id, roleKey: plan.roleKey });
  state.completed.push(`${plan.role} invitation resolved, accepted, and project access verified`);
  state.project.version = (await currentProject(ownerClient, project.id)).version;
  await writeState(state);
  process.stdout.write(`  ok  ${plan.role} joined project as ${plan.roleKey}\n`);
}

const members = await ownerClient.call('GET', `/projects/${project.id}/members`);
for (const membership of state.memberships) {
  const account = state.accounts[membership.account];
  const member = members.find((item) => item.email === account.email);
  if (!member?.roles?.some((role) => role.key === membership.roleKey))
    throw new Error(
      `owner view does not show ${membership.account} assigned ${membership.roleKey}`,
    );
}
state.completed.push('owner member list confirms both role assignments');
state.project.version = (await currentProject(ownerClient, project.id)).version;
await writeState(state);
process.stdout.write('  ok  owner sees both members with assigned roles\n');
process.stdout.write(`RESULT: team acceptance ready; fixture ${statePath}\n`);
