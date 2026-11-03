import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReviewDecision } from './ReviewDecision';
import { setCsrfToken } from '../api/client';
import { utf8ToBase64 } from '../api/resources';
import { useAuthStore } from '../store/auth';
import { envelope, mockFetch, pathOf } from '../test-utils';

const review = {
  id: 'review-1',
  projectId: 'p1',
  kind: 'PRD_PUBLICATION',
  status: 'OPEN',
  version: 3,
  subjectDigest: 'd'.repeat(64),
  documentRevisionId: 'rev-2',
  artifactSetId: null,
  taskId: null,
  slots: [
    {
      id: 'slot-1',
      slotKey: 'product',
      requiredRoleId: 'role-product',
      requiredUserId: 'u-2',
      sourceSlotBindingId: null,
      viewerCanDecide: true,
    },
  ],
  decisions: [],
  subject: {
    documentId: 'doc-1',
    knowledgeBaseId: 'kb-1',
    documentVersion: 2,
    currentPublishedRevisionId: 'rev-1',
    revisionId: 'rev-2',
    revisionDigest: 'e'.repeat(64),
  },
};

const revisions = [
  {
    id: 'rev-1',
    documentId: 'doc-1',
    seq: 1,
    title: 'PRD v1',
    mimeType: 'text/markdown',
    byteLength: 14,
    digest: 'a'.repeat(64),
    state: 'PUBLISHED',
    createdBy: 'u-1',
    basisUnderstandingRevisionId: null,
    deliveryScope: null,
    acceptance: null,
  },
  {
    id: 'rev-2',
    documentId: 'doc-1',
    seq: 2,
    title: 'PRD v2',
    mimeType: 'text/markdown',
    byteLength: 20,
    digest: 'b'.repeat(64),
    state: 'CANDIDATE',
    createdBy: 'u-1',
    basisUnderstandingRevisionId: null,
    deliveryScope: null,
    acceptance: [{ key: 'a1', text: '登录失败 3 次锁定', verification: 'test' }],
  },
];

function contentOf(revisionId: string, text: string) {
  return {
    revisionId,
    mimeType: 'text/markdown',
    encoding: 'base64',
    bodyBase64: utf8ToBase64(text),
    byteLength: text.length,
    sha256: revisionId === 'rev-1' ? 'a'.repeat(64) : 'b'.repeat(64),
  };
}

describe('ReviewDecision（证据 + 一次确认 + 回执）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
  });

  afterEach(() => {
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    localStorage.clear();
  });

  it('展示正文、差异、验收与历史，并在一次确认后给出回执', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/v1/review-requests/review-1' && method === 'GET')
        return { status: 200, body: envelope(review) };
      if (path === '/api/v1/documents/doc-1' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            document: {
              id: 'doc-1',
              projectId: 'p1',
              knowledgeBaseId: 'kb-1',
              requirementId: null,
              kind: 'PRD',
              version: 2,
              currentPublishedRevisionId: 'rev-1',
              archivedAt: null,
            },
            revisions,
            publishedRevision: revisions[0],
          }),
        };
      if (path === '/api/v1/document-revisions/rev-2/content' && method === 'GET')
        return {
          status: 200,
          body: envelope(contentOf('rev-2', '# 登录页改版\n- 新增记住登录\n')),
        };
      if (path === '/api/v1/document-revisions/rev-1/content' && method === 'GET')
        return { status: 200, body: envelope(contentOf('rev-1', '# 登录页改版\n- 旧行为\n')) };
      if (path === '/api/v1/auth/action-previews' && method === 'POST')
        return {
          status: 201,
          body: envelope({
            binding: {},
            actionDigest: 'digest-a',
            display: {
              action: 'REVIEW_DECIDE',
              targetType: 'REVIEW_REQUEST',
              targetId: 'review-1',
              expectedVersion: 3,
              projectId: 'p1',
              roleSlot: { roleId: 'role-product', approvalSlotId: 'slot-1' },
            },
          }),
        };
      if (path === '/api/v1/auth/confirmation-tickets' && method === 'POST')
        return {
          status: 201,
          body: envelope({
            ticketId: 't1',
            ticketSecret: 's1',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            actionDigest: 'digest-a',
          }),
        };
      if (path === '/api/v1/review-requests/review-1/decisions' && method === 'POST')
        return {
          status: 201,
          body: envelope({
            review: {
              ...review,
              status: 'APPROVED',
              decisions: [
                {
                  id: 'dec-1',
                  approvalSlotId: 'slot-1',
                  decision: 'APPROVE',
                  subjectDigest: 'd'.repeat(64),
                  comment: null,
                  createdById: 'stamp-1',
                  createdAt: '2026-11-02T00:00:00.000Z',
                  actor: { id: 'u-1', email: 'alice@example.com' },
                },
              ],
            },
            decisionId: 'dec-1',
            published: true,
            publicationId: 'pub-1',
            documentVersion: 3,
            replayed: false,
          }),
        };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/reviews/review-1']}>
        <Routes>
          <Route path="/reviews/:reviewId" element={<ReviewDecision />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('PRD v2')).toBeInTheDocument();
    expect(screen.getAllByText(/新增记住登录/).length).toBeGreaterThan(0);
    expect(screen.getByText(/与已发布版本的差异/)).toBeInTheDocument();
    expect(screen.getByText(/登录失败 3 次锁定/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '作出决定' }));
    fireEvent.click(screen.getByRole('button', { name: /下一步：预览并验证/ }));
    fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    fireEvent.click(await screen.findByRole('button', { name: '提交决定' }));

    expect(await screen.findByText(/批准 · product/)).toBeInTheDocument();
    expect(screen.getByText(/复制审计行/)).toBeInTheDocument();
    expect((await screen.findAllByText('alice@example.com')).length).toBeGreaterThan(0);
  });

  it('让代码交付物具备可审阅的需求、仓库、检查与代码评审证据', async () => {
    const commit = 'b'.repeat(40);
    const taskReview = {
      ...review,
      id: 'review-code',
      kind: 'TASK_ACCEPTANCE',
      documentRevisionId: null,
      artifactSetId: 'set-code',
      taskId: 'task-code',
      subject: null,
      slots: [],
    };
    mockFetch((url) => {
      const path = pathOf(url);
      if (path === '/api/v1/review-requests/review-code')
        return { status: 200, body: envelope(taskReview) };
      if (path === '/api/v1/artifact-sets/set-code')
        return {
          status: 200,
          body: envelope({
            id: 'set-code',
            taskId: 'task-code',
            taskGeneration: 1,
            snapshotId: 'snap-1',
            manifestDigest: 'c'.repeat(64),
            workflowDefinitionRevisionId: 'wf-1',
            localRunId: 'run-1',
            candidateRevisionIds: [],
            createdAt: '2026-11-02T00:00:00.000Z',
            artifacts: [
              {
                id: 'artifact-code',
                kind: 'IMPL',
                schemaVersion: '1.0',
                storage: 'GIT_REF',
                mediaType: 'text/x-source',
                byteLength: 0,
                sha256: 'd'.repeat(64),
                projectRepositoryId: 'repo-1',
                commitSha: commit,
                repoPath: 'app/service',
                summary: '客户询价单实现提交',
                checks: [
                  {
                    code: 'commit-has-requirement-code',
                    passed: true,
                    message: '包含 YFF-001',
                    source: 'EXTERNAL_REFERENCE',
                    evidence: {
                      kind: 'CI_RUN',
                      provider: 'GitHub Actions',
                      url: 'https://github.com/acme/app/actions/runs/42',
                      runId: '42',
                      commitSha: commit,
                    },
                  },
                ],
              },
            ],
            codeReview: {
              required: true,
              acceptable: true,
              evidence: [
                {
                  id: 'evidence-1',
                  repositoryId: 'codeup-backend',
                  changeRequestId: 'PR-YFF-001-impl-be',
                  headSha: commit,
                  authorExternalId: 'be',
                  reviewerExternalId: 'owner',
                  reviewerKind: 'USER',
                  state: 'APPROVED',
                  commitSha: commit,
                  submittedAt: '2026-11-02T01:00:00.000Z',
                },
              ],
            },
          }),
        };
      if (path === '/api/v1/tasks/task-code')
        return {
          status: 200,
          body: envelope({
            id: 'task-code',
            projectId: 'p1',
            workflowInstanceId: 'instance-1',
            stepKey: 'impl-be',
            roleId: 'role-backend',
            responsibleUserId: 'be@example.com',
            version: 2,
            generation: 1,
            executionStatus: 'REVIEW_PENDING',
            workStatus: 'ACTIVE',
            currentClaim: null,
          }),
        };
      if (path === '/api/v1/workflow-instances/instance-1')
        return { status: 200, body: envelope({ requirementId: 'req-1' }) };
      if (path === '/api/v1/projects/p1/requirements/req-1')
        return {
          status: 200,
          body: envelope({
            requirement: {
              id: 'req-1',
              projectId: 'p1',
              seq: 1,
              code: 'YFF-001',
              title: '客户询价单',
              description: '支持客户询价主流程',
              version: 1,
              generation: 1,
              phase: 'DELIVERY',
              workStatus: 'ACTIVE',
              createdAt: '',
              updatedAt: '',
            },
            acceptanceKeys: ['a1'],
            tasks: [{ id: 'task-code', stepKey: 'impl-be' }],
            artifacts: [],
            reviews: [],
            changes: [],
            counts: { tasks: 1, artifacts: 1, reviews: 1, changes: 0 },
          }),
        };
      if (path === '/api/v1/projects/p1/repositories')
        return {
          status: 200,
          body: envelope([
            {
              id: 'repo-1',
              adapter: 'github',
              externalId: 'codeup-backend',
              owner: 'nz_erp',
              name: 'backend',
              defaultBranch: 'main',
              createdAt: '',
            },
          ]),
        };
      if (path === '/api/v1/projects/p1/documents')
        return {
          status: 200,
          body: envelope({
            items: [
              {
                document: {
                  id: 'prd-1',
                  projectId: 'p1',
                  knowledgeBaseId: 'kb',
                  requirementId: 'req-1',
                  kind: 'PRD',
                  version: 1,
                  currentPublishedRevisionId: 'prd-rev',
                  archivedAt: null,
                },
                revisions: [],
                publishedRevision: {
                  id: 'prd-rev',
                  documentId: 'prd-1',
                  seq: 1,
                  title: 'PRD：客户询价单',
                  mimeType: 'text/markdown',
                  byteLength: 20,
                  digest: 'e'.repeat(64),
                  state: 'PUBLISHED',
                  createdBy: 'pm',
                  basisUnderstandingRevisionId: null,
                  deliveryScope: null,
                  acceptance: [{ key: 'a1', text: '询价主流程可走通', verification: 'TEST' }],
                },
              },
            ],
            nextCursor: null,
          }),
        };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/reviews/review-code']}>
        <Routes>
          <Route path="/reviews/:reviewId" element={<ReviewDecision />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('后端实现')).toBeInTheDocument();
    expect(screen.getByText('YFF-001 · 客户询价单')).toBeInTheDocument();
    expect(screen.getByText('询价主流程可走通')).toBeInTheDocument();
    expect(screen.getByText('代码引用')).toBeInTheDocument();
    expect(screen.getByText(/代码引用不保存文件字节/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'nz_erp/backend' })).toHaveAttribute(
      'href',
      'https://github.com/nz_erp/backend',
    );
    expect(screen.getByRole('link', { name: /commit bbbbbbbb/ })).toHaveAttribute(
      'href',
      `https://github.com/nz_erp/backend/commit/${commit}`,
    );
    expect(screen.getByText(/commit-has-requirement-code：包含 YFF-001/)).toBeInTheDocument();
    expect(screen.getByText('GitHub Actions 引用（未核验）')).toHaveAttribute(
      'href',
      'https://github.com/acme/app/actions/runs/42',
    );
    expect(screen.getByText('PR-YFF-001-impl-be')).toBeInTheDocument();
    expect(screen.getByText('已满足')).toBeInTheDocument();
  });

  it('在代码交付缺少有效评审证据时提示服务端拒绝原因', async () => {
    const missingReview = {
      ...review,
      id: 'review-missing',
      kind: 'TASK_ACCEPTANCE',
      documentRevisionId: null,
      artifactSetId: 'set-missing',
      taskId: 'task-missing',
      subject: null,
      slots: [],
    };
    mockFetch((url) => {
      const path = pathOf(url);
      if (path === '/api/v1/review-requests/review-missing')
        return { status: 200, body: envelope(missingReview) };
      if (path === '/api/v1/artifact-sets/set-missing')
        return {
          status: 200,
          body: envelope({
            id: 'set-missing',
            taskId: 'task-missing',
            taskGeneration: 1,
            snapshotId: 'snap',
            manifestDigest: 'a'.repeat(64),
            workflowDefinitionRevisionId: 'wf',
            localRunId: 'run',
            candidateRevisionIds: [],
            createdAt: '',
            artifacts: [
              {
                id: 'a',
                kind: 'IMPL',
                schemaVersion: '1.0',
                storage: 'GIT_REF',
                mediaType: 'text/x-source',
                byteLength: 0,
                sha256: 'a'.repeat(64),
                projectRepositoryId: null,
                commitSha: 'b'.repeat(40),
                repoPath: 'app/service',
                summary: null,
                checks: [],
              },
            ],
            codeReview: { required: true, acceptable: false, evidence: [] },
          }),
        };
      if (path === '/api/v1/tasks/task-missing')
        return {
          status: 200,
          body: envelope({
            id: 'task-missing',
            projectId: 'p1',
            workflowInstanceId: 'instance-missing',
            stepKey: 'impl-be',
            roleId: 'role-backend',
            responsibleUserId: 'be@example.com',
            version: 1,
            generation: 1,
            executionStatus: 'REVIEW_PENDING',
            workStatus: 'ACTIVE',
            currentClaim: null,
          }),
        };
      if (path === '/api/v1/workflow-instances/instance-missing')
        return { status: 200, body: envelope({ requirementId: 'req-missing' }) };
      if (path === '/api/v1/projects/p1/requirements/req-missing')
        return {
          status: 200,
          body: envelope({
            requirement: {
              id: 'req-missing',
              projectId: 'p1',
              seq: 1,
              code: 'YFF-002',
              title: '缺少证据需求',
              description: null,
              version: 1,
              generation: 1,
              phase: 'DELIVERY',
              workStatus: 'ACTIVE',
              createdAt: '',
              updatedAt: '',
            },
            tasks: [],
            artifacts: [],
            reviews: [],
            changes: [],
            acceptanceKeys: [],
            counts: { tasks: 1, artifacts: 1, reviews: 1, changes: 0 },
          }),
        };
      return undefined;
    });
    render(
      <MemoryRouter initialEntries={['/reviews/review-missing']}>
        <Routes>
          <Route path="/reviews/:reviewId" element={<ReviewDecision />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/CODE_REVIEW_EVIDENCE_MISSING/)).toBeInTheDocument();
  });

  it.each([
    ['刷新任务与需求上下文', false],
    ['刷新上下文失败时仍保留成功回执', true],
  ])('审批成功后%s', async (_scenario, failTaskRefresh) => {
    const taskReview = {
      ...review,
      id: 'review-refresh',
      kind: 'TASK_ACCEPTANCE',
      documentRevisionId: null,
      artifactSetId: 'set-refresh',
      taskId: 'task-refresh',
      subject: null,
      slots: [],
    };
    let taskReads = 0;
    let requirementReads = 0;
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/v1/review-requests/review-refresh' && method === 'GET') {
        return {
          status: 200,
          body: envelope({ ...taskReview, slots: [{ ...review.slots[0] }] }),
        };
      }
      if (path === '/api/v1/artifact-sets/set-refresh' && method === 'GET') {
        return {
          status: 200,
          body: envelope({
            id: 'set-refresh',
            taskId: 'task-refresh',
            taskGeneration: 1,
            snapshotId: 'snap-refresh',
            manifestDigest: 'a'.repeat(64),
            workflowDefinitionRevisionId: 'wf-refresh',
            localRunId: 'run-refresh',
            candidateRevisionIds: [],
            createdAt: '',
            artifacts: [],
            codeReview: { required: false, acceptable: true, evidence: [] },
          }),
        };
      }
      if (path === '/api/v1/tasks/task-refresh' && method === 'GET') {
        taskReads += 1;
        if (failTaskRefresh && taskReads > 1) {
          return {
            status: 503,
            body: { error: { code: 'TEMPORARY_UNAVAILABLE', message: '暂时无法刷新任务' } },
          };
        }
        return {
          status: 200,
          body: envelope({
            id: 'task-refresh',
            projectId: 'p1',
            workflowInstanceId: 'instance-refresh',
            stepKey: 'release',
            roleId: 'role-product',
            responsibleUserId: 'alice@example.com',
            version: taskReads > 1 ? 3 : 2,
            generation: 1,
            executionStatus: taskReads > 1 ? 'DONE' : 'REVIEW_PENDING',
            workStatus: 'ACTIVE',
            currentClaim: null,
          }),
        };
      }
      if (path === '/api/v1/workflow-instances/instance-refresh' && method === 'GET') {
        return { status: 200, body: envelope({ requirementId: 'req-refresh' }) };
      }
      if (path === '/api/v1/projects/p1/requirements/req-refresh' && method === 'GET') {
        requirementReads += 1;
        return {
          status: 200,
          body: envelope({
            requirement: {
              id: 'req-refresh',
              projectId: 'p1',
              seq: 1,
              code: 'YFF-REFRESH',
              title: '审批后刷新需求',
              description: null,
              version: requirementReads > 1 ? 2 : 1,
              generation: 1,
              phase: requirementReads > 1 ? 'RELEASED' : 'DELIVERY',
              workStatus: 'ACTIVE',
              createdAt: '',
              updatedAt: '',
            },
            tasks: [{ id: 'task-refresh', stepKey: 'release' }],
            artifacts: [],
            reviews: [],
            changes: [],
            acceptanceKeys: [],
            counts: { tasks: 1, artifacts: 0, reviews: 1, changes: 0 },
          }),
        };
      }
      if (path === '/api/v1/auth/action-previews' && method === 'POST') {
        return {
          status: 201,
          body: envelope({
            binding: {},
            actionDigest: 'digest-refresh',
            display: {
              action: 'REVIEW_DECIDE',
              targetType: 'REVIEW_REQUEST',
              targetId: 'review-refresh',
              expectedVersion: 3,
              projectId: 'p1',
              roleSlot: { roleId: 'role-product', approvalSlotId: 'slot-1' },
            },
          }),
        };
      }
      if (path === '/api/v1/auth/confirmation-tickets' && method === 'POST') {
        return {
          status: 201,
          body: envelope({
            ticketId: 'ticket-refresh',
            ticketSecret: 'secret-refresh',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            actionDigest: 'digest-refresh',
          }),
        };
      }
      if (path === '/api/v1/review-requests/review-refresh/decisions' && method === 'POST') {
        return {
          status: 201,
          body: envelope({
            review: {
              ...taskReview,
              status: 'APPROVED',
              slots: [{ ...review.slots[0] }],
              decisions: [
                {
                  id: 'decision-refresh',
                  approvalSlotId: 'slot-1',
                  decision: 'APPROVE',
                  subjectDigest: 'd'.repeat(64),
                  comment: null,
                  createdById: 'u-1',
                  createdAt: '2026-11-03T00:00:00.000Z',
                  actor: { id: 'u-1', email: 'alice@example.com' },
                },
              ],
            },
            decisionId: 'decision-refresh',
            published: true,
            publicationId: 'pub-refresh',
            documentVersion: null,
            replayed: false,
          }),
        };
      }
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/reviews/review-refresh']}>
        <Routes>
          <Route path="/reviews/:reviewId" element={<ReviewDecision />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/待签字/)).toBeInTheDocument();
    expect(screen.getByText('交付')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '作出决定' }));
    fireEvent.click(screen.getByRole('button', { name: /下一步：预览并验证/ }));
    fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    fireEvent.click(await screen.findByRole('button', { name: '提交决定' }));

    expect(await screen.findByText(/批准 · product/)).toBeInTheDocument();
    expect(await screen.findByText('复制审计行')).toBeInTheDocument();
    expect(taskReads).toBeGreaterThan(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    if (failTaskRefresh) {
      expect(screen.getByText(/状态：待签字/)).toBeInTheDocument();
      expect(screen.getByText('交付')).toBeInTheDocument();
      expect(requirementReads).toBe(1);
    } else {
      expect(await screen.findByText(/已完成/)).toBeInTheDocument();
      expect(await screen.findByText('已发布')).toBeInTheDocument();
      expect(requirementReads).toBeGreaterThan(1);
    }
  });
});
