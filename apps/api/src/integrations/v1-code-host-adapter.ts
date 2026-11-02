import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import type { RepositoryEvidenceInput, ReviewEvidence } from './v1-code-evidence-policy';
import {
  parseGithubPullRequest,
  parseGithubRepository,
  parseGithubReview,
  payloadInvalid,
  repositoryStableKeyOf,
  type NormalizedPullRequest,
} from './v1-github-payload';
import {
  evaluateGithubChangeRequestEvidence,
  type GithubEvidenceResult,
} from './v1-github-evidence-normalizer';

export const GITHUB_API_BASE_URL = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_ALLOWED_HOSTS = new Set(['api.github.com', 'github.com']);

/** 注入式 fetch 签名，避免新增依赖或在测试中访问真实网络。 */
export type GithubFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type CodeHostProvider = 'GITHUB';

export type RepositoryLocator = { provider: CodeHostProvider; owner: string; name: string };

export type ChangeRequestLocator = RepositoryLocator & { number: number };

/** 稳定仓库身份：provider + 数值仓库 ID；owner/name/fullName 仅作展示，可被改名。 */
export type RepositoryIdentity = {
  provider: CodeHostProvider;
  externalRepositoryId: string;
  stableKey: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
};

export type ChangeRequestState = 'OPEN' | 'CLOSED' | 'MERGED';

export type NormalizedReview = ReviewEvidence;

export type NormalizedChangeRequest = NormalizedPullRequest & { reviews: NormalizedReview[] };

export type CodeHostCapabilities = {
  webhook: boolean;
  fetchChangeRequest: boolean;
  commitBoundReviews: boolean;
  immutableBlob: boolean;
};

export type ListChangeRequestsInput = {
  cursor?: string | null;
  perPage?: number;
};

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type LoadCodeEvidenceOptions = {
  artifactCommitSha?: string | null;
  expectedHeadSha?: string | null;
  signatureValid?: boolean;
};

export type LoadedCodeEvidence = {
  repository: RepositoryIdentity;
  changeRequest: NormalizedChangeRequest;
  evidence: RepositoryEvidenceInput;
  decision: GithubEvidenceResult['decision'];
  reasons: string[];
};

/**
 * 厂商中立的代码托管适配器。领域层只消费归一化结果，不接触 GitHub 字段。
 */
export interface CodeHostAdapter {
  readonly provider: CodeHostProvider;
  capabilities(): CodeHostCapabilities;
  verifyWebhook(input: GithubWebhookSignatureInput): boolean;
  getRepository(locator: RepositoryLocator): Promise<RepositoryIdentity>;
  listChangeRequests(
    repositories: RepositoryLocator[],
    input?: ListChangeRequestsInput,
  ): Promise<PageResult<NormalizedPullRequest>>;
  getChangeRequest(locator: ChangeRequestLocator): Promise<NormalizedChangeRequest>;
  listReviews(locator: ChangeRequestLocator): Promise<NormalizedReview[]>;
  loadCodeEvidence(
    locator: ChangeRequestLocator,
    options?: LoadCodeEvidenceOptions,
  ): Promise<LoadedCodeEvidence>;
}

export type GithubCodeHostAdapterOptions = {
  token: string;
  fetchImpl?: GithubFetch;
  apiBaseUrl?: string;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  maxPagesPerCollection?: number;
};

export type GithubWebhookSignatureInput = {
  secret: string;
  rawBody: string | Uint8Array;
  signatureHeader: string | undefined;
};

export function signGithubWebhookBody(rawBody: string | Uint8Array, secret: string): string {
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${digest}`;
}

/** 校验 X-Hub-Signature-256；缺签名、格式错误或长度不符一律拒绝。 */
export function verifyGithubWebhookSignature(input: GithubWebhookSignatureInput): boolean {
  if (typeof input.secret !== 'string' || input.secret.length === 0) return false;
  if (typeof input.signatureHeader !== 'string' || input.signatureHeader.length === 0) return false;
  const prefix = 'sha256=';
  if (!input.signatureHeader.startsWith(prefix)) return false;
  const provided = input.signatureHeader.slice(prefix.length);
  if (!/^[0-9a-fA-F]{64}$/.test(provided)) return false;
  const expected = createHmac('sha256', input.secret).update(input.rawBody).digest('hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  const providedBytes = Buffer.from(provided.toLowerCase(), 'hex');
  if (expectedBytes.length !== providedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
}

export function assertGithubWebhookSignature(input: GithubWebhookSignatureInput): void {
  if (!verifyGithubWebhookSignature(input))
    throw new WorkmeshError(
      V1_ERROR_CODES.FORBIDDEN,
      'WEBHOOK_SIGNATURE_INVALID',
      { reason: 'SIGNATURE_INVALID' },
      403,
    );
}

/**
 * GitHub REST 实现：固定 API 版本、白名单主机、10s 超时、有限 GET 重试。
 * credential 只来自调用方传入的 token，不写入错误、日志或 details。
 */
export class GithubCodeHostAdapter implements CodeHostAdapter {
  readonly provider: CodeHostProvider = 'GITHUB';

  private readonly fetchImpl: GithubFetch;
  private readonly token: string;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly maxPagesPerCollection: number;

  constructor(options: GithubCodeHostAdapterOptions) {
    if (typeof options.token !== 'string' || options.token.trim().length === 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.INPUT_UNAVAILABLE,
        'GITHUB_TOKEN_REQUIRED',
        undefined,
        422,
      );

    const base = new URL(options.apiBaseUrl ?? GITHUB_API_BASE_URL);
    if (base.protocol !== 'https:' || !GITHUB_ALLOWED_HOSTS.has(base.hostname))
      throw new WorkmeshError(
        V1_ERROR_CODES.INPUT_UNAVAILABLE,
        'PROVIDER_BASE_URL_NOT_ALLOWED',
        { host: base.hostname },
        422,
      );

    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.token = options.token;
    this.apiBaseUrl = base.origin;
    this.timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 10_000;
    this.retryDelaysMs = options.retryDelaysMs ?? [250, 1000];
    this.maxPagesPerCollection =
      options.maxPagesPerCollection && options.maxPagesPerCollection > 0
        ? options.maxPagesPerCollection
        : 100;
  }

  capabilities(): CodeHostCapabilities {
    return {
      webhook: true,
      fetchChangeRequest: true,
      commitBoundReviews: true,
      immutableBlob: true,
    };
  }

  verifyWebhook(input: GithubWebhookSignatureInput): boolean {
    return verifyGithubWebhookSignature(input);
  }

  async getRepository(locator: RepositoryLocator): Promise<RepositoryIdentity> {
    this.assertLocator(locator);
    const { body } = await this.getJson(this.repositoryPath(locator));
    return parseGithubRepository(body, { owner: locator.owner, name: locator.name });
  }

  /**
   * 多仓范围：按稳定身份排序后逐仓分页拉取并合并，再按 (仓库数值 ID, PR 编号) 稳定排序。
   * cursor 绑定本次仓库范围摘要，不能跨范围复用。
   */
  async listChangeRequests(
    repositories: RepositoryLocator[],
    input: ListChangeRequestsInput = {},
  ): Promise<PageResult<NormalizedPullRequest>> {
    if (!Array.isArray(repositories) || repositories.length === 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.INPUT_UNAVAILABLE,
        'REPOSITORY_SCOPE_REQUIRED',
        undefined,
        422,
      );
    const perPage = resolvePerPage(input.perPage);
    const locators = uniqueSortedLocators(repositories);
    const identities: RepositoryIdentity[] = [];
    const collected: NormalizedPullRequest[] = [];

    for (const locator of locators) {
      const identity = await this.getRepository(locator);
      identities.push(identity);
      collected.push(...(await this.fetchPullRequestPages(identity, perPage)));
    }

    collected.sort(compareChangeRequests);
    const scope = scopeDigestOf(identities);

    let offset = 0;
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor);
      if (cursor.scope !== scope) throw invalidCursor();
      offset = cursor.offset;
    }
    if (offset > collected.length) throw invalidCursor();

    const items = collected.slice(offset, offset + perPage);
    const end = offset + items.length;
    const nextCursor = end < collected.length ? encodeCursor({ v: 1, scope, offset: end }) : null;
    return { items, nextCursor, hasMore: nextCursor !== null };
  }

  /** 单次读取 PR 与完整 reviews；分页截断会失败而不是把不完整集合当完整。 */
  async getChangeRequest(locator: ChangeRequestLocator): Promise<NormalizedChangeRequest> {
    this.assertLocator(locator);
    const identity = await this.getRepository(locator);
    const changeRequest = await this.fetchPullRequest(identity, locator.number);
    const reviews = await this.fetchAllReviews(identity, locator.number);
    return { ...changeRequest, reviews };
  }

  async listReviews(locator: ChangeRequestLocator): Promise<NormalizedReview[]> {
    this.assertLocator(locator);
    const identity = await this.getRepository(locator);
    return this.fetchAllReviews(identity, locator.number);
  }

  /**
   * prepare-code-evidence 适配器侧：PR → 完整 reviews → 再次读取 PR。
   * 两次身份/head/合并状态/providerUpdatedAt 不一致返回 UNKNOWN/UPSTREAM_CHANGED。
   */
  async loadCodeEvidence(
    locator: ChangeRequestLocator,
    options: LoadCodeEvidenceOptions = {},
  ): Promise<LoadedCodeEvidence> {
    this.assertLocator(locator);
    const repository = await this.getRepository(locator);
    const first = await this.fetchPullRequest(repository, locator.number);
    const reviews = await this.fetchAllReviews(repository, locator.number);
    const second = await this.fetchPullRequest(repository, locator.number);
    const changeRequest: NormalizedChangeRequest = { ...first, reviews };
    const result = evaluateGithubChangeRequestEvidence(changeRequest, {
      artifactCommitSha: options.artifactCommitSha,
      expectedHeadSha: options.expectedHeadSha,
      signatureValid: options.signatureValid,
    });

    if (
      first.externalId !== second.externalId ||
      first.headSha !== second.headSha ||
      first.state !== second.state ||
      first.merged !== second.merged ||
      first.providerUpdatedAt !== second.providerUpdatedAt
    )
      return {
        repository,
        changeRequest,
        evidence: result.evidence,
        decision: 'UNKNOWN',
        reasons: ['UPSTREAM_CHANGED'],
      };

    return {
      repository,
      changeRequest,
      evidence: result.evidence,
      decision: result.decision,
      reasons: result.reasons,
    };
  }

  private async fetchPullRequestPages(
    repository: RepositoryIdentity,
    perPage: number,
  ): Promise<NormalizedPullRequest[]> {
    const items: NormalizedPullRequest[] = [];
    let page = 1;
    let pagesRead = 0;
    while (true) {
      if (pagesRead >= this.maxPagesPerCollection)
        throw new WorkmeshError(
          V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
          'PAGINATION_LIMIT_EXCEEDED',
          { collection: 'pull_requests', pageLimit: this.maxPagesPerCollection },
          422,
        );
      pagesRead += 1;
      const { body, link } = await this.getJson(this.pullsPath(repository), {
        state: 'all',
        sort: 'created',
        direction: 'asc',
        per_page: String(perPage),
        page: String(page),
      });
      if (!Array.isArray(body)) throw payloadInvalid('pull_requests');
      for (const entry of body) items.push(parseGithubPullRequest(entry, repository));
      const next = parseGithubNextPage(link);
      if (next === null) break;
      if (next <= page)
        throw new WorkmeshError(
          V1_ERROR_CODES.INPUT_UNAVAILABLE,
          'PROVIDER_INVALID_PAGINATION',
          { collection: 'pull_requests', page },
          422,
        );
      page = next;
    }
    return items;
  }

  private async fetchPullRequest(
    repository: RepositoryIdentity,
    number: number,
  ): Promise<NormalizedPullRequest> {
    const { body } = await this.getJson(this.pullPath(repository, number));
    return parseGithubPullRequest(body, repository);
  }

  private async fetchAllReviews(
    repository: RepositoryIdentity,
    number: number,
  ): Promise<NormalizedReview[]> {
    const reviews: NormalizedReview[] = [];
    let page = 1;
    let pagesRead = 0;
    while (true) {
      if (pagesRead >= this.maxPagesPerCollection)
        throw new WorkmeshError(
          V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
          'PAGINATION_LIMIT_EXCEEDED',
          { collection: 'reviews', pageLimit: this.maxPagesPerCollection },
          422,
        );
      pagesRead += 1;
      const { body, link } = await this.getJson(this.reviewsPath(repository, number), {
        per_page: '100',
        page: String(page),
      });
      if (!Array.isArray(body)) throw payloadInvalid('reviews');
      for (const entry of body) reviews.push(parseGithubReview(entry));
      if (reviews.length > 1000)
        throw new WorkmeshError(
          V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
          'PAGINATION_LIMIT_EXCEEDED',
          { collection: 'reviews', itemLimit: 1000 },
          422,
        );
      const next = parseGithubNextPage(link);
      if (next === null) break;
      if (next <= page)
        throw new WorkmeshError(
          V1_ERROR_CODES.INPUT_UNAVAILABLE,
          'PROVIDER_INVALID_PAGINATION',
          { collection: 'reviews', page },
          422,
        );
      page = next;
    }
    return reviews.sort(
      (a, b) =>
        (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '') ||
        a.reviewId.localeCompare(b.reviewId),
    );
  }

  private async getJson(
    path: string,
    query: Record<string, string> = {},
  ): Promise<{ body: unknown; link: string | null }> {
    const url = new URL(`${this.apiBaseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await this.fetchResponse(url);
    const text = await response.text();
    if (text.length === 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.CONTENT_UNAVAILABLE,
        'GITHUB_EMPTY_RESPONSE',
        { path },
        503,
      );
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new WorkmeshError(
        V1_ERROR_CODES.CONTENT_UNAVAILABLE,
        'GITHUB_INVALID_JSON',
        { path },
        503,
      );
    }
    return { body, link: response.headers.get('link') };
  }

  private async fetchResponse(url: URL): Promise<Response> {
    let attempt = 0;
    let lastError: unknown = null;
    while (true) {
      let response: Response | null = null;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: this.requestHeaders(),
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        lastError = error;
      }

      if (response) {
        if (response.status === 429) throw rateLimitedError(response);
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          const retryAfter = retryAfterSecondsOf(response);
          const maxDelay =
            this.retryDelaysMs.length > 0 ? this.retryDelaysMs[this.retryDelaysMs.length - 1] : 0;
          if (retryAfter !== null && retryAfter * 1000 > maxDelay)
            throw upstreamUnavailableError(response.status, { retryAfterSeconds: retryAfter });
          if (attempt < this.retryDelaysMs.length) {
            await sleep(this.retryDelaysMs[attempt]);
            attempt += 1;
            continue;
          }
          throw upstreamUnavailableError(response.status);
        }
        if (response.status === 404)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'GITHUB_RESOURCE_NOT_FOUND',
            { status: 404 },
            404,
          );
        if (response.status === 401 || response.status === 403)
          throw new WorkmeshError(
            V1_ERROR_CODES.AUTHORIZATION_DENIED,
            'GITHUB_AUTHORIZATION_DENIED',
            { status: response.status },
            403,
          );
        if (!response.ok)
          throw new WorkmeshError(
            V1_ERROR_CODES.INPUT_UNAVAILABLE,
            'GITHUB_REQUEST_REJECTED',
            { status: response.status },
            422,
          );
        return response;
      }

      if (attempt < this.retryDelaysMs.length) {
        await sleep(this.retryDelaysMs[attempt]);
        attempt += 1;
        continue;
      }
      if (isAbortLike(lastError))
        throw new WorkmeshError(
          V1_ERROR_CODES.CONTENT_UNAVAILABLE,
          'GITHUB_REQUEST_TIMEOUT',
          { timeoutMs: this.timeoutMs },
          503,
        );
      throw new WorkmeshError(
        V1_ERROR_CODES.CONTENT_UNAVAILABLE,
        'GITHUB_PROVIDER_UNREACHABLE',
        { reason: 'NETWORK_ERROR' },
        503,
      );
    }
  }

  private requestHeaders(): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${this.token}`,
      'user-agent': 'WorkMesh/1.0',
      'x-github-api-version': GITHUB_API_VERSION,
    };
  }

  private assertLocator(locator: RepositoryLocator): void {
    if (locator.provider !== 'GITHUB')
      throw new WorkmeshError(
        V1_ERROR_CODES.INPUT_UNAVAILABLE,
        'PROVIDER_UNSUPPORTED',
        { provider: locator.provider },
        422,
      );
    if (typeof locator.owner !== 'string' || locator.owner.trim().length === 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.INPUT_UNAVAILABLE,
        'REPOSITORY_OWNER_REQUIRED',
        undefined,
        422,
      );
    if (typeof locator.name !== 'string' || locator.name.trim().length === 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.INPUT_UNAVAILABLE,
        'REPOSITORY_NAME_REQUIRED',
        undefined,
        422,
      );
  }

  private repositoryPath(locator: RepositoryLocator): string {
    return `/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.name)}`;
  }

  private pullsPath(repository: RepositoryIdentity): string {
    return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls`;
  }

  private pullPath(repository: RepositoryIdentity, number: number): string {
    return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls/${number}`;
  }

  private reviewsPath(repository: RepositoryIdentity, number: number): string {
    return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls/${number}/reviews`;
  }
}

type CursorPayload = { v: 1; scope: string; offset: number };

function encodeCursor(cursor: CursorPayload): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== 1 ||
    typeof (parsed as { scope?: unknown }).scope !== 'string' ||
    typeof (parsed as { offset?: unknown }).offset !== 'number' ||
    !Number.isSafeInteger((parsed as { offset: number }).offset) ||
    (parsed as { offset: number }).offset < 0
  )
    throw invalidCursor();
  return {
    v: 1,
    scope: (parsed as { scope: string }).scope,
    offset: (parsed as { offset: number }).offset,
  };
}

function invalidCursor(): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.INVALID_REQUEST,
    'INVALID_CURSOR',
    { reason: 'INVALID_CURSOR' },
    400,
  );
}

function resolvePerPage(value: number | undefined): number {
  const perPage = value ?? 100;
  if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100)
    throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, 'INVALID_PAGE_SIZE', { perPage }, 400);
  return perPage;
}

function uniqueSortedLocators(repositories: RepositoryLocator[]): RepositoryLocator[] {
  const seen = new Set<string>();
  return repositories
    .filter((locator) => {
      const key = `${locator.provider}:${locator.owner}/${locator.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareLocators);
}

function compareLocators(a: RepositoryLocator, b: RepositoryLocator): number {
  return (
    a.provider.localeCompare(b.provider) ||
    a.owner.localeCompare(b.owner) ||
    a.name.localeCompare(b.name)
  );
}

function compareChangeRequests(a: NormalizedPullRequest, b: NormalizedPullRequest): number {
  return (
    compareNumericStrings(a.repository.externalRepositoryId, b.repository.externalRepositoryId) ||
    compareNumericStrings(a.numberLabel.replace('#', ''), b.numberLabel.replace('#', '')) ||
    a.externalId.localeCompare(b.externalId)
  );
}

function compareNumericStrings(a: string, b: string): number {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return a.localeCompare(b);
}

function scopeDigestOf(identities: RepositoryIdentity[]): string {
  const keys = identities.map(repositoryStableKeyOf).sort();
  return createHash('sha256').update(JSON.stringify(keys)).digest('hex');
}

function parseGithubNextPage(linkHeader: string | null): number | null {
  if (!linkHeader) return null;
  for (const segment of linkHeader.split(',')) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="next"/.exec(segment);
    if (!match) continue;
    let url: URL;
    try {
      url = new URL(match[1]);
    } catch {
      throw new WorkmeshError(
        V1_ERROR_CODES.INPUT_UNAVAILABLE,
        'PROVIDER_INVALID_PAGINATION',
        { collection: 'link_header' },
        422,
      );
    }
    const page = Number(url.searchParams.get('page'));
    if (!Number.isSafeInteger(page) || page <= 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.INPUT_UNAVAILABLE,
        'PROVIDER_INVALID_PAGINATION',
        { collection: 'link_header' },
        422,
      );
    return page;
  }
  return null;
}

function rateLimitedError(response: Response): WorkmeshError {
  const retryAfter = retryAfterSecondsOf(response);
  return new WorkmeshError(
    V1_ERROR_CODES.RATE_LIMITED,
    'GITHUB_RATE_LIMITED',
    retryAfter === null ? undefined : { retryAfterSeconds: retryAfter },
    429,
  );
}

function upstreamUnavailableError(status: number, extra?: Record<string, number>): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.CONTENT_UNAVAILABLE,
    'GITHUB_UPSTREAM_UNAVAILABLE',
    { status, ...extra },
    503,
  );
}

function retryAfterSecondsOf(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (value === null) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds;
}

function isAbortLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
