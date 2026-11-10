import type { Page } from '@playwright/test';

export const projects = [
  { id: 'p1', key: 'DEMO', name: '验收示例项目', version: 3, defaultKnowledgeBaseId: 'kb-1' },
  { id: 'p2', key: 'OPS', name: '另一验收项目', version: 2, defaultKnowledgeBaseId: 'kb-2' },
];
export const requirement = {
  id: 'req-1',
  projectId: 'p1',
  seq: 1,
  code: 'DEMO-001',
  title: '移动端结算与登录改版',
  description: '浏览器验收夹具，不代表真实项目数据。',
  version: 3,
  generation: 1,
  phase: 'DELIVERY',
  workStatus: 'ACTIVE',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
};
export const task = {
  id: 'task-1',
  stepKey: 'backend-impl',
  stepDisplayName: '后端交付',
  role: { key: 'backend', title: '后端' },
  responsibleUser: { id: 'fixture-user', email: 'fixture@example.test' },
  version: 2,
  generation: 1,
  executionStatus: 'OPEN',
  workStatus: 'ACTIVE',
  currentClaimId: null,
  currentArtifactSetId: null,
  instanceId: 'inst-1',
  artifactCount: 0,
  review: null,
};
export const revisions = ['PUBLISHED', 'CANDIDATE', 'WITHDRAWN'].map((state, index) => ({
  id: `rev-${index + 1}`,
  documentId: 'doc-1',
  seq: index + 1,
  title: `验收文档 v${index + 1}`,
  mimeType: 'text/markdown; charset=utf-8',
  byteLength: 50,
  digest: `fixture-digest-${index + 1}`,
  state,
  createdBy: 'fixture-user',
  basisUnderstandingRevisionId: null,
  deliveryScope: null,
  acceptance: null,
}));
export const texts = [
  '共同开头\n旧版条款\n共同结尾',
  '共同开头\n新版条款\n共同结尾',
  '共同开头\n第三版条款\n共同结尾',
];
export const snapshot = {
  counts: { reviews: 1, changes: 0, readyTasks: 1, total: 2 },
  reviews: [
    {
      reviewId: 'review-1',
      kind: 'PRD_PUBLICATION',
      status: 'OPEN',
      version: 2,
      projectId: 'p1',
      projectKey: 'DEMO',
      projectName: projects[0].name,
      requirement: { code: 'DEMO-001', title: requirement.title },
      subjectLabel: 'PRD v2',
      role: { id: 'role-1', key: 'backend', title: '后端' },
      slots: [
        {
          id: 'slot-1',
          slotKey: 'owner',
          requiredUserId: 'fixture-user',
          requiredRoleId: 'role-1',
          decided: false,
          viewerCanDecide: true,
        },
      ],
      ageSeconds: 7200,
      evidence: {
        artifactCount: 2,
        hasPr: false,
        artifactKinds: ['PRD'],
        checks: { total: 0, failed: 0 },
        codeRefs: 0,
      },
    },
  ],
  changes: [],
  readyTasks: [
    {
      taskId: 'task-1',
      projectId: 'p1',
      projectKey: 'DEMO',
      projectName: projects[0].name,
      requirement: { code: 'DEMO-001', title: requirement.title },
      role: { key: 'backend', title: '后端' },
      stepKey: 'backend-impl',
      stepDisplayName: '后端交付',
      responsibleUser: { id: 'fixture-user', email: 'fixture@example.test' },
      claimEligibility: { canClaim: true, reason: null },
      executionStatus: 'OPEN',
      workStatus: 'ACTIVE',
      ageSeconds: null,
    },
  ],
  warnings: [],
};
export const emptySnapshot = {
  counts: { reviews: 0, changes: 0, readyTasks: 0, total: 0 },
  reviews: [],
  changes: [],
  readyTasks: [],
  warnings: [],
};
export const boardColumnKeys = [
  'BACKLOG',
  'ACTIVE',
  'BLOCKED',
  'PAUSED',
  'CANCELLED',
  'DELIVERED',
] as const;
export function boardSummary(
  totals: Partial<Record<(typeof boardColumnKeys)[number], number>>,
  requirementTotal = 1,
) {
  const columns = boardColumnKeys.map((key) => ({ key, total: totals[key] ?? 0 }));
  const total = columns.reduce((sum, column) => sum + column.total, 0);
  return { total, matchedTotal: total, columns, requirementTotal: total ? requirementTotal : 0 };
}

export async function installReviewFixtures(page: Page) {
  const requests: string[] = [];
  const controls = {
    failContent: false,
    failWorkbench: false,
    emptyProjects: false,
    projectStatus: 200,
  };
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      requests.push(path + url.search);
      const reply = (data: unknown, status = 200) =>
        route.fulfill({ status, json: { data, meta: { requestId: 'ui-review-fixture' } } });
      const error = (message: string, status = 500) =>
        route.fulfill({
          status,
          json: { error: { code: 'FIXTURE_FAILURE', message, requestId: 'ui-review-fixture' } },
        });
      if (path === '/api/health') return reply({ status: 'ok' });
      if (path === '/api/v1/auth/session')
        return reply({
          authenticated: true,
          csrfToken: 'fixture-csrf',
          user: { id: 'fixture-user', email: 'fixture@example.test' },
          sessionId: 'fixture-session',
          expiresAt: '2026-12-01T00:00:00.000Z',
          idleExpiresAt: '2026-12-01T00:00:00.000Z',
        });
      if (path === '/api/v1/projects')
        return controls.projectStatus === 200
          ? reply(controls.emptyProjects ? [] : projects)
          : error('项目列表读取失败', controls.projectStatus);
      if (path === '/api/v1/activity') return reply({ items: [] });
      if (path === '/api/v1/workbench')
        return controls.failWorkbench
          ? error('工作台读取失败')
          : reply(url.searchParams.get('projectId') === 'p2' ? emptySnapshot : snapshot);
      if (path.endsWith('/members'))
        return reply([
          {
            id: 'fixture-user',
            email: 'fixture@example.test',
            name: '验收成员',
            role: 'OWNER',
            version: 1,
          },
        ]);
      if (/^\/api\/v1\/projects\/[^/]+\/roles$/.test(path))
        return reply([
          {
            id: 'role-1',
            projectId: 'p1',
            key: 'backend',
            title: '后端',
            version: 1,
            isActive: true,
          },
        ]);
      if (path.endsWith('/repositories') || path.endsWith('/delegations')) return reply([]);
      if (path.endsWith('/workflow-definitions') || path.endsWith('/role-packages'))
        return reply({ items: [], nextCursor: null });
      const boardMatch = /^\/api\/v1\/projects\/([^/]+)\/board(?:\/(.*))?$/.exec(path);
      if (boardMatch) {
        const projectId = boardMatch[1];
        const empty = projectId === 'p2';
        const queryKey = `ui-review-board-${projectId}`;
        const summary = boardSummary({ BACKLOG: empty ? 0 : 1 });
        const card = {
          ...task,
          taskId: task.id,
          projectId,
          roleId: 'role-1',
          roleKey: 'backend',
          roleTitle: '后端',
          requirementId: requirement.id,
          requirementCode: requirement.code,
          requirementTitle: requirement.title,
          claimedUserId: null,
          claimedAt: null,
        };
        if (boardMatch[2]?.startsWith('filters/')) {
          const kind = boardMatch[2].slice('filters/'.length);
          const items = empty
            ? []
            : kind === 'roles'
              ? [{ value: '后端', label: '后端' }]
              : [{ value: requirement.code, label: `${requirement.code} · ${requirement.title}` }];
          return reply({ projectId, queryKey, total: items.length, items, nextCursor: null });
        }
        if (boardMatch[2] === 'requirements')
          return reply({
            projectId,
            queryKey,
            summary,
            items: empty
              ? []
              : [
                  {
                    code: requirement.code,
                    title: requirement.title,
                    total: 1,
                    counts: Object.fromEntries(
                      summary.columns.map(({ key, total }) => [key, total]),
                    ),
                    roles: ['后端'],
                    roleTotal: 1,
                    rolesNextCursor: null,
                  },
                ],
            nextCursor: null,
          });
        if (!boardMatch[2])
          return reply({
            projectId,
            queryKey,
            summary,
            columns: summary.columns.map((column) => ({
              ...column,
              cards: column.key === 'BACKLOG' && !empty ? [card] : [],
              nextCursor: null,
            })),
          });
        return error(`未配置看板验收请求：${path}`, 404);
      }
      if (path.endsWith('/requirements'))
        return reply({ items: path.includes('/p2/') ? [] : [requirement], nextCursor: null });
      if (/\/requirements\/[^/]+$/.test(path))
        return reply({
          requirement,
          acceptanceKeys: [],
          tasks: [task],
          artifacts: [],
          reviews: [],
          changes: [],
          counts: { tasks: 1, artifacts: 0, reviews: 0, changes: 0 },
        });
      if (path === '/api/v1/workflow-instances/inst-1')
        return reply({
          id: 'inst-1',
          projectId: 'p1',
          requirementId: 'req-1',
          definitionRevisionId: 'wf-rev-1',
          definitionDigest: 'fixture',
          version: 1,
          workStatus: 'ACTIVE',
          retiredAt: null,
          steps: [],
        });
      if (path === '/api/v1/workflow-definition-revisions/wf-rev-1')
        return reply({
          id: 'wf-rev-1',
          projectId: 'p1',
          workflowKey: 'standard',
          revision: 1,
          digest: 'fixture',
          definition: {
            steps: [{ key: 'backend-impl', displayName: '后端交付', roleKey: 'backend', deps: [] }],
            roleSlots: [],
          },
        });
      if (/\/projects\/[^/]+\/knowledge-bases$/.test(path))
        return reply({
          items: path.includes('/p2/')
            ? []
            : [
                {
                  id: 'kb-1',
                  projectId: 'p1',
                  key: 'fixture-business',
                  name: '验收知识库',
                  kind: 'BUSINESS',
                  visibility: 'PROJECT',
                  version: 1,
                  authzVersion: 1,
                  publicationApproverUserId: 'fixture-user',
                  publicationApproverRoleId: 'role-1',
                  archivedAt: null,
                },
              ],
          nextCursor: null,
          hasMore: false,
        });
      if (path.endsWith('/documents')) {
        const kind = url.searchParams.get('kind') ?? 'KNOWLEDGE';
        return reply({
          items: path.includes('/p2/')
            ? []
            : [
                {
                  document: {
                    id: 'doc-1',
                    projectId: 'p1',
                    knowledgeBaseId: 'kb-1',
                    requirementId: kind === 'PRD' ? 'req-1' : null,
                    kind,
                    version: 3,
                    currentPublishedRevisionId: 'rev-1',
                    archivedAt: null,
                  },
                  revisions,
                  publishedRevision: revisions[0],
                },
              ],
          nextCursor: null,
        });
      }
      const revision = /\/document-revisions\/rev-(\d)\/content$/.exec(path);
      if (revision) {
        if (controls.failContent) return error('正文暂时不可用');
        const text = texts[Number(revision[1]) - 1];
        return reply({
          revisionId: `rev-${revision[1]}`,
          mimeType: 'text/markdown',
          encoding: 'base64',
          bodyBase64: Buffer.from(text).toString('base64'),
          byteLength: Buffer.byteLength(text),
          sha256: 'fixture-content',
        });
      }
      if (path.endsWith('/review-requests'))
        return reply({
          items: [
            {
              id: 'review-1',
              projectId: 'p1',
              kind: 'PRD_PUBLICATION',
              status: 'OPEN',
              version: 2,
              subjectDigest: 'fixture',
              documentRevisionId: 'rev-2',
              artifactSetId: null,
              taskId: null,
              slots: [
                {
                  id: 'slot-1',
                  slotKey: 'owner',
                  requiredRoleId: 'role-1',
                  requiredUserId: 'fixture-user',
                },
              ],
              decisions: [],
              subject: null,
            },
          ],
          nextCursor: null,
        });
      if (path.endsWith('/access'))
        return reply({
          knowledgeBaseId: 'kb-1',
          projectId: 'p1',
          visibility: 'RESTRICTED',
          version: 1,
          authzVersion: 1,
          publicationApproverUserId: 'fixture-user',
          publicationApproverRoleId: 'role-1',
          grants: [],
        });
      if (path === '/api/v1/auth/credentials')
        return reply([
          {
            id: 'cred-1',
            name: '验收凭据',
            projectId: 'p1',
            roleId: 'role-1',
            scopes: ['project:read', 'task:claim'],
            expiresAt: '2026-12-01T00:00:00.000Z',
            revokedAt: null,
          },
        ]);
      return error(`未配置验收请求：${path}`, 404);
    },
  );
  return { requests, controls };
}
