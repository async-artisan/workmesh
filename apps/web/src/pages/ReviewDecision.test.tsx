import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewDecision } from './ReviewDecision';
import { setCsrfToken } from '../api/client';
import { utf8ToBase64 } from '../api/resources';
import { useAuthStore } from '../store/auth';
import { envelope, methodOf, mockFetch, pathOf, type StubReply } from '../test-utils';

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
    expect(screen.getByText(/共 1 处修改 · 新增 \+1 · 删除 -1/)).toBeInTheDocument();
    expect(screen.getByText('第 1 / 1 处修改')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: '第 1 处修改：新增 1 行，删除 1 行' }),
    ).toBeInTheDocument();
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
            stepDisplayName: '后端交付',
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

    expect(await screen.findByText('后端交付')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /完整 commit bbbbbbbb/ }));
    expect(screen.getByLabelText('完整 commit完整值')).toHaveTextContent(commit);
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

// ---------------------------------------------------------------------------
// 以下为证据完整性 / 上下文状态 / 确认摘要的新增覆盖；复用同一 mockFetch 风格。
// ---------------------------------------------------------------------------

const taskReviewBase = {
  projectId: 'p1',
  kind: 'TASK_ACCEPTANCE',
  status: 'OPEN',
  version: 3,
  subjectDigest: 'd'.repeat(64),
  documentRevisionId: null,
  subject: null,
  decisions: [],
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
};

const hostedArtifact = {
  id: 'artifact-hosted',
  kind: 'IMPL',
  schemaVersion: '1.0',
  storage: 'HOSTED',
  mediaType: 'text/markdown',
  byteLength: 4096,
  sha256: 'c'.repeat(64),
  projectRepositoryId: 'repo-1',
  commitSha: null,
  repoPath: 'docs/impl.md',
  summary: '实现说明工件',
  contentPreview: { text: '实现说明预览', truncated: false },
  checks: [
    { code: 'lint-passed', passed: true, message: 'lint 通过', source: 'AGENT_REPORTED' },
    { code: 'unit-passed', passed: false, message: '单测失败', source: 'AGENT_REPORTED' },
  ],
};

const truncatedArtifact = {
  ...hostedArtifact,
  id: 'artifact-truncated',
  byteLength: 8192,
  commitSha: 'f'.repeat(40),
  summary: '截断正文工件',
  contentPreview: { text: '# 截断预览正文', truncated: true },
};

const taskPayload = {
  id: 'task-task',
  projectId: 'p1',
  workflowInstanceId: 'instance-task',
  stepKey: 'impl-be',
  stepDisplayName: '后端交付',
  roleId: 'role-backend',
  responsibleUserId: 'be@example.com',
  version: 2,
  generation: 1,
  executionStatus: 'REVIEW_PENDING',
  workStatus: 'ACTIVE',
  currentClaim: null,
};

const requirementPayload = {
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
  acceptanceKeys: [],
  tasks: [{ id: 'task-task', stepKey: 'impl-be' }],
  artifacts: [],
  reviews: [],
  changes: [],
  counts: { tasks: 1, artifacts: 1, reviews: 1, changes: 0 },
};

const repositoryPayload = [
  {
    id: 'repo-1',
    adapter: 'github',
    externalId: 'codeup-backend',
    owner: 'nz_erp',
    name: 'backend',
    defaultBranch: 'main',
    createdAt: '',
  },
];

const artifactSetBase = {
  id: 'set-task',
  taskId: 'task-task',
  taskGeneration: 1,
  snapshotId: 'snap-task',
  manifestDigest: 'a'.repeat(64),
  workflowDefinitionRevisionId: 'wf-task',
  localRunId: 'run-task',
  candidateRevisionIds: [],
  createdAt: '2026-11-04T00:00:00.000Z',
  codeReview: { required: false, acceptable: true, evidence: [] },
};

function artifactSetPayload(artifacts: unknown[]) {
  return { ...artifactSetBase, artifacts };
}

interface TaskScenarioOptions {
  reviewId?: string;
  reviewOverride?: Record<string, unknown>;
  artifactSetId?: string | null;
  taskId?: string | null;
  /** 覆盖交付物响应，用于构造 500/403 与“首次失败、重试成功”。 */
  artifactSet?: () => StubReply;
  artifactContent?: (artifactId: string) => StubReply;
  artifacts?: () => unknown[];
  repositories?: () => StubReply;
  documents?: () => StubReply;
  task?: () => StubReply;
  requirement?: () => StubReply;
}

function mockTaskScenario(options: TaskScenarioOptions = {}) {
  const reviewId = options.reviewId ?? 'review-task';
  const artifactSetId = options.artifactSetId === undefined ? 'set-task' : options.artifactSetId;
  const taskId = options.taskId === undefined ? 'task-task' : options.taskId;
  const reviewValue = {
    ...taskReviewBase,
    id: reviewId,
    artifactSetId,
    taskId,
    ...options.reviewOverride,
  };

  return mockFetch((url, init) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (method === 'GET' && path === `/api/v1/review-requests/${reviewId}`) {
      return { status: 200, body: envelope(reviewValue) };
    }
    if (
      artifactSetId &&
      method === 'GET' &&
      path.startsWith(`/api/v1/artifact-sets/${artifactSetId}/artifacts/`) &&
      path.endsWith('/content')
    ) {
      const artifactId = path.split('/artifacts/')[1]?.replace('/content', '') ?? '';
      if (options.artifactContent) return options.artifactContent(artifactId);
      return {
        status: 404,
        body: { error: { code: 'STUB_NOT_FOUND', message: 'no content stub' } },
      };
    }
    if (artifactSetId && method === 'GET' && path === `/api/v1/artifact-sets/${artifactSetId}`) {
      if (options.artifactSet) return options.artifactSet();
      return {
        status: 200,
        body: envelope(artifactSetPayload(options.artifacts?.() ?? [hostedArtifact])),
      };
    }
    if (method === 'GET' && path === '/api/v1/projects/p1/repositories') {
      if (options.repositories) return options.repositories();
      return { status: 200, body: envelope(repositoryPayload) };
    }
    if (method === 'GET' && path === '/api/v1/projects/p1/documents') {
      if (options.documents) return options.documents();
      return { status: 200, body: envelope({ items: [], nextCursor: null }) };
    }
    if (taskId && method === 'GET' && path === `/api/v1/tasks/${taskId}`) {
      if (options.task) return options.task();
      return { status: 200, body: envelope(taskPayload) };
    }
    if (method === 'GET' && path === '/api/v1/workflow-instances/instance-task') {
      return { status: 200, body: envelope({ requirementId: 'req-1' }) };
    }
    if (method === 'GET' && path === '/api/v1/projects/p1/requirements/req-1') {
      if (options.requirement) return options.requirement();
      return { status: 200, body: envelope(requirementPayload) };
    }
    if (method === 'POST' && path === '/api/v1/auth/action-previews') {
      return {
        status: 201,
        body: envelope({
          binding: {},
          actionDigest: 'digest-task',
          display: {
            action: 'REVIEW_DECIDE',
            targetType: 'REVIEW_REQUEST',
            targetId: reviewId,
            expectedVersion: 3,
            projectId: 'p1',
            roleSlot: { roleId: 'role-product', approvalSlotId: 'slot-1' },
          },
        }),
      };
    }
    if (method === 'POST' && path === '/api/v1/auth/confirmation-tickets') {
      return {
        status: 201,
        body: envelope({
          ticketId: 'ticket-task',
          ticketSecret: 'secret-task',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          actionDigest: 'digest-task',
        }),
      };
    }
    return undefined;
  });
}

function renderDecisionPage(reviewId = 'review-task') {
  render(
    <MemoryRouter initialEntries={[`/reviews/${reviewId}`]}>
      <Routes>
        <Route path="/reviews/:reviewId" element={<ReviewDecision />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ReviewDecision 证据完整性与上下文状态', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
  });

  afterEach(() => {
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    localStorage.clear();
  });

  it('截断工件允许加载完整正文、下载证据并保留打开原工件入口', async () => {
    mockTaskScenario({
      artifacts: () => [truncatedArtifact],
      artifactContent: (artifactId) => ({
        status: 200,
        body: envelope({
          artifactId,
          mediaType: 'text/markdown',
          byteLength: 8192,
          sha256: 'f'.repeat(64),
          storage: 'HOSTED',
          text: '这是完整正文，不是 4 KiB 截断预览。',
          bodyBase64: Buffer.from('这是完整正文，不是 4 KiB 截断预览。').toString('base64'),
        }),
      }),
    });
    renderDecisionPage();

    expect(await screen.findByText('正文预览已截断。')).toBeInTheDocument();
    expect(screen.getByText(/预览 8 字符 · 工件 8\.0 KiB/)).toBeInTheDocument();
    expect(screen.getByText(/请加载完整正文或核对原工件后/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开原工件' })).toHaveAttribute(
      'href',
      `https://github.com/nz_erp/backend/commit/${'f'.repeat(40)}`,
    );
    expect(screen.getByText('证据完整性')).toBeInTheDocument();
    expect(screen.getByText('不完整')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '作出决定' }));
    const nextStep = screen.getByRole('button', { name: /下一步：预览并验证/ });
    expect(nextStep).toBeDisabled();
    expect(screen.getByText(/完整正文尚未加载，批准入口保持阻止/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '加载完整正文' }));
    expect(await screen.findByText('这是完整正文，不是 4 KiB 截断预览。')).toBeInTheDocument();
    expect(screen.getByText(/已加载完整正文/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载证据' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '在新标签打开完整正文' })).toBeInTheDocument();
    expect(screen.queryByText('不完整')).not.toBeInTheDocument();
    expect(screen.getByText('完整')).toBeInTheDocument();
    expect(nextStep).toBeEnabled();
  });

  it('完整正文读取失败明确展示错误并保留证据阻断，重试成功后恢复', async () => {
    let reads = 0;
    mockTaskScenario({
      artifacts: () => [truncatedArtifact],
      artifactContent: (artifactId) => {
        reads += 1;
        if (reads === 1)
          return {
            status: 500,
            body: {
              error: {
                code: 'CONTENT_UNAVAILABLE',
                message: '全文读取失败',
                requestId: 'req-content-500',
              },
            },
          };
        return {
          status: 200,
          body: envelope({
            artifactId,
            mediaType: 'text/markdown',
            byteLength: 8192,
            sha256: 'f'.repeat(64),
            storage: 'HOSTED',
            text: '重试后的完整正文',
            bodyBase64: Buffer.from('重试后的完整正文').toString('base64'),
          }),
        };
      },
    });
    renderDecisionPage();

    expect(await screen.findByText('正文预览已截断。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载完整正文' }));
    expect(await screen.findByText(/完整正文加载失败/)).toBeInTheDocument();
    expect(screen.getByText(/CONTENT_UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByText('不完整')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试加载完整正文' }));
    expect(await screen.findByText('重试后的完整正文')).toBeInTheDocument();
    expect(screen.getByText('完整')).toBeInTheDocument();
  });

  it('没有 GitHub 仓库或提交时说明原工件链接不可用', async () => {
    mockTaskScenario({
      artifacts: () => [
        {
          ...truncatedArtifact,
          id: 'artifact-no-repo',
          projectRepositoryId: null,
          commitSha: null,
        },
      ],
    });
    renderDecisionPage();

    expect(await screen.findByText('正文预览已截断。')).toBeInTheDocument();
    expect(screen.getByText(/无可用原工件链接/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '打开原工件' })).not.toBeInTheDocument();
  });

  it('交付物上下文读取失败显示可重试失败态，重试成功后恢复证据', async () => {
    let reads = 0;
    mockTaskScenario({
      artifactSet: () => {
        reads += 1;
        if (reads === 1) {
          return {
            status: 500,
            body: {
              error: {
                code: 'TEMPORARY_UNAVAILABLE',
                message: '暂时无法读取交付物',
                requestId: 'req-delivery-500',
              },
            },
          };
        }
        return { status: 200, body: envelope(artifactSetPayload([hostedArtifact])) };
      },
    });
    renderDecisionPage();

    expect(await screen.findByText('无法读取交付物上下文')).toBeInTheDocument();
    expect(screen.getByText(/TEMPORARY_UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByText(/req-delivery-500/)).toBeInTheDocument();
    expect(screen.queryByText('该评审没有关联交付物')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试读取交付物' }));
    expect(await screen.findByText('实现说明工件')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('无法读取交付物上下文')).not.toBeInTheDocument());
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it('没有关联交付物与需求时显示明确空态，而不是读取失败', async () => {
    mockTaskScenario({ artifactSetId: null, taskId: null });
    renderDecisionPage();

    expect(await screen.findByText('该评审没有关联交付物')).toBeInTheDocument();
    expect(screen.getByText('暂无关联需求')).toBeInTheDocument();
    expect(screen.queryByText('无法读取交付物上下文')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试读取交付物' })).not.toBeInTheDocument();
  });

  it('交付物上下文 403 显示权限边界且不提供重试', async () => {
    mockTaskScenario({
      artifactSet: () => ({
        status: 403,
        body: {
          error: {
            code: 'FORBIDDEN',
            message: '无权读取该交付物',
            requestId: 'req-delivery-403',
          },
        },
      }),
    });
    renderDecisionPage();

    expect(await screen.findByText('无法读取交付物上下文')).toBeInTheDocument();
    expect(screen.getByText('你没有查看该上下文的权限。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试读取交付物' })).not.toBeInTheDocument();
    expect(screen.getByText(/req-delivery-403/)).toBeInTheDocument();
  });

  it('非正文截断的证据不完整仍要求勾选确认，确认弹窗展示摘要与证据说明', async () => {
    mockTaskScenario({
      requirement: () => ({
        status: 500,
        body: {
          error: {
            code: 'TEMPORARY_UNAVAILABLE',
            message: '暂时无法读取需求上下文',
            requestId: 'req-requirement-500',
          },
        },
      }),
    });
    renderDecisionPage();

    fireEvent.click(await screen.findByRole('button', { name: '作出决定' }));
    const checkbox = screen.getByRole('checkbox', {
      name: '我已知晓证据不完整，仍继续批准',
    });
    expect(checkbox).not.toBeChecked();
    const nextButton = screen.getByRole('button', { name: /下一步：预览并验证/ });
    expect(nextButton).toBeDisabled();
    expect(screen.getByText(/请先勾选“我已知晓证据不完整，仍继续批准”/)).toBeInTheDocument();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(nextButton).toBeEnabled();

    fireEvent.change(screen.getByLabelText('评审说明'), {
      target: { value: '已核对原工件，风险可控' },
    });
    fireEvent.click(nextButton);

    expect(await screen.findByText('即将提交的决定')).toBeInTheDocument();
    expect(screen.getByText('v3（与提交版本一致）')).toBeInTheDocument();
    expect(
      screen.getByText('已核对原工件，风险可控', {
        selector: '.wm-decision-summary__comment',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('该槽位记为验收通过；若全部槽位通过，任务进入已完成状态。'),
    ).toBeInTheDocument();
    expect(screen.getByText(/你已确认在不完整证据下继续批准/)).toBeInTheDocument();
    expect(screen.getByText(/实现 · 实现说明工件/)).toBeInTheDocument();
    expect(screen.getByText('通过 1 / 2（1 项失败）')).toBeInTheDocument();
  });

  it('修改决定与说明后，确认弹窗摘要使用最新值', async () => {
    mockTaskScenario({ artifacts: () => [hostedArtifact] });
    renderDecisionPage();
    expect(await screen.findByText('实现说明工件')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '作出决定' }));
    fireEvent.change(screen.getByLabelText('评审决定'), {
      target: { value: 'CHANGES_REQUESTED' },
    });
    fireEvent.change(screen.getByLabelText('评审说明'), {
      target: { value: '请补充完整正文与失败单测修复记录' },
    });
    fireEvent.click(screen.getByRole('button', { name: /下一步：预览并验证/ }));

    expect(await screen.findByText('即将提交的决定')).toBeInTheDocument();
    expect(
      screen.getByText('请补充完整正文与失败单测修复记录', {
        selector: '.wm-decision-summary__comment',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('评审退回交付方修改，需要按说明调整后重新提交评审；当前版本不会发布。'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('要求修改').length).toBeGreaterThan(0);
    expect(screen.queryByText(/证据不完整：/)).not.toBeInTheDocument();
  });

  it('补充证据 PRD 读取失败可单独重试，且不会误判关键证据不完整', async () => {
    let prdReads = 0;
    mockTaskScenario({
      artifacts: () => [hostedArtifact],
      documents: () => {
        prdReads += 1;
        if (prdReads === 1) {
          return {
            status: 500,
            body: {
              error: {
                code: 'TEMPORARY_UNAVAILABLE',
                message: '暂时无法读取 PRD',
                requestId: 'req-prd-500',
              },
            },
          };
        }
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
      },
    });
    renderDecisionPage();

    expect(await screen.findByText('无法读取 PRD 上下文')).toBeInTheDocument();
    // PRD 是补充证据：失败不应把“关键证据完整性”误判为不完整。
    expect(screen.getByText('完整')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试读取 PRD' }));
    expect(await screen.findByText('询价主流程可走通')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('无法读取 PRD 上下文')).not.toBeInTheDocument());
    expect(prdReads).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: '作出决定' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('代码评审证据缺失时禁止批准，并给出服务端拒收原因', async () => {
    mockTaskScenario({
      artifactSet: () => ({
        status: 200,
        body: envelope({
          ...artifactSetPayload([hostedArtifact]),
          codeReview: { required: true, acceptable: false, evidence: [] },
        }),
      }),
    });
    renderDecisionPage();

    expect(await screen.findByText('缺少代码评审证据')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '作出决定' }));
    expect(screen.getByRole('button', { name: /下一步：预览并验证/ })).toBeDisabled();
    expect(screen.getByText(/代码评审证据缺失：批准会被服务端拒绝/)).toBeInTheDocument();

    // 改为“要求修改”并填写说明后可以继续；批准路径仍保持禁用。
    fireEvent.change(screen.getByLabelText('评审决定'), { target: { value: 'CHANGES_REQUESTED' } });
    fireEvent.change(screen.getByLabelText('评审说明'), {
      target: { value: '请补充人类代码评审证据后重新交付' },
    });
    expect(screen.getByRole('button', { name: /下一步：预览并验证/ })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('评审决定'), { target: { value: 'APPROVE' } });
    expect(screen.getByRole('button', { name: /下一步：预览并验证/ })).toBeDisabled();
  });

  it('抽屉模式把决定区固定在底部，并在提交成功后回调工作台刷新', async () => {
    const onDecisionCommitted = vi.fn();
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      const embeddedReview = {
        ...review,
        id: 'review-embedded',
        documentRevisionId: 'rev-2',
        artifactSetId: null,
        taskId: null,
      };
      if (path === '/api/v1/review-requests/review-embedded' && method === 'GET')
        return { status: 200, body: envelope(embeddedReview) };
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
              targetId: 'review-embedded',
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
      if (path === '/api/v1/review-requests/review-embedded/decisions' && method === 'POST')
        return {
          status: 201,
          body: envelope({
            review: {
              ...embeddedReview,
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

    const { container } = render(
      <MemoryRouter>
        <ReviewDecision
          reviewId="review-embedded"
          embedded
          onDecisionCommitted={onDecisionCommitted}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('证据完整性')).toBeInTheDocument();
    expect(container.querySelector('.decision-sticky-footer')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /作出决定 · product/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步：预览并验证/ }));
    fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    fireEvent.click(await screen.findByRole('button', { name: '提交决定' }));

    await waitFor(() => expect(onDecisionCommitted).toHaveBeenCalledTimes(1));
  });
});
