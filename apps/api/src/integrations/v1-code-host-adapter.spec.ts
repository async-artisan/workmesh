import { describe, expect, it } from 'vitest';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import fixture from './fixtures/github-evidence.fixture.json';
import {
  GithubCodeHostAdapter,
  type GithubFetch,
  type RepositoryLocator,
} from './v1-code-host-adapter';

type CallRecord = { url: string; headers: Record<string, string> };

type FetchStub = GithubFetch & { calls: CallRecord[] };

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key.toLowerCase()] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key.toLowerCase(), value]));
  }
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) record[key.toLowerCase()] = value;
  return record;
}

function jsonResponse(
  body: unknown,
  init: { status?: number; link?: string; retryAfter?: string } = {},
): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.link) headers.link = init.link;
  if (init.retryAfter) headers['retry-after'] = init.retryAfter;
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

function stubFetch(handler: (url: URL, callIndex: number) => Response): FetchStub {
  const calls: CallRecord[] = [];
  const impl: GithubFetch = async (input, init) => {
    const url = new URL(input);
    const callIndex = calls.length;
    calls.push({ url: input, headers: headersToRecord(init?.headers) });
    return handler(url, callIndex);
  };
  return Object.assign(impl, { calls });
}

const locator: RepositoryLocator = { provider: 'GITHUB', owner: 'octocat', name: 'Hello-World' };
const secondLocator: RepositoryLocator = { provider: 'GITHUB', owner: 'octocat', name: 'Second-Repo' };

function nextLink(path: string, page: number): string {
  return `<https://api.github.com${path}?per_page=100&page=${page}>; rel="next"`;
}

describe('github code host adapter', () => {
  it('uses the documented URL, headers and Link pagination', async () => {
    const stub = stubFetch((url) => {
      if (url.pathname === '/repos/octocat/Hello-World') return jsonResponse(fixture.repository);
      if (url.pathname === '/repos/octocat/Hello-World/pulls') {
        const page = Number(url.searchParams.get('page'));
        if (page === 1)
          return jsonResponse(fixture.pullsPage1, {
            link: nextLink('/repos/octocat/Hello-World/pulls', 2),
          });
        return jsonResponse(fixture.pullsPage2);
      }
      return jsonResponse({ message: 'not found' }, { status: 404 });
    });
    const adapter = new GithubCodeHostAdapter({ token: 'test-token', fetchImpl: stub });

    const result = await adapter.listChangeRequests([locator], { perPage: 100 });
    expect(result.items.map((item) => item.numberLabel)).toEqual(['#42', '#43', '#44']);
    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);

    expect(stub.calls[0].url).toBe('https://api.github.com/repos/octocat/Hello-World');
    expect(stub.calls[0].headers.authorization).toBe('Bearer test-token');
    expect(stub.calls[0].headers.accept).toBe('application/vnd.github+json');
    expect(stub.calls[0].headers['x-github-api-version']).toBe('2022-11-28');
    expect(stub.calls[0].headers['user-agent']).toBe('WorkMesh/1.0');

    const pullCalls = stub.calls.filter((call) => call.url.includes('/pulls'));
    expect(pullCalls.map((call) => new URL(call.url).searchParams.get('page'))).toEqual(['1', '2']);
    expect(new URL(pullCalls[0].url).searchParams.get('state')).toBe('all');
    expect(new URL(pullCalls[0].url).searchParams.get('sort')).toBe('created');
    expect(new URL(pullCalls[0].url).searchParams.get('direction')).toBe('asc');
    expect(new URL(pullCalls[0].url).searchParams.get('per_page')).toBe('100');
  });

  it('merges multiple repositories with stable ordering and rejects stale cursors', async () => {
    const stub = stubFetch((url) => {
      if (url.pathname === '/repos/octocat/Hello-World') return jsonResponse(fixture.repository);
      if (url.pathname === '/repos/octocat/Second-Repo') return jsonResponse(fixture.secondRepository);
      if (url.pathname === '/repos/octocat/Hello-World/pulls') {
        const page = Number(url.searchParams.get('page'));
        if (page === 1)
          return jsonResponse(fixture.pullsPage1, {
            link: nextLink('/repos/octocat/Hello-World/pulls', 2),
          });
        return jsonResponse(fixture.pullsPage2);
      }
      if (url.pathname === '/repos/octocat/Second-Repo/pulls') return jsonResponse(fixture.secondPulls);
      return jsonResponse({ message: 'not found' }, { status: 404 });
    });
    const adapter = new GithubCodeHostAdapter({ token: 'test-token', fetchImpl: stub });

    const first = await adapter.listChangeRequests([secondLocator, locator], { perPage: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.items.map((item) => item.repository.externalRepositoryId)).toEqual(['555001', '1296269']);
    expect(first.nextCursor).not.toBeNull();

    const second = await adapter.listChangeRequests([secondLocator, locator], {
      perPage: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.numberLabel)).toEqual(['#43', '#44']);
    expect(second.nextCursor).toBeNull();

    await expect(
      adapter.listChangeRequests([locator], { perPage: 2, cursor: first.nextCursor ?? undefined }),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.INVALID_REQUEST, message: 'INVALID_CURSOR' });
  });

  it('keeps repository identity stable across renames', async () => {
    const stub = stubFetch((_url, callIndex) =>
      jsonResponse(callIndex === 0 ? fixture.repository : fixture.repositoryRenamed),
    );
    const adapter = new GithubCodeHostAdapter({ token: 'test-token', fetchImpl: stub });

    const first = await adapter.getRepository(locator);
    const renamed = await adapter.getRepository(locator);
    expect(first.stableKey).toBe('GITHUB:1296269');
    expect(first.stableKey).toBe(renamed.stableKey);
    expect(first.externalRepositoryId).toBe(renamed.externalRepositoryId);
    expect(first.fullName).not.toBe(renamed.fullName);
  });

  it('reads every review page instead of only the first page', async () => {
    const stub = stubFetch((url) => {
      if (url.pathname === '/repos/octocat/Hello-World') return jsonResponse(fixture.repository);
      if (url.pathname === '/repos/octocat/Hello-World/pulls/42') return jsonResponse(fixture.pullRequest);
      if (url.pathname === '/repos/octocat/Hello-World/pulls/42/reviews') {
        const page = Number(url.searchParams.get('page'));
        if (page === 1)
          return jsonResponse(fixture.reviewsPage1, {
            link: nextLink('/repos/octocat/Hello-World/pulls/42/reviews', 2),
          });
        return jsonResponse(fixture.reviewsPage2);
      }
      return jsonResponse({ message: 'not found' }, { status: 404 });
    });
    const adapter = new GithubCodeHostAdapter({ token: 'test-token', fetchImpl: stub });

    const changeRequest = await adapter.getChangeRequest({ ...locator, number: 42 });
    expect(changeRequest.reviews.map((review) => review.reviewId)).toEqual(['501', '502']);
    expect(changeRequest.reviews[0].state).toBe('APPROVED');
    expect(changeRequest.reviews[1].state).toBe('COMMENTED');
  });

  it('loads prepare-code-evidence input and reports upstream changes', async () => {
    let pullRead = 0;
    const stub = stubFetch((url) => {
      if (url.pathname === '/repos/octocat/Hello-World') return jsonResponse(fixture.repository);
      if (url.pathname === '/repos/octocat/Hello-World/pulls/42') {
        pullRead += 1;
        if (pullRead === 2) return jsonResponse({ ...fixture.pullRequest, head: { sha: 'head-sha-moved', ref: 'feature/evidence' } });
        return jsonResponse(fixture.pullRequest);
      }
      if (url.pathname === '/repos/octocat/Hello-World/pulls/42/reviews') {
        const page = Number(url.searchParams.get('page'));
        if (page === 1)
          return jsonResponse(fixture.reviewsPage1, {
            link: nextLink('/repos/octocat/Hello-World/pulls/42/reviews', 2),
          });
        return jsonResponse(fixture.reviewsPage2);
      }
      return jsonResponse({ message: 'not found' }, { status: 404 });
    });
    const adapter = new GithubCodeHostAdapter({ token: 'test-token', fetchImpl: stub });

    const loaded = await adapter.loadCodeEvidence(
      { ...locator, number: 42 },
      { artifactCommitSha: 'head-sha-current' },
    );
    expect(loaded.decision).toBe('UNKNOWN');
    expect(loaded.reasons).toContain('UPSTREAM_CHANGED');
    expect(loaded.evidence.repositoryId).toBe('GITHUB:1296269');
    expect(loaded.changeRequest.headSha).toBe('head-sha-current');
  });

  it('maps 429, 5xx, timeout and 404 to WorkmeshError', async () => {
    const rateLimited = new GithubCodeHostAdapter({
      token: 'test-token',
      fetchImpl: stubFetch(() =>
        jsonResponse({ message: 'rate limited' }, { status: 429, retryAfter: '60' }),
      ),
    });
    await expect(rateLimited.getRepository(locator)).rejects.toMatchObject({
      code: V1_ERROR_CODES.RATE_LIMITED,
      status: 429,
      details: { retryAfterSeconds: 60 },
    });

    const unavailableStub = stubFetch(() => jsonResponse({ message: 'unavailable' }, { status: 503 }));
    const unavailable = new GithubCodeHostAdapter({
      token: 'test-token',
      fetchImpl: unavailableStub,
      retryDelaysMs: [0, 0],
    });
    await expect(unavailable.getRepository(locator)).rejects.toMatchObject({
      code: V1_ERROR_CODES.CONTENT_UNAVAILABLE,
      status: 503,
    });
    expect(unavailableStub.calls).toHaveLength(3);

    const timeout = new GithubCodeHostAdapter({
      token: 'test-token',
      fetchImpl: stubFetch(() => {
        throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      }),
      retryDelaysMs: [],
    });
    await expect(timeout.getRepository(locator)).rejects.toMatchObject({
      code: V1_ERROR_CODES.CONTENT_UNAVAILABLE,
      message: 'GITHUB_REQUEST_TIMEOUT',
    });

    const missing = new GithubCodeHostAdapter({
      token: 'test-token',
      fetchImpl: stubFetch(() => jsonResponse({ message: 'not found' }, { status: 404 })),
    });
    await expect(missing.getRepository(locator)).rejects.toBeInstanceOf(WorkmeshError);
    await expect(missing.getRepository(locator)).rejects.toMatchObject({
      code: V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      status: 404,
    });
  });
});
