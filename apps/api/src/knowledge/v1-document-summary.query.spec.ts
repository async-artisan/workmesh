import { describe, expect, it } from 'vitest';
import type { Principal } from '@workmesh/shared';
import type { V1KnowledgeAccess } from '../auth/v1-authorization';
import {
  decodeSummaryCursor,
  encodeSummaryCursor,
  normalizeSummaryQuery,
  summaryCountSql,
  summaryId,
  summaryOverviewSql,
  summaryPageSql,
  summaryQueryKey,
  summarySingletonSql,
  type SummaryContext,
} from './v1-document-summary.query';

const PROJECT = '10000000-0000-4000-8000-000000000001';
const DOCUMENT = '20000000-0000-4000-8000-000000000001';
const USER = '30000000-0000-4000-8000-000000000001';
const BASE = '40000000-0000-4000-8000-000000000001';

function context(): SummaryContext {
  const principal: Principal = { kind: 'HUMAN', userId: USER, scopes: [] };
  const access: V1KnowledgeAccess = {
    knowledgeBase: {
      id: BASE,
      projectId: PROJECT,
      visibility: 'PROJECT',
      version: 1,
      authzVersion: 3,
      publicationApproverUserId: USER,
      publicationApproverRoleId: null,
      archivedAt: null,
    },
    projectId: PROJECT,
    permissions: ['READ'],
    isActiveMember: true,
    canRead: true,
    canPropose: false,
    canPublish: false,
    canRevoke: false,
  };
  return {
    projectId: PROJECT,
    principal,
    project: {
      project: { id: PROJECT, version: 1, archivedAt: null },
      membership: { projectId: PROJECT, userId: USER, role: 'MEMBER', version: 1, revokedAt: null },
      activeRoleIds: ['role-a', 'role-b'],
      selectableRoleIds: ['role-a', 'role-b'],
    },
    knowledgeBases: [{ id: BASE, name: 'Base', kind: 'BUSINESS', access }],
    canReadRequirement: true,
  };
}

describe('document summary query and cursor contract', () => {
  it('normalizes all defaults, PRD scope, case/spacing and bounded page size', () => {
    expect(normalizeSummaryQuery({})).toEqual({
      kind: null,
      knowledgeBaseKind: null,
      requirementId: null,
      status: 'all',
      q: '',
      searchProfile: 'knowledge',
      limit: 50,
      cursor: null,
    });
    expect(
      normalizeSummaryQuery({
        searchProfile: 'prd',
        q: '  V1 %_  ',
        limit: 999,
        requirementId: DOCUMENT.toUpperCase(),
      }),
    ).toMatchObject({ kind: 'PRD', q: 'v1 %_', limit: 100, requirementId: DOCUMENT });
    expect(summaryId(DOCUMENT.toUpperCase())).toBe(DOCUMENT);
  });

  it.each([
    { kind: 'UNKNOWN' },
    { knowledgeBaseKind: 'PRIVATE' },
    { status: '' },
    { searchProfile: 'other' },
    { searchProfile: 'prd', kind: 'KNOWLEDGE' },
    { q: ['a', 'b'] },
    { q: null },
    { limit: [1] },
    { limit: 0 },
    { limit: 1.5 },
    { limit: NaN },
    { limit: Infinity },
    { limit: '7' },
    { q: 'x'.repeat(101) },
    { q: 'bad\u0000text' },
    { requirementId: 'not-uuid' },
    { cursor: '' },
    { cursor: [] },
    { cursor: 'a'.repeat(2049) },
    { unknown: 'field' },
  ])('rejects malformed input before it reaches SQL: %j', (query) => {
    expect(() => normalizeSummaryQuery(query as never)).toThrowError(/DOCUMENT_SUMMARY_/);
  });

  it('strictly decodes only canonical, exact-field, current-query cursors', () => {
    const binding = summaryQueryKey(context(), normalizeSummaryQuery({}));
    const boundary = { updatedAt: '2026-11-10T12:00:00.000Z', id: DOCUMENT };
    const encoded = encodeSummaryCursor(binding, boundary);
    expect(decodeSummaryCursor(encoded, binding)).toEqual(boundary);
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    for (const raw of [
      JSON.stringify({ ...JSON.parse(decoded), extra: true }),
      decoded.replace('"v":1', '"v":2,"v":1'),
      JSON.stringify({ ...JSON.parse(decoded), updatedAt: '2026-11-10' }),
      JSON.stringify({ ...JSON.parse(decoded), updatedAt: '-200000-01-01T00:00:00.000Z' }),
      JSON.stringify({ ...JSON.parse(decoded), updatedAt: '0000-01-01T00:00:00.000Z' }),
      JSON.stringify({ ...JSON.parse(decoded), updatedAt: '+010000-01-01T00:00:00.000Z' }),
      JSON.stringify({ ...JSON.parse(decoded), id: 'other' }),
      JSON.stringify({ ...JSON.parse(decoded), key: 'other' }),
      '[]',
      '{}',
      'null',
    ])
      expect(() =>
        decodeSummaryCursor(Buffer.from(raw).toString('base64url'), binding),
      ).toThrowError('DOCUMENT_SUMMARY_CURSOR_INVALID');
    for (const raw of [encoded + '=', 'a+', 'e30', '____'])
      expect(() => decodeSummaryCursor(raw, binding)).toThrowError(
        'DOCUMENT_SUMMARY_CURSOR_INVALID',
      );
  });

  it('binds every filter, page size, identity, active role, requirement ability and each KB capability', () => {
    const query = normalizeSummaryQuery({});
    const original = summaryQueryKey(context(), query);
    const mutations: Array<(value: SummaryContext) => void> = [
      (value) => {
        value.projectId = DOCUMENT;
      },
      (value) => {
        value.principal.userId = DOCUMENT;
      },
      (value) => {
        value.principal.agentCredentialId = 'new-credential';
      },
      (value) => {
        value.principal.roleIds = ['new-role'];
      },
      (value) => {
        value.principal.scopes = ['knowledge:read'];
      },
      (value) => {
        value.project.activeRoleIds = ['role-a'];
      },
      (value) => {
        value.project.membership.version += 1;
      },
      (value) => {
        value.canReadRequirement = false;
      },
      (value) => {
        value.knowledgeBases[0]!.access.knowledgeBase.authzVersion += 1;
      },
      (value) => {
        value.knowledgeBases[0]!.access.permissions = ['READ', 'PROPOSE'];
      },
      (value) => {
        value.knowledgeBases[0]!.access.canPropose = true;
      },
      (value) => {
        value.knowledgeBases = [];
      },
    ];
    for (const mutate of mutations) {
      const changed = context();
      mutate(changed);
      expect(summaryQueryKey(changed, query)).not.toBe(original);
    }
    for (const changed of [
      { kind: 'PRD' },
      { knowledgeBaseKind: 'BUSINESS' },
      { requirementId: DOCUMENT },
      { status: 'candidate' },
      { q: 'x' },
      { searchProfile: 'prd' },
      { limit: 1 },
    ])
      expect(summaryQueryKey(context(), normalizeSummaryQuery(changed))).not.toBe(original);
    const changed = context();
    changed.project.project.version = 999;
    changed.project.activeRoleIds = ['role-b', 'role-a'];
    expect(summaryQueryKey(changed, query)).toBe(original);
    expect(summaryQueryKey(context(), normalizeSummaryQuery({ q: ' X ', limit: 999 }))).toBe(
      summaryQueryKey(context(), normalizeSummaryQuery({ q: 'x', limit: 100 })),
    );
  });
});

describe('parameterized summary SQL', () => {
  it('does not aggregate historical text for empty searches and preserves null-pointer candidates', () => {
    const value = context();
    const query = normalizeSummaryQuery({ status: 'candidate' });
    for (const sql of [
      summaryCountSql(value, query),
      summaryPageSql(value, query, null),
      summaryOverviewSql(value),
      summarySingletonSql(value, DOCUMENT),
    ]) {
      expect(sql.text).not.toContain('string_agg');
      expect(sql.text).not.toMatch(
        /bodyBytes|acceptance|deliveryScope|ApprovalSlotDelegation|requiredRoleId/,
      );
      expect(sql.text).not.toContain(USER);
      expect(sql.text).not.toContain(BASE);
    }
    const sql = summaryCountSql(value, query);
    expect(sql.text).toContain('IS DISTINCT FROM');
    expect(sql.text).toContain('slot."requiredUserId"');
    expect(sql.text).not.toContain('rr."status"');
    expect(sql.text).toContain('r."documentId" = d."id" AND r."projectId" = d."projectId"');
  });

  it('searches the complete visible ordered history literally after independently applying status', () => {
    const value = context();
    const query = normalizeSummaryQuery({ q: "候选 next%_' OR TRUE --", status: 'published' });
    const sql = summaryCountSql(value, query);
    expect(sql.text).toContain("strpos(CASE WHEN getdatabaseencoding() = 'UTF8'");
    expect(sql.text).toContain('COLLATE "C"');
    expect(sql.text).not.toMatch(/\blower\(/);
    expect(sql.text).not.toMatch(/\b(?:ILIKE|LIKE)\b/);
    expect(sql.values).toContain("候选 next%_' or true --");
    expect(sql.text).not.toContain('next%_');
    expect(sql.text).toContain('\' \' ORDER BY r."seq" DESC');
    expect(sql.text).toContain('octet_length(r."title") = length(r."title")');
    expect(sql.text).toContain("THEN 'published 已发布' ELSE 'candidate 候选'");
    expect(sql.text).toContain('d."requirementCode" || \' · \' || d."requirementTitle"');
    expect(sql.text).toContain("WHEN 'UNDERSTANDING' THEN '理解'");
    expect(sql.text.match(/FROM "workmesh_v1"\."DocumentRevision" r/g)).toHaveLength(2);
    expect(
      summaryCountSql(value, normalizeSummaryQuery({ searchProfile: 'prd', q: 'PRD prd' })).text,
    ).toContain('\'PRD prd \' || d."kind"');
  });

  it('keeps per-KB revision powers separate and hides requirement text at the SQL join', () => {
    const value = context();
    const second = structuredClone(value.knowledgeBases[0]!);
    second.id = DOCUMENT;
    second.access.canPropose = true;
    value.knowledgeBases.push(second);
    value.canReadRequirement = false;
    const sql = summaryPageSql(value, normalizeSummaryQuery({ q: 'hidden' }), null);
    expect(sql.values.slice(0, 5)).toEqual([BASE, false, DOCUMENT, true, false]);
    expect(sql.text).toContain('LEFT JOIN "workmesh_v1"."Requirement" req ON');
    expect(sql.text).toContain('req."projectId" = d."projectId"');
    expect(sql.text).toContain('d."allRevisions" OR');
  });

  it('keeps full totals independent of cursor boundaries and resolves publication separately in bounded rows', () => {
    const value = context();
    const query = normalizeSummaryQuery({ limit: 7 });
    const boundary = { updatedAt: '2026-11-10T12:00:00.000Z', id: DOCUMENT };
    const count = summaryCountSql(value, query);
    const page = summaryPageSql(value, query, boundary);
    expect(count.values).not.toContain(boundary.updatedAt);
    expect(count.text).not.toContain('LIMIT');
    expect(page.text).toContain('"selected" AS MATERIALIZED');
    expect(page.values).toContain(boundary.updatedAt);
    expect(page.values).toContain(8);
    expect(page.text).toContain('ORDER BY d."updatedAt" DESC, d."id" DESC');
    expect(page.text).toContain(
      'published."documentId" = d."id" AND published."projectId" = d."projectId"',
    );
    expect(page.text).toContain('AS "invalidPublication"');
    expect(page.text).toContain('ORDER BY r."seq" DESC LIMIT 1');
    expect(summarySingletonSql(value, DOCUMENT).text).not.toContain('d."archivedAt" IS NULL');
    expect(page.text).toContain('d."archivedAt" IS NULL');
  });
});
