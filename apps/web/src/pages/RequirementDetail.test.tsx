import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RequirementDetail } from './RequirementDetail';
import { setCsrfToken } from '../api/client';
import { envelope, mockFetch, pathOf, useProject } from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };

const detail = {
  requirement: {
    id: 'req-1',
    projectId: 'p1',
    seq: 1,
    code: 'DEMO-001',
    title: '登录页改版',
    description: '支持记住登录状态。',
    version: 3,
    generation: 1,
    phase: 'DELIVERY',
    workStatus: 'ACTIVE',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
  },
  tasks: [
    {
      id: 'task-1',
      stepKey: 'backend-impl',
      role: { key: 'backend', title: '后端' },
      responsibleUser: { id: 'u-1', email: 'bob@example.com' },
      version: 2,
      generation: 1,
      executionStatus: 'REVIEW_PENDING',
      workStatus: 'ACTIVE',
      currentClaimId: 'claim-1',
      currentArtifactSetId: 'set-1',
      instanceId: 'inst-1',
      artifactCount: 1,
      review: { id: 'review-1', kind: 'TASK_ACCEPTANCE', status: 'OPEN' },
    },
  ],
  artifacts: [
    {
      id: 'artifact-1',
      taskId: 'task-1',
      kind: 'IMPL',
      storage: 'HOSTED',
      mediaType: 'text/markdown',
      byteLength: 128,
      sha256: 'a'.repeat(64),
      commitSha: 'b'.repeat(40),
      repoPath: 'src/auth/login.ts',
      summary: '登录实现',
      checks: [],
      createdAt: '2026-11-02T00:00:00.000Z',
    },
  ],
  reviews: [
    {
      id: 'review-1',
      kind: 'TASK_ACCEPTANCE',
      status: 'OPEN',
      version: 2,
      subjectDigest: 'c'.repeat(64),
      documentRevisionId: null,
      artifactSetId: 'set-1',
      taskId: 'task-1',
      createdAt: '2026-11-02T00:00:00.000Z',
      subjectLabel: 'backend-impl',
      slots: [
        {
          id: 'slot-1',
          slotKey: 'backend',
          requiredUserId: 'u-1',
          requiredRoleId: 'role-backend',
        },
      ],
      decisions: [],
    },
  ],
  changes: [],
  counts: { tasks: 1, artifacts: 1, reviews: 1, changes: 0 },
};

describe('RequirementDetail（需求详情读模型）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('展示需求、任务、工件与待签字入口', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      if (path === '/api/v1/projects' && (init?.method ?? 'GET') === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/requirements/DEMO-001')
        return { status: 200, body: envelope(detail) };
      if (path === '/api/v1/projects/p1/documents')
        return { status: 200, body: envelope({ items: [], nextCursor: null }) };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/requirements/DEMO-001']}>
        <Routes>
          <Route path="/requirements/:requirementId" element={<RequirementDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('登录页改版')).toBeInTheDocument();
    expect(screen.getByText('DEMO-001')).toBeInTheDocument();
    expect(screen.getByText('支持记住登录状态。')).toBeInTheDocument();
    expect(screen.getByText(/有 1 条评审待签字/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /任务/ }));
    expect(screen.getAllByText('backend-impl').length).toBeGreaterThan(0);
    expect(screen.getByText(/bob@example.com/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /去签字/ }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /交付物/ }));
    expect(screen.getByText(/sha256 aaaaaaaaaaaa/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /评审/ }));
    expect(screen.getByText('任务验收')).toBeInTheDocument();
  });
});
