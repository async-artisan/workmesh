import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Workbench } from './Workbench';
import { setCsrfToken } from '../api/client';
import { bodyOf, envelope, headersOf, methodOf, mockFetch, pathOf, useProject } from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };

function recipient(ackedAt: string | null) {
  return {
    id: 'c1',
    projectId: 'p1',
    eventId: 'evt-1',
    userId: 'user-1',
    roleId: null,
    version: 2,
    ackedAt,
    createdAt: '2026-11-01T00:00:00.000Z',
  };
}

function renderWorkbench() {
  return render(
    <MemoryRouter>
      <Workbench />
    </MemoryRouter>,
  );
}

describe('Workbench（变更确认版本冲突）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('确认变更提交收件人版本；旧版本 409 原样展示', async () => {
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/change-recipients' && method === 'GET')
        return { status: 200, body: envelope({ items: [recipient(null)], nextCursor: null }) };
      if (path === '/api/v1/change-recipients/c1/ack' && method === 'POST')
        return {
          status: 409,
          body: {
            error: {
              code: 'VERSION_CONFLICT',
              message: '收件人版本已变化',
              details: { currentVersion: 3 },
              requestId: 'req-409',
            },
          },
        };
      return undefined;
    });

    renderWorkbench();
    expect(await screen.findByText('evt-1')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认已处理' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[VERSION_CONFLICT] 收件人版本已变化 · requestId req-409',
    );
    expect(screen.queryByText('变更已确认。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认已处理' })).toBeEnabled();

    const ackCall = mock.mock.calls.find(
      ([url, init]) => pathOf(String(url)) === '/api/v1/change-recipients/c1/ack' && methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(ackCall?.[1] ?? {})).toEqual({ expectedVersion: 2 });
    expect(headersOf(ackCall?.[1] ?? {})['X-CSRF-Token']).toBe('csrf-1');
  });

  it('确认成功后刷新为已确认状态', async () => {
    let acked = false;
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/change-recipients' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            items: [recipient(acked ? '2026-11-01T01:00:00.000Z' : null)],
            nextCursor: null,
          }),
        };
      if (path === '/api/v1/change-recipients/c1/ack' && method === 'POST') {
        acked = true;
        return { status: 200, body: envelope({ acked: true }) };
      }
      return undefined;
    });

    renderWorkbench();
    fireEvent.click(await screen.findByRole('button', { name: '确认已处理' }));

    expect(await screen.findByText('变更已确认。')).toBeInTheDocument();
    expect(await screen.findByText('已确认')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认已处理' })).not.toBeInTheDocument();
  });
});
